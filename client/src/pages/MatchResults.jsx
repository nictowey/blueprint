import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MatchCard from '../components/MatchCard';
import { formatMetric } from '../utils/format';

const LOADING_MESSAGES = [
  'Scanning the stock universe…',
  'Calculating similarity scores…',
  'Ranking closest matches…',
  'Almost there…',
];

const MATCH_METRICS = [
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio',
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  'marketCap',
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta',
];

const MAX_RETRIES = 12;
const RETRY_INTERVAL_MS = 5000;

export default function MatchResults() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const snapshot = state?.snapshot;

  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);

  // Warm-up retry state
  const [warming, setWarming] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [warmStockCount, setWarmStockCount] = useState(0);
  const retryRef = useRef(null);
  const countdownRef = useRef(null);
  const retriesLeft = useRef(MAX_RETRIES);

  // Redirect if no snapshot in state
  useEffect(() => {
    if (!snapshot) navigate('/', { replace: true });
  }, [snapshot, navigate]);

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setMsgIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(id);
  }, [loading]);

  const fetchMatches = useCallback(async () => {
    if (!snapshot) return;

    const params = new URLSearchParams({ ticker: snapshot.ticker, date: snapshot.date });
    for (const metric of MATCH_METRICS) {
      if (snapshot[metric] != null) params.set(metric, snapshot[metric]);
    }

    const res = await fetch(`/api/matches?${params}`);

    if (res.status === 503) {
      // Universe still warming up — schedule a retry
      if (retriesLeft.current <= 0) {
        setError('Server is still warming up. Please try again in a minute.');
        setLoading(false);
        setWarming(false);
        return;
      }

      retriesLeft.current -= 1;
      setWarming(true);

      // Fetch stock count for the progress display
      try {
        const statusRes = await fetch('/api/status');
        if (statusRes.ok) {
          const status = await statusRes.json();
          setWarmStockCount(status.stockCount ?? 0);
        }
      } catch { /* ignore */ }

      // Start countdown
      setRetryCountdown(RETRY_INTERVAL_MS / 1000);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setRetryCountdown(c => {
          if (c <= 1) { clearInterval(countdownRef.current); return 0; }
          return c - 1;
        });
      }, 1000);

      retryRef.current = setTimeout(fetchMatches, RETRY_INTERVAL_MS);
      return;
    }

    // Clear warm-up state on any non-503 response
    setWarming(false);
    if (retryRef.current) clearTimeout(retryRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Match failed');
      setLoading(false);
      return;
    }

    const data = await res.json();
    setMatches(data);
    setLoading(false);
  }, [snapshot]);

  useEffect(() => {
    fetchMatches();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchMatches]);

  if (!snapshot) return null;

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      {/* Summary bar */}
      <div className="card mb-8 flex flex-wrap items-center gap-4 justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-bold text-xl text-slate-100">{snapshot.ticker}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400 text-sm">{snapshot.date}</span>
          </div>
          <p className="text-sm text-slate-400">{snapshot.companyName}</p>
        </div>
        <div className="flex gap-6">
          {[
            { key: 'peRatio', label: 'P/E' },
            { key: 'revenueGrowthYoY', label: 'Growth' },
            { key: 'grossMargin', label: 'Margin' },
          ].map(({ key, label }) => (
            <div key={key} className="text-center">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-slate-200">{formatMetric(key, snapshot[key])}</p>
            </div>
          ))}
        </div>
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back</button>
      </div>

      {/* Warm-up retry state */}
      {warming && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-yellow-400 rounded-full animate-spin" />
          <p className="text-yellow-400 text-sm font-medium">Universe warming up</p>
          <p className="text-slate-500 text-xs">
            {warmStockCount.toLocaleString()} stocks loaded — retrying in {retryCountdown}s…
          </p>
        </div>
      )}

      {/* Normal loading state */}
      {loading && !warming && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm animate-pulse">{LOADING_MESSAGES[msgIdx]}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="card border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Match results */}
      {matches && !loading && (
        <>
          <p className="text-sm text-slate-500 mb-5">
            {matches.length} stocks matched — ranked by similarity
          </p>
          <div className="flex flex-col gap-4">
            {matches.map((match, i) => (
              <MatchCard key={match.ticker} match={match} snapshot={snapshot} rank={i + 1} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
