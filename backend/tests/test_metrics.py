"""
backend/tests/test_metrics.py
Unit tests for pure functions in app.metrics.
"""

import numpy as np
import pandas as pd
import pytest
from app.metrics import (
    calculate_bias,
    calculate_mae,
    calculate_rmse,
    calculate_nmae,
    calculate_overforecast_rate,
    calculate_error_percentiles,
    calculate_coverage,
    compute_kpi_summary,
)


def test_metrics_calculation_standard():
    forecast = [100.0, 150.0, 200.0, 80.0]
    actual =   [90.0,  130.0, 220.0, 80.0]
    # Errors: [10, 20, -20, 0]
    # Bias = (10 + 20 - 20 + 0) / 4 = 10 / 4 = 2.5
    # Abs errors: [10, 20, 20, 0]
    # MAE = 50 / 4 = 12.5
    # Sq errors: [100, 400, 400, 0] = 900 / 4 = 225
    # RMSE = sqrt(225) = 15.0
    # Mean actual = (90 + 130 + 220 + 80) / 4 = 520 / 4 = 130.0
    # nMAE = 12.5 / 130.0 = 0.09615
    # Overforecast: 2 out of 4 (100>90, 150>130) = 0.50

    assert calculate_bias(forecast, actual) == 2.5
    assert calculate_mae(forecast, actual) == 12.5
    assert calculate_rmse(forecast, actual) == 15.0
    assert round(calculate_nmae(forecast, actual), 4) == 0.0962
    assert calculate_overforecast_rate(forecast, actual) == 0.5


def test_metrics_ignores_nans_without_zero_imputation():
    forecast = [100.0, np.nan, 200.0]
    actual =   [90.0,  150.0,  np.nan]
    # Only pair 0 is valid: forecast 100, actual 90 -> error = 10
    assert calculate_bias(forecast, actual) == 10.0
    assert calculate_mae(forecast, actual) == 10.0
    assert calculate_rmse(forecast, actual) == 10.0


def test_metrics_empty_inputs_return_none():
    assert calculate_bias([], []) is None
    assert calculate_mae([], []) is None
    assert calculate_rmse([], []) is None
    assert calculate_nmae([], []) is None
    assert calculate_overforecast_rate([], []) is None


def test_coverage_calculation():
    cov = calculate_coverage(total_expected=48, valid_count=46)
    assert cov["total_expected_intervals"] == 48
    assert cov["valid_intervals"] == 46
    assert cov["missing_intervals"] == 2
    assert cov["coverage_pct"] == 95.83


def test_percentiles_calculation():
    # Errors: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    actual = np.zeros(10)
    forecast = np.array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    p = calculate_error_percentiles(forecast, actual, percentiles=(50, 90))
    assert p["p50_mw"] == 55.0
    assert p["p90_mw"] == 91.0


def test_shortfall_and_surplus_energy():
    from app.metrics import calculate_shortfall_energy_mwh, calculate_surplus_energy_mwh, calculate_p90_shortfall_mw
    
    # 3 intervals of 1.0 hour:
    # 1: Forecast 120, Actual 100 -> Shortfall = 20 MW, Surplus = 0 MW
    # 2: Forecast 80,  Actual 110 -> Shortfall = 0 MW,  Surplus = 30 MW
    # 3: Forecast 150, Actual 100 -> Shortfall = 50 MW, Surplus = 0 MW
    forecast = [120.0, 80.0, 150.0]
    actual =   [100.0, 110.0, 100.0]

    # Total shortfall = (20 + 0 + 50) * 1.0 = 70 MWh
    shortfall = calculate_shortfall_energy_mwh(forecast, actual, interval_hours=1.0)
    assert shortfall == 70.0

    # Total surplus = (0 + 30 + 0) * 1.0 = 30 MWh
    surplus = calculate_surplus_energy_mwh(forecast, actual, interval_hours=1.0)
    assert surplus == 30.0

    # For half-hourly (0.5h):
    shortfall_hh = calculate_shortfall_energy_mwh(forecast, actual, interval_hours=0.5)
    assert shortfall_hh == 35.0

    # P90 of positive shortfalls [20, 50]:
    p90 = calculate_p90_shortfall_mw(forecast, actual)
    assert p90 is not None
    assert p90 > 20.0

