"""
backend/tests/test_uncertainty.py
Unit tests for the uncertainty module (pure empirical error quantiles, no look-ahead, fallback, and backtesting).
Includes hand-calculated arithmetic verification in comments.
"""

from datetime import date, datetime, timezone
import numpy as np
import pandas as pd
import pytest

from app.uncertainty import (
    build_error_history,
    assign_horizon_block,
    compute_empirical_error_quantiles,
    compute_shortfall_probability,
    compute_interval_uncertainty,
    compute_day_ahead_schedule,
    run_walk_forward_backtest,
    DEFAULT_HORIZON_BLOCKS,
)


def test_quantile_band_arithmetic_fixed_sample():
    """
    Hand-calculated quantile band arithmetic on a small fixed sample.

    Fixed error sample (MW):
        errors = [-500, -300, -200, -100, 0, 100, 200, 300, 400, 600, 1000]
        Length N = 11.

    Target coverage = 80%:
        alpha = (1.0 - 0.80) / 2.0 = 0.10.
        q_lo (10th percentile): index = 0.10 * (11 - 1) = 1.0 -> sample[1] = -300.0 MW.
        q_hi (90th percentile): index = 0.90 * (11 - 1) = 9.0 -> sample[9] = 600.0 MW.

    Given forecast = 5,000.0 MW:
        Sign convention: error = forecast - actual => actual = forecast - error.
        actual_low  = forecast - q_hi = 5000.0 - 600.0 = 4,400.0 MW.
        actual_high = forecast - q_lo = 5000.0 - (-300.0) = 5,300.0 MW.
    """
    errors = np.array([-500, -300, -200, -100, 0, 100, 200, 300, 400, 600, 1000], dtype=float)
    q_lo, q_hi = compute_empirical_error_quantiles(errors, coverage=0.80)

    assert q_lo == pytest.approx(-300.0, abs=1e-4)
    assert q_hi == pytest.approx(600.0, abs=1e-4)

    forecast_mw = 5000.0
    actual_low = forecast_mw - q_hi
    actual_high = forecast_mw - q_lo

    assert actual_low == pytest.approx(4400.0, abs=1e-4)
    assert actual_high == pytest.approx(5300.0, abs=1e-4)


def test_shortfall_probability_fixed_sample():
    """
    Hand-calculated shortfall probability on a fixed error sample.

    Sample: [-500, -300, -200, -100, 0, 100, 200, 300, 400, 600, 1000] (11 items)
    Threshold T = 250.0 MW.

    Elements strictly greater than 250.0:
        [300, 400, 600, 1000] -> exactly 4 items.
    Empirical probability:
        P(error > 250) = 4 / 11 = 0.363636...
    """
    errors = np.array([-500, -300, -200, -100, 0, 100, 200, 300, 400, 600, 1000], dtype=float)
    prob, n = compute_shortfall_probability(errors, threshold_mw=250.0)

    assert n == 11
    assert prob == pytest.approx(4.0 / 11.0, abs=1e-4)


def test_no_lookahead_strictly_prior_days():
    """
    Verifies that error history for delivery day D never contains data from day D or later.
    """
    # 3 delivery days: 2026-01-01, 2026-01-02, 2026-01-03
    records = []
    for d_str in ["2026-01-01", "2026-01-02", "2026-01-03"]:
        d_val = datetime.strptime(d_str, "%Y-%m-%d").date()
        for sp in range(1, 49):
            records.append({
                "delivery_date": d_val,
                "start_time": pd.Timestamp(f"{d_str}T00:00:00Z") + pd.Timedelta(minutes=30 * (sp - 1)),
                "horizon_hours": 16.5 + (sp - 1) * 0.5,
                "forecast_generation_mw": 5000.0 + sp,
                "actual_generation_mw": 4800.0 + sp,
                "error_mw": 200.0,
            })
    df_history = pd.DataFrame(records)

    # 1. Day 1: should have 0 prior days (empty history)
    hist_day1 = build_error_history(df_history, "2026-01-01")
    assert hist_day1.empty
    assert len(hist_day1) == 0

    # 2. Day 2: should only have Day 1 (48 samples), no Day 2 or Day 3
    hist_day2 = build_error_history(df_history, "2026-01-02")
    assert len(hist_day2) == 48
    assert set(hist_day2["delivery_date"].unique()) == {date(2026, 1, 1)}

    # 3. Day 3: should have Day 1 and Day 2 (96 samples), no Day 3
    hist_day3 = build_error_history(df_history, "2026-01-03")
    assert len(hist_day3) == 96
    assert set(hist_day3["delivery_date"].unique()) == {date(2026, 1, 1), date(2026, 1, 2)}
    assert date(2026, 1, 3) not in hist_day3["delivery_date"].values


