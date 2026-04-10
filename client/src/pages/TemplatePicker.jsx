import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import TickerSearch from '../components/TickerSearch';
import SnapshotCard from '../components/SnapshotCard';
import TopPairs from '../components/TopPairs';

// Yesterday as YYYY-MM-DD (max date for picker)
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const EXAMPLE_TEMPLATES = [
  { ticker: 'CLS',  date: '2023-12-01', label: 'Celestica',  desc: 'Before 5x run' },
  { ticker: 'NVDA', date: '2023-01-15', label: 'Nvidia',     desc: 'Pre-AI breakout' },
  { ticker: 'META', date: '2023-02-01', label: 'Meta',       desc: 'Year of efficiency' },
  { ticker: 'PLTR', date: '2023-10-01', label: 'Palantir',   desc: 'Pre-AI rally' },
  { ticker: 'SMCI', date: '2023-06-01', label: 'Super Micro', desc: 'AI infrastructure' },
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
  const dateRangeAbort = useRef(null);

  // Poll /api/status until the universe cache is ready
  useEffect(() => {
    async function checkStatus() {
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
    try {
      const res = await fetch(`/api/snapshot/date-range?ticker=${encodeURIComponent(sym)}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch date range');
      const data = await res.json();
      setDateRange(data);
      // If current date is before earliest valid date, clear it
      if (date && data.earliestDate && date < data.earliestDate) {
        setDate('');
      }
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
    // Debounce: only fetch date range if looks like a valid ticker (1-10 alphanumeric chars)
    if (/^[A-Za-z0-9.]{1,10}$/.test(val)) {
      fetchDateRange(val);
    } else {
      setDateRange(null);
    }
  }

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load snapshot');
      setSnapshot(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function goToMatches() {
    if (!snapshot) return;
    navigate(`/matches?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}`, { state: { snapshot } });
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      {/* Warm-up banner */}
      {!serverReady && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-400 text-sm">
          <span className="w-4 h-4 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin shrink-0" />
          <span>
            Server warming up — {stockCount.toLocaleString()} stocks loaded so far.
            Snapshot lookups work now; match results will be ready shortly.
          </span>
        </div>
      )}

      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-slate-100 mb-3">
          Find the next <span className="text-accent">10x</span>
        </h1>
        <p className="text-slate-400 text-lg">
          Pick a stock and a date. See what its profile looked like. Find stocks that look the same today.
        </p>
      </div>

      {/* Search area */}
      <div className="card mb-6">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Template Stock</p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm text-slate-400 mb-1.5">Ticker</label>
            <TickerSearch
              value={ticker}
              onChange={handleTickerChange}
              onSelect={handleTickerChange}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Snapshot Date</label>
            <input
              type="date"
              className="input-field w-40"
              value={date}
              min={dateRange?.earliestDate || '2000-01-01'}
              max={yesterday()}
              onChange={e => setDate(e.target.value)}
            />
            {dateRangeLoading && (
              <p className="text-xs text-slate-500 mt-1">Checking available dates…</p>
            )}
            {dateRange && !dateRangeLoading && dateRange.earliestDate && (
              <p className="text-xs text-slate-500 mt-1">
                Data from {dateRange.earliestDate}
                {dateRange.message && <span className="text-yellow-500/80"> — {dateRange.message}</span>}
              </p>
            )}
            {dateRange && !dateRangeLoading && !dateRange.earliestDate && (
              <p className="text-xs text-red-400/80 mt-1">No financial data found for {ticker.toUpperCase()}</p>
            )}
          </div>
          <button
            className="btn-primary whitespace-nowrap"
            onClick={() => loadSnapshot()}
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Loading…
              </span>
            ) : 'Load Snapshot'}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-red-400 text-sm">{error}</p>
        )}
      </div>

      {/* Example templates */}
      {!snapshot && (
        <div className="mb-8">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Try an example</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_TEMPLATES.map(ex => (
              <button
                key={ex.ticker}
                className="border border-dark-border hover:border-accent/50 bg-dark-card hover:bg-dark-card/80 text-left px-4 py-2.5 rounded-lg transition-all duration-150 group"
                onClick={() => { handleTickerChange(ex.ticker); setDate(ex.date); loadSnapshot(ex.ticker, ex.date); }}
              >
                <span className="font-mono font-bold text-slate-200 text-sm group-hover:text-accent transition-colors">{ex.ticker}</span>
                <span className="text-slate-500 text-xs ml-2">{ex.date}</span>
                <p className="text-slate-500 text-xs mt-0.5">{ex.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Snapshot card */}
      {snapshot && (
        <>
          <SnapshotCard snapshot={snapshot} />
          <div className="mt-6">
            <button
              className="btn-primary w-full text-center text-base py-4"
              onClick={goToMatches}
            >
              Find Stocks That Look Like This Today →
            </button>
          </div>
        </>
      )}

      {/* Top pairs across the universe */}
      {serverReady && <TopPairs />}
    </main>
  );
}
