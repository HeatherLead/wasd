"""
backend/tests/test_redesign_backend.py
Comprehensive test suite validating the redesigned analytical endpoints:
1. Box-plot statistics against a hand-verified example.
2. Buy-range arithmetic against a hand-calculated example (detailed in comments).
3. Strict no look-ahead guarantee for day D error quantiles (prior_days vs in_sample).
4. Clamping at 0 MW, empty demand handling, and missing-data invariance.
5. Summary over/under forecast split and normalised MAE.
6. Accuracy endpoint boxplot response model.
"""

import pytest
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.store import data_store
from app.metrics import (
    calculate_boxplot_statistics,
    calculate_buy_range_for_intervals,
    calculate_underforecast_rate,
)


@pytest.fixture(scope="module")
def client():
    data_store.load()
    with TestClient(app) as c:
        yield c


def test_boxplot_statistics_hand_calculated():
    """
    Hand-calculated Tukey boxplot verification:
    Dataset: [-200.0, -100.0, 0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 1500.0] (n=10)
    Sorted values:
      Index:    0       1      2      3      4      5      6      7      8       9
      Value: -200    -100      0    100    200    300    400    500    600    1500

    Percentile (linear interpolation):
      Q1 (25%): 0.25 * 9 = 2.25 -> value = 0 + 0.25*(100 - 0) = 25.0 (or numpy linear: -25.0 depending on method)
      Numpy default (linear):
        np.percentile(data, 25) = 25.0
        np.percentile(data, 50) = 250.0
        np.percentile(data, 75) = 475.0
      IQR = Q3 - Q1 = 475.0 - 25.0 = 450.0
      Lower fence = Q1 - 1.5 * IQR = 25.0 - 675.0 = -650.0
      Upper fence = Q3 + 1.5 * IQR = 475.0 + 675.0 = 1150.0
      Points inside [-650.0, 1150.0]: [-200, -100, 0, 100, 200, 300, 400, 500, 600]
      Whisker low = smallest inside point = -200.0
      Whisker high = largest inside point = 600.0
      Outliers: [1500.0]
    """
    errors = [-200.0, -100.0, 0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 1500.0]
    stats = calculate_boxplot_statistics(errors)

    assert stats["sample_count"] == 10
    assert stats["min_mw"] == -200.0
    assert stats["max_mw"] == 1500.0
    assert stats["q1_mw"] == 25.0
    assert stats["median_mw"] == 250.0
    assert stats["q3_mw"] == 475.0
    assert stats["iqr_mw"] == 450.0
    assert stats["whisker_low_mw"] == -200.0
    assert stats["whisker_high_mw"] == 600.0
    assert stats["outliers"] == [1500.0]


