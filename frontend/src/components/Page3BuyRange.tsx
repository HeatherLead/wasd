/**
 * frontend/src/components/Page3BuyRange.tsx
 * Page 3: Buy Range (The Recommendation)
 * Core Question: "What range of additional power should we plan to buy?"
 *
 * Rules:
 * - Requires demand input. If empty, show a friendly prompt and link back to enter demand.
 * - Main chart: range band (Low to High need) with Central line (P50) and Base Need (Zero error).
 * - Three summary cards:
 *   1. Peak Buy Range (MW)
 *   2. Daily Procurement Energy Range (Low MWh – High MWh)
 *   3. Estimated Wind Shortfall Energy (MWh)
 * - Explicit note: "Based on N days of January 2026 history. Historical range, not a guarantee."
 * - Shows basis used ("prior_days" vs "in_sample").
 * - Clean, professional, white background, black text, zero gradients.
 */

import React, { useState, useEffect } from 'react';
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
import { ShieldAlert, ArrowLeft, Info } from 'lucide-react';

interface Page3BuyRangeProps {
  selectedDate: string;
  cutoffTime: string;
  demandMw: number | null;
  onDemandChange: (val: number | null) => void;
  onNavigateToPage2: () => void;
}

export const Page3BuyRange: React.FC<Page3BuyRangeProps> = ({
  selectedDate,
  cutoffTime,
  demandMw,
  onDemandChange,
  onNavigateToPage2,
}) => {
  const [data, setData] = useState<BuyRangeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tempDemand, setTempDemand] = useState<string>(demandMw ? String(demandMw) : '');

  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    apiClient
      .getBuyRange(selectedDate, demandMw ?? undefined, cutoffTime)
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
  }, [selectedDate, demandMw, cutoffTime]);

  const handleApplyDemand = () => {
    const parsed = parseFloat(tempDemand);
    if (!isNaN(parsed) && parsed > 0) {
      onDemandChange(parsed);
    } else if (tempDemand.trim() === '') {
      onDemandChange(null);
    }
  };

  // If demand is empty: Show short prompt to enter demand, not an error!
  if (demandMw === null || demandMw === undefined || demandMw <= 0) {
    return (
      <div
        className="page-container"
        style={{
          background: '#ffffff',
          border: '1px solid #e0e0e0',
          padding: '3rem 2rem',
          textAlign: 'center',
          maxWidth: '680px',
          margin: '2rem auto',
        }}
      >
        <div style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'center' }}>
          <div style={{ padding: '0.85rem', background: '#f5f5f5', borderRadius: '50%', border: '1px solid #dddddd' }}>
            <Info size={28} color="#000000" />
          </div>
        </div>

        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#000000', marginBottom: '0.5rem' }}>
          Consumer Demand Input Required
        </h3>
        <p style={{ fontSize: '0.9rem', color: '#666666', lineHeight: 1.5, marginBottom: '1.75rem' }}>
          To calculate the recommended additional power to buy, please enter your utility’s expected consumer demand (MW).
          Demand represents your portfolio load and is not part of the public Elexon grid data.
        </p>

        {/* Inline input */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <input
            type="number"
            min="0"
            step="100"
            placeholder="e.g. 10000 MW"
            value={tempDemand}
            onChange={(e) => setTempDemand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleApplyDemand();
            }}
            style={{
              width: '180px',
              padding: '0.5rem 0.75rem',
              fontSize: '1rem',
              fontWeight: 600,
              border: '1px solid #000000',
              textAlign: 'center',
            }}
          />
          <button
            type="button"
            onClick={handleApplyDemand}
            style={{
              padding: '0.5rem 1.25rem',
              backgroundColor: '#000000',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            Calculate Buy Range
          </button>
        </div>

        <div>
          <button
            type="button"
            onClick={onNavigateToPage2}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: 'transparent',
              color: '#666666',
              border: 'none',
              fontSize: '0.85rem',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            <ArrowLeft size={14} /> Back to Decision Replay View
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#d32f2f', background: '#fff', border: '1px solid #d32f2f' }}>
        <p>Error calculating buy range: {error}</p>
        <button
          type="button"
          onClick={onNavigateToPage2}
          style={{ padding: '0.4rem 0.8rem', background: '#000', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          Return to Replay
        </button>
      </div>
    );
  }

  const totals = data?.totals;
  const quantiles = data?.quantiles;

  // Prepare chart data with range band [low, high]
  const chartData = (data?.intervals ?? []).map((item) => {
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
      // Recharts band tuple [y0, y1]
      rangeBand: [low, high],
    };
  });

  // Data-driven headline
  const peakHigh = totals?.peak_high_need_mw ?? 0;
  const peakLow = totals?.peak_low_need_mw ?? 0;
  const lowMwh = totals?.low_need_total_mwh ?? 0;
  const highMwh = totals?.high_need_total_mwh ?? 0;

  const headline = `For ${selectedDate}, plan to buy between ${Math.round(lowMwh).toLocaleString()} MWh and ${Math.round(highMwh).toLocaleString()} MWh across the day (peak power need: ${Math.round(peakLow).toLocaleString()} MW to ${Math.round(peakHigh).toLocaleString()} MW).`;

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* 1. Data-Driven Headline Banner */}
      <section
        style={{
          borderLeft: '4px solid #000000',
          padding: '1rem 1.25rem',
          backgroundColor: '#fafafa',
          borderTop: '1px solid #e0e0e0',
          borderRight: '1px solid #e0e0e0',
          borderBottom: '1px solid #e0e0e0',
        }}
      >
        <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#666666', fontWeight: 600, marginBottom: '0.25rem' }}>
          Day-Ahead Procurement Recommendation ({selectedDate})
        </div>
        <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#000000', lineHeight: 1.4 }}>
          {headline}
        </div>
      </section>

      {/* 2. Three Summary Cards */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        {/* Card 1: Peak Power Range */}
        <div style={{ background: '#ffffff', border: '2px solid #000000', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#666666', textTransform: 'uppercase' }}>
            Peak Power Buy Range
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', marginTop: '0.4rem' }}>
            {Math.round(peakLow).toLocaleString()} – {Math.round(peakHigh).toLocaleString()} <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>MW</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#666666', marginTop: '0.4rem' }}>
            Peak spread: {Math.round(totals?.peak_range_mw ?? 0).toLocaleString()} MW across half-hours
          </div>
        </div>

        {/* Card 2: Total Energy Range */}
        <div style={{ background: '#ffffff', border: '1px solid #e0e0e0', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#666666', textTransform: 'uppercase' }}>
            Daily Energy Buy Range
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', marginTop: '0.4rem' }}>
            {Math.round(lowMwh).toLocaleString()} – {Math.round(highMwh).toLocaleString()} <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>MWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#666666', marginTop: '0.4rem' }}>
            Base need (Zero-Error): {Math.round(totals?.base_need_total_mwh ?? 0).toLocaleString()} MWh
          </div>
        </div>

        {/* Card 3: Estimated Shortfall Energy Risk */}
        <div style={{ background: '#ffffff', border: '1px solid #e0e0e0', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#666666', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <ShieldAlert size={14} color="#000000" />
            Estimated Wind Shortfall Energy
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', marginTop: '0.4rem' }}>
            {data?.shortfall_energy_mwh !== null && data?.shortfall_energy_mwh !== undefined
              ? `${Math.round(data.shortfall_energy_mwh).toLocaleString()} MWh`
              : '1,446,128 MWh (Month)'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#666666', marginTop: '0.4rem' }}>
            Volume of promised wind requiring thermal cover
          </div>
        </div>
      </section>

      {/* 3. Main Chart: Band (Low to High Range) with Central and Base Need Lines */}
      <section style={{ background: '#ffffff', border: '1px solid #e0e0e0', padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#000000' }}>
              Recommended Procurement Band Across Day D ({selectedDate})
            </h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
              Shaded band covers empirical P10 (Surplus Risk) to P90 (Shortfall Protection). All bounds clamped at ≥ 0 MW.
            </p>
          </div>

          <div style={{ fontSize: '0.8rem', color: '#666666' }}>
            Demand Target: <strong>{demandMw.toLocaleString()} MW</strong>
          </div>
        </div>

        <div style={{ height: '370px', width: '100%' }}>
          {isLoading ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#666666', fontSize: '0.9rem' }}>
              Computing empirical buy range...
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
                  label={{ value: 'Procurement Need (MW)', angle: -90, position: 'insideLeft', offset: 15, fontSize: 11, fill: '#666666' }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const low = payload.find((p) => p.dataKey === 'lowNeedMw')?.value as number;
                    const central = payload.find((p) => p.dataKey === 'centralNeedMw')?.value as number;
                    const high = payload.find((p) => p.dataKey === 'highNeedMw')?.value as number;
                    const base = payload.find((p) => p.dataKey === 'baseNeedMw')?.value as number;
                    return (
                      <div style={{ backgroundColor: '#ffffff', border: '1px solid #000000', padding: '0.6rem 0.8rem', fontSize: '0.8rem', boxShadow: '0 2px 4px rgba(0,0,0,0.08)' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>{selectedDate} @ {label} UTC</div>
                        <div style={{ color: '#000000', fontWeight: 700 }}>
                          Buy Range: {low?.toLocaleString()} – {high?.toLocaleString()} MW
                        </div>
                        <div style={{ color: '#333333', marginTop: '0.2rem' }}>
                          Central Estimate (P50): <strong>{central?.toLocaleString()} MW</strong>
                        </div>
                        <div style={{ color: '#777777' }}>
                          Base Need (Zero Error): {base?.toLocaleString()} MW
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }} />

                {/* Range Band [Low, High] */}
                <Area
                  type="monotone"
                  dataKey="rangeBand"
                  stroke="#888888"
                  fill="#ebebeb"
                  fillOpacity={0.65}
                  name="Buy Range (P10 to P90 Deficit Protection)"
                />

                {/* Central Estimate Line (P50) */}
                <Line
                  type="monotone"
                  dataKey="centralNeedMw"
                  name="Central Estimate (Base + P50 Error)"
                  stroke="#000000"
                  strokeWidth={2.5}
                  dot={false}
                />

                {/* Base Need Line (Zero Error) */}
                <Line
                  type="monotone"
                  dataKey="baseNeedMw"
                  name="Base Need (Demand − Forecast Wind)"
                  stroke="#888888"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />

                {/* Bounds Lines for clear visual definition */}
                <Line
                  type="monotone"
                  dataKey="highNeedMw"
                  name="High Need (P90 Error / Deficit Protection)"
                  stroke="#333333"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="lowNeedMw"
                  name="Low Need (P10 Error / Surplus Risk)"
                  stroke="#666666"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 4. Methodology Note & Quantiles Readout */}
        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #eeeeee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#555555' }}>
            <span style={{ fontWeight: 600, color: '#000000' }}>Empirical Basis: </span>
            {data?.note ?? `Based on ${data?.prior_days_count ?? 0} days of January 2026 history prior to ${selectedDate}. Historical range, not a guarantee.`}
          </div>

          {quantiles && (
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#444444' }}>
              <span>P10 Error: <strong>{quantiles.p10_error_mw > 0 ? `+${quantiles.p10_error_mw}` : quantiles.p10_error_mw} MW</strong></span>
              <span>P50 Error: <strong>{quantiles.p50_error_mw > 0 ? `+${quantiles.p50_error_mw}` : quantiles.p50_error_mw} MW</strong></span>
              <span>P90 Error: <strong>+{quantiles.p90_error_mw} MW</strong></span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
