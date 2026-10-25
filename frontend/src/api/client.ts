/**
 * frontend/src/api/client.ts
 * Strongly-typed API client matching backend FastAPI schemas.
 * Includes commercial buying decision endpoints: revisions trajectory and worst intervals.
 */

export interface UnitsBlock {
  generation: string;
  error: string;
  rates: string;
  energy: string;
  horizon: string;
  buffer: string;
}

export interface CoverageInfo {
  total_expected_intervals: number;
  valid_intervals: number;
  missing_intervals: number;
  coverage_rate: number;
  coverage_pct: number;
}

export interface PercentilesInfo {
  p50_abs_error_mw: number | null;
  p90_abs_error_mw: number | null;
  p95_abs_error_mw: number | null;
}

export interface ExtremesInfo {
  max_overforecast_mw: number | null;
  max_underforecast_mw: number | null;
}

export interface KPISummary {
  coverage: CoverageInfo;
  mean_actual_mw: number | null;
  mean_forecast_mw: number | null;
  bias_mw: number | null;
  mae_mw: number | null;
  rmse_mw: number | null;
  normalised_mae: number | null;
  nmae_pct: number | null;
  overforecast_rate: number | null;
  overforecast_rate_pct: number | null;
  underforecast_rate: number | null;
  underforecast_rate_pct: number | null;
  share_intervals_overforecast: number | null;
  share_intervals_underforecast: number | null;
  shortfall_energy_mwh: number | null;
  surplus_energy_mwh: number | null;
  net_imbalance_energy_mwh: number | null;
  p90_shortfall_buffer_mw: number | null;
  percentiles: PercentilesInfo;
  extremes: ExtremesInfo;
}

export interface SummaryResponse {
  cutoff_time: string;
  start_date: string;
  end_date: string;
  units: UnitsBlock;
  kpis: KPISummary;
}

export interface DaySummaryItem {
  delivery_date: string;
  cutoff_time: string;
  mean_actual_mw: number | null;
  mean_forecast_mw: number | null;
  bias_mw: number | null;
  mae_mw: number | null;
  rmse_mw: number | null;
  nmae_pct: number | null;
  overforecast_rate_pct: number | null;
  shortfall_energy_mwh: number | null;
  surplus_energy_mwh: number | null;
  coverage_pct: number;
  total_intervals: number;
  valid_intervals: number;
  missing_intervals: number;
}

export interface DaysResponse {
  cutoff_time: string;
  total_days: number;
  units: UnitsBlock;
  days: DaySummaryItem[];
}

export interface IntervalDetailItem {
  start_time: string;
  settlement_period: number | null;
  forecast_generation_mw: number | null;
  actual_generation_mw: number | null;
  error_mw: number | null;
  abs_error_mw: number | null;
  pct_error: number | null;
  forecast_publish_time: string | null;
  horizon_hours: number | null;
  has_actual: boolean;
  has_forecast: boolean;
  is_missing: boolean;
}

export interface DayDetailResponse {
  delivery_date: string;
  cutoff_time: string;
  resolution: string;
  units: UnitsBlock;
  day_kpis: KPISummary;
  intervals: IntervalDetailItem[];
}

export interface HourOfDayBreakdownItem {
  hour: number;
  label: string;
  sample_count: number;
  mean_actual_mw: number | null;
  mean_forecast_mw: number | null;
  bias_mw: number | null;
  mae_mw: number | null;
  rmse_mw: number | null;
  nmae_pct: number | null;
}

export interface HorizonBucketBreakdownItem {
  bucket: string;
  min_horizon_hours: number;
  max_horizon_hours: number;
  sample_count: number;
  mean_actual_mw: number | null;
  mean_forecast_mw: number | null;
  bias_mw: number | null;
  mae_mw: number | null;
  rmse_mw: number | null;
}

export interface WindLevelBreakdownItem {
  level: string;
  description: string;
  min_mw: number;
  max_mw: number;
  sample_count: number;
  mean_actual_mw: number | null;
  mean_forecast_mw: number | null;
  bias_mw: number | null;
  mae_mw: number | null;
  nmae_pct: number | null;
}

export interface BoxPlotStats {
  min_mw: number | null;
  whisker_low_mw: number | null;
  q1_mw: number | null;
  median_mw: number | null;
  q3_mw: number | null;
  whisker_high_mw: number | null;
  max_mw: number | null;
  iqr_mw: number | null;
  outliers: number[];
  sample_count: number;
}

export interface AccuracyResponse {
  cutoff_time: string;
  start_date: string;
  end_date: string;
  units: UnitsBlock;
  by_day: DaySummaryItem[];
  by_hour_of_day: HourOfDayBreakdownItem[];
  by_horizon_bucket: HorizonBucketBreakdownItem[];
  by_wind_level: WindLevelBreakdownItem[];
  box_plot?: BoxPlotStats | null;
}

