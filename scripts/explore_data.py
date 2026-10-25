"""
scripts/explore_data.py
Exploration script for Elexon BMRS FUELHH (WIND) and WINDFOR streams.
Validates data schemas, resolutions, horizons, completeness, and replay feasibility for January 2026.
"""

import sys
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
import pandas as pd
import numpy as np

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"

def fetch_stream(endpoint: str, params: dict) -> pd.DataFrame:
    query_str = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{BASE_URL}/datasets/{endpoint}/stream?{query_str}"
    print(f"Fetching: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    df = pd.DataFrame(data)
    return df

def explore_fuelhh():
    print("\n" + "="*60)
    print("1. EXPLORING FUELHH (ACTUALS)")
    print("="*60)
    
    # Ingest entire January 2026 for WIND
    # Note: Target month delivery starts 2026-01-01 00:00:00Z and ends 2026-01-31 23:30:00Z
    # In FUELHH, publishTime is typically 15-30 min after startTime.
    # To capture all target startTimes in Jan 2026:
    df_raw = fetch_stream("FUELHH", {
        "publishDateTimeFrom": "2026-01-01T00:00:00Z",
        "publishDateTimeTo": "2026-02-01T01:00:00Z",
        "fuelType": "WIND"
    })
    
    print(f"Total raw FUELHH rows fetched: {len(df_raw)}")
    print(f"Raw columns: {df_raw.columns.tolist()}")
    print("\nFirst 3 rows:")
    print(df_raw.head(3))
    
    # Parse timestamps
    df_raw['startTime'] = pd.to_datetime(df_raw['startTime'], utc=True)
    df_raw['publishTime'] = pd.to_datetime(df_raw['publishTime'], utc=True)
    
    # Filter strictly to January 2026 target startTimes (2026-01-01T00:00:00Z to 2026-01-31T23:30:00Z)
    jan_start = pd.Timestamp("2026-01-01 00:00:00", tz="UTC")
    jan_end = pd.Timestamp("2026-01-31 23:30:00", tz="UTC")
    df_jan = df_raw[(df_raw['startTime'] >= jan_start) & (df_raw['startTime'] <= jan_end)].copy()
    
    print(f"\nFiltered to Jan 2026 startTimes: {len(df_jan)} records")
    print(f"Min startTime: {df_jan['startTime'].min()}, Max startTime: {df_jan['startTime'].max()}")
    
    # Check for duplicates on startTime
    dup_starts = df_jan[df_jan.duplicated(subset=['startTime'], keep=False)]
    print(f"Duplicate startTimes in FUELHH: {len(dup_starts)}")
    
    # Check expected 30-min intervals
    expected_intervals = 31 * 48  # 1488 half hours
    print(f"Expected 30-min settlement intervals in Jan 2026 (31 days * 48): {expected_intervals}")
    print(f"Actual unique intervals present: {df_jan['startTime'].nunique()}")
    
    # Check completeness
    full_range = pd.date_range(start=jan_start, end=jan_end, freq="30min", tz="UTC")
    missing = full_range.difference(df_jan['startTime'])
    print(f"Missing intervals in FUELHH: {len(missing)}")
    if len(missing) > 0:
        print(f"Missing timestamps: {missing}")
        
    # Check values / statistics
    print("\nFUELHH Wind Generation (MW) statistics:")
    print(df_jan['generation'].describe())
    null_count = df_jan['generation'].isnull().sum()
    neg_count = (df_jan['generation'] < 0).sum()
    print(f"Null generation values: {null_count}, Negative generation values: {neg_count}")
    
    return df_jan

def explore_windfor():
    print("\n" + "="*60)
    print("2. EXPLORING WINDFOR (FORECASTS)")
    print("="*60)
    
    # Forecasts for Jan 1 delivery need D-1 cutoff (Dec 31 09:00).
    # Those forecasts are published starting around Dec 29-30.
    # To cover all Jan delivery days, fetch from 2025-12-28 to 2026-01-31 23:59:59.
    df_raw = fetch_stream("WINDFOR", {
        "publishDateTimeFrom": "2025-12-28T00:00:00Z",
        "publishDateTimeTo": "2026-01-31T23:59:59Z"
    })
    
    print(f"Total raw WINDFOR rows fetched: {len(df_raw)}")
    print(f"Raw columns: {df_raw.columns.tolist()}")
    print("\nFirst 3 rows:")
    print(df_raw.head(3))
    
    # Parse timestamps
    df_raw['startTime'] = pd.to_datetime(df_raw['startTime'], utc=True)
    df_raw['publishTime'] = pd.to_datetime(df_raw['publishTime'], utc=True)
    
    print(f"\nPublish time range: {df_raw['publishTime'].min()} to {df_raw['publishTime'].max()}")
    print(f"Target startTime range: {df_raw['startTime'].min()} to {df_raw['startTime'].max()}")
    
    # Check resolutions
    print("\nUnique minutes in startTime:", df_raw['startTime'].dt.minute.unique().tolist())
    print("Unique minutes in publishTime:", df_raw['publishTime'].dt.minute.unique().tolist())
    
    # Filter to targets in January 2026
    jan_start = pd.Timestamp("2026-01-01 00:00:00", tz="UTC")
    jan_end = pd.Timestamp("2026-01-31 23:00:00", tz="UTC")
    df_jan_targets = df_raw[(df_raw['startTime'] >= jan_start) & (df_raw['startTime'] <= jan_end)].copy()
    print(f"\nTotal forecasts targeting Jan 2026: {len(df_jan_targets)}")
    print(f"Target hours covered (unique startTimes): {df_jan_targets['startTime'].nunique()} / {31 * 24} expected")
    
    # Check horizons
    df_jan_targets['horizon_hours'] = (df_jan_targets['startTime'] - df_jan_targets['publishTime']).dt.total_seconds() / 3600.0
    print("\nForecast Horizon (startTime - publishTime) in hours for Jan targets:")
    print(df_jan_targets['horizon_hours'].describe())
    
    # Number of forecasts per target hour
    counts_per_target = df_jan_targets.groupby('startTime').size()
    print("\nNumber of forecasts per target hour:")
    print(counts_per_target.describe())
    
    # Check duplicates on (publishTime, startTime)
    dup_pub_start = df_jan_targets[df_jan_targets.duplicated(subset=['publishTime', 'startTime'], keep=False)]
    print(f"Duplicates on (publishTime, startTime): {len(dup_pub_start)}")
    
    return df_raw

def evaluate_replay(df_windfor, df_fuelhh, cutoff_hour=9, cutoff_minute=0):
    print("\n" + "="*60)
    print(f"3. EVALUATING REPLAY AT CUTOFF {cutoff_hour:02d}:{cutoff_minute:02d} UTC ON D-1")
    print("="*60)
    
    # For every delivery day D in Jan 2026 (Jan 1 to Jan 31):
    # Cutoff is D-1 at cutoff_hour:cutoff_minute UTC
    # Eligible forecasts for each target interval on D must satisfy publishTime <= Cutoff
    
    records = []
    missing_targets = []
    
    for day_num in range(1, 32):
        delivery_date = pd.Timestamp(year=2026, month=1, day=day_num, tz="UTC").date()
        cutoff_dt = pd.Timestamp(year=2026, month=1, day=day_num, hour=cutoff_hour, minute=cutoff_minute, tz="UTC") - pd.Timedelta(days=1)
        
        # All target startTimes on delivery day D
        # WINDFOR has hourly startTimes: 00:00, 01:00, ..., 23:00
        target_hours = pd.date_range(
            start=pd.Timestamp(year=2026, month=1, day=day_num, hour=0, minute=0, tz="UTC"),
            end=pd.Timestamp(year=2026, month=1, day=day_num, hour=23, minute=0, tz="UTC"),
            freq="1h"
        )
        
        for tgt in target_hours:
            # Filter forecasts targeting this startTime with publishTime <= cutoff_dt
            eligible = df_windfor[(df_windfor['startTime'] == tgt) & (df_windfor['publishTime'] <= cutoff_dt)]
            if len(eligible) == 0:
                missing_targets.append((delivery_date, tgt, cutoff_dt))
            else:
                # Latest publishTime
                latest_forecast = eligible.sort_values('publishTime', ascending=False).iloc[0]
                records.append({
                    "deliveryDate": delivery_date,
                    "startTime": tgt,
                    "cutoffTime": cutoff_dt,
                    "forecastPublishTime": latest_forecast['publishTime'],
                    "forecastGenerationMW": latest_forecast['generation'],
                    "leadTimeHours": (tgt - latest_forecast['publishTime']).total_seconds() / 3600.0
                })
                
    df_replay = pd.DataFrame(records)
    print(f"Total target hours evaluated: {31 * 24} = {744}")
    print(f"Replay successfully selected forecast for: {len(df_replay)} hours")
    print(f"Target hours missing eligible forecast: {len(missing_targets)}")
    
    if len(df_replay) > 0:
        print("\nReplay selected forecasts summary:")
        print(f"Lead time from publish to target (hours):")
        print(df_replay['leadTimeHours'].describe())
        print("\nSample selected forecasts (first 5):")
        print(df_replay[['deliveryDate', 'startTime', 'forecastPublishTime', 'leadTimeHours', 'forecastGenerationMW']].head(5))
        
        # Join with actuals!
        # Case A: Hourly actuals (mean of :00 and :30)
        df_fuel_copy = df_fuelhh.copy()
        df_fuel_copy['hourStartTime'] = df_fuel_copy['startTime'].dt.floor('1h')
        df_actual_hourly = df_fuel_copy.groupby('hourStartTime').agg(
            actualGenerationMW=('generation', 'mean'),
            settlementCount=('settlementPeriod', 'count')
        ).reset_index()
        
        df_joined = pd.merge(df_replay, df_actual_hourly, left_on='startTime', right_on='hourStartTime', how='left')
        df_joined['errorMW'] = df_joined['forecastGenerationMW'] - df_joined['actualGenerationMW']
        df_joined['absErrorMW'] = df_joined['errorMW'].abs()
        df_joined['pctError'] = (df_joined['errorMW'] / df_joined['actualGenerationMW']) * 100
        
        mae = df_joined['absErrorMW'].mean()
        rmse = np.sqrt((df_joined['errorMW'] ** 2).mean())
        bias = df_joined['errorMW'].mean()
        
        print("\n" + "-"*40)
        print("PRELIMINARY ERROR METRICS (Hourly Level)")
        print("-"*40)
        print(f"Total joined hours: {len(df_joined)}")
        print(f"Mean Forecast (MW): {df_joined['forecastGenerationMW'].mean():.2f}")
        print(f"Mean Actual (MW):   {df_joined['actualGenerationMW'].mean():.2f}")
        print(f"Mean Bias (MW) [Forecast - Actual]: {bias:+.2f} MW")
        print(f"MAE (Mean Absolute Error):         {mae:.2f} MW")
        print(f"RMSE (Root Mean Square Error):     {rmse:.2f} MW")
        print(f"Max Overforecast:  {df_joined['errorMW'].max():+.2f} MW")
        print(f"Max Underforecast: {df_joined['errorMW'].min():+.2f} MW")

if __name__ == "__main__":
    df_fuel = explore_fuelhh()
    df_wind = explore_windfor()
    evaluate_replay(df_wind, df_fuel, cutoff_hour=9, cutoff_minute=0)
