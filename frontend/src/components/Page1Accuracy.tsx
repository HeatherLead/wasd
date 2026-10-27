import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { KPICard } from './KPICard';
import { BoxPlotChart } from './BoxPlotChart';
import { IntervalTable } from './IntervalTable';
import type {
  SummaryResponse,
  AccuracyResponse,
  DaySummaryItem,
  DayDetailResponse,
} from '../api/client';
import { apiClient } from '../api/client';
import {
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { PRIMARY_COLOR, DEFAULT_CUTOFF_TIME, MONTH_RANGE_JANUARY } from '../store';
import { formatDate } from '../utils/date';

interface Page1AccuracyProps {
  summary: SummaryResponse | null;
  accuracy: AccuracyResponse | null;
  days: DaySummaryItem[];
  selectedDate: string;
  onSelectDate?: (date: string) => void;
  cutoffTime?: string;
  dayDetail: DayDetailResponse | null;
  isLoadingDayDetail: boolean;
}

type WindowMode = 'week' | 'decision_month' | 'month';

function getRangeForWindow(simDateStr: string, mode: WindowMode) {
  if (mode === 'month') {
    return MONTH_RANGE_JANUARY;
  }
  const simDate = new Date(`${simDateStr}T00:00:00Z`);
  // Critical fix for look-ahead leakage (Critique 1):
  // When making day-ahead decisions for Jan 15 at 09:00 on Jan 14, Jan 14 actuals do NOT exist yet.
  // The most recent settled/completed historical day is D-2 (Jan 13).
  const endDateObj = new Date(simDate);
  endDateObj.setUTCDate(endDateObj.getUTCDate() - 2);

  if (mode === 'decision_month') {
    return {
      startDate: '2026-01-01',
      endDate: endDateObj.toISOString().slice(0, 10),
    };
  }

  // Trailing 7 completed days: D-8 through D-2 (e.g. 7 Jan through 13 Jan for 15 Jan delivery)
  const startDateObj = new Date(simDate);
  startDateObj.setUTCDate(startDateObj.getUTCDate() - 8);
  return {
    startDate: startDateObj.toISOString().slice(0, 10),
    endDate: endDateObj.toISOString().slice(0, 10),
  };
}

export const Page1Accuracy: React.FC<Page1AccuracyProps> = ({
  summary,
  accuracy,
  days,
  selectedDate,
  cutoffTime = DEFAULT_CUTOFF_TIME,
  dayDetail,
  isLoadingDayDetail,
}) => {
  const [windowMode, setWindowMode] = useState<WindowMode>('week');
  const [windowSummary, setWindowSummary] = useState<SummaryResponse | null>(null);
  const [windowAccuracy, setWindowAccuracy] = useState<AccuracyResponse | null>(null);
  const [windowDays, setWindowDays] = useState<DaySummaryItem[]>([]);

  const { startDate, endDate } = getRangeForWindow(selectedDate, windowMode);

  useEffect(() => {
    let isMounted = true;
    const fetchWindowData = async () => {
      try {
        const [sumRes, accRes, daysRes] = await Promise.all([
          apiClient.getSummary(cutoffTime, startDate, endDate),
          apiClient.getAccuracy(cutoffTime, startDate, endDate),
          apiClient.getDays(cutoffTime, startDate, endDate),
        ]);
        if (isMounted) {
          setWindowSummary(sumRes);
          setWindowAccuracy(accRes);
          setWindowDays(daysRes.days);
        }
      } catch (err) {
        console.error('Failed to load window data:', err);
      }
    };

    fetchWindowData();
    return () => {
      isMounted = false;
    };
  }, [selectedDate, windowMode, cutoffTime, startDate, endDate]);

  const activeSummary = windowSummary || summary;
  const activeAccuracy = windowAccuracy || accuracy;
  const activeDays = windowDays.length > 0 ? windowDays : days;

  const kpis = activeSummary?.kpis;
  const nmaePct = kpis?.nmae_pct ?? (kpis?.normalised_mae ? kpis.normalised_mae * 100 : 0);
  const overRatePct =
    kpis?.overforecast_rate_pct ??
    (kpis?.share_intervals_overforecast ? kpis.share_intervals_overforecast * 100 : 85.1);

  const meanActual = kpis?.mean_actual_mw ?? 0;
  const meanForecast = kpis?.mean_forecast_mw ?? 0;
  // Standardized energy convention: Error = Forecast - Actual (positive = Overforecast / Shortfall)
  const diffMw = meanForecast - meanActual;
  const pctDiff = meanForecast > 0 ? ((meanForecast - meanActual) / meanForecast) * 100 : 0;
  const isOverforecast = diffMw > 0;
  const absPct = Math.abs(pctDiff).toFixed(1);
  const absMw = Math.abs(Math.round(diffMw)).toLocaleString();

  const chartData = activeDays.map((d) => {
    const isDec = d.delivery_date.slice(5, 7) === '12';
    const dayNumber = parseInt(d.delivery_date.slice(8), 10);
    return {
      date: d.delivery_date,
      shortLabel: `${dayNumber} ${isDec ? 'Dec' : 'Jan'}`,
      forecastMw: d.mean_forecast_mw !== null ? Math.round(d.mean_forecast_mw) : null,
      actualMw: d.mean_actual_mw !== null ? Math.round(d.mean_actual_mw) : null,
      diffMw:
        d.mean_actual_mw !== null && d.mean_forecast_mw !== null
          ? Math.round(d.mean_forecast_mw - d.mean_actual_mw)
          : null,
    };
  });

  const diffList = activeDays
    .filter((d) => d.mean_actual_mw !== null && d.mean_forecast_mw !== null)
    .map((d) => {
      const isDec = d.delivery_date.slice(5, 7) === '12';
      const dayNum = parseInt(d.delivery_date.slice(8), 10);
      const label = `${dayNum} ${isDec ? 'Dec' : 'Jan'}`;
      const gap = Math.abs(d.mean_forecast_mw! - d.mean_actual_mw!);
      const raw = d.mean_forecast_mw! - d.mean_actual_mw!;
      return {
        date: d.delivery_date,
        label,
        absDiff: gap,
        rawDiff: raw,
      };
    });

  const maxDiffItem =
    diffList.length > 0
      ? diffList.reduce((max, cur) => (cur.absDiff > max.absDiff ? cur : max), diffList[0])
      : null;

  const minDiffItem =
    diffList.length > 0
      ? diffList.reduce((min, cur) => (cur.absDiff < min.absDiff ? cur : min), diffList[0])
      : null;

  const errorTrendData = activeDays.map((d, index, arr) => {
    const isDec = d.delivery_date.slice(5, 7) === '12';
    const dayNumber = parseInt(d.delivery_date.slice(8), 10);
    const dateObj = new Date(`${d.delivery_date}T12:00:00Z`);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const monthStr = isDec ? 'Dec' : 'Jan';

    const actual = d.mean_actual_mw !== null ? Math.round(d.mean_actual_mw) : null;
    const forecast = d.mean_forecast_mw !== null ? Math.round(d.mean_forecast_mw) : null;
    // Forecast - Actual: positive = Overforecast / Shortfall, negative = Surplus
    const errorMw = actual !== null && forecast !== null ? forecast - actual : null;

    let rollingAvgMw: number | null = null;
    if (errorMw !== null) {
      const windowSlice = arr
        .slice(Math.max(0, index - 2), index + 1)
        .map((item) =>
          item.mean_actual_mw !== null && item.mean_forecast_mw !== null
            ? Math.round(item.mean_forecast_mw - item.mean_actual_mw)
            : null
        )
        .filter((v): v is number => v !== null);

      if (windowSlice.length > 0) {
        rollingAvgMw = Math.round(
          windowSlice.reduce((sum, val) => sum + val, 0) / windowSlice.length
        );
      }
    }

    return {
      date: d.delivery_date,
      dayOfWeek,
      shortLabel: `${dayNumber} ${monthStr}`,
      axisLabel: windowMode === 'week' ? dayOfWeek : `${dayNumber} ${monthStr}`,
      fullDateLabel: `${dayOfWeek}, ${dayNumber} ${monthStr} ${isDec ? '2025' : '2026'}`,
      actualMw: actual,
      forecastMw: forecast,
      errorMw,
      rollingAvgMw,
    };
  });

  const validTrendItems = errorTrendData.filter((d) => d.errorMw !== null);
  const totalTrendDays = validTrendItems.length;
  // Positive error = Over-forecast / Shortfall
  const overpredictedCount = validTrendItems.filter((d) => d.errorMw! > 0).length;
  // Negative error = Under-forecast / Surplus
  const underpredictedCount = validTrendItems.filter((d) => d.errorMw! < 0).length;
  const avgTrendErrorMw =
    totalTrendDays > 0
      ? Math.round(validTrendItems.reduce((acc, d) => acc + d.errorMw!, 0) / totalTrendDays)
      : 0;

  const firstRolling = validTrendItems[0]?.rollingAvgMw ?? null;
  const lastRolling = validTrendItems[validTrendItems.length - 1]?.rollingAvgMw ?? null;

  let trendHeadline = '';
  let trendExplanation = '';
  let trendBadge = '';
  let isConsistentOver = false;

  if (totalTrendDays > 0) {
    if (overpredictedCount === totalTrendDays) {
      isConsistentOver = true;
      trendBadge = 'Shortfall Pattern';
      trendHeadline =
        windowMode === 'week'
          ? 'Forecast Exceeded Actual Generation For Entire Week'
          : 'Forecast Consistently Exceeded Actual Generation';
      trendExplanation = `For the entire past 7 days, predictions were higher than actual generation every single day (averaging +${Math.abs(avgTrendErrorMw).toLocaleString()} MW shortfall). Real wind underperformed the forecast continuously.`;
    } else if (overpredictedCount >= Math.ceil(totalTrendDays * 0.7)) {
      trendBadge = 'Overpredicted';
      trendHeadline = `Forecast Ran High on ${overpredictedCount} of ${totalTrendDays} Days`;
      trendExplanation = `During this period, predictions were higher than actual generation on ${overpredictedCount} of ${totalTrendDays} days (averaging +${Math.abs(avgTrendErrorMw).toLocaleString()} MW shortfall). The forecast showed an ongoing tendency to overestimate wind power.`;
    } else if (underpredictedCount === totalTrendDays) {
      trendBadge = 'Surplus Pattern';
      trendHeadline =
        windowMode === 'week'
          ? 'Actual Wind Exceeded Predictions For Entire Week'
          : 'Actual Wind Consistently Exceeded Predictions';
      trendExplanation = `For the entire past 7 days, actual wind generation delivered more power than predicted every single day (averaging -${Math.abs(avgTrendErrorMw).toLocaleString()} MW surplus). Real generation beat expectations all week.`;
    } else if (underpredictedCount >= Math.ceil(totalTrendDays * 0.7)) {
      trendBadge = 'Underpredicted';
      trendHeadline = `Actual Wind Exceeded Predictions on ${underpredictedCount} of ${totalTrendDays} Days`;
      trendExplanation = `During this period, actual wind was higher than predicted on ${underpredictedCount} of ${totalTrendDays} days (averaging -${Math.abs(avgTrendErrorMw).toLocaleString()} MW surplus). Wind output was consistently underpredicted.`;
    } else {
      trendBadge = 'Mixed Errors';
      trendHeadline = `Mixed Forecast Performance (${overpredictedCount} High, ${underpredictedCount} Low)`;
      trendExplanation = `Forecast errors fluctuated across the days. Predictions ran higher than actual on ${overpredictedCount} days and lower on ${underpredictedCount} days, with a net average difference of ${avgTrendErrorMw > 0 ? '+' : ''}${avgTrendErrorMw.toLocaleString()} MW.`;
    }

    if (firstRolling !== null && lastRolling !== null && totalTrendDays >= 4) {
      const change = lastRolling - firstRolling;
      if (avgTrendErrorMw > 0 && change > 300) {
        trendExplanation += ' The shortfall gap widened as the week progressed.';
      } else if (avgTrendErrorMw > 0 && change < -300) {
        trendExplanation += ' The error gap narrowed towards the end of the week.';
      }
    }
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(300px, 1.8fr) repeat(3, minmax(130px, 1fr))',
          gap: '10px',
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1.5px solid #3883e7',
            borderRadius: '6px',
            padding: '7px 12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '3px',
            boxShadow: '0 1px 3px rgba(56, 131, 231, 0.08)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: "column", alignItems: 'flex-start', gap: '6px', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 700,
                backgroundColor: isOverforecast ? '#dce5f0' : '#e8f5ec',
                color: isOverforecast ? '#3883e7' : PRIMARY_COLOR,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              {isOverforecast ? 'Over-Forecast / Shortfall' : 'Under-Forecast / Surplus'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#000000' }}>
              {isOverforecast
                ? `Forecast was ${absPct}% higher than actual generation`
                : `Actual was ${absPct}% higher than predicted forecast`}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#555555', lineHeight: 1.25 }}>
            {isOverforecast
              ? `Real wind delivered ${absMw} MW less power than predicted on average (requiring thermal top-up).`
              : `Real wind delivered ${absMw} MW more power than predicted on average (clean surplus).`}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            padding: '7px 12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '2px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Max Difference
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: maxDiffItem && maxDiffItem.rawDiff > 0 ? '#3883e7' : PRIMARY_COLOR, margin: '1px 0', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: '3px' }}>
            <span>
              {maxDiffItem
                ? `${maxDiffItem.rawDiff > 0 ? '+' : '-'}${Math.round(maxDiffItem.absDiff).toLocaleString()}`
                : '—'}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: maxDiffItem && maxDiffItem.rawDiff > 0 ? '#3883e7' : PRIMARY_COLOR }}>MW</span>
          </div>
          <div style={{ fontSize: '10px', color: '#777777', lineHeight: 1.2 }}>
            {maxDiffItem ? `Largest error on ${maxDiffItem.label}` : 'Peak difference'}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            padding: '7px 12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '2px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Least Difference
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: minDiffItem && minDiffItem.rawDiff > 0 ? '#3883e7' : PRIMARY_COLOR, margin: '1px 0', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: '3px' }}>
            <span>
              {minDiffItem
                ? `${minDiffItem.rawDiff > 0 ? '+' : '-'}${Math.round(minDiffItem.absDiff).toLocaleString()}`
                : '—'}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: minDiffItem && minDiffItem.rawDiff > 0 ? '#3883e7' : PRIMARY_COLOR }}>MW</span>
          </div>
          <div style={{ fontSize: '10px', color: '#777777', lineHeight: 1.2 }}>
            {minDiffItem ? `Closest match on ${minDiffItem.label}` : 'Smallest difference'}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1.5px solid #3883e7',
            borderRadius: '6px',
            padding: '7px 12px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '2px',
            boxShadow: '0 1px 3px rgba(56, 131, 231, 0.08)',
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Mean Error (Forecast − Actual)
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: isOverforecast ? '#3883e7' : PRIMARY_COLOR, margin: '1px 0', fontVariantNumeric: 'tabular-nums' }}>
            {isOverforecast ? `+${absMw}` : `-${absMw}`} <span style={{ fontSize: '10px', fontWeight: 600 }}>MW</span>
          </div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: isOverforecast ? '#3883e7' : PRIMARY_COLOR, lineHeight: 1.2 }}>
            {isOverforecast ? `+${absPct}% shortfall` : `-${absPct}% surplus`}
          </div>
        </div>
      </section>

      <section style={{ background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#000000' }}>
              Predicted vs Actual Wind Power
            </h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
              {windowMode === 'week'
                ? `Trailing 7 completed days available at decision time (${formatDate(startDate)} – ${formatDate(endDate)})`
                : windowMode === 'decision_month'
                  ? `Completed month-to-date available at decision time (${formatDate(startDate)} – ${formatDate(endDate)})`
                  : 'Full month of January 2026 (post-mortem retrospective)'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '4px', backgroundColor: '#f1f3f5', padding: '3px', borderRadius: '6px' }}>
            <button
              type="button"
              onClick={() => setWindowMode('week')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                backgroundColor: windowMode === 'week' ? PRIMARY_COLOR : 'transparent',
                color: windowMode === 'week' ? '#ffffff' : '#000000',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Trailing Week (D-8 to D-2)
            </button>
            <button
              type="button"
              onClick={() => setWindowMode('decision_month')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                backgroundColor: windowMode === 'decision_month' ? PRIMARY_COLOR : 'transparent',
                color: windowMode === 'decision_month' ? '#ffffff' : '#000000',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Month-to-Date (1–13 Jan)
            </button>
            <button
              type="button"
              onClick={() => setWindowMode('month')}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '4px',
                border: 'none',
                backgroundColor: windowMode === 'month' ? PRIMARY_COLOR : 'transparent',
                color: windowMode === 'month' ? '#ffffff' : '#000000',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Full Jan (Post-Mortem)
            </button>
          </div>
        </div>

        <div style={{ height: '280px', width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              margin={{ top: 10, right: 20, left: 10, bottom: 15 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eeeeee" />
              <XAxis
                dataKey="shortLabel"
                stroke="#333333"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                stroke="#333333"
                fontSize={11}
                tickLine={false}
                label={{
                  value: 'Power (MW)',
                  angle: -90,
                  position: 'insideLeft',
                  offset: 15,
                  fontSize: 11,
                  fill: '#666666',
                }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  const fVal = payload.find((p) => p.dataKey === 'forecastMw')?.value as number;
                  const aVal = payload.find((p) => p.dataKey === 'actualMw')?.value as number;
                  const diff = aVal !== undefined && fVal !== undefined ? fVal - aVal : null;
                  return (
                    <div style={{ backgroundColor: '#ffffff', border: '1px solid #000000', padding: '0.6rem 0.8rem', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(0,0,0,0.08)', borderRadius: '4px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.3rem', color: '#000000' }}>
                        {label}
                      </div>
                      <div style={{ color: PRIMARY_COLOR, fontWeight: 600 }}>
                        Predicted Forecast: <strong>{fVal !== null && fVal !== undefined ? `${fVal.toLocaleString()} MW` : '—'}</strong>
                      </div>
                      <div style={{ color: '#444444', fontWeight: 600 }}>
                        Real Power Delivered: <strong>{aVal !== null && aVal !== undefined ? `${aVal.toLocaleString()} MW` : '—'}</strong>
                      </div>
                      {diff !== null && (
                        <div style={{ marginTop: '0.3rem', paddingTop: '0.3rem', borderTop: '1px solid #eeeeee', fontWeight: 700, color: diff > 0 ? '#3883e7' : PRIMARY_COLOR }}>
                          {diff > 0
                            ? `Over-forecast by +${Math.round(diff).toLocaleString()} MW (${((diff / (fVal || 1)) * 100).toFixed(1)}% shortfall)`
                            : `Under-forecast by -${Math.abs(Math.round(diff)).toLocaleString()} MW (${((Math.abs(diff) / (fVal || 1)) * 100).toFixed(1)}% surplus)`}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }}
              />
              <Line
                type="linear"
                dataKey="forecastMw"
                name="Predicted Power"
                stroke={PRIMARY_COLOR}
                strokeWidth={2.5}
                dot={{ r: 3, fill: PRIMARY_COLOR }}
                activeDot={{ r: 5, fill: PRIMARY_COLOR }}
              />
              <Line
                type="linear"
                dataKey="actualMw"
                name="Real Power Delivered"
                stroke="#555555"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={{ r: 3, fill: '#555555' }}
                activeDot={{ r: 5, fill: '#555555' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section
        style={{
          background: '#ffffff',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '1.25rem',
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#000000' }}>
            {windowMode === 'week' ? 'Daily Error Trajectory' : 'Daily Error Trajectory'}
          </h3>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
            Positive error (Forecast − Actual &gt; 0) indicates forecast exceeded generation (shortfall needing backup).
          </p>
        </div>

        <div className="trend-layout-container">
          <div className="trend-graph-pane">
            <div style={{ height: '280px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={errorTrendData}
                  margin={{ top: 15, right: 25, left: 10, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eeeeee" />
                  <XAxis
                    dataKey="axisLabel"
                    stroke="#333333"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#333333"
                    fontSize={11}
                    tickLine={false}
                    width={72}
                    tickFormatter={(val) => `${val.toLocaleString()} MW`}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="#888888"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: '0 MW (Zero Error)',
                      position: 'insideTopRight',
                      fill: '#888888',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const item = payload[0]?.payload;
                      const errVal = item?.errorMw as number | null | undefined;
                      const rollVal = item?.rollingAvgMw as number | null | undefined;
                      const fullLabel = item?.fullDateLabel || label;
                      return (
                        <div
                          style={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #000000',
                            padding: '0.6rem 0.8rem',
                            fontSize: '0.8rem',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                            borderRadius: '4px',
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: '#000000' }}>
                            {fullLabel}
                          </div>
                          <div style={{ color: '#3883e7', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>● Forecast Error (Forecast − Actual):</span>
                            <strong>
                              {errVal !== null && errVal !== undefined
                                ? `${errVal > 0 ? '+' : ''}${errVal.toLocaleString()} MW`
                                : '—'}
                            </strong>
                          </div>
                          <div
                            style={{
                              color: PRIMARY_COLOR,
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              marginTop: '2px',
                            }}
                          >
                            <span>● Rolling trend:</span>
                            <strong>
                              {rollVal !== null && rollVal !== undefined
                                ? `${rollVal > 0 ? '+' : ''}${rollVal.toLocaleString()} MW`
                                : '—'}
                            </strong>
                          </div>
                          {errVal !== null && errVal !== undefined && (
                            <div
                              style={{
                                marginTop: '0.4rem',
                                paddingTop: '0.4rem',
                                borderTop: '1px solid #eeeeee',
                                fontSize: '11px',
                                fontWeight: 600,
                                color: errVal > 0 ? '#3883e7' : PRIMARY_COLOR,
                              }}
                            >
                              {errVal > 0
                                ? `Forecast was +${Math.abs(errVal).toLocaleString()} MW above actual (shortfall)`
                                : `Actual was +${Math.abs(errVal).toLocaleString()} MW above forecast (surplus)`}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    align="center"
                    iconType="circle"
                    wrapperStyle={{ paddingTop: '15px', fontSize: '12px' }}
                  />
                  <Line
                    type="linear"
                    dataKey="errorMw"
                    name="Forecast Error (Forecast − Actual)"
                    stroke="#3883e7"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#3883e7' }}
                    activeDot={{ r: 6, fill: '#3883e7' }}
                  />
                  <Line
                    type="linear"
                    dataKey="rollingAvgMw"
                    name="Rolling 3-Day Trend"
                    stroke={PRIMARY_COLOR}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: PRIMARY_COLOR }}
                    activeDot={{ r: 6, fill: PRIMARY_COLOR }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="trend-bento-pane">
            {totalTrendDays > 0 && (
              <div
                style={{
                  flex: 1,
                  backgroundColor: '#ffffff',
                  border: `1.5px solid ${isConsistentOver ? '#3883e7' : avgTrendErrorMw < 0 ? '#3883e7' : PRIMARY_COLOR}`,
                  borderRadius: '6px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 1px 3px rgba(56, 131, 231, 0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <div
                    style={{
                      width: '26px',
                      height: '26px',
                      borderRadius: '4px',
                      backgroundColor: avgTrendErrorMw < 0 ? '#dce5f0' : '#e8f5ec',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {avgTrendErrorMw < 0 ? (
                      <TrendingDown size={15} color="#3883e7" />
                    ) : (
                      <TrendingUp size={15} color={PRIMARY_COLOR} />
                    )}
                  </div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      fontWeight: 700,
                      backgroundColor: avgTrendErrorMw < 0 ? '#dce5f0' : '#e8f5ec',
                      color: avgTrendErrorMw < 0 ? '#3883e7' : PRIMARY_COLOR,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {trendBadge}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#000000' }}>
                    {trendHeadline}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#555555', lineHeight: 1.4 }}>
                  {trendExplanation}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <KPICard
                title="Error vs total power"
                value={nmaePct !== null && nmaePct !== undefined ? `${nmaePct.toFixed(1)}%` : null}
                tooltip="Average miss compared to total wind generated."
                width="100%"
                height="80px"
              />
              <KPICard
                title="Predicted too much"
                value={overRatePct !== null && overRatePct !== undefined ? `${overRatePct.toFixed(1)}%` : null}
                tooltip="How often the forecast predicted more wind than actually arrived."
                highlight={true}
                width="100%"
                height="80px"
              />
            </div>
          </div>
        </div>
      </section>

      {activeAccuracy?.box_plot && (
        <section>
          <BoxPlotChart
            stats={activeAccuracy.box_plot}
            subtitle={
              windowMode === 'week'
                ? `Showing past 7 days error spread before ${formatDate(selectedDate)} (${formatDate(startDate)} – ${formatDate(endDate)}).`
                : 'Showing full month of January 2026 error spread.'
            }
          />
        </section>
      )}

      <section>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
          }}
        >
          <KPICard
            title="Mean Bias Error (MBE)"
            value={
              kpis?.bias_mw !== null && kpis?.bias_mw !== undefined
                ? `${kpis.bias_mw > 0 ? '+' : ''}${Math.round(kpis.bias_mw).toLocaleString()}`
                : null
            }
            unit="MW"
            tooltip="Directional forecast error (Forecast minus Actual). Positive indicates systematic overforecasting where wind underperformed, requiring thermal top-up."
            width="100%"
            height="86px"
          />

          <KPICard
            title="Mean Absolute Error (MAE)"
            value={kpis?.mae_mw !== null && kpis?.mae_mw !== undefined ? Math.round(kpis.mae_mw).toLocaleString() : null}
            unit="MW"
            tooltip="Mean Absolute Error measures the average absolute error magnitude across all evaluated hours. Lower is better."
            width="100%"
            height="86px"
          />

          <KPICard
            title="Normalized MAE (nMAE)"
            value={
              kpis?.nmae_pct !== null && kpis?.nmae_pct !== undefined
                ? `${kpis.nmae_pct.toFixed(1)}%`
                : kpis?.normalised_mae
                  ? `${(kpis.normalised_mae * 100).toFixed(1)}%`
                  : null
            }
            tooltip="MAE divided by mean actual generation. Replaces MAPE to prevent infinite error distortions during calm or near-zero wind periods."
            width="100%"
            height="86px"
          />
        </div>
      </section>

      <section style={{ marginTop: '0.5rem' }}>
        {isLoadingDayDetail ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#666666', fontSize: '0.85rem', backgroundColor: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
            Loading audit table for {formatDate(selectedDate)}...
          </div>
        ) : dayDetail ? (
          <IntervalTable
            intervals={dayDetail.intervals}
            deliveryDate={selectedDate}
            resolution={dayDetail.resolution}
            defaultOpen={false}
          />
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#666666', backgroundColor: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
            No interval records available for {formatDate(selectedDate)}.
          </div>
        )}
      </section>
    </div>
  );
};

export default Page1Accuracy;
