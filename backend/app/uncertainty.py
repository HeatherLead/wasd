"""
backend/app/uncertainty.py
Pure functions for empirical error quantile uncertainty estimation and walk-forward backtesting.

Core domain principles:
1. No machine learning: empirical error quantiles derived strictly from historical decision-time errors.
2. No look-ahead: for delivery day D, only intervals with target delivery date strictly before D are used.
3. Sign convention: error_mw = forecast_mw - actual_mw (positive = over-forecast, wind fell short).
   Plausible actual = forecast - error.
   Plausible range: actual_low = forecast - q_hi(error), actual_high = forecast - q_lo(error), clamped to >= 0 MW.
4. Stratification: by forecast horizon blocks with automatic fallback to pooled errors when sample size is low.
5. Pure functions: no I/O, no network, no database calls, fully deterministic.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import numpy as np
import pandas as pd


# Default horizon stratification blocks (in hours): 4 blocks of 6 hours
# covering the full observed range [16.5h, 39.5h] at 09:00 UTC cutoff.
# Format: (min_horizon_hours, max_horizon_hours, label)
DEFAULT_HORIZON_BLOCKS: List[Tuple[float, float, str]] = [
    (16.0, 22.0, "16-22h"),
    (22.0, 28.0, "22-28h"),
    (28.0, 34.0, "28-34h"),
    (34.0, 40.0, "34-40h"),
]

# Minimum number of samples required to use a stratified horizon block
# If below this count, fallback to pooled errors across all intervals is used.
DEFAULT_MIN_BLOCK_SAMPLES: int = 20

# Default lookback window in days (capped at 28 days)
DEFAULT_LOOKBACK_DAYS: int = 28


def parse_delivery_date(val: Union[date, str, pd.Timestamp, datetime]) -> date:
    """Helper to convert any date-like object to datetime.date."""
    if isinstance(val, str):
        return datetime.strptime(val.strip()[:10], "%Y-%m-%d").date()
    elif isinstance(val, pd.Timestamp):
        return val.date()
    elif isinstance(val, datetime):
        return val.date()
    elif isinstance(val, date):
        return val
    raise TypeError(f"Unsupported delivery date type: {type(val)}")


def build_error_history(
    df_history: pd.DataFrame,
    delivery_date: Union[date, str, pd.Timestamp, datetime],
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> pd.DataFrame:
    """
    Extracts historical decision-time error samples strictly prior to delivery_date.

    Guarantees:
    - Pure function: does not mutate df_history.
    - Zero look-ahead: target intervals on delivery_date or later are strictly excluded.
    - Lookback window: intervals strictly within [delivery_date - lookback_days, delivery_date - 1 day].
    - Missing values: rows with missing forecast or actual are excluded from error samples.

    Sign convention:
        error_mw = forecast_generation_mw - actual_generation_mw
        Positive error = over-forecast (wind fell short of forecast).
    """
    if df_history.empty:
        return pd.DataFrame(
            columns=[
                "delivery_date",
                "start_time",
                "horizon_hours",
                "forecast_generation_mw",
                "actual_generation_mw",
                "error_mw",
            ]
        )

    target_d = parse_delivery_date(delivery_date)
    min_d = target_d - timedelta(days=lookback_days)

    df = df_history.copy()
    if "delivery_date" not in df.columns:
        if "start_time" in df.columns:
            df["delivery_date"] = pd.to_datetime(df["start_time"], utc=True).dt.date
        else:
            raise KeyError("df_history must contain 'delivery_date' or 'start_time' column.")
    else:
        # Ensure date type
        if not isinstance(df["delivery_date"].iloc[0], date):
            df["delivery_date"] = pd.to_datetime(df["delivery_date"]).dt.date

    # Strictly prior days within lookback window
    mask = (df["delivery_date"] < target_d) & (df["delivery_date"] >= min_d)
    prior_df = df[mask].copy()

    if prior_df.empty:
        return pd.DataFrame(
            columns=[
                "delivery_date",
                "start_time",
                "horizon_hours",
                "forecast_generation_mw",
                "actual_generation_mw",
                "error_mw",
            ]
        )

    # Ensure error_mw is present and valid
    if "error_mw" not in prior_df.columns:
        if "forecast_generation_mw" in prior_df.columns and "actual_generation_mw" in prior_df.columns:
            prior_df["error_mw"] = prior_df["forecast_generation_mw"] - prior_df["actual_generation_mw"]
        else:
            raise KeyError("Missing required columns to compute error_mw.")

    # Drop missing values
    valid_mask = prior_df["error_mw"].notna()
    clean = prior_df[valid_mask].copy()

    cols = [
        "delivery_date",
        "start_time",
        "horizon_hours",
        "forecast_generation_mw",
        "actual_generation_mw",
        "error_mw",
    ]
    available_cols = [c for c in cols if c in clean.columns]
    return clean[available_cols].reset_index(drop=True)


def assign_horizon_block(
    horizon_hours: float,
    blocks: Optional[Sequence[Tuple[float, float, str]]] = None,
) -> str:
    """
    Maps a forecast horizon (hours) to its assigned horizon block label.
    If horizon is below the lowest block, returns the lowest block.
    If horizon is above the highest block, returns the highest block.
    """
    block_list = blocks if blocks is not None else DEFAULT_HORIZON_BLOCKS
    if not block_list:
        return "pooled"

    h = float(horizon_hours)
    # Check if below lowest
    if h < block_list[0][0]:
        return block_list[0][2]

    for min_h, max_h, label in block_list:
        if min_h <= h < max_h:
            return label

    # If h >= last max_h, assign to last block
    return block_list[-1][2]


def compute_empirical_error_quantiles(
    error_samples: Union[np.ndarray, pd.Series, Sequence[float]],
    coverage: float = 0.80,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Computes empirical error quantiles [q_lo, q_hi] for the given coverage level.

    For coverage C (e.g. 0.80):
        alpha = (1.0 - C) / 2.0  (e.g. 0.10 for 80% coverage -> 10th and 90th percentiles)
        q_lo = empirical quantile at alpha (10th percentile of error)
        q_hi = empirical quantile at (1.0 - alpha) (90th percentile of error)

    Uses linear interpolation between sample points (NumPy default).
    Returns (None, None) if sample is empty.
    """
    arr = np.asarray(error_samples, dtype=float)
    arr = arr[~np.isnan(arr)]
    if len(arr) == 0:
        return None, None

    if not (0.0 < coverage < 1.0):
        raise ValueError(f"Coverage must be between 0.0 and 1.0, got {coverage}")

    alpha = (1.0 - coverage) / 2.0
    q_lo_pct = alpha * 100.0
    q_hi_pct = (1.0 - alpha) * 100.0

    q_lo, q_hi = np.percentile(arr, [q_lo_pct, q_hi_pct])
    return float(q_lo), float(q_hi)


