"""
backend/tests/test_day_ahead_api.py
Integration tests for the /api/day-ahead and /api/day-ahead/validation endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_day_ahead_endpoint_structure(client):
    """
    Verifies that GET /api/day-ahead returns the complete schema with 48 intervals,
    risk summary, basis metadata, and status.
    """
    response = client.get("/api/day-ahead?date=2026-01-15&cutoff=09:00&coverage=0.8")
    assert response.status_code == 200
    data = response.json()

    # 1. Status block
    status = data["status"]
    assert status["delivery_date"] == "2026-01-15"
    assert status["cutoff_utc"] == "09:00"
    assert status["intervals_expected"] == 48
    assert status["intervals_available"] == 48
    assert status["is_complete"] is True
    assert status["snapshot_built_at"] == "2026-02-01T00:00:00Z"
    assert "earliest" in status["forecast_publish_range"]
    assert "latest" in status["forecast_publish_range"]

    # 2. Risk summary block
    risk = data["risk_summary"]
    assert "expected_bias_mw" in risk
    assert risk["threshold_mw"] > 0.0  # data-derived default
    assert "mean_p_shortfall_gt_threshold" in risk
    assert "severe_downside_mwh" in risk
    assert risk["severe_downside_coverage"] == 0.90
    assert len(risk["top_risk_intervals"]) <= 5
    if risk["top_risk_intervals"]:
        first_top = risk["top_risk_intervals"][0]
        assert "p_shortfall_gt_threshold" in first_top
        assert "forecast_mw" in first_top

    # 3. Basis metadata
    basis_meta = data["basis_metadata"]
    assert basis_meta["method_name"] == "empirical error quantiles"
    assert basis_meta["coverage"] == 0.80
    assert basis_meta["prior_days_count"] == 13  # Jan 1 - Jan 13 completed prior to D-1 09:00 cutoff
    assert basis_meta["total_prior_error_samples"] == 13 * 48

    # 4. Intervals
    intervals = data["intervals"]
    assert len(intervals) == 48
    first = intervals[0]
    assert first["settlement_period"] == 1
    assert first["forecast_mw"] is not None
    assert first["actual_low_mw"] is not None
    assert first["actual_high_mw"] is not None
    assert first["actual_low_mw"] >= 0.0  # clamped >= 0
    assert first["actual_high_mw"] >= first["actual_low_mw"]
    assert first["basis"] in ("block", "pooled")
    assert first["sample_size"] > 0

    # Actuals should not be revealed by default
    assert first["actual_mw"] is None
    assert first["is_within_band"] is None


def test_day_ahead_include_actual_reveal_toggle(client):
    """
    Verifies that include_actual=true reveals actuals and realized errors.
    """
    response = client.get("/api/day-ahead?date=2026-01-15&cutoff=09:00&coverage=0.8&include_actual=true")
    assert response.status_code == 200
    data = response.json()

    intervals = data["intervals"]
    first = intervals[0]
    assert first["actual_mw"] is not None
    assert first["realized_error_mw"] is not None
    assert isinstance(first["is_within_band"], bool)


def test_day_ahead_early_january_low_sample_flag(client):
    """
    Verifies that early January delivery days (e.g. 2026-01-03) are flagged as low sample.
    """
    response = client.get("/api/day-ahead?date=2026-01-03&cutoff=09:00&coverage=0.8")
    assert response.status_code == 200
    data = response.json()

    assert data["status"]["is_low_sample"] is True
    assert data["basis_metadata"]["prior_days_count"] == 1  # Jan 1 is completed prior to Jan 3 decision
    # Because only 1 prior day exists (1 * 12 = 12 samples per block < 20 min_block_samples),
    # intervals fall back to pooled
    assert data["intervals"][0]["basis"] == "pooled"


def test_day_ahead_validation_errors(client):
    """
    Verifies 400 Bad Request on invalid date or cutoff parameters.
    """
    r_bad_date = client.get("/api/day-ahead?date=not-a-date")
    assert r_bad_date.status_code == 400

    r_bad_cutoff = client.get("/api/day-ahead?date=2026-01-15&cutoff=99:99")
    assert r_bad_cutoff.status_code == 400

    r_future_date = client.get("/api/day-ahead?date=2026-03-01")
    assert r_future_date.status_code == 404


def test_day_ahead_validation_endpoint(client):
    """
    Verifies GET /api/day-ahead/validation walk-forward backtest results.
    """
    response = client.get("/api/day-ahead/validation?cutoff=09:00&coverage=0.8")
    assert response.status_code == 200
    data = response.json()

    assert data["target_coverage"] == 0.80
    assert data["overall_realised_coverage"] is not None
    assert 0.0 <= data["overall_realised_coverage"] <= 1.0
    assert data["total_days_evaluated"] == 29  # Jan 3 to Jan 31 (Jan 1 & 2 have no completed prior days in Jan)
    assert data["total_intervals_evaluated"] == 29 * 48
    assert len(data["days"]) == 29
    assert data["raw_mae_mw"] is not None
    assert data["bias_adjusted_mae_mw"] is not None
    assert data["mae_reduction_mw"] is not None
    assert data["mae_reduction_pct"] > 0.0  # Bias correction beats raw forecast!

    # Calibration table exists and has bins
    cal_table = data["calibration_table"]
    assert len(cal_table) > 0
    assert "bin_range" in cal_table[0]
    assert "sample_count" in cal_table[0]
