"""
backend/app/routes.py
FastAPI router defining all analytical REST API endpoints.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Path

from app.schemas import (
    SummaryResponse,
    DaysResponse,
    DayDetailResponse,
    AccuracyResponse,
    HealthResponse,
    ForecastRevisionsResponse,
    WorstIntervalsResponse,
    BuyRangeResponse,
)
from app.store import data_store

router = APIRouter(prefix="/api", tags=["Analytics"])

CUTOFF_REGEX = r"^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$"
DATE_REGEX = r"^\d{4}-\d{2}-\d{2}$"


def validate_cutoff(cutoff_time: str) -> str:
    cleaned = cutoff_time.strip()
    if not re.match(CUTOFF_REGEX, cleaned):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid cutoff_time '{cutoff_time}'. Must be formatted as 'HH:MM' (24-hour UTC, e.g. '09:00')."
        )
    return cleaned


def validate_dates(start_date: Optional[str], end_date: Optional[str]):
    if start_date:
        if not re.match(DATE_REGEX, start_date.strip()):
            raise HTTPException(status_code=400, detail=f"Invalid start_date '{start_date}'. Must be 'YYYY-MM-DD'.")
        try:
            datetime.strptime(start_date.strip(), "%Y-%m-%d")
        except ValueError as err:
            raise HTTPException(status_code=400, detail=f"Invalid start_date: {err}")

    if end_date:
        if not re.match(DATE_REGEX, end_date.strip()):
            raise HTTPException(status_code=400, detail=f"Invalid end_date '{end_date}'. Must be 'YYYY-MM-DD'.")
        try:
            datetime.strptime(end_date.strip(), "%Y-%m-%d")
        except ValueError as err:
            raise HTTPException(status_code=400, detail=f"Invalid end_date: {err}")

    if start_date and end_date:
        if start_date > end_date:
            raise HTTPException(
                status_code=400,
                detail=f"start_date '{start_date}' cannot be later than end_date '{end_date}'."
            )


@router.get("/health", response_model=HealthResponse, summary="API and Data Store Health Check")
def get_health() -> HealthResponse:
    """Returns application health status, data load status, and record counts."""
    return HealthResponse(
        status="healthy",
        timestamp=datetime.now(timezone.utc).isoformat(),
        data_loaded=data_store.is_loaded,
        snapshot_records={
            "actuals_rows": len(data_store.df_actuals),
            "forecasts_raw_rows": len(data_store.df_forecasts_raw),
            "decision_forecasts_rows": len(data_store.df_decision_default),
            "joined_hourly_rows": len(data_store.df_joined_hourly_default),
            "joined_half_hourly_rows": len(data_store.df_joined_half_hourly_default),
        },
        coverage_window={
            "start": "2026-01-01T00:00:00Z",
            "end": "2026-01-31T23:30:00Z",
            "target_month": "January 2026"
        }
    )


@router.get("/summary", response_model=SummaryResponse, summary="High-Level KPI Summary")
def get_summary(
    cutoff_time: str = Query("09:00", description="Cutoff time on D-1 in UTC (format HH:MM)", pattern=CUTOFF_REGEX),
    start_date: Optional[str] = Query(None, description="Optional start delivery date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Optional end delivery date (YYYY-MM-DD)"),
) -> SummaryResponse:
    """
    Returns aggregated accuracy metrics (MAE, RMSE, Bias, nMAE, Coverage, Percentiles)
    for the selected cutoff time and date range.
    """
    cutoff = validate_cutoff(cutoff_time)
    validate_dates(start_date, end_date)

    try:
        summary_data = data_store.get_summary(cutoff_time=cutoff, start_date=start_date, end_date=end_date)
        return SummaryResponse(**summary_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing summary: {str(e)}")


@router.get("/days", response_model=DaysResponse, summary="List of Delivery Days with Metrics")
def get_days(
    cutoff_time: str = Query("09:00", description="Cutoff time on D-1 in UTC (format HH:MM)", pattern=CUTOFF_REGEX),
    start_date: Optional[str] = Query(None, description="Optional start delivery date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Optional end delivery date (YYYY-MM-DD)"),
) -> DaysResponse:
    """
    Returns the list of delivery days with per-day MAE, Bias, RMSE, nMAE, and coverage.
    """
    cutoff = validate_cutoff(cutoff_time)
    validate_dates(start_date, end_date)

    try:
        days = data_store.get_days_list(cutoff_time=cutoff, start_date=start_date, end_date=end_date)
        return DaysResponse(
            cutoff_time=cutoff,
            total_days=len(days),
            days=days
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing days list: {str(e)}")


@router.get("/days/{date}", response_model=DayDetailResponse, summary="Interval Granularity for a Single Day")
def get_day_detail(
    date: str = Path(..., description="Delivery date (YYYY-MM-DD)", pattern=DATE_REGEX),
    cutoff_time: str = Query("09:00", description="Cutoff time on D-1 in UTC (format HH:MM)", pattern=CUTOFF_REGEX),
    resolution: str = Query("half_hourly", description="Resolution: 'half_hourly' (48 periods) or 'hourly' (24 periods)"),
) -> DayDetailResponse:
    """
    Returns interval-level details (actuals, forecast, error, lead time, missing flags)
    for a specific delivery day.
    """
    cutoff = validate_cutoff(cutoff_time)
    if resolution not in ("half_hourly", "hourly"):
        raise HTTPException(status_code=400, detail="Invalid resolution. Must be 'half_hourly' or 'hourly'.")

    try:
        detail = data_store.get_day_detail(date_str=date, cutoff_time=cutoff, resolution=resolution)
        return DayDetailResponse(**detail)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving day detail: {str(e)}")


@router.get("/accuracy", response_model=AccuracyResponse, summary="Multi-Dimensional Accuracy Breakdowns")
def get_accuracy(
    cutoff_time: str = Query("09:00", description="Cutoff time on D-1 in UTC (format HH:MM)", pattern=CUTOFF_REGEX),
    start_date: Optional[str] = Query(None, description="Optional start delivery date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Optional end delivery date (YYYY-MM-DD)"),
) -> AccuracyResponse:
    """
    Returns accuracy breakdowns:
    - By delivery day (time series)
    - By hour of the day (diurnal profile)
    - By forecast horizon bucket (lead time analysis)
    - By wind generation output level (error regime analysis)
    """
    cutoff = validate_cutoff(cutoff_time)
    validate_dates(start_date, end_date)

    try:
        breakdowns = data_store.get_accuracy_breakdowns(cutoff_time=cutoff, start_date=start_date, end_date=end_date)
        return AccuracyResponse(**breakdowns)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing accuracy breakdowns: {str(e)}")


@router.get("/revisions", response_model=ForecastRevisionsResponse, summary="Forecast Evolution Across Successive Runs")
def get_revisions(
    target_time: str = Query(..., description="Target interval timestamp (ISO-8601 UTC, e.g. 2026-01-01T12:00:00Z)"),
    cutoff_time: str = Query("09:00", description="Cutoff time on D-1 in UTC (format HH:MM)", pattern=CUTOFF_REGEX),
) -> ForecastRevisionsResponse:
    """
    Returns the historical revision trajectory for a specific target interval.
    Shows every published forecast from 48h ahead down to intraday, marking the
    exact forecast that was locked in at the D-1 decision cutoff versus actual outturn.
    """
    cutoff = validate_cutoff(cutoff_time)
    try:
        revisions_data = data_store.get_forecast_revisions(target_time=target_time, cutoff_time=cutoff)
        return ForecastRevisionsResponse(**revisions_data)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving forecast revisions: {str(e)}")


@router.get("/worst-intervals", response_model=WorstIntervalsResponse, summary="Ranked Largest-Error Intervals")
def get_worst_intervals(
    cutoff_time: str = Query("09:00", description="Cutoff time on D-1 in UTC (format HH:MM)", pattern=CUTOFF_REGEX),
    start_date: Optional[str] = Query(None, description="Optional start delivery date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="Optional end delivery date (YYYY-MM-DD)"),
    top_n: int = Query(5, description="Number of top intervals to return", ge=1, le=20),
) -> WorstIntervalsResponse:
    """
    Returns ranked lists of the worst overforecasts (deficits requiring backup thermal power)
    and worst underforecasts (surpluses spilled or sold at imbalance prices).
    """
    cutoff = validate_cutoff(cutoff_time)
    validate_dates(start_date, end_date)

    try:
        worst_data = data_store.get_worst_intervals(
            cutoff_time=cutoff,
            start_date=start_date,
            end_date=end_date,
            top_n=top_n
        )
        return WorstIntervalsResponse(**worst_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving worst intervals: {str(e)}")


@router.get("/buy-range", response_model=BuyRangeResponse, summary="Recommended Procurement Buy Range")
def get_buy_range(
    date: str = Query(..., description="Delivery date (YYYY-MM-DD)", pattern=DATE_REGEX),
    demand_mw: Optional[float] = Query(None, description="Expected consumer demand in MW"),
    cutoff_time: str = Query("09:00", description="Cutoff time on D-1 in UTC (format HH:MM)", pattern=CUTOFF_REGEX),
) -> BuyRangeResponse:
    """
    Returns recommended procurement buy range (low / central / high) per half-hour for delivery day D:
    - Base need = demand - forecast wind
    - Buy range per half-hour = base need + P10 error ... base need + P90 error, clamped at 0 MW
    - Quantiles derive strictly from days BEFORE D (prior_days basis). If < 7 prior days, falls back to in_sample.
    """
    cutoff = validate_cutoff(cutoff_time)
    if not re.match(DATE_REGEX, date.strip()):
        raise HTTPException(status_code=400, detail=f"Invalid date format '{date}'. Must be 'YYYY-MM-DD'.")
    if demand_mw is not None and demand_mw < 0:
        raise HTTPException(status_code=400, detail="demand_mw must be non-negative (>= 0).")

    try:
        buy_range_data = data_store.get_buy_range(date_str=date.strip(), demand_mw=demand_mw, cutoff_time=cutoff)
        return BuyRangeResponse(**buy_range_data)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing buy range: {str(e)}")


