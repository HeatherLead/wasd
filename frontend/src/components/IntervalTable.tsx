/**
 * frontend/src/components/IntervalTable.tsx
 * Redesigned Collapsible Audit Table with open/close toggle, search filtering, sorting, and CSV export.
 */

import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Download, Search, ChevronDown, ChevronUp, Table } from 'lucide-react';
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
        backgroundColor: '#ffffff',
        border: '1px solid #e0e0e0',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* 1. Collapsible Interactive Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 1.25rem',
          backgroundColor: isOpen ? '#fafafa' : '#ffffff',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background-color 0.15s ease',
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
            <Table size={16} color={PRIMARY_COLOR} />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#000000' }}>
              Audit Table — {formatDate(deliveryDate)}
            </div>
            <div style={{ fontSize: '12px', color: '#666666', marginTop: '2px' }}>
              {resolution === 'half_hourly' ? '48 half-hour settlement periods' : '24 hourly blocks'} in UTC
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: '#f1f3f5',
              color: '#495057',
              padding: '3px 8px',
              borderRadius: '4px',
            }}
          >
            {intervals.length} Intervals
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border: `1px solid ${isOpen ? PRIMARY_COLOR : '#000000'}`,
              backgroundColor: isOpen ? '#ffffff' : '#000000',
              color: isOpen ? PRIMARY_COLOR : '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {isOpen ? (
              <>
                Close Table <ChevronUp size={14} />
              </>
            ) : (
              <>
                Open Table <ChevronDown size={14} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Expanded Table Section */}
      {isOpen && (
        <div style={{ borderTop: '1px solid #eeeeee', padding: '1rem 1.25rem' }}>
          {/* Controls: Search & CSV Export */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '1rem',
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
                  padding: '6px 10px 6px 30px',
                  fontSize: '12.5px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px',
                  width: '200px',
                  outline: 'none',
                  backgroundColor: '#ffffff',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {searchTerm && (
                <span style={{ fontSize: '11px', color: '#666666' }}>
                  Showing {filteredAndSorted.length} of {intervals.length} intervals
                </span>
              )}
              <button
                type="button"
                onClick={handleExportCSV}
                title="Download CSV snapshot"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '4px',
                  border: '1px solid #ced4da',
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  cursor: 'pointer',
                }}
              >
                <Download size={13} />
                Export CSV
              </button>
            </div>
          </div>

          {/* Table with Sticky Header */}
          <div style={{ maxHeight: '480px', overflowY: 'auto', border: '1px solid #eeeeee', borderRadius: '6px' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8f9fa', zIndex: 2 }}>
                <tr>
                  <th className="sortable" onClick={() => handleSort('start_time')} style={{ textAlign: 'left', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      Time (UTC) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  {resolution === 'half_hourly' && (
                    <th className="sortable numeric-cell" onClick={() => handleSort('settlement_period')} style={{ textAlign: 'right', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        Period <ArrowUpDown size={11} />
                      </div>
                    </th>
                  )}
                  <th className="sortable numeric-cell" onClick={() => handleSort('forecast_generation_mw')} style={{ textAlign: 'right', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Predicted (MW) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th className="sortable numeric-cell" onClick={() => handleSort('actual_generation_mw')} style={{ textAlign: 'right', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Actual (MW) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th className="sortable numeric-cell" onClick={() => handleSort('error_mw')} style={{ textAlign: 'right', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Difference (MW) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th className="sortable numeric-cell" onClick={() => handleSort('pct_error')} style={{ textAlign: 'right', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      Diff (%) <ArrowUpDown size={11} />
                    </div>
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Publish Time (UTC)</th>
                  <th className="sortable numeric-cell" onClick={() => handleSort('horizon_hours')} style={{ textAlign: 'right', padding: '10px 12px' }}>
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
                        ? `${errorVal > 0 ? '+' : ''}${Math.round(errorVal).toLocaleString()}`
                        : '—';

                    return (
                      <tr key={row.start_time} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace', padding: '8px 12px' }}>{timeStr}</td>
                        {resolution === 'half_hourly' && (
                          <td className="numeric-cell" style={{ textAlign: 'right', padding: '8px 12px' }}>{row.settlement_period ?? '—'}</td>
                        )}
                        <td className="numeric-cell" style={{ textAlign: 'right', padding: '8px 12px' }}>
                          {row.forecast_generation_mw !== null ? Math.round(row.forecast_generation_mw).toLocaleString() : '—'}
                        </td>
                        <td className="numeric-cell" style={{ textAlign: 'right', padding: '8px 12px' }}>
                          {row.actual_generation_mw !== null ? Math.round(row.actual_generation_mw).toLocaleString() : '—'}
                        </td>
                        <td
                          className="numeric-cell"
                          style={{
                            textAlign: 'right',
                            padding: '8px 12px',
                            fontWeight: 700,
                            color: errorVal !== null && errorVal !== undefined && errorVal > 0 ? '#b45309' : PRIMARY_COLOR,
                          }}
                        >
                          {errorDisplay}
                        </td>
                        <td className="numeric-cell" style={{ textAlign: 'right', padding: '8px 12px' }}>
                          {row.pct_error !== null && row.pct_error !== undefined
                            ? `${row.pct_error > 0 ? '+' : ''}${row.pct_error.toFixed(1)}%`
                            : '—'}
                        </td>
                        <td style={{ fontSize: '11px', color: '#495057', padding: '8px 12px' }}>{pubTimeStr}</td>
                        <td className="numeric-cell" style={{ textAlign: 'right', padding: '8px 12px' }}>
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
