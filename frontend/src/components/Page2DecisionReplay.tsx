/**
 * frontend/src/components/Page2DecisionReplay.tsx
 * Page 2: Day-Ahead Wind Forecast and Downside Risk (Decision Replay)
 *
 * Core Question:
 * "For delivery day D, what wind forecast was available at the decision cutoff,
 *  how far could actual wind plausibly differ from it, and where is the downside risk?"
 *
 * Rules:
 * - Wind supply uncertainty ONLY (no demand or buy quantities).
 * - Strictly empirical error quantiles from prior days (no ML, no look-ahead).
 * - Clean, calm, fast layout: status strip, main forecast & plausible percentile range chart,
 *   half-hourly shortfall risk concentration chart, and interval details with CSV export.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import {
  ChevronDown,
  ChevronRight,
  Download,
  TrendingUp,
  TrendingDown,
  Info,
} from 'lucide-react';
import { apiClient } from '../api/client';
import type { DayAheadScheduleResponse } from '../api/client';
import { PRIMARY_COLOR } from '../theme';

interface Page2Props {
  selectedDate: string;
  onSelectDate?: (date: string) => void;
  cutoffTime: string;
}

export const Page2DecisionReplay: React.FC<Page2Props> = ({
  selectedDate,
  cutoffTime,
}) => {
  // Page 2 State
  const [coverage, setCoverage] = useState<number>(0.80);

  // API Data
  const [data, setData] = useState<DayAheadScheduleResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Collapsed interval table
  const [tableOpen, setTableOpen] = useState<boolean>(false);

  // Fetch Day-Ahead Data (strictly prior days history)
  const fetchDayAhead = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getDayAhead(
        selectedDate,
        cutoffTime,
        coverage,
        undefined,
        false,
        28
      );
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load day-ahead forecast uncertainty.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, cutoffTime, coverage]);

  useEffect(() => {
    fetchDayAhead();
  }, [fetchDayAhead]);

  // CSV Export
  const handleExportCSV = () => {
    if (!data || !data.intervals.length) return;
    const headers = [
      'Settlement Period',
      'Start Time (UTC)',
      'Forecast (MW)',
      'Actual Low (MW)',
      'Actual High (MW)',
      'Shortfall Prob P(error > T)',
      'Horizon (hours)',
      'Basis',
      'Sample Size',
    ];

    const rows = data.intervals.map((it) => [
      it.settlement_period ?? '',
      it.start_time ?? '',
      it.forecast_mw ?? '',
      it.actual_low_mw ?? '',
      it.actual_high_mw ?? '',
      it.p_shortfall_gt_threshold !== null ? (it.p_shortfall_gt_threshold * 100).toFixed(1) + '%' : '',
      it.horizon_hours ?? '',
      it.basis ?? '',
      it.sample_size,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `wind_forecast_uncertainty_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Expected actual calculations based on historical bias and intraday trends
  const actualEstimates = useMemo(() => {
    if (!data || !data.intervals.length) return null;
    const validIntervals = data.intervals.filter((it) => it.forecast_mw !== null);
    if (!validIntervals.length) return null;

    const avgForecast = validIntervals.reduce((acc, it) => acc + (it.forecast_mw || 0), 0) / validIntervals.length;
    const avgLow = validIntervals.reduce((acc, it) => acc + (it.actual_low_mw || 0), 0) / validIntervals.length;
    const avgHigh = validIntervals.reduce((acc, it) => acc + (it.actual_high_mw || 0), 0) / validIntervals.length;

    const bias = data.risk_summary.expected_bias_mw ?? 0;
    // Bias-adjusted expected actual: Forecast - Historical Bias
    const expectedActual = Math.max(0, avgForecast - bias);

    // Peak & trough intervals
    let peakIt = validIntervals[0];
    let troughIt = validIntervals[0];
    for (const it of validIntervals) {
      if ((it.forecast_mw ?? 0) > (peakIt.forecast_mw ?? 0)) peakIt = it;
      if ((it.forecast_mw ?? 0) < (troughIt.forecast_mw ?? 0)) troughIt = it;
    }

    // Trend trajectory (overnight vs afternoon/evening)
    const firstQuarterAvg = validIntervals.slice(0, 12).reduce((acc, it) => acc + (it.forecast_mw || 0), 0) / 12;
    const lastQuarterAvg = validIntervals.slice(-12).reduce((acc, it) => acc + (it.forecast_mw || 0), 0) / 12;
    const diff = lastQuarterAvg - firstQuarterAvg;

    let trendType: 'up' | 'down' | 'flat' = 'flat';
    let trendLabel = 'Stable across the 24-hour delivery schedule';
    if (diff > 800) {
      trendType = 'up';
      trendLabel = `Ramping upward (+${Math.round(diff).toLocaleString()} MW from early morning to late evening)`;
    } else if (diff < -800) {
      trendType = 'down';
      trendLabel = `Declining downward (-${Math.round(Math.abs(diff)).toLocaleString()} MW from early morning to late evening)`;
    }

    const totalForecastMWh = (avgForecast * validIntervals.length) / 2;
    const totalExpectedMWh = (expectedActual * validIntervals.length) / 2;
    const totalPlausibleLowMWh = (avgLow * validIntervals.length) / 2;
    const totalPlausibleHighMWh = (avgHigh * validIntervals.length) / 2;

    return {
      avgForecast,
      avgLow,
      avgHigh,
      bias,
      expectedActual,
      totalForecastMWh,
      totalExpectedMWh,
      totalPlausibleLowMWh,
      totalPlausibleHighMWh,
      peakIt,
      troughIt,
      trendType,
      trendLabel,
    };
  }, [data]);

  // Chart data preparation
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.intervals.map((it) => {
      const timeStr = it.start_time ? it.start_time.slice(11, 16) : `SP${it.settlement_period}`;
      const fMw = it.forecast_mw;
      const lowMw = it.actual_low_mw;
      const highMw = it.actual_high_mw;
      const bandWidth = lowMw !== null && highMw !== null ? Math.max(0, highMw - lowMw) : 0;
      const pShortfallPct = it.p_shortfall_gt_threshold !== null ? it.p_shortfall_gt_threshold * 100 : null;

      return {
        time: timeStr,
        period: it.settlement_period,
        start_time: it.start_time,
        forecast_mw: fMw,
        actual_low_mw: lowMw,
        actual_high_mw: highMw,
        band_base: lowMw,
        band_width: bandWidth,
        p_shortfall_pct: pShortfallPct,
        p_shortfall_raw: it.p_shortfall_gt_threshold,
        publish_time: it.publish_time,
        horizon_hours: it.horizon_hours,
        basis: it.basis,
        sample_size: it.sample_size,
      };
    });
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>

      {/* ERROR BANNER */}
      {error && (
        <div style={{ padding: '1rem', border: '1px solid #d32f2f', borderRadius: '8px', backgroundColor: '#ffebee', color: '#d32f2f' }}>
          {error}
        </div>
      )}

      {/* LOADING STATE */}
      {loading && !data && (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#666666', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
          Evaluating empirical error quantiles and downside risk...
        </div>
      )}

      {data && (
        <>
          {/* 2. MAIN CHART: FORECAST WIND & PLAUSIBLE ACTUAL BAND */}
          <div
            style={{
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              padding: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#000000' }}>
                  Day-Ahead Wind Forecast & Plausible Actual Range
                </h2>
                <div style={{ fontSize: '0.8rem', color: '#666666', marginTop: '0.2rem' }}>
                  Empirical error quantiles derived strictly from {data.basis_metadata.prior_days_count} prior days' decision-time errors.
                </div>
              </div>

              {/* Chart Controls: Coverage Toggle (80th vs 90th Percentile) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '4px', backgroundColor: '#f1f3f5', padding: '3px', borderRadius: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setCoverage(0.80)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: coverage === 0.80 ? PRIMARY_COLOR : 'transparent',
                      color: coverage === 0.80 ? '#ffffff' : '#000000',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    80th Percentile
                  </button>
                  <button
                    type="button"
                    onClick={() => setCoverage(0.90)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: coverage === 0.90 ? PRIMARY_COLOR : 'transparent',
                      color: coverage === 0.90 ? '#ffffff' : '#000000',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    90th Percentile
                  </button>
                </div>
              </div>
            </div>

            {/* Main Recharts Area */}
            <div style={{ height: '380px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 15, right: 25, bottom: 25, left: 15 }}>
                  <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 11, fill: '#666666' }}
                    tickLine={{ stroke: '#cccccc' }}
                    axisLine={{ stroke: '#cccccc' }}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#666666' }}
                    tickLine={{ stroke: '#cccccc' }}
                    axisLine={{ stroke: '#cccccc' }}
                    tickFormatter={(val) => `${val.toLocaleString()} MW`}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div
                          style={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #e0e0e0',
                            borderRadius: '6px',
                            padding: '0.75rem 1rem',
                            fontSize: '0.8rem',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: '0.35rem', borderBottom: '1px solid #eee', paddingBottom: '0.25rem' }}>
                            SP {d.period} ({d.time} UTC)
                          </div>
                          <div>
                            Forecast Wind: <strong>{d.forecast_mw?.toLocaleString()} MW</strong>
                          </div>
                          <div style={{ color: PRIMARY_COLOR, marginTop: '0.2rem' }}>
                            Plausible Range ({Math.round(coverage * 100)}th Percentile):{' '}
                            <strong>
                              {d.actual_low_mw?.toLocaleString()} – {d.actual_high_mw?.toLocaleString()} MW
                            </strong>
                          </div>
                          <div style={{ color: '#666666', marginTop: '0.2rem', fontSize: '0.75rem' }}>
                            Horizon: {d.horizon_hours}h | Basis: {d.basis} ({d.sample_size} samples)
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    content={() => (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1.5rem', fontSize: '0.8rem', paddingBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '18px', height: '3px', backgroundColor: '#000000', display: 'inline-block' }} />
                          <span style={{ color: '#111111', fontWeight: 600 }}>Forecast Wind (Baseline)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              width: '16px',
                              height: '12px',
                              backgroundColor: 'rgba(20, 137, 55, 0.3)',
                              border: `1.5px dashed ${PRIMARY_COLOR}`,
                              display: 'inline-block',
                              borderRadius: '3px',
                            }}
                          />
                          <span style={{ color: '#111111', fontWeight: 600 }}>
                            Plausible Actual Range ({Math.round(coverage * 100)}th Percentile)
                          </span>
                        </div>
                      </div>
                    )}
                  />

                  {/* Shaded Empirical Quantile Range */}
                  <Area
                    type="monotone"
                    dataKey="band_base"
                    stackId="1"
                    fill="transparent"
                    stroke="none"
                    legendType="none"
                  />
                  <Area
                    type="monotone"
                    dataKey="band_width"
                    stackId="1"
                    fill="rgba(20, 137, 55, 0.16)"
                    stroke="none"
                    name={`Plausible Actual Range (${Math.round(coverage * 100)}th percentile empirical)`}
                  />

                  {/* Quantile Boundary Dashes */}
                  <Line
                    type="monotone"
                    dataKey="actual_low_mw"
                    stroke={PRIMARY_COLOR}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    legendType="none"
                  />
                  <Line
                    type="monotone"
                    dataKey="actual_high_mw"
                    stroke={PRIMARY_COLOR}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    legendType="none"
                  />

                  {/* Central Line: Forecast Wind */}
                  <Line
                    type="monotone"
                    dataKey="forecast_mw"
                    stroke="#000000"
                    strokeWidth={2.5}
                    dot={false}
                    name="Forecast Wind (Baseline)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* EXPECTED ACTUAL VALUE & TREND ASSESSMENT CARD */}
          {actualEstimates && (
            <div
              style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                padding: '1.25rem 1.5rem',
              }}
            >
              {/* Card Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  paddingBottom: '0.85rem',
                  borderBottom: '1px solid #eeeeee',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#000000' }}>
                    Expected Wind Generation & Uncertainty
                  </h3>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.75rem',
                    backgroundColor: '#f5f5f5',
                    padding: '0.35rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #e0e0e0',
                  }}
                >
                  <Info size={14} color="#666666" />
                  <span>
                    Historical Model Bias:{' '}
                    <strong>
                      {actualEstimates.bias >= 0 ? '+' : ''}
                      {Math.round(actualEstimates.bias).toLocaleString()} MW
                    </strong>{' '}
                    ({actualEstimates.bias >= 0 ? 'over-prediction' : 'under-prediction'})
                  </span>
                </div>
              </div>

              {/* 3-Column Metric Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '1rem',
                  marginBottom: '1rem',
                }}
              >
                {/* 1. Raw Forecast Baseline */}
                <div style={{ border: '1px solid #e0e0e0', borderRadius: '6px', padding: '1rem', backgroundColor: '#fafafa' }}>
                  <div style={{ fontSize: '0.75rem', color: '#666666', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>
                    Published Forecast
                  </div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', margin: '0.25rem 0' }}>
                    {Math.round(actualEstimates.avgForecast).toLocaleString()} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MW avg</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#555555' }}>
                    Total: <strong>{Math.round(actualEstimates.totalForecastMWh).toLocaleString()} MWh</strong>
                  </div>
                </div>

                {/* 2. Expected Actual Value (Bias-Adjusted) - Minimum text, clean and simple */}
                <div
                  style={{
                    border: `1.5px solid ${PRIMARY_COLOR}`,
                    borderRadius: '6px',
                    padding: '1rem',
                    backgroundColor: 'rgba(20, 137, 55, 0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: PRIMARY_COLOR, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.03em' }}>
                      Expected Actual
                    </div>
                    <span style={{ fontSize: '0.65rem', backgroundColor: PRIMARY_COLOR, color: '#ffffff', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                      Bias-Adjusted
                    </span>
                  </div>
                  <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', margin: '0.25rem 0' }}>
                    {Math.round(actualEstimates.expectedActual).toLocaleString()} <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MW avg</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#555555' }}>
                    Total: <strong>{Math.round(actualEstimates.totalExpectedMWh).toLocaleString()} MWh</strong>
                  </div>
                </div>

                {/* 3. Plausible Actual Range */}
                <div style={{ border: '1px solid #e0e0e0', borderRadius: '6px', padding: '1rem', backgroundColor: '#fafafa' }}>
                  <div style={{ fontSize: '0.75rem', color: '#666666', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>
                    Plausible Range ({Math.round(coverage * 100)}th Percentile)
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#000000', margin: '0.25rem 0' }}>
                    {Math.round(actualEstimates.avgLow).toLocaleString()} – {Math.round(actualEstimates.avgHigh).toLocaleString()}{' '}
                    <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MW</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#555555' }}>
                    Total: <strong>{Math.round(actualEstimates.totalPlausibleLowMWh).toLocaleString()}</strong> – <strong>{Math.round(actualEstimates.totalPlausibleHighMWh).toLocaleString()} MWh</strong>
                  </div>
                </div>
              </div>

              {/* Intraday Trend & Ramp Analysis - Clean & Concise */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  padding: '0.65rem 1rem',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #e6e6e6',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#111111' }}>
                  {actualEstimates.trendType === 'up' && <TrendingUp size={15} color={PRIMARY_COLOR} />}
                  {actualEstimates.trendType === 'down' && <TrendingDown size={15} color="#d32f2f" />}
                  <span>Trajectory:</span>
                  <span style={{ fontWeight: 400, color: '#555555' }}>{actualEstimates.trendLabel}</span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', color: '#555555' }}>
                  <span>
                    Peak: <strong>{Math.round(actualEstimates.peakIt.forecast_mw ?? 0).toLocaleString()} MW</strong> (SP {actualEstimates.peakIt.settlement_period})
                  </span>
                  <span>
                    Min: <strong>{Math.round(actualEstimates.troughIt.forecast_mw ?? 0).toLocaleString()} MW</strong> (SP {actualEstimates.troughIt.settlement_period})
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 3. SECONDARY CHART: SHORTFALL PROBABILITY BY HALF-HOUR */}
          <div
            style={{
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              padding: '1.25rem 1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#000000' }}>
                  Shortfall Risk Concentration Across Half-Hours
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#666666' }}>
                  P(Shortfall &gt; {Math.round(data.risk_summary.threshold_mw).toLocaleString()} MW) per target settlement period
                </span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#666666' }}>
                Threshold: <strong>{Math.round(data.risk_summary.threshold_mw).toLocaleString()} MW (Historical MAE)</strong>
              </span>
            </div>

            <div style={{ height: '180px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 25, bottom: 20, left: 15 }}>
                  <CartesianGrid stroke="#f5f5f5" vertical={false} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: '#666666' }}
                    tickLine={{ stroke: '#cccccc' }}
                    axisLine={{ stroke: '#cccccc' }}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#666666' }}
                    tickLine={{ stroke: '#cccccc' }}
                    axisLine={{ stroke: '#cccccc' }}
                    tickFormatter={(val) => `${val}%`}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    formatter={(val: any) => [`${Number(val).toFixed(1)}%`, 'Shortfall Prob']}
                    labelFormatter={(lbl) => `Time: ${lbl} UTC`}
                    contentStyle={{ fontSize: '0.8rem', border: '1px solid #e0e0e0', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                  />
                  <Bar dataKey="p_shortfall_pct" fill={PRIMARY_COLOR} name="Shortfall Probability" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 4. COLLAPSED "INTERVAL DETAILS" TABLE WITH EXPORT TO CSV */}
          <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', backgroundColor: '#ffffff', overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.85rem 1.25rem',
                backgroundColor: '#fafafa',
              }}
            >
              <button
                type="button"
                onClick={() => setTableOpen(!tableOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  padding: 0,
                }}
              >
                {tableOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span>Interval Details </span>
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  border: '1px solid #000000',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                <Download size={14} />
                Export CSV
              </button>
            </div>

            {tableOpen && (
              <div style={{ overflowX: 'auto', borderTop: '1px solid #e0e0e0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f5f5f5', textAlign: 'left', borderBottom: '1px solid #d0d0d0' }}>
                      <th style={{ padding: '0.6rem 0.75rem' }}>SP</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Time (UTC)</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Forecast (MW)</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Plausible Low (MW)</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Plausible High (MW)</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>P(Shortfall &gt; T)</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Lead Time</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.intervals.map((it) => (
                      <tr key={it.settlement_period} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600 }}>{it.settlement_period}</td>
                        <td style={{ padding: '0.55rem 0.75rem' }}>{it.start_time?.slice(11, 16)}</td>
                        <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600 }}>
                          {it.forecast_mw?.toLocaleString()} MW
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem', color: PRIMARY_COLOR }}>
                          {it.actual_low_mw?.toLocaleString()} MW
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem', color: PRIMARY_COLOR }}>
                          {it.actual_high_mw?.toLocaleString()} MW
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem' }}>
                          {it.p_shortfall_gt_threshold !== null
                            ? (it.p_shortfall_gt_threshold * 100).toFixed(1) + '%'
                            : 'N/A'}
                        </td>
                        <td style={{ padding: '0.55rem 0.75rem', color: '#666' }}>{it.horizon_hours}h</td>
                        <td style={{ padding: '0.55rem 0.75rem' }}>
                          <span
                            style={{
                              padding: '0.1rem 0.35rem',
                              fontSize: '0.7rem',
                              borderRadius: '4px',
                              backgroundColor: it.basis === 'block' ? '#e8f5e9' : '#fff3e0',
                              color: it.basis === 'block' ? PRIMARY_COLOR : '#e65100',
                            }}
                          >
                            {it.basis} ({it.sample_size})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