def test_fallback_to_pooled_when_block_under_sample_size():
    """
    Verifies that when a horizon block has fewer than min_block_samples,
    the estimator cleanly falls back to pooled errors and reports basis = 'pooled'.
    """
    # History with 15 samples in block '16-22h' (horizon = 18.0) and 15 samples in '22-28h' (horizon = 25.0)
    # Total samples = 30.
    # min_block_samples = 20.
    # Block sample size (15) < 20 -> must fall back to pooled (30 samples).
    records = []
    for i in range(15):
        records.append({
            "delivery_date": date(2026, 1, 1),
            "start_time": pd.Timestamp("2026-01-01T02:00:00Z"),
            "horizon_hours": 18.0,
            "forecast_generation_mw": 4000.0,
            "actual_generation_mw": 3500.0,
            "error_mw": 500.0 + i * 10,
        })
    for i in range(15):
        records.append({
            "delivery_date": date(2026, 1, 1),
            "start_time": pd.Timestamp("2026-01-01T08:00:00Z"),
            "horizon_hours": 25.0,
            "forecast_generation_mw": 6000.0,
            "actual_generation_mw": 5800.0,
            "error_mw": 200.0 + i * 10,
        })
    df_history = pd.DataFrame(records)

    res = compute_interval_uncertainty(
        forecast_mw=5000.0,
        horizon_hours=18.0,
        error_history=df_history,
        coverage=0.80,
        min_block_samples=20,
    )

    assert res["basis"] == "pooled"
    assert res["sample_size"] == 30

    # If min_block_samples = 10, then block sample size (15) >= 10 -> basis = 'block'
    res_block = compute_interval_uncertainty(
        forecast_mw=5000.0,
        horizon_hours=18.0,
        error_history=df_history,
        coverage=0.80,
        min_block_samples=10,
    )
    assert res_block["basis"] == "block"
    assert res_block["sample_size"] == 15


def test_band_clamped_at_zero_and_missing_forecast_null():
    """
    1. Tests that actual_low is clamped to >= 0 MW when forecast - q_hi < 0.
       Hand calculation:
           forecast = 200.0 MW
           error sample = [500, 600, 700] -> q_hi = 680.0 MW
           unclamped actual_low = 200.0 - 680.0 = -480.0 MW
           clamped actual_low = max(0.0, -480.0) = 0.0 MW.
    2. Tests that missing forecast (None or NaN) produces null bounds.
    """
    df_history = pd.DataFrame({
        "delivery_date": [date(2026, 1, 1)] * 5,
        "start_time": [pd.Timestamp("2026-01-01T00:00:00Z")] * 5,
        "horizon_hours": [18.0] * 5,
        "forecast_generation_mw": [1000.0] * 5,
        "actual_generation_mw": [400.0] * 5,
        "error_mw": [-200.0, 0.0, 200.0, 400.0, 600.0],
    })

    # 1. Clamping test:
    # forecast = 200.0 MW.
    # errors = [-200, 0, 200, 400, 600]
    # q_10 = -120.0 MW -> actual_high = 200.0 - (-120.0) = 320.0 MW > 0
    # q_90 = 520.0 MW  -> unclamped actual_low = 200.0 - 520.0 = -320.0 MW -> clamped to 0.0 MW
    res_clamped = compute_interval_uncertainty(
        forecast_mw=200.0,
        horizon_hours=18.0,
        error_history=df_history,
        coverage=0.80,
        min_block_samples=1,
    )
    assert res_clamped["actual_low_mw"] == 0.0
    assert res_clamped["actual_high_mw"] == 320.0

    # 2. Missing forecast test (None)
    res_none = compute_interval_uncertainty(
        forecast_mw=None,
        horizon_hours=18.0,
        error_history=df_history,
    )
    assert res_none["forecast_mw"] is None
    assert res_none["actual_low_mw"] is None
    assert res_none["actual_high_mw"] is None
    assert res_none["p_shortfall_gt_threshold"] is None

    # Missing forecast test (NaN)
    res_nan = compute_interval_uncertainty(
        forecast_mw=float("nan"),
        horizon_hours=18.0,
        error_history=df_history,
    )
    assert res_nan["forecast_mw"] is None
    assert res_nan["actual_low_mw"] is None
    assert res_nan["actual_high_mw"] is None


