"""
backend/tests/test_correctness.py
PHASE 6: Analytical Correctness Test Suite.

Proves mathematical, algorithmic, and domain correctness:
1. No post-cutoff forecasts: Synthetic dataset with forecasts published both before
   and after cutoff; asserts selected forecast is strictly <= cutoff, even when a newer
   forecast exists.
2. One per interval: Exactly one eligible forecast selected per startTime (no duplicates,
   no fan-out after hourly or half-hourly join).
3. Join by timestamp: Shuffled row order and arbitrary index offsets; asserts join results
   are completely invariant to row order and indices.
4. Missing data is never zero: Removing actuals and forecasts for selected intervals leaves
   them strictly null/NaN, flags them as missing, excludes them from error metrics, and
   counts them in coverage metrics.
5. Hand-calculated metrics: Small fixed examples verifying MAE, RMSE, bias, overforecast
   rate, error percentiles, shortfall MWh, and surplus MWh with arithmetic documented in comments.
6. Cutoff boundary: A forecast published exactly at the cutoff second is eligible; one a
   second (or millisecond) later is strictly ineligible.
7. Real-data snapshot sanity checks: Verified against processed Parquet datasets—horizons
   are positive, publishTime is strictly before startTime, startTimes are unique, and interval
   counts per delivery day match 24h / 48hh standards.
"""

import os
from datetime import date, datetime, timedelta, timezone
import numpy as np
import pandas as pd
import pytest

from app.pipeline.selection import select_decision_forecasts
from app.pipeline.join import join_forecasts_and_actuals, audit_quality_and_missing
from app.metrics import (
    calculate_bias,
    calculate_mae,
    calculate_rmse,
    calculate_nmae,
    calculate_overforecast_rate,
    calculate_error_percentiles,
    calculate_coverage,
    calculate_shortfall_energy_mwh,
    calculate_surplus_energy_mwh,
    calculate_p90_shortfall_mw,
    compute_kpi_summary,
)


