/**
 * frontend/src/components/ForecastChart.tsx
 * High-contrast time series chart comparing decision-time forecast vs actual wind generation.
 */

import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts';
import type { IntervalDetailItem } from '../api/client';
import { PRIMARY_COLOR } from '../theme';
import { formatDate } from '../utils/date';

interface ForecastChartProps {
  intervals: IntervalDetailItem[];
  deliveryDate: string;
  cutoffTime: string;
}

export const ForecastChart: React.FC<ForecastChartProps> = ({
  intervals,
  deliveryDate,
  cutoffTime,
}) => {
  if (!intervals || intervals.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#6c757d' }}>
        No interval data available for {formatDate(deliveryDate)}.
      </div>
    );
  }

  // Format data for Recharts
  const chartData = intervals.map((item) => {
    const dt = new Date(item.start_time);
    const timeLabel = dt.toISOString().substring(11, 16); // "HH:MM"
    return {
      time: timeLabel,
      fullTime: item.start_time,
      period: item.settlement_period,
      forecast: item.forecast_generation_mw,
      actual: item.actual_generation_mw,
      error: item.error_mw,
      publishTime: item.forecast_publish_time,
      horizon: item.horizon_hours,
      isMissing: item.is_missing,
    };
  });

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const errorSign = data.error !== null && data.error > 0 ? '+' : '';
      return (
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #000000',
            padding: '10px 14px',
            fontSize: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '6px', borderBottom: '1px solid #dee2e6', paddingBottom: '4px' }}>
            {formatDate(deliveryDate)} {label} UTC (Period {data.period ?? '—'})
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '3px' }}>
            <span style={{ color: PRIMARY_COLOR, fontWeight: 600 }}>Forecast (D-1):</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {data.forecast !== null ? `${Math.round(data.forecast).toLocaleString()} MW` : 'MISSING'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginBottom: '3px' }}>
            <span style={{ color: '#495057', fontWeight: 600 }}>Actual Outturn:</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {data.actual !== null ? `${Math.round(data.actual).toLocaleString()} MW` : 'MISSING'}
            </span>
          </div>
          {data.error !== null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', marginTop: '4px', borderTop: '1px solid #dee2e6', paddingTop: '4px' }}>
              <span style={{ fontWeight: 600 }}>Error (F - A):</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                {`${errorSign}${Math.round(data.error).toLocaleString()} MW`}
              </span>
            </div>
          )}
          {data.publishTime && (
            <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '6px' }}>
              Selected from publish run: {data.publishTime.substring(11, 16)} UTC (lead time: {data.horizon}h)
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Generation Profiles Chart */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Power Generation Profile (MW)
          </span>
          <span style={{ fontSize: '12px', color: '#6c757d' }}>
            Decision cutoff: {cutoffTime} UTC on D-1
          </span>
        </div>
        <div className="chart-container" style={{ height: '340px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
              <CartesianGrid stroke="#e9ecef" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="#6c757d"
                fontSize={11}
                tickLine={false}
                interval={intervals.length > 24 ? 3 : 1}
              />
              <YAxis
                stroke="#6c757d"
                fontSize={11}
                tickLine={false}
                tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                unit=" MW"
                domain={['auto', 'auto']}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                iconType="plainline"
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name="Decision-Time Forecast (D-1)"
                stroke={PRIMARY_COLOR}
                strokeWidth={2.4}
                dot={{ r: 2, fill: PRIMARY_COLOR }}
                activeDot={{ r: 5, fill: PRIMARY_COLOR }}
              />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual Outturn (FUELHH)"
                stroke="#495057"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 2, fill: '#495057' }}
                activeDot={{ r: 5, fill: '#495057' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. Directional Error Sub-chart */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Directional Error = Forecast − Actual (MW)
          </span>
          <span style={{ fontSize: '11px', color: '#6c757d' }}>
            Above 0: Overforecast (Deficit) | Below 0: Underforecast (Surplus)
          </span>
        </div>
        <div style={{ width: '100%', height: '140px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 15, bottom: 0 }}>
              <CartesianGrid stroke="#e9ecef" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="time" stroke="#6c757d" fontSize={10} tickLine={false} interval={intervals.length > 24 ? 3 : 1} />
              <YAxis
                stroke="#6c757d"
                fontSize={10}
                tickLine={false}
                tickFormatter={(val) => `${(val / 1000).toFixed(1)}k`}
                unit=" MW"
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#000000" strokeWidth={1} />
              <Bar dataKey="error" name="Error (MW)" fill={PRIMARY_COLOR} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
