import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MatchCard from '../components/MatchCard';
import { formatMetric } from '../utils/format';

function scoreLabel(score) {
  if (score >= 85) return { text: 'Excellent match', color: 'text-green-400' };
  if (score >= 70) return { text: 'Strong match', color: 'text-green-400' };
  if (score >= 55) return { text: 'Moderate match', color: 'text-yellow-400' };
  return { text: 'Weak match', color: 'text-red-400' };
}

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
  const [searchParams] = useSearchParams();

  // Support both navigate state and URL query params for shareable links
  const [snapshot, setSnapshot] = useState(state?.snapshot || null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);

  // Filter state
  const [sectorFilter, setSectorFilter] = useState('all');
  const [sortBy, setSortBy] = useState('score'); // 'score' | 'sector' | 'growth'

  // Warm-up retry state
  const [warming, setWarming] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [warmStockCount, setWarmStockCount] = useState(0);
  const retryRef = useRef(null);
  const countdownRef = useRef(null);
  const retriesLeft = useRef(MAX_RETRIES);

  // If no snapshot from navigate state, try to load from URL params
  useEffect(() => {
    if (snapshot) return;
    const ticker = searchParams.get('ticker');
    const date = searchParams.get('date');
    if (!ticker || !date) { navigate('/', { replace: true }); return; }

    setSnapshotLoading(true);
    fetch(`/api/snapshot?ticker=${encodeURIComponent(ticker)}&date=${date}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load snapshot');
        return res.json();
      })
      .then(data => { setSnapshot(data); setSnapshotLoading(false); })
      .catch(() => { navigate('/', { replace: true }); });
  }, [snapshot, searchParams, navigate]);

  // Update URL params when snapshot is available (for shareable links)
  useEffect(() => {
    if (!snapshot) return;
    const currentTicker = searchParams.get('ticker');
    const currentDate = searchParams.get('date');
    if (currentTicker !== snapshot.ticker || currentDate !== snapshot.date) {
      navigate(`/matches?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}`, { replace: true, state: { snapshot } });
    }
  }, [snapshot]);

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

  if (!snapshot) {
    if (snapshotLoading) {
      return (
        <main className="max-w-3xl mx-auto px-6 py-10">
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
            <p className="text-slate-400 text-sm">Loading snapshot…</p>
          </div>
        </main>
      );
    }
    return null;
  }

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
      {matches && !loading && (() => {
        // Derive unique sectors
        const sectors = [...new Set(matches.map(m => m.sector).filter(Boolean))].sort();

        // Filter
        const filtered = sectorFilter === 'all'
          ? matches
          : sectorFilter === 'same'
            ? matches.filter(m => m.sector === snapshot.sector)
            : matches.filter(m => m.sector === sectorFilter);

        // Sort
        const sorted = [...filtered].sort((a, b) => {
          if (sortBy === 'growth') return (b.revenueGrowthYoY ?? -999) - (a.revenueGrowthYoY ?? -999);
          if (sortBy === 'sector') return (a.sector || '').localeCompare(b.sector || '') || b.matchScore - a.matchScore;
          return b.matchScore - a.matchScore;
        });

        // Top score for interpretation
        const topScore = matches[0]?.matchScore;
        const avgScore = matches.length > 0 ? Math.round(matches.reduce((s, m) => s + m.matchScore, 0) / matches.length) : 0;

        return (
          <>
            {/* Score interpretation */}
            <div className="card mb-6 border-dark-border/50">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-accent text-sm">i</span>
                </div>
                <div className="text-sm">
                  <p className="text-slate-300">
                    Found <span className="font-semibold text-slate-100">{matches.length} matches</span> —
                    top score is <span className={`font-semibold ${scoreLabel(topScore).color}`}>{Math.round(topScore)}</span>
                    {topScore >= 75
                      ? '. These stocks share very similar financial profiles to the template.'
                      : topScore >= 55
                        ? '. Decent similarity — review individual metrics for areas of divergence.'
                        : '. Moderate similarity — the template profile may be uncommon in today\'s market.'}
                  </p>
                  <p className="text-slate-500 text-xs mt-1">
                    Avg score: {avgScore} · Scores above 70 indicate strong similarity across valuation, growth, profitability, and technicals.
                  </p>
                </div>
              </div>
            </div>

            {/* Filters row */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 uppercase tracking-wider">Sector</label>
                <select
                  className="input-field text-sm py-1.5 px-3 w-auto"
                  value={sectorFilter}
                  onChange={e => setSectorFilter(e.target.value)}
                >
                  <option value="all">All sectors ({matches.length})</option>
                  {snapshot.sector && (
                    <option value="same">Same sector — {snapshot.sector} ({matches.filter(m => m.sector === snapshot.sector).length})</option>
                  )}
                  {sectors.map(s => (
                    <option key={s} value={s}>{s} ({matches.filter(m => m.sector === s).length})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <label className="text-xs text-slate-500 uppercase tracking-wider">Sort</label>
                <select
                  className="input-field text-sm py-1.5 px-3 w-auto"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                >
                  <option value="score">Similarity Score</option>
                  <option value="growth">Revenue Growth</option>
                  <option value="sector">Sector</option>
                </select>
              </div>
            </div>

            {/* Results count */}
            <p className="text-sm text-slate-500 mb-4">
              Showing {sorted.length} of {matches.length} — ranked by {sortBy === 'score' ? 'similarity' : sortBy === 'growth' ? 'revenue growth' : 'sector'}
            </p>

            {sorted.length === 0 ? (
              <div className="card text-center py-8 text-slate-500 text-sm">
                No matches in this sector. Try "All sectors" to see all results.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sorted.map((match, i) => (
                  <MatchCard key={match.ticker} match={match} snapshot={snapshot} rank={i + 1} />
                ))}
              </div>
            )}
          </>
        );
      })()}
    </main>
  );
}
