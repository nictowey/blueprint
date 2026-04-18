import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TickerSearch from '../components/TickerSearch';
import SnapshotCard from '../components/SnapshotCard';
import TopPairs from '../components/TopPairs';
import MiniSparkline from '../components/MiniSparkline';

import { httpError } from '../utils/httpError';

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const FAMOUS_BREAKOUTS = [
  { ticker: 'PLTR', date: '2023-05-01', label: 'Palantir',  gain: '+1,500%', period: 'May 2023' },
  { ticker: 'NVDA', date: '2023-01-03', label: 'NVIDIA',    gain: '+1,280%', period: 'Jan 2023' },
  { ticker: 'CLS',  date: '2023-12-01', label: 'Celestica', gain: '+1,120%', period: 'Dec 2023' },
  { ticker: 'META', date: '2023-02-01', label: 'Meta',      gain: '+340%',   period: 'Feb 2023' },
  { ticker: 'AVGO', date: '2023-06-01', label: 'Broadcom',  gain: '+360%',   period: 'Jun 2023' },
  { ticker: 'APP',  date: '2024-01-02', label: 'AppLovin',  gain: '+580%',   period: 'Jan 2024' },
];

const MODES = [
  { key: 'T', tab: 'Template Match',     sub: 'find looks-like' },
  { key: 'M', tab: 'Momentum Breakout',  sub: 'find coiling now' },
  { key: 'C', tab: 'Catalyst Driven',    sub: 'find event-driven' },
  { key: 'E', tab: 'Ensemble Consensus', sub: 'where engines agree' },
];

const VALID_MODES = new Set(['T', 'M', 'C', 'E']);

// Deterministic pseudo-sparkline for decorative cards (no network)
function makeSpark(seed, n = 22, amp = 1.6) {
  const out = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    const r = Math.sin((seed + i) * 1.13) * 0.5 + Math.cos((seed + i) * 2.7) * 0.5;
    v += r * amp + (i / n) * 1.1;
    out.push(v);
  }
  return out;
}