# ==============================================================================
# TEST 1: No Post-Cutoff Forecasts (Synthetic Dataset)
# ==============================================================================
def test_no_post_cutoff_forecasts_synthetic():
    """
    Builds a synthetic dataset with forecasts published both before and after the
    cutoff time. Asserts that the selected forecast is ALWAYS <= cutoff, even when
    newer forecasts with different values exist.
    """
    # Target Delivery Days: 2026-01-02 and 2026-01-03
    # Default cutoff: 09:00 UTC on D-1
    # For Jan 2, cutoff is 2026-01-01 09:00:00Z
    # For Jan 3, cutoff is 2026-01-02 09:00:00Z
    records = []

    # Target 1: Jan 2 at 12:00 UTC
    target_1 = pd.Timestamp("2026-01-02 12:00:00Z")
    records.extend([
        # Published D-3 (2025-12-30 10:00) -> Eligible, older
        {"start_time": target_1, "publish_time": pd.Timestamp("2025-12-30 10:00:00Z"), "forecast_generation_mw": 5000.0},
        # Published D-1 06:00 (2026-01-01 06:00) -> Eligible, older
        {"start_time": target_1, "publish_time": pd.Timestamp("2026-01-01 06:00:00Z"), "forecast_generation_mw": 7000.0},
        # Published D-1 08:30 (2026-01-01 08:30) -> ELIGIBLE & LATEST BEFORE 09:00 CUTOFF
        {"start_time": target_1, "publish_time": pd.Timestamp("2026-01-01 08:30:00Z"), "forecast_generation_mw": 8500.0},
        # Published D-1 09:05 (2026-01-01 09:05) -> POST-CUTOFF LEAK (newer, must be ignored!)
        {"start_time": target_1, "publish_time": pd.Timestamp("2026-01-01 09:05:00Z"), "forecast_generation_mw": 12000.0},
        # Published D-1 14:00 (2026-01-01 14:00) -> POST-CUTOFF LEAK (newer, must be ignored!)
        {"start_time": target_1, "publish_time": pd.Timestamp("2026-01-01 14:00:00Z"), "forecast_generation_mw": 15000.0},
        # Published D 06:00 (2026-01-02 06:00) -> SAME DAY LEAK (newer, must be ignored!)
        {"start_time": target_1, "publish_time": pd.Timestamp("2026-01-02 06:00:00Z"), "forecast_generation_mw": 18000.0},
        # Published D 11:30 (2026-01-02 11:30) -> INTRADAY LEAK (newer, must be ignored!)
        {"start_time": target_1, "publish_time": pd.Timestamp("2026-01-02 11:30:00Z"), "forecast_generation_mw": 22000.0},
    ])

    # Target 2: Jan 3 at 18:00 UTC
    target_2 = pd.Timestamp("2026-01-03 18:00:00Z")
    records.extend([
        # Published D-2 (2026-01-01 10:00) -> Eligible
        {"start_time": target_2, "publish_time": pd.Timestamp("2026-01-01 10:00:00Z"), "forecast_generation_mw": 6000.0},
        # Published D-1 08:00 (2026-01-02 08:00) -> ELIGIBLE & LATEST BEFORE 09:00 CUTOFF
        {"start_time": target_2, "publish_time": pd.Timestamp("2026-01-02 08:00:00Z"), "forecast_generation_mw": 9500.0},
        # Published D-1 09:30 (2026-01-02 09:30) -> POST-CUTOFF LEAK
        {"start_time": target_2, "publish_time": pd.Timestamp("2026-01-02 09:30:00Z"), "forecast_generation_mw": 14000.0},
    ])

    df_forecasts = pd.DataFrame(records)

    selected = select_decision_forecasts(
        df_forecasts,
        delivery_days=["2026-01-02", "2026-01-03"],
        cutoff_hour=9,
        cutoff_minute=0
    )

    assert len(selected) == 2, "Expected exactly one selected forecast per target delivery hour"

    # Assert 100% of selected rows satisfy publish_time <= cutoff_time
    for _, row in selected.iterrows():
        assert row["forecast_publish_time"] <= row["cutoff_time"], (
            f"Look-ahead violation! publishTime {row['forecast_publish_time']} > cutoff {row['cutoff_time']}"
        )

    # Check Target 1 row
    row_1 = selected[selected["start_time"] == target_1].iloc[0]
    assert row_1["forecast_publish_time"] == pd.Timestamp("2026-01-01 08:30:00Z")
    assert row_1["forecast_generation_mw"] == 8500.0
    # Horizon = Target (Jan 2 12:00) - Publish (Jan 1 08:30) = 27.5 hours
    assert row_1["horizon_hours"] == 27.5

    # Check Target 2 row
    row_2 = selected[selected["start_time"] == target_2].iloc[0]
    assert row_2["forecast_publish_time"] == pd.Timestamp("2026-01-02 08:00:00Z")
    assert row_2["forecast_generation_mw"] == 9500.0
    # Horizon = Target (Jan 3 18:00) - Publish (Jan 2 08:00) = 34.0 hours
    assert row_2["horizon_hours"] == 34.0


