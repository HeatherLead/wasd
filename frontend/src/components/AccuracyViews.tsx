/**
 * frontend/src/components/AccuracyViews.tsx
 * Multi-dimensional accuracy views:
 * - Daily error trend across January
 * - Diurnal profile (by hour of day)
 * - Lead time degradation (by horizon bucket)
 * - Output scale breakdown (by wind generation level)
 */

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { AccuracyResponse } from '../api/client';

interface AccuracyViewsProps {
  accuracyData: AccuracyResponse;
  onSelectDay?: (date: string) => void;
}

export const AccuracyViews: React.FC<AccuracyViewsProps> = ({
  accuracyData,
  onSelectDay,
}) => {
  const [subView, setSubView] = useState<'daily' | 'diurnal' | 'horizon' | 'wind_level'>('daily');

  const { by_day, by_hour_of_day, by_horizon_bucket, by_wind_level } = accuracyData;

  const CustomChartTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #000000',
            padding: '8px 12px',
            fontSize: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px', borderBottom: '1px solid #dee2e6' }}>
            {label}
          </div>
          {payload.map((entry: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color: entry.color || '#000000' }}>
              <span>{entry.name}:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {typeof entry.value === 'number' ? `${Math.round(entry.value).toLocaleString()} MW` : entry.value}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="section-card">
      <div className="section-card-header">
        <div>
          <h2 className="section-card-title">Comprehensive Forecast Accuracy Analysis</h2>
          <p className="section-card-subtitle">
            Evaluate errors across delivery days, diurnal cycles, forecast horizons, and production regimes.
          </p>
        </div>

        {/* View Switcher */}
        <div className="toggle-group">
          <button
            type="button"
            className={`toggle-btn ${subView === 'daily' ? 'active' : ''}`}
            onClick={() => setSubView('daily')}
          >
            By Day
          </button>
          <button
            type="button"
            className={`toggle-btn ${subView === 'diurnal' ? 'active' : ''}`}
            onClick={() => setSubView('diurnal')}
          >
            By Hour of Day
          </button>
          <button
            type="button"
            className={`toggle-btn ${subView === 'horizon' ? 'active' : ''}`}
            onClick={() => setSubView('horizon')}
          >
            By Horizon
          </button>
          <button
            type="button"
            className={`toggle-btn ${subView === 'wind_level' ? 'active' : ''}`}
            onClick={() => setSubView('wind_level')}
          >
            By Wind Output
          </button>
        </div>
      </div>

      {/* 1. Daily Error Trend */}
      {subView === 'daily' && (
        <div>
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#495057' }}>
            Click on any day bar to drill down into its interval-level profile.
          </div>
          <div className="chart-container" style={{ height: '360px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={by_day.map((d) => ({
                  day: d.delivery_date.substring(8),
                  fullDate: d.delivery_date,
                  MAE: d.mae_mw,
                  Bias: d.bias_mw,
                }))}
                margin={{ top: 10, right: 10, left: 15, bottom: 20 }}
                onClick={(e: any) => {
                  if (e && e.activePayload && e.activePayload.length && onSelectDay) {
                    onSelectDay(e.activePayload[0].payload.fullDate);
                  }
                }}
              >
                <CartesianGrid stroke="#e9ecef" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" stroke="#6c757d" fontSize={11} tickLine={false} label={{ value: 'January 2026 Day', position: 'bottom', offset: 0, fontSize: 11 }} />
                <YAxis stroke="#6c757d" fontSize={11} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} unit=" MW" />
                <Tooltip content={<CustomChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <ReferenceLine y={0} stroke="#000000" />
                <Bar dataKey="MAE" name="Mean Absolute Error (MAE)" fill="#000000" />
                <Bar dataKey="Bias" name="Mean Bias Error (MBE)" fill="#6c757d" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 2. Diurnal Cycle (Hour of Day) */}
      {subView === 'diurnal' && (
        <div>
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#495057' }}>
            Average error pattern across the 24 hours of the day (UTC / GMT). Highlights diurnal predictability.
          </div>
          <div className="chart-container" style={{ height: '360px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={by_hour_of_day.map((h) => ({
                  hour: h.label,
                  MAE: h.mae_mw,
                  Bias: h.bias_mw,
                  Actual: h.mean_actual_mw,
                }))}
                margin={{ top: 10, right: 10, left: 15, bottom: 20 }}
              >
                <CartesianGrid stroke="#e9ecef" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" stroke="#6c757d" fontSize={11} tickLine={false} label={{ value: 'Target Hour (UTC)', position: 'bottom', offset: 0, fontSize: 11 }} />
                <YAxis stroke="#6c757d" fontSize={11} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} unit=" MW" />
                <Tooltip content={<CustomChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                <ReferenceLine y={0} stroke="#000000" />
                <Line type="monotone" dataKey="MAE" name="MAE (MW)" stroke="#000000" strokeWidth={2.2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="Bias" name="Bias (MW)" stroke="#6c757d" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 3. By Horizon Bucket */}
      {subView === 'horizon' && (
        <div>
          <div style={{ marginBottom: '16px', fontSize: '12px', color: '#495057' }}>
            Error metrics grouped by lead time (hours elapsed between forecast publication and target delivery).
          </div>
          <div className="table-wrapper" style={{ marginBottom: '20px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Horizon Bucket</th>
                  <th className="numeric-cell">Sample Count</th>
                  <th className="numeric-cell">Mean Actual (MW)</th>
                  <th className="numeric-cell">Mean Forecast (MW)</th>
                  <th className="numeric-cell">MAE (MW)</th>
                  <th className="numeric-cell">Bias (MW)</th>
                  <th className="numeric-cell">RMSE (MW)</th>
                </tr>
              </thead>
              <tbody>
                {by_horizon_bucket.map((b) => (
                  <tr key={b.bucket}>
                    <td style={{ fontWeight: 600 }}>{b.bucket}</td>
                    <td className="numeric-cell">{b.sample_count}</td>
                    <td className="numeric-cell">{b.mean_actual_mw?.toLocaleString() ?? '—'}</td>
                    <td className="numeric-cell">{b.mean_forecast_mw?.toLocaleString() ?? '—'}</td>
                    <td className="numeric-cell" style={{ fontWeight: 700 }}>
                      {b.mae_mw?.toLocaleString() ?? '—'}
                    </td>
                    <td className="numeric-cell">
                      {b.bias_mw !== null && b.bias_mw !== undefined ? (b.bias_mw > 0 ? `+${b.bias_mw}` : b.bias_mw) : '—'}
                    </td>
                    <td className="numeric-cell">{b.rmse_mw?.toLocaleString() ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. By Wind Output Level */}
      {subView === 'wind_level' && (
        <div>
          <div style={{ marginBottom: '16px', fontSize: '12px', color: '#495057' }}>
            Error performance categorized by prevailing wind generation conditions. Normalized MAE reveals relative accuracy.
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Regime</th>
                  <th>Range Description</th>
                  <th className="numeric-cell">Sample Hours</th>
                  <th className="numeric-cell">Mean Actual (MW)</th>
                  <th className="numeric-cell">Mean Forecast (MW)</th>
                  <th className="numeric-cell">MAE (MW)</th>
                  <th className="numeric-cell">Bias (MW)</th>
                  <th className="numeric-cell">nMAE (%)</th>
                </tr>
              </thead>
              <tbody>
                {by_wind_level.map((w) => (
                  <tr key={w.level}>
                    <td style={{ fontWeight: 700 }}>{w.level}</td>
                    <td>{w.description}</td>
                    <td className="numeric-cell">{w.sample_count}</td>
                    <td className="numeric-cell">{w.mean_actual_mw?.toLocaleString() ?? '—'}</td>
                    <td className="numeric-cell">{w.mean_forecast_mw?.toLocaleString() ?? '—'}</td>
                    <td className="numeric-cell" style={{ fontWeight: 700 }}>
                      {w.mae_mw?.toLocaleString() ?? '—'}
                    </td>
                    <td className="numeric-cell">
                      {w.bias_mw !== null && w.bias_mw !== undefined ? (w.bias_mw > 0 ? `+${w.bias_mw}` : w.bias_mw) : '—'}
                    </td>
                    <td className="numeric-cell" style={{ fontWeight: 700 }}>
                      {w.nmae_pct !== null && w.nmae_pct !== undefined ? `${w.nmae_pct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
