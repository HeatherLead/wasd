/**
 * frontend/src/components/IntervalTable.tsx
 * Interactive interval inspection table with sorting, search filtering, and explicit missing-data markers.
 */

import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Download, Search } from 'lucide-react';
import type { IntervalDetailItem } from '../api/client';
import { formatDate } from '../utils/date';

interface IntervalTableProps {
  intervals: IntervalDetailItem[];
  deliveryDate: string;
  resolution: string;
}

type SortField = 'start_time' | 'settlement_period' | 'forecast_generation_mw' | 'actual_generation_mw' | 'error_mw' | 'pct_error' | 'horizon_hours';
type SortOrder = 'asc' | 'desc';

export const IntervalTable: React.FC<IntervalTableProps> = ({
  intervals,
  deliveryDate,
  resolution,
}) => {
  const [sortField, setSortField] = useState<SortField>('start_time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [searchTerm, setSearchTerm] = useState('');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const filteredAndSorted = useMemo(() => {
    let list = intervals.slice();

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter((item) => {
        const timeStr = item.start_time.toLowerCase();
        const periodStr = item.settlement_period ? String(item.settlement_period) : '';
        return timeStr.includes(term) || periodStr.includes(term);
      });
    }

    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [intervals, sortField, sortOrder, searchTerm]);

  const handleExportCSV = () => {
    const headers = [
      'delivery_date',
      'start_time_utc',
      'settlement_period',
      'forecast_mw',
      'actual_mw',
      'error_mw',
      'pct_error',
      'publish_time_utc',
      'horizon_hours',
      'status',
    ];

    const rows = intervals.map((item) => [
      deliveryDate,
      item.start_time,
      item.settlement_period ?? '',
      item.forecast_generation_mw ?? '',
      item.actual_generation_mw ?? '',
      item.error_mw ?? '',
      item.pct_error ?? '',
      item.forecast_publish_time ?? '',
      item.horizon_hours ?? '',
      item.is_missing ? 'MISSING' : 'OK',
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `wind_forecast_accuracy_${deliveryDate}_${resolution}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="section-card">
      <div className="section-card-header">
        <div>
          <h2 className="section-card-title">
            Interval Settlement Audit Table ({formatDate(deliveryDate)})
          </h2>
          <p className="section-card-subtitle">
            Showing {resolution === 'half_hourly' ? '48 half-hour settlement periods' : '24 hourly blocks'}. All times in UTC (GMT).
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', color: '#6c757d' }} />
            <input
              type="text"
              placeholder="Filter time or period..."
              className="control-input"
              style={{ paddingLeft: '30px', width: '180px' }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="day-btn"
            onClick={handleExportCSV}
            title="Download CSV snapshot"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort('start_time')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  Target Start (UTC) <ArrowUpDown size={12} />
                </div>
              </th>
              {resolution === 'half_hourly' && (
                <th className="sortable numeric-cell" onClick={() => handleSort('settlement_period')}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                    Period <ArrowUpDown size={12} />
                  </div>
                </th>
              )}
              <th className="sortable numeric-cell" onClick={() => handleSort('forecast_generation_mw')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                  Forecast (MW) <ArrowUpDown size={12} />
                </div>
              </th>
              <th className="sortable numeric-cell" onClick={() => handleSort('actual_generation_mw')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                  Actual Outturn (MW) <ArrowUpDown size={12} />
                </div>
              </th>
              <th className="sortable numeric-cell" onClick={() => handleSort('error_mw')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                  Error (MW) <ArrowUpDown size={12} />
                </div>
              </th>
              <th className="sortable numeric-cell" onClick={() => handleSort('pct_error')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                  Error (%) <ArrowUpDown size={12} />
                </div>
              </th>
              <th>Decision Publish Time (UTC)</th>
              <th className="sortable numeric-cell" onClick={() => handleSort('horizon_hours')}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                  Lead Time <ArrowUpDown size={12} />
                </div>
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: '#6c757d' }}>
                  No matching intervals found.
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((row) => {
                const timeStr = row.start_time.substring(11, 16);
                const pubTimeStr = row.forecast_publish_time
                  ? `${formatDate(row.forecast_publish_time.substring(0, 10))} ${row.forecast_publish_time.substring(11, 16)}`
                  : '—';

                const errorVal = row.error_mw;
                const errorDisplay =
                  errorVal !== null && errorVal !== undefined
                    ? `${errorVal > 0 ? '+' : ''}${Math.round(errorVal).toLocaleString()}`
                    : '—';

                return (
                  <tr key={row.start_time}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{timeStr}</td>
                    {resolution === 'half_hourly' && (
                      <td className="numeric-cell">{row.settlement_period ?? '—'}</td>
                    )}
                    <td className="numeric-cell">
                      {row.forecast_generation_mw !== null ? Math.round(row.forecast_generation_mw).toLocaleString() : '—'}
                    </td>
                    <td className="numeric-cell">
                      {row.actual_generation_mw !== null ? Math.round(row.actual_generation_mw).toLocaleString() : '—'}
                    </td>
                    <td
                      className="numeric-cell"
                      style={{
                        fontWeight: 700,
                      }}
                    >
                      {errorDisplay}
                    </td>
                    <td className="numeric-cell">
                      {row.pct_error !== null && row.pct_error !== undefined
                        ? `${row.pct_error > 0 ? '+' : ''}${row.pct_error.toFixed(1)}%`
                        : '—'}
                    </td>
                    <td style={{ fontSize: '11px', color: '#495057' }}>{pubTimeStr}</td>
                    <td className="numeric-cell">{row.horizon_hours !== null ? `${row.horizon_hours.toFixed(1)}h` : '—'}</td>
                    <td>
                      {row.is_missing ? (
                        <span className="badge-missing">MISSING</span>
                      ) : (
                        <span className="badge-ok">VERIFIED</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
