"""
backend/tests/test_api.py
Integration tests for FastAPI endpoints using TestClient.
Covers validation errors, custom cutoffs, day detail, and missing-data cases.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.store import data_store


@pytest.fixture(scope="session", autouse=True)
def init_store():
    """Ensure data_store is loaded before running API tests."""
    data_store.load()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["data_loaded"] is True
    assert data["snapshot_records"]["actuals_rows"] == 1488
    assert data["snapshot_records"]["decision_forecasts_rows"] == 744


def test_summary_endpoint_default(client):
    response = client.get("/api/summary")
    assert response.status_code == 200
    data = response.json()
    assert data["cutoff_time"] == "09:00"
    assert "kpis" in data
    kpis = data["kpis"]
    assert kpis["mae_mw"] > 0
    assert kpis["bias_mw"] > 0
    assert kpis["rmse_mw"] > 0
    assert kpis["coverage"]["coverage_pct"] == 100.0
    assert "units" in data
    assert data["units"]["generation"] == "MW"


def test_summary_endpoint_custom_cutoff_and_date_range(client):
    response = client.get("/api/summary?cutoff_time=12:00&start_date=2026-01-05&end_date=2026-01-15")
    assert response.status_code == 200
    data = response.json()
    assert data["cutoff_time"] == "12:00"
    assert data["start_date"] == "2026-01-05"
    assert data["end_date"] == "2026-01-15"
    assert data["kpis"]["coverage"]["total_expected_intervals"] == 11 * 24


def test_summary_validation_errors(client):
    # Invalid cutoff format
    r1 = client.get("/api/summary?cutoff_time=25:99")
    assert r1.status_code == 400
    assert "cutoff_time" in r1.json()["detail"]

    # Invalid date string
    r2 = client.get("/api/summary?start_date=bad-date")
    assert r2.status_code == 400

    # Inverted date range
    r3 = client.get("/api/summary?start_date=2026-01-20&end_date=2026-01-10")
    assert r3.status_code == 400
    assert "cannot be later than" in r3.json()["detail"]


def test_days_list_endpoint(client):
    response = client.get("/api/days")
    assert response.status_code == 200
    data = response.json()
    assert data["total_days"] == 31
    assert len(data["days"]) == 31
    day_1 = data["days"][0]
    assert day_1["delivery_date"] == "2026-01-01"
    assert day_1["total_intervals"] == 24
    assert day_1["valid_intervals"] == 24
    assert day_1["missing_intervals"] == 0
    assert day_1["mae_mw"] is not None


def test_day_detail_half_hourly(client):
    response = client.get("/api/days/2026-01-01?resolution=half_hourly")
    assert response.status_code == 200
    data = response.json()
    assert data["delivery_date"] == "2026-01-01"
    assert data["resolution"] == "half_hourly"
    assert len(data["intervals"]) == 48
    
    first = data["intervals"][0]
    assert first["settlement_period"] == 1
    assert first["has_actual"] is True
    assert first["has_forecast"] is True
    assert first["is_missing"] is False
    assert first["forecast_generation_mw"] is not None
    assert first["actual_generation_mw"] is not None


def test_day_detail_hourly(client):
    response = client.get("/api/days/2026-01-01?resolution=hourly")
    assert response.status_code == 200
    data = response.json()
    assert len(data["intervals"]) == 24


def test_day_detail_not_found(client):
    response = client.get("/api/days/2026-02-15")
    assert response.status_code == 404


def test_accuracy_endpoint(client):
    response = client.get("/api/accuracy")
    assert response.status_code == 200
    data = response.json()
    assert len(data["by_day"]) == 31
    assert len(data["by_hour_of_day"]) == 24
    assert len(data["by_horizon_bucket"]) == 5
    assert len(data["by_wind_level"]) == 3
    
    # Check hour of day 00:00
    h0 = data["by_hour_of_day"][0]
    assert h0["hour"] == 0
    assert h0["sample_count"] == 31
    assert h0["mae_mw"] > 0


def test_missing_data_representation(client, monkeypatch):
    """
    Simulates a day with missing actuals or forecasts to verify
    missing values remain null and is_missing flags are set.
    """
    import pandas as pd
    # Make a shallow copy of day detail with injected nulls
    orig_method = data_store.get_day_detail

    def mock_get_day_detail(date_str, cutoff_time="09:00", resolution="half_hourly"):
        res = orig_method(date_str, cutoff_time, resolution)
        # Inject null into interval 5
        res["intervals"][5]["actual_generation_mw"] = None
        res["intervals"][5]["error_mw"] = None
        res["intervals"][5]["abs_error_mw"] = None
        res["intervals"][5]["pct_error"] = None
        res["intervals"][5]["has_actual"] = False
        res["intervals"][5]["is_missing"] = True
        return res

    monkeypatch.setattr(data_store, "get_day_detail", mock_get_day_detail)

    response = client.get("/api/days/2026-01-01")
    assert response.status_code == 200
    data = response.json()
    miss_item = data["intervals"][5]
    assert miss_item["actual_generation_mw"] is None
    assert miss_item["error_mw"] is None
    assert miss_item["has_actual"] is False
    assert miss_item["is_missing"] is True


def test_summary_includes_shortfall_and_buffer_metrics(client):
    response = client.get("/api/summary?cutoff_time=09:00")
    assert response.status_code == 200
    data = response.json()
    kpis = data["kpis"]
    assert "shortfall_energy_mwh" in kpis
    assert kpis["shortfall_energy_mwh"] > 0
    assert "surplus_energy_mwh" in kpis
    assert "p90_shortfall_buffer_mw" in kpis
    assert kpis["p90_shortfall_buffer_mw"] > 0


def test_revisions_endpoint(client):
    # Target 2026-01-01 12:00:00Z
    response = client.get("/api/revisions?target_time=2026-01-01T12:00:00Z&cutoff_time=09:00")
    assert response.status_code == 200
    data = response.json()
    assert data["target_time"] == "2026-01-01T12:00:00+00:00"
    assert data["actual_generation_mw"] is not None
    assert data["decision_publish_time"] is not None
    assert data["total_revisions"] > 0
    
    # Exactly one revision must be marked is_decision_forecast
    dec_revs = [r for r in data["revisions"] if r["is_decision_forecast"]]
    assert len(dec_revs) == 1
    assert dec_revs[0]["is_eligible"] is True
    # Confirm chosen decision forecast publish time matches
    assert dec_revs[0]["publish_time"] == data["decision_publish_time"]


def test_worst_intervals_endpoint(client):
    response = client.get("/api/worst-intervals?cutoff_time=09:00&top_n=5")
    assert response.status_code == 200
    data = response.json()
    assert len(data["worst_overforecasts"]) == 5
    assert len(data["worst_underforecasts"]) == 5

    # Check that worst overforecasts are ordered descending by error_mw
    over_errs = [row["error_mw"] for row in data["worst_overforecasts"]]
    assert over_errs == sorted(over_errs, reverse=True)
    assert all(e > 0 for e in over_errs)

    # Check that worst underforecasts are ordered ascending by error_mw (negative error)
    under_errs = [row["error_mw"] for row in data["worst_underforecasts"]]
    assert under_errs == sorted(under_errs)
    assert all(e < 0 for e in under_errs)

