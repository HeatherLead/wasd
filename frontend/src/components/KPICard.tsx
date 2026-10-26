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
  width?: string | number;
  height?: string | number;
  style?: React.CSSProperties;
}

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  unit,
  subtext,
  tooltip,
  highlight = false,
  width = '150px',
  height = '80px',
  style,
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
      style={{
        width,
        height,
        boxSizing: 'border-box',
        padding: '7px 10px',
        backgroundColor: '#ffffff',
        border: `1px solid ${highlight ? PRIMARY_COLOR : '#e0e0e0'}`,
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        boxShadow: highlight ? '0 1px 3px rgba(20, 137, 55, 0.12)' : 'none',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            color: '#666666',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={title}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={() => setShowTooltip(!showTooltip)}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            color: '#888888',
          }}
          aria-label={title}
        >
          <Info size={11} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px', marginTop: '1px' }}>
        <span
          style={{
            fontSize: '17px',
            fontWeight: 700,
            color: highlight ? PRIMARY_COLOR : '#000000',
            letterSpacing: '-0.02em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formattedValue}
        </span>
        {unit && (
          <span style={{ fontSize: '10px', fontWeight: 600, color: '#666666' }}>
            {unit}
          </span>
        )}
      </div>

      {subtext && (
        <div
          style={{
            fontSize: '9.5px',
            color: '#777777',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.1,
          }}
          title={subtext}
        >
          {subtext}
        </div>
      )}

      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            width: '210px',
            backgroundColor: '#000000',
            color: '#ffffff',
            padding: '6px 8px',
            fontSize: '11px',
            borderRadius: '4px',
            zIndex: 100,
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
            pointerEvents: 'none',
            lineHeight: 1.3,
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
};