# ==============================================================================
# TEST 2: One Per Interval (No Duplicates, No Fan-Out After Join)
# ==============================================================================
def test_one_per_interval_no_duplicates_no_fan_out():
    """
    Asserts exactly one eligible forecast is selected per startTime, and joining with
    actuals produces no duplicates or cartesian fan-out (both hourly and half-hourly).
    """
    # Create 4 target hours on 2026-01-05
    target_hours = [
        pd.Timestamp("2026-01-05 00:00:00Z"),
        pd.Timestamp("2026-01-05 01:00:00Z"),
        pd.Timestamp("2026-01-05 02:00:00Z"),
        pd.Timestamp("2026-01-05 03:00:00Z"),
    ]

    # Generate 15 distinct candidate forecasts per target hour published before cutoff
    records = []
    for th in target_hours:
        for offset_min in range(15, 300, 20):  # Multiple runs published on D-1
            pub = pd.Timestamp("2026-01-04 09:00:00Z") - timedelta(minutes=offset_min)
            records.append({
                "start_time": th,
                "publish_time": pub,
                "forecast_generation_mw": 10000.0 + offset_min
            })

    df_forecasts = pd.DataFrame(records)

    selected = select_decision_forecasts(
        df_forecasts,
        delivery_days=["2026-01-05"],
        cutoff_hour=9,
        cutoff_minute=0
    )

    # 1. Selection uniqueness: exactly one per target hour
    assert len(selected) == 4
    assert selected["start_time"].is_unique
    assert selected["start_time"].value_counts().max() == 1

    # 2. Hourly Join: Actuals has 2 settlement periods per hour (8 rows total)
    actuals_records = []
    sp = 1
    for th in target_hours:
        # Period 1: at :00
        actuals_records.append({"start_time": th, "settlement_period": sp, "actual_generation_mw": 9000.0})
        sp += 1
        # Period 2: at :30
        actuals_records.append({"start_time": th + timedelta(minutes=30), "settlement_period": sp, "actual_generation_mw": 9200.0})
        sp += 1
    df_actuals = pd.DataFrame(actuals_records)

    joined_hourly = join_forecasts_and_actuals(selected, df_actuals, mode="hourly")

    # Assert exactly 4 hourly rows (aggregated actuals, no fan-out)
    assert len(joined_hourly) == 4, f"Expected 4 hourly rows, got {len(joined_hourly)}"
    assert joined_hourly["start_time"].is_unique
    assert joined_hourly["start_time"].value_counts().max() == 1
    # Verify aggregation: mean of 9000 and 9200 = 9100 MW
    assert (joined_hourly["actual_generation_mw"] == 9100.0).all()

    # 3. Half-Hourly Join: Exactly 8 half-hourly rows (2 settlement periods per hour)
    joined_hh = join_forecasts_and_actuals(selected, df_actuals, mode="half_hourly")
    assert len(joined_hh) == 8, f"Expected 8 half-hourly rows, got {len(joined_hh)}"
    assert joined_hh["start_time"].is_unique
    assert joined_hh["start_time"].value_counts().max() == 1


# ==============================================================================
# TEST 3: Join by Timestamp (Invariant to Row Order and Indices)
# ==============================================================================
def test_join_by_timestamp_invariant_to_order_and_index():
    """
    Shuffles row order and applies arbitrary offset indices to forecasts and actuals.
    Asserts that the joined output is 100% identical, proving the join is strictly
    relational on UTC startTime and never positional or index-dependent.
    """
    start_times = pd.date_range("2026-01-01 00:00:00Z", periods=12, freq="1h", tz="UTC")

    forecasts = pd.DataFrame({
        "delivery_date": [t.date() for t in start_times],
        "start_time": start_times,
        "cutoff_time": [pd.Timestamp("2025-12-31 09:00:00Z")] * 12,
        "forecast_publish_time": [pd.Timestamp("2025-12-31 07:30:00Z")] * 12,
        "forecast_generation_mw": [1000.0 * (i + 1) for i in range(12)],
        "horizon_hours": [24.0 + i for i in range(12)],
    })

    actual_times = pd.date_range("2026-01-01 00:00:00Z", periods=24, freq="30min", tz="UTC")
    actuals = pd.DataFrame({
        "start_time": actual_times,
        "settlement_period": list(range(1, 25)),
        "actual_generation_mw": [950.0 * (i + 1) for i in range(24)],
    })

    # Baseline join with natural order
    baseline_hourly = join_forecasts_and_actuals(forecasts, actuals, mode="hourly")
    baseline_hh = join_forecasts_and_actuals(forecasts, actuals, mode="half_hourly")

    # Scramble forecasts: random shuffle + non-standard chaotic index
    shuffled_f = forecasts.sample(frac=1.0, random_state=42)
    shuffled_f.index = [999, 12, 45, 888, 3, 50, 100, 7, 2, 88, 314, 271]

    # Scramble actuals: random shuffle + non-standard chaotic index
    shuffled_a = actuals.sample(frac=1.0, random_state=123)
    shuffled_a.index = [1000 + i * 17 for i in range(24)]

    # Join with shuffled inputs
    shuffled_hourly = join_forecasts_and_actuals(shuffled_f, shuffled_a, mode="hourly")
    shuffled_hh = join_forecasts_and_actuals(shuffled_f, shuffled_a, mode="half_hourly")

    # Prove identical results
    pd.testing.assert_frame_equal(baseline_hourly, shuffled_hourly)
    pd.testing.assert_frame_equal(baseline_hh, shuffled_hh)


