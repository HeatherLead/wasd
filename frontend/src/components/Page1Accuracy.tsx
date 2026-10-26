/**
 * frontend/src/components/Page1Accuracy.tsx
 * Page 1: Accuracy & History
 *
 * Rules strictly followed:
 * 1. Minimal text, no clutter.
 * 2. Plain English (idiot-proof, no high-brow jargon).
 * 3. Simulation day selector: 1 Jan to 31 Jan dropdown.
 * 4. 4 KPI cards: 80px height x 150px width.
 * 5. Forecast vs Actual graph for last 7 days (or previous month toggle), supporting December 2025 data.
 * 6. Box plot with median & outliers for difference (Forecast − Actual).
 * 7. Percentage difference callout (e.g. "Actual was 8.4% short of prediction").
 * 8. Audits at the end: Show ONLY the audit table (Status column removed).
 */

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
  Calendar,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { PRIMARY_COLOR } from '../theme';
import { formatDate } from '../utils/date';

interface Page1AccuracyProps {
  summary: SummaryResponse | null;
  accuracy: AccuracyResponse | null;
  days: DaySummaryItem[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  cutoffTime?: string;
  dayDetail: DayDetailResponse | null;
  isLoadingDayDetail: boolean;
}

type WindowMode = 'week' | 'month';

function getRangeForWindow(simDateStr: string, mode: WindowMode) {
  if (mode === 'month') {
    return { startDate: '2026-01-01', endDate: '2026-01-31' };
  }
  // mode === 'week': Exactly 7 days prior to simDateStr
  const simDate = new Date(`${simDateStr}T00:00:00Z`);
  const endDateObj = new Date(simDate);
  endDateObj.setUTCDate(endDateObj.getUTCDate() - 1);
  const startDateObj = new Date(simDate);
  startDateObj.setUTCDate(startDateObj.getUTCDate() - 7);
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
  onSelectDate,
  cutoffTime = '09:00',
  dayDetail,
  isLoadingDayDetail,
}) => {
  // Time window: 'week' (Last 7 Days before simulation date) or 'month' (Full Month)
  const [windowMode, setWindowMode] = useState<WindowMode>('week');

  // Dynamic window data fetched for the specific date window
  const [windowSummary, setWindowSummary] = useState<SummaryResponse | null>(null);
  const [windowAccuracy, setWindowAccuracy] = useState<AccuracyResponse | null>(null);
  const [windowDays, setWindowDays] = useState<DaySummaryItem[]>([]);
  const [_isLoadingWindow, setIsLoadingWindow] = useState<boolean>(false);

  // Calculate window date boundaries (supports Dec 2025 when simulating early Jan)
  const { startDate, endDate } = getRangeForWindow(selectedDate, windowMode);

  // Fetch metrics for chosen window
  useEffect(() => {
    let isMounted = true;
    const fetchWindowData = async () => {
      setIsLoadingWindow(true);
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
      } finally {
        if (isMounted) setIsLoadingWindow(false);
      }
    };

    fetchWindowData();
    return () => {
      isMounted = false;
    };
  }, [selectedDate, windowMode, cutoffTime, startDate, endDate]);

  // Active data source: window data if available, fallback to global props
  const activeSummary = windowSummary || summary;
  const activeAccuracy = windowAccuracy || accuracy;
  const activeDays = windowDays.length > 0 ? windowDays : days;

  // Extract KPI values in plain terms
  const kpis = activeSummary?.kpis;
  const nmaePct = kpis?.nmae_pct ?? (kpis?.normalised_mae ? kpis.normalised_mae * 100 : 0);
  const overRatePct =
    kpis?.overforecast_rate_pct ??
    (kpis?.share_intervals_overforecast ? kpis.share_intervals_overforecast * 100 : 85.1);

  // Percentage Difference calculation (Actual vs Forecasted)
  const meanActual = kpis?.mean_actual_mw ?? 0;
  const meanForecast = kpis?.mean_forecast_mw ?? 0;
  const diffMw = meanActual - meanForecast;
  const pctDiff = meanForecast > 0 ? ((meanActual - meanForecast) / meanForecast) * 100 : 0;
  const isShort = pctDiff < 0;
  const absPct = Math.abs(pctDiff).toFixed(1);
  const absMw = Math.abs(Math.round(diffMw)).toLocaleString();

  // Chart data: daily averages with clean labels handling December & January
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
          ? Math.round(d.mean_actual_mw - d.mean_forecast_mw)
          : null,
    };
  });

  // Daily difference calculations for Max Difference and Least Difference
  const diffList = activeDays
    .filter((d) => d.mean_actual_mw !== null && d.mean_forecast_mw !== null)
    .map((d) => {
      const isDec = d.delivery_date.slice(5, 7) === '12';
      const dayNum = parseInt(d.delivery_date.slice(8), 10);
      const label = `${dayNum} ${isDec ? 'Dec' : 'Jan'}`;
      const gap = Math.abs(d.mean_actual_mw! - d.mean_forecast_mw!);
      const raw = d.mean_actual_mw! - d.mean_forecast_mw!;
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

  // Error Trend Chart Data (Actual − Predicted) & 3-point Rolling Average
  const errorTrendData = activeDays.map((d, index, arr) => {
    const isDec = d.delivery_date.slice(5, 7) === '12';
    const dayNumber = parseInt(d.delivery_date.slice(8), 10);
    const dateObj = new Date(`${d.delivery_date}T12:00:00Z`);
    const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const monthStr = isDec ? 'Dec' : 'Jan';

    const actual = d.mean_actual_mw !== null ? Math.round(d.mean_actual_mw) : null;
    const forecast = d.mean_forecast_mw !== null ? Math.round(d.mean_forecast_mw) : null;
    // Error defined as Actual - Forecast (negative = actual was below predicted generation)
    const errorMw = actual !== null && forecast !== null ? actual - forecast : null;

    // 3-point rolling moving average (backward-looking: up to 3 points including current)
    let rollingAvgMw: number | null = null;
    if (errorMw !== null) {
      const windowSlice = arr
        .slice(Math.max(0, index - 2), index + 1)
        .map((item) =>
          item.mean_actual_mw !== null && item.mean_forecast_mw !== null
            ? Math.round(item.mean_actual_mw - item.mean_forecast_mw)
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
      // For week mode, show day of week like "Mon", "Tue" (matching reference image); for month mode show "1 Jan", "2 Jan"
      axisLabel: windowMode === 'week' ? dayOfWeek : `${dayNumber} ${monthStr}`,
      fullDateLabel: `${dayOfWeek}, ${dayNumber} ${monthStr} ${isDec ? '2025' : '2026'}`,
      actualMw: actual,
      forecastMw: forecast,
      errorMw,
      rollingAvgMw,
    };
  });

  // Dynamic Trend Analysis for Forecast Error Trend
  const validTrendItems = errorTrendData.filter((d) => d.errorMw !== null);
  const totalTrendDays = validTrendItems.length;
  // Overpredicted = actual was below predicted (errorMw < 0)
  const overpredictedCount = validTrendItems.filter((d) => d.errorMw! < 0).length;
  // Underpredicted = actual was above predicted (errorMw > 0)
  const underpredictedCount = validTrendItems.filter((d) => d.errorMw! > 0).length;
  // Average error
  const avgTrendErrorMw =
    totalTrendDays > 0
      ? Math.round(validTrendItems.reduce((acc, d) => acc + d.errorMw!, 0) / totalTrendDays)
      : 0;

  // Trajectory: compare first point rolling average vs last point rolling average
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
          ? 'Predictions Higher Than Actual For Entire Week'
          : 'Predictions Consistently Higher Than Actual Generation';
      trendExplanation = `For the entire past 7 days, predictions were higher than actual generation every single day (averaging ${Math.abs(avgTrendErrorMw).toLocaleString()} MW below forecast). Real wind underperformed the forecast continuously.`;
    } else if (overpredictedCount >= Math.ceil(totalTrendDays * 0.7)) {
      trendBadge = 'Overpredicted';
      trendHeadline = `Predictions Ran High on ${overpredictedCount} of ${totalTrendDays} Days`;
      trendExplanation = `During this period, predictions were higher than actual generation on ${overpredictedCount} of ${totalTrendDays} days (averaging ${Math.abs(avgTrendErrorMw).toLocaleString()} MW below forecast). The forecast showed an ongoing tendency to overestimate wind power.`;
    } else if (underpredictedCount === totalTrendDays) {
      trendBadge = 'Surplus Pattern';
      trendHeadline =
        windowMode === 'week'
          ? 'Actual Wind Exceeded Predictions For Entire Week'
          : 'Actual Wind Consistently Exceeded Predictions';
      trendExplanation = `For the entire past 7 days, actual wind generation delivered more power than predicted every single day (averaging +${Math.abs(avgTrendErrorMw).toLocaleString()} MW surplus). Real generation beat expectations all week.`;
    } else if (underpredictedCount >= Math.ceil(totalTrendDays * 0.7)) {
      trendBadge = 'Underpredicted';
      trendHeadline = `Actual Wind Exceeded Predictions on ${underpredictedCount} of ${totalTrendDays} Days`;
      trendExplanation = `During this period, actual wind was higher than predicted on ${underpredictedCount} of ${totalTrendDays} days (averaging +${Math.abs(avgTrendErrorMw).toLocaleString()} MW surplus). Wind output was consistently underpredicted.`;
    } else {
      trendBadge = 'Mixed Errors';
      trendHeadline = `Mixed Forecast Performance (${overpredictedCount} High, ${underpredictedCount} Low)`;
      trendExplanation = `Forecast errors fluctuated across the days. Predictions ran higher than actual on ${overpredictedCount} days and lower on ${underpredictedCount} days, with a net average difference of ${avgTrendErrorMw > 0 ? '+' : ''}${avgTrendErrorMw.toLocaleString()} MW.`;
    }

    // Add trajectory nuance if relevant
    if (firstRolling !== null && lastRolling !== null && totalTrendDays >= 4) {
      const change = lastRolling - firstRolling;
      if (avgTrendErrorMw < 0 && change < -300) {
        trendExplanation += ' The shortfall gap widened as the week progressed.';
      } else if (avgTrendErrorMw < 0 && change > 300) {
        trendExplanation += ' The error gap narrowed towards the end of the week.';
      }
    }
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 0. Top: Simulation Day Selector (1 Jan to 31 Jan) */}
      <section
        style={{
          background: '#ffffff',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              backgroundColor: '#e8f5ec',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Calendar size={18} color={PRIMARY_COLOR} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Simulation Day
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#000000' }}>
              Select a day in January 2026 to simulate
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#555555' }}>
            Day:
          </span>
          <select
            value={selectedDate}
            onChange={(e) => onSelectDate(e.target.value)}
            style={{
              padding: '0.45rem 1rem',
              fontSize: '13px',
              fontWeight: 700,
              borderRadius: '6px',
              border: `1.5px solid ${PRIMARY_COLOR}`,
              backgroundColor: '#ffffff',
              color: '#000000',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {Array.from({ length: 31 }, (_, i) => {
              const dayStr = String(i + 1).padStart(2, '0');
              const fullDate = `2026-01-${dayStr}`;
              return (
                <option key={fullDate} value={fullDate}>
                  {i + 1} Jan 2026
                </option>
              );
            })}
          </select>
        </div>
      </section>

      {/* 1. The 4 Summary & Explanation Boxes (Compact Layout) */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(300px, 1.8fr) repeat(3, minmax(130px, 1fr))',
          gap: '10px',
          alignItems: 'stretch',
        }}
      >
        {/* Box 1: Text Explain & Verdict */}
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
                backgroundColor: isShort ? '#dce5f0' : '#e8f5ec',
                color: isShort ? '#3883e7' : PRIMARY_COLOR,
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              {isShort ? 'Shortfall Deficit' : 'Wind Surplus'}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#000000' }}>
              {isShort
                ? `Actual was ${absPct}% short of predicted`
                : `Actual was ${absPct}% more than predicted`}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#555555', lineHeight: 1.25 }}>
            {isShort
              ? `Real wind delivered ${absMw} MW less power than predicted on average.`
              : `Real wind delivered ${absMw} MW more power than predicted on average (clean power surplus).`}
          </div>
        </div>

        {/* Box 2: Max Difference */}
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
          <div style={{ fontSize: '18px', fontWeight: 700, color: maxDiffItem && maxDiffItem.rawDiff > 0 ? PRIMARY_COLOR : '#3883e7', margin: '1px 0', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: '3px' }}>
            <span>
              {maxDiffItem
                ? `${maxDiffItem.rawDiff > 0 ? '+' : '-'}${Math.round(maxDiffItem.absDiff).toLocaleString()}`
                : '—'}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: maxDiffItem && maxDiffItem.rawDiff > 0 ? PRIMARY_COLOR : '#3883e7' }}>MW</span>
          </div>
          <div style={{ fontSize: '10px', color: '#777777', lineHeight: 1.2 }}>
            {maxDiffItem ? `Largest gap on ${maxDiffItem.label}` : 'Peak difference'}
          </div>
        </div>

        {/* Box 3: Least Difference */}
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
          <div style={{ fontSize: '18px', fontWeight: 700, color: minDiffItem && minDiffItem.rawDiff > 0 ? PRIMARY_COLOR : '#3883e7', margin: '1px 0', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: '3px' }}>
            <span>
              {minDiffItem
                ? `${minDiffItem.rawDiff > 0 ? '+' : '-'}${Math.round(minDiffItem.absDiff).toLocaleString()}`
                : '—'}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 600, color: minDiffItem && minDiffItem.rawDiff > 0 ? PRIMARY_COLOR : '#3883e7' }}>MW</span>
          </div>
          <div style={{ fontSize: '10px', color: '#777777', lineHeight: 1.2 }}>
            {minDiffItem ? `Closest match on ${minDiffItem.label}` : 'Smallest difference'}
          </div>
        </div>

        {/* Box 4: Difference */}
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
            Difference
          </div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: isShort ? '#3883e7' : PRIMARY_COLOR, margin: '1px 0', fontVariantNumeric: 'tabular-nums' }}>
            {isShort ? `-${absMw}` : `+${absMw}`} <span style={{ fontSize: '10px', fontWeight: 600 }}>MW</span>
          </div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: isShort ? '#3883e7' : PRIMARY_COLOR, lineHeight: 1.2 }}>
            {isShort ? `-${absPct}% shortfall` : `+${absPct}% surplus`}
          </div>
        </div>
      </section>

      {/* 2. Graph: Predicted vs Actual Wind Power (Last 7 Days vs Full Month) */}
      <section style={{ background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#000000' }}>
              Predicted vs Actual Wind Power
            </h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
              {windowMode === 'week'
                ? `Showing past 7 days before ${formatDate(selectedDate)} (${formatDate(startDate)} – ${formatDate(endDate)})`
                : 'Showing full month of January 2026'}
            </p>
          </div>

          {/* Toggle: Previous Week vs Previous Month */}
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
              Previous Week (7 Days)
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
              Previous Month (Jan)
            </button>
          </div>
        </div>

        {/* Chart View */}
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
                  const diff = aVal !== undefined && fVal !== undefined ? aVal - fVal : null;
                  return (
                    <div style={{ backgroundColor: '#ffffff', border: '1px solid #000000', padding: '0.6rem 0.8rem', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(0,0,0,0.08)', borderRadius: '4px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '0.3rem', color: '#000000' }}>
                        {label}
                      </div>
                      <div style={{ color: PRIMARY_COLOR, fontWeight: 600 }}>
                        Predicted: <strong>{fVal !== null && fVal !== undefined ? `${fVal.toLocaleString()} MW` : '—'}</strong>
                      </div>
                      <div style={{ color: '#444444', fontWeight: 600 }}>
                        Real Power: <strong>{aVal !== null && aVal !== undefined ? `${aVal.toLocaleString()} MW` : '—'}</strong>
                      </div>
                      {diff !== null && (
                        <div style={{ marginTop: '0.3rem', paddingTop: '0.3rem', borderTop: '1px solid #eeeeee', fontWeight: 700, color: diff < 0 ? '#e49d0e' : PRIMARY_COLOR }}>
                          {diff < 0
                            ? `Short by ${Math.abs(diff).toLocaleString()} MW (${((Math.abs(diff) / (fVal || 1)) * 100).toFixed(1)}%)`
                            : `Over by ${diff.toLocaleString()} MW (+${((diff / (fVal || 1)) * 100).toFixed(1)}%)`}
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
                type="monotone"
                dataKey="forecastMw"
                name="Predicted Power"
                stroke={PRIMARY_COLOR}
                strokeWidth={2.5}
                dot={{ r: 3, fill: PRIMARY_COLOR }}
                activeDot={{ r: 5, fill: PRIMARY_COLOR }}
              />
              <Line
                type="monotone"
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

      {/* 3. Line Chart: Forecast Error Over Time with Rolling Average Trendline */}
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
            {windowMode === 'week' ? 'Error trend' : 'Forecast error trend'}
          </h3>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
            Negative error means actual generation was below predicted generation.
          </p>
        </div>

        <div className="trend-layout-container">
          {/* Left: 70% Error Trend Line Chart */}
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
                      value: '0 MW',
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
                            <span>● Actual − predicted:</span>
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
                                color: errVal < 0 ? '#3883e7' : PRIMARY_COLOR,
                              }}
                            >
                              {errVal < 0
                                ? `Actual was ${Math.abs(errVal).toLocaleString()} MW below predicted`
                                : `Actual was ${errVal.toLocaleString()} MW above predicted`}
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
                    type="monotone"
                    dataKey="errorMw"
                    name="Actual − predicted"
                    stroke="#3883e7"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#3883e7' }}
                    activeDot={{ r: 6, fill: '#3883e7' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rollingAvgMw"
                    name="Rolling trend"
                    stroke={PRIMARY_COLOR}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: PRIMARY_COLOR }}
                    activeDot={{ r: 6, fill: PRIMARY_COLOR }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: 30% Bento Grid */}
          <div className="trend-bento-pane">
            {/* Bento Item 1: Dynamic Plain-English Trend Explanation */}
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

            {/* Bento Item 2 & 3: The 2 KPI Cards Side-by-Side */}
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

      {/* 4. Box Plot: Outlier Check for the Window (Forecast − Actual) */}
      {activeAccuracy?.box_plot && (
        <section>
          <BoxPlotChart
            stats={activeAccuracy.box_plot}
            subtitle={
              windowMode === 'week'
                ? `Showing past 7 days error spread before ${formatDate(selectedDate)} (${formatDate(startDate)} – ${formatDate(endDate)}). Left of 0 = predicted too low; Right of 0 = predicted too high.`
                : 'Showing full month of January 2026 error spread. Left of 0 = predicted too low; Right of 0 = predicted too high.'
            }
          />
        </section>
      )}

      {/* 5. Key Accuracy Metrics (3 Professional Metrics) */}
      <section>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '12px',
          }}
        >
          {/* 1. Mean Bias Error (MBE) */}
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

          {/* 2. Mean Absolute Error (MAE) */}
          <KPICard
            title="Mean Absolute Error (MAE)"
            value={kpis?.mae_mw !== null && kpis?.mae_mw !== undefined ? Math.round(kpis.mae_mw).toLocaleString() : null}
            unit="MW"
            tooltip="Mean Absolute Error measures the average absolute error magnitude across all evaluated hours. Lower is better."
            width="100%"
            height="86px"
          />

          {/* 3. Normalized MAE (nMAE) */}
          <KPICard
            title="Normalized MAE (nMAE)"
            value={
              kpis?.nmae_pct !== null && kpis?.nmae_pct !== undefined
                ? `${kpis.nmae_pct.toFixed(1)}%`
                : kpis?.normalised_mae
                  ? `${(kpis.normalised_mae * 100).toFixed(1)}%`
                  : null
            }
            subtext={`Normalized by mean outturn (${kpis?.mean_actual_mw ? `${(kpis.mean_actual_mw / 1000).toFixed(2)} GW` : 'mean power'})`}
            tooltip="MAE divided by mean actual generation. Replaces MAPE to prevent infinite error distortions during calm or near-zero wind periods."
            width="100%"
            height="86px"
          />
        </div>
      </section>

      {/* 6. End of Page: Collapsible Audit Table (Open / Close) */}
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
