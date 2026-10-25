"""
scripts/build_snapshot.py
Ingests data from Elexon BMRS with widened publish window, normalizes records,
executes decision-time forecast selection and joins, audits data quality,
and saves reproducible snapshots to data/processed/ and raw data to data/raw/.
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
logger = logging.getLogger("build_snapshot")

RAW_DIR = os.path.join(project_root, "data", "raw")
PROCESSED_DIR = os.path.join(project_root, "data", "processed")

os.makedirs(RAW_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)


def build_snapshot():
    logger.info("Initializing Elexon BMRS client...")
    client = ElexonClient()

    # 1. Ingest Raw Actuals (FUELHH for January 2026 targets)
    fuelhh_from = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
    fuelhh_to = datetime(2026, 2, 1, 1, 0, tzinfo=timezone.utc)
    
    logger.info(f"Ingesting FUELHH actuals from {fuelhh_from.isoformat()} to {fuelhh_to.isoformat()}...")
    raw_fuelhh = client.fetch_fuelhh_stream(fuelhh_from, fuelhh_to, fuel_type="WIND", chunk_days=7)
    logger.info(f"Fetched {len(raw_fuelhh)} raw FUELHH records.")

    raw_fuelhh_path = os.path.join(RAW_DIR, "fuelhh_raw.json")
    with open(raw_fuelhh_path, "w", encoding="utf-8") as f:
        json.dump(raw_fuelhh, f)
    logger.info(f"Saved raw FUELHH snapshot to {raw_fuelhh_path}")

    # 2. Ingest Raw Forecasts (WINDFOR with widened publish window)
    # Target delivery starts Jan 1, decisions made Dec 31 09:00, forecasts published starting ~Dec 30
    windfor_from = datetime(2025, 12, 28, 0, 0, tzinfo=timezone.utc)
    windfor_to = datetime(2026, 1, 31, 23, 59, 59, tzinfo=timezone.utc)

    logger.info(f"Ingesting WINDFOR forecasts from {windfor_from.isoformat()} to {windfor_to.isoformat()}...")
    raw_windfor = client.fetch_windfor_stream(windfor_from, windfor_to, chunk_days=7)
    logger.info(f"Fetched {len(raw_windfor)} raw WINDFOR records.")

    raw_windfor_path = os.path.join(RAW_DIR, "windfor_raw.json")
    with open(raw_windfor_path, "w", encoding="utf-8") as f:
        json.dump(raw_windfor, f)
    logger.info(f"Saved raw WINDFOR snapshot to {raw_windfor_path}")

    # 3. Normalize Datasets
    logger.info("Normalizing actuals and forecasts...")
    df_actuals = normalize_actuals(raw_fuelhh)
    # Filter strictly to January 2026 targets (start_time in Jan 2026)
    jan_start = pd.Timestamp("2026-01-01 00:00:00Z")
    jan_end = pd.Timestamp("2026-01-31 23:30:00Z")
    df_actuals_jan = df_actuals[(df_actuals["start_time"] >= jan_start) & (df_actuals["start_time"] <= jan_end)].copy()
    logger.info(f"Normalized January actuals count: {len(df_actuals_jan)} half-hours (expected 1,488).")

    df_forecasts = normalize_forecasts(raw_windfor)
    logger.info(f"Normalized forecasts count in ingested window: {len(df_forecasts)}.")

    # 4. Pure Selection of Decision-Time Forecasts (09:00 UTC cutoff on D-1)
    logger.info("Executing pure decision-time forecast selection (Cutoff: 09:00 UTC on D-1)...")
    jan_days = [f"2026-01-{d:02d}" for d in range(1, 32)]
    df_decision = select_decision_forecasts(df_forecasts, jan_days, cutoff_hour=9, cutoff_minute=0)
    logger.info(f"Selected decision forecasts count: {len(df_decision)} hours (expected 744).")

    # 5. Join Forecasts and Actuals
    logger.info("Joining forecasts and actuals strictly on UTC start_time...")
    df_joined_hourly = join_forecasts_and_actuals(df_decision, df_actuals_jan, mode="hourly")
    df_joined_half_hourly = join_forecasts_and_actuals(df_decision, df_actuals_jan, mode="half_hourly")

    # 6. Quality and Missing Intervals Audit
    logger.info("Performing comprehensive quality and missing-data audit...")
    audit_report = audit_quality_and_missing(df_actuals_jan, df_decision, jan_start, jan_end)
    
    # Add metric summary to audit report
    audit_report["dataset_metrics"] = {
        "hourly_rows": len(df_joined_hourly),
        "half_hourly_rows": len(df_joined_half_hourly),
        "mean_actual_mw": round(float(df_joined_hourly["actual_generation_mw"].mean()), 2),
        "mean_forecast_mw": round(float(df_joined_hourly["forecast_generation_mw"].mean()), 2),
        "mean_bias_mw": round(float(df_joined_hourly["error_mw"].mean()), 2),
        "mae_mw": round(float(df_joined_hourly["abs_error_mw"].mean()), 2),
        "rmse_mw": round(float(np.sqrt((df_joined_hourly["error_mw"] ** 2).mean())), 2),
        "min_horizon_hours": round(float(df_decision["horizon_hours"].min()), 1),
        "max_horizon_hours": round(float(df_decision["horizon_hours"].max()), 1),
        "mean_horizon_hours": round(float(df_decision["horizon_hours"].mean()), 1),
    }

    quality_report_path = os.path.join(PROCESSED_DIR, "quality_report.json")
    with open(quality_report_path, "w", encoding="utf-8") as f:
        json.dump(audit_report, f, indent=2)
    logger.info(f"Saved quality audit report to {quality_report_path}")

    # 7. Save Parquet Snapshots
    logger.info("Saving processed Parquet datasets to data/processed/...")
    df_actuals_jan.to_parquet(os.path.join(PROCESSED_DIR, "actuals.parquet"), index=False)
    df_forecasts.to_parquet(os.path.join(PROCESSED_DIR, "forecasts_raw.parquet"), index=False)
    df_decision.to_parquet(os.path.join(PROCESSED_DIR, "decision_forecasts.parquet"), index=False)
    df_joined_hourly.to_parquet(os.path.join(PROCESSED_DIR, "joined_analysis.parquet"), index=False)
    df_joined_half_hourly.to_parquet(os.path.join(PROCESSED_DIR, "half_hourly_analysis.parquet"), index=False)

    logger.info("Snapshots successfully saved.")
    return df_decision, df_joined_hourly, audit_report


def spot_check_selection(df_decision: pd.DataFrame):
    logger.info("\n" + "="*70)
    logger.info("SPOT CHECK: Verifying Decision Forecast Selection on Sample Days")
    logger.info("="*70)
    
    check_dates = ["2026-01-01", "2026-01-10", "2026-01-20", "2026-01-31"]
    spot_results = {}

    for date_str in check_dates:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        cutoff_dt = pd.Timestamp(d - timedelta(days=1), tz="UTC").replace(hour=9, minute=0, second=0)
        
        subset = df_decision[df_decision["delivery_date"] == d].copy()
        print(f"\n--- Delivery Day {date_str} (Cutoff: {cutoff_dt.isoformat()}) ---")
        print(f"Total target intervals selected: {len(subset)}")
        
        # Verify publish_time <= cutoff for ALL intervals
        violations = subset[subset["forecast_publish_time"] > cutoff_dt]
        print(f"Violations (publish_time > cutoff): {len(violations)}")
        assert len(violations) == 0, f"LOOK-AHEAD LEAK: {len(violations)} forecasts on {date_str} published after cutoff!"
        
        print("Sample intervals (first 3 and last 3):")
        sample_rows = pd.concat([subset.head(3), subset.tail(3)])
        for _, row in sample_rows.iterrows():
            print(f"  Target: {row['start_time'].isoformat()} | Publish: {row['forecast_publish_time'].isoformat()} | Lead Time: {row['horizon_hours']:.1f}h | Forecast: {row['forecast_generation_mw']:.0f} MW")

        spot_results[date_str] = {
            "cutoff": cutoff_dt.isoformat(),
            "target_intervals": len(subset),
            "violations": len(violations),
            "min_lead_time_hours": float(subset["horizon_hours"].min()),
            "max_lead_time_hours": float(subset["horizon_hours"].max()),
            "distinct_publish_times": [t.isoformat() for t in subset["forecast_publish_time"].unique()],
        }

    return spot_results


if __name__ == "__main__":
    df_decision, df_joined, audit = build_snapshot()
    spot_results = spot_check_selection(df_decision)
    print("\n" + "="*70)
    print("QUALITY REPORT SUMMARY")
    print("="*70)
    print(json.dumps(audit["counts"], indent=2))
    print("\nDATASET METRICS:")
    print(json.dumps(audit["dataset_metrics"], indent=2))