# ==============================================================================
# TEST 4: Missing Data is Never Zero
# ==============================================================================
def test_missing_data_is_never_zero():
    """
    Removes actuals and forecasts for specific intervals.
    Asserts:
    - Missing values remain strictly NaN / Null (never zero).
    - Errors remain NaN (not hallucinated).
    - Missing intervals are identified in audit_quality_and_missing.
    - Excluded from error metrics (MAE, RMSE, bias).
    - Properly accounted for in coverage metrics.
    """
    # 6 hourly intervals on 2026-01-01
    hours = pd.date_range("2026-01-01 00:00:00Z", periods=6, freq="1h", tz="UTC")

    # Forecasts: present for 0, 1, 2, 5 (missing for 3, 4)
    f_records = [
        {"start_time": hours[0], "forecast_generation_mw": 10000.0, "delivery_date": hours[0].date()},
        {"start_time": hours[1], "forecast_generation_mw": 11000.0, "delivery_date": hours[1].date()},
        {"start_time": hours[2], "forecast_generation_mw": 12000.0, "delivery_date": hours[2].date()},  # Actual will be missing
        # hours[3] missing forecast
        # hours[4] missing forecast AND actual
        {"start_time": hours[5], "forecast_generation_mw": 15000.0, "delivery_date": hours[5].date()},
    ]
    forecasts = pd.DataFrame(f_records)

    # Actuals: present for 0, 1, 3, 5 (missing for 2, 4)
    a_records = [
        {"start_time": hours[0], "actual_generation_mw": 9000.0, "settlement_period": 1},
        {"start_time": hours[1], "actual_generation_mw": 10500.0, "settlement_period": 3},
        # hours[2] missing actual
        {"start_time": hours[3], "actual_generation_mw": 13000.0, "settlement_period": 7},
        # hours[4] missing both
        {"start_time": hours[5], "actual_generation_mw": 14000.0, "settlement_period": 11},
    ]
    actuals = pd.DataFrame(a_records)

    joined = join_forecasts_and_actuals(forecasts, actuals, mode="hourly")

    # Total intervals in joined outer merge = 5 (hours 0, 1, 2, 3, 5)
    # Hour 2: Forecast present (12000), Actual missing
    row_2 = joined[joined["start_time"] == hours[2]].iloc[0]
    assert pd.isna(row_2["actual_generation_mw"]), "Missing actual must remain NaN, not zero"
    assert row_2["actual_generation_mw"] != 0.0
    assert pd.isna(row_2["error_mw"]), "Error with missing actual must be NaN"
    assert pd.isna(row_2["abs_error_mw"])

    # Hour 3: Forecast missing, Actual present (13000)
    row_3 = joined[joined["start_time"] == hours[3]].iloc[0]
    assert pd.isna(row_3["forecast_generation_mw"]), "Missing forecast must remain NaN, not zero"
    assert row_3["forecast_generation_mw"] != 0.0
    assert pd.isna(row_3["error_mw"]), "Error with missing forecast must be NaN"

    # Quality Audit across the 6 hours window
    audit = audit_quality_and_missing(
        actuals,
        forecasts,
        start_dt="2026-01-01T00:00:00Z",
        end_dt="2026-01-01T05:30:00Z"
    )

    # Expected: 12 half-hours total
    assert audit["evaluation_window"]["total_expected_half_hours"] == 12
    # Missing actuals and forecasts are detected
    assert audit["counts"]["missing_actual_count"] > 0
    assert audit["counts"]["missing_forecast_count"] > 0
    assert audit["counts"]["completeness_pct"] < 100.0

    # Metrics computation: MUST ignore NaNs and not impute zero
    summary = compute_kpi_summary(
        forecast=joined["forecast_generation_mw"],
        actual=joined["actual_generation_mw"],
        total_expected_intervals=6,
        interval_hours=1.0
    )

    # Only hours 0, 1, 5 are complete pairs:
    # Hour 0: F=10000, A=9000  -> Error = +1000
    # Hour 1: F=11000, A=10500 -> Error = +500
    # Hour 5: F=15000, A=14000 -> Error = +1000
    # Bias = (1000 + 500 + 1000) / 3 = 2500 / 3 = 833.33 MW
    assert summary["bias_mw"] == round(2500.0 / 3.0, 2)
    assert summary["mae_mw"] == round(2500.0 / 3.0, 2)

    # Coverage: 3 valid pairs out of 6 expected
    assert summary["coverage"]["total_expected_intervals"] == 6
    assert summary["coverage"]["valid_intervals"] == 3
    assert summary["coverage"]["missing_intervals"] == 3
    assert summary["coverage"]["coverage_pct"] == 50.0


