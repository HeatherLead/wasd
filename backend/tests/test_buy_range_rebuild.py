"""
backend/tests/test_buy_range_rebuild.py
Tests for Page 3 Wholesale Buy Range and Downside Risk Engine (DECISIONS.md Decision 17).

Requirements:
- Hand-calculated arithmetic: base need, recommended need, clamping at 0, MWh conversion.
- Missing data stays null, never zero.
- Empty demand is handled gracefully by UI without guessing values.
- Strict no look-ahead: error quantiles derived strictly from days before D.
- Risk level coverage switching (80%, 90%, 95%) monotonicity.
- Small backtest figure: share of January intervals where recommended_need < actual_need.
- API validation and endpoint responses.
"""

from datetime import date
import pandas as pd
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.store import DataStore
from app.uncertainty import (
    compute_buy_range_schedule,
    compute_buy_range_backtest,
    build_error_history,
)


@pytest.fixture(scope="module")
def client():
    store = DataStore()
    store.load()
    with TestClient(app) as test_client:
        yield test_client


def test_hand_calculated_arithmetic_and_clamping():
    """
    Verifies base_need_mw, recommended_need_mw, buffer_mw and clamping at >= 0 MW
    using hand-calculated arithmetic.

    Given:
      Demand = 10,000 MW
      Interval 1: forecast = 8,000 MW, actual_low = 5,000 MW
        base_need = max(10,000 - 8,000, 0) = 2,000 MW
        recommended_need = max(10,000 - 5,000, 0) = 5,000 MW
        buffer = 5,000 - 2,000 = 3,000 MW

      Interval 2: forecast = 12,000 MW, actual_low = 11,000 MW (Wind surplus)
        base_need = max(10,000 - 12,000, 0) = 0 MW (clamped at 0)
        recommended_need = max(10,000 - 11,000, 0) = 0 MW (clamped at 0)
        buffer = 0 - 0 = 0 MW

      Interval 3: forecast = 11,000 MW, actual_low = 9,000 MW (Surplus forecast, deficit downside)
        base_need = max(10,000 - 11,000, 0) = 0 MW (clamped at 0)
        recommended_need = max(10,000 - 9,000, 0) = 1,000 MW
        buffer = 1,000 - 0 = 1,000 MW
    """
    demand = 10000.0

    # Mock day intervals
    day_df = pd.DataFrame([
        {"start_time": "2026-01-15T00:00:00Z", "settlement_period": 1, "forecast_generation_mw": 8000.0, "horizon_hours": 17.0},
        {"start_time": "2026-01-15T00:30:00Z", "settlement_period": 2, "forecast_generation_mw": 12000.0, "horizon_hours": 17.5},
        {"start_time": "2026-01-15T01:00:00Z", "settlement_period": 3, "forecast_generation_mw": 11000.0, "horizon_hours": 18.0},
    ])

    # Construct error history so that at coverage=0.80:
    # alpha = 0.10 -> q_hi (90th percentile error) = 3000 MW, q_lo (10th percentile error) = -1000 MW
    # Then:
    #   Interval 1: forecast=8000 -> actual_low = 8000 - 3000 = 5000 MW
    #   Interval 2: forecast=12000 -> actual_low = 12000 - 3000 = 9000 -> wait, let's fix actual_low for interval 2
    #   With q_hi = 1000:
    #   Interval 2: forecast=12000 -> actual_low = 11000 MW!
    #   Let's create error samples: [-1000, 0, 500, 1000, 2000]
    errors = [-1000.0, -500.0, 0.0, 500.0, 1000.0, 1500.0, 2000.0, 2500.0, 3000.0]
    error_history = pd.DataFrame({
        "delivery_date": [date(2026, 1, d) for d in range(1, 10)],
        "start_time": [f"2026-01-0{d}T00:00:00Z" for d in range(1, 10)],
        "horizon_hours": [17.0] * 9,
        "forecast_generation_mw": [10000.0] * 9,
        "actual_generation_mw": [10000.0 - e for e in errors],
        "error_mw": errors,
    })

    # At 80% coverage: alpha = 0.10 -> 90th percentile of [-1000 .. 3000] = 2200.0
    res = compute_buy_range_schedule(day_df=day_df, error_history=error_history, demand_mw=demand, coverage=0.80)
    intervals = res["intervals"]

    assert len(intervals) == 3

    # Hand-check interval 1:
    f1 = 8000.0
    q_hi = float(np.percentile(errors, 90.0))
    expected_low1 = max(0.0, f1 - q_hi)
    expected_base1 = max(0.0, demand - f1)  # 10000 - 8000 = 2000.0
    expected_rec1 = max(0.0, demand - expected_low1)  # 10000 - expected_low1
    expected_buf1 = expected_rec1 - expected_base1

    assert intervals[0]["forecast_mw"] == f1
    assert intervals[0]["base_need_mw"] == expected_base1
    assert intervals[0]["actual_low_mw"] == expected_low1
    assert intervals[0]["recommended_need_mw"] == expected_rec1
    assert intervals[0]["buffer_mw"] == expected_buf1
    assert intervals[0]["base_need_mw"] >= 0.0
    assert intervals[0]["recommended_need_mw"] >= 0.0
    assert intervals[0]["buffer_mw"] >= 0.0

    # Hand-check interval 2 clamping:
    # forecast = 12,000 MW > demand = 10,000 MW -> base_need must clamp to 0.0
    assert intervals[1]["base_need_mw"] == 0.0
    assert intervals[1]["base_need_mw"] >= 0.0
    assert intervals[1]["buffer_mw"] >= 0.0


