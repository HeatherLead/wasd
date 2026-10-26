/**
 * frontend/src/components/Page2DecisionReplay.tsx
 * Page 2: Decision Replay (The Trader's View)
 * Core Question: "On D-1 at the cutoff, what did the trader see for delivery day D?"
 *
 * Rules:
 * - Delivery day picker.
 * - Banner: "Cutoff: <datetime UTC>. Latest forecast used: published <publishTime>."
 * - Chart: forecast wind for each half-hour of D.
 * - "Reveal what actually happened" toggle (OFF by default).
 * - User input field: "Your expected demand (MW)" (starts empty, clearly labelled as entered by user).
 * - When filled: shows residual to cover (demand - forecast) per half-hour and daily total MWh.
 * - Context line from history: "Forecasts were too high X% of the time".
 */

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { DayDetailResponse, DaySummaryItem, SummaryResponse } from '../api/client';
import { Eye, EyeOff, Calendar } from 'lucide-react';
import { PRIMARY_COLOR } from '../theme';
import { formatDate } from '../utils/date';
import { CustomDropdown } from './CustomDropdown';

interface Page2DecisionReplayProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  cutoffTime: string;
  dayDetail: DayDetailResponse | null;
  isLoading: boolean;
  days: DaySummaryItem[];
  summary: SummaryResponse | null;
  demandMw: number | null;
  onDemandChange: (val: number | null) => void;
  onNavigateToPage3?: () => void;
}

