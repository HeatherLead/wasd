"""
backend/app/schemas.py
Pydantic models for request validation and strongly typed JSON API responses.
Includes commercial buying decision metrics, forecast revisions, and worst-error rankings.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class UnitsBlock(BaseModel):
    generation: str = "MW"
    error: str = "MW"
    rates: str = "fraction (0.0 to 1.0) / percentage"
    energy: str = "MWh"
    horizon: str = "hours"
    buffer: str = "MW"


class CoverageInfo(BaseModel):
    total_expected_intervals: int
    valid_intervals: int
    missing_intervals: int
    coverage_rate: float
    coverage_pct: float


class PercentilesInfo(BaseModel):
    p50_abs_error_mw: Optional[float] = None
    p90_abs_error_mw: Optional[float] = None
    p95_abs_error_mw: Optional[float] = None


class ExtremesInfo(BaseModel):
    max_overforecast_mw: Optional[float] = None
    max_underforecast_mw: Optional[float] = None


class KPISummary(BaseModel):
    coverage: CoverageInfo
    mean_actual_mw: Optional[float] = None
    mean_forecast_mw: Optional[float] = None
    bias_mw: Optional[float] = None
    mae_mw: Optional[float] = None
    rmse_mw: Optional[float] = None
    normalised_mae: Optional[float] = None
    nmae_pct: Optional[float] = None
    overforecast_rate: Optional[float] = None
    overforecast_rate_pct: Optional[float] = None
    underforecast_rate: Optional[float] = None
    underforecast_rate_pct: Optional[float] = None
    share_intervals_overforecast: Optional[float] = None
    share_intervals_underforecast: Optional[float] = None
    shortfall_energy_mwh: Optional[float] = None
    surplus_energy_mwh: Optional[float] = None
    net_imbalance_energy_mwh: Optional[float] = None
    p90_shortfall_buffer_mw: Optional[float] = None
    percentiles: PercentilesInfo
    extremes: ExtremesInfo


class SummaryResponse(BaseModel):
    cutoff_time: str
    start_date: str
    end_date: str
    units: UnitsBlock = Field(default_factory=UnitsBlock)
    kpis: KPISummary


class DaySummaryItem(BaseModel):
    delivery_date: str
    cutoff_time: str
    mean_actual_mw: Optional[float] = None
    mean_forecast_mw: Optional[float] = None
    bias_mw: Optional[float] = None
    mae_mw: Optional[float] = None
    rmse_mw: Optional[float] = None
    nmae_pct: Optional[float] = None
    overforecast_rate_pct: Optional[float] = None
    shortfall_energy_mwh: Optional[float] = None
    surplus_energy_mwh: Optional[float] = None
    coverage_pct: float
    total_intervals: int
    valid_intervals: int
    missing_intervals: int


class DaysResponse(BaseModel):
    cutoff_time: str
    total_days: int
    units: UnitsBlock = Field(default_factory=UnitsBlock)
    days: List[DaySummaryItem]


class IntervalDetailItem(BaseModel):
    start_time: str
    settlement_period: Optional[int] = None
    forecast_generation_mw: Optional[float] = None
    actual_generation_mw: Optional[float] = None
    error_mw: Optional[float] = None
    abs_error_mw: Optional[float] = None
    pct_error: Optional[float] = None
    forecast_publish_time: Optional[str] = None
    horizon_hours: Optional[float] = None
    has_actual: bool
    has_forecast: bool
    is_missing: bool


class DayDetailResponse(BaseModel):
    delivery_date: str
    cutoff_time: str
    resolution: str
    units: UnitsBlock = Field(default_factory=UnitsBlock)
    day_kpis: KPISummary
    intervals: List[IntervalDetailItem]


class HourOfDayBreakdownItem(BaseModel):
    hour: int
    label: str
    sample_count: int
    mean_actual_mw: Optional[float] = None
    mean_forecast_mw: Optional[float] = None
    bias_mw: Optional[float] = None
    mae_mw: Optional[float] = None
    rmse_mw: Optional[float] = None
    nmae_pct: Optional[float] = None


class HorizonBucketBreakdownItem(BaseModel):
    bucket: str
    min_horizon_hours: float
    max_horizon_hours: float
    sample_count: int
    mean_actual_mw: Optional[float] = None
    mean_forecast_mw: Optional[float] = None
    bias_mw: Optional[float] = None
    mae_mw: Optional[float] = None
    rmse_mw: Optional[float] = None


class WindLevelBreakdownItem(BaseModel):
    level: str
    description: str
    min_mw: float
    max_mw: float
    sample_count: int
    mean_actual_mw: Optional[float] = None
    mean_forecast_mw: Optional[float] = None
    bias_mw: Optional[float] = None
    mae_mw: Optional[float] = None
    nmae_pct: Optional[float] = None


class BoxPlotStats(BaseModel):
    min_mw: Optional[float] = None
    whisker_low_mw: Optional[float] = None
    q1_mw: Optional[float] = None
    median_mw: Optional[float] = None
    q3_mw: Optional[float] = None
    whisker_high_mw: Optional[float] = None
    max_mw: Optional[float] = None
    iqr_mw: Optional[float] = None
    outliers: List[float] = Field(default_factory=list)
    sample_count: int = 0


class AccuracyResponse(BaseModel):
    cutoff_time: str
    start_date: str
    end_date: str
    units: UnitsBlock = Field(default_factory=UnitsBlock)
    by_day: List[DaySummaryItem]
    by_hour_of_day: List[HourOfDayBreakdownItem]
    by_horizon_bucket: List[HorizonBucketBreakdownItem]
    by_wind_level: List[WindLevelBreakdownItem]
    box_plot: Optional[BoxPlotStats] = None


class BuyRangeIntervalItem(BaseModel):
    start_time: str
    settlement_period: Optional[int] = None
    forecast_mw: Optional[float] = None
    forecast_generation_mw: Optional[float] = None
    base_need_mw: Optional[float] = None
    low_need_mw: Optional[float] = None
    central_need_mw: Optional[float] = None
    high_need_mw: Optional[float] = None


class BuyRangeTotals(BaseModel):
    forecast_total_mwh: Optional[float] = None
    demand_total_mwh: Optional[float] = None
    base_need_total_mwh: Optional[float] = None
    low_need_total_mwh: Optional[float] = None
    central_need_total_mwh: Optional[float] = None
    high_need_total_mwh: Optional[float] = None
    peak_high_need_mw: Optional[float] = None
    peak_low_need_mw: Optional[float] = None
    peak_range_mw: Optional[float] = None


class BuyRangeQuantiles(BaseModel):
    p10_error_mw: float
    p50_error_mw: float
    p90_error_mw: float


class BuyRangeResponse(BaseModel):
    delivery_date: str
    cutoff_time: str
    demand_mw: Optional[float] = None
    basis: str  # "prior_days" or "in_sample"
    prior_days_count: int
    note: str
    units: UnitsBlock = Field(default_factory=UnitsBlock)
    quantiles: BuyRangeQuantiles
    shortfall_energy_mwh: Optional[float] = None
    totals: Optional[BuyRangeTotals] = None
    intervals: List[BuyRangeIntervalItem]


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    data_loaded: bool
    snapshot_records: Dict[str, int]
    coverage_window: Dict[str, str]


class ForecastRevisionItem(BaseModel):
    publish_time: str
    forecast_generation_mw: float
    horizon_hours: float
    is_eligible: bool
    is_decision_forecast: bool
    error_vs_actual_mw: Optional[float] = None


class ForecastRevisionsResponse(BaseModel):
    target_time: str
    delivery_date: str
    cutoff_time: str
    cutoff_datetime: str
    actual_generation_mw: Optional[float] = None
    decision_publish_time: Optional[str] = None
    decision_forecast_mw: Optional[float] = None
    total_revisions: int
    revisions: List[ForecastRevisionItem]


class WorstIntervalItem(BaseModel):
    start_time: str
    delivery_date: str
    settlement_period: Optional[int] = None
    forecast_generation_mw: float
    actual_generation_mw: float
    error_mw: float
    abs_error_mw: float
    pct_error: Optional[float] = None
    forecast_publish_time: str
    horizon_hours: float


class WorstIntervalsResponse(BaseModel):
    cutoff_time: str
    start_date: str
    end_date: str
    units: UnitsBlock = Field(default_factory=UnitsBlock)
    worst_overforecasts: List[WorstIntervalItem]
    worst_underforecasts: List[WorstIntervalItem]