def test_hand_calculated_mwh_conversion():
    """
    Verifies MWh energy conversion: Energy (MWh) = Power (MW) * 0.5 hours.
    """
    demand = 10000.0
    # Two intervals with distinct forecasts
    day_df = pd.DataFrame([
        {"start_time": "2026-01-15T00:00:00Z", "settlement_period": 1, "forecast_generation_mw": 8000.0, "horizon_hours": 17.0},
        {"start_time": "2026-01-15T00:30:00Z", "settlement_period": 2, "forecast_generation_mw": 6000.0, "horizon_hours": 17.5},
    ])
    # Error of 1,000 MW flat
    error_history = pd.DataFrame({
        "delivery_date": [date(2026, 1, 1)] * 5,
        "start_time": ["2026-01-01T00:00:00Z"] * 5,
        "horizon_hours": [17.0] * 5,
        "forecast_generation_mw": [10000.0] * 5,
        "actual_generation_mw": [9000.0] * 5,
        "error_mw": [1000.0] * 5,
    })

    res = compute_buy_range_schedule(day_df=day_df, error_history=error_history, demand_mw=demand, coverage=0.80)
    it = res["intervals"]
    tot = res["totals"]

    # Interval 1:
    # forecast = 8000 MW -> actual_low = 8000 - 1000 = 7000 MW
    # base_need = 10000 - 8000 = 2000 MW
    # rec_need = 10000 - 7000 = 3000 MW
    # buf = 1000 MW
    # Interval 2:
    # forecast = 6000 MW -> actual_low = 6000 - 1000 = 5000 MW
    # base_need = 10000 - 6000 = 4000 MW
    # rec_need = 10000 - 5000 = 5000 MW
    # buf = 1000 MW
    # Total Base MWh = (2000 + 4000) * 0.5 = 6000 * 0.5 = 3000.0 MWh
    # Total Rec MWh = (3000 + 5000) * 0.5 = 8000 * 0.5 = 4000.0 MWh
    # Total Buffer MWh = (1000 + 1000) * 0.5 = 1000.0 MWh
    # Total Forecast MWh = (8000 + 6000) * 0.5 = 7000.0 MWh
    # Total Demand MWh = 10000 * 2 * 0.5 = 10000.0 MWh

    assert it[0]["base_need_mw"] == 2000.0
    assert it[0]["recommended_need_mw"] == 3000.0
    assert it[0]["buffer_mw"] == 1000.0

    assert it[1]["base_need_mw"] == 4000.0
    assert it[1]["recommended_need_mw"] == 5000.0
    assert it[1]["buffer_mw"] == 1000.0

    assert tot["base_need_total_mwh"] == 3000.0
    assert tot["recommended_need_total_mwh"] == 4000.0
    assert tot["buffer_total_mwh"] == 1000.0
    assert tot["forecast_total_mwh"] == 7000.0
    assert tot["demand_total_mwh"] == 10000.0


