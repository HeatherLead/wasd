"""
scripts/build_december_and_january.py
Extends the dataset with December 2025 records from Elexon BMRS so that simulation
for early January (like Jan 1 or Jan 4) has full prior 7 days of historical data.
"""

import os
import sys
import json
import logging
from datetime import datetime, timezone, timedelta
import pandas as pd
import numpy as np

# Ensure backend package is in python path
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
sys.path.insert(0, os.path.join(project_root, "backend"))

from app.elexon.client import ElexonClient
from app.pipeline.normalize import normalize_actuals, normalize_forecasts
from app.pipeline.selection import select_decision_forecasts
from app.pipeline.join import join_forecasts_and_actuals, audit_quality_and_missing

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("extend_dec")

RAW_DIR = os.path.join(project_root, "data", "raw")
PROCESSED_DIR = os.path.join(project_root, "data", "processed")


def main():
    logger.info("Initializing Elexon BMRS client...")
    client = ElexonClient()

    # Load existing raw JSON snapshots if present
    raw_fuelhh_path = os.path.join(RAW_DIR, "fuelhh_raw.json")
    raw_windfor_path = os.path.join(RAW_DIR, "windfor_raw.json")

    existing_fuelhh = []
    if os.path.exists(raw_fuelhh_path):
        with open(raw_fuelhh_path, "r", encoding="utf-8") as f:
            existing_fuelhh = json.load(f)
        logger.info(f"Loaded {len(existing_fuelhh)} existing raw FUELHH records.")

    existing_windfor = []
    if os.path.exists(raw_windfor_path):
        with open(raw_windfor_path, "r", encoding="utf-8") as f:
            existing_windfor = json.load(f)
        logger.info(f"Loaded {len(existing_windfor)} existing raw WINDFOR records.")

    # Fetch December 2025 FUELHH (target delivery Dec 24 00:00 to Dec 31 23:30)
    fuel_from = datetime(2025, 12, 24, 0, 0, tzinfo=timezone.utc)
    fuel_to = datetime(2025, 12, 31, 23, 59, tzinfo=timezone.utc)
    logger.info("Fetching December 2025 FUELHH actuals...")
    dec_fuelhh = client.fetch_fuelhh_stream(fuel_from, fuel_to, fuel_type="WIND", chunk_days=7)
    logger.info(f"Fetched {len(dec_fuelhh)} December FUELHH records.")

    # Fetch December 2025 WINDFOR (published from Dec 18 00:00 to Dec 28 00:00)
    wind_from = datetime(2025, 12, 18, 0, 0, tzinfo=timezone.utc)
    wind_to = datetime(2025, 12, 28, 0, 0, tzinfo=timezone.utc)
    logger.info("Fetching December 2025 WINDFOR forecasts...")
    dec_windfor = client.fetch_windfor_stream(wind_from, wind_to, chunk_days=7)
    logger.info(f"Fetched {len(dec_windfor)} December WINDFOR records.")

    # Deduplicate and combine raw FUELHH
    combined_fuelhh = dec_fuelhh + existing_fuelhh
    seen_fuelhh = set()
    dedup_fuelhh = []
    for r in combined_fuelhh:
        st = r.get("startTime")
        if st and st not in seen_fuelhh:
            seen_fuelhh.add(st)
            dedup_fuelhh.append(r)
    dedup_fuelhh.sort(key=lambda x: x.get("startTime", ""))

    with open(raw_fuelhh_path, "w", encoding="utf-8") as f:
        json.dump(dedup_fuelhh, f)
    logger.info(f"Saved total {len(dedup_fuelhh)} deduplicated raw FUELHH records.")

    # Deduplicate and combine raw WINDFOR
    combined_windfor = dec_windfor + existing_windfor
    seen_windfor = set()
    dedup_windfor = []
    for r in combined_windfor:
        key = (r.get("startTime"), r.get("publishTime"))
        if key not in seen_windfor:
            seen_windfor.add(key)
            dedup_windfor.append(r)
    dedup_windfor.sort(key=lambda x: (x.get("startTime", ""), x.get("publishTime", "")))

    with open(raw_windfor_path, "w", encoding="utf-8") as f:
        json.dump(dedup_windfor, f)
    logger.info(f"Saved total {len(dedup_windfor)} deduplicated raw WINDFOR records.")

    # Normalize datasets
    logger.info("Normalizing actuals and forecasts...")
    df_actuals = normalize_actuals(dedup_fuelhh)
    # Include from 2025-12-25 00:00:00Z to 2026-01-31 23:30:00Z
    eval_start = pd.Timestamp("2025-12-25 00:00:00Z")
    eval_end = pd.Timestamp("2026-01-31 23:30:00Z")
    df_actuals_clean = df_actuals[(df_actuals["start_time"] >= eval_start) & (df_actuals["start_time"] <= eval_end)].copy()
    logger.info(f"Normalized actuals count (Dec 25 - Jan 31): {len(df_actuals_clean)} half-hours.")

    df_forecasts = normalize_forecasts(dedup_windfor)
    logger.info(f"Normalized forecasts count: {len(df_forecasts)}.")

    # Decision selection: Dec 25 to Dec 31 (7 days) + Jan 1 to Jan 31 (31 days) = 38 delivery days
    dec_days = [f"2025-12-{d:02d}" for d in range(25, 32)]
    jan_days = [f"2026-01-{d:02d}" for d in range(1, 32)]
    all_delivery_days = dec_days + jan_days
    logger.info(f"Selecting decision forecasts for {len(all_delivery_days)} delivery days (Cutoff: 09:00 UTC on D-1)...")
    df_decision = select_decision_forecasts(df_forecasts, all_delivery_days, cutoff_hour=9, cutoff_minute=0)
    logger.info(f"Selected decision forecasts count: {len(df_decision)} hours.")

    # Join Forecasts and Actuals
    logger.info("Joining forecasts and actuals strictly on UTC start_time...")
    df_joined_hourly = join_forecasts_and_actuals(df_decision, df_actuals_clean, mode="hourly")
    df_joined_half_hourly = join_forecasts_and_actuals(df_decision, df_actuals_clean, mode="half_hourly")

    logger.info(f"Hourly rows: {len(df_joined_hourly)}, Half-hourly rows: {len(df_joined_half_hourly)}")
    logger.info(f"Unique delivery dates: {df_joined_hourly['delivery_date'].min()} to {df_joined_hourly['delivery_date'].max()}")

    # Save Parquet Snapshots
    logger.info("Saving updated Parquet datasets to data/processed/...")
    df_actuals_clean.to_parquet(os.path.join(PROCESSED_DIR, "actuals.parquet"), index=False)
    df_forecasts.to_parquet(os.path.join(PROCESSED_DIR, "forecasts_raw.parquet"), index=False)
    df_decision.to_parquet(os.path.join(PROCESSED_DIR, "decision_forecasts.parquet"), index=False)
    df_joined_hourly.to_parquet(os.path.join(PROCESSED_DIR, "joined_analysis.parquet"), index=False)
    df_joined_half_hourly.to_parquet(os.path.join(PROCESSED_DIR, "half_hourly_analysis.parquet"), index=False)

    logger.info("All Parquet snapshots successfully rebuilt and saved!")


if __name__ == "__main__":
    main()
