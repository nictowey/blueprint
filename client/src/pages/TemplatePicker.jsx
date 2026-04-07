import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import TickerSearch from '../components/TickerSearch';
import SnapshotCard from '../components/SnapshotCard';

// Yesterday as YYYY-MM-DD (max date for picker)
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function TemplatePicker() {
  const navigate = useNavigate();
  const [ticker, setTicker] = useState('');
  const [date, setDate] = useState('2020-01-15');
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverReady, setServerReady] = useState(true);
  const [stockCount, setStockCount] = useState(0);
  const pollRef = useRef(null);

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

  async function loadSnapshot() {
    if (!ticker.trim()) { setError('Enter a stock ticker'); return; }
    if (!date) { setError('Select a date'); return; }
    setError(null);
    setLoading(true);
    setSnapshot(null);
    try {
      const res = await fetch(`/api/snapshot?ticker=${encodeURIComponent(ticker)}&date=${date}`);
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
    navigate('/matches', { state: { snapshot } });
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
              onChange={setTicker}
              onSelect={setTicker}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Snapshot Date</label>
            <input
              type="date"
              className="input-field w-40"
              value={date}
              min="2010-01-01"
              max={yesterday()}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <button
            className="btn-primary whitespace-nowrap"
            onClick={loadSnapshot}
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
    </main>
  );
}
