/**
 * frontend/src/components/KPICard.tsx
 * Card component for displaying primary metrics with plain-English tooltips.
 */

import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { PRIMARY_COLOR } from '../theme';

interface KPICardProps {
  title: string;
  value: string | number | null;
  unit?: string;
  subtext?: string;
  tooltip: string;
  highlight?: boolean;
}

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  unit,
  subtext,
  tooltip,
  highlight = false,
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const formattedValue =
    value === null || value === undefined
      ? '—'
      : typeof value === 'number'
      ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
      : value;

  return (
    <div
      className="kpi-card"
      style={{
        borderWidth: highlight ? '2px' : '1px',
        borderColor: highlight ? PRIMARY_COLOR : 'var(--border-light)',
      }}
    >
      <div className="kpi-header">
        <span className="kpi-title">{title}</span>
        <button
          type="button"
          className="kpi-tooltip-btn"
          aria-label={`About ${title}`}
          onClick={() => setShowTooltip(!showTooltip)}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <Info size={14} />
        </button>
      </div>

      <div className="kpi-value-row">
        <span className="kpi-value">{formattedValue}</span>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>

      {subtext && <div className="kpi-subtext">{subtext}</div>}

      {showTooltip && (
        <div className="tooltip-box" role="tooltip">
          {tooltip}
        </div>
      )}
    </div>
  );
};
