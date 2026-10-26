"""
backend/app/store.py
High-performance in-memory analytics store.
Loads Parquet snapshots once at startup and provides sub-millisecond query evaluation.
Supports dynamic cutoff evaluation, forecast revision trajectories, and commercial shortfall metrics.
"""

from __future__ import annotations

import os
import re
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

from app.pipeline.selection import select_decision_forecasts
from app.pipeline.join import join_forecasts_and_actuals, audit_quality_and_missing
from app.metrics import (
    compute_kpi_summary,
    calculate_bias,
    calculate_mae,
    calculate_rmse,
    calculate_nmae,
    calculate_shortfall_energy_mwh,
    calculate_surplus_energy_mwh,
    calculate_boxplot_statistics,
    calculate_buy_range_for_intervals,
)
from app.uncertainty import (
    build_error_history,
    compute_day_ahead_schedule,
    run_walk_forward_backtest,
)

logger = logging.getLogger("store")


class DataStore:
    """Singleton in-memory data store for wind forecasts and actuals."""

    def __init__(self, data_dir: Optional[str] = None):
        if data_dir is None:
            # Look for data/processed relative to project root
            base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            self.data_dir = os.path.join(base, "data", "processed")
        else:
            self.data_dir = data_dir

        self.df_actuals: pd.DataFrame = pd.DataFrame()
        self.df_forecasts_raw: pd.DataFrame = pd.DataFrame()
        self.df_decision_default: pd.DataFrame = pd.DataFrame()
        self.df_joined_hourly_default: pd.DataFrame = pd.DataFrame()
        self.df_joined_half_hourly_default: pd.DataFrame = pd.DataFrame()
        self.quality_report: Dict[str, Any] = {}
        
        # Cache for dynamically evaluated cutoffs: key = (cutoff_str, mode)
        self._cache: Dict[Tuple[str, str], pd.DataFrame] = {}
        self.is_loaded = False

    def load(self):
        """Loads all Parquet snapshots and audit reports into memory."""
        logger.info(f"Loading data snapshots from {self.data_dir}...")
        
        act_path = os.path.join(self.data_dir, "actuals.parquet")
        f_raw_path = os.path.join(self.data_dir, "forecasts_raw.parquet")
        dec_path = os.path.join(self.data_dir, "decision_forecasts.parquet")
        joined_path = os.path.join(self.data_dir, "joined_analysis.parquet")
        hh_path = os.path.join(self.data_dir, "half_hourly_analysis.parquet")
        quality_path = os.path.join(self.data_dir, "quality_report.json")

        if not os.path.exists(act_path) or not os.path.exists(f_raw_path):
            raise FileNotFoundError(
                f"Missing snapshot files in {self.data_dir}. Run 'python scripts/build_snapshot.py' first."
            )

        self.df_actuals = pd.read_parquet(act_path)
        self.df_forecasts_raw = pd.read_parquet(f_raw_path)
        
        if os.path.exists(dec_path):
            self.df_decision_default = pd.read_parquet(dec_path)
        if os.path.exists(joined_path):
            self.df_joined_hourly_default = pd.read_parquet(joined_path)
        if os.path.exists(hh_path):
            self.df_joined_half_hourly_default = pd.read_parquet(hh_path)
        if os.path.exists(quality_path):
            with open(quality_path, "r", encoding="utf-8") as f:
                self.quality_report = json.load(f)

        # Ensure UTC datetime types
        for df in [self.df_actuals, self.df_forecasts_raw, self.df_decision_default, self.df_joined_hourly_default, self.df_joined_half_hourly_default]:
            if not df.empty:
                if "start_time" in df.columns:
                    df["start_time"] = pd.to_datetime(df["start_time"], utc=True)
                if "publish_time" in df.columns:
                    df["publish_time"] = pd.to_datetime(df["publish_time"], utc=True)
                if "forecast_publish_time" in df.columns:
                    df["forecast_publish_time"] = pd.to_datetime(df["forecast_publish_time"], utc=True)
                if "delivery_date" in df.columns:
                    df["delivery_date"] = pd.to_datetime(df["delivery_date"]).dt.date

        # Register default in cache
        if not self.df_joined_hourly_default.empty:
            self._cache[("09:00", "hourly")] = self.df_joined_hourly_default
        if not self.df_joined_half_hourly_default.empty:
            self._cache[("09:00", "half_hourly")] = self.df_joined_half_hourly_default

        self.is_loaded = True
        logger.info(
            f"Snapshots loaded: {len(self.df_actuals)} actuals, {len(self.df_forecasts_raw)} raw forecasts."
        )

    def parse_cutoff(self, cutoff_time: str) -> Tuple[int, int]:
        """Validates and parses cutoff time string 'HH:MM'."""
        match = re.match(r"^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$", cutoff_time.strip())
        if not match:
            raise ValueError(f"Invalid cutoff_time format '{cutoff_time}'. Expected 'HH:MM' (24-hour UTC).")
        return int(match.group(1)), int(match.group(2))

    def get_joined_dataset(self, cutoff_time: str = "09:00", mode: str = "hourly") -> pd.DataFrame:
        """
        Retrieves the joined dataset for a given cutoff time and resolution.
        Evaluates pure selection and caching dynamically if cutoff differs from default.
        """
        cutoff_key = cutoff_time.strip()
        cache_key = (cutoff_key, mode)
        if cache_key in self._cache:
            return self._cache[cache_key]

        # Dynamically compute for custom cutoff across all delivery days in dataset (Dec 25 - Jan 31)
        h, m = self.parse_cutoff(cutoff_key)
        if not self.df_joined_hourly_default.empty and "delivery_date" in self.df_joined_hourly_default.columns:
            delivery_days = sorted(self.df_joined_hourly_default["delivery_date"].unique())
        else:
            delivery_days = [date(2026, 1, d) for d in range(1, 32)]
        decision_df = select_decision_forecasts(self.df_forecasts_raw, delivery_days, cutoff_hour=h, cutoff_minute=m)
        joined_df = join_forecasts_and_actuals(decision_df, self.df_actuals, mode=mode)
        
        self._cache[cache_key] = joined_df
        return joined_df

    def filter_date_range(
        self,
        df: pd.DataFrame,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> pd.DataFrame:
        """Filters DataFrame by delivery_date (inclusive)."""
        filtered = df.copy()
        if start_date:
            try:
                s_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
                filtered = filtered[filtered["delivery_date"] >= s_dt]
            except ValueError:
                raise ValueError(f"Invalid start_date '{start_date}'. Expected 'YYYY-MM-DD'.")
        if end_date:
            try:
                e_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
                filtered = filtered[filtered["delivery_date"] <= e_dt]
            except ValueError:
                raise ValueError(f"Invalid end_date '{end_date}'. Expected 'YYYY-MM-DD'.")
        return filtered

    def get_summary(
        self,
        cutoff_time: str = "09:00",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Calculates overarching KPIs for the specified cutoff and date window."""
        df = self.get_joined_dataset(cutoff_time=cutoff_time, mode="hourly")
        filtered = self.filter_date_range(df, start_date, end_date)

        # Expected hours count
        if not filtered.empty:
            min_d = filtered["delivery_date"].min()
            max_d = filtered["delivery_date"].max()
            days_count = (max_d - min_d).days + 1
            total_expected_hours = days_count * 24
        else:
            total_expected_hours = 0
            min_d = start_date or "2026-01-01"
            max_d = end_date or "2026-01-31"

        kpis = compute_kpi_summary(
            forecast=filtered["forecast_generation_mw"],
            actual=filtered["actual_generation_mw"],
            total_expected_intervals=total_expected_hours,
            interval_hours=1.0,
        )

        return {
            "cutoff_time": cutoff_time,
            "start_date": str(min_d),
            "end_date": str(max_d),
            "units": kpis["units"],
            "kpis": kpis
        }

    def get_days_list(
        self,
        cutoff_time: str = "09:00",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Calculates per-day performance summary including shortfall and surplus energy."""
        df = self.get_joined_dataset(cutoff_time=cutoff_time, mode="hourly")
        filtered = self.filter_date_range(df, start_date, end_date)

        days_list = []
        for d, group in filtered.groupby("delivery_date"):
            valid = group.dropna(subset=["forecast_generation_mw", "actual_generation_mw"])
            valid_n = len(valid)
            total_expected = 24  # 24 hourly periods per day

            f = valid["forecast_generation_mw"]
            a = valid["actual_generation_mw"]

            mean_a = float(a.mean()) if valid_n > 0 else None
            mean_f = float(f.mean()) if valid_n > 0 else None
            bias = float((f - a).mean()) if valid_n > 0 else None
            mae = float((f - a).abs().mean()) if valid_n > 0 else None
            rmse = float(np.sqrt(((f - a) ** 2).mean())) if valid_n > 0 else None
            nmae = float(mae / mean_a) if (mean_a and mean_a > 0 and mae is not None) else None
            over_rate = float((f > a).mean()) if valid_n > 0 else None

            shortfall_mwh = calculate_shortfall_energy_mwh(f, a, interval_hours=1.0)
            surplus_mwh = calculate_surplus_energy_mwh(f, a, interval_hours=1.0)

            days_list.append({
                "delivery_date": str(d),
                "cutoff_time": cutoff_time,
                "mean_actual_mw": round(mean_a, 2) if mean_a is not None else None,
                "mean_forecast_mw": round(mean_f, 2) if mean_f is not None else None,
                "bias_mw": round(bias, 2) if bias is not None else None,
                "mae_mw": round(mae, 2) if mae is not None else None,
                "rmse_mw": round(rmse, 2) if rmse is not None else None,
                "nmae_pct": round(nmae * 100.0, 2) if nmae is not None else None,
                "overforecast_rate_pct": round(over_rate * 100.0, 2) if over_rate is not None else None,
                "shortfall_energy_mwh": round(shortfall_mwh, 2) if shortfall_mwh is not None else None,
                "surplus_energy_mwh": round(surplus_mwh, 2) if surplus_mwh is not None else None,
                "coverage_pct": round((valid_n / total_expected) * 100.0, 2),
                "total_intervals": total_expected,
                "valid_intervals": valid_n,
                "missing_intervals": total_expected - valid_n,
            })

        days_list.sort(key=lambda x: x["delivery_date"])
        return days_list

    def get_day_detail(
        self,
        date_str: str,
        cutoff_time: str = "09:00",
        resolution: str = "half_hourly",
    ) -> Dict[str, Any]:
        """Returns interval-level granularity for a specific delivery day."""
        mode = "half_hourly" if resolution == "half_hourly" else "hourly"
        df = self.get_joined_dataset(cutoff_time=cutoff_time, mode=mode)
        
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError(f"Invalid date format '{date_str}'. Expected 'YYYY-MM-DD'.")

        day_df = df[df["delivery_date"] == target_date].sort_values("start_time").reset_index(drop=True)
        if day_df.empty:
            raise ValueError(f"No data available for delivery day '{date_str}'. Range is January 2026.")

        expected_count = 48 if mode == "half_hourly" else 24
        interval_h = 0.5 if mode == "half_hourly" else 1.0
        day_kpis = compute_kpi_summary(
            forecast=day_df["forecast_generation_mw"],
            actual=day_df["actual_generation_mw"],
            total_expected_intervals=expected_count,
            interval_hours=interval_h,
        )

        intervals = []
        for _, row in day_df.iterrows():
            f_val = None if pd.isna(row.get("forecast_generation_mw")) else float(row["forecast_generation_mw"])
            a_val = None if pd.isna(row.get("actual_generation_mw")) else float(row["actual_generation_mw"])
            e_val = None if pd.isna(row.get("error_mw")) else float(row["error_mw"])
            abs_e_val = None if pd.isna(row.get("abs_error_mw")) else float(row["abs_error_mw"])
            pct_e_val = None if pd.isna(row.get("pct_error")) else float(row["pct_error"])

            has_a = a_val is not None
            has_f = f_val is not None
            is_miss = (not has_a) or (not has_f)

            pub_str = None
            if "forecast_publish_time" in row and pd.notna(row["forecast_publish_time"]):
                pub_str = pd.Timestamp(row["forecast_publish_time"]).isoformat()
            elif "publish_time" in row and pd.notna(row["publish_time"]):
                pub_str = pd.Timestamp(row["publish_time"]).isoformat()

            horiz = float(row["horizon_hours"]) if ("horizon_hours" in row and pd.notna(row["horizon_hours"])) else None
            sp = int(row["settlement_period"]) if ("settlement_period" in row and pd.notna(row["settlement_period"])) else None

            intervals.append({
                "start_time": pd.Timestamp(row["start_time"]).isoformat(),
                "settlement_period": sp,
                "forecast_generation_mw": f_val,
                "actual_generation_mw": a_val,
                "error_mw": e_val,
                "abs_error_mw": abs_e_val,
                "pct_error": round(pct_e_val, 2) if pct_e_val is not None else None,
                "forecast_publish_time": pub_str,
                "horizon_hours": round(horiz, 1) if horiz is not None else None,
                "has_actual": has_a,
                "has_forecast": has_f,
                "is_missing": is_miss
            })

        return {
            "delivery_date": date_str,
            "cutoff_time": cutoff_time,
            "resolution": mode,
            "units": day_kpis["units"],
            "day_kpis": day_kpis,
            "intervals": intervals
        }

    def get_accuracy_breakdowns(
        self,
        cutoff_time: str = "09:00",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Computes multi-dimensional accuracy breakdowns."""
        df = self.get_joined_dataset(cutoff_time=cutoff_time, mode="hourly")
        filtered = self.filter_date_range(df, start_date, end_date)
        valid = filtered.dropna(subset=["forecast_generation_mw", "actual_generation_mw"]).copy()

        # 1. By Day
        by_day = self.get_days_list(cutoff_time, start_date, end_date)

        # 2. By Hour of Day (0-23)
        valid["hour_of_day"] = valid["start_time"].dt.hour
        by_hour = []
        for h in range(24):
            sub = valid[valid["hour_of_day"] == h]
            if len(sub) > 0:
                f, a = sub["forecast_generation_mw"], sub["actual_generation_mw"]
                mean_a = float(a.mean())
                mean_f = float(f.mean())
                bias = float((f - a).mean())
                mae = float((f - a).abs().mean())
                rmse = float(np.sqrt(((f - a) ** 2).mean()))
                nmae = float(mae / mean_a) if mean_a > 0 else None
                by_hour.append({
                    "hour": h,
                    "label": f"{h:02d}:00",
                    "sample_count": len(sub),
                    "mean_actual_mw": round(mean_a, 2),
                    "mean_forecast_mw": round(mean_f, 2),
                    "bias_mw": round(bias, 2),
                    "mae_mw": round(mae, 2),
                    "rmse_mw": round(rmse, 2),
                    "nmae_pct": round(nmae * 100.0, 2) if nmae is not None else None,
                })
            else:
                by_hour.append({
                    "hour": h,
                    "label": f"{h:02d}:00",
                    "sample_count": 0,
                    "mean_actual_mw": None,
                    "mean_forecast_mw": None,
                    "bias_mw": None,
                    "mae_mw": None,
                    "rmse_mw": None,
                    "nmae_pct": None,
                })

        # 3. By Horizon Bucket
        buckets = [
            ("16h - 20h", 16.0, 20.0),
            ("21h - 25h", 21.0, 25.0),
            ("26h - 30h", 26.0, 30.0),
            ("31h - 35h", 31.0, 35.0),
            ("36h - 40h", 36.0, 40.0),
        ]
        by_horizon = []
        for label, h_min, h_max in buckets:
            sub = valid[(valid["horizon_hours"] >= h_min) & (valid["horizon_hours"] <= h_max)]
            if len(sub) > 0:
                f, a = sub["forecast_generation_mw"], sub["actual_generation_mw"]
                mean_a = float(a.mean())
                mean_f = float(f.mean())
                bias = float((f - a).mean())
                mae = float((f - a).abs().mean())
                rmse = float(np.sqrt(((f - a) ** 2).mean()))
                by_horizon.append({
                    "bucket": label,
                    "min_horizon_hours": h_min,
                    "max_horizon_hours": h_max,
                    "sample_count": len(sub),
                    "mean_actual_mw": round(mean_a, 2),
                    "mean_forecast_mw": round(mean_f, 2),
                    "bias_mw": round(bias, 2),
                    "mae_mw": round(mae, 2),
                    "rmse_mw": round(rmse, 2),
                })
            else:
                by_horizon.append({
                    "bucket": label,
                    "min_horizon_hours": h_min,
                    "max_horizon_hours": h_max,
                    "sample_count": 0,
                    "mean_actual_mw": None,
                    "mean_forecast_mw": None,
                    "bias_mw": None,
                    "mae_mw": None,
                    "rmse_mw": None,
                })

        # 4. By Wind Generation Level
        levels = [
            ("Low Wind", "< 8,000 MW", 0.0, 8000.0),
            ("Medium Wind", "8,000 MW – 14,000 MW", 8000.0, 14000.0),
            ("High Wind", "> 14,000 MW", 14000.0, 50000.0),
        ]
        by_wind_level = []
        for level_name, desc, min_w, max_w in levels:
            sub = valid[(valid["actual_generation_mw"] >= min_w) & (valid["actual_generation_mw"] < max_w)]
            if len(sub) > 0:
                f, a = sub["forecast_generation_mw"], sub["actual_generation_mw"]
                mean_a = float(a.mean())
                mean_f = float(f.mean())
                bias = float((f - a).mean())
                mae = float((f - a).abs().mean())
                nmae = float(mae / mean_a) if mean_a > 0 else None
                by_wind_level.append({
                    "level": level_name,
                    "description": desc,
                    "min_mw": min_w,
                    "max_mw": max_w,
                    "sample_count": len(sub),
                    "mean_actual_mw": round(mean_a, 2),
                    "mean_forecast_mw": round(mean_f, 2),
                    "bias_mw": round(bias, 2),
                    "mae_mw": round(mae, 2),
                    "nmae_pct": round(nmae * 100.0, 2) if nmae is not None else None,
                })
            else:
                by_wind_level.append({
                    "level": level_name,
                    "description": desc,
                    "min_mw": min_w,
                    "max_mw": max_w,
                    "sample_count": 0,
                    "mean_actual_mw": None,
                    "mean_forecast_mw": None,
                    "bias_mw": None,
                    "mae_mw": None,
                    "nmae_pct": None,
                })

        s_d = str(filtered["delivery_date"].min()) if not filtered.empty else (start_date or "2026-01-01")
        e_d = str(filtered["delivery_date"].max()) if not filtered.empty else (end_date or "2026-01-31")

        box_stats = calculate_boxplot_statistics(valid["error_mw"]) if not valid.empty else None

        return {
            "cutoff_time": cutoff_time,
            "start_date": s_d,
            "end_date": e_d,
            "units": {
                "generation": "MW",
                "error": "MW",
                "rates": "percentage",
                "energy": "MWh"
            },
            "by_day": by_day,
            "by_hour_of_day": by_hour,
            "by_horizon_bucket": by_horizon,
            "by_wind_level": by_wind_level,
            "box_plot": box_stats,
        }

    def get_forecast_revisions(
        self,
        target_time: str,
        cutoff_time: str = "09:00",
    ) -> Dict[str, Any]:
        """
        Retrieves the complete historical revision trajectory for a given target interval.
        Shows how the forecast evolved across successive publication runs, marking which
        revision was locked in at the D-1 decision cutoff.
        """
        try:
            target_dt = pd.Timestamp(target_time)
            if target_dt.tz is None:
                target_dt = target_dt.tz_localize("UTC")
            else:
                target_dt = target_dt.tz_convert("UTC")
        except Exception:
            raise ValueError(f"Invalid target_time '{target_time}'. Must be ISO-8601 UTC timestamp.")

        delivery_date = target_dt.date()
        cutoff_h, cutoff_m = self.parse_cutoff(cutoff_time)

        # Cutoff is D-1 at cutoff_h:cutoff_m UTC
        d_prev = delivery_date - timedelta(days=1)
        cutoff_dt = pd.Timestamp(
            year=d_prev.year,
            month=d_prev.month,
            day=d_prev.day,
            hour=cutoff_h,
            minute=cutoff_m,
            tz="UTC"
        )

        # Filter all forecasts in raw dataset targeting this exact start_time
        # Round target_dt to hour if WINDFOR is hourly
        target_hour = target_dt.floor("1h")
        subset = self.df_forecasts_raw[self.df_forecasts_raw["start_time"] == target_hour].copy()
        if subset.empty:
            raise ValueError(f"No forecast revisions found for target time '{target_time}'.")

        subset = subset.sort_values("publish_time").reset_index(drop=True)

        # Find the decision-time forecast: latest publish_time <= cutoff_dt
        eligible = subset[subset["publish_time"] <= cutoff_dt]
        decision_publish_dt = eligible["publish_time"].max() if not eligible.empty else None

        # Fetch actual outturn for this target time
        # Check if actual exists for target_dt or target_hour
        act_subset = self.df_actuals[self.df_actuals["start_time"].dt.floor("1h") == target_hour]
        actual_val = float(act_subset["actual_generation_mw"].mean()) if not act_subset.empty else None

        revisions = []
        decision_forecast_mw = None

        for _, row in subset.iterrows():
            pub_dt = row["publish_time"]
            f_gen = float(row["forecast_generation_mw"])
            is_elig = pub_dt <= cutoff_dt
            is_dec = (decision_publish_dt is not None and pub_dt == decision_publish_dt)

            if is_dec:
                decision_forecast_mw = f_gen

            horiz = (target_hour - pub_dt).total_seconds() / 3600.0
            err_vs_act = (f_gen - actual_val) if actual_val is not None else None

            revisions.append({
                "publish_time": pub_dt.isoformat(),
                "forecast_generation_mw": f_gen,
                "horizon_hours": round(horiz, 1),
                "is_eligible": is_elig,
                "is_decision_forecast": is_dec,
                "error_vs_actual_mw": round(err_vs_act, 1) if err_vs_act is not None else None,
            })

        return {
            "target_time": target_hour.isoformat(),
            "delivery_date": str(delivery_date),
            "cutoff_time": cutoff_time,
            "cutoff_datetime": cutoff_dt.isoformat(),
            "actual_generation_mw": round(actual_val, 1) if actual_val is not None else None,
            "decision_publish_time": decision_publish_dt.isoformat() if decision_publish_dt is not None else None,
            "decision_forecast_mw": decision_forecast_mw,
            "total_revisions": len(revisions),
            "revisions": revisions,
        }

    def get_worst_intervals(
        self,
        cutoff_time: str = "09:00",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        top_n: int = 5,
    ) -> Dict[str, Any]:
        """
        Ranks top N largest overforecast intervals (greatest deficit requiring backup thermal power)
        and top N largest underforecast intervals (greatest surplus spilled or sold at imbalance).
        """
        df = self.get_joined_dataset(cutoff_time=cutoff_time, mode="hourly")
        filtered = self.filter_date_range(df, start_date, end_date)
        valid = filtered.dropna(subset=["error_mw", "forecast_generation_mw", "actual_generation_mw"]).copy()

        if valid.empty:
            return {
                "cutoff_time": cutoff_time,
                "start_date": start_date or "2026-01-01",
                "end_date": end_date or "2026-01-31",
                "units": {"generation": "MW", "error": "MW"},
                "worst_overforecasts": [],
                "worst_underforecasts": [],
            }

        # 1. Worst Overforecasts: Highest positive error_mw (Forecast >> Actual)
        top_over = valid.sort_values("error_mw", ascending=False).head(top_n)
        over_list = []
        for _, row in top_over.iterrows():
            pub_str = pd.Timestamp(row["forecast_publish_time"]).isoformat() if pd.notna(row.get("forecast_publish_time")) else ""
            over_list.append({
                "start_time": pd.Timestamp(row["start_time"]).isoformat(),
                "delivery_date": str(row["delivery_date"]),
                "settlement_period": int(row["settlement_period"]) if pd.notna(row.get("settlement_period")) else None,
                "forecast_generation_mw": round(float(row["forecast_generation_mw"]), 1),
                "actual_generation_mw": round(float(row["actual_generation_mw"]), 1),
                "error_mw": round(float(row["error_mw"]), 1),
                "abs_error_mw": round(float(row["abs_error_mw"]), 1),
                "pct_error": round(float(row["pct_error"]), 1) if pd.notna(row.get("pct_error")) else None,
                "forecast_publish_time": pub_str,
                "horizon_hours": round(float(row["horizon_hours"]), 1) if pd.notna(row.get("horizon_hours")) else 0.0,
            })

        # 2. Worst Underforecasts: Lowest negative error_mw (Actual >> Forecast)
        top_under = valid.sort_values("error_mw", ascending=True).head(top_n)
        under_list = []
        for _, row in top_under.iterrows():
            pub_str = pd.Timestamp(row["forecast_publish_time"]).isoformat() if pd.notna(row.get("forecast_publish_time")) else ""
            under_list.append({
                "start_time": pd.Timestamp(row["start_time"]).isoformat(),
                "delivery_date": str(row["delivery_date"]),
                "settlement_period": int(row["settlement_period"]) if pd.notna(row.get("settlement_period")) else None,
                "forecast_generation_mw": round(float(row["forecast_generation_mw"]), 1),
                "actual_generation_mw": round(float(row["actual_generation_mw"]), 1),
                "error_mw": round(float(row["error_mw"]), 1),
                "abs_error_mw": round(float(row["abs_error_mw"]), 1),
                "pct_error": round(float(row["pct_error"]), 1) if pd.notna(row.get("pct_error")) else None,
                "forecast_publish_time": pub_str,
                "horizon_hours": round(float(row["horizon_hours"]), 1) if pd.notna(row.get("horizon_hours")) else 0.0,
            })

        s_d = str(filtered["delivery_date"].min()) if not filtered.empty else (start_date or "2026-01-01")
        e_d = str(filtered["delivery_date"].max()) if not filtered.empty else (end_date or "2026-01-31")

        return {
            "cutoff_time": cutoff_time,
            "start_date": s_d,
            "end_date": e_d,
            "units": {
                "generation": "MW",
                "error": "MW",
                "rates": "percentage",
                "energy": "MWh"
            },
            "worst_overforecasts": over_list,
            "worst_underforecasts": under_list,
        }

    def get_buy_range(
        self,
        date_str: str,
        demand_mw: Optional[float] = None,
        cutoff_time: str = "09:00",
    ) -> Dict[str, Any]:
        """
        Calculates recommended procurement buy range (low / central / high) per half-hour for delivery day D.
        Enforces strict NO LOOK-AHEAD:
        - Quantiles derive only from days BEFORE D (prior_days basis).
        - If fewer than 7 prior days exist in history, falls back to full-period in-sample errors.
        - Clamps all procurement needs at >= 0 MW.
        - Missing forecasts remain null, never zero.
        """
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError(f"Invalid date format '{date_str}'. Expected 'YYYY-MM-DD'.")

        df_hh = self.get_joined_dataset(cutoff_time=cutoff_time, mode="half_hourly")
        day_df = df_hh[df_hh["delivery_date"] == target_date].sort_values("start_time").reset_index(drop=True)
        if day_df.empty:
            raise ValueError(f"No forecast data available for delivery day '{date_str}'. Range is January 2026.")

        # Determine error distribution: strictly days BEFORE target_date (No look-ahead)
        prior_df = df_hh[df_hh["delivery_date"] < target_date]
        prior_valid = prior_df.dropna(subset=["forecast_generation_mw", "actual_generation_mw", "error_mw"])
        prior_days_set = prior_valid["delivery_date"].unique()
        prior_days_count = len(prior_days_set)

        if prior_days_count >= 7:
            basis = "prior_days"
            hist_errors = prior_valid["error_mw"].values
            note = f"Based on {prior_days_count} days of January 2026 history prior to {date_str}. Historical range, not a guarantee."
        else:
            basis = "in_sample"
            full_valid = df_hh.dropna(subset=["forecast_generation_mw", "actual_generation_mw", "error_mw"])
            hist_errors = full_valid["error_mw"].values
            note = f"In-sample estimate based on all 31 days of January 2026 (fewer than 7 prior days available before {date_str}). Historical range, not a guarantee."

        p10_error = float(np.percentile(hist_errors, 10))
        p50_error = float(np.percentile(hist_errors, 50))
        p90_error = float(np.percentile(hist_errors, 90))

        forecast_vals = [
            None if pd.isna(r["forecast_generation_mw"]) else float(r["forecast_generation_mw"])
            for _, r in day_df.iterrows()
        ]

        intervals_calc, totals = calculate_buy_range_for_intervals(
            forecast_values=forecast_vals,
            demand_mw=demand_mw,
            p10_error=p10_error,
            p50_error=p50_error,
            p90_error=p90_error,
            interval_hours=0.5,
        )

        intervals_output = []
        for (_, row), calc_item in zip(day_df.iterrows(), intervals_calc):
            sp = int(row["settlement_period"]) if pd.notna(row.get("settlement_period")) else None
            intervals_output.append({
                "start_time": pd.Timestamp(row["start_time"]).isoformat(),
                "settlement_period": sp,
                "forecast_mw": calc_item["forecast_mw"],
                "forecast_generation_mw": calc_item["forecast_mw"],
                "base_need_mw": calc_item["base_need_mw"],
                "low_need_mw": calc_item["low_need_mw"],
                "central_need_mw": calc_item["central_need_mw"],
                "high_need_mw": calc_item["high_need_mw"],
            })

        # Calculate actual day shortfall energy if actuals exist
        valid_day = day_df.dropna(subset=["forecast_generation_mw", "actual_generation_mw"])
        shortfall_mwh = (
            calculate_shortfall_energy_mwh(valid_day["forecast_generation_mw"], valid_day["actual_generation_mw"], interval_hours=0.5)
            if not valid_day.empty else None
        )

        return {
            "delivery_date": date_str,
            "cutoff_time": cutoff_time,
            "demand_mw": demand_mw,
            "basis": basis,
            "prior_days_count": prior_days_count,
            "note": note,
            "units": {
                "generation": "MW",
                "error": "MW",
                "rates": "percentage",
                "energy": "MWh",
                "buffer": "MW",
            },
            "quantiles": {
                "p10_error_mw": round(p10_error, 2),
                "p50_error_mw": round(p50_error, 2),
                "p90_error_mw": round(p90_error, 2),
            },
            "shortfall_energy_mwh": round(shortfall_mwh, 2) if shortfall_mwh is not None else None,
            "totals": totals,
            "intervals": intervals_output,
        }

    def get_day_ahead_schedule(
        self,
        date_str: str,
        cutoff_time: str = "09:00",
        coverage: float = 0.80,
        threshold_mw: Optional[float] = None,
        include_actual: bool = False,
        lookback_days: int = 28,
    ) -> Dict[str, Any]:
        """
        Computes day-ahead forecast schedule and empirical error quantile uncertainty bands
        for delivery day D strictly using historical decision-time errors from prior days.
        """
        cutoff_clean = self.parse_cutoff(cutoff_time)
        cutoff_key = f"{cutoff_clean[0]:02d}:{cutoff_clean[1]:02d}"
        df = self.get_joined_dataset(cutoff_time=cutoff_key, mode="half_hourly")

        try:
            target_date = datetime.strptime(date_str.strip(), "%Y-%m-%d").date()
        except ValueError:
            raise ValueError(f"Invalid date format '{date_str}'. Expected 'YYYY-MM-DD'.")

        day_df = df[df["delivery_date"] == target_date].sort_values("start_time").reset_index(drop=True)
        if day_df.empty:
            raise ValueError(f"No data available for delivery day '{date_str}'. Range is January 2026.")

        error_history = build_error_history(df, delivery_date=target_date, lookback_days=lookback_days)

        schedule = compute_day_ahead_schedule(
            day_df=day_df,
            error_history=error_history,
            cutoff_utc=cutoff_key,
            coverage=coverage,
            threshold_mw=threshold_mw,
            lookback_days=lookback_days,
            include_actual=include_actual,
        )
        return schedule

    def get_day_ahead_validation(
        self,
        cutoff_time: str = "09:00",
        coverage: float = 0.80,
        lookback_days: int = 28,
        threshold_mw: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Walk-forward backtest over all January delivery days measuring empirical band coverage.
        """
        cutoff_clean = self.parse_cutoff(cutoff_time)
        cutoff_key = f"{cutoff_clean[0]:02d}:{cutoff_clean[1]:02d}"
        df = self.get_joined_dataset(cutoff_time=cutoff_key, mode="half_hourly")

        return run_walk_forward_backtest(
            df_joined=df,
            coverage=coverage,
            lookback_days=lookback_days,
            threshold_mw=threshold_mw,
        )


# Global store instance
data_store = DataStore()
