import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import TickerSearch from '../components/TickerSearch';
import SnapshotCard from '../components/SnapshotCard';
import TopPairs from '../components/TopPairs';

import { httpError } from '../utils/httpError';

// Yesterday as YYYY-MM-DD (max date for picker)
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Example breakout stocks — used as quick-pick template suggestions
const FAMOUS_BREAKOUTS = [
  { ticker: 'CLS',  date: '2023-12-01', label: 'Celestica',   gain: '+490%',  period: 'Dec 2023', color: '#22c55e' },
  { ticker: 'NVDA', date: '2023-01-03', label: 'NVIDIA',      gain: '+800%',  period: 'Jan 2023', color: '#22c55e' },
  { ticker: 'SMCI', date: '2023-06-01', label: 'Super Micro', gain: '+320%',  period: 'Jun 2023', color: '#22c55e' },
  { ticker: 'PLTR', date: '2023-05-01', label: 'Palantir',    gain: '+350%',  period: 'May 2023', color: '#22c55e' },
  { ticker: 'META', date: '2023-02-01', label: 'Meta',         gain: '+430%',  period: 'Feb 2023', color: '#22c55e' },
  { ticker: 'AVGO', date: '2023-06-01', label: 'Broadcom',    gain: '+180%',  period: 'Jun 2023', color: '#22c55e' },
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

  // Multi-template blend mode
  const [blendMode, setBlendMode] = useState(false);
  const [blendTemplates, setBlendTemplates] = useState([]);
  const [blendLoading, setBlendLoading] = useState(false);

  // Animated counter for hero stat
  const [animatedCount, setAnimatedCount] = useState(0);
  useEffect(() => {
    const target = stockCount || 3549;
    const duration = 1200;
    const steps = 30;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setAnimatedCount(target);
        clearInterval(timer);
      } else {
        setAnimatedCount(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [stockCount]);

  // Poll /api/status until the universe cache is ready
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

  // Fetch date range when ticker changes
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
    setBlendTemplates([...blendTemplates, {
      ticker: snapshot.ticker,
      date: snapshot.date,
      companyName: snapshot.companyName,
    }]);
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


  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6">
      {/* Warm-up banner */}
      {!serverReady && !pollTimedOut && (
        <div className="mt-4 flex items-center gap-3 px-3 sm:px-4 py-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400 text-xs sm:text-sm animate-fade-in">
          <span className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin shrink-0" />
          <span>
            Server warming up — {stockCount.toLocaleString()} stocks loaded so far.
            Snapshot lookups work now; match results will be ready shortly.
          </span>
        </div>
      )}
      {!serverReady && pollTimedOut && (
        <div className="mt-4 flex items-center gap-3 px-3 sm:px-4 py-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-xs sm:text-sm animate-fade-in">
          <span>Server is taking longer than expected to load.</span>
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
                  if (data.ready && pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                  }
                } catch {}
                if (pollCountRef.current >= MAX_POLLS && pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                  setPollTimedOut(true);
                }
              }, 3000);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* HERO — Compact, search-first layout                */}
      {/* ════════════════════════════════════════════════════ */}
      <div className="pt-8 sm:pt-14 pb-4 animate-fade-in-up">
        {/* Tagline */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-display text-warm-white mb-3 leading-tight">
            Find the next <span className="text-accent italic">breakout stock</span>
          </h1>
          <p className="text-warm-gray text-sm sm:text-base max-w-lg mx-auto font-light leading-relaxed">
            Pick a stock that already broke out. Blueprint scans {animatedCount.toLocaleString()} stocks
            to find the ones that look like it today.
          </p>
        </div>

        {/* ── Inline search ── */}
        <div className="hero-search-card mb-4 animate-fade-in-up-delay">
          {/* Mode toggle — minimal */}
          <div className="flex items-center gap-2 mb-4">
            <button
              className={`text-xs px-3 py-1 rounded-full border transition-all duration-200 ${!blendMode ? 'border-accent/40 bg-accent/10 text-accent' : 'border-dark-border text-warm-muted hover:text-warm-gray'}`}
              onClick={() => { setBlendMode(false); setBlendTemplates([]); }}
            >
              Single
            </button>
            <button
              className={`text-xs px-3 py-1 rounded-full border transition-all duration-200 ${blendMode ? 'border-accent/40 bg-accent/10 text-accent' : 'border-dark-border text-warm-muted hover:text-warm-gray'}`}
              onClick={() => { setBlendMode(true); setSnapshot(null); }}
            >
              Multi-blend
            </button>
            <div className="ml-auto flex items-center gap-3">
              <span className="hero-stat">
                <span className="hero-stat-value">28</span>
                <span className="hero-stat-label">metrics</span>
              </span>
              <span className="hero-stat">
                <span className="hero-stat-value">5</span>
                <span className="hero-stat-label">strategies</span>
              </span>
            </div>
          </div>

          {/* Blend template chips */}
          {blendMode && blendTemplates.length > 0 && (
            <div className="mb-3 pb-3 border-b border-dark-border/50">
              <div className="flex flex-wrap gap-2 mb-2">
                {blendTemplates.map((t, i) => (
                  <div key={`${t.ticker}-${t.date}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-accent/20 bg-accent/5">
                    <span className="font-mono font-bold text-sm text-accent">{t.ticker}</span>
                    <span className="text-xs text-warm-muted">{t.date}</span>
                    <button className="text-warm-muted hover:text-red-400 transition-colors ml-1" onClick={() => removeFromBlend(i)} title="Remove">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                ))}
              </div>
              {blendTemplates.length >= 2 && (
                <button className="btn-primary w-full text-sm py-2.5" onClick={runBlend} disabled={blendLoading}>
                  {blendLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-dark-bg/30 border-t-dark-bg rounded-full animate-spin" />
                      Blending...
                    </span>
                  ) : `Blend ${blendTemplates.length} Templates & Find Matches`}
                </button>
              )}
              {blendTemplates.length < 2 && (
                <p className="text-xs text-warm-muted text-center">Add at least 2 templates to blend</p>
              )}
            </div>
          )}

          {/* Search row */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="block text-xs text-warm-muted mb-1.5 uppercase tracking-wider font-medium">
                {blendMode ? `Template ${blendTemplates.length + 1}` : 'Stock Ticker'}
              </label>
              <TickerSearch value={ticker} onChange={handleTickerChange} onSelect={handleTickerChange} />
            </div>
            <div className="sm:w-44">
              <label className="block text-xs text-warm-muted mb-1.5 uppercase tracking-wider font-medium">Snapshot Date</label>
              <input
                type="date"
                className={`input-field w-full ${!datePickerReady ? 'opacity-30 cursor-not-allowed' : ''}`}
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
              {dateRangeLoading && (
                <p className="text-[10px] text-warm-muted mt-1 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 border border-warm-muted/50 border-t-warm-gray rounded-full animate-spin" />
                  Checking dates…
                </p>
              )}
              {dateRange && !dateRangeLoading && dateRange.earliestDate && (
                <p className="text-[10px] text-warm-muted mt-1">
                  From <span className="text-warm-gray">{dateRange.earliestDate}</span>
                  {!dateRange.hasFullData && dateRange.message && (
                    <span className="block text-amber-500/80 mt-0.5">{dateRange.message}</span>
                  )}
                </p>
              )}
              {dateRange && !dateRangeLoading && !dateRange.earliestDate && (
                <p className="text-[10px] text-red-400/80 mt-1">No data for {ticker.toUpperCase()}</p>
              )}
            </div>
            <button
              className="btn-primary whitespace-nowrap sm:w-auto"
              onClick={() => loadSnapshot(null, null, { autoNavigate: true })}
              disabled={!canLoadSnapshot}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-dark-bg/30 border-t-dark-bg rounded-full animate-spin" />
                  Loading…
                </span>
              ) : (
                <>
                  <svg className="inline-block w-4 h-4 mr-1.5 -mt-0.5" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Scan
                </>
              )}
            </button>
          </div>
          {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
        </div>

        {/* ── Famous breakouts — rich cards ── */}
        {!ticker && !snapshot && (
          <div className="mb-2 animate-fade-in-up-delay-2">
            <p className="text-xs text-warm-muted text-center mb-3 uppercase tracking-wider font-medium">Or try a famous breakout</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {FAMOUS_BREAKOUTS.map(s => (
                <button
                  key={s.ticker}
                  className="breakout-card group"
                  onClick={() => {
                    handleTickerChange(s.ticker);
                    setDate(s.date);
                    loadSnapshot(s.ticker, s.date, { autoNavigate: true });
                  }}
                >
                  <span className="font-mono font-bold text-base text-warm-white group-hover:text-accent transition-colors duration-200">{s.ticker}</span>
                  <span className="block text-[10px] text-warm-muted font-light mt-0.5">{s.label}</span>
                  <span className="block text-xs font-mono font-semibold text-emerald-400 mt-1.5">{s.gain}</span>
                  <span className="block text-[9px] text-warm-muted">{s.period}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Snapshot card */}
      {snapshot && (
        <div className="animate-fade-in-up">
          <SnapshotCard snapshot={snapshot} />
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {blendMode ? (
              <>
                <button
                  className="btn-primary flex-1 text-center text-sm py-3"
                  onClick={addToBlend}
                  disabled={blendTemplates.length >= 5 || blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date)}
                >
                  {blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date)
                    ? 'Already added'
                    : `Add ${snapshot.ticker} to Blend`}
                </button>
                <button className="btn-secondary flex-1 text-center text-sm py-3" onClick={goToMatches}>
                  Use solo instead →
                </button>
              </>
            ) : (
              <button className="btn-primary w-full text-center text-sm sm:text-base py-3 sm:py-4 group" onClick={goToMatches}>
                <span className="flex items-center justify-center gap-2">
                  Find Stocks That Match This Profile
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* HOW IT WORKS — Compact 3-step inline               */}
      {/* ════════════════════════════════════════════════════ */}
      {!snapshot && (
        <div className="mt-12 mb-4 animate-fade-in-up-delay-3">
          <div className="divider-gold mb-8" />
          <h2 className="text-lg font-display text-warm-white text-center mb-6">How Blueprint Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                step: '01',
                title: 'Pick a winner',
                desc: 'Choose a stock that broke out and the date before it ran.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="#c9a84c" strokeWidth="1.2"/><path d="M10 6v4l3 2" stroke="#c9a84c" strokeWidth="1.2" strokeLinecap="round"/></svg>
                ),
              },
              {
                step: '02',
                title: 'Find matches',
                desc: 'Blueprint scans thousands of stocks for financial lookalikes.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5" stroke="#c9a84c" strokeWidth="1.2"/><path d="M12.5 12.5L17 17" stroke="#c9a84c" strokeWidth="1.2" strokeLinecap="round"/></svg>
                ),
              },
              {
                step: '03',
                title: 'Validate & track',
                desc: 'Backtest results against SPY, compare metrics, build your watchlist.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 14l4-4 3 3 7-9" stroke="#22c55e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                ),
              },
            ].map(item => (
              <div key={item.step} className="card text-center py-5 px-4">
                <div className="flex items-center justify-center gap-2 mb-2">
                  {item.icon}
                  <span className="text-[10px] text-warm-muted font-mono tracking-widest">{item.step}</span>
                </div>
                <p className="text-sm font-semibold text-warm-white mb-1">{item.title}</p>
                <p className="text-xs text-warm-gray leading-relaxed font-light">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* METHODOLOGY — How it works section                    */}
      {/* ════════════════════════════════════════════════════ */}
      {!snapshot && (
        <div className="my-10 animate-fade-in-up-delay-3">
          <div className="divider-gold mb-8" />
          <div className="text-center mb-6">
            <h2 className="text-lg font-display text-warm-white mb-1">How Blueprint Works</h2>
            <p className="text-sm text-warm-gray font-light">Multi-metric similarity matching calibrated against historical breakout profiles</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { value: '28', label: 'Comparison metrics', detail: 'Valuation, growth, profitability, momentum' },
              { value: '8', label: 'Similarity functions', detail: 'Log-scale, sector-relative, directional' },
              { value: '5', label: 'Strategy profiles', detail: 'Growth, value, momentum, quality, GARP' },
              { value: '<5min', label: 'Universe refresh', detail: 'Live data across all stocks' },
            ].map(stat => (
              <div key={stat.label} className="card text-center py-4 px-3 hover:border-dark-border-hover transition-all duration-200 group">
                <p className="text-xl sm:text-2xl font-mono font-bold text-accent group-hover:text-accent-light transition-colors">{stat.value}</p>
                <p className="text-xs font-medium text-warm-white mt-1">{stat.label}</p>
                <p className="text-[10px] text-warm-muted mt-0.5 font-light">{stat.detail}</p>
              </div>
            ))}
          </div>

          {/* Feature pills — compact */}
          <div className="flex flex-wrap justify-center gap-2 mt-6">
            {[
              'Sector-relative scoring',
              'Momentum matching',
              'Forward backtesting vs SPY',
              'Data coverage tracking',
              'CSV export',
              'Multi-template blending',
            ].map(f => (
              <span key={f} className="text-[10px] text-warm-muted border border-dark-border/50 rounded-full px-3 py-1 hover:border-dark-border-hover hover:text-warm-gray transition-all duration-200">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top pairs / Breakout Candidates */}
      {serverReady && <TopPairs />}
    </main>
  );
}