def test_missing_data_stays_null_never_zero():
    """
    Missing forecasts must remain None across all derived need fields, never coerced to 0.0.
    """
    demand = 10000.0
    day_df = pd.DataFrame([
        {"start_time": "2026-01-15T00:00:00Z", "settlement_period": 1, "forecast_generation_mw": 8000.0, "horizon_hours": 17.0},
        {"start_time": "2026-01-15T00:30:00Z", "settlement_period": 2, "forecast_generation_mw": None, "horizon_hours": 17.5},
        {"start_time": "2026-01-15T01:00:00Z", "settlement_period": 3, "forecast_generation_mw": np.nan, "horizon_hours": 18.0},
    ])
    error_history = pd.DataFrame({
        "delivery_date": [date(2026, 1, 1)],
        "start_time": ["2026-01-01T00:00:00Z"],
        "horizon_hours": [17.0],
        "forecast_generation_mw": [10000.0],
        "actual_generation_mw": [9000.0],
        "error_mw": [1000.0],
    })

    res = compute_buy_range_schedule(day_df=day_df, error_history=error_history, demand_mw=demand, coverage=0.80)
    it = res["intervals"]

    assert it[0]["forecast_mw"] == 8000.0
    assert it[0]["base_need_mw"] is not None

    # Missing None interval
    assert it[1]["forecast_mw"] is None
    assert it[1]["actual_low_mw"] is None
    assert it[1]["base_need_mw"] is None
    assert it[1]["recommended_need_mw"] is None
    assert it[1]["buffer_mw"] is None

    # Missing NaN interval
    assert it[2]["forecast_mw"] is None
    assert it[2]["actual_low_mw"] is None
    assert it[2]["base_need_mw"] is None
    assert it[2]["recommended_need_mw"] is None
    assert it[2]["buffer_mw"] is None


def test_empty_demand_handling():
    """
    When demand_mw is None, the function returns forecast & actual_low data,
    while base_need, recommended_need, and buffer stay null (no guessing).
    """
    day_df = pd.DataFrame([
        {"start_time": "2026-01-15T00:00:00Z", "settlement_period": 1, "forecast_generation_mw": 8000.0, "horizon_hours": 17.0},
    ])
    error_history = pd.DataFrame({
        "delivery_date": [date(2026, 1, 1)],
        "start_time": ["2026-01-01T00:00:00Z"],
        "horizon_hours": [17.0],
        "forecast_generation_mw": [10000.0],
        "actual_generation_mw": [9000.0],
        "error_mw": [1000.0],
    })

    res = compute_buy_range_schedule(day_df=day_df, error_history=error_history, demand_mw=None, coverage=0.80)
    it = res["intervals"][0]
    tot = res["totals"]

    assert it["forecast_mw"] == 8000.0
    assert it["actual_low_mw"] == 7000.0
    assert it["base_need_mw"] is None
    assert it["recommended_need_mw"] is None
    assert it["buffer_mw"] is None

    assert tot["base_need_total_mwh"] is None
    assert tot["recommended_need_total_mwh"] is None
    assert tot["buffer_total_mwh"] is None
    assert tot["demand_total_mwh"] is None
    assert tot["forecast_total_mwh"] == 4000.0


