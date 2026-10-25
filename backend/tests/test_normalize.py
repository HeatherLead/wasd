"""
backend/tests/test_normalize.py
Unit tests for data normalization and deduplication.
"""

import pandas as pd
import numpy as np
import pytest
from app.pipeline.normalize import normalize_actuals, normalize_forecasts


def test_normalize_actuals_filters_wind_and_casts_types():
    raw = [
        {"dataset": "FUELHH", "publishTime": "2026-01-01T01:00:00Z", "startTime": "2026-01-01T00:30:00Z", "settlementDate": "2026-01-01", "settlementPeriod": 2, "fuelType": "NUCLEAR", "generation": 5000},
        {"dataset": "FUELHH", "publishTime": "2026-01-01T01:00:00Z", "startTime": "2026-01-01T00:30:00Z", "settlementDate": "2026-01-01", "settlementPeriod": 2, "fuelType": "WIND", "generation": 12500},
        {"dataset": "FUELHH", "publishTime": "2026-01-01T00:30:00Z", "startTime": "2026-01-01T00:00:00Z", "settlementDate": "2026-01-01", "settlementPeriod": 1, "fuelType": "WIND", "generation": 12100},
    ]
    df = normalize_actuals(raw)
    assert len(df) == 2
    assert (df["fuel_type"] == "WIND").all()
    assert df["actual_generation_mw"].iloc[0] == 12100.0
    assert df["actual_generation_mw"].iloc[1] == 12500.0
    assert df["start_time"].dt.tz is not None
    assert str(df["start_time"].dt.tz) == "UTC"


def test_normalize_actuals_deduplicates_on_start_time():
    # Duplicate with earlier and later publishTime: should keep latest publishTime
    raw = [
        {"publishTime": "2026-01-01T01:00:00Z", "startTime": "2026-01-01T00:30:00Z", "settlementDate": "2026-01-01", "settlementPeriod": 2, "fuelType": "WIND", "generation": 12000},
        {"publishTime": "2026-01-01T02:00:00Z", "startTime": "2026-01-01T00:30:00Z", "settlementDate": "2026-01-01", "settlementPeriod": 2, "fuelType": "WIND", "generation": 12500},
    ]
    df = normalize_actuals(raw)
    assert len(df) == 1
    assert df["actual_generation_mw"].iloc[0] == 12500.0


def test_normalize_forecasts_deduplicates_and_sorts():
    raw = [
        {"publishTime": "2026-01-01T08:30:00Z", "startTime": "2026-01-02T12:00:00Z", "generation": 14000},
        {"publishTime": "2026-01-01T08:30:00Z", "startTime": "2026-01-02T12:00:00Z", "generation": 14000}, # duplicate
        {"publishTime": "2026-01-01T07:30:00Z", "startTime": "2026-01-02T12:00:00Z", "generation": 13500},
    ]
    df = normalize_forecasts(raw)
    assert len(df) == 2
    assert df["publish_time"].iloc[0] < df["publish_time"].iloc[1]
    assert df["forecast_generation_mw"].iloc[1] == 14000.0
