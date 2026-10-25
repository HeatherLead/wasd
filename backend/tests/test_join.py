"""
backend/tests/test_join.py
Unit tests for joining forecasts and actuals strictly on UTC start_time,
error calculations, and missing record audits.
"""

import pandas as pd
import numpy as np
import pytest
from app.pipeline.join import join_forecasts_and_actuals, audit_quality_and_missing


def test_join_hourly_aggregates_settlement_periods_and_calculates_error():
    # 1 hour target: 2026-01-01 10:00:00Z
    # Actuals for period 21 (10:00) = 10,000 MW, period 22 (10:30) = 12,000 MW -> mean = 11,000 MW
    actuals = pd.DataFrame([
        {"start_time": pd.Timestamp("2026-01-01 10:00:00Z"), "settlement_period": 21, "actual_generation_mw": 10000.0},
        {"start_time": pd.Timestamp("2026-01-01 10:30:00Z"), "settlement_period": 22, "actual_generation_mw": 12000.0},
    ])

    forecasts = pd.DataFrame([
        {
            "delivery_date": pd.Timestamp("2026-01-01").date(),
            "start_time": pd.Timestamp("2026-01-01 10:00:00Z"),
            "cutoff_time": pd.Timestamp("2025-12-31 09:00:00Z"),
            "forecast_publish_time": pd.Timestamp("2025-12-31 07:30:00Z"),
            "forecast_generation_mw": 14000.0,
            "horizon_hours": 26.5
        }
    ])

    joined = join_forecasts_and_actuals(forecasts, actuals, mode="hourly")
    assert len(joined) == 1
    row = joined.iloc[0]
    assert row["actual_generation_mw"] == 11000.0
    assert row["forecast_generation_mw"] == 14000.0
    # Overforecast: 14000 - 11000 = +3000 MW
    assert row["error_mw"] == 3000.0
    assert row["abs_error_mw"] == 3000.0
    # Percentage error: (3000 / 11000) * 100 = 27.27%
    assert round(row["pct_error"], 2) == 27.27
    assert row["imbalance_energy_mwh"] == 3000.0


def test_join_missing_data_remains_nan_never_zero():
    # Forecast exists, actual missing
    forecasts = pd.DataFrame([
        {
            "delivery_date": pd.Timestamp("2026-01-01").date(),
            "start_time": pd.Timestamp("2026-01-01 10:00:00Z"),
            "cutoff_time": pd.Timestamp("2025-12-31 09:00:00Z"),
            "forecast_publish_time": pd.Timestamp("2025-12-31 07:30:00Z"),
            "forecast_generation_mw": 14000.0,
            "horizon_hours": 26.5
        }
    ])
    actuals = pd.DataFrame(columns=["start_time", "settlement_period", "actual_generation_mw"])

    joined = join_forecasts_and_actuals(forecasts, actuals, mode="hourly")
    assert len(joined) == 1
    row = joined.iloc[0]
    assert pd.isna(row["actual_generation_mw"])
    assert pd.isna(row["error_mw"])
    assert pd.isna(row["abs_error_mw"])
    assert pd.isna(row["pct_error"])


def test_audit_quality_detects_missing_intervals():
    actuals = pd.DataFrame([
        {"start_time": pd.Timestamp("2026-01-01 00:00:00Z"), "actual_generation_mw": 10000.0},
        # 00:30 missing
    ])
    forecasts = pd.DataFrame([
        {"start_time": pd.Timestamp("2026-01-01 00:00:00Z"), "forecast_generation_mw": 11000.0},
    ])

    audit = audit_quality_and_missing(
        actuals,
        forecasts,
        start_dt="2026-01-01T00:00:00Z",
        end_dt="2026-01-01T00:30:00Z"
    )

    assert audit["evaluation_window"]["total_expected_half_hours"] == 2
    assert audit["counts"]["complete_intervals"] == 1
    assert audit["counts"]["missing_actual_count"] == 1
    assert "2026-01-01T00:30:00+00:00" in audit["missing_intervals"]["missing_actuals"]