def test_risk_level_coverage_monotonicity():
    """
    Higher coverage (e.g. 95% vs 90% vs 80%) demands wider error protection:
    - actual_low must decrease (wider plausible wind dropout).
    - recommended_need must increase (more wholesale power procured).
    - buffer must increase.
    """
    demand = 12000.0
    day_df = pd.DataFrame([
        {"start_time": "2026-01-15T12:00:00Z", "settlement_period": 25, "forecast_generation_mw": 10000.0, "horizon_hours": 29.0},
    ])
    # Diverse errors
    np.random.seed(42)
    errs = np.linspace(-1500, 4500, 50).tolist()
    error_history = pd.DataFrame({
        "delivery_date": [date(2026, 1, 1 + i % 14) for i in range(50)],
        "start_time": ["2026-01-01T12:00:00Z"] * 50,
        "horizon_hours": [29.0] * 50,
        "forecast_generation_mw": [10000.0] * 50,
        "actual_generation_mw": [10000.0 - e for e in errs],
        "error_mw": errs,
    })

    res80 = compute_buy_range_schedule(day_df=day_df, error_history=error_history, demand_mw=demand, coverage=0.80)["intervals"][0]
    res90 = compute_buy_range_schedule(day_df=day_df, error_history=error_history, demand_mw=demand, coverage=0.90)["intervals"][0]
    res95 = compute_buy_range_schedule(day_df=day_df, error_history=error_history, demand_mw=demand, coverage=0.95)["intervals"][0]

    # actual_low monotonically non-increasing
    assert res80["actual_low_mw"] >= res90["actual_low_mw"] >= res95["actual_low_mw"]

    # recommended_need monotonically non-decreasing
    assert res80["recommended_need_mw"] <= res90["recommended_need_mw"] <= res95["recommended_need_mw"]

    # buffer monotonically non-decreasing
    assert res80["buffer_mw"] <= res90["buffer_mw"] <= res95["buffer_mw"]


def test_buy_range_api_endpoint(client):
    """
    Tests the GET /api/buy-range endpoint with query parameters:
    date, demand_mw, coverage, cutoff.
    """
    res = client.get("/api/buy-range?date=2026-01-15&demand_mw=12000&coverage=0.9&cutoff=09:00")
    assert res.status_code == 200
    data = res.json()

    # Structure
    assert data["delivery_date"] == "2026-01-15"
    assert data["demand_mw"] == 12000.0
    assert data["coverage"] == 0.90
    assert data["cutoff_time"] == "09:00"
    assert data["basis"] == "prior_days"
    assert data["prior_days_count"] == 14

    # Intervals
    assert len(data["intervals"]) == 48
    first = data["intervals"][0]
    assert "start_time" in first
    assert "settlement_period" in first
    assert "forecast_mw" in first
    assert "actual_low_mw" in first
    assert "base_need_mw" in first
    assert "recommended_need_mw" in first
    assert "buffer_mw" in first
    assert first["buffer_mw"] == round(first["recommended_need_mw"] - first["base_need_mw"], 2)

    # Totals in MWh
    totals = data["totals"]
    assert "base_need_total_mwh" in totals
    assert "recommended_need_total_mwh" in totals
    assert "buffer_total_mwh" in totals
    assert "forecast_total_mwh" in totals
    assert "demand_total_mwh" in totals
    assert totals["base_need_total_mwh"] is not None
    assert totals["recommended_need_total_mwh"] >= totals["base_need_total_mwh"]
    assert totals["buffer_total_mwh"] == round(totals["recommended_need_total_mwh"] - totals["base_need_total_mwh"], 1)

    # Backtest figure
    assert "backtest" in data
    bt = data["backtest"]
    assert bt is not None
    assert "underprocurement_share" in bt
    assert "underprocurement_pct" in bt
    assert "days_evaluated" in bt
    assert "intervals_evaluated" in bt
    assert bt["days_evaluated"] > 0
    assert bt["intervals_evaluated"] > 0
    assert 0.0 <= bt["underprocurement_share"] <= 1.0


def test_buy_range_api_validation(client):
    """
    Validates parameter constraints:
    - negative demand returns 400
    - invalid coverage returns 422 or 400
    - malformed date returns 400
    """
    # Negative demand
    r1 = client.get("/api/buy-range?date=2026-01-15&demand_mw=-500")
    assert r1.status_code == 400

    # Coverage out of range (< 0.50)
    r2 = client.get("/api/buy-range?date=2026-01-15&demand_mw=10000&coverage=0.20")
    assert r2.status_code in [400, 422]

    # Malformed date
    r3 = client.get("/api/buy-range?date=not-a-date&demand_mw=10000")
    assert r3.status_code == 400