export interface BuyRangeIntervalItem {
  start_time: string;
  settlement_period: number | null;
  forecast_mw: number | null;
  forecast_generation_mw: number | null;
  base_need_mw: number | null;
  low_need_mw: number | null;
  central_need_mw: number | null;
  high_need_mw: number | null;
}

export interface BuyRangeTotals {
  forecast_total_mwh: number | null;
  demand_total_mwh: number | null;
  base_need_total_mwh: number | null;
  low_need_total_mwh: number | null;
  central_need_total_mwh: number | null;
  high_need_total_mwh: number | null;
  peak_high_need_mw: number | null;
  peak_low_need_mw: number | null;
  peak_range_mw: number | null;
}

export interface BuyRangeQuantiles {
  p10_error_mw: number;
  p50_error_mw: number;
  p90_error_mw: number;
}

export interface BuyRangeResponse {
  delivery_date: string;
  cutoff_time: string;
  demand_mw: number | null;
  basis: 'prior_days' | 'in_sample';
  prior_days_count: number;
  note: string;
  units: UnitsBlock;
  quantiles: BuyRangeQuantiles;
  shortfall_energy_mwh: number | null;
  totals: BuyRangeTotals | null;
  intervals: BuyRangeIntervalItem[];
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  data_loaded: boolean;
  snapshot_records: Record<string, number>;
  coverage_window: {
    start: string;
    end: string;
    target_month: string;
  };
}

export interface ForecastRevisionItem {
  publish_time: string;
  forecast_generation_mw: number;
  horizon_hours: number;
  is_eligible: boolean;
  is_decision_forecast: boolean;
  error_vs_actual_mw: number | null;
}

export interface ForecastRevisionsResponse {
  target_time: string;
  delivery_date: string;
  cutoff_time: string;
  cutoff_datetime: string;
  actual_generation_mw: number | null;
  decision_publish_time: string | null;
  decision_forecast_mw: number | null;
  total_revisions: number;
  revisions: ForecastRevisionItem[];
}

export interface WorstIntervalItem {
  start_time: string;
  delivery_date: string;
  settlement_period: number | null;
  forecast_generation_mw: number;
  actual_generation_mw: number;
  error_mw: number;
  abs_error_mw: number;
  pct_error: number | null;
  forecast_publish_time: string;
  horizon_hours: number;
}

export interface WorstIntervalsResponse {
  cutoff_time: string;
  start_date: string;
  end_date: string;
  units: UnitsBlock;
  worst_overforecasts: WorstIntervalItem[];
  worst_underforecasts: WorstIntervalItem[];
}

const BASE_URL = '/api';

async function fetchJson<T>(endpoint: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(endpoint, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        url.searchParams.append(key, val);
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // Fallback
    }
    throw new Error(errorDetail);
  }

  return response.json();
}

export const apiClient = {
  getHealth: () => fetchJson<HealthResponse>(`${BASE_URL}/health`),
  
  getSummary: (cutoffTime = '09:00', startDate?: string, endDate?: string) =>
    fetchJson<SummaryResponse>(`${BASE_URL}/summary`, {
      cutoff_time: cutoffTime,
      start_date: startDate,
      end_date: endDate,
    }),

  getDays: (cutoffTime = '09:00', startDate?: string, endDate?: string) =>
    fetchJson<DaysResponse>(`${BASE_URL}/days`, {
      cutoff_time: cutoffTime,
      start_date: startDate,
      end_date: endDate,
    }),

  getDayDetail: (date: string, cutoffTime = '09:00', resolution = 'half_hourly') =>
    fetchJson<DayDetailResponse>(`${BASE_URL}/days/${date}`, {
      cutoff_time: cutoffTime,
      resolution,
    }),

  getAccuracy: (cutoffTime = '09:00', startDate?: string, endDate?: string) =>
    fetchJson<AccuracyResponse>(`${BASE_URL}/accuracy`, {
      cutoff_time: cutoffTime,
      start_date: startDate,
      end_date: endDate,
    }),

  getRevisions: (targetTime: string, cutoffTime = '09:00') =>
    fetchJson<ForecastRevisionsResponse>(`${BASE_URL}/revisions`, {
      target_time: targetTime,
      cutoff_time: cutoffTime,
    }),

  getWorstIntervals: (cutoffTime = '09:00', startDate?: string, endDate?: string, topN = 5) =>
    fetchJson<WorstIntervalsResponse>(`${BASE_URL}/worst-intervals`, {
      cutoff_time: cutoffTime,
      start_date: startDate,
      end_date: endDate,
      top_n: String(topN),
    }),

  getBuyRange: (date: string, demandMw?: number, cutoffTime = '09:00') =>
    fetchJson<BuyRangeResponse>(`${BASE_URL}/buy-range`, {
      date,
      demand_mw: demandMw !== undefined ? String(demandMw) : undefined,
      cutoff_time: cutoffTime,
    }),
};