# ==============================================================================
# TEST 5: Hand-Calculated Metrics (Verified Arithmetic in Comments)
# ==============================================================================
def test_hand_calculated_metrics_verified():
    """
    Fixed, small dataset where MAE, RMSE, bias, overforecast rate, percentiles,
    shortfall MWh, and surplus MWh are verified against hand-calculated arithmetic.

    ===========================================================================
    ARITHMETIC DERIVATION (5 Hourly Intervals, Delta_t = 1.0 h):
    ---------------------------------------------------------------------------
    Interval 1: Forecast = 120 MW, Actual = 100 MW
      - Error = 120 - 100 = +20 MW (Overforecast / Shortfall)
      - Abs Error = 20 MW
      - Squared Error = 20^2 = 400 MW^2
      - Shortfall Energy = 20 MW * 1h = 20 MWh, Surplus = 0 MWh

    Interval 2: Forecast = 80 MW, Actual = 110 MW
      - Error = 80 - 110 = -30 MW (Underforecast / Surplus)
      - Abs Error = 30 MW
      - Squared Error = (-30)^2 = 900 MW^2
      - Shortfall Energy = 0 MWh, Surplus = 30 MW * 1h = 30 MWh

    Interval 3: Forecast = 200 MW, Actual = 160 MW
      - Error = 200 - 160 = +40 MW (Overforecast / Shortfall)
      - Abs Error = 40 MW
      - Squared Error = 40^2 = 1600 MW^2
      - Shortfall Energy = 40 MW * 1h = 40 MWh, Surplus = 0 MWh

    Interval 4: Forecast = 150 MW, Actual = 150 MW
      - Error = 150 - 150 = 0 MW (Exact match)
      - Abs Error = 0 MW
      - Squared Error = 0 MW^2
      - Shortfall = 0 MWh, Surplus = 0 MWh

    Interval 5: Forecast = 90 MW, Actual = 100 MW
      - Error = 90 - 100 = -10 MW (Underforecast / Surplus)
      - Abs Error = 10 MW
      - Squared Error = (-10)^2 = 100 MW^2
      - Shortfall = 0 MWh, Surplus = 10 MW * 1h = 10 MWh

    SUMMARY TOTALS:
    1. Bias (Mean Error):
       sum(Error) / N = (+20 - 30 + 40 + 0 - 10) / 5 = +20 / 5 = +4.00 MW

    2. MAE (Mean Absolute Error):
       sum(Abs Error) / N = (20 + 30 + 40 + 0 + 10) / 5 = 100 / 5 = 20.00 MW

    3. RMSE (Root Mean Square Error):
       sum(Squared Error) = 400 + 900 + 1600 + 0 + 100 = 3000 MW^2
       Mean Squared Error = 3000 / 5 = 600.00 MW^2
       RMSE = sqrt(600) = 24.49489742783178... MW -> 24.49 MW

    4. nMAE (Normalized MAE):
       Mean Actual = (100 + 110 + 160 + 150 + 100) / 5 = 620 / 5 = 124.00 MW
       nMAE = MAE / Mean Actual = 20.0 / 124.0 = 0.16129032... -> 16.13%

    5. Overforecast Rate:
       Intervals where Forecast > Actual: Interval 1 (120 > 100) and Interval 3 (200 > 160)
       Count = 2 out of 5 intervals -> Rate = 2 / 5 = 0.4000 (40.00%)

    6. Wind-Shortfall Energy:
       sum(max(Forecast - Actual, 0)) * 1h = (20 + 0 + 40 + 0 + 0) * 1.0 = 60.00 MWh

    7. Wind-Surplus Energy:
       sum(max(Actual - Forecast, 0)) * 1h = (0 + 30 + 0 + 0 + 10) * 1.0 = 40.00 MWh

    8. Net Imbalance Energy:
       Shortfall - Surplus = 60.0 - 40.0 = +20.00 MWh

    9. Percentiles of Absolute Errors [0, 10, 20, 30, 40]:
       - P50 (median) = 20.00 MW
       - P90 (linear interpolation): 4 * 0.9 = index 3.6 -> 30 + 0.6*(40-30) = 36.00 MW
       - P95 (linear interpolation): 4 * 0.95 = index 3.8 -> 30 + 0.8*(40-30) = 38.00 MW
    ===========================================================================
    """
    forecast = [120.0, 80.0, 200.0, 150.0, 90.0]
    actual   = [100.0, 110.0, 160.0, 150.0, 100.0]

    # 1. Bias
    bias = calculate_bias(forecast, actual)
    assert bias == 4.0, f"Expected Bias 4.0, got {bias}"

    # 2. MAE
    mae = calculate_mae(forecast, actual)
    assert mae == 20.0, f"Expected MAE 20.0, got {mae}"

    # 3. RMSE
    rmse = calculate_rmse(forecast, actual)
    assert round(rmse, 2) == 24.49, f"Expected RMSE 24.49, got {rmse}"
    assert np.isclose(rmse, np.sqrt(600.0))

    # 4. nMAE
    nmae = calculate_nmae(forecast, actual)
    assert round(nmae * 100.0, 2) == 16.13, f"Expected nMAE 16.13%, got {nmae * 100.0}"

    # 5. Overforecast Rate
    ovf = calculate_overforecast_rate(forecast, actual)
    assert ovf == 0.4, f"Expected Overforecast Rate 0.40, got {ovf}"

    # 6. Wind-Shortfall Energy (Hourly: 1.0h)
    shortfall = calculate_shortfall_energy_mwh(forecast, actual, interval_hours=1.0)
    assert shortfall == 60.0, f"Expected Shortfall 60.0 MWh, got {shortfall}"

    # 7. Wind-Surplus Energy (Hourly: 1.0h)
    surplus = calculate_surplus_energy_mwh(forecast, actual, interval_hours=1.0)
    assert surplus == 40.0, f"Expected Surplus 40.0 MWh, got {surplus}"

    # Half-hourly resolution checks (0.5h blocks)
    shortfall_hh = calculate_shortfall_energy_mwh(forecast, actual, interval_hours=0.5)
    assert shortfall_hh == 30.0, f"Expected Half-Hourly Shortfall 30.0 MWh, got {shortfall_hh}"

    surplus_hh = calculate_surplus_energy_mwh(forecast, actual, interval_hours=0.5)
    assert surplus_hh == 20.0, f"Expected Half-Hourly Surplus 20.0 MWh, got {surplus_hh}"

    # 8. Error Percentiles
    pcts = calculate_error_percentiles(forecast, actual, percentiles=(50, 90, 95))
    assert pcts["p50_mw"] == 20.0
    assert pcts["p90_mw"] == 36.0
    assert pcts["p95_mw"] == 38.0

    # 9. Comprehensive KPI Summary
    summary = compute_kpi_summary(forecast, actual, total_expected_intervals=5, interval_hours=1.0)
    assert summary["bias_mw"] == 4.0
    assert summary["mae_mw"] == 20.0
    assert summary["rmse_mw"] == 24.49
    assert summary["nmae_pct"] == 16.13
    assert summary["overforecast_rate"] == 0.40
    assert summary["shortfall_energy_mwh"] == 60.0
    assert summary["surplus_energy_mwh"] == 40.0
    assert summary["net_imbalance_energy_mwh"] == 20.0
    assert summary["percentiles"]["p50_abs_error_mw"] == 20.0


