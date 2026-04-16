import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import TickerSearch from '../components/TickerSearch';
import SnapshotCard from '../components/SnapshotCard';
import TopPairs from '../components/TopPairs';

import { httpError } from '../utils/httpError';

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const FAMOUS_BREAKOUTS = [
  { ticker: 'CLS',  date: '2023-12-01', label: 'Celestica',   gain: '+490%',  period: 'Dec 2023' },
  { ticker: 'NVDA', date: '2023-01-03', label: 'NVIDIA',      gain: '+800%',  period: 'Jan 2023' },
  { ticker: 'SMCI', date: '2023-06-01', label: 'Super Micro', gain: '+320%',  period: 'Jun 2023' },
  { ticker: 'PLTR', date: '2023-05-01', label: 'Palantir',    gain: '+350%',  period: 'May 2023' },
  { ticker: 'META', date: '2023-02-01', label: 'Meta',         gain: '+430%',  period: 'Feb 2023' },
  { ticker: 'AVGO', date: '2023-06-01', label: 'Broadcom',    gain: '+180%',  period: 'Jun 2023' },
];

export default function TemplatePicker() {
  const navigate = useNavigate();
  const [ticker, setTicker] = useState('');
  const [date, setDate] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverReady, setServerReady] = useState(true);
  const [stockCount, setStockCount] = useState(0);
  const [dateRange, setDateRange] = useState(null);
  const [dateRangeLoading, setDateRangeLoading] = useState(false);
  const pollRef = useRef(null);
  const pollCountRef = useRef(0);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const dateRangeAbort = useRef(null);

  const [blendMode, setBlendMode] = useState(false);
  const [blendTemplates, setBlendTemplates] = useState([]);
  const [blendLoading, setBlendLoading] = useState(false);

  // Rotating hero breakout
  const [activeBreakout, setActiveBreakout] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFadeIn(false);
      setTimeout(() => {
        setActiveBreakout(prev => (prev + 1) % FAMOUS_BREAKOUTS.length);
        setFadeIn(true);
      }, 300);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

  const MAX_POLLS = 40;
  useEffect(() => {
    async function checkStatus() {
      pollCountRef.current += 1;
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data = await res.json();
        setServerReady(data.ready);
        setStockCount(data.stockCount ?? 0);
        if (data.ready && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {}
      if (!pollRef.current) return;
      if (pollCountRef.current >= MAX_POLLS) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setPollTimedOut(true);
      }
    }
    checkStatus();
    pollRef.current = setInterval(checkStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function fetchDateRange(sym) {
    if (!sym || sym.trim().length === 0) { setDateRange(null); return; }
    if (dateRangeAbort.current) dateRangeAbort.current.abort();
    const controller = new AbortController();
    dateRangeAbort.current = controller;
    setDateRangeLoading(true);
    setDateRange(null);
    setDate('');
    try {
      const res = await fetch(`/api/snapshot/date-range?ticker=${encodeURIComponent(sym)}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch date range');
      const data = await res.json();
      setDateRange(data);
    } catch (err) {
      if (err.name !== 'AbortError') setDateRange(null);
    } finally {
      setDateRangeLoading(false);
    }
  }

  function handleTickerChange(val) {
    setTicker(val);
    setSnapshot(null);
    setError(null);
    if (/^[A-Za-z0-9.]{1,10}$/.test(val)) {
      fetchDateRange(val);
    } else {
      setDateRange(null);
      setDate('');
    }
  }

  const datePickerReady = !!(dateRange && dateRange.earliestDate && !dateRangeLoading);
  const hasValidTicker = /^[A-Za-z0-9.]{1,10}$/.test(ticker);

  function isDateValid(d) {
    if (!d || !dateRange?.earliestDate) return false;
    return d >= dateRange.earliestDate && d <= yesterday();
  }

  const canLoadSnapshot = !loading && hasValidTicker && date && isDateValid(date);

  async function loadSnapshot(overrideTicker, overrideDate, { autoNavigate = false } = {}) {
    const t = overrideTicker || ticker;
    const d = overrideDate || date;
    if (!t.trim()) { setError('Enter a stock ticker'); return; }
    if (!d) { setError('Select a date'); return; }
    setError(null);
    setLoading(true);
    setSnapshot(null);
    try {
      const res = await fetch(`/api/snapshot?ticker=${encodeURIComponent(t)}&date=${d}`);
      if (!res.ok) throw new Error(await httpError(res, 'Failed to load snapshot'));
      const data = await res.json();
      setSnapshot(data);
      if (autoNavigate) {
        navigate(`/matches?ticker=${encodeURIComponent(data.ticker)}&date=${data.date}`, { state: { snapshot: data } });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function addToBlend() {
    if (!snapshot) return;
    if (blendTemplates.length >= 5) return;
    if (blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date)) return;
    setBlendTemplates([...blendTemplates, { ticker: snapshot.ticker, date: snapshot.date, companyName: snapshot.companyName }]);
    setSnapshot(null);
    setTicker('');
    setDate('');
    setDateRange(null);
  }

  function removeFromBlend(idx) {
    setBlendTemplates(blendTemplates.filter((_, i) => i !== idx));
  }

  async function runBlend() {
    if (blendTemplates.length < 2) return;
    setBlendLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/blend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: blendTemplates }),
      });
      if (!res.ok) throw new Error(await httpError(res, 'Blend failed'));
      const composite = await res.json();
      navigate(`/matches?ticker=${encodeURIComponent(composite.ticker)}&date=${composite.date}`, { state: { snapshot: composite } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBlendLoading(false);
    }
  }

  function goToMatches() {
    if (!snapshot) return;
    navigate(`/matches?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}`, { state: { snapshot } });
  }

  const currentBreakout = FAMOUS_BREAKOUTS[activeBreakout];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 animate-fade-in">
      {/* Warm-up banner */}
      {!serverReady && !pollTimedOut && (
        <div className="mt-3 flex items-center gap-3 px-4 py-2.5 rounded-xl text-amber-400 text-xs sm:text-sm animate-fade-in" style={{
          background: 'rgba(245, 158, 11, 0.06)',
          border: '1px solid rgba(245, 158, 11, 0.1)',
        }}>
          <span className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin shrink-0" />
          <span>Warming up — {stockCount.toLocaleString()} stocks loaded. Matches ready shortly.</span>
        </div>
      )}
      {!serverReady && pollTimedOut && (
        <div className="mt-3 flex items-center gap-3 px-4 py-2.5 rounded-xl text-red-400 text-xs sm:text-sm animate-fade-in" style={{
          background: 'rgba(239, 68, 68, 0.06)',
          border: '1px solid rgba(239, 68, 68, 0.1)',
        }}>
          <span>Server is taking longer than expected.</span>
          <button
            className="ml-auto shrink-0 text-xs underline hover:text-red-300 transition-colors"
            onClick={() => {
              setPollTimedOut(false);
              pollCountRef.current = 0;
              pollRef.current = setInterval(async () => {
                pollCountRef.current += 1;
                try {
                  const res = await fetch('/api/status');
                  if (!res.ok) return;
                  const data = await res.json();
                  setServerReady(data.ready);
                  setStockCount(data.stockCount ?? 0);
                  if (data.ready && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                } catch {}
                if (pollCountRef.current >= MAX_POLLS && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; setPollTimedOut(true); }
              }, 3000);
            }}
          >Retry</button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* HERO — Centered social proof layout             */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="max-w-3xl mx-auto pt-10 sm:pt-16 lg:pt-20 pb-8">

        {/* Rotating gain number + context */}
        {!snapshot && (
          <div className="text-center mb-8 sm:mb-10">
            <div style={{ minHeight: '120px' }} className="flex flex-col items-center justify-center">
              <p
                className="font-mono font-bold text-gain leading-none"
                style={{
                  fontSize: 'clamp(3.5rem, 10vw, 6rem)',
                  opacity: fadeIn ? 1 : 0,
                  transform: fadeIn ? 'translateY(0)' : 'translateY(4px)',
                  transition: 'opacity 0.3s ease, transform 0.3s ease',
                }}
              >
                {currentBreakout.gain}
              </p>
              <p
                className="text-text-secondary text-sm sm:text-base mt-2 font-light"
                style={{
                  opacity: fadeIn ? 1 : 0,
                  transform: fadeIn ? 'translateY(0)' : 'translateY(4px)',
                  transition: 'opacity 0.3s ease, transform 0.3s ease',
                }}
              >
                {currentBreakout.label} matched our profile in {currentBreakout.period}
              </p>
            </div>
          </div>
        )}

        {/* Search bar */}
        {!snapshot && (
          <div className="mb-4">
            {/* Blend chips (when in blend mode) */}
            {blendMode && blendTemplates.length > 0 && (
              <div className="mb-4 pb-4 border-b border-border">
                <div className="flex flex-wrap gap-2 mb-3">
                  {blendTemplates.map((t, i) => (
                    <div key={`${t.ticker}-${t.date}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/15">
                      <span className="font-mono font-bold text-sm text-brand">{t.ticker}</span>
                      <span className="text-xs text-text-muted">{t.date}</span>
                      <button className="text-text-muted hover:text-red-400 transition-colors ml-1" onClick={() => removeFromBlend(i)}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
                {blendTemplates.length >= 2 && (
                  <button className="btn-primary w-full text-sm" onClick={runBlend} disabled={blendLoading}>
                    {blendLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
                        Blending...
                      </span>
                    ) : `Blend ${blendTemplates.length} Templates`}
                  </button>
                )}
                {blendTemplates.length < 2 && (
                  <p className="text-xs text-text-muted text-center">Add at least 2 templates to blend</p>
                )}
              </div>
            )}

            {/* Horizontal search row */}
            <div className="flex flex-col sm:flex-row gap-3 sm:items-stretch">
              <div className="flex-1">
                <TickerSearch
                  value={ticker}
                  onChange={handleTickerChange}
                  onSelect={handleTickerChange}
                />
              </div>
              <div className="sm:w-40">
                <input
                  type="date"
                  className={`input-field w-full h-full ${!datePickerReady ? 'opacity-30 cursor-not-allowed' : ''}`}
                  placeholder="Pick a date"
                  value={date}
                  min={dateRange?.earliestDate || ''}
                  max={yesterday()}
                  disabled={!datePickerReady}
                  onChange={e => {
                    const val = e.target.value;
                    if (dateRange?.earliestDate && val < dateRange.earliestDate) return;
                    setDate(val);
                  }}
                />
              </div>
              <button
                className="btn-primary whitespace-nowrap"
                onClick={() => loadSnapshot(null, null, { autoNavigate: true })}
                disabled={!canLoadSnapshot}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
                  </span>
                ) : (
                  <>
                    <svg className="inline-block w-4 h-4 mr-1.5 -mt-0.5" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    Scan
                  </>
                )}
              </button>
            </div>

            {/* Date shortcuts + validation */}
            {datePickerReady && !dateRangeLoading && (
              <div className="flex gap-1.5 mt-2">
                {[
                  { label: '6mo', months: 6 },
                  { label: '1yr', months: 12 },
                  { label: '2yr', months: 24 },
                  { label: '3yr', months: 36 },
                ].map(({ label, months }) => {
                  const d = new Date();
                  d.setMonth(d.getMonth() - months);
                  const dateStr = d.toISOString().slice(0, 10);
                  const earliest = dateRange?.earliestDate;
                  const disabled = earliest && dateStr < earliest;
                  return (
                    <button
                      key={label}
                      className={`text-[10px] px-2.5 py-1 rounded-lg transition-all duration-150 ${
                        disabled ? 'text-text-muted/20 cursor-not-allowed'
                          : date === dateStr ? 'bg-brand/15 text-brand' : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                      }`}
                      style={date === dateStr ? { border: '1px solid rgba(201,168,76,0.2)' } : { border: '1px solid transparent' }}
                      disabled={disabled}
                      onClick={() => setDate(dateStr)}
                    >
                      {label} ago
                    </button>
                  );
                })}
              </div>
            )}
            {dateRangeLoading && (
              <p className="text-[10px] text-text-muted mt-1.5 flex items-center gap-1">
                <span className="w-2.5 h-2.5 border border-text-muted/50 border-t-text-secondary rounded-full animate-spin" />
                Checking dates...
              </p>
            )}
            {dateRange && !dateRangeLoading && dateRange.earliestDate && (
              <p className="text-[10px] text-text-muted/50 mt-1.5">
                Data from <span className="text-text-muted">{dateRange.earliestDate}</span>
                {!dateRange.hasFullData && dateRange.message && (
                  <span className="text-amber-500/60 ml-2">{dateRange.message}</span>
                )}
              </p>
            )}
            {dateRange && !dateRangeLoading && !dateRange.earliestDate && (
              <p className="text-[10px] text-red-400/80 mt-1.5">No data for {ticker.toUpperCase()}</p>
            )}
            {error && <p className="mt-2 text-red-400 text-sm">{error}</p>}
          </div>
        )}

        {/* Quick-pick chips */}
        {!snapshot && !blendMode && (
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {FAMOUS_BREAKOUTS.map((s, i) => (
              <button
                key={s.ticker}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono transition-all duration-200 ${
                  i === activeBreakout
                    ? 'border-brand text-text-primary bg-brand/10'
                    : 'border-border text-text-secondary hover:border-brand/40 hover:text-text-primary hover:bg-surface-hover'
                }`}
                style={{ border: '1px solid' }}
                onClick={() => {
                  handleTickerChange(s.ticker);
                  setDate(s.date);
                  loadSnapshot(s.ticker, s.date, { autoNavigate: true });
                }}
              >
                <span className="font-bold">{s.ticker}</span>
                <span className="text-gain text-xs font-semibold">{s.gain}</span>
              </button>
            ))}
          </div>
        )}

        {/* Multi-blend toggle link */}
        {!snapshot && !blendMode && (
          <p className="text-center mt-3">
            <button
              className="text-xs text-text-muted hover:text-brand transition-colors"
              onClick={() => { setBlendMode(true); setSnapshot(null); }}
            >
              Or try multi-blend &rarr;
            </button>
          </p>
        )}

        {/* Blend mode header */}
        {!snapshot && blendMode && (
          <p className="text-center mt-3">
            <button
              className="text-xs text-text-muted hover:text-brand transition-colors"
              onClick={() => { setBlendMode(false); setBlendTemplates([]); }}
            >
              &larr; Back to single mode
            </button>
          </p>
        )}

        {/* Snapshot card */}
        {snapshot && (
          <div className="animate-fade-in-up">
            <SnapshotCard snapshot={snapshot} />
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              {blendMode ? (
                <>
                  <button className="btn-primary flex-1 text-center text-sm" onClick={addToBlend}
                    disabled={blendTemplates.length >= 5 || blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date)}
                  >
                    {blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date) ? 'Already added' : `Add ${snapshot.ticker} to Blend`}
                  </button>
                  <button className="btn-secondary flex-1 text-center text-sm" onClick={goToMatches}>Use solo instead &rarr;</button>
                </>
              ) : (
                <button className="btn-primary w-full text-center text-sm sm:text-base group" onClick={goToMatches}>
                  <span className="flex items-center justify-center gap-2">
                    Find Stocks That Match This Profile
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Breakout candidates */}
      {serverReady && <TopPairs />}
    </main>
  );
}