def compute_shortfall_probability(
    error_samples: Union[np.ndarray, pd.Series, Sequence[float]],
    threshold_mw: float,
) -> Tuple[Optional[float], int]:
    """
    Computes the empirical probability P(error > threshold_mw).
    Since error = forecast - actual, error > threshold means generation fell short of forecast by > threshold MW.

    Returns:
        (probability, sample_size). If sample_size == 0, returns (None, 0).
    """
    arr = np.asarray(error_samples, dtype=float)
    arr = arr[~np.isnan(arr)]
    n = len(arr)
    if n == 0:
        return None, 0

    count = int(np.sum(arr > threshold_mw))
    prob = count / float(n)
    return float(prob), n


def compute_interval_uncertainty(
    forecast_mw: Optional[float],
    horizon_hours: Optional[float],
    error_history: pd.DataFrame,
    coverage: float = 0.80,
    threshold_mw: float = 1000.0,
    min_block_samples: int = DEFAULT_MIN_BLOCK_SAMPLES,
    blocks: Optional[Sequence[Tuple[float, float, str]]] = None,
) -> Dict[str, Any]:
    """
    Computes empirical quantile bounds and shortfall probability for a single target interval.

    Stratification logic:
    - If horizon_hours is provided and error_history contains horizon_hours, filter to the interval's horizon block.
    - If block error sample size >= min_block_samples, use block errors (basis = "block").
    - If block error sample size < min_block_samples, fall back to pooled errors (basis = "pooled").
    - If error_history is empty, bounds and probabilities remain None (basis = "none", sample_size = 0).

    Bounds logic:
        actual_low = max(0.0, forecast_mw - q_hi(error))
        actual_high = max(0.0, forecast_mw - q_lo(error))
        Missing forecast stays null (never 0.0).
    """
    # Missing forecast stays null
    if forecast_mw is None or pd.isna(forecast_mw):
        return {
            "forecast_mw": None,
            "horizon_hours": horizon_hours,
            "actual_low_mw": None,
            "actual_high_mw": None,
            "q_lo_error_mw": None,
            "q_hi_error_mw": None,
            "p_shortfall_gt_threshold": None,
            "sample_size": 0,
            "basis": None,
            "block_label": None,
        }

    if error_history.empty or "error_mw" not in error_history.columns:
        return {
            "forecast_mw": float(forecast_mw),
            "horizon_hours": horizon_hours,
            "actual_low_mw": None,
            "actual_high_mw": None,
            "q_lo_error_mw": None,
            "q_hi_error_mw": None,
            "p_shortfall_gt_threshold": None,
            "sample_size": 0,
            "basis": "none",
            "block_label": None,
        }

    # Determine horizon block
    block_label = None
    sample_series: pd.Series
    basis: str

    if horizon_hours is not None and not pd.isna(horizon_hours) and "horizon_hours" in error_history.columns:
        block_label = assign_horizon_block(float(horizon_hours), blocks=blocks)
        # Filter error history to this block
        block_edges = dict((b[2], (b[0], b[1])) for b in (blocks or DEFAULT_HORIZON_BLOCKS))
        if block_label in block_edges:
            min_h, max_h = block_edges[block_label]
            is_last = block_label == (blocks or DEFAULT_HORIZON_BLOCKS)[-1][2]
            if is_last:
                block_mask = (error_history["horizon_hours"] >= min_h) & (error_history["horizon_hours"] <= max_h + 1.0)
            else:
                block_mask = (error_history["horizon_hours"] >= min_h) & (error_history["horizon_hours"] < max_h)
            block_samples = error_history.loc[block_mask, "error_mw"].dropna()
        else:
            block_samples = pd.Series(dtype=float)

        if len(block_samples) >= min_block_samples:
            sample_series = block_samples
            basis = "block"
        else:
            sample_series = error_history["error_mw"].dropna()
            basis = "pooled"
    else:
        sample_series = error_history["error_mw"].dropna()
        basis = "pooled"

    sample_size = len(sample_series)
    if sample_size == 0:
        return {
            "forecast_mw": float(forecast_mw),
            "horizon_hours": horizon_hours,
            "actual_low_mw": None,
            "actual_high_mw": None,
            "q_lo_error_mw": None,
            "q_hi_error_mw": None,
            "p_shortfall_gt_threshold": None,
            "sample_size": 0,
            "basis": "none",
            "block_label": block_label,
        }

    q_lo, q_hi = compute_empirical_error_quantiles(sample_series, coverage=coverage)
    p_shortfall, _ = compute_shortfall_probability(sample_series, threshold_mw=threshold_mw)

    if q_lo is not None and q_hi is not None:
        # Plausible actual range: forecast - error
        # High error (q_hi) -> wind fell short -> actual is lower (forecast - q_hi)
        # Low error (q_lo) -> wind blew more -> actual is higher (forecast - q_lo)
        actual_low = max(0.0, float(forecast_mw) - q_hi)
        actual_high = max(0.0, float(forecast_mw) - q_lo)
    else:
        actual_low, actual_high = None, None

    return {
        "forecast_mw": round(float(forecast_mw), 2),
        "horizon_hours": round(float(horizon_hours), 1) if horizon_hours is not None else None,
        "actual_low_mw": round(actual_low, 2) if actual_low is not None else None,
        "actual_high_mw": round(actual_high, 2) if actual_high is not None else None,
        "q_lo_error_mw": round(q_lo, 2) if q_lo is not None else None,
        "q_hi_error_mw": round(q_hi, 2) if q_hi is not None else None,
        "p_shortfall_gt_threshold": round(p_shortfall, 4) if p_shortfall is not None else None,
        "sample_size": sample_size,
        "basis": basis,
        "block_label": block_label,
    }


