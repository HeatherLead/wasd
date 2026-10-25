/**
 * frontend/src/components/HeaderControls.tsx
 * Navigation header and global control bar for date, cutoff, and resolution.
 */

import React from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

interface HeaderControlsProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  cutoffTime: string;
  onSelectCutoff: (cutoff: string) => void;
  resolution: 'half_hourly' | 'hourly';
  onSelectResolution: (res: 'half_hourly' | 'hourly') => void;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export const HeaderControls: React.FC<HeaderControlsProps> = ({
  selectedDate,
  onSelectDate,
  cutoffTime,
  onSelectCutoff,
  resolution,
  onSelectResolution,
  isRefreshing,
  onRefresh,
}) => {
  // January 2026 delivery days (Jan 1 to Jan 31)
  const allDays = Array.from({ length: 31 }, (_, i) => {
    const dayNum = String(i + 1).padStart(2, '0');
    return `2026-01-${dayNum}`;
  });

  const currentIndex = allDays.indexOf(selectedDate);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allDays.length - 1;

  const handlePrev = () => {
    if (hasPrev) onSelectDate(allDays[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onSelectDate(allDays[currentIndex + 1]);
  };

  const cutoffPresets = [
    { label: '07:30 UTC (Early)', value: '07:30' },
    { label: '09:00 UTC (EPEX/N2EX Default)', value: '09:00' },
    { label: '09:30 UTC (N2EX)', value: '09:30' },
    { label: '12:00 UTC (EU SDAC)', value: '12:00' },
    { label: '15:00 UTC (Half-Hour)', value: '15:00' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div className="header-top">
        <div className="brand-section">
          <span className="status-indicator" title="Connected to local analytical engine" />
          <h1 className="brand-title">Wind Forecast Accuracy Portal</h1>
          <span className="brand-badge">GB Wholesale Day-Ahead Replay</span>
        </div>

        <div className="header-controls">
          {/* Cutoff Selector */}
          <div className="control-group">
            <label className="control-label" htmlFor="cutoff-select">
              D-1 Cutoff:
            </label>
            <select
              id="cutoff-select"
              className="control-select"
              value={cutoffTime}
              onChange={(e) => onSelectCutoff(e.target.value)}
            >
              {cutoffPresets.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              {!cutoffPresets.some((p) => p.value === cutoffTime) && (
                <option value={cutoffTime}>Custom ({cutoffTime} UTC)</option>
              )}
            </select>
          </div>

          <button
            type="button"
            className="day-btn"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Reload dataset"
          >
            <RefreshCw size={13} className={isRefreshing ? 'loading-skeleton' : ''} />
            {isRefreshing ? 'Recomputing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Date & Resolution Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
        <div className="day-nav-bar">
          <span className="control-label">Delivery Day:</span>

          <button
            type="button"
            className="day-btn"
            onClick={handlePrev}
            disabled={!hasPrev}
            aria-label="Previous delivery day"
          >
            <ChevronLeft size={14} />
          </button>

          <select
            className="control-select"
            value={selectedDate}
            onChange={(e) => onSelectDate(e.target.value)}
          >
            {allDays.map((d) => (
              <option key={d} value={d}>
                {d} (Day {parseInt(d.substring(8), 10)})
              </option>
            ))}
          </select>

          <button
            type="button"
            className="day-btn"
            onClick={handleNext}
            disabled={!hasNext}
            aria-label="Next delivery day"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="control-label">Resolution:</span>
          <div className="toggle-group">
            <button
              type="button"
              className={`toggle-btn ${resolution === 'half_hourly' ? 'active' : ''}`}
              onClick={() => onSelectResolution('half_hourly')}
            >
              Half-Hourly (48 SP)
            </button>
            <button
              type="button"
              className={`toggle-btn ${resolution === 'hourly' ? 'active' : ''}`}
              onClick={() => onSelectResolution('hourly')}
            >
              Hourly (24 Blocks)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