export default function TemplatePicker() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Mode state (URL-driven, deep-linkable)
  const modeParam = searchParams.get('mode');
  const initialMode = modeParam && VALID_MODES.has(modeParam) ? modeParam : 'T';
  const [mode, setMode] = useState(initialMode);

  // Core template state (preserved from previous implementation)
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

  // Blend state
  const [blendMode, setBlendMode] = useState(() => searchParams.get('blend') === '1');
  const [blendTemplates, setBlendTemplates] = useState([]);
  const [blendLoading, setBlendLoading] = useState(false);

  // Rotating hero headline (Template mode only)
  const [activeBreakout, setActiveBreakout] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const [breakoutGains, setBreakoutGains] = useState({});

  // Live candidate previews for template-free engines (M / C / E)
  const [engineResults, setEngineResults] = useState({});
  const [engineLoading, setEngineLoading] = useState({});

  // Sync mode → URL (replace, don't push)
  useEffect(() => {
    const cur = searchParams.get('mode');
    if (mode === 'T') {
      if (cur) {
        const next = new URLSearchParams(searchParams);
        next.delete('mode');
        setSearchParams(next, { replace: true });
      }
    } else if (cur !== mode) {
      const next = new URLSearchParams(searchParams);
      next.set('mode', mode);
      setSearchParams(next, { replace: true });
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // If user switches out of Template mode, clear blend UI but keep data
  useEffect(() => {
    if (mode !== 'T') setSnapshot(null);
  }, [mode]);

  // Rotating breakout carousel
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

  // Fetch gains for famous breakouts (sequential, FMP rate-limit friendly)
  useEffect(() => {
    let cancelled = false;
    async function fetchGains() {
      const gains = {};
      for (const b of FAMOUS_BREAKOUTS) {
        if (cancelled) return;
        try {
          const snapRes = await fetch(`/api/snapshot?ticker=${encodeURIComponent(b.ticker)}&date=${b.date}`);
          if (!snapRes.ok) continue;
          const snapData = await snapRes.json();
          const snapshotPrice = snapData.price;
          if (!snapshotPrice) continue;
          await new Promise(r => setTimeout(r, 250));
          const searchRes = await fetch(`/api/search?q=${encodeURIComponent(b.ticker)}`);
          if (!searchRes.ok) continue;
          const searchData = await searchRes.json();
          const match = Array.isArray(searchData) ? searchData.find(d => d.symbol === b.ticker) : null;
          if (!match?.price) continue;
          gains[b.ticker] = {
            gain: ((match.price - snapshotPrice) / snapshotPrice * 100).toFixed(0),
            currentPrice: match.price,
            snapshotPrice,
          };
          await new Promise(r => setTimeout(r, 250));
        } catch {}
      }
      if (!cancelled) setBreakoutGains(gains);
    }
    fetchGains();
    return () => { cancelled = true; };
  }, []);

  // Fetch engine candidates lazily when a template-free mode is selected
  const engineFetchedRef = useRef({});
  useEffect(() => {
    const algoByMode = { M: 'momentumBreakout', C: 'catalystDriven', E: 'ensembleConsensus' };
    const algo = algoByMode[mode];
    if (!algo || !serverReady) return;
    if (engineFetchedRef.current[algo]) return;
    engineFetchedRef.current[algo] = true;

    setEngineLoading(prev => ({ ...prev, [algo]: true }));
    fetch(`/api/matches?algo=${algo}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`${res.status}`)))
      .then(data => setEngineResults(prev => ({ ...prev, [algo]: data })))
      .catch(() => { engineFetchedRef.current[algo] = false; })
      .finally(() => setEngineLoading(prev => ({ ...prev, [algo]: false })));
  }, [mode, serverReady]);

  // Warm-up polling
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
    if (!snapshot || blendTemplates.length >= 5) return;
    if (blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date)) return;
    setBlendTemplates([...blendTemplates, { ticker: snapshot.ticker, date: snapshot.date, companyName: snapshot.companyName }]);
    setSnapshot(null); setTicker(''); setDate(''); setDateRange(null);
  }

  function removeFromBlend(idx) {
    setBlendTemplates(blendTemplates.filter((_, i) => i !== idx));
  }

  async function runBlend() {
    if (blendTemplates.length < 2) return;
    setBlendLoading(true); setError(null);
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

  function goToEngineScan(algo) {
    navigate(`/matches?algo=${algo}`);
  }

  const currentBreakout = FAMOUS_BREAKOUTS[activeBreakout];
  const dynamicGain = breakoutGains[currentBreakout.ticker];
  const displayGain = dynamicGain ? `+${dynamicGain.gain}%` : currentBreakout.gain;

  const activeIdx = useMemo(() => MODES.findIndex(m => m.key === mode), [mode]);

  return (
    <main className="animate-fade-in">
      {/* Warm-up banner */}
      {!serverReady && !pollTimedOut && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mt-3 flex items-center gap-3 px-4 py-2.5 rounded-xl text-amber text-xs sm:text-sm animate-fade-in" style={{
            background: 'rgba(245, 158, 11, 0.06)',
            border: '1px solid rgba(245, 158, 11, 0.1)',
          }}>
            <span className="w-3.5 h-3.5 border-2 border-amber/30 border-t-amber rounded-full animate-spin shrink-0" />
            <span>Warming up — {stockCount.toLocaleString()} stocks loaded. Matches ready shortly.</span>
          </div>
        </div>
      )}
      {!serverReady && pollTimedOut && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mt-3 flex items-center gap-3 px-4 py-2.5 rounded-xl text-loss text-xs sm:text-sm animate-fade-in" style={{
            background: 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.1)',
          }}>
            <span>Server is taking longer than expected.</span>
            <button
              className="ml-auto shrink-0 text-xs underline hover:text-loss/80 transition-colors"
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
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* HERO with grid background and mode tabs         */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="relative overflow-hidden">
        <div className="bp-grid-bg" aria-hidden />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-8 relative">

          {/* Mode tabs */}
          <div className="mode-tabs-wrap mb-8">
            <div className="mode-tabs" role="tablist" aria-label="Screener mode">
              {MODES.map(m => (
                <button
                  key={m.key}
                  role="tab"
                  aria-selected={mode === m.key}
                  onClick={() => setMode(m.key)}
                  className={`mode-tab ${mode === m.key ? 'active' : ''}`}
                >
                  <span className="mode-tab-dot" aria-hidden />
                  <span>{m.tab}</span>
                </button>
              ))}
              <span className="mode-tab-indicator" data-idx={activeIdx} aria-hidden />
            </div>
          </div>

          {/* Mode content */}
          <div key={mode} className="animate-fade-in">
            {mode === 'T' && (
              <TemplateMode
                ticker={ticker}
                setTicker={setTicker}
                date={date}
                setDate={setDate}
                dateRange={dateRange}
                dateRangeLoading={dateRangeLoading}
                datePickerReady={datePickerReady}
                loading={loading}
                error={error}
                snapshot={snapshot}
                canLoadSnapshot={canLoadSnapshot}
                handleTickerChange={handleTickerChange}
                loadSnapshot={loadSnapshot}
                goToMatches={goToMatches}
                blendMode={blendMode}
                setBlendMode={setBlendMode}
                blendTemplates={blendTemplates}
                blendLoading={blendLoading}
                addToBlend={addToBlend}
                removeFromBlend={removeFromBlend}
                runBlend={runBlend}
                activeBreakout={activeBreakout}
                currentBreakout={currentBreakout}
                displayGain={displayGain}
                fadeIn={fadeIn}
                breakoutGains={breakoutGains}
              />
            )}
            {mode === 'M' && <MomentumMode onScan={() => goToEngineScan('momentumBreakout')} candidates={engineResults.momentumBreakout} loading={engineLoading.momentumBreakout} onPickTicker={t => navigate(`/stock/${t}`)} />}
            {mode === 'C' && <CatalystMode onScan={() => goToEngineScan('catalystDriven')} candidates={engineResults.catalystDriven} loading={engineLoading.catalystDriven} onPickTicker={t => navigate(`/stock/${t}`)} />}
            {mode === 'E' && <EnsembleMode onScan={() => goToEngineScan('ensembleConsensus')} candidates={engineResults.ensembleConsensus} loading={engineLoading.ensembleConsensus} onPickTicker={t => navigate(`/stock/${t}`)} />}
          </div>
        </div>
      </div>

      {/* Breakout candidates (real data) — kept below hero */}
      {serverReady && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <TopPairs />
        </div>
      )}
    </main>
  );
}

/* ═════════════════════ Template mode ═════════════════════ */
function TemplateMode(props) {
  const {
    ticker, date, dateRange, dateRangeLoading, datePickerReady, loading, error,
    snapshot, canLoadSnapshot, handleTickerChange, loadSnapshot, goToMatches,
    blendMode, setBlendMode, blendTemplates, blendLoading, addToBlend, removeFromBlend, runBlend,
    setDate, setTicker, // eslint-disable-line no-unused-vars
    currentBreakout, displayGain, fadeIn, breakoutGains, activeBreakout,
  } = props;

  return (
    <>
      {/* Headline: rotating famous breakout */}
      {!snapshot && (
        <div className="text-center mb-6">
          <h1 className="font-display leading-[1.15]" style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', margin: '0 0 12px' }}>
            What looks like{' '}
            <span
              style={{
                display: 'inline-block',
                opacity: fadeIn ? 1 : 0,
                transform: fadeIn ? 'translateY(0)' : 'translateY(-4px)',
                transition: 'opacity .42s cubic-bezier(0.2,0,0,1), transform .42s cubic-bezier(0.2,0,0,1)',
              }}
            >
              <span className="gold-grad">{currentBreakout.label}</span>
            </span>{' '}
            did <em>before</em> the run?
          </h1>
          <p className="text-text-secondary text-sm max-w-lg mx-auto leading-relaxed m-0">
            Pick a historical breakout. Blueprint finds today&rsquo;s stocks matching its fundamental and technical fingerprint.
          </p>
        </div>
      )}

      {/* Rotating proof line */}
      {!snapshot && (
        <div
          className="flex items-center justify-center flex-wrap gap-3 mb-6"
          style={{ opacity: fadeIn ? 1 : 0, transition: 'opacity .42s cubic-bezier(0.2,0,0,1)', minHeight: 28 }}
        >
          <span className="text-[13px] text-text-secondary">
            <span className="ticker text-text-primary">{currentBreakout.ticker}</span>
            <span className="mx-2 text-text-muted">·</span>
            <span className="num font-bold text-[15px]" style={{ color: 'var(--color-gain)' }}>{displayGain}</span>
            <span className="mx-2 text-text-muted">{currentBreakout.period}</span>
          </span>
        </div>
      )}

      {/* Blend chips */}
      {!snapshot && blendMode && blendTemplates.length > 0 && (
        <div className="max-w-2xl mx-auto mb-4 pb-4 border-b border-border">
          <div className="flex flex-wrap gap-2 mb-3">
            {blendTemplates.map((t, i) => (
              <div key={`${t.ticker}-${t.date}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>
                <span className="ticker text-sm" style={{ color: 'var(--color-brand-2)' }}>{t.ticker}</span>
                <span className="text-xs text-text-muted">{t.date}</span>
                <button className="text-text-muted hover:text-loss transition-colors ml-1" onClick={() => removeFromBlend(i)}>
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
                  Blending&hellip;
                </span>
              ) : `Blend ${blendTemplates.length} Templates`}
            </button>
          )}
          {blendTemplates.length < 2 && (
            <p className="text-xs text-text-muted text-center">Add at least 2 templates to blend</p>
          )}
        </div>
      )}

      {/* Search card */}
      {!snapshot && (
        <div className="card relative max-w-2xl mx-auto" style={{ padding: 20 }}>
          <div className="gold-accent-top" aria-hidden />
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <div className="flex-1 flex flex-col gap-1.5">
              <span className="label-xs" style={{ fontSize: 10 }}>Template Ticker</span>
              <TickerSearch value={ticker} onChange={handleTickerChange} onSelect={handleTickerChange} />
            </div>
            <div className="sm:w-44 flex flex-col gap-1.5">
              <span className="label-xs" style={{ fontSize: 10 }}>Snapshot Date</span>
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
            </div>
            <div className="flex flex-col gap-1.5 justify-end">
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
                    Find matches
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Date shortcuts */}
          {datePickerReady && !dateRangeLoading && (
            <div className="flex gap-1.5 mt-3 flex-wrap">
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
                const active = date === dateStr;
                return (
                  <button
                    key={label}
                    className={`text-[10px] px-2.5 py-1 rounded-lg transition-all duration-150 ${
                      disabled ? 'text-text-muted/20 cursor-not-allowed'
                        : active ? 'text-brand' : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover'
                    }`}
                    style={{ border: active ? '1px solid rgba(201,168,76,0.2)' : '1px solid transparent', background: active ? 'rgba(201,168,76,0.1)' : 'transparent' }}
                    disabled={disabled}
                    onClick={() => props.setDate(dateStr)}
                  >
                    {label} ago
                  </button>
                );
              })}
            </div>
          )}
          {dateRangeLoading && (
            <p className="text-[10px] text-text-muted mt-2 flex items-center gap-1">
              <span className="w-2.5 h-2.5 border border-text-muted/50 border-t-text-secondary rounded-full animate-spin" />
              Checking dates&hellip;
            </p>
          )}
          {dateRange && !dateRangeLoading && dateRange.earliestDate && (
            <p className="text-[10px] text-text-muted mt-2">
              Data from <span className="text-text-secondary">{dateRange.earliestDate}</span>
              {!dateRange.hasFullData && dateRange.message && (
                <span className="text-amber/80 ml-2">{dateRange.message}</span>
              )}
            </p>
          )}
          {dateRange && !dateRangeLoading && !dateRange.earliestDate && (
            <p className="text-[10px] text-loss mt-2">No data for {ticker.toUpperCase()}</p>
          )}
          {error && <p className="mt-2 text-loss text-sm">{error}</p>}

          <div className="mt-3 text-[11px] text-text-muted flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 1.5l5.5 2.5v4c0 3.5-2.5 6.5-5.5 7-3-.5-5.5-3.5-5.5-7v-4L8 1.5z"/></svg>
            48-dim feature vector · cosine similarity · frozen historical data
          </div>
        </div>
      )}

      {/* Famous breakouts grid */}
      {!snapshot && !blendMode && (
        <div className="max-w-2xl mx-auto mt-8">
          <div className="flex items-center justify-between mb-3">
            <span className="label-xs">Or start from a famous breakout</span>
            <span className="text-[11px] text-text-muted">{FAMOUS_BREAKOUTS.length} of 847</span>
          </div>
          <div className="famous-grid grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {FAMOUS_BREAKOUTS.map((s, i) => {
              const live = breakoutGains[s.ticker];
              const liveGain = live ? `+${live.gain}%` : s.gain;
              const isActive = i === activeBreakout;
              return (
                <button
                  key={s.ticker}
                  className="card text-left cursor-pointer transition-all duration-200 hover:-translate-y-px"
                  style={{
                    padding: 14,
                    borderColor: isActive ? 'rgba(201,168,76,0.35)' : undefined,
                  }}
                  onClick={() => {
                    handleTickerChange(s.ticker);
                    props.setDate(s.date);
                    loadSnapshot(s.ticker, s.date, { autoNavigate: true });
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="ticker text-sm text-text-primary">{s.ticker}</div>
                    <div className="num font-bold text-[13px]" style={{ color: 'var(--color-gain)' }}>{liveGain}</div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <div className="text-[11px] text-text-secondary truncate">{s.label}</div>
                    <div className="text-[10px] text-text-muted num whitespace-nowrap">{s.period}</div>
                  </div>
                  <div className="mt-2.5">
                    <MiniSparkline prices={makeSpark(i + 20, 22, 1.8)} width={160} height={28} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="text-center mt-4">
            <button
              className="text-xs text-text-muted hover:text-brand transition-colors"
              onClick={() => { setBlendMode(v => !v); }}
            >
              {blendMode ? '← Back to single mode' : 'Or try multi-blend →'}
            </button>
          </div>
        </div>
      )}

      {/* Snapshot card + CTAs */}
      {snapshot && (
        <div className="animate-fade-in-up max-w-3xl mx-auto">
          <SnapshotCard snapshot={snapshot} />
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            {blendMode ? (
              <>
                <button
                  className="btn-primary flex-1 text-center text-sm"
                  onClick={addToBlend}
                  disabled={blendTemplates.length >= 5 || blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date)}
                >
                  {blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date) ? 'Already added' : `Add ${snapshot.ticker} to Blend`}
                </button>
                <button className="btn-secondary flex-1 text-center text-sm" onClick={goToMatches}>Use solo instead →</button>
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
    </>
  );
}

/* ═════════════════════ Momentum mode ═════════════════════ */
function MomentumMode({ onScan, candidates, loading, onPickTicker }) {
  return (
    <EngineModeShell
      headline={<>What&rsquo;s <span className="gold-grad">coiling</span> right now?</>}
      subtitle="Stocks pressed against all-time highs on consolidating ranges. Volume-weighted trend strength detects base resolution in real time."
      scanLabel="Scan for breakouts"
      onScan={onScan}
      candidates={candidates}
      loading={loading}
      onPickTicker={onPickTicker}
      meta="Detects bases using ATR-normalized range compression."
    />
  );
}

/* ═════════════════════ Catalyst mode ═════════════════════ */
function CatalystMode({ onScan, candidates, loading, onPickTicker }) {
  return (
    <EngineModeShell
      headline={<>Which catalysts will <span className="gold-grad">move</span> markets?</>}
      subtitle="Earnings, guidance raises, analyst clusters. Blueprint ranks companies by historical post-event drift magnitude."
      scanLabel="Scan catalysts"
      onScan={onScan}
      candidates={candidates}
      loading={loading}
      onPickTicker={onPickTicker}
      meta="Event impact scored against historical post-event drift data per sector."
    />
  );
}

/* ═════════════════════ Ensemble mode ═════════════════════ */
function EnsembleMode({ onScan, candidates, loading, onPickTicker }) {
  return (
    <EngineModeShell
      headline={<>Where do <span className="gold-grad">all engines</span> agree?</>}
      subtitle="The strongest signal is consensus. Ensemble ranks today's stocks where Template, Momentum, and Catalyst engines independently flag the same name."
      scanLabel="Run ensemble scan"
      onScan={onScan}
      candidates={candidates}
      loading={loading}
      onPickTicker={onPickTicker}
      meta="Consensus scoring across independent engines."
    />
  );
}

/* ═════════════════════ Shared engine-mode shell ═════════════════════ */
function EngineModeShell({ headline, subtitle, scanLabel, onScan, candidates, loading, onPickTicker, meta }) {
  const shown = (candidates || []).slice(0, 6);
  return (
    <>
      <div className="text-center mb-6 max-w-xl mx-auto">
        <h1 className="font-display leading-[1.15]" style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.5rem)', margin: '0 0 12px' }}>
          {headline}
        </h1>
        <p className="text-text-secondary text-sm leading-relaxed m-0">{subtitle}</p>
      </div>

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="label-xs">Top candidates right now</span>
          <span className="text-[11px] text-text-muted">
            {loading ? 'Scanning…' : shown.length ? `${shown.length} of 10` : ' '}
          </span>
        </div>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {loading && shown.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card" style={{ padding: 12, minHeight: 92, opacity: 0.5 }}>
                  <div className="h-3 bg-border rounded w-10 mb-2" />
                  <div className="h-2 bg-border rounded w-20 mb-4" />
                  <div className="h-2 bg-border rounded w-16" />
                </div>
              ))
            : shown.map(c => <CandidateCard key={c.ticker} c={c} onPickTicker={onPickTicker} />)}
          {!loading && shown.length === 0 && (
            <div className="text-text-muted text-xs col-span-full py-3 text-center">No candidates yet. Try Scan.</div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-4 items-center">
          <button className="btn-primary flex-1 w-full" onClick={onScan}>
            <svg className="inline-block w-4 h-4 mr-1.5 -mt-0.5" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            {scanLabel}
          </button>
        </div>
        <div className="mt-3 text-[11px] text-text-muted text-center">{meta}</div>
      </div>
    </>
  );
}

function CandidateCard({ c, onPickTicker }) {
  const score = typeof c.matchScore === 'number' ? Math.round(c.matchScore) : null;
  const tier = score == null ? 'low' : score >= 85 ? 'high' : score >= 70 ? 'mid' : 'low';
  const priceStr = typeof c.price === 'number'
    ? (c.price >= 10 ? `$${c.price.toFixed(2)}` : `$${c.price.toFixed(3)}`)
    : null;
  return (
    <button
      className="card text-left cursor-pointer transition-all duration-200 hover:-translate-y-px"
      style={{ padding: 12 }}
      onClick={() => onPickTicker(c.ticker)}
      title={c.companyName}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="ticker text-sm text-text-primary">{c.ticker}</div>
          <div className="text-[11px] text-text-secondary truncate">{c.companyName}</div>
        </div>
        {score != null && <div className={`score-badge ${tier}`}>{score}</div>}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted">
        <span className="truncate pr-2">{c.sector || '—'}</span>
        {priceStr && <span className="num whitespace-nowrap">{priceStr}</span>}
      </div>
    </button>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="stat-zone">
      <div className="label-xs" style={{ fontSize: 10 }}>{label}</div>
      <div className="num font-semibold text-sm mt-0.5">{value}</div>
    </div>
  );
}
