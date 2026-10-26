/**
 * frontend/src/components/ForecastRevisions.tsx
 * Forecast Revision Trajectory Component.
 * Shows how the forecast for a selected delivery interval evolved across successive publish runs,
 * highlighting the exact forecast locked at the D-1 decision cutoff.
 */

import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { apiClient } from '../api/client';
import type { ForecastRevisionsResponse } from '../api/client';
import { History } from 'lucide-react';
import { PRIMARY_COLOR } from '../theme';
import { formatDate } from '../utils/date';

interface ForecastRevisionsProps {
  targetTime: string;
  cutoffTime: string;
  deliveryDate?: string;
}

export const ForecastRevisions: React.FC<ForecastRevisionsProps> = ({
  targetTime,
  cutoffTime,
}) => {
  const [data, setData] = useState<ForecastRevisionsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchRevisions = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.getRevisions(targetTime, cutoffTime);
        if (isMounted) setData(res);
      } catch (err: any) {
        if (isMounted) setError(err?.message || 'Failed to load forecast revisions.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    if (targetTime) {
      fetchRevisions();
    }
    return () => {
      isMounted = false;
    };
  }, [targetTime, cutoffTime]);

  if (loading) {
    return (
      <div className="section-card" style={{ padding: '24px' }}>
        <div className="loading-skeleton" style={{ width: '40%', height: '24px', marginBottom: '16px' }} />
        <div className="loading-skeleton" style={{ width: '100%', height: '200px' }} />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const chartData = data.revisions.map((rev) => {
    const pubDt = new Date(rev.publish_time);
    const pubLabel = `${pubDt.getUTCMonth() + 1}/${pubDt.getUTCDate()} ${String(pubDt.getUTCHours()).padStart(2, '0')}:${String(pubDt.getUTCMinutes()).padStart(2, '0')}`;
    return {
      label: pubLabel,
      publishTime: rev.publish_time,
      forecast: rev.forecast_generation_mw,
      actual: data.actual_generation_mw,
      isDecision: rev.is_decision_forecast,
      isEligible: rev.is_eligible,
      horizon: rev.horizon_hours,
      errorVsActual: rev.error_vs_actual_mw,
    };
  });

  const decisionRev = data.revisions.find((r) => r.is_decision_forecast);
  const targetLabel = `${formatDate(targetTime.substring(0, 10))} ${targetTime.substring(11, 16)} UTC`;

  return (
    <div className="section-card" style={{ marginTop: '20px' }}>
      <div className="section-card-header">
        <div>
          <h3 className="section-card-title">
            <History size={16} />
            Forecast Revision Trajectory for Target: {targetLabel}
          </h3>
          <p className="section-card-subtitle">
            Historical evolution of published wind forecasts over time versus final physical outturn ({data.actual_generation_mw?.toLocaleString() ?? '—'} MW).
          </p>
        </div>

        {decisionRev && (
          <div
            style={{
              padding: '6px 12px',
              border: `1px solid ${PRIMARY_COLOR}`,
              borderRadius: '4px',
              backgroundColor: '#f8f9fa',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            Decision Forecast: <strong>{decisionRev.forecast_generation_mw.toLocaleString()} MW</strong> (Published {decisionRev.publish_time.substring(11, 16)} UTC, {decisionRev.horizon_hours}h lead)
          </div>
        )}
      </div>

      {/* Trajectory Evolution Chart */}
      <div className="chart-container" style={{ height: '260px', marginBottom: '20px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 15, bottom: 20 }}>
            <CartesianGrid stroke="#e9ecef" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#6c757d"
              fontSize={10}
              tickLine={false}
              label={{ value: 'Forecast Publish Time (UTC)', position: 'bottom', offset: 0, fontSize: 11 }}
            />
            <YAxis
              stroke="#6c757d"
              fontSize={11}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              unit=" MW"
            />
            <Tooltip
              content={({ active, payload }: any) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  return (
                    <div style={{ backgroundColor: '#ffffff', border: '1px solid #000000', padding: '8px 12px', fontSize: '11px' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px' }}>Published: {formatDate(d.publishTime)} {d.publishTime.substring(11, 16)} UTC</div>
                      <div>Forecast: <strong>{Math.round(d.forecast).toLocaleString()} MW</strong></div>
                      <div>Actual Outturn: <strong>{Math.round(d.actual).toLocaleString()} MW</strong></div>
                      <div>Lead Time: {d.horizon} hours ahead</div>
                      {d.isDecision && (
                        <div style={{ marginTop: '4px', fontWeight: 700, color: PRIMARY_COLOR }}>
                          ★ LOCKED DECISION FORECAST (D-1 Cutoff)
                        </div>
                      )}
                      {!d.isEligible && (
                        <div style={{ marginTop: '4px', color: '#6c757d' }}>
                          (Post-cutoff update — look-ahead if used)
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
            {data.actual_generation_mw !== null && (
              <ReferenceLine
                y={data.actual_generation_mw}
                stroke="#000000"
                strokeWidth={2}
                strokeDasharray="4 4"
                label={{ value: `Actual: ${Math.round(data.actual_generation_mw).toLocaleString()} MW`, fill: '#000000', fontSize: 11, position: 'insideTopRight' }}
              />
            )}
            <Line
              type="monotone"
              dataKey="forecast"
              name="Published Forecasts"
              stroke="#000000"
              strokeWidth={1.8}
              dot={(props: any) => {
                const isDec = props.payload.isDecision;
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={isDec ? 6 : 3}
                    fill={isDec ? PRIMARY_COLOR : '#ffffff'}
                    stroke={isDec ? PRIMARY_COLOR : '#000000'}
                    strokeWidth={isDec ? 2 : 1.5}
                  />
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Revision Runs Table */}
      <div className="table-wrapper">
        <table className="data-table" style={{ fontSize: '11px' }}>
          <thead>
            <tr>
              <th>Publication Time (UTC)</th>
              <th className="numeric-cell">Lead Time</th>
              <th className="numeric-cell">Forecast (MW)</th>
              <th className="numeric-cell">Error vs Final Actual</th>
              <th>Status at D-1 Cutoff ({cutoffTime} UTC)</th>
            </tr>
          </thead>
          <tbody>
            {data.revisions.map((rev) => (
              <tr
                key={rev.publish_time}
                style={{
                  backgroundColor: rev.is_decision_forecast ? '#f1f3f5' : 'transparent',
                  fontWeight: rev.is_decision_forecast ? 700 : 400,
                }}
              >
                <td>{formatDate(rev.publish_time)} {rev.publish_time.substring(11, 16)} UTC</td>
                <td className="numeric-cell">{rev.horizon_hours.toFixed(1)}h ahead</td>
                <td className="numeric-cell">{Math.round(rev.forecast_generation_mw).toLocaleString()} MW</td>
                <td className="numeric-cell">
                  {rev.error_vs_actual_mw !== null
                    ? `${rev.error_vs_actual_mw > 0 ? '+' : ''}${Math.round(rev.error_vs_actual_mw).toLocaleString()} MW`
                    : '—'}
                </td>
                <td>
                  {rev.is_decision_forecast ? (
                    <span className="badge-ok" style={{ backgroundColor: PRIMARY_COLOR, color: '#ffffff', borderColor: PRIMARY_COLOR }}>
                      ★ DECISION-TIME BASELINE
                    </span>
                  ) : rev.is_eligible ? (
                    <span className="badge-ok">Prior Eligible</span>
                  ) : (
                    <span style={{ fontSize: '10px', color: '#6c757d' }}>Post-Cutoff (Look-Ahead)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