export const Page2DecisionReplay: React.FC<Page2DecisionReplayProps> = ({
  selectedDate,
  onSelectDate,
  cutoffTime: _cutoffTime,
  dayDetail,
  isLoading,
  days,
  summary: _summary,
  demandMw,
  onDemandChange,
  onNavigateToPage3,
}) => {
  const [revealActuals, setRevealActuals] = useState(false);
  const [demandInput, setDemandInput] = useState<string>(demandMw ? String(demandMw) : '');

  // Handle user demand submit
  const handleDemandBlurOrSubmit = () => {
    const parsed = parseFloat(demandInput);
    if (!isNaN(parsed) && parsed > 0) {
      onDemandChange(parsed);
    } else if (demandInput.trim() === '') {
      onDemandChange(null);
    }
  };

  // Compute chart intervals and residual needs
  const intervals = dayDetail?.intervals ?? [];
  const chartData = intervals.map((item) => {
    const timeLabel = item.start_time.slice(11, 16);
    const fMw = item.forecast_generation_mw ?? null;
    const aMw = item.actual_generation_mw ?? null;

    let residualNeedMw: number | null = null;
    if (demandMw !== null && fMw !== null) {
      residualNeedMw = Math.max(0, demandMw - fMw);
    }

    return {
      time: timeLabel,
      period: item.settlement_period,
      forecastMw: fMw,
      actualMw: aMw,
      demandMw: demandMw,
      residualNeedMw: residualNeedMw,
      errorMw: fMw !== null && aMw !== null ? fMw - aMw : null,
    };
  });

  // Calculate daily totals in MWh
  const validForecasts = intervals.filter((i) => i.forecast_generation_mw !== null);
  const totalForecastMwh = validForecasts.reduce((acc, i) => acc + (i.forecast_generation_mw ?? 0) * 0.5, 0);

  let totalDemandMwh: number | null = null;
  let totalResidualMwh: number | null = null;
  if (demandMw !== null) {
    totalDemandMwh = demandMw * 24;
    totalResidualMwh = chartData.reduce((acc, item) => acc + (item.residualNeedMw ?? 0) * 0.5, 0);
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* 1. Header & Delivery Day Picker */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 600, color: '#000000' }}>
            Decision Replay — {formatDate(selectedDate)}
          </h2>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#666666' }}>
            Replay the exact decision moment before wholesale auction gate closure.
          </p>
        </div>

        {/* Date Selector */}
        <CustomDropdown
          labelPrefix="Delivery Day D"
          icon={<Calendar size={14} color={PRIMARY_COLOR} />}
          options={days.map((d) => ({
            value: d.delivery_date,
            label: formatDate(d.delivery_date),
          }))}
          value={selectedDate}
          onChange={(val) => onSelectDate(val)}
        />
      </div>

      {/* 3. Demand Input Field & Reveal Toggle Controls */}
      <section
        style={{
          background: '#ffffff',
          border: '1px solid #e0e0e0',
          padding: '1.25rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem',
          alignItems: 'center',
        }}
      >
        {/* User Demand Input */}
        <div>
          <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#000000', marginBottom: '0.35rem' }}>
            Your expected demand (MW)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="number"
              min="0"
              step="100"
              placeholder="e.g. 10000"
              value={demandInput}
              onChange={(e) => setDemandInput(e.target.value)}
              onBlur={handleDemandBlurOrSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDemandBlurOrSubmit();
              }}
              style={{
                width: '160px',
                padding: '0.45rem 0.75rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                border: '1px solid #000000',
                backgroundColor: '#ffffff',
                color: '#000000',
              }}
            />
            <button
              type="button"
              onClick={handleDemandBlurOrSubmit}
              style={{
                padding: '0.45rem 0.85rem',
                backgroundColor: PRIMARY_COLOR,
                color: '#ffffff',
                border: `1px solid ${PRIMARY_COLOR}`,
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Apply
            </button>
            {demandMw !== null && (
              <button
                type="button"
                onClick={() => {
                  setDemandInput('');
                  onDemandChange(null);
                }}
                style={{
                  padding: '0.45rem 0.65rem',
                  backgroundColor: '#ffffff',
                  color: '#666666',
                  border: '1px solid #cccccc',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
          </div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.75rem', color: '#666666' }}>
            Demand is entered by you. It is not part of the Elexon data.
          </p>
        </div>

        {/* Reveal Toggle */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#000000', marginBottom: '0.35rem' }}>
            Replay Verification
          </span>
          <button
            type="button"
            onClick={() => setRevealActuals(!revealActuals)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              backgroundColor: revealActuals ? PRIMARY_COLOR : '#ffffff',
              color: revealActuals ? '#ffffff' : '#000000',
              border: `1px solid ${revealActuals ? PRIMARY_COLOR : '#000000'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              transition: 'background-color 0.15s ease',
            }}
          >
            {revealActuals ? <EyeOff size={16} /> : <Eye size={16} />}
            {revealActuals ? 'Hide What Actually Happened' : 'Reveal What Actually Happened'}
          </button>
          <span style={{ fontSize: '0.75rem', color: '#666666', marginTop: '0.35rem' }}>
            {revealActuals ? 'Outturn revealed for post-trade evaluation.' : 'Actual wind is hidden to simulate the real decision moment.'}
          </span>
        </div>
      </section>

      {/* 4. Main Decision Replay Chart */}
      <section style={{ background: '#ffffff', border: '1px solid #e0e0e0', padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#000000' }}>
              Day D Half-Hourly Wind & Procurement Schedule ({formatDate(selectedDate)})
            </h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
              {demandMw !== null
                ? `Expected demand set to ${demandMw.toLocaleString()} MW. Shaded area represents base need to buy.`
                : 'Wind-only view available at decision cutoff (09:00 UTC D-1). Enter demand above to see procurement deficit.'}
            </p>
          </div>

          {/* Quick summary readouts */}
          <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: '#666666' }}>Forecast Wind Energy: </span>
              <strong>{totalForecastMwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} MWh</strong>
            </div>
            {demandMw !== null && totalDemandMwh !== null && (
              <div>
                <span style={{ color: '#666666' }}>Expected Demand: </span>
                <strong>{totalDemandMwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} MWh</strong>
              </div>
            )}
            {demandMw !== null && totalResidualMwh !== null && (
              <div>
                <span style={{ color: '#666666' }}>Base Need to Buy: </span>
                <strong style={{ color: '#000000' }}>{totalResidualMwh.toLocaleString(undefined, { maximumFractionDigits: 0 })} MWh</strong>
              </div>
            )}
          </div>
        </div>

        <div style={{ height: '360px', width: '100%' }}>
          {isLoading ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#666666', fontSize: '0.9rem' }}>
              Loading decision replay data...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 15, right: 25, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eeeeee" />
                <XAxis
                  dataKey="time"
                  stroke="#333333"
                  fontSize={11}
                  tickLine={false}
                  label={{ value: 'Target Settlement Time (UTC)', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#666666' }}
                />
                <YAxis
                  stroke="#333333"
                  fontSize={11}
                  tickLine={false}
                  label={{ value: 'Power (MW)', angle: -90, position: 'insideLeft', offset: 15, fontSize: 11, fill: '#666666' }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const fVal = payload.find((p) => p.dataKey === 'forecastMw')?.value as number;
                    const aVal = payload.find((p) => p.dataKey === 'actualMw')?.value as number;
                    const resVal = payload.find((p) => p.dataKey === 'residualNeedMw')?.value as number;
                    return (
                      <div style={{ backgroundColor: '#ffffff', border: '1px solid #000000', padding: '0.6rem 0.8rem', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(0,0,0,0.08)' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>{formatDate(selectedDate)} @ {label} UTC</div>
                        <div style={{ color: PRIMARY_COLOR, fontWeight: 600 }}>Forecast Wind: <strong>{fVal !== null && fVal !== undefined ? `${fVal.toLocaleString()} MW` : '—'}</strong></div>
                        {demandMw !== null && (
                          <div>Demand Target: <strong>{demandMw.toLocaleString()} MW</strong></div>
                        )}
                        {resVal !== null && resVal !== undefined && (
                          <div style={{ color: '#000000', fontWeight: 600 }}>
                            Base Need to Buy: <strong>{resVal.toLocaleString()} MW</strong>
                          </div>
                        )}
                        {revealActuals && aVal !== null && aVal !== undefined && (
                          <div style={{ marginTop: '0.3rem', paddingTop: '0.3rem', borderTop: '1px solid #e0e0e0', color: '#555555' }}>
                            Actual Delivered Wind: <strong>{aVal.toLocaleString()} MW</strong>
                            {fVal !== null && (
                              <div style={{ fontWeight: 600, color: fVal > aVal ? '#000000' : '#444444' }}>
                                Deficit / Error: {fVal > aVal ? `+${(fVal - aVal).toLocaleString()} MW (Shortfall)` : `${(fVal - aVal).toLocaleString()} MW (Surplus)`}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }} />

                {/* Flat Demand Reference Line if entered */}
                {demandMw !== null && (
                  <ReferenceLine
                    y={demandMw}
                    label={{ value: `Demand: ${demandMw.toLocaleString()} MW`, fill: '#666666', fontSize: 11, position: 'insideTopRight' }}
                    stroke="#888888"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                  />
                )}

                {/* Forecast Wind (Decision Moment) */}
                <Line
                  type="monotone"
                  dataKey="forecastMw"
                  name="Forecast Wind (Locked at 09:00 Cutoff)"
                  stroke={PRIMARY_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: PRIMARY_COLOR }}
                />

                {/* Residual Need if demand entered */}
                {demandMw !== null && (
                  <Line
                    type="monotone"
                    dataKey="residualNeedMw"
                    name="Base Need to Buy (Demand − Wind)"
                    stroke="#555555"
                    strokeWidth={2}
                    dot={false}
                  />
                )}

                {/* Revealed Actual Outturn */}
                {revealActuals && (
                  <Line
                    type="monotone"
                    dataKey="actualMw"
                    name="Actual Wind Outturn"
                    stroke="#999999"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Transition Link to Page 3 */}
        {demandMw !== null && onNavigateToPage3 && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #eeeeee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: '#555555' }}>
              Base procurement need is <strong>{totalResidualMwh?.toLocaleString(undefined, { maximumFractionDigits: 0 })} MWh</strong>. How does forecast uncertainty affect what we should buy?
            </span>
            <button
              type="button"
              onClick={onNavigateToPage3}
              style={{
                backgroundColor: PRIMARY_COLOR,
                color: '#ffffff',
                border: `1px solid ${PRIMARY_COLOR}`,
                borderRadius: '4px',
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              View Recommended Buy Range →
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
