/**
 * frontend/src/components/BoxPlotChart.tsx
 * Precision SVG Box-and-Whisker Plot for signed forecast error (Forecast - Actual, MW).
 * Displays Min, Whisker Low, Q1, Median, Q3, Whisker High, and Outlier points.
 * Monochromatic high-contrast styling (white background, black strokes, zero gradients).
 */

import React, { useState } from 'react';
import type { BoxPlotStats } from '../api/client';
import { PRIMARY_COLOR } from '../theme';

interface BoxPlotChartProps {
  stats: BoxPlotStats;
  p50AbsMw?: number | null;
  p90AbsMw?: number | null;
  p95AbsMw?: number | null;
  subtitle?: string;
}

export const BoxPlotChart: React.FC<BoxPlotChartProps> = ({
  stats,
  subtitle,
}) => {
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);

  if (!stats || stats.sample_count === 0 || stats.median_mw === null) {
    return (
      <div className="empty-box-plot" style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>
        No error distribution data available for the selected range.
      </div>
    );
  }

  // Determine global domain from extremes or whiskers
  const minVal = stats.min_mw ?? stats.whisker_low_mw ?? -5000;
  const maxVal = stats.max_mw ?? stats.whisker_high_mw ?? 5000;
  const domainMin = Math.min(minVal, -500);
  const domainMax = Math.max(maxVal, 500);
  const domainRange = domainMax - domainMin || 1;

  // SVG dimensions
  const svgWidth = 720;
  const svgHeight = 140;
  const margin = { left: 40, right: 40, top: 30, bottom: 40 };
  const plotWidth = svgWidth - margin.left - margin.right;
  const plotCenterY = 55;
  const boxHeight = 44;

  const scaleX = (val: number) => {
    const clamped = Math.max(domainMin, Math.min(domainMax, val));
    return margin.left + ((clamped - domainMin) / domainRange) * plotWidth;
  };

  const zeroX = scaleX(0);
  const q1X = scaleX(stats.q1_mw ?? 0);
  const medX = scaleX(stats.median_mw ?? 0);
  const q3X = scaleX(stats.q3_mw ?? 0);
  const whiskerLowX = scaleX(stats.whisker_low_mw ?? stats.q1_mw ?? 0);
  const whiskerHighX = scaleX(stats.whisker_high_mw ?? stats.q3_mw ?? 0);

  return (
    <div className="boxplot-container" style={{ background: '#ffffff', border: '1px solid #e0e0e0', padding: '1.25rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: '2.5rem',
          marginBottom: '0.75rem',
          gap: '1rem',
        }}
      >
        <div>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#000000' }}>
            Outlier Check: Difference (Forecast − Actual)
          </h4>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
            {subtitle || 'Finds extreme hours that skewed the average. '}
          </p>
        </div>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: PRIMARY_COLOR,
            background: hoveredValue ? '#f5f5f5' : 'transparent',
            padding: '0.2rem 0.6rem',
            border: `1px solid ${hoveredValue ? PRIMARY_COLOR : 'transparent'}`,
            borderRadius: '4px',
            visibility: hoveredValue ? 'visible' : 'hidden',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {hoveredValue || '—'}
        </div>
      </div>

      <div style={{ width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: '100%', minWidth: '550px', height: 'auto', display: 'block' }}
        >
          {/* Background grid / Zero axis */}
          <line
            x1={margin.left}
            y1={plotCenterY}
            x2={svgWidth - margin.right}
            y2={plotCenterY}
            stroke="#e0e0e0"
            strokeWidth="1"
          />

          {/* Zero Error Reference Line */}
          <line
            x1={zeroX}
            y1={15}
            x2={zeroX}
            y2={svgHeight - 25}
            stroke="#000000"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <text
            x={zeroX}
            y={12}
            textAnchor="middle"
            fontSize="10"
            fontWeight="bold"
            fill="#000000"
          >
            0 MW (Exact)
          </text>

          {/* Whisker Line (Low to High) */}
          <line
            x1={whiskerLowX}
            y1={plotCenterY}
            x2={q1X}
            y2={plotCenterY}
            stroke="#000000"
            strokeWidth="1.5"
          />
          <line
            x1={q3X}
            y1={plotCenterY}
            x2={whiskerHighX}
            y2={plotCenterY}
            stroke="#000000"
            strokeWidth="1.5"
          />

          {/* Whisker End Caps */}
          <line
            x1={whiskerLowX}
            y1={plotCenterY - 14}
            x2={whiskerLowX}
            y2={plotCenterY + 14}
            stroke="#000000"
            strokeWidth="2"
          />
          <line
            x1={whiskerHighX}
            y1={plotCenterY - 14}
            x2={whiskerHighX}
            y2={plotCenterY + 14}
            stroke="#000000"
            strokeWidth="2"
          />

          {/* Interquartile Range (IQR) Box: Q1 to Q3 */}
          <rect
            x={q1X}
            y={plotCenterY - boxHeight / 2}
            width={Math.max(2, q3X - q1X)}
            height={boxHeight}
            fill="#f9f9f9"
            stroke="#000000"
            strokeWidth="2"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredValue(`Middle 50%: ${stats.q1_mw?.toLocaleString()} MW to ${stats.q3_mw?.toLocaleString()} MW`)}
            onMouseLeave={() => setHoveredValue(null)}
          />

          {/* Median Line */}
          <line
            x1={medX}
            y1={plotCenterY - boxHeight / 2}
            x2={medX}
            y2={plotCenterY + boxHeight / 2}
            stroke={PRIMARY_COLOR}
            strokeWidth="4"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredValue(`Median (Typical) Difference: ${stats.median_mw?.toLocaleString()} MW`)}
            onMouseLeave={() => setHoveredValue(null)}
          />

          {/* Outlier Dots */}
          {stats.outliers && stats.outliers.map((outlierVal, idx) => {
            const ox = scaleX(outlierVal);
            return (
              <circle
                key={idx}
                cx={ox}
                cy={plotCenterY}
                r="3.5"
                fill="#ffffff"
                stroke="#000000"
                strokeWidth="1.5"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredValue(`Outlier: ${outlierVal.toLocaleString()} MW (Extreme Miss)`)}
                onMouseLeave={() => setHoveredValue(null)}
              />
            );
          })}

          {/* Key Value Labels along the bottom */}
          <text x={whiskerLowX} y={plotCenterY + 34} textAnchor="middle" fontSize="10" fill="#333333">
            {stats.whisker_low_mw?.toLocaleString()}
          </text>
          <text x={whiskerLowX} y={plotCenterY + 45} textAnchor="middle" fontSize="9" fill="#777777">
            Normal Min
          </text>

          <text x={q1X} y={plotCenterY - 26} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#000000">
            25%: {stats.q1_mw?.toLocaleString()}
          </text>

          <text x={medX} y={plotCenterY + 34} textAnchor="middle" fontSize="11" fontWeight="bold" fill={PRIMARY_COLOR}>
            Median: {stats.median_mw?.toLocaleString()} MW
          </text>

          <text x={q3X} y={plotCenterY - 26} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#000000">
            75%: {stats.q3_mw?.toLocaleString()}
          </text>

          <text x={whiskerHighX} y={plotCenterY + 34} textAnchor="middle" fontSize="10" fill="#333333">
            {stats.whisker_high_mw?.toLocaleString()}
          </text>
          <text x={whiskerHighX} y={plotCenterY + 45} textAnchor="middle" fontSize="9" fill="#777777">
            Normal Max
          </text>
        </svg>
      </div>

      {/* Simplified Readout Bar */}
      <div style={{ marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: '1px solid #eeeeee', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: '0.85rem' }}>
          <span style={{ color: '#666666', marginRight: '0.4rem' }}>Median:</span>
          <strong style={{ color: PRIMARY_COLOR }}>{stats.median_mw !== null && stats.median_mw !== undefined ? `${stats.median_mw.toLocaleString()} MW` : '—'}</strong>
        </div>
        <div style={{ fontSize: '0.85rem' }}>
          <span style={{ color: '#666666', marginRight: '0.4rem' }}>Middle Range:</span>
          <strong style={{ color: '#000000' }}>
            {stats.q1_mw !== null && stats.q3_mw !== null ? `${stats.q1_mw.toLocaleString()} to ${stats.q3_mw.toLocaleString()} MW` : '—'}
          </strong>
        </div>
        <div style={{ fontSize: '0.85rem', marginLeft: 'auto' }}>
          <span style={{ color: '#666666', marginRight: '0.4rem' }}>Outliers:</span>
          <strong style={{ color: (stats.outliers?.length ?? 0) > 0 ? '#b45309' : '#000000' }}>
            {stats.outliers?.length ?? 0} extreme points
          </strong>
          {(stats.outliers?.length ?? 0) > 0 && (
            <span style={{ marginLeft: '0.4rem', color: '#666666', fontSize: '0.8rem' }}>
              (skewed the average)
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
