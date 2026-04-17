import { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MatchCard from '../components/MatchCard';
import { formatMetric } from '../utils/format';
import { httpError } from '../utils/httpError';
import { toCSV, downloadCSV } from '../utils/export';
import ShareBar from '../components/ShareBar';

const LOADING_MESSAGES = [
  'Scanning the stock universe\u2026',
  'Calculating similarity scores\u2026',
  'Ranking closest matches\u2026',
  'Almost there\u2026',
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
const DEFAULT_ALGO = 'templateMatch';
const TEMPLATE_FREE_ALGOS = new Set(['momentumBreakout', 'catalystDriven', 'ensembleConsensus']);

export default function MatchResults() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [snapshot, setSnapshot] = useState(state?.snapshot || null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);

  const [universeSize, setUniverseSize] = useState(null);

  // Filter state
  const [sectorFilter, setSectorFilter] = useState('all');
  const [sortBy, setSortBy] = useState('score');

  // Match profile state
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(searchParams.get('profile') || DEFAULT_PROFILE);

  // Algorithm state
  const [algorithms, setAlgorithms] = useState([]);
  const [activeAlgo, setActiveAlgo] = useState(searchParams.get('algo') || DEFAULT_ALGO);

  const isTemplateFree = TEMPLATE_FREE_ALGOS.has(activeAlgo);

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

  // Fetch available algorithms on mount
  useEffect(() => {
    fetch('/api/algorithms')
      .then(res => res.ok ? res.json() : [])
      .then(data => setAlgorithms(data))
      .catch(() => {});
  }, []);

  // If no snapshot from navigate state, try to load from URL params
  useEffect(() => {
    if (snapshot) return;
    const ticker = searchParams.get('ticker');
    const date = searchParams.get('date');
    const algoParam = searchParams.get('algo') || DEFAULT_ALGO;
    const isFree = TEMPLATE_FREE_ALGOS.has(algoParam);

    // Template-free engines don't need a snapshot to proceed
    if (isFree && !ticker) { setSnapshotLoading(false); return; }
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

  // Update URL params when snapshot or profile or algo changes
  useEffect(() => {
    if (!snapshot) {
      if (isTemplateFree) {
        navigate(`/matches?algo=${activeAlgo}`, { replace: true });
      }
      return;
    }
    const algoParam = activeAlgo !== DEFAULT_ALGO ? `&algo=${activeAlgo}` : '';
    const profileParam = !isTemplateFree && activeProfile !== DEFAULT_PROFILE ? `&profile=${activeProfile}` : '';
    const newUrl = `/matches?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}${algoParam}${profileParam}`;
    navigate(newUrl, { replace: true, state: { snapshot } });
  }, [snapshot, activeProfile, activeAlgo]);

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setMsgIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(id);
  }, [loading]);

  const fetchMatches = useCallback(async () => {
    const isFree = TEMPLATE_FREE_ALGOS.has(activeAlgo);
    if (!isFree && !snapshot) return;

    const params = new URLSearchParams();

    if (!isFree && snapshot) {
      params.set('ticker', snapshot.ticker);
      params.set('date', snapshot.date);
      if (activeProfile && activeProfile !== DEFAULT_PROFILE) {
        params.set('profile', activeProfile);
      }
      for (const metric of MATCH_METRICS) {
        if (snapshot[metric] != null) params.set(metric, snapshot[metric]);
      }
    } else if (activeAlgo === 'ensembleConsensus' && snapshot) {
      // Ensemble with template: pass ticker+date so templateMatch component joins
      params.set('ticker', snapshot.ticker);
      params.set('date', snapshot.date);
    }

    if (activeAlgo && activeAlgo !== DEFAULT_ALGO) {
      params.set('algo', activeAlgo);
    }

    // Pass sector filter to API
    if (sectorFilter && sectorFilter !== 'all') {
      const sectorValue = sectorFilter === 'same' ? snapshot?.sector : sectorFilter;
      if (sectorValue) params.set('sector', sectorValue);
    }

    const res = await fetch(`/api/matches?${params}`);

    if (res.status === 503) {
      if (retriesLeft.current <= 0) {
        setError('Server is still warming up. Please try again in a minute.');
        setLoading(false);
        setWarming(false);
        return;
      }

      retriesLeft.current -= 1;
      setWarming(true);

      try {
        const statusRes = await fetch('/api/status');
        if (statusRes.ok) {
          const status = await statusRes.json();
          setWarmStockCount(status.stockCount ?? 0);
        }
      } catch { /* ignore */ }

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
  }, [snapshot, activeProfile, activeAlgo, sectorFilter]);

  useEffect(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

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

  function handleAlgoChange(newAlgo) {
    const newIsFree = TEMPLATE_FREE_ALGOS.has(newAlgo);
    setActiveAlgo(newAlgo);
    if (!newIsFree && !snapshot) {
      navigate('/');
      return;
    }
    if (newIsFree && !snapshot) {
      navigate(`/matches?algo=${newAlgo}`, { replace: true });
    }
  }

  const activeAlgoMeta = algorithms.find(a => a.key === activeAlgo);

  if (!isTemplateFree && !snapshot) {
    if (snapshotLoading) {
      return (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
          <div className="flex flex-col items-center justify-center py-14 gap-4">
            <div className="w-8 h-8 border-3 border-border border-t-brand rounded-full animate-spin" />
            <p className="text-text-secondary text-sm font-light">Loading snapshot\u2026</p>
          </div>
        </main>
      );
    }
    return null;
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Summary bar */}
      <div className="rounded-xl border border-border bg-surface px-5 py-4 mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4 sm:justify-between">
          {isTemplateFree && !snapshot ? (
            <div>
              <p className="font-semibold text-text-primary text-sm sm:text-base">
                {activeAlgoMeta?.name || activeAlgo}
              </p>
              {activeAlgoMeta?.description && (
                <p className="text-xs text-text-muted mt-0.5 font-light">{activeAlgoMeta.description}</p>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono font-bold text-lg sm:text-xl text-text-primary">{snapshot.ticker}</span>
                <span className="text-text-muted">&middot;</span>
                <span className="text-text-secondary text-xs sm:text-sm font-mono">{snapshot.date}</span>
              </div>
              <p className="text-sm text-text-secondary font-light">{snapshot.companyName}</p>
              {snapshot.dataAsOf && snapshot.dataAsOf !== snapshot.date && (
                <p className="text-xs text-amber-500/80 mt-1">
                  Financials as of {snapshot.dataAsOf}
                  {snapshot.ttmQuarters < 4 ? ` (${snapshot.ttmQuarters}/4 quarters available)` : ''}
                </p>
              )}
            </div>
          )}
          {!isTemplateFree && snapshot && (
            <div className="flex gap-4 sm:gap-6">
              {[
                { key: 'peRatio', label: 'P/E' },
                { key: 'revenueGrowthYoY', label: 'Growth' },
                { key: 'grossMargin', label: 'Margin' },
              ].map(({ key, label }) => (
                <div key={key} className="text-center">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider font-medium mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-text-primary font-mono">{formatMetric(key, snapshot[key])}</p>
                </div>
              ))}
            </div>
          )}
          <button className="btn-secondary w-full sm:w-auto" onClick={() => navigate(-1)}>&larr; Back</button>
        </div>
      </div>

      {/* Warm-up retry state */}
      {warming && (
        <div className="flex flex-col items-center justify-center py-14 gap-4">
          <div className="w-8 h-8 border-3 border-border border-t-amber-400 rounded-full animate-spin" />
          <p className="text-amber-400 text-sm font-medium">Universe warming up</p>
          <p className="text-text-muted text-xs font-mono">
            {warmStockCount.toLocaleString()} stocks loaded &mdash; retrying in {retryCountdown}s\u2026
          </p>
        </div>
      )}

      {/* Normal loading state */}
      {loading && !warming && (
        <div className="flex flex-col items-center justify-center py-14 gap-4">
          <div className="w-8 h-8 border-3 border-border border-t-brand rounded-full animate-spin" />
          <p className="text-text-secondary text-sm animate-pulse font-light">{LOADING_MESSAGES[msgIdx]}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-xl border border-loss/20 bg-loss/5 text-center py-6 px-4">
          <p className="text-loss text-sm font-medium mb-2">Something went wrong</p>
          <p className="text-text-muted text-xs mb-4 font-light max-w-md mx-auto">{error}</p>
          <button
            className="btn-secondary text-xs px-4 py-1.5"
            onClick={() => { setError(null); setLoading(true); retriesLeft.current = MAX_RETRIES; fetchMatches(); }}
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty results */}
      {matches && !loading && matches.length === 0 && (
        <div className="rounded-xl border border-border bg-surface text-center py-10 px-4">
          <p className="text-text-primary text-sm font-medium mb-2">No matches found</p>
          {isTemplateFree ? (
            <p className="text-text-secondary text-xs font-light">
              <button className="underline hover:text-text-primary transition-colors" onClick={() => navigate(-1)}>Back</button>
            </p>
          ) : (
            <p className="text-text-secondary text-xs leading-relaxed max-w-md mx-auto font-light">
              The <span className="text-text-primary">{profiles.find(p => p.key === activeProfile)?.name || activeProfile}</span> strategy
              has filters that excluded all candidates. Try a different strategy profile or a different template stock.
            </p>
          )}
          {!isTemplateFree && profiles.length > 1 && (
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
        const sectors = [...new Set(matches.map(m => m.sector).filter(Boolean))].sort();

        const filtered = sectorFilter === 'all'
          ? matches
          : sectorFilter === 'same'
            ? matches.filter(m => m.sector === snapshot?.sector)
            : matches.filter(m => m.sector === sectorFilter);

        const sorted = [...filtered].sort((a, b) => {
          if (sortBy === 'growth') return (b.revenueGrowthYoY ?? -999) - (a.revenueGrowthYoY ?? -999);
          if (sortBy === 'sector') return (a.sector || '').localeCompare(b.sector || '') || b.matchScore - a.matchScore;
          return b.matchScore - a.matchScore;
        });

        return (
          <>
            {/* Backtest button — only for template-based results old enough to backtest */}
            {!isTemplateFree && snapshot && (() => {
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
                    className="btn-secondary w-full mb-5 text-sm py-2.5 flex items-center justify-center gap-2 hover:border-brand/30 hover:text-brand"
                    onClick={() => navigate(`/backtest?${backtestParams}`)}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 12l3-3 2.5 2.5L14 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Backtest &mdash; See how these matches actually performed
                  </button>
                );
              }
              return null;
            })()}

            {/* Controls row */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-5">
              {/* Algorithm dropdown */}
              {algorithms.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text-muted shrink-0">Algorithm</label>
                  <select
                    className="bg-input-bg border border-border text-text-primary text-sm py-1.5 px-3 rounded-lg w-full sm:w-auto"
                    value={activeAlgo}
                    onChange={e => handleAlgoChange(e.target.value)}
                  >
                    {algorithms.map(a => (
                      <option key={a.key} value={a.key}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Strategy dropdown — only for template-based algo */}
              {!isTemplateFree && profiles.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text-muted shrink-0">Strategy</label>
                  <select
                    className="bg-input-bg border border-border text-text-primary text-sm py-1.5 px-3 rounded-lg w-full sm:w-auto"
                    value={activeProfile}
                    onChange={e => setActiveProfile(e.target.value)}
                  >
                    {profiles.map(p => (
                      <option key={p.key} value={p.key}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <label className="text-xs text-text-muted shrink-0">Sector</label>
                <select
                  className="bg-input-bg border border-border text-text-primary text-sm py-1.5 px-3 rounded-lg w-full sm:w-auto min-w-0"
                  value={sectorFilter}
                  onChange={e => setSectorFilter(e.target.value)}
                >
                  <option value="all">All sectors ({matches.length})</option>
                  {!isTemplateFree && snapshot?.sector && (
                    <option value="same">Same sector &mdash; {snapshot.sector} ({matches.filter(m => m.sector === snapshot.sector).length})</option>
                  )}
                  {sectors.map(s => (
                    <option key={s} value={s}>{s} ({matches.filter(m => m.sector === s).length})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 sm:ml-auto">
                <label className="text-xs text-text-muted shrink-0">Sort</label>
                <select
                  className="bg-input-bg border border-border text-text-primary text-sm py-1.5 px-3 rounded-lg w-full sm:w-auto"
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
              <p className="text-sm text-text-muted font-light">
                Top {sorted.length} of {universeSize ? universeSize.toLocaleString() + ' scanned' : matches.length} &mdash; ranked by {sortBy === 'score' ? 'similarity' : sortBy === 'growth' ? 'revenue growth' : 'sector'}
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
                  const fileLabel = snapshot ? `${snapshot.ticker}-${snapshot.date}` : activeAlgo;
                  downloadCSV(csv, `blueprint-matches-${fileLabel}.csv`);
                }}
                exportLabel="Export matches"
              />
            </div>

            {sorted.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface text-center py-8 text-text-muted text-sm font-light">
                No matches in this sector. Try "All sectors" to see all results.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {sorted.map((match, i) => (
                  <MatchCard key={match.ticker} match={match} snapshot={snapshot} rank={i + 1} profile={activeProfile} algo={activeAlgo} />
                ))}
              </div>
            )}
          </>
        );
      })()}
    </main>
  );
}
