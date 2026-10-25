"""
backend/app/pipeline/selection.py
Pure function for selecting historical decision-time forecasts without look-ahead bias.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, List, Optional, Tuple, Union
import pandas as pd
import numpy as np


def select_decision_forecasts(
    forecasts_df: pd.DataFrame,
    delivery_days: Iterable[Union[date, str, pd.Timestamp]],
    cutoff_hour: int = 9,
    cutoff_minute: int = 0,
) -> pd.DataFrame:
    """
    Selects the decision-time wind generation forecast for each delivery day interval.

    Rule:
    For target start_time on delivery day D, the eligible forecasts are those with:
        publish_time <= cutoff on D-1 (at cutoff_hour:cutoff_minute UTC).
    The decision-time forecast is the eligible forecast with the latest publish_time.

    This is a PURE function:
    - Zero network or disk I/O.
    - Does not mutate input parameters.
    - Returns exactly one row per eligible target start_time.
    """
    if forecasts_df.empty:
        return pd.DataFrame(columns=[
            "delivery_date", "start_time", "cutoff_time", "forecast_publish_time", "forecast_generation_mw", "horizon_hours"
        ])

    # Convert delivery_days to a sorted list of unique datetime.date objects
    parsed_days: List[date] = []
    for d in delivery_days:
        if isinstance(d, str):
            parsed_days.append(datetime.strptime(d, "%Y-%m-%d").date())
        elif isinstance(d, pd.Timestamp):
            parsed_days.append(d.date())
        elif isinstance(d, datetime):
            parsed_days.append(d.date())
        elif isinstance(d, date):
            parsed_days.append(d)
        else:
            raise TypeError(f"Unsupported date type in delivery_days: {type(d)}")
    parsed_days = sorted(set(parsed_days))

    # Ensure forecasts_df timestamps are timezone-aware UTC
    df = forecasts_df.copy()
    if df["start_time"].dt.tz is None:
        df["start_time"] = df["start_time"].dt.tz_localize("UTC")
    else:
        df["start_time"] = df["start_time"].dt.tz_convert("UTC")

    if df["publish_time"].dt.tz is None:
        df["publish_time"] = df["publish_time"].dt.tz_localize("UTC")
    else:
        df["publish_time"] = df["publish_time"].dt.tz_convert("UTC")

    # Add helper column for target date (UTC calendar date)
    df["target_date"] = df["start_time"].dt.date

    selected_rows = []

    for d in parsed_days:
        # Cutoff is D-1 at cutoff_hour:cutoff_minute UTC
        d_prev = d - timedelta(days=1)
        cutoff_dt = pd.Timestamp(
            year=d_prev.year,
            month=d_prev.month,
            day=d_prev.day,
            hour=cutoff_hour,
            minute=cutoff_minute,
            tz="UTC"
        )

        # Filter forecasts targeting delivery day D published strictly on or before cutoff_dt
        mask = (df["target_date"] == d) & (df["publish_time"] <= cutoff_dt)
        eligible = df[mask]

        if eligible.empty:
            continue

        # For each target start_time, take the forecast with the latest publish_time
        # Sort by start_time ascending, publish_time ascending, then pick last
        best = eligible.sort_values(["start_time", "publish_time"]).groupby("start_time", as_index=False).last()

        best["delivery_date"] = d
        best["cutoff_time"] = cutoff_dt
        selected_rows.append(best)

    if not selected_rows:
        return pd.DataFrame(columns=[
            "delivery_date", "start_time", "cutoff_time", "forecast_publish_time", "forecast_generation_mw", "horizon_hours"
        ])

    result = pd.concat(selected_rows, ignore_index=True)

    # Rename and compute horizon
    result = result.rename(columns={"publish_time": "forecast_publish_time"})
    result["horizon_hours"] = (result["start_time"] - result["forecast_publish_time"]).dt.total_seconds() / 3600.0

    output_cols = [
        "delivery_date",
        "start_time",
        "cutoff_time",
        "forecast_publish_time",
        "forecast_generation_mw",
        "horizon_hours",
    ]
    result = result[output_cols].sort_values("start_time").reset_index(drop=True)
    return result
