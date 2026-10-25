"""
backend/tests/test_selection.py
Unit tests for pure decision forecast selection.
Verifies no look-ahead bias and correct latest-before-cutoff selection.
"""

from datetime import date
import pandas as pd
import pytest
from app.pipeline.selection import select_decision_forecasts


def test_select_decision_forecasts_prevents_look_ahead():
    # Target: 2026-01-02 12:00:00Z (Delivery day D = Jan 2)
    # Cutoff for Jan 2 at 09:00 is: 2026-01-01 09:00:00Z
    forecasts = pd.DataFrame([
        # Published 2026-01-01 07:30 (eligible)
        {"publish_time": pd.Timestamp("2026-01-01 07:30:00Z"), "start_time": pd.Timestamp("2026-01-02 12:00:00Z"), "forecast_generation_mw": 10000.0},
        # Published 2026-01-01 08:30 (eligible, latest before cutoff)
        {"publish_time": pd.Timestamp("2026-01-01 08:30:00Z"), "start_time": pd.Timestamp("2026-01-02 12:00:00Z"), "forecast_generation_mw": 11000.0},
        # Published 2026-01-01 09:30 (AFTER CUTOFF - LOOK-AHEAD!)
        {"publish_time": pd.Timestamp("2026-01-01 09:30:00Z"), "start_time": pd.Timestamp("2026-01-02 12:00:00Z"), "forecast_generation_mw": 15000.0},
        # Published 2026-01-02 06:00 (SAME DAY - MAJOR LOOK-AHEAD!)
        {"publish_time": pd.Timestamp("2026-01-02 06:00:00Z"), "start_time": pd.Timestamp("2026-01-02 12:00:00Z"), "forecast_generation_mw": 18000.0},
    ])

    selected = select_decision_forecasts(forecasts, ["2026-01-02"], cutoff_hour=9, cutoff_minute=0)

    assert len(selected) == 1
    row = selected.iloc[0]
    assert row["forecast_publish_time"] == pd.Timestamp("2026-01-01 08:30:00Z")
    assert row["forecast_generation_mw"] == 11000.0
    # Horizon: 2026-01-02 12:00:00 - 2026-01-01 08:30:00 = 27.5 hours
    assert row["horizon_hours"] == 27.5


def test_select_decision_forecasts_empty_when_no_forecast_before_cutoff():
    forecasts = pd.DataFrame([
        # Only published AFTER cutoff
        {"publish_time": pd.Timestamp("2026-01-01 10:00:00Z"), "start_time": pd.Timestamp("2026-01-02 12:00:00Z"), "forecast_generation_mw": 12000.0},
    ])

    selected = select_decision_forecasts(forecasts, ["2026-01-02"], cutoff_hour=9, cutoff_minute=0)
    assert len(selected) == 0


def test_select_decision_forecasts_configurable_cutoff():
    # If cutoff is changed to 12:00 UTC
    forecasts = pd.DataFrame([
        {"publish_time": pd.Timestamp("2026-01-01 08:30:00Z"), "start_time": pd.Timestamp("2026-01-02 12:00:00Z"), "forecast_generation_mw": 11000.0},
        {"publish_time": pd.Timestamp("2026-01-01 11:30:00Z"), "start_time": pd.Timestamp("2026-01-02 12:00:00Z"), "forecast_generation_mw": 13000.0},
    ])

    # With cutoff 09:00 -> picks 08:30
    sel_9 = select_decision_forecasts(forecasts, ["2026-01-02"], cutoff_hour=9, cutoff_minute=0)
    assert sel_9.iloc[0]["forecast_generation_mw"] == 11000.0

    # With cutoff 12:00 -> picks 11:30
    sel_12 = select_decision_forecasts(forecasts, ["2026-01-02"], cutoff_hour=12, cutoff_minute=0)
    assert sel_12.iloc[0]["forecast_generation_mw"] == 13000.0
