/**
 * frontend/src/components/Page3BuyRange.tsx
 * Page 3: Wholesale Buy Range (The Recommendation)
 *
 * Core Question: "What range of wholesale energy do we need to purchase to cover customer demand?"
 *
 * Design:
 * - Simple and short: single focused view without friction or blocking screens.
 * - Interactive Demand Target bar at top with presets (8k, 10k, 12k default, 15k MW) and custom numeric input.
 * - 3 Summary cards: Total Daily Procurement Range (MWh), Peak Power Buy Need (MW), and Wind Shortfall Exposure (MWh).
 * - Half-hourly procurement schedule band chart with high-contrast legend and settlement period tooltips.
 * - Plain English actionable trading guidance.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { apiClient, type BuyRangeResponse } from '../api/client';
import { ShieldAlert, Zap, Info, CheckCircle } from 'lucide-react';
import { PRIMARY_COLOR, PRIMARY_COLOR_AREA } from '../theme';
import { formatDate } from '../utils/date';

interface Page3BuyRangeProps {
  selectedDate: string;
  cutoffTime: string;
  demandMw: number | null;
  onDemandChange: (val: number | null) => void;
  onNavigateToPage2?: () => void;
}

const DEMAND_PRESETS = [8000, 10000, 12000, 15000];
const DEFAULT_DEMAND = 12000;

export const Page3BuyRange: React.FC<Page3BuyRangeProps> = ({
  selectedDate,
  cutoffTime,
  demandMw,
  onDemandChange,
}) => {
  // Use 12,000 MW default if none set yet
  const effectiveDemand = demandMw ?? DEFAULT_DEMAND;

  const [data, setData] = useState<BuyRangeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tempDemand, setTempDemand] = useState<string>(String(effectiveDemand));

  // Sync temp input if parent prop changes
  useEffect(() => {
    if (demandMw !== null && demandMw !== undefined) {
      setTempDemand(String(demandMw));
    }
  }, [demandMw]);

  // Fetch buy range data
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    apiClient
      .getBuyRange(selectedDate, effectiveDemand, cutoffTime)
      .then((res) => {
        if (!isCancelled) {
          setData(res);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(err.message || 'Failed to calculate buy range');
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedDate, effectiveDemand, cutoffTime]);

  const handleApplyDemand = (val?: number) => {
    const toApply = val ?? parseFloat(tempDemand);
    if (!isNaN(toApply) && toApply > 0) {
      onDemandChange(toApply);
    }
  };

  const totals = data?.totals;
  const quantiles = data?.quantiles;

  // Chart data formatting
  const chartData = useMemo(() => {
    if (!data?.intervals) return [];
    return data.intervals.map((item) => {
      const timeLabel = item.start_time.slice(11, 16);
      const low = item.low_need_mw ?? 0;
      const high = item.high_need_mw ?? 0;
      return {
        time: timeLabel,
        period: item.settlement_period,
        forecastMw: item.forecast_mw ?? 0,
        baseNeedMw: item.base_need_mw ?? 0,
        lowNeedMw: low,
        centralNeedMw: item.central_need_mw ?? 0,
        highNeedMw: high,
        rangeBand: [low, high],
      };
    });
  }, [data]);

  const peakHigh = totals?.peak_high_need_mw ?? 0;
  const peakLow = totals?.peak_low_need_mw ?? 0;
  const lowMwh = totals?.low_need_total_mwh ?? 0;
  const highMwh = totals?.high_need_total_mwh ?? 0;
  const centralMwh = totals?.central_need_total_mwh ?? 0;
  const baseMwh = totals?.base_need_total_mwh ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 1. INTERACTIVE DEMAND INPUT BAR */}
      <section
        style={{
          border: '1px solid #d0d0d0',
          backgroundColor: '#ffffff',
          padding: '1.25rem 1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Zap size={18} color={PRIMARY_COLOR} />
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#000000' }}>
                Required Customer Energy Target
              </h2>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
              Set your utility portfolio load. The portal calculates the wholesale energy range needed after wind generation.
            </p>
          </div>

          {/* Controls: Presets and Direct Input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
            {/* Quick Demonstration Presets */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#666666', fontWeight: 600 }}>Presets:</span>
              {DEMAND_PRESETS.map((preset) => {
                const isActive = effectiveDemand === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setTempDemand(String(preset));
                      handleApplyDemand(preset);
                    }}
                    style={{
                      padding: '0.35rem 0.65rem',
                      fontSize: '0.75rem',
                      fontWeight: isActive ? 700 : 500,
                      backgroundColor: isActive ? PRIMARY_COLOR : '#f5f5f5',
                      color: isActive ? '#ffffff' : '#333333',
                      border: `1px solid ${isActive ? PRIMARY_COLOR : '#dddddd'}`,
                      borderRadius: '2px',
                      cursor: 'pointer',
                    }}
                  >
                    {preset.toLocaleString()} MW{preset === DEFAULT_DEMAND ? ' (Optimal)' : ''}
                  </button>
                );
              })}
            </div>

            {/* Custom Numeric Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleApplyDemand();
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="number"
                  min="500"
                  step="500"
                  value={tempDemand}
                  onChange={(e) => setTempDemand(e.target.value)}
                  placeholder="e.g. 12000"
                  style={{
                    width: '130px',
                    padding: '0.35rem 2.2rem 0.35rem 0.6rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    border: '1px solid #000000',
                    borderRadius: '2px',
                    textAlign: 'right',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#666666',
                    pointerEvents: 'none',
                  }}
                >
                  MW
                </span>
              </div>
              <button
                type="submit"
                style={{
                  padding: '0.4rem 0.85rem',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                Update
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ERROR BANNER */}
      {error && (
        <div style={{ padding: '1rem', border: '1px solid #d32f2f', backgroundColor: '#ffebee', color: '#d32f2f' }}>
          {error}
        </div>
      )}

      {/* 2. EXECUTIVE RECOMMENDATION STRIP */}
      <section
        style={{
          borderLeft: `4px solid ${PRIMARY_COLOR}`,
          borderTop: '1px solid #d0d0d0',
          borderRight: '1px solid #d0d0d0',
          borderBottom: '1px solid #d0d0d0',
          backgroundColor: '#fafafa',
          padding: '1rem 1.25rem',
        }}
      >
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#666666', fontWeight: 600, marginBottom: '0.2rem' }}>
          Day-Ahead Wholesale Procurement Recommendation ({formatDate(selectedDate)})
        </div>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#000000', lineHeight: 1.45 }}>
          With a customer demand target of <strong>{effectiveDemand.toLocaleString()} MW</strong>, plan to buy between{' '}
          <strong style={{ color: PRIMARY_COLOR }}>{Math.round(lowMwh).toLocaleString()} MWh</strong> and{' '}
          <strong style={{ color: PRIMARY_COLOR }}>{Math.round(highMwh).toLocaleString()} MWh</strong> from the wholesale market across the day (central expectation: <strong>{Math.round(centralMwh).toLocaleString()} MWh</strong>; peak power need: <strong>{Math.round(peakLow).toLocaleString()} MW to {Math.round(peakHigh).toLocaleString()} MW</strong>).
        </div>
      </section>

      {/* 3. THREE WHOLESALE PROCUREMENT SUMMARY CARDS */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        {/* Card 1: Daily Energy Buy Range */}
        <div style={{ background: '#ffffff', border: `1.5px solid ${PRIMARY_COLOR}`, padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: PRIMARY_COLOR, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Daily Wholesale Energy Needed
            </span>
            <CheckCircle size={15} color={PRIMARY_COLOR} />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000000', margin: '0.35rem 0' }}>
            {Math.round(lowMwh).toLocaleString()} – {Math.round(highMwh).toLocaleString()}{' '}
            <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555555' }}>
            Central Expectation: <strong>{Math.round(centralMwh).toLocaleString()} MWh</strong>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#777777', marginTop: '0.3rem' }}>
            Zero-error base need: {Math.round(baseMwh).toLocaleString()} MWh
          </div>
        </div>

        {/* Card 2: Peak Power Buy Range */}
        <div style={{ background: '#ffffff', border: '1px solid #d0d0d0', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Peak Power Buy Need
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000000', margin: '0.35rem 0' }}>
            {Math.round(peakLow).toLocaleString()} – {Math.round(peakHigh).toLocaleString()}{' '}
            <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MW</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555555' }}>
            Peak procurement spread: <strong>{Math.round(totals?.peak_range_mw ?? 0).toLocaleString()} MW</strong>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#777777', marginTop: '0.3rem' }}>
            Peak wholesale capacity required during lowest wind intervals
          </div>
        </div>

        {/* Card 3: Estimated Shortfall Energy Risk */}
        <div style={{ background: '#ffffff', border: '1px solid #d0d0d0', padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            <ShieldAlert size={14} color="#d32f2f" />
            <span>Wind Shortfall Volume at Risk</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#000000', margin: '0.35rem 0' }}>
            {data?.shortfall_energy_mwh !== null && data?.shortfall_energy_mwh !== undefined
              ? `${Math.round(data.shortfall_energy_mwh).toLocaleString()} MWh`
              : 'Empirical Risk'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555555' }}>
            Historical benchmark: <strong>2,255 MW MAE</strong>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#777777', marginTop: '0.3rem' }}>
            Volume of forecast wind requiring thermal/interconnector replacement
          </div>
        </div>
      </section>

      {/* 4. MAIN WHOLESALE BUY RANGE BAND CHART */}
      <section style={{ background: '#ffffff', border: '1px solid #d0d0d0', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#000000' }}>
              Wholesale Power Procurement Schedule
            </h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
              Required purchase band to fulfill {effectiveDemand.toLocaleString()} MW demand across each half-hour. Clamped at ≥ 0 MW.
            </p>
          </div>

          <div style={{ fontSize: '0.75rem', color: '#666666' }}>
            Target Date: <strong>{formatDate(selectedDate)}</strong> | Cutoff: <strong>{cutoffTime} UTC</strong>
          </div>
        </div>

        <div style={{ height: '370px', width: '100%' }}>
          {isLoading ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#666666', fontSize: '0.9rem' }}>
              Computing wholesale procurement range...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 15, right: 25, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis
                  dataKey="time"
                  stroke="#666666"
                  fontSize={11}
                  tickLine={{ stroke: '#cccccc' }}
                  axisLine={{ stroke: '#cccccc' }}
                  interval={3}
                />
                <YAxis
                  stroke="#666666"
                  fontSize={11}
                  tickLine={{ stroke: '#cccccc' }}
                  axisLine={{ stroke: '#cccccc' }}
                  tickFormatter={(val) => `${val.toLocaleString()} MW`}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const low = payload.find((p) => p.dataKey === 'lowNeedMw')?.value as number;
                    const central = payload.find((p) => p.dataKey === 'centralNeedMw')?.value as number;
                    const high = payload.find((p) => p.dataKey === 'highNeedMw')?.value as number;
                    const base = payload.find((p) => p.dataKey === 'baseNeedMw')?.value as number;
                    return (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          border: '1px solid #000000',
                          padding: '0.75rem 1rem',
                          fontSize: '0.8rem',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: '0.35rem', borderBottom: '1px solid #eee', paddingBottom: '0.25rem' }}>
                          {formatDate(selectedDate)} @ {label} UTC
                        </div>
                        <div style={{ color: PRIMARY_COLOR, fontWeight: 700 }}>
                          Wholesale Buy Range: {low?.toLocaleString()} – {high?.toLocaleString()} MW
                        </div>
                        <div style={{ color: '#222222', marginTop: '0.2rem' }}>
                          Central Expected Buy: <strong>{central?.toLocaleString()} MW</strong>
                        </div>
                        <div style={{ color: '#666666', marginTop: '0.15rem' }}>
                          Base Need (Zero-Error): {base?.toLocaleString()} MW
                        </div>
                      </div>
                    );
                  }}
                />

                {/* High Contrast Crisp Legend */}
                <Legend
                  verticalAlign="top"
                  align="right"
                  content={() => (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1.25rem', fontSize: '0.8rem', paddingBottom: '12px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            width: '16px',
                            height: '12px',
                            backgroundColor: 'rgba(20, 137, 55, 0.25)',
                            border: `1.5px dashed ${PRIMARY_COLOR}`,
                            display: 'inline-block',
                            borderRadius: '1px',
                          }}
                        />
                        <span style={{ color: '#111111', fontWeight: 600 }}>Buy Range (P10 to P90 Deficit Protection)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '18px', height: '3px', backgroundColor: PRIMARY_COLOR, display: 'inline-block' }} />
                        <span style={{ color: '#111111', fontWeight: 600 }}>Central Expected Buy (P50)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '18px', height: '2px', borderTop: '2px dashed #888888', display: 'inline-block' }} />
                        <span style={{ color: '#666666', fontWeight: 600 }}>Base Need (Zero Error)</span>
                      </div>
                    </div>
                  )}
                />

                {/* Range Band [Low, High] */}
                <Area
                  type="monotone"
                  dataKey="rangeBand"
                  stroke={PRIMARY_COLOR}
                  strokeOpacity={0.4}
                  fill={PRIMARY_COLOR_AREA}
                  fillOpacity={1}
                  name="Buy Range"
                />

                {/* Central Estimate Line (P50) */}
                <Line
                  type="monotone"
                  dataKey="centralNeedMw"
                  name="Central Estimate"
                  stroke={PRIMARY_COLOR}
                  strokeWidth={3}
                  dot={false}
                />

                {/* Base Need Line (Zero Error) */}
                <Line
                  type="monotone"
                  dataKey="baseNeedMw"
                  name="Base Need"
                  stroke="#888888"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />

                {/* Bounds Lines for clear visual definition */}
                <Line
                  type="monotone"
                  dataKey="highNeedMw"
                  name="High Need"
                  stroke="#333333"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="lowNeedMw"
                  name="Low Need"
                  stroke="#666666"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 5. Empirical Methodology & Quantiles Footnote */}
        <div
          style={{
            marginTop: '1.25rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            fontSize: '0.75rem',
          }}
        >
          <div style={{ color: '#666666', fontStyle: 'italic' }}>
            Empirical Basis: {data?.note ?? `Derived from historical decision-time errors prior to ${formatDate(selectedDate)}.`}
          </div>

          {quantiles && (
            <div style={{ display: 'flex', gap: '1rem', color: '#444444' }}>
              <span>
                P10 Wind Error: <strong>{quantiles.p10_error_mw > 0 ? `+${quantiles.p10_error_mw}` : quantiles.p10_error_mw} MW</strong>
              </span>
              <span>
                P50 Wind Error: <strong>{quantiles.p50_error_mw > 0 ? `+${quantiles.p50_error_mw}` : quantiles.p50_error_mw} MW</strong>
              </span>
              <span>
                P90 Wind Error: <strong>+{quantiles.p90_error_mw} MW</strong>
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 6. ACTIONABLE DESK TAKEAWAY CARD */}
      <section
        style={{
          border: '1px solid #d0d0d0',
          backgroundColor: '#ffffff',
          padding: '1.25rem 1.5rem',
          fontSize: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: '#000000', marginBottom: '0.5rem' }}>
          <Info size={16} color={PRIMARY_COLOR} />
          <span>Desk Execution Strategy</span>
        </div>
        <p style={{ margin: 0, color: '#444444', lineHeight: 1.55 }}>
          Lock in firm baseload of at least <strong>{Math.round(lowMwh).toLocaleString()} MWh</strong> on the day-ahead auction (EPEX/N2EX) to avoid over-contracting if wind over-delivers. Keep up to <strong>{Math.round(Math.max(0, highMwh - lowMwh)).toLocaleString()} MWh</strong> in flexible intraday capacity or standing thermal orders to cover potential wind dropouts without risking costly surplus imbalance cash-out penalties.
        </p>
      </section>
    </div>
  );
};
