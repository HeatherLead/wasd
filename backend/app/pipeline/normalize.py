"""
backend/app/pipeline/normalize.py
Normalizes raw Elexon BMRS data into strictly typed, deduplicated, UTC DataFrames.
"""

from __future__ import annotations

from typing import Any, Dict, List, Union
import pandas as pd
import numpy as np


def normalize_actuals(raw_data: Union[List[Dict[str, Any]], pd.DataFrame]) -> pd.DataFrame:
    """
    Normalizes FUELHH actual outturn data:
    - Filters strictly to fuelType == 'WIND'
    - Parses timestamps to timezone-aware UTC datetime64[ns, UTC]
    - Casts numeric generation to float with explicit unit (MW)
    - Deduplicates on start_time, keeping the latest published entry if duplicates exist
    - Sorts chronologically by start_time
    """
    if isinstance(raw_data, list):
        if not raw_data:
            return pd.DataFrame(columns=[
                "start_time", "publish_time", "settlement_date", "settlement_period", "fuel_type", "actual_generation_mw"
            ])
        df = pd.DataFrame(raw_data)
    else:
        df = raw_data.copy()

    if df.empty:
        return pd.DataFrame(columns=[
            "start_time", "publish_time", "settlement_date", "settlement_period", "fuel_type", "actual_generation_mw"
        ])

    # 1. Filter to fuelType == "WIND"
    if "fuelType" in df.columns:
        df = df[df["fuelType"] == "WIND"].copy()
    elif "fuel_type" in df.columns:
        df = df[df["fuel_type"] == "WIND"].copy()
    else:
        raise ValueError("Missing 'fuelType' column in FUELHH actuals data.")

    # 2. Parse timestamps to UTC
    start_col = "startTime" if "startTime" in df.columns else "start_time"
    pub_col = "publishTime" if "publishTime" in df.columns else "publish_time"
    
    df["start_time"] = pd.to_datetime(df[start_col], utc=True)
    df["publish_time"] = pd.to_datetime(df[pub_col], utc=True)

    # 3. Standardize and cast fields
    gen_col = "generation" if "generation" in df.columns else ("actual_generation_mw" if "actual_generation_mw" in df.columns else None)
    if gen_col is None:
        raise ValueError("Missing generation column in FUELHH data.")
    
    df["actual_generation_mw"] = pd.to_numeric(df[gen_col], errors="coerce").astype(float)
    
    date_col = "settlementDate" if "settlementDate" in df.columns else "settlement_date"
    df["settlement_date"] = df[date_col].astype(str) if date_col in df.columns else df["start_time"].dt.strftime("%Y-%m-%d")
    
    period_col = "settlementPeriod" if "settlementPeriod" in df.columns else "settlement_period"
    df["settlement_period"] = pd.to_numeric(df[period_col], errors="coerce").astype("Int64") if period_col in df.columns else None
    
    df["fuel_type"] = "WIND"

    # Select target standardized columns
    cols = ["start_time", "publish_time", "settlement_date", "settlement_period", "fuel_type", "actual_generation_mw"]
    df = df[cols]

    # 4. Deduplicate on start_time: if any duplicates exist, sort by publish_time and take the latest
    df = df.sort_values(["start_time", "publish_time"]).drop_duplicates(subset=["start_time"], keep="last")
    
    # 5. Sort ascending by start_time
    df = df.sort_values("start_time").reset_index(drop=True)
    return df


def normalize_forecasts(raw_data: Union[List[Dict[str, Any]], pd.DataFrame]) -> pd.DataFrame:
    """
    Normalizes WINDFOR forecast data:
    - Parses timestamps to timezone-aware UTC datetime64[ns, UTC]
    - Casts numeric generation to float with explicit unit (MW)
    - Deduplicates on exact (publish_time, start_time) tuples
    - Sorts chronologically by publish_time and start_time
    """
    if isinstance(raw_data, list):
        if not raw_data:
            return pd.DataFrame(columns=["publish_time", "start_time", "forecast_generation_mw"])
        df = pd.DataFrame(raw_data)
    else:
        df = raw_data.copy()

    if df.empty:
        return pd.DataFrame(columns=["publish_time", "start_time", "forecast_generation_mw"])

    # 1. Parse timestamps to UTC
    start_col = "startTime" if "startTime" in df.columns else "start_time"
    pub_col = "publishTime" if "publishTime" in df.columns else "publish_time"
    
    df["start_time"] = pd.to_datetime(df[start_col], utc=True)
    df["publish_time"] = pd.to_datetime(df[pub_col], utc=True)

    # 2. Standardize generation column
    gen_col = "generation" if "generation" in df.columns else ("forecast_generation_mw" if "forecast_generation_mw" in df.columns else None)
    if gen_col is None:
        raise ValueError("Missing generation column in WINDFOR data.")
    
    df["forecast_generation_mw"] = pd.to_numeric(df[gen_col], errors="coerce").astype(float)

    cols = ["publish_time", "start_time", "forecast_generation_mw"]
    df = df[cols]

    # 3. Deduplicate on (publish_time, start_time)
    df = df.drop_duplicates(subset=["publish_time", "start_time"], keep="last")

    # 4. Sort ascending
    df = df.sort_values(["publish_time", "start_time"]).reset_index(drop=True)
    return df
