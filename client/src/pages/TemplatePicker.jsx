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
  const [blendTemplates, setBlendTemplates] = useState([]); // [{ticker, date, companyName}]
  const [blendLoading, setBlendLoading] = useState(false);

  // Poll /api/status until the universe cache is ready (max ~2 minutes)
  const MAX_POLLS = 40; // 40 × 3s = 120s
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
      } catch {
        // server not yet reachable — keep polling
      }
      // Stop polling after MAX_POLLS attempts
      if (!pollRef.current) return;
      if (pollCountRef.current >= MAX_POLLS) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setPollTimedOut(true);
      }
    }

    checkStatus();
    pollRef.current = setInterval(checkStatus, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Fetch date range when ticker changes
  async function fetchDateRange(sym) {
    if (!sym || sym.trim().length === 0) {
      setDateRange(null);
      return;
    }
    // Cancel previous in-flight request
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
      if (err.name !== 'AbortError') {
        setDateRange(null);
      }
    } finally {
      setDateRangeLoading(false);
    }
  }

  // Wrap setTicker to also trigger date range lookup
  function handleTickerChange(val) {
    setTicker(val);
    setSnapshot(null);
    setError(null);
    // Only fetch date range if looks like a valid ticker (1-10 alphanumeric chars)
    if (/^[A-Za-z0-9.]{1,10}$/.test(val)) {
      fetchDateRange(val);
    } else {
      setDateRange(null);
      setDate('');
    }
  }

  // Whether the date picker should be enabled
  const datePickerReady = !!(dateRange && dateRange.earliestDate && !dateRangeLoading);
  const hasValidTicker = /^[A-Za-z0-9.]{1,10}$/.test(ticker);

  // Whether the selected date is within the valid range
  function isDateValid(d) {
    if (!d || !dateRange?.earliestDate) return false;
    return d >= dateRange.earliestDate && d <= yesterday();
  }

  // Whether the Load Snapshot button should be enabled
  const canLoadSnapshot = !loading && hasValidTicker && date && isDateValid(date);

  async function loadSnapshot(overrideTicker, overrideDate) {
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function addToBlend() {
    if (!snapshot) return;
    if (blendTemplates.length >= 5) return;
    // Don't add duplicates
    if (blendTemplates.some(t => t.ticker === snapshot.ticker && t.date === snapshot.date)) return;
    setBlendTemplates([...blendTemplates, {
      ticker: snapshot.ticker,
      date: snapshot.date,
      companyName: snapshot.companyName,
    }]);
    // Reset for next template
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
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Warm-up banner */}
      {!serverReady && !pollTimedOut && (
        <div className="mb-6 flex items-center gap-3 px-3 sm:px-4 py-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400 text-xs sm:text-sm animate-fade-in">
          <span className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin shrink-0" />
          <span>
            Server warming up — {stockCount.toLocaleString()} stocks loaded so far.
            Snapshot lookups work now; match results will be ready shortly.
          </span>
        </div>
      )}
      {!serverReady && pollTimedOut && (
        <div className="mb-6 flex items-center gap-3 px-3 sm:px-4 py-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-xs sm:text-sm animate-fade-in">
          <span>
            Server is taking longer than expected to load.
            Snapshot lookups may still work — match results require a fully loaded universe.
          </span>
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

      {/* Hero */}
      <div className="text-center mb-12 sm:mb-16 animate-fade-in-up">
        <div className="inline-block mb-5 px-4 py-1.5 rounded-full border border-accent/20 bg-accent/5 text-accent text-xs font-medium tracking-wide">
          28 metrics · 5 strategies · {stockCount > 0 ? `${stockCount.toLocaleString()} stocks` : '5,000+ stocks'}
        </div>
        <h1 className="text-3xl sm:text-5xl font-display text-warm-white mb-5 leading-tight">
          Find stocks that look like<br />
          <span className="text-accent italic">yesterday's biggest winners</span>
        </h1>
        <p className="text-warm-gray text-base sm:text-lg max-w-xl mx-auto leading-relaxed font-light">
          Blueprint matches today's stocks against historical breakout profiles using valuation,
          growth, profitability, and momentum data — then backtests the results.
        </p>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12 animate-fade-in-up-delay">
        {[
          {
            step: '01',
            title: 'Pick a winner',
            desc: 'Choose a stock that broke out and the date before it ran. Blueprint captures its full financial profile.',
            icon: (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="#c9a84c" strokeWidth="1.2"/><path d="M10 6v4l3 2" stroke="#c9a84c" strokeWidth="1.2" strokeLinecap="round"/></svg>
            ),
          },
          {
            step: '02',
            title: 'Find matches',
            desc: 'Blueprint scans thousands of stocks to find the ones that most closely resemble your template today.',
            icon: (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5" stroke="#c9a84c" strokeWidth="1.2"/><path d="M12.5 12.5L17 17" stroke="#c9a84c" strokeWidth="1.2" strokeLinecap="round"/></svg>
            ),
          },
          {
            step: '03',
            title: 'Validate & track',
            desc: 'Backtest how past matches performed, compare metrics side by side, and add the best to your watchlist.',
            icon: (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 14l4-4 3 3 7-9" stroke="#22c55e" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ),
          },
        ].map(item => (
          <div key={item.step} className="card text-center py-6 px-4 group hover:border-dark-border-hover transition-all duration-300">
            <div className="flex items-center justify-center gap-2.5 mb-3">
              {item.icon}
              <span className="text-[10px] text-warm-muted font-mono tracking-widest">{item.step}</span>
            </div>
            <p className="text-sm font-semibold text-warm-white mb-1.5">{item.title}</p>
            <p className="text-xs text-warm-gray leading-relaxed font-light">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Feature highlights */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-12 animate-fade-in-up-delay-2">
        {[
          { label: 'Sector-relative scoring', desc: 'Compares within sectors' },
          { label: 'Momentum matching', desc: 'Price trajectory alignment' },
          { label: 'Forward backtesting', desc: '1m to 12m returns vs SPY' },
          { label: 'CSV export & sharing', desc: 'Share any analysis' },
        ].map(f => (
          <div key={f.label} className="rounded-lg border border-dark-border/50 bg-dark-surface px-3 py-3 text-center hover:border-dark-border transition-colors duration-200">
            <p className="text-xs font-medium text-warm-white mb-0.5">{f.label}</p>
            <p className="text-[10px] text-warm-muted font-light">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Mode toggle */}
      <div className="flex items-center justify-center gap-3 mb-6 animate-fade-in-up-delay-3">
        <button
          className={`text-xs px-4 py-1.5 rounded-full border transition-all duration-200 ${!blendMode ? 'border-accent/40 bg-accent/10 text-accent' : 'border-dark-border text-warm-muted hover:text-warm-gray'}`}
          onClick={() => { setBlendMode(false); setBlendTemplates([]); }}
        >
          Single template
        </button>
        <button
          className={`text-xs px-4 py-1.5 rounded-full border transition-all duration-200 ${blendMode ? 'border-accent/40 bg-accent/10 text-accent' : 'border-dark-border text-warm-muted hover:text-warm-gray'}`}
          onClick={() => { setBlendMode(true); setSnapshot(null); }}
        >
          Multi-template blend
        </button>
      </div>

      {/* Blend template list */}
      {blendMode && blendTemplates.length > 0 && (
        <div className="card mb-4 border-accent/15 animate-fade-in">
          <p className="section-label mb-3">
            Blend templates ({blendTemplates.length}/5)
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {blendTemplates.map((t, i) => (
              <div key={`${t.ticker}-${t.date}`} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-accent/20 bg-accent/5">
                <span className="font-mono font-bold text-sm text-accent">{t.ticker}</span>
                <span className="text-xs text-warm-muted">{t.date}</span>
                <button
                  className="text-warm-muted hover:text-red-400 transition-colors ml-1"
                  onClick={() => removeFromBlend(i)}
                  title="Remove"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            ))}
          </div>
          {blendTemplates.length >= 2 && (
            <button
              className="btn-primary w-full text-sm py-2.5"
              onClick={runBlend}
              disabled={blendLoading}
            >
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

      {/* Search area */}
      <div className="card mb-6 animate-fade-in-up-delay-3">
        <p className="section-label mb-4">
          {blendMode ? `Add template ${blendTemplates.length + 1}` : 'Template Stock'}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="w-full sm:flex-1">
            <label className="block text-sm text-warm-gray mb-1.5 font-light">Ticker</label>
            <TickerSearch
              value={ticker}
              onChange={handleTickerChange}
              onSelect={handleTickerChange}
            />
          </div>
          <div className="w-full sm:w-auto">
            <label className="block text-sm text-warm-gray mb-1.5 font-light">Snapshot Date</label>
            <input
              type="date"
              className={`input-field w-full sm:w-40 ${!datePickerReady ? 'opacity-30 cursor-not-allowed' : ''}`}
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
              <p className="text-xs text-warm-muted mt-1 flex items-center gap-1.5">
                <span className="w-3 h-3 border border-warm-muted/50 border-t-warm-gray rounded-full animate-spin" />
                Checking data availability…
              </p>
            )}
            {!dateRangeLoading && hasValidTicker && !dateRange && ticker.length > 0 && (
              <p className="text-xs text-warm-muted mt-1">Enter a ticker to see available dates</p>
            )}
            {dateRange && !dateRangeLoading && dateRange.earliestDate && (
              <p className="text-xs text-warm-muted mt-1">
                Available: <span className="text-warm-gray">{dateRange.earliestDate}</span> — <span className="text-warm-gray">today</span>
                {!dateRange.hasFullData && dateRange.message && (
                  <span className="block text-amber-500/80 mt-0.5">{dateRange.message}</span>
                )}
              </p>
            )}
            {dateRange && !dateRangeLoading && !dateRange.earliestDate && (
              <p className="text-xs text-red-400/80 mt-1">No financial data found for {ticker.toUpperCase()}</p>
            )}
          </div>
          <button
            className="btn-primary whitespace-nowrap w-full sm:w-auto"
            onClick={() => loadSnapshot()}
            disabled={!canLoadSnapshot}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-dark-bg/30 border-t-dark-bg rounded-full animate-spin" />
                Loading…
              </span>
            ) : 'Load Snapshot'}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-red-400 text-sm">{error}</p>
        )}
      </div>

      {/* Quick start suggestions — only show when no ticker entered */}
      {!ticker && !snapshot && (
        <div className="mb-8 animate-fade-in-up-delay-3">
          <p className="section-label mb-3 text-center">Try a famous breakout</p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { ticker: 'CLS', date: '2023-12-01', label: 'Celestica', desc: 'Dec 2023' },
              { ticker: 'NVDA', date: '2023-01-03', label: 'NVIDIA', desc: 'Jan 2023' },
              { ticker: 'SMCI', date: '2023-06-01', label: 'Super Micro', desc: 'Jun 2023' },
              { ticker: 'PLTR', date: '2023-05-01', label: 'Palantir', desc: 'May 2023' },
              { ticker: 'META', date: '2023-02-01', label: 'Meta', desc: 'Feb 2023' },
              { ticker: 'AVGO', date: '2023-06-01', label: 'Broadcom', desc: 'Jun 2023' },
            ].map(s => (
              <button
                key={s.ticker}
                className="px-3 py-2.5 rounded-lg border border-dark-border/50 hover:border-accent/30 bg-dark-surface hover:bg-accent/5 transition-all duration-200 text-left group"
                onClick={() => {
                  handleTickerChange(s.ticker);
                  setDate(s.date);
                  loadSnapshot(s.ticker, s.date);
                }}
              >
                <span className="font-mono font-bold text-sm text-warm-white group-hover:text-accent transition-colors duration-200">{s.ticker}</span>
                <span className="block text-[10px] text-warm-muted font-light">{s.label} · {s.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
                <button
                  className="btn-secondary flex-1 text-center text-sm py-3"
                  onClick={goToMatches}
                >
                  Use solo instead →
                </button>
              </>
            ) : (
              <button
                className="btn-primary w-full text-center text-sm sm:text-base py-3 sm:py-4"
                onClick={goToMatches}
              >
                Find Stocks That Look Like This Today →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top pairs across the universe */}
      {serverReady && <TopPairs />}
    </main>
  );
}
