/**
 * frontend/src/components/WorstIntervals.tsx
 * Ranked list of largest-error intervals for commercial buying decisions.
 * Displays worst overforecasts (procurement shortfalls) and underforecasts (spill surpluses).
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { apiClient } from '../api/client';
import type { WorstIntervalsResponse } from '../api/client';

interface WorstIntervalsProps {
  cutoffTime: string;
  onSelectDay: (date: string) => void;
}

export const WorstIntervals: React.FC<WorstIntervalsProps> = ({
  cutoffTime,
  onSelectDay,
}) => {
  const [data, setData] = useState<WorstIntervalsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    const fetchWorst = async () => {
      setLoading(true);
      try {
        const res = await apiClient.getWorstIntervals(cutoffTime, undefined, undefined, 5);
        if (isMounted) setData(res);
      } catch {
        // Handled silently
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchWorst();
    return () => {
      isMounted = false;
    };
  }, [cutoffTime]);

  if (loading || !data) {
    return null;
  }

  return (
    <div className="section-card" style={{ marginTop: '20px' }}>
      <div className="section-card-header">
        <div>
          <h3 className="section-card-title">
            <AlertTriangle size={16} />
            Ranked Largest Forecast Error Intervals (January 2026)
          </h3>
          <p className="section-card-subtitle">
            Critical intervals with the largest commercial impact for the utility trading desk.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        {/* 1. Worst Overforecasts (Deficits) */}
        <div style={{ border: '1px solid var(--border-light)', borderRadius: '6px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Top 5 Overforecasts (Procurement Shortfalls)
            </span>
            <span style={{ fontSize: '11px', color: '#6c757d' }}>Forecast &gt;&gt; Actual</span>
          </div>
          <p style={{ fontSize: '11px', color: '#495057', marginBottom: '12px' }}>
            Wind produced less than expected. The buyer had an unhedged deficit and had to procure additional thermal/balancing energy.
          </p>

          <table className="data-table" style={{ fontSize: '11px' }}>
            <thead>
              <tr>
                <th>Delivery Time (UTC)</th>
                <th className="numeric-cell">Forecast</th>
                <th className="numeric-cell">Actual</th>
                <th className="numeric-cell">Shortfall</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.worst_overforecasts.map((row) => (
                <tr key={row.start_time}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {row.delivery_date} {row.start_time.substring(11, 16)}
                  </td>
                  <td className="numeric-cell">{Math.round(row.forecast_generation_mw).toLocaleString()} MW</td>
                  <td className="numeric-cell">{Math.round(row.actual_generation_mw).toLocaleString()} MW</td>
                  <td className="numeric-cell" style={{ fontWeight: 700 }}>
                    +{Math.round(row.error_mw).toLocaleString()} MW
                  </td>
                  <td>
                    <button
                      type="button"
                      className="day-btn"
                      style={{ padding: '2px 8px', fontSize: '10px' }}
                      onClick={() => onSelectDay(row.delivery_date)}
                      title={`Inspect ${row.delivery_date}`}
                    >
                      Inspect <ArrowRight size={10} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 2. Worst Underforecasts (Surpluses) */}
        <div style={{ border: '1px solid var(--border-light)', borderRadius: '6px', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Top 5 Underforecasts (Surplus Wind Events)
            </span>
            <span style={{ fontSize: '11px', color: '#6c757d' }}>Actual &gt;&gt; Forecast</span>
          </div>
          <p style={{ fontSize: '11px', color: '#495057', marginBottom: '12px' }}>
            Wind produced more than scheduled. Excess energy spilled onto the system, exposed to imbalance settlement discount prices.
          </p>

          <table className="data-table" style={{ fontSize: '11px' }}>
            <thead>
              <tr>
                <th>Delivery Time (UTC)</th>
                <th className="numeric-cell">Forecast</th>
                <th className="numeric-cell">Actual</th>
                <th className="numeric-cell">Surplus</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.worst_underforecasts.map((row) => (
                <tr key={row.start_time}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {row.delivery_date} {row.start_time.substring(11, 16)}
                  </td>
                  <td className="numeric-cell">{Math.round(row.forecast_generation_mw).toLocaleString()} MW</td>
                  <td className="numeric-cell">{Math.round(row.actual_generation_mw).toLocaleString()} MW</td>
                  <td className="numeric-cell" style={{ fontWeight: 700 }}>
                    {Math.round(row.error_mw).toLocaleString()} MW
                  </td>
                  <td>
                    <button
                      type="button"
                      className="day-btn"
                      style={{ padding: '2px 8px', fontSize: '10px' }}
                      onClick={() => onSelectDay(row.delivery_date)}
                      title={`Inspect ${row.delivery_date}`}
                    >
                      Inspect <ArrowRight size={10} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