# ==============================================================================
# TEST 6: Cutoff Boundary Inclusion and Exclusion
# ==============================================================================
def test_cutoff_boundary_inclusion_and_exclusion():
    """
    Tests the strict mathematical boundary condition:
    - Rule: publishTime <= cutoff on D-1.
    - Forecast published EXACTLY at the cutoff second is eligible.
    - Forecast published 1 second (or 1 millisecond) later is strictly ineligible.
    """
    # Delivery Day: Jan 2, 2026 at 12:00:00 UTC
    target = pd.Timestamp("2026-01-02 12:00:00Z")
    # Cutoff: 09:00:00 UTC on Jan 1, 2026
    cutoff_time = pd.Timestamp("2026-01-01 09:00:00Z")

    forecast_before = {
        "start_time": target,
        "publish_time": pd.Timestamp("2026-01-01 08:59:59Z"),  # 1s before
        "forecast_generation_mw": 10000.0
    }
    forecast_exact = {
        "start_time": target,
        "publish_time": pd.Timestamp("2026-01-01 09:00:00Z"),  # EXACTLY at cutoff
        "forecast_generation_mw": 11000.0
    }
    forecast_after_1s = {
        "start_time": target,
        "publish_time": pd.Timestamp("2026-01-01 09:00:01Z"),  # 1s after
        "forecast_generation_mw": 15000.0
    }
    forecast_after_ms = {
        "start_time": target,
        "publish_time": pd.Timestamp("2026-01-01 09:00:00.001Z"),  # 1ms after
        "forecast_generation_mw": 99000.0
    }

    # Case A: When both exact and later forecasts exist, exact MUST be selected
    df_all = pd.DataFrame([forecast_before, forecast_exact, forecast_after_ms, forecast_after_1s])
    selected_a = select_decision_forecasts(df_all, ["2026-01-02"], cutoff_hour=9, cutoff_minute=0)

    assert len(selected_a) == 1
    row_a = selected_a.iloc[0]
    assert row_a["forecast_publish_time"] == cutoff_time, "Forecast exactly at cutoff must be selected"
    assert row_a["forecast_generation_mw"] == 11000.0, "Must not pick post-cutoff values"

    # Case B: When only post-cutoff forecasts exist, output MUST be empty
    df_post_only = pd.DataFrame([forecast_after_ms, forecast_after_1s])
    selected_b = select_decision_forecasts(df_post_only, ["2026-01-02"], cutoff_hour=9, cutoff_minute=0)
    assert len(selected_b) == 0, "Forecasts after cutoff second must produce empty selection"

    # Case C: When before (08:59:59) and after (09:00:01) exist (no exact), before must be chosen
    df_boundary = pd.DataFrame([forecast_before, forecast_after_1s])
    selected_c = select_decision_forecasts(df_boundary, ["2026-01-02"], cutoff_hour=9, cutoff_minute=0)
    assert len(selected_c) == 1
    row_c = selected_c.iloc[0]
    assert row_c["forecast_publish_time"] == pd.Timestamp("2026-01-01 08:59:59Z")
    assert row_c["forecast_generation_mw"] == 10000.0