def test_buy_range_arithmetic_hand_calculated():
    """
    Hand-calculated Buy Range Arithmetic:
    Parameters:
      demand_mw = 1000.0 MW
      forecasts = [800.0, 1200.0, 600.0] MW
      p10_error = -150.0 MW (under-forecast / surplus event)
      p50_error = +200.0 MW (central forecast error)
      p90_error = +500.0 MW (severe over-forecast / deficit event)
      interval_hours = 0.5 h (30-minute interval)

    Interval 0 (Forecast 800 MW):
      raw base need = demand - forecast = 1000 - 800 = 200 MW
      base_need_mw = max(0, 200) = 200.0 MW
      low_need_mw = max(0, 200 + (-150)) = 50.0 MW
      central_need_mw = max(0, 200 + 200) = 400.0 MW
      high_need_mw = max(0, 200 + 500) = 700.0 MW

    Interval 1 (Forecast 1200 MW > Demand 1000 MW):
      raw base need = 1000 - 1200 = -200 MW
      base_need_mw = max(0, -200) = 0.0 MW (clamped at 0!)
      low_need_mw = max(0, -200 + (-150)) = max(0, -350) = 0.0 MW (clamped at 0!)
      central_need_mw = max(0, -200 + 200) = max(0, 0) = 0.0 MW
      high_need_mw = max(0, -200 + 500) = max(0, 300) = 300.0 MW

    Interval 2 (Forecast 600 MW):
      raw base need = 1000 - 600 = 400 MW
      base_need_mw = max(0, 400) = 400.0 MW
      low_need_mw = max(0, 400 - 150) = 250.0 MW
      central_need_mw = max(0, 400 + 200) = 600.0 MW
      high_need_mw = max(0, 400 + 500) = 900.0 MW

    Totals (Sum * 0.5 h):
      forecast_total_mwh = (800 + 1200 + 600) * 0.5 = 1300.0 MWh
      demand_total_mwh = 1000 * 3 * 0.5 = 1500.0 MWh
      base_need_total_mwh = (200 + 0 + 400) * 0.5 = 300.0 MWh
      low_need_total_mwh = (50 + 0 + 250) * 0.5 = 150.0 MWh
      central_need_total_mwh = (400 + 0 + 600) * 0.5 = 500.0 MWh
      high_need_total_mwh = (700 + 300 + 900) * 0.5 = 950.0 MWh

    Peak values:
      peak_high_need_mw = max(700, 300, 900) = 900.0 MW
      peak_low_need_mw = max(50, 0, 250) = 250.0 MW
      peak_range_mw = max(700-50, 300-0, 900-250) = max(650, 300, 650) = 650.0 MW
    """
    forecasts = [800.0, 1200.0, 600.0]
    demand = 1000.0
    p10 = -150.0
    p50 = 200.0
    p90 = 500.0

    intervals, totals = calculate_buy_range_for_intervals(
        forecast_values=forecasts,
        demand_mw=demand,
        p10_error=p10,
        p50_error=p50,
        p90_error=p90,
        interval_hours=0.5,
    )

    # Interval 0
    assert intervals[0]["forecast_mw"] == 800.0
    assert intervals[0]["base_need_mw"] == 200.0
    assert intervals[0]["low_need_mw"] == 50.0
    assert intervals[0]["central_need_mw"] == 400.0
    assert intervals[0]["high_need_mw"] == 700.0

    # Interval 1 (Clamping verification)
    assert intervals[1]["forecast_mw"] == 1200.0
    assert intervals[1]["base_need_mw"] == 0.0
    assert intervals[1]["low_need_mw"] == 0.0
    assert intervals[1]["central_need_mw"] == 0.0
    assert intervals[1]["high_need_mw"] == 300.0

    # Interval 2
    assert intervals[2]["forecast_mw"] == 600.0
    assert intervals[2]["base_need_mw"] == 400.0
    assert intervals[2]["low_need_mw"] == 250.0
    assert intervals[2]["central_need_mw"] == 600.0
    assert intervals[2]["high_need_mw"] == 900.0

    # Totals in MWh
    assert totals["forecast_total_mwh"] == 1300.0
    assert totals["demand_total_mwh"] == 1500.0
    assert totals["base_need_total_mwh"] == 300.0
    assert totals["low_need_total_mwh"] == 150.0
    assert totals["central_need_total_mwh"] == 500.0
    assert totals["high_need_total_mwh"] == 950.0
    assert totals["peak_high_need_mw"] == 900.0
    assert totals["peak_low_need_mw"] == 250.0
    assert totals["peak_range_mw"] == 650.0


def test_buy_range_missing_data_invariance():
    """Missing forecasts must stay null, never silently becoming zero."""
    forecasts = [500.0, None, float("nan")]
    intervals, totals = calculate_buy_range_for_intervals(
        forecast_values=forecasts,
        demand_mw=1000.0,
        p10_error=-100.0,
        p50_error=100.0,
        p90_error=300.0,
        interval_hours=0.5,
    )

    assert intervals[0]["forecast_mw"] == 500.0
    assert intervals[0]["base_need_mw"] == 500.0

    # Missing items remain None across all derived need fields
    assert intervals[1]["forecast_mw"] is None
    assert intervals[1]["base_need_mw"] is None
    assert intervals[1]["low_need_mw"] is None
    assert intervals[1]["central_need_mw"] is None
    assert intervals[1]["high_need_mw"] is None

    assert intervals[2]["forecast_mw"] is None
    assert intervals[2]["base_need_mw"] is None


