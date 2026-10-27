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
import {
  PRIMARY_COLOR,
  DEFAULT_PAGE,
  DEFAULT_CUTOFF_TIME,
  DEFAULT_SELECTED_DATE,
  DEFAULT_DEMAND_MW,
} from './store';
import {
  BarChart2,
  Clock,
  ShoppingCart,
  AlertCircle,
  Calendar,
} from 'lucide-react';

type PageId = 'accuracy' | 'replay' | 'buy-range';

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<PageId>(DEFAULT_PAGE);
  const cutoffTime = DEFAULT_CUTOFF_TIME;
  const [selectedDate, setSelectedDate] = useState<string>(DEFAULT_SELECTED_DATE);
  const [demandMw, setDemandMw] = useState<number | null>(DEFAULT_DEMAND_MW);

  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [daysList, setDaysList] = useState<DaySummaryItem[]>([]);
  const [accuracyData, setAccuracyData] = useState<AccuracyResponse | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetailResponse | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadingDayDetail, setLoadingDayDetail] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGlobalData = useCallback(async () => {
    setLoading(true);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load analytical summary from engine.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [cutoffTime]);

  const fetchDayDetail = useCallback(async () => {
    setLoadingDayDetail(true);
    try {
      const detail = await apiClient.getDayDetail(selectedDate, cutoffTime, 'half_hourly');
      setDayDetail(detail);
    } catch (err: unknown) {
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

  return (
    <div className="app-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', color: '#000000' }}>
      <header
        style={{
          borderBottom: '1px solid #e0e0e0',
          backgroundColor: '#ffffff',
          padding: '0.85rem 1rem',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ maxWidth: '1440px', margin: '0 auto' }}>
          <nav style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setActivePage('accuracy')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '0.65rem 1.25rem',
                backgroundColor: activePage === 'accuracy' ? PRIMARY_COLOR : '#ffffff',
                color: activePage === 'accuracy' ? '#ffffff' : '#000000',
                border: `1px solid ${activePage === 'accuracy' ? PRIMARY_COLOR : '#000000'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: '240px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                <BarChart2 size={16} />
                1. Accuracy
              </div>
            </button>

            <button
              type="button"
              onClick={() => setActivePage('replay')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '0.65rem 1.25rem',
                backgroundColor: activePage === 'replay' ? PRIMARY_COLOR : '#ffffff',
                color: activePage === 'replay' ? '#ffffff' : '#000000',
                border: `1px solid ${activePage === 'replay' ? PRIMARY_COLOR : '#000000'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: '240px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                <Clock size={16} />
                2. Decision Replay
              </div>
            </button>

            <button
              type="button"
              onClick={() => setActivePage('buy-range')}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '0.65rem 1.25rem',
                backgroundColor: activePage === 'buy-range' ? PRIMARY_COLOR : '#ffffff',
                color: activePage === 'buy-range' ? '#ffffff' : '#000000',
                border: `1px solid ${activePage === 'buy-range' ? PRIMARY_COLOR : '#000000'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                textAlign: 'left',
                minWidth: '240px',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                <ShoppingCart size={16} />
                3. Buy Range
              </div>
            </button>
          </nav>
        </div>
      </header>

      <main style={{ flex: 1, padding: '1rem', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {error && (
          <div style={{ padding: '1rem', backgroundColor: '#fff', border: '2px solid #d32f2f', borderRadius: '8px', color: '#d32f2f', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {activePage !== 'buy-range' && (
          <section
            style={{
              background: '#ffffff',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              padding: '0.85rem 1.25rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  backgroundColor: '#e8f5ec',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Calendar size={18} color={PRIMARY_COLOR} />
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#666666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Simulation Day
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#000000' }}>
                  Select a day
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#555555' }}>
                Day:
              </span>
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  padding: '0.45rem 1rem',
                  fontSize: '13px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: `1.5px solid white`,
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {Array.from({ length: 31 }, (_, i) => {
                  const dayStr = String(i + 1).padStart(2, '0');
                  const fullDate = `2026-01-${dayStr}`;
                  return (
                    <option key={fullDate} value={fullDate}>
                      {i + 1} Jan 2026
                    </option>
                  );
                })}
              </select>
            </div>
          </section>
        )}

        {loading ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#666666', fontSize: '1rem' }}>
            Loading analytical dataset from Parquet store...
          </div>
        ) : (
          <>
            {activePage === 'accuracy' && (
              <Page1Accuracy
                summary={summaryData}
                accuracy={accuracyData}
                days={daysList}
                selectedDate={selectedDate}
                onSelectDate={(newDate) => {
                  setSelectedDate(newDate);
                }}
                cutoffTime={cutoffTime}
                dayDetail={dayDetail}
                isLoadingDayDetail={loadingDayDetail}
              />
            )}

            {activePage === 'replay' && (
              <Page2DecisionReplay
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                cutoffTime={cutoffTime}
              />
            )}

            {activePage === 'buy-range' && (
              <Page3BuyRange
                selectedDate={selectedDate}
                cutoffTime={cutoffTime}
                demandMw={demandMw}
                onDemandChange={setDemandMw}
                onNavigateToPage2={() => setActivePage('replay')}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default App;