def compute_day_ahead_schedule(
    day_df: pd.DataFrame,
    error_history: pd.DataFrame,
    cutoff_utc: str = "09:00",
    coverage: float = 0.80,
    threshold_mw: Optional[float] = None,
    min_block_samples: int = DEFAULT_MIN_BLOCK_SAMPLES,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    include_actual: bool = False,
) -> Dict[str, Any]:
    """
    Computes complete day-ahead interval schedule, uncertainty bands, and risk summary for delivery day D.
    """
    if day_df.empty:
        raise ValueError("day_df cannot be empty.")

    # 1. Derive default threshold_mw from data if not provided (MAE of historical errors)
    if threshold_mw is None:
        if not error_history.empty and "error_mw" in error_history.columns:
            valid_err = error_history["error_mw"].dropna()
            derived_threshold = float(valid_err.abs().mean()) if len(valid_err) > 0 else 1000.0
        else:
            derived_threshold = 1000.0
        applied_threshold = round(derived_threshold, 1)
    else:
        applied_threshold = float(threshold_mw)

    # 2. Compute 90% coverage for severe downside calculation
    severe_coverage = 0.90

    intervals: List[Dict[str, Any]] = []
    severe_shortfall_mwh_total = 0.0
    p_shortfall_list: List[float] = []

    for _, row in day_df.sort_values("start_time").iterrows():
        f_val = None if pd.isna(row.get("forecast_generation_mw")) else float(row["forecast_generation_mw"])
        h_val = None if pd.isna(row.get("horizon_hours")) else float(row["horizon_hours"])
        st_val = row.get("start_time")
        st_str = pd.Timestamp(st_val).isoformat() if pd.notna(st_val) else None

        pub_val = row.get("forecast_publish_time") or row.get("publish_time")
        pub_str = pd.Timestamp(pub_val).isoformat() if pd.notna(pub_val) else None

        # Interval calculation for selected coverage (e.g. 80%)
        res = compute_interval_uncertainty(
            forecast_mw=f_val,
            horizon_hours=h_val,
            error_history=error_history,
            coverage=coverage,
            threshold_mw=applied_threshold,
            min_block_samples=min_block_samples,
        )

        # Interval calculation for severe downside (90% band lower bound)
        severe_res = compute_interval_uncertainty(
            forecast_mw=f_val,
            horizon_hours=h_val,
            error_history=error_history,
            coverage=severe_coverage,
            threshold_mw=applied_threshold,
            min_block_samples=min_block_samples,
        )

        interval_dict: Dict[str, Any] = {
            "start_time": st_str,
            "settlement_period": int(row["settlement_period"]) if "settlement_period" in row and pd.notna(row["settlement_period"]) else None,
            "forecast_mw": res["forecast_mw"],
            "publish_time": pub_str,
            "horizon_hours": res["horizon_hours"],
            "actual_low_mw": res["actual_low_mw"],
            "actual_high_mw": res["actual_high_mw"],
            "p_shortfall_gt_threshold": res["p_shortfall_gt_threshold"],
            "sample_size": res["sample_size"],
            "basis": res["basis"],
            "block_label": res["block_label"],
        }

        # Severe downside volume below forecast: max(0, forecast - actual_low_90)
        # Half-hour energy in MWh = MW * 0.5 hours
        if f_val is not None and severe_res["actual_low_mw"] is not None:
            deficit_mw = max(0.0, f_val - severe_res["actual_low_mw"])
            severe_shortfall_mwh_total += deficit_mw * 0.5

        if res["p_shortfall_gt_threshold"] is not None:
            p_shortfall_list.append(res["p_shortfall_gt_threshold"])

        # Include actual only if explicitly requested
        if include_actual:
            a_val = None if pd.isna(row.get("actual_generation_mw")) else float(row["actual_generation_mw"])
            interval_dict["actual_mw"] = round(a_val, 2) if a_val is not None else None
            if f_val is not None and a_val is not None:
                interval_dict["realized_error_mw"] = round(f_val - a_val, 2)
                interval_dict["is_within_band"] = bool(
                    res["actual_low_mw"] is not None
                    and res["actual_high_mw"] is not None
                    and res["actual_low_mw"] <= a_val <= res["actual_high_mw"]
                )
            else:
                interval_dict["realized_error_mw"] = None
                interval_dict["is_within_band"] = None

        intervals.append(interval_dict)

    # 3. Risk Summary Calculations
    # Expected bias from error history: mean historical error for these horizons
    if not error_history.empty and "error_mw" in error_history.columns:
        expected_bias_mw = round(float(error_history["error_mw"].dropna().mean()), 2)
    else:
        expected_bias_mw = None

    mean_p_shortfall = round(float(np.mean(p_shortfall_list)), 4) if p_shortfall_list else None
    max_p_shortfall = round(float(np.max(p_shortfall_list)), 4) if p_shortfall_list else None

    # Top 5 risk intervals ranked by p_shortfall descending
    valid_risk_intervals = [
        it for it in intervals if it["p_shortfall_gt_threshold"] is not None
    ]
    top_risk_intervals = sorted(
        valid_risk_intervals,
        key=lambda x: (x["p_shortfall_gt_threshold"], x.get("start_time") or ""),
        reverse=True,
    )[:5]

    # Status / metadata
    d_date_val = day_df["delivery_date"].iloc[0]
    delivery_date_str = str(parse_delivery_date(d_date_val))

    publish_times = [it["publish_time"] for it in intervals if it["publish_time"]]
    earliest_pub = min(publish_times) if publish_times else None
    latest_pub = max(publish_times) if publish_times else None

    prior_days_count = len(error_history["delivery_date"].unique()) if not error_history.empty else 0

    intervals_expected = 48
    intervals_available = len([it for it in intervals if it["forecast_mw"] is not None])
    missing_timestamps = [
        it["start_time"] for it in intervals if it["forecast_mw"] is None and it["start_time"]
    ]

    return {
        "status": {
            "delivery_date": delivery_date_str,
            "cutoff_utc": cutoff_utc,
            "forecast_publish_range": {
                "earliest": earliest_pub,
                "latest": latest_pub,
            },
            "snapshot_built_at": "2026-02-01T00:00:00Z",
            "intervals_expected": intervals_expected,
            "intervals_available": intervals_available,
            "missing_interval_timestamps": missing_timestamps,
            "is_complete": intervals_available == intervals_expected,
            "is_low_sample": prior_days_count < 7,
        },
        "risk_summary": {
            "expected_bias_mw": expected_bias_mw,
            "threshold_mw": applied_threshold,
            "mean_p_shortfall_gt_threshold": mean_p_shortfall,
            "max_p_shortfall_gt_threshold": max_p_shortfall,
            "severe_downside_mwh": round(severe_shortfall_mwh_total, 2),
            "severe_downside_coverage": severe_coverage,
            "top_risk_intervals": [
                {
                    "start_time": it["start_time"],
                    "settlement_period": it["settlement_period"],
                    "forecast_mw": it["forecast_mw"],
                    "p_shortfall_gt_threshold": it["p_shortfall_gt_threshold"],
                    "actual_low_mw": it["actual_low_mw"],
                    "horizon_hours": it["horizon_hours"],
                }
                for it in top_risk_intervals
            ],
        },
        "basis_metadata": {
            "method_name": "empirical error quantiles",
            "coverage": coverage,
            "prior_days_count": prior_days_count,
            "lookback_days": lookback_days,
            "min_block_samples": min_block_samples,
            "total_prior_error_samples": len(error_history),
        },
        "intervals": intervals,
    }