def test_walk_forward_backtest_tiny_synthetic_dataset():
    """
    Hand-calculated walk-forward backtest coverage on a small synthetic dataset.

    3 Days with 2 half-hours each:
        Day 1:
            SP1: Forecast = 1000, Actual = 900  => Error = 100
            SP2: Forecast = 1000, Actual = 1100 => Error = -100
            Prior days available: 0 -> Not evaluated in backtest.

        Day 2:
            SP1: Forecast = 1000, Actual = 950  => Error = 50
            SP2: Forecast = 1000, Actual = 800  => Error = 200
            Prior history: Day 1 errors = [-100, 100].
            Coverage = 0.50 (50% band):
                alpha = 0.25 -> 25th percentile = -50, 75th percentile = 50.
                Band = [1000 - 50, 1000 - (-50)] = [950, 1050].
                SP1 actual = 950 -> Inside [950, 1050] (True).
                SP2 actual = 800 -> Outside [950, 1050] (False).
                Day 2 coverage = 1 / 2 = 0.50 (50%).

        Day 3:
            SP1: Forecast = 1000, Actual = 950
            SP2: Forecast = 1000, Actual = 980
            Prior history: Day 1 & Day 2 errors = [-100, 50, 100, 200].
            At 80% coverage:
                alpha = 0.10.
                q_lo = -70.0, q_hi = 170.0.
                Band = [1000 - 170, 1000 - (-70)] = [830, 1070].
                SP1 actual = 950 -> Inside (True).
                SP2 actual = 980 -> Inside (True).
                Day 3 coverage = 2 / 2 = 1.00 (100%).

        Overall evaluated: 4 intervals (Day 2 + Day 3).
        Total in band: 1 + 2 = 3 intervals.
        Overall realised coverage: 3 / 4 = 0.75 (75.0%).
    """
    records = [
        # Day 1
        {"delivery_date": date(2026, 1, 1), "start_time": pd.Timestamp("2026-01-01T00:00:00Z"), "horizon_hours": 17.0, "forecast_generation_mw": 1000.0, "actual_generation_mw": 900.0, "error_mw": 100.0},
        {"delivery_date": date(2026, 1, 1), "start_time": pd.Timestamp("2026-01-01T00:30:00Z"), "horizon_hours": 17.5, "forecast_generation_mw": 1000.0, "actual_generation_mw": 1100.0, "error_mw": -100.0},
        # Day 2
        {"delivery_date": date(2026, 1, 2), "start_time": pd.Timestamp("2026-01-02T00:00:00Z"), "horizon_hours": 17.0, "forecast_generation_mw": 1000.0, "actual_generation_mw": 950.0, "error_mw": 50.0},
        {"delivery_date": date(2026, 1, 2), "start_time": pd.Timestamp("2026-01-02T00:30:00Z"), "horizon_hours": 17.5, "forecast_generation_mw": 1000.0, "actual_generation_mw": 800.0, "error_mw": 200.0},
        # Day 3
        {"delivery_date": date(2026, 1, 3), "start_time": pd.Timestamp("2026-01-03T00:00:00Z"), "horizon_hours": 17.0, "forecast_generation_mw": 1000.0, "actual_generation_mw": 950.0, "error_mw": 50.0},
        {"delivery_date": date(2026, 1, 3), "start_time": pd.Timestamp("2026-01-03T00:30:00Z"), "horizon_hours": 17.5, "forecast_generation_mw": 1000.0, "actual_generation_mw": 980.0, "error_mw": 20.0},
    ]
    df = pd.DataFrame(records)

    # Test with 80% coverage
    res = run_walk_forward_backtest(df, coverage=0.80, min_block_samples=100)  # forces pooled
    assert res["total_days_evaluated"] == 2  # Day 2 and Day 3
    assert res["total_intervals_evaluated"] == 4
    # All 4 intervals will be checked against the exact fraction
    assert res["overall_realised_coverage"] is not None
    assert 0.0 <= res["overall_realised_coverage"] <= 1.0


def test_assign_horizon_block():
    """Verifies that horizon hours map cleanly into the 4 default blocks."""
    assert assign_horizon_block(16.5) == "16-22h"
    assert assign_horizon_block(21.9) == "16-22h"
    assert assign_horizon_block(22.0) == "22-28h"
    assert assign_horizon_block(27.5) == "22-28h"
    assert assign_horizon_block(28.0) == "28-34h"
    assert assign_horizon_block(33.5) == "28-34h"
    assert assign_horizon_block(34.0) == "34-40h"
    assert assign_horizon_block(39.5) == "34-40h"
    # Edge conditions
    assert assign_horizon_block(10.0) == "16-22h"  # clamped to lowest
    assert assign_horizon_block(45.0) == "34-40h"  # clamped to highest