# ==============================================================================
# TEST 7: Real-Data Snapshot Sanity Checks
# ==============================================================================
def test_real_data_snapshot_sanity_checks():
    """
    Validates physical, temporal, and relational integrity on the actual
    reproducible Parquet snapshots in data/processed/:
    - Horizons are strictly positive.
    - Selected publishTime is always strictly before target startTime.
    - Selected publishTime is always on or before cutoffTime.
    - Zero duplicate startTimes.
    - Interval counts match exactly: 24 per day (744 total) for hourly,
      48 per day (1,488 total) for half-hourly.
    - Energy volume equality (MWh) and physical generation bounds.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    processed_dir = os.path.join(base_dir, "data", "processed")

    dec_path = os.path.join(processed_dir, "decision_forecasts.parquet")
    hourly_path = os.path.join(processed_dir, "joined_analysis.parquet")
    hh_path = os.path.join(processed_dir, "half_hourly_analysis.parquet")

    assert os.path.exists(dec_path), f"Missing snapshot: {dec_path}"
    assert os.path.exists(hourly_path), f"Missing snapshot: {hourly_path}"
    assert os.path.exists(hh_path), f"Missing snapshot: {hh_path}"

    df_dec = pd.read_parquet(dec_path)
    df_hourly = pd.read_parquet(hourly_path)
    df_hh = pd.read_parquet(hh_path)

    # 1. Decision Forecasts Checks
    # Exactly 31 days in January * 24 hours = 744 rows
    assert len(df_dec) == 744, f"Expected 744 decision forecasts, got {len(df_dec)}"
    assert df_dec["start_time"].is_unique, "Duplicate startTime detected in decision forecasts"

    # Horizons must be strictly positive
    assert (df_dec["horizon_hours"] > 0).all(), "Negative or zero forecast horizon detected!"
    assert df_dec["horizon_hours"].min() >= 16.5, f"Minimum horizon too short: {df_dec['horizon_hours'].min()}"
    assert df_dec["horizon_hours"].max() <= 39.5, f"Maximum horizon too long: {df_dec['horizon_hours'].max()}"

    # Selected publish_time must be strictly before target start_time
    assert (df_dec["forecast_publish_time"] < df_dec["start_time"]).all(), (
        "Causality leak! publish_time >= start_time detected!"
    )

    # Selected publish_time must be strictly on or before cutoff_time (zero look-ahead)
    assert (df_dec["forecast_publish_time"] <= df_dec["cutoff_time"]).all(), (
        "Look-ahead bias leak! publish_time > cutoff_time detected!"
    )

    # Daily count check: exactly 24 intervals per delivery day
    dec_daily_counts = df_dec.groupby(pd.to_datetime(df_dec["start_time"]).dt.date).size()
    assert len(dec_daily_counts) == 31, "Must have all 31 delivery days in January 2026"
    assert (dec_daily_counts == 24).all(), "Every day must have exactly 24 hourly intervals"

    # 2. Hourly Joined Dataset Checks
    assert len(df_hourly) == 744, f"Expected 744 hourly rows, got {len(df_hourly)}"
    assert df_hourly["start_time"].is_unique, "Duplicate startTime in hourly joined dataset"
    assert df_hourly["actual_generation_mw"].isna().sum() == 0, "Missing actuals in January 2026 snapshot"
    assert df_hourly["forecast_generation_mw"].isna().sum() == 0, "Missing forecasts in January 2026 snapshot"

    # Physical generation bounds (realistic GB wind fleet: 0 to 30,000 MW)
    assert (df_hourly["actual_generation_mw"] >= 0).all(), "Negative actual wind generation!"
    assert (df_hourly["actual_generation_mw"] <= 30000).all(), "Unrealistic actual generation (> 30 GW)!"
    assert (df_hourly["forecast_generation_mw"] >= 0).all(), "Negative forecast wind generation!"
    assert (df_hourly["forecast_generation_mw"] <= 30000).all(), "Unrealistic forecast generation (> 30 GW)!"

    # Directional error check: error_mw == forecast - actual
    expected_error = df_hourly["forecast_generation_mw"] - df_hourly["actual_generation_mw"]
    assert np.allclose(df_hourly["error_mw"], expected_error, atol=1e-5), "Error sign mismatch"

    # Energy volume check: for 1-hour block, Power MW * 1h == Energy MWh
    assert np.allclose(df_hourly["forecast_energy_mwh"], df_hourly["forecast_generation_mw"] * 1.0)
    assert np.allclose(df_hourly["actual_energy_mwh"], df_hourly["actual_generation_mw"] * 1.0)

    # 3. Half-Hourly Dataset Checks
    # Exactly 31 days in January * 48 settlement periods = 1,488 rows
    assert len(df_hh) == 1488, f"Expected 1488 half-hourly rows, got {len(df_hh)}"
    assert df_hh["start_time"].is_unique, "Duplicate startTime in half-hourly dataset"

    # Settlement period sequence check: 1 to 48 for each day
    hh_daily_counts = df_hh.groupby(pd.to_datetime(df_hh["start_time"]).dt.date).size()
    assert (hh_daily_counts == 48).all(), "Every day must have exactly 48 settlement periods"

    # Energy volume check: for 30-min block, Power MW * 0.5h == Energy MWh
    assert np.allclose(df_hh["forecast_energy_mwh"], df_hh["forecast_generation_mw"] * 0.5)
    assert np.allclose(df_hh["actual_energy_mwh"], df_hh["actual_generation_mw"] * 0.5)

    # Total month actual energy MWh must match between hourly and half-hourly within rounding
    hourly_total_mwh = df_hourly["actual_energy_mwh"].sum()
    hh_total_mwh = df_hh["actual_energy_mwh"].sum()
    assert np.isclose(hourly_total_mwh, hh_total_mwh, rtol=1e-5), (
        f"Energy mismatch between resolutions: Hourly {hourly_total_mwh:.2f} MWh vs HH {hh_total_mwh:.2f} MWh"
    )
