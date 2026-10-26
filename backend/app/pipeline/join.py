"""
backend/app/pipeline/join.py
Joins decision-time forecasts and actual outturn strictly on UTC startTime,
calculates directional errors, and provides missing-record detection.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Union
import pandas as pd
import numpy as np


def audit_quality_and_missing(
    actuals_df: pd.DataFrame,
    decision_forecasts_df: pd.DataFrame,
    start_dt: Union[datetime, str, pd.Timestamp] = "2026-01-01T00:00:00Z",
    end_dt: Union[datetime, str, pd.Timestamp] = "2026-01-31T23:30:00Z",
) -> Dict[str, Any]:
    """
    Audits every expected half-hour interval across the evaluation window.
    Flags missing actuals, missing forecasts, or intervals missing both.
    Never treats missing data as zero.
    """
    start = pd.Timestamp(start_dt)
    if start.tz is None:
        start = start.tz_localize("UTC")
    else:
        start = start.tz_convert("UTC")

    end = pd.Timestamp(end_dt)
    if end.tz is None:
        end = end.tz_localize("UTC")
    else:
        end = end.tz_convert("UTC")

    expected_half_hours = pd.date_range(start=start, end=end, freq="30min", tz="UTC")
    total_expected = len(expected_half_hours)

    # Actuals set
    actual_starts = set(actuals_df["start_time"].dt.tz_convert("UTC")) if not actuals_df.empty else set()

    # Forecast set: WINDFOR has hourly start_times. For each 30-min interval,
    # its parent hourly forecast interval is dt.floor('1h')
    forecast_starts = set(decision_forecasts_df["start_time"].dt.tz_convert("UTC")) if not decision_forecasts_df.empty else set()

    missing_actuals: List[str] = []
    missing_forecasts: List[str] = []
    missing_both: List[str] = []
    complete_count = 0

    interval_statuses = []

    for hh in expected_half_hours:
        has_actual = hh in actual_starts
        # Check if parent hour forecast exists
        parent_hour = hh.floor("1h")
        has_forecast = parent_hour in forecast_starts

        if has_actual and has_forecast:
            status = "OK"
            complete_count += 1
        elif not has_actual and not has_forecast:
            status = "MISSING_BOTH"
            missing_both.append(hh.isoformat())
        elif not has_actual:
            status = "MISSING_ACTUAL"
            missing_actuals.append(hh.isoformat())
        else:
            status = "MISSING_FORECAST"
            missing_forecasts.append(hh.isoformat())

        interval_statuses.append({
            "start_time": hh,
            "has_actual": has_actual,
            "has_forecast": has_forecast,
            "status": status
        })

    audit_summary = {
        "evaluation_window": {
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "total_expected_half_hours": total_expected,
            "total_expected_hours": total_expected // 2,
        },
        "counts": {
            "complete_intervals": complete_count,
            "missing_actual_count": len(missing_actuals),
            "missing_forecast_count": len(missing_forecasts),
            "missing_both_count": len(missing_both),
            "completeness_pct": round((complete_count / total_expected) * 100.0, 2) if total_expected > 0 else 0.0,
        },
        "missing_intervals": {
            "missing_actuals": missing_actuals,
            "missing_forecasts": missing_forecasts,
            "missing_both": missing_both,
        }
    }
    return audit_summary


def join_forecasts_and_actuals(
    decision_forecasts_df: pd.DataFrame,
    actuals_df: pd.DataFrame,
    mode: str = "hourly",
) -> pd.DataFrame:
    """
    Joins decision-time forecasts and actuals strictly on UTC start_time (never by position or index).
    
    Modes:
    - "hourly": (Default) Actuals aggregated to 1-hour average MW. Matches wholesale Day-Ahead contract blocks.
    - "half_hourly": Forecast step-function applied to both 30-min settlement periods of each hour.

    Error Definition:
    error_mw = forecast_generation_mw - actual_generation_mw
        Positive: Overforecast (deficit)
        Negative: Underforecast (surplus)
    Missing values strictly remain NaN / Null, never imputed as zero.
    """
    if mode == "hourly":
        return _join_hourly(decision_forecasts_df, actuals_df)
    elif mode == "half_hourly":
        return _join_half_hourly(decision_forecasts_df, actuals_df)
    else:
        raise ValueError(f"Unsupported join mode '{mode}'. Use 'hourly' or 'half_hourly'.")


def _join_hourly(forecasts_df: pd.DataFrame, actuals_df: pd.DataFrame) -> pd.DataFrame:
    # Ensure datetime timestamps
    if not forecasts_df.empty:
        f_df = forecasts_df.copy()
        f_df["start_time"] = pd.to_datetime(f_df["start_time"], utc=True)
    else:
        f_df = pd.DataFrame(columns=forecasts_df.columns)

    # 1. Aggregate actuals to hourly resolution
    if not actuals_df.empty:
        act = actuals_df.copy()
        act["start_time"] = pd.to_datetime(act["start_time"], utc=True)
        act["hour_start_time"] = act["start_time"].dt.floor("1h")

        agg_dict = {"actual_generation_mw": ("actual_generation_mw", "mean")}
        if "settlement_period" in act.columns:
            agg_dict["settlement_periods_count"] = ("settlement_period", "count")
        else:
            agg_dict["settlement_periods_count"] = ("actual_generation_mw", "count")

        hourly_actuals = act.groupby("hour_start_time", as_index=False).agg(**agg_dict).rename(columns={"hour_start_time": "start_time"})
    else:
        hourly_actuals = pd.DataFrame(columns=["start_time", "actual_generation_mw", "settlement_periods_count"])

    # 2. Join on start_time (UTC) strictly via SQL-style outer join to retain all intervals
    cols_to_drop = [c for c in ["delivery_date", "cutoff_time"] if c in hourly_actuals.columns and c in f_df.columns]
    if cols_to_drop:
        hourly_actuals = hourly_actuals.drop(columns=cols_to_drop)

    joined = pd.merge(
        f_df,
        hourly_actuals,
        on="start_time",
        how="outer"
    )

    # Sort strictly by UTC start_time
    joined["start_time"] = pd.to_datetime(joined["start_time"], utc=True)
    joined = joined.sort_values("start_time").reset_index(drop=True)
    joined["delivery_date"] = joined["start_time"].dt.date

    # 3. Compute directional error metrics (only where both forecast and actual exist)
    # If either is NaN, error remains NaN (never 0!)
    joined["error_mw"] = joined["forecast_generation_mw"] - joined["actual_generation_mw"]
    joined["abs_error_mw"] = joined["error_mw"].abs()
    
    # Percentage error relative to actual (where actual > 0)
    joined["pct_error"] = np.where(
        joined["actual_generation_mw"] > 0,
        (joined["error_mw"] / joined["actual_generation_mw"]) * 100.0,
        np.nan
    )

    # Add energy volume in MWh (for 1 hour block, Power MW * 1h = MWh)
    joined["forecast_energy_mwh"] = joined["forecast_generation_mw"] * 1.0
    joined["actual_energy_mwh"] = joined["actual_generation_mw"] * 1.0
    joined["imbalance_energy_mwh"] = joined["error_mw"] * 1.0

    return joined


def _join_half_hourly(forecasts_df: pd.DataFrame, actuals_df: pd.DataFrame) -> pd.DataFrame:
    # 1. Expand hourly forecasts into two half-hourly periods (:00 and :30)
    if not forecasts_df.empty:
        f_base = forecasts_df.copy()
        f_base["start_time"] = pd.to_datetime(f_base["start_time"], utc=True)

        # Period 1: at :00 (start_time unchanged)
        f_p1 = f_base.copy()

        # Period 2: at :30 (start_time + 30 min)
        f_p2 = f_base.copy()
        f_p2["start_time"] = f_p2["start_time"] + pd.Timedelta(minutes=30)

        forecasts_hh = pd.concat([f_p1, f_p2], ignore_index=True)
    else:
        forecasts_hh = pd.DataFrame(columns=forecasts_df.columns)

    # 2. Prepare actuals
    if not actuals_df.empty:
        act = actuals_df.copy()
        act["start_time"] = pd.to_datetime(act["start_time"], utc=True)
    else:
        act = pd.DataFrame(columns=actuals_df.columns if not actuals_df.empty else ["start_time", "actual_generation_mw"])

    # Avoid duplicate column conflicts
    cols_to_drop = [c for c in ["delivery_date", "cutoff_time"] if c in act.columns and c in forecasts_hh.columns]
    if cols_to_drop:
        act = act.drop(columns=cols_to_drop)

    joined = pd.merge(
        act,
        forecasts_hh,
        on="start_time",
        how="outer"
    )

    joined["start_time"] = pd.to_datetime(joined["start_time"], utc=True)
    joined = joined.sort_values("start_time").reset_index(drop=True)
    joined["delivery_date"] = joined["start_time"].dt.date

    # Ensure settlement_period exists and is populated (1 to 48 for GB half-hours)
    calc_sp = (joined["start_time"].dt.hour * 2 + (joined["start_time"].dt.minute // 30) + 1).astype("Int64")
    if "settlement_period" not in joined.columns:
        joined["settlement_period"] = calc_sp
    else:
        joined["settlement_period"] = joined["settlement_period"].fillna(calc_sp)

    if "settlement_date" in joined.columns:
        joined["settlement_date"] = joined["settlement_date"].fillna(joined["start_time"].dt.strftime("%Y-%m-%d"))

    if "fuel_type" in joined.columns:
        joined["fuel_type"] = joined["fuel_type"].fillna("WIND")

    # Directional errors
    joined["error_mw"] = joined["forecast_generation_mw"] - joined["actual_generation_mw"]
    joined["abs_error_mw"] = joined["error_mw"].abs()
    joined["pct_error"] = np.where(
        joined["actual_generation_mw"] > 0,
        (joined["error_mw"] / joined["actual_generation_mw"]) * 100.0,
        np.nan
    )

    # Energy volume for 0.5 hour block (Power MW * 0.5h = MWh)
    joined["forecast_energy_mwh"] = joined["forecast_generation_mw"] * 0.5
    joined["actual_energy_mwh"] = joined["actual_generation_mw"] * 0.5
    joined["imbalance_energy_mwh"] = joined["error_mw"] * 0.5

    return joined