def test_buy_range_empty_demand_handling(client):
    """
    When demand_mw is empty/omitted, the endpoint should return wind-only data
    with need metrics set to null, without throwing an error.
    """
    response = client.get("/api/buy-range?date=2026-01-15&cutoff_time=09:00")
    assert response.status_code == 200
    data = response.json()

    assert data["delivery_date"] == "2026-01-15"
    assert data["demand_mw"] is None
    assert len(data["intervals"]) == 48

    first = data["intervals"][0]
    assert first["forecast_mw"] is not None
    assert first["base_need_mw"] is None
    assert first["low_need_mw"] is None
    assert first["central_need_mw"] is None
    assert first["high_need_mw"] is None

    assert data["totals"]["demand_total_mwh"] is None
    assert data["totals"]["base_need_total_mwh"] is None


def test_buy_range_no_lookahead_guarantee(client):
    """
    Verifies that error quantiles for day D strictly use only days BEFORE D:
    - For Jan 15: exactly 14 prior days (Jan 1-14) exist (>= 7), so basis is 'prior_days'.
    - For Jan 3: only 2 prior days (Jan 1-2) exist (< 7), so basis falls back to 'in_sample'.
    """
    # 1. Day with >= 7 prior days
    res15 = client.get("/api/buy-range?date=2026-01-15&demand_mw=12000&cutoff_time=09:00")
    assert res15.status_code == 200
    d15 = res15.json()
    assert d15["basis"] == "prior_days"
    assert d15["prior_days_count"] == 14
    assert "Based on 14 days" in d15["note"]

    # 2. Day with < 7 prior days
    res3 = client.get("/api/buy-range?date=2026-01-03&demand_mw=12000&cutoff_time=09:00")
    assert res3.status_code == 200
    d3 = res3.json()
    assert d3["basis"] == "in_sample"
    assert d3["prior_days_count"] == 2
    assert "In-sample estimate" in d3["note"]


def test_buy_range_input_validation(client):
    """Invalid dates, negative demand, and malformed cutoffs must return 400."""
    # Negative demand
    r1 = client.get("/api/buy-range?date=2026-01-15&demand_mw=-100")
    assert r1.status_code == 400
    assert "demand_mw must be non-negative" in r1.json()["detail"]

    # Invalid date
    r2 = client.get("/api/buy-range?date=invalid-date&demand_mw=1000")
    assert r2.status_code == 400

    # Non-existent date
    r3 = client.get("/api/buy-range?date=2026-02-15&demand_mw=1000")
    assert r3.status_code == 404


def test_summary_includes_over_under_and_normalised_mae(client):
    """Verifies that /api/summary returns normalised_mae and share of over/under forecast intervals."""
    res = client.get("/api/summary?cutoff_time=09:00")
    assert res.status_code == 200
    data = res.json()
    kpis = data["kpis"]

    assert "normalised_mae" in kpis
    assert kpis["normalised_mae"] is not None
    assert 0.10 <= kpis["normalised_mae"] <= 0.30

    assert "share_intervals_overforecast" in kpis
    assert "share_intervals_underforecast" in kpis
    assert kpis["share_intervals_overforecast"] is not None
    assert kpis["share_intervals_underforecast"] is not None

    # Share sum <= 1.0
    total_share = kpis["share_intervals_overforecast"] + kpis["share_intervals_underforecast"]
    assert total_share <= 1.0001
    assert kpis["share_intervals_overforecast"] > 0.50  # We know Jan 2026 was ~85% overforecast


def test_accuracy_includes_box_plot(client):
    """Verifies that /api/accuracy includes the new box_plot statistics structure."""
    res = client.get("/api/accuracy?cutoff_time=09:00")
    assert res.status_code == 200
    data = res.json()

    assert "box_plot" in data
    box = data["box_plot"]
    assert box is not None
    assert "whisker_low_mw" in box
    assert "q1_mw" in box
    assert "median_mw" in box
    assert "q3_mw" in box
    assert "whisker_high_mw" in box
    assert "outliers" in box
    assert isinstance(box["outliers"], list)
    assert box["sample_count"] > 0
    assert box["whisker_low_mw"] <= box["q1_mw"] <= box["median_mw"] <= box["q3_mw"] <= box["whisker_high_mw"]
