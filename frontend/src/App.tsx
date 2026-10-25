/**
 * frontend/src/App.tsx
 * Wind Forecast Accuracy Portal - Redesigned as a Simple 3-Page Decision Tool.
 *
 * Core Principle - Answers three questions, one per page:
 * 1. "How accurate are the wind forecasts the trader actually saw?" (Page 1: Accuracy)
 * 2. "What would the trader have seen for a given delivery day?" (Page 2: Decision Replay)
 * 3. "What does that mean for what we buy?" (Page 3: Buy Range)
 *
 * Secondary details (interval table, revisions, largest errors, audit) moved to a collapsed section.
 * Styling: White background, black typography, zero gradients strictly enforced.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from './api/client';
import type {
  SummaryResponse,
  DayDetailResponse,
  AccuracyResponse,
  DaySummaryItem,
} from './api/client';
import { Page1Accuracy } from './components/Page1Accuracy';
import { Page2DecisionReplay } from './components/Page2DecisionReplay';
import { Page3BuyRange } from './components/Page3BuyRange';
import { DetailsSection } from './components/DetailsSection';
import {
  BarChart2,
  Clock,
  ShoppingCart,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

type PageId = 'accuracy' | 'replay' | 'buy-range';

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<PageId>('accuracy');

  // Shared Global States
  const [cutoffTime, setCutoffTime] = useState<string>('09:00');
  const [selectedDate, setSelectedDate] = useState<string>('2026-01-15');
  const [demandMw, setDemandMw] = useState<number | null>(null);

  // API Data States
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [daysList, setDaysList] = useState<DaySummaryItem[]>([]);
  const [accuracyData, setAccuracyData] = useState<AccuracyResponse | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetailResponse | null>(null);

  // Loading and Error States
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingDayDetail, setLoadingDayDetail] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Fetch Global Data (Summary, Days list, Accuracy breakdowns) when cutoff changes
  const fetchGlobalData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [sumRes, daysRes, accRes] = await Promise.all([
        apiClient.getSummary(cutoffTime),
        apiClient.getDays(cutoffTime),
        apiClient.getAccuracy(cutoffTime),
      ]);

      setSummaryData(sumRes);
      setDaysList(daysRes.days);
      setAccuracyData(accRes);
    } catch (err: any) {
      setError(err?.message || 'Failed to load analytical summary from engine.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cutoffTime]);

  // 2. Fetch Day Detail whenever selectedDate or cutoffTime changes
  const fetchDayDetail = useCallback(async () => {
    setLoadingDayDetail(true);
    try {
      const detail = await apiClient.getDayDetail(selectedDate, cutoffTime, 'half_hourly');
      setDayDetail(detail);
    } catch (err: any) {
      console.error('Error fetching day detail:', err);
    } finally {
      setLoadingDayDetail(false);
    }
  }, [selectedDate, cutoffTime]);

  useEffect(() => {
    fetchGlobalData();
  }, [fetchGlobalData]);

  useEffect(() => {
    fetchDayDetail();
  }, [fetchDayDetail]);

  const cutoffPresets = [
    { label: '07:30 UTC', value: '07:30' },
    { label: '09:00 UTC (EPEX / N2EX Default)', value: '09:00' },
    { label: '09:30 UTC (N2EX Late)', value: '09:30' },
    { label: '12:00 UTC (EU SDAC)', value: '12:00' },
    { label: '15:00 UTC (Afternoon)', value: '15:00' },
  ];

  return (
    <div className="app-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', color: '#000000' }}>
      {/* Global Header */}
      <header
        style={{
          borderBottom: '1px solid #e0e0e0',
          backgroundColor: '#ffffff',
          padding: '1rem 2rem',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Brand & Context */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ width: '9px', height: '9px', backgroundColor: '#000000', borderRadius: '50%' }} />
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#000000' }}>
                GB Wholesale Day-Ahead Wind Forecast Accuracy Portal
              </h1>
            </div>
            <p style={{ margin: '0.2rem 0 0 1.2rem', fontSize: '0.8rem', color: '#666666' }}>
              Empirical decision support for UK electricity procurement (January 2026 delivery days).
            </p>
          </div>

          {/* Global Cutoff Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f5f5f5', padding: '0.35rem 0.75rem', border: '1px solid #cccccc' }}>
              <Clock size={15} color="#000000" />
              <label htmlFor="cutoff-select" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                D-1 Decision Cutoff:
              </label>
              <select
                id="cutoff-select"
                value={cutoffTime}
                onChange={(e) => setCutoffTime(e.target.value)}
                style={{
                  padding: '0.25rem 0.5rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  border: '1px solid #000000',
                  cursor: 'pointer',
                }}
              >
                {cutoffPresets.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => fetchGlobalData(true)}
              disabled={refreshing}
              title="Refresh data from engine"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.45rem 0.8rem',
                backgroundColor: '#ffffff',
                color: '#000000',
                border: '1px solid #000000',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: refreshing ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'spinning' : ''} />
              {refreshing ? 'Updating...' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* 3-Page Decision Tabs */}
        <div style={{ maxWidth: '1440px', margin: '1rem auto 0 auto', borderTop: '1px solid #eeeeee', paddingTop: '0.75rem' }}>
          <nav style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* Page 1 Button */}
            <button
              type="button"
              onClick={() => setActivePage('accuracy')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '0.65rem 1.25rem',
                backgroundColor: activePage === 'accuracy' ? '#000000' : '#ffffff',
                color: activePage === 'accuracy' ? '#ffffff' : '#000000',
                border: '1px solid #000000',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: '240px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                <BarChart2 size={16} />
                1. Accuracy (The Evidence)
              </div>
              <span style={{ fontSize: '0.75rem', opacity: activePage === 'accuracy' ? 0.85 : 0.65, marginTop: '0.15rem' }}>
                "How good were the forecasts?"
              </span>
            </button>

            {/* Page 2 Button */}
            <button
              type="button"
              onClick={() => setActivePage('replay')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '0.65rem 1.25rem',
                backgroundColor: activePage === 'replay' ? '#000000' : '#ffffff',
                color: activePage === 'replay' ? '#ffffff' : '#000000',
                border: '1px solid #000000',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: '240px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                <Clock size={16} />
                2. Decision Replay (The Trader's View)
              </div>
              <span style={{ fontSize: '0.75rem', opacity: activePage === 'replay' ? 0.85 : 0.65, marginTop: '0.15rem' }}>
                "What did the trader see on D-1?"
              </span>
            </button>

            {/* Page 3 Button */}
            <button
              type="button"
              onClick={() => setActivePage('buy-range')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '0.65rem 1.25rem',
                backgroundColor: activePage === 'buy-range' ? '#000000' : '#ffffff',
                color: activePage === 'buy-range' ? '#ffffff' : '#000000',
                border: '1px solid #000000',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: '240px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                <ShoppingCart size={16} />
                3. Buy Range (The Recommendation)
              </div>
              <span style={{ fontSize: '0.75rem', opacity: activePage === 'buy-range' ? 0.85 : 0.65, marginTop: '0.15rem' }}>
                "What should we plan to buy?"
              </span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Page Content */}
      <main style={{ flex: 1, padding: '2rem', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {error && (
          <div style={{ padding: '1rem', backgroundColor: '#fff', border: '2px solid #d32f2f', color: '#d32f2f', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#666666', fontSize: '1rem' }}>
            Loading analytical dataset from Parquet store...
          </div>
        ) : (
          <>
            {/* Page 1: Accuracy (The Evidence) */}
            {activePage === 'accuracy' && (
              <Page1Accuracy
                summary={summaryData}
                accuracy={accuracyData}
                days={daysList}
                selectedDate={selectedDate}
                onSelectDate={(newDate) => {
                  setSelectedDate(newDate);
                  setActivePage('replay');
                }}
                dayDetail={dayDetail}
                isLoadingDayDetail={loadingDayDetail}
              />
            )}

            {/* Page 2: Decision Replay (The Trader's View) */}
            {activePage === 'replay' && (
              <Page2DecisionReplay
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                cutoffTime={cutoffTime}
                dayDetail={dayDetail}
                isLoading={loadingDayDetail}
                days={daysList}
                summary={summaryData}
                demandMw={demandMw}
                onDemandChange={setDemandMw}
                onNavigateToPage3={() => setActivePage('buy-range')}
              />
            )}

            {/* Page 3: Buy Range (The Recommendation) */}
            {activePage === 'buy-range' && (
              <Page3BuyRange
                selectedDate={selectedDate}
                cutoffTime={cutoffTime}
                demandMw={demandMw}
                onDemandChange={setDemandMw}
                onNavigateToPage2={() => setActivePage('replay')}
              />
            )}

            {/* Secondary Details Section (Collapsed by Default) */}
            <DetailsSection
              dayDetail={dayDetail}
              selectedDate={selectedDate}
              cutoffTime={cutoffTime}
              summary={summaryData}
              onSelectDay={(d) => {
                setSelectedDate(d);
                setActivePage('replay');
              }}
            />
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #e0e0e0', padding: '1.5rem 2rem', backgroundColor: '#ffffff', fontSize: '0.8rem', color: '#666666' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            Data Sources: Elexon BMRS <code style={{ color: '#000000' }}>WINDFOR/stream</code> (Hourly Forecasts) and <code style={{ color: '#000000' }}>FUELHH/stream</code> (Half-Hourly WIND Actuals).
          </div>
          <div>
            Replay Mode: January 2026 Delivery | Decision Cutoff: {cutoffTime} UTC (D-1) | Strict Zero Look-Ahead Bias
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;

