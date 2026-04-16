import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MatchCard from '../components/MatchCard';
import { formatMetric } from '../utils/format';
import { httpError } from '../utils/httpError';
import { toCSV, downloadCSV } from '../utils/export';
import ShareBar from '../components/ShareBar';

function scoreLabel(score) {
  if (score >= 85) return { text: 'Excellent match', color: 'text-emerald-400' };
  if (score >= 70) return { text: 'Strong match', color: 'text-emerald-400' };
  if (score >= 55) return { text: 'Moderate match', color: 'text-accent' };
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
const DEFAULT_PROFILE = 'growth_breakout';

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

  const [universeSize, setUniverseSize] = useState(null);

  // Filter state
  const [sectorFilter, setSectorFilter] = useState('all');
  const [sortBy, setSortBy] = useState('score'); // 'score' | 'sector' | 'growth'

  // Match profile state
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(searchParams.get('profile') || DEFAULT_PROFILE);

  // Warm-up retry state
  const [warming, setWarming] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [warmStockCount, setWarmStockCount] = useState(0);
  const retryRef = useRef(null);
  const countdownRef = useRef(null);
  const retriesLeft = useRef(MAX_RETRIES);

  // Fetch universe size for results context
  useEffect(() => {
    fetch('/api/status')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.stockCount) setUniverseSize(data.stockCount); })
      .catch(() => {});
  }, []);

  // Fetch available profiles on mount
  useEffect(() => {
    fetch('/api/profiles')
      .then(res => res.ok ? res.json() : [])
      .then(data => setProfiles(data))
      .catch(() => {});
  }, []);

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

  // Update URL params when snapshot or profile changes (for shareable links)
  useEffect(() => {
    if (!snapshot) return;
    const profileParam = activeProfile !== DEFAULT_PROFILE ? `&profile=${activeProfile}` : '';
    const newUrl = `/matches?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}${profileParam}`;
    navigate(newUrl, { replace: true, state: { snapshot } });
  }, [snapshot, activeProfile]);

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
    if (activeProfile && activeProfile !== DEFAULT_PROFILE) {
      params.set('profile', activeProfile);
    }
    // Pass sector filter to API so server returns sector-specific top 10
    if (sectorFilter && sectorFilter !== 'all') {
      const sectorValue = sectorFilter === 'same' ? snapshot.sector : sectorFilter;
      if (sectorValue) params.set('sector', sectorValue);
    }
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
      setError(await httpError(res, 'Match failed'));
      setLoading(false);
      return;
    }

    const data = await res.json();
    setMatches(data);
    setLoading(false);
  }, [snapshot, activeProfile, sectorFilter]);

  useEffect(() => {
    // Clear any in-flight retry timers BEFORE starting new fetch
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    // Reset state when profile changes so we get fresh results
    setLoading(true);
    setMatches(null);
    setError(null);
    setWarming(false);
    retriesLeft.current = MAX_RETRIES;
    fetchMatches();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchMatches]);

  if (!snapshot) {
    if (snapshotLoading) {
      return (
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
            <p className="text-warm-gray text-sm font-light">Loading snapshot…</p>
          </div>
        </main>
      );
    }
    return null;
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Summary bar */}
      <div className="card mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4 sm:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono font-bold text-lg sm:text-xl text-warm-white">{snapshot.ticker}</span>
              <span className="text-warm-muted">·</span>
              <span className="text-warm-gray text-xs sm:text-sm font-mono">{snapshot.date}</span>
            </div>
            <p className="text-sm text-warm-gray font-light">{snapshot.companyName}</p>
            {snapshot.dataAsOf && snapshot.dataAsOf !== snapshot.date && (
              <p className="text-xs text-amber-500/80 mt-1">
                Financials as of {snapshot.dataAsOf}
                {snapshot.ttmQuarters < 4 ? ` (${snapshot.ttmQuarters}/4 quarters available)` : ''}
              </p>
            )}
          </div>
          <div className="flex gap-4 sm:gap-6">
            {[
              { key: 'peRatio', label: 'P/E' },
              { key: 'revenueGrowthYoY', label: 'Growth' },
              { key: 'grossMargin', label: 'Margin' },
            ].map(({ key, label }) => (
              <div key={key} className="text-center">
                <p className="section-label mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-warm-white font-mono">{formatMetric(key, snapshot[key])}</p>
              </div>
            ))}
          </div>
          <button className="btn-secondary w-full sm:w-auto" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>

      {/* Warm-up retry state */}
      {warming && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-amber-400 rounded-full animate-spin" />
          <p className="text-amber-400 text-sm font-medium">Universe warming up</p>
          <p className="text-warm-muted text-xs font-mono">
            {warmStockCount.toLocaleString()} stocks loaded — retrying in {retryCountdown}s…
          </p>
        </div>
      )}

      {/* Normal loading state */}
      {loading && !warming && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-warm-gray text-sm animate-pulse font-light">{LOADING_MESSAGES[msgIdx]}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="card border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Empty results */}
      {matches && !loading && matches.length === 0 && (
        <div className="card text-center py-10">
          <p className="text-warm-white text-sm font-medium mb-2">No matches found</p>
          <p className="text-warm-gray text-xs leading-relaxed max-w-md mx-auto font-light">
            The <span className="text-warm-white">{profiles.find(p => p.key === activeProfile)?.name || activeProfile}</span> strategy
            has filters that excluded all candidates. Try a different strategy profile or a different template stock.
          </p>
          {profiles.length > 1 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {profiles.filter(p => p.key !== activeProfile).map(p => (
                <button
                  key={p.key}
                  className="btn-secondary text-xs px-3 py-1.5"
                  onClick={() => setActiveProfile(p.key)}
                >
                  Try {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Match results */}
      {matches && !loading && matches.length > 0 && (() => {
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
            {/* Score interpretation — clear grading system */}
            <div className="card mb-6 border-dark-border/50">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-accent text-sm font-display italic">i</span>
                </div>
                <div className="text-sm flex-1">
                  <p className="text-warm-white font-light">
                    Found <span className="font-semibold">{matches.length} matches</span> —
                    top score is <span className={`font-semibold font-mono ${scoreLabel(topScore).color}`}>{Math.round(topScore)}</span>
                    {' '}(<span className={scoreLabel(topScore).color}>{scoreLabel(topScore).text}</span>)
                    {topScore >= 75
                      ? '. These stocks share very similar financial profiles to the template.'
                      : topScore >= 55
                        ? '. Decent similarity — review individual metrics for areas of divergence.'
                        : '. Moderate similarity — the template profile may be uncommon in today\'s market.'}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-warm-muted">
                    <span className="font-mono">Avg: {avgScore}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> 85+ Excellent</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/60 inline-block" /> 70+ Strong</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> 55+ Good</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &lt;55 Fair</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Backtest button */}
            {(() => {
              const oneMonthAgo = new Date();
              oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
              const snapshotDate = new Date(snapshot.date);
              if (snapshotDate <= oneMonthAgo) {
                const backtestParams = new URLSearchParams({
                  ticker: snapshot.ticker,
                  date: snapshot.date,
                });
                if (activeProfile !== DEFAULT_PROFILE) backtestParams.set('profile', activeProfile);
                return (
                  <button
                    className="btn-secondary w-full mb-5 text-sm py-2.5 flex items-center justify-center gap-2 hover:border-accent/30 hover:text-accent"
                    onClick={() => navigate(`/backtest?${backtestParams}`)}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 12l3-3 2.5 2.5L14 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Backtest — See how these matches actually performed
                  </button>
                );
              }
              return null;
            })()}

            {/* Match profile selector */}
            {profiles.length > 0 && (
              <div className="card mb-5 border-dark-border/50">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="section-label shrink-0">Strategy</label>
                    <select
                      className="input-field text-sm py-1.5 px-3 w-full sm:w-auto"
                      value={activeProfile}
                      onChange={e => setActiveProfile(e.target.value)}
                    >
                      {profiles.map(p => (
                        <option key={p.key} value={p.key}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-warm-gray sm:ml-2 leading-relaxed font-light">
                    {profiles.find(p => p.key === activeProfile)?.description || ''}
                  </p>
                </div>
              </div>
            )}

            {/* Filters row */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-5">
              <div className="flex items-center gap-2">
                <label className="section-label shrink-0">Sector</label>
                <select
                  className="input-field text-sm py-1.5 px-3 w-full sm:w-auto min-w-0"
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

              <div className="flex items-center gap-2 sm:ml-auto">
                <label className="section-label shrink-0">Sort</label>
                <select
                  className="input-field text-sm py-1.5 px-3 w-full sm:w-auto"
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                >
                  <option value="score">Similarity Score</option>
                  <option value="growth">Revenue Growth</option>
                  <option value="sector">Sector</option>
                </select>
              </div>
            </div>

            {/* Results count + share/export */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <p className="text-sm text-warm-muted font-light">
                Top {sorted.length} of {universeSize ? universeSize.toLocaleString() + ' scanned' : matches.length} — ranked by {sortBy === 'score' ? 'similarity' : sortBy === 'growth' ? 'revenue growth' : 'sector'}
              </p>
              <ShareBar
                onExportCSV={() => {
                  const columns = [
                    { key: 'ticker', label: 'Ticker' },
                    { key: 'companyName', label: 'Company' },
                    { key: 'sector', label: 'Sector' },
                    { key: 'matchScore', label: 'Match Score' },
                    { key: 'price', label: 'Price', format: r => r.price?.toFixed(2) },
                    { key: 'peRatio', label: 'P/E', format: r => r.peRatio?.toFixed(1) },
                    { key: 'revenueGrowthYoY', label: 'Rev Growth YoY', format: r => r.revenueGrowthYoY != null ? (r.revenueGrowthYoY * 100).toFixed(1) + '%' : '' },
                    { key: 'operatingMargin', label: 'Op Margin', format: r => r.operatingMargin != null ? (r.operatingMargin * 100).toFixed(1) + '%' : '' },
                    { key: 'returnOnEquity', label: 'ROE', format: r => r.returnOnEquity != null ? (r.returnOnEquity * 100).toFixed(1) + '%' : '' },
                    { key: 'marketCap', label: 'Market Cap', format: r => r.marketCap?.toLocaleString() },
                    { key: 'metricsCompared', label: 'Metrics Compared' },
                  ];
                  const csv = toCSV(sorted, columns);
                  downloadCSV(csv, `blueprint-matches-${snapshot.ticker}-${snapshot.date}.csv`);
                }}
                exportLabel="Export matches"
              />
            </div>

            {sorted.length === 0 ? (
              <div className="card text-center py-8 text-warm-muted text-sm font-light">
                No matches in this sector. Try "All sectors" to see all results.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sorted.map((match, i) => (
                  <MatchCard key={match.ticker} match={match} snapshot={snapshot} rank={i + 1} profile={activeProfile} />
                ))}
              </div>
            )}
          </>
        );
      })()}
    </main>
  );
}
