/**
 * frontend/src/components/IntervalTable.tsx
 * Redesigned Collapsible Audit Table with open/close toggle, search filtering, sorting, and CSV export.
 */

import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Download, Search, ChevronDown, ChevronRight } from 'lucide-react';
import type { IntervalDetailItem } from '../api/client';
import { formatDate } from '../utils/date';
import { PRIMARY_COLOR } from '../theme';

interface IntervalTableProps {
  intervals: IntervalDetailItem[];
  deliveryDate: string;
  resolution: string;
  defaultOpen?: boolean;
}

type SortField = 'start_time' | 'settlement_period' | 'forecast_generation_mw' | 'actual_generation_mw' | 'error_mw' | 'pct_error' | 'horizon_hours';
type SortOrder = 'asc' | 'desc';

export const IntervalTable: React.FC<IntervalTableProps> = ({
  intervals,
  deliveryDate,
  resolution,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);
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
      const valA = a[sortField];
      const valB = b[sortField];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }
      return 0;
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
    <div
      style={{
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* 1. Header with Chevron Toggle & Export CSV matching Page 2 */}
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
          onClick={() => setIsOpen(!isOpen)}
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
            color: '#000000',
          }}
        >
          {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span>Audit Table — {formatDate(deliveryDate)}</span>
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

      {/* 2. Expanded Table Section */}
      {isOpen && (
        <div style={{ borderTop: '1px solid #e0e0e0' }}>
          {/* Controls: Filter search */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.65rem 1.25rem',
              backgroundColor: '#ffffff',
              borderBottom: '1px solid #eeeeee',
            }}
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', color: '#6c757d' }} />
              <input
                type="text"
                placeholder="Filter time or period..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  padding: '5px 10px 5px 30px',
                  fontSize: '12px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px',
                  width: '200px',
                  outline: 'none',
                  backgroundColor: '#ffffff',
                }}
              />
            </div>

            {searchTerm && (
              <span style={{ fontSize: '11px', color: '#666666' }}>
                Showing {filteredAndSorted.length} of {intervals.length} intervals
              </span>
            )}
          </div>

          {/* Table matching Page 2 style */}
          <div style={{ maxHeight: '480px', overflowY: 'auto', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f5f5f5', zIndex: 2 }}>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #d0d0d0' }}>
                  <th
                    className="sortable"
                    onClick={() => handleSort('start_time')}
                    style={{ padding: '0.6rem 0.75rem', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Time (UTC) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  {resolution === 'half_hourly' && (
                    <th
                      className="sortable"
                      onClick={() => handleSort('settlement_period')}
                      style={{ padding: '0.6rem 0.75rem', textAlign: 'right', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        SP <ArrowUpDown size={11} />
                      </div>
                    </th>
                  )}
                  <th
                    className="sortable"
                    onClick={() => handleSort('forecast_generation_mw')}
                    style={{ padding: '0.6rem 0.75rem', textAlign: 'right', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Forecast (MW) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort('actual_generation_mw')}
                    style={{ padding: '0.6rem 0.75rem', textAlign: 'right', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Actual (MW) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort('error_mw')}
                    style={{ padding: '0.6rem 0.75rem', textAlign: 'right', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Difference (MW) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort('pct_error')}
                    style={{ padding: '0.6rem 0.75rem', textAlign: 'right', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Diff (%) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Publish Time (UTC)</th>
                  <th
                    className="sortable"
                    onClick={() => handleSort('horizon_hours')}
                    style={{ padding: '0.6rem 0.75rem', textAlign: 'right', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Lead Time <ArrowUpDown size={11} />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '30px', color: '#6c757d' }}>
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
                        ? `${errorVal > 0 ? '+' : ''}${Math.round(errorVal).toLocaleString()} MW`
                        : '—';

                    return (
                      <tr key={row.start_time} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ fontWeight: 600, padding: '0.55rem 0.75rem' }}>{timeStr}</td>
                        {resolution === 'half_hourly' && (
                          <td style={{ textAlign: 'right', padding: '0.55rem 0.75rem' }}>
                            {row.settlement_period ?? '—'}
                          </td>
                        )}
                        <td style={{ textAlign: 'right', fontWeight: 600, padding: '0.55rem 0.75rem' }}>
                          {row.forecast_generation_mw !== null ? `${Math.round(row.forecast_generation_mw).toLocaleString()} MW` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', color: PRIMARY_COLOR, padding: '0.55rem 0.75rem' }}>
                          {row.actual_generation_mw !== null ? `${Math.round(row.actual_generation_mw).toLocaleString()} MW` : '—'}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            padding: '0.55rem 0.75rem',
                            fontWeight: 700,
                            color: errorVal !== null && errorVal !== undefined && errorVal > 0 ? '#b45309' : PRIMARY_COLOR,
                          }}
                        >
                          {errorDisplay}
                        </td>
                        <td style={{ textAlign: 'right', padding: '0.55rem 0.75rem' }}>
                          {row.pct_error !== null && row.pct_error !== undefined
                            ? `${row.pct_error > 0 ? '+' : ''}${row.pct_error.toFixed(1)}%`
                            : '—'}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: '#666', padding: '0.55rem 0.75rem' }}>{pubTimeStr}</td>
                        <td style={{ textAlign: 'right', color: '#666', padding: '0.55rem 0.75rem' }}>
                          {row.horizon_hours !== null ? `${row.horizon_hours.toFixed(1)}h` : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default IntervalTable;
