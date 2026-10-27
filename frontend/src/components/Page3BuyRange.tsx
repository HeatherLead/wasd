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
import { ShieldAlert, Zap, CheckCircle } from 'lucide-react';
import {
  PRIMARY_COLOR,
  PRIMARY_COLOR_AREA,
  DEMAND_PRESETS,
  DEFAULT_DEMAND_MW,
} from '../store';
import { formatDate } from '../utils/date';

interface Page3BuyRangeProps {
  selectedDate: string;
  cutoffTime: string;
  demandMw: number | null;
  onDemandChange: (val: number | null) => void;
  onNavigateToPage2?: () => void;
}

export const Page3BuyRange: React.FC<Page3BuyRangeProps> = ({
  selectedDate,
  cutoffTime,
  demandMw,
  onDemandChange,
}) => {
  const effectiveDemand = demandMw ?? DEFAULT_DEMAND_MW;

  const [data, setData] = useState<BuyRangeResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tempDemand, setTempDemand] = useState<string>(String(effectiveDemand));

  useEffect(() => {
    if (demandMw !== null && demandMw !== undefined) {
      setTempDemand(String(demandMw));
    }
  }, [demandMw]);

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

  const chartData = useMemo(() => {
    if (!data?.intervals) return [];
    return data.intervals.map((item) => {
      const timeLabel = item.start_time.slice(11, 16);
      const base = item.base_need_mw ?? 0;
      const central = item.central_need_mw ?? 0;
      const optLow = Math.min(base, central);
      const optHigh = Math.max(base, central);
      const highNeed = item.high_need_mw ?? 0;
      return {
        time: timeLabel,
        period: item.settlement_period,
        forecastMw: item.forecast_mw ?? 0,
        baseNeedMw: base,
        centralNeedMw: central,
        optLowNeedMw: optLow,
        optHighNeedMw: optHigh,
        highNeedMw: highNeed,
        lowNeedMw: item.low_need_mw ?? 0,
        rangeBand: [optLow, optHigh],
      };
    });
  }, [data]);

  const baseMwh = totals?.base_need_total_mwh ?? 0;
  const centralMwh = totals?.central_need_total_mwh ?? 0;
  const optimalLowMwh = Math.min(baseMwh, centralMwh);
  const optimalHighMwh = Math.max(baseMwh, centralMwh);

  const peakForecast = data?.intervals && data.intervals.length > 0 ? Math.max(0, ...data.intervals.map((it) => it.base_need_mw ?? 0)) : 0;
  const peakEstimated = data?.intervals && data.intervals.length > 0 ? Math.max(0, ...data.intervals.map((it) => it.central_need_mw ?? 0)) : 0;
  const optimalPeakLow = Math.min(peakForecast, peakEstimated);
  const optimalPeakHigh = Math.max(peakForecast, peakEstimated);
  const optimalPeakSpread = Math.max(0, optimalPeakHigh - optimalPeakLow);
  const severeDownsideMwh = totals?.high_need_total_mwh ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section
        style={{
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          backgroundColor: '#ffffff',
          padding: '0.85rem 1.25rem',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: '#e8f5ec',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Zap size={20} color={PRIMARY_COLOR} />
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Required Customer Energy Target
              </div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#000000', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{effectiveDemand.toLocaleString()} MW</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: PRIMARY_COLOR,
                    backgroundColor: '#e8f5ec',
                    padding: '1px 6px',
                    borderRadius: '4px',
                  }}
                >
                  Active Target
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#666666' }}>Presets:</span>

            <div style={{ display: 'flex', gap: '3px', backgroundColor: '#f1f3f5', padding: '3px', borderRadius: '6px' }}>
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
                      height: '30px',
                      padding: '0 0.75rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: isActive ? PRIMARY_COLOR : 'transparent',
                      color: isActive ? '#ffffff' : '#333333',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>{preset.toLocaleString()} MW</span>
                    {preset === DEFAULT_DEMAND_MW && (
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          backgroundColor: isActive ? 'rgba(255,255,255,0.25)' : '#e0e0e0',
                          color: isActive ? '#ffffff' : '#555555',
                          fontWeight: 700,
                        }}
                      >
                        Base
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div style={{ width: '1px', height: '24px', backgroundColor: '#e0e0e0' }} />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleApplyDemand();
              }}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: '32px',
                  border: '1px solid #cccccc',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  backgroundColor: '#ffffff',
                }}
              >
                <input
                  type="number"
                  min="500"
                  step="500"
                  value={tempDemand}
                  onChange={(e) => setTempDemand(e.target.value)}
                  placeholder="e.g. 12000"
                  style={{
                    width: '80px',
                    height: '100%',
                    padding: '0 0.5rem',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    border: 'none',
                    textAlign: 'right',
                    outline: 'none',
                  }}
                />
                <span
                  style={{
                    padding: '0 0.45rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#666666',
                    backgroundColor: '#f8f8f8',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    borderLeft: '1px solid #e0e0e0',
                    pointerEvents: 'none',
                  }}
                >
                  MW
                </span>
                <button
                  type="submit"
                  style={{
                    height: '100%',
                    padding: '0 0.85rem',
                    backgroundColor: '#000000',
                    color: '#ffffff',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#333333')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#000000')}
                >
                  Update
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {error && (
        <div style={{ padding: '1rem', border: '1px solid #d32f2f', borderRadius: '8px', backgroundColor: '#ffebee', color: '#d32f2f' }}>
          {error}
        </div>
      )}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <div style={{ background: '#ffffff', border: `1.5px solid ${PRIMARY_COLOR}`, borderRadius: '8px', padding: '1.1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: PRIMARY_COLOR, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Daily Wholesale Energy (Optimal)
            </span>
            <CheckCircle size={15} color={PRIMARY_COLOR} />
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', margin: '0.25rem 0' }}>
            {Math.round(optimalLowMwh).toLocaleString()} – {Math.round(optimalHighMwh).toLocaleString()}{' '}
            <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555555' }}>
            Central expectation: <strong>{Math.round(centralMwh).toLocaleString()} MWh</strong>
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '1.1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Peak Power Need (Optimal)
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', margin: '0.25rem 0' }}>
            {Math.round(optimalPeakLow).toLocaleString()} – {Math.round(optimalPeakHigh).toLocaleString()}{' '}
            <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MW</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555555' }}>
            Peak spread: <strong>{Math.round(optimalPeakSpread).toLocaleString()} MW</strong>
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '1.1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            <ShieldAlert size={14} color="#d32f2f" />
            <span>Downside Risk Ceiling</span>
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, color: '#000000', margin: '0.25rem 0' }}>
            {Math.round(severeDownsideMwh).toLocaleString()}{' '}
            <span style={{ fontSize: '0.85rem', fontWeight: 400 }}>MWh</span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#555555' }}>
            Severe shortfall protection (P90)
          </div>
        </div>
      </section>

      <section style={{ background: '#ffffff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#000000' }}>
              Wholesale Power Procurement Schedule
            </h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#666666' }}>
              Required purchase band to fulfill {effectiveDemand.toLocaleString()} MW demand across each half-hour.
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
                    const d = payload[0]?.payload;
                    if (!d) return null;
                    const optLow = d.optLowNeedMw ?? Math.min(d.baseNeedMw ?? 0, d.centralNeedMw ?? 0);
                    const optHigh = d.optHighNeedMw ?? Math.max(d.baseNeedMw ?? 0, d.centralNeedMw ?? 0);
                    const central = d.centralNeedMw ?? 0;
                    const base = d.baseNeedMw ?? 0;
                    return (
                      <div
                        style={{
                          backgroundColor: '#ffffff',
                          border: '1px solid #e0e0e0',
                          borderRadius: '6px',
                          padding: '0.75rem 1rem',
                          fontSize: '0.8rem',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: '0.35rem', borderBottom: '1px solid #eee', paddingBottom: '0.25rem' }}>
                          {formatDate(selectedDate)} @ {label} UTC
                        </div>
                        <div style={{ color: PRIMARY_COLOR, fontWeight: 700 }}>
                          Optimal Buy Range: {Math.round(optLow).toLocaleString()} – {Math.round(optHigh).toLocaleString()} MW
                        </div>
                        <div style={{ color: '#222222', marginTop: '0.2rem' }}>
                          Estimated Actual Need: <strong>{Math.round(central).toLocaleString()} MW</strong>
                        </div>
                        <div style={{ color: '#666666', marginTop: '0.15rem' }}>
                          Forecast Baseline Need: {Math.round(base).toLocaleString()} MW
                        </div>
                      </div>
                    );
                  }}
                />

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
                            border: `1.5px solid ${PRIMARY_COLOR}`,
                            display: 'inline-block',
                            borderRadius: '3px',
                          }}
                        />
                        <span style={{ color: '#111111', fontWeight: 600 }}>Optimal Buy Range (Forecast vs Estimated)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '18px', height: '3px', backgroundColor: PRIMARY_COLOR, display: 'inline-block' }} />
                        <span style={{ color: '#111111', fontWeight: 600 }}>Estimated Need (Central)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '18px', height: '2px', borderTop: '2px dashed #666666', display: 'inline-block' }} />
                        <span style={{ color: '#666666', fontWeight: 600 }}>Forecast Baseline Need</span>
                      </div>
                    </div>
                  )}
                />

                <Area
                  type="monotone"
                  dataKey="rangeBand"
                  stroke={PRIMARY_COLOR}
                  strokeOpacity={0.6}
                  fill={PRIMARY_COLOR_AREA}
                  fillOpacity={1}
                  name="Optimal Buy Range"
                />

                <Line
                  type="monotone"
                  dataKey="centralNeedMw"
                  name="Estimated Need"
                  stroke={PRIMARY_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                />

                <Line
                  type="monotone"
                  dataKey="baseNeedMw"
                  name="Forecast Baseline"
                  stroke="#555555"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        <div
          style={{
            marginTop: '1.25rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'end',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            fontSize: '0.75rem',
          }}
        >
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
    </div>
  );
};