def run_walk_forward_backtest(
    df_joined: pd.DataFrame,
    coverage: float = 0.80,
    min_block_samples: int = DEFAULT_MIN_BLOCK_SAMPLES,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    threshold_mw: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Performs walk-forward validation across all delivery days with available history.

    For each delivery day D:
    1. Error samples are collected strictly from days before D.
    2. Quantile band [actual_low, actual_high] is estimated for each interval of day D.
    3. We check if the actual outturn fell within the band.
    4. Shortfall probability calibration is measured by grouping predicted probabilities into bins.
    """
    if df_joined.empty:
        return {
            "target_coverage": coverage,
            "overall_realised_coverage": None,
            "total_intervals_evaluated": 0,
            "total_days_evaluated": 0,
            "days": [],
            "calibration_table": [],
        }

    df = df_joined.copy()
    if "delivery_date" not in df.columns:
        df["delivery_date"] = pd.to_datetime(df["start_time"], utc=True).dt.date
    else:
        df["delivery_date"] = pd.to_datetime(df["delivery_date"]).dt.date

    # Unique sorted delivery dates
    all_dates = sorted(df["delivery_date"].unique())

    # We need at least 1 prior day to run backtest
    days_evaluated = []
    total_valid_intervals = 0
    total_in_band = 0

    # Calibration tracking: (predicted_p, binary_event)
    pred_events: List[Tuple[float, int]] = []

    # Derive global threshold if not given
    if threshold_mw is None:
        valid_err = df["error_mw"].dropna() if "error_mw" in df.columns else pd.Series(dtype=float)
        applied_threshold = float(valid_err.abs().mean()) if len(valid_err) > 0 else 1000.0
    else:
        applied_threshold = float(threshold_mw)

    for target_d in all_dates:
        # Build prior history strictly before target_d
        prior_history = build_error_history(df, delivery_date=target_d, lookback_days=lookback_days)
        if prior_history.empty:
            # Cannot evaluate day without prior samples
            continue

        day_intervals = df[df["delivery_date"] == target_d].sort_values("start_time")
        day_total = 0
        day_in_band = 0

        for _, row in day_intervals.iterrows():
            f_val = None if pd.isna(row.get("forecast_generation_mw")) else float(row["forecast_generation_mw"])
            a_val = None if pd.isna(row.get("actual_generation_mw")) else float(row["actual_generation_mw"])
            h_val = None if pd.isna(row.get("horizon_hours")) else float(row["horizon_hours"])

            if f_val is None or a_val is None:
                continue

            unc = compute_interval_uncertainty(
                forecast_mw=f_val,
                horizon_hours=h_val,
                error_history=prior_history,
                coverage=coverage,
                threshold_mw=applied_threshold,
                min_block_samples=min_block_samples,
            )

            low = unc["actual_low_mw"]
            high = unc["actual_high_mw"]
            if low is not None and high is not None:
                day_total += 1
                in_b = bool(low <= a_val <= high)
                if in_b:
                    day_in_band += 1

                # Calibration check for shortfall > applied_threshold
                pred_p = unc["p_shortfall_gt_threshold"]
                if pred_p is not None:
                    actual_shortfall = bool((f_val - a_val) > applied_threshold)
                    pred_events.append((pred_p, 1 if actual_shortfall else 0))

        if day_total > 0:
            cov = day_in_band / float(day_total)
            days_evaluated.append({
                "delivery_date": str(target_d),
                "intervals_evaluated": day_total,
                "intervals_in_band": day_in_band,
                "realised_coverage": round(cov, 4),
                "prior_days_used": len(prior_history["delivery_date"].unique()),
            })
            total_valid_intervals += day_total
            total_in_band += day_in_band

    overall_cov = (total_in_band / float(total_valid_intervals)) if total_valid_intervals > 0 else None

    # Calibration table across probability bins [0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0]
    calibration_table = []
    if pred_events:
        bins = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.0)]
        for b_lo, b_hi in bins:
            bin_items = [ev for p, ev in pred_events if (b_lo <= p < b_hi or (b_hi == 1.0 and p == 1.0))]
            count = len(bin_items)
            obs_rate = (sum(bin_items) / float(count)) if count > 0 else None
            calibration_table.append({
                "bin_range": f"{int(b_lo*100)}%-{int(b_hi*100)}%",
                "sample_count": count,
                "observed_frequency": round(obs_rate, 4) if obs_rate is not None else None,
            })

    return {
        "target_coverage": coverage,
        "overall_realised_coverage": round(overall_cov, 4) if overall_cov is not None else None,
        "total_intervals_evaluated": total_valid_intervals,
        "total_days_evaluated": len(days_evaluated),
        "threshold_mw": round(applied_threshold, 1),
        "days": days_evaluated,
        "calibration_table": calibration_table,
    }
