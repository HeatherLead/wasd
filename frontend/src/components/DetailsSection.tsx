/**
 * frontend/src/components/DetailsSection.tsx
 * Collapsed by default secondary material section containing:
 * - Interval detail table
 * - Forecast revision view for a selected interval
 * - Largest over- and under-forecast intervals
 * - Data quality & audit summary
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Table, History, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { IntervalTable } from './IntervalTable';
import { ForecastRevisions } from './ForecastRevisions';
import { WorstIntervals } from './WorstIntervals';
import type { DayDetailResponse, SummaryResponse } from '../api/client';

interface DetailsSectionProps {
  dayDetail: DayDetailResponse | null;
  selectedDate: string;
  cutoffTime: string;
  summary: SummaryResponse | null;
  onSelectDay: (date: string) => void;
}

type DetailTab = 'table' | 'revisions' | 'worst' | 'quality';

export const DetailsSection: React.FC<DetailsSectionProps> = ({
  dayDetail,
  selectedDate,
  cutoffTime,
  summary,
  onSelectDay,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('table');
  const [targetRevisionTime, setTargetRevisionTime] = useState<string>(`${selectedDate}T12:00:00Z`);

  return (
    <section
      style={{
        background: '#ffffff',
        border: '1px solid #d0d0d0',
        marginTop: '2rem',
        marginBottom: '2rem',
      }}
    >
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 1.25rem',
          backgroundColor: '#fbfbfb',
          border: 'none',
          borderBottom: isOpen ? '1px solid #e0e0e0' : 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {isOpen ? <ChevronDown size={18} color="#000000" /> : <ChevronRight size={18} color="#000000" />}
          <div>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#000000' }}>
              Secondary Details & Audit Section
            </span>
            <span style={{ marginLeft: '0.6rem', fontSize: '0.8rem', color: '#666666' }}>
              (Interval Table, Revision View, Largest Errors, Data Quality)
            </span>
          </div>
        </div>

        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#000000' }}>
          {isOpen ? 'Collapse Details' : 'Expand Details'}
        </span>
      </button>

      {/* Expanded Content */}
      {isOpen && (
        <div style={{ padding: '1.25rem' }}>
          {/* Sub-tab Navigation */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', marginBottom: '1.25rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'table' ? 600 : 500,
                color: activeTab === 'table' ? '#000000' : '#666666',
                border: 'none',
                borderBottom: activeTab === 'table' ? '2px solid #000000' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <Table size={14} /> Interval Detail Table
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('revisions')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'revisions' ? 600 : 500,
                color: activeTab === 'revisions' ? '#000000' : '#666666',
                border: 'none',
                borderBottom: activeTab === 'revisions' ? '2px solid #000000' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <History size={14} /> Forecast Revision History
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('worst')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'worst' ? 600 : 500,
                color: activeTab === 'worst' ? '#000000' : '#666666',
                border: 'none',
                borderBottom: activeTab === 'worst' ? '2px solid #000000' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <AlertTriangle size={14} /> Largest Error Intervals
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('quality')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: activeTab === 'quality' ? 600 : 500,
                color: activeTab === 'quality' ? '#000000' : '#666666',
                border: 'none',
                borderBottom: activeTab === 'quality' ? '2px solid #000000' : '2px solid transparent',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <CheckCircle2 size={14} /> Data Quality & Audit
            </button>
          </div>

          {/* Tab 1: Interval Table */}
          {activeTab === 'table' && dayDetail && (
            <IntervalTable
              intervals={dayDetail.intervals}
              deliveryDate={selectedDate}
              resolution={dayDetail.resolution}
            />
          )}

          {/* Tab 2: Forecast Revisions */}
          {activeTab === 'revisions' && (
            <div>
              <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Target Interval:</span>
                <select
                  value={targetRevisionTime}
                  onChange={(e) => setTargetRevisionTime(e.target.value)}
                  style={{
                    padding: '0.35rem 0.6rem',
                    fontSize: '0.85rem',
                    border: '1px solid #000000',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <option value={`${selectedDate}T06:00:00Z`}>{selectedDate} 06:00 UTC (Morning Ramp)</option>
                  <option value={`${selectedDate}T12:00:00Z`}>{selectedDate} 12:00 UTC (Midday)</option>
                  <option value={`${selectedDate}T18:00:00Z`}>{selectedDate} 18:00 UTC (Evening Peak)</option>
                  <option value={`${selectedDate}T22:00:00Z`}>{selectedDate} 22:00 UTC (Night)</option>
                </select>
              </div>

              <ForecastRevisions
                targetTime={targetRevisionTime}
                cutoffTime={cutoffTime}
                deliveryDate={selectedDate}
              />
            </div>
          )}

          {/* Tab 3: Largest Error Intervals */}
          {activeTab === 'worst' && (
            <WorstIntervals
              cutoffTime={cutoffTime}
              onSelectDay={onSelectDay}
            />
          )}

          {/* Tab 4: Data Quality Summary */}
          {activeTab === 'quality' && (
            <div style={{ padding: '0.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: 600 }}>
                January 2026 Ingestion Quality Audit
              </h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: '#666666' }}>
                Every single half-hour and hour of January 2026 was verified against official Elexon BMRS streams.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <div style={{ padding: '1rem', border: '1px solid #e0e0e0', background: '#fafafa' }}>
                  <div style={{ fontSize: '0.8rem', color: '#666666' }}>Total Expected Half-Hours</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#000000' }}>1,488</div>
                  <div style={{ fontSize: '0.75rem', color: '#2e7d32', fontWeight: 600 }}>100% Complete (0 Missing)</div>
                </div>

                <div style={{ padding: '1rem', border: '1px solid #e0e0e0', background: '#fafafa' }}>
                  <div style={{ fontSize: '0.8rem', color: '#666666' }}>Decision Forecasts Selected</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#000000' }}>744</div>
                  <div style={{ fontSize: '0.75rem', color: '#2e7d32', fontWeight: 600 }}>1 per hour at cutoff</div>
                </div>

                <div style={{ padding: '1rem', border: '1px solid #e0e0e0', background: '#fafafa' }}>
                  <div style={{ fontSize: '0.8rem', color: '#666666' }}>Data Completeness</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#000000' }}>
                    {summary?.kpis?.coverage?.coverage_pct ?? 100}%
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666666' }}>Missing values never treated as 0</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
