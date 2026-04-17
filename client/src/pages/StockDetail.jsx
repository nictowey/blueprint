import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { formatMetric, METRIC_LABELS } from '../utils/format';
import MiniSparkline from '../components/MiniSparkline';
import { addToWatchlist as saveToWatchlist, isOnWatchlist } from '../utils/watchlist';

const METRIC_GROUPS = [
  { label: 'Valuation',      metrics: ['peRatio', 'pegRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue'] },
  { label: 'Growth',         metrics: ['revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY'] },
  { label: 'Margins',        metrics: ['grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin'] },
  { label: 'Quality',        metrics: ['returnOnEquity', 'returnOnAssets', 'returnOnCapital', 'freeCashFlowYield'] },
  { label: 'Balance Sheet',  metrics: ['currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA'] },
  { label: 'Technicals',     metrics: ['rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta', 'relativeVolume'] },
];

const ENGINE_META = [
  { key: 'templateMatch',     name: 'Template Match',     note: 'requires a template ticker' },
  { key: 'momentumBreakout',  name: 'Momentum Breakout' },
  { key: 'catalystDriven',    name: 'Catalyst-Driven' },
  { key: 'ensembleConsensus', name: 'Ensemble Consensus' },
];

function scoreColorClass(score) {
  if (score == null) return 'text-text-muted';
  if (score >= 70) return 'text-gain';
  if (score >= 55) return 'text-brand';
  return 'text-loss';
}

export default function StockDetail() {
  const { ticker } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const date = searchParams.get('date');

  const [snapshot, setSnapshot] = useState(state?.snapshot || null);
  const [snapshotError, setSnapshotError] = useState(null);
  const [scores, setScores] = useState(null);
  const [scoresError, setScoresError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [watchlisted, setWatchlisted] = useState(() => isOnWatchlist(ticker));

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    // Always build a snapshot URL — with date if present, without otherwise
    const snapshotUrl = date
      ? `/api/snapshot?ticker=${encodeURIComponent(ticker)}&date=${date}`
      : `/api/snapshot?ticker=${encodeURIComponent(ticker)}`;
    const scoresUrl = `/api/stock/${encodeURIComponent(ticker)}/engine-scores`;

    // Only fetch snapshot if we don't already have one (passed via router state)
    const snapshotPromise = !snapshot
      ? fetch(snapshotUrl).then(async res => {
          if (!res.ok) throw new Error(`Snapshot ${res.status}`);
          return res.json();
        })
      : Promise.resolve(snapshot);

    const scoresPromise = fetch(scoresUrl).then(async res => {
      if (res.status === 404) {
        setNotFound(true);
        return null;
      }
      if (!res.ok) throw new Error(`Scores ${res.status}`);
      return res.json();
    });

    Promise.allSettled([snapshotPromise, scoresPromise]).then(([snapRes, scoreRes]) => {
      if (cancelled) return;
      if (snapRes.status === 'fulfilled' && snapRes.value) setSnapshot(snapRes.value);
      if (snapRes.status === 'rejected') setSnapshotError(snapRes.reason?.message || 'Snapshot failed');
      if (scoreRes.status === 'fulfilled') setScores(scoreRes.value);
      if (scoreRes.status === 'rejected') setScoresError(scoreRes.reason?.message || 'Scores failed');
      setLoading(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, date]);

  function handleAddToWatchlist() {
    if (!snapshot) return;
    saveToWatchlist({
      ticker: snapshot.ticker,
      companyName: snapshot.companyName,
      sector: snapshot.sector,
      price: snapshot.price,
    });
    setWatchlisted(true);
  }

  if (!ticker) return null;

  if (notFound) {
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="card text-center py-10">
          <p className="text-text-primary text-base font-semibold mb-2">Ticker not found</p>
          <p className="text-text-secondary text-sm mb-6 font-light">
            {ticker} isn't in the investable universe.
          </p>
          <button className="btn-secondary" onClick={() => navigate(-1)}>&larr; Back</button>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex justify-center py-14">
          <div className="w-8 h-8 border-3 border-border border-t-brand rounded-full animate-spin" />
        </div>
      </main>
    );
  }

  const findSimilarTo = date
    ? `/matches?ticker=${encodeURIComponent(ticker)}&date=${date}&algo=templateMatch`
    : `/matches?ticker=${encodeURIComponent(ticker)}&algo=templateMatch`;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Section 1: Header card */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono font-bold text-2xl sm:text-3xl text-text-primary">{ticker}</span>
              {snapshot?.companyName && (
                <span className="text-text-secondary text-sm font-light truncate">{snapshot.companyName}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {snapshot?.sector && (
                <span className="text-[10px] text-text-muted px-2 py-0.5 rounded-md bg-surface border border-border">
                  {snapshot.sector}
                </span>
              )}
              {snapshot?.marketCap != null && (
                <span className="text-xs text-text-muted font-mono">
                  {formatMetric('marketCap', snapshot.marketCap)}
                </span>
              )}
            </div>
            {date && (
              <p className="text-xs text-amber-500/80 mt-2">Viewing metrics as of {date}</p>
            )}
            {snapshotError && !snapshot && (
              <p className="text-xs text-loss mt-2">Snapshot unavailable: {snapshotError}</p>
            )}
          </div>
          <button className="btn-secondary shrink-0" onClick={() => navigate(-1)}>&larr; Back</button>
        </div>
      </div>

      {/* Section 2: Price strip */}
      {snapshot?.price != null && (
        <div className="card mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
                {date ? 'Close' : 'Current price'}
              </p>
              <p className="text-xl font-semibold text-text-primary font-mono">
                {formatMetric('price', snapshot.price)}
              </p>
            </div>
            {snapshot.recentCloses?.length > 2 && (
              <MiniSparkline prices={snapshot.recentCloses} width={160} height={40} />
            )}
          </div>
        </div>
      )}

      {/* Section 3: Engine scorecard */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-label">Engine scores</h2>
          {date && scores && (
            <span className="text-[10px] text-amber-500/80">
              Engine scores are current. Metrics shown as of {date}.
            </span>
          )}
        </div>

        {scoresError && !scores && (
          <p className="text-sm text-text-muted font-light">Scores temporarily unavailable.</p>
        )}

        {scores && (
          <div className="flex flex-col gap-2">
            {ENGINE_META.map(meta => {
              const entry = scores.engines[meta.key];
              const isTemplate = meta.key === 'templateMatch';

              if (isTemplate) {
                return (
                  <div key={meta.key} className="flex items-center justify-between py-2 border-b border-border/50">
                    <div>
                      <span className="text-sm text-text-primary font-medium">{meta.name}</span>
                      <span className="text-xs text-text-muted ml-2 font-light">— {meta.note}</span>
                    </div>
                    <Link to={findSimilarTo} className="text-xs text-brand hover:underline">
                      Find similar stocks →
                    </Link>
                  </div>
                );
              }

              if (!entry || entry.score == null) {
                return (
                  <div key={meta.key} className="flex items-center justify-between py-2 border-b border-border/50">
                    <span className="text-sm text-text-primary font-medium">{meta.name}</span>
                    <span className="text-xs text-text-muted font-light">— insufficient data</span>
                  </div>
                );
              }

              return (
                <Link
                  key={meta.key}
                  to={`/matches?algo=${meta.key}`}
                  className="flex items-start justify-between py-2 border-b border-border/50 hover:bg-surface-hover rounded px-1 -mx-1 transition-colors"
                >
                  <div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-sm text-text-primary font-medium">{meta.name}</span>
                      <span className={`font-mono font-bold text-base ${scoreColorClass(entry.score)}`}>
                        {entry.score}
                      </span>
                      <span className="text-xs text-text-muted font-mono">
                        ranked #{entry.rank} of {entry.totalRanked}
                      </span>
                    </div>
                    {meta.key === 'ensembleConsensus' && entry.consensusEngines != null && (
                      <p className="text-[10px] text-text-muted font-light mt-0.5">
                        {entry.consensusEngines} / {entry.totalEngines} engines rank this top-of-pool
                      </p>
                    )}
                    {entry.topSignals?.length > 0 && (
                      <p className="text-[10px] text-text-muted font-light mt-0.5">
                        Top signals: {entry.topSignals.join(', ')}
                      </p>
                    )}
                    {entry.weakSignals?.length > 0 && (
                      <p className="text-[10px] text-text-muted/70 font-light mt-0.5">
                        Low signal: {entry.weakSignals.join(', ')}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 5: Primary CTA (placed before metrics per spec note — repeated at bottom) */}
      <div className="mb-6">
        <Link to={findSimilarTo} className="btn-primary w-full sm:w-auto inline-flex items-center gap-2">
          Find similar stocks →
        </Link>
      </div>

      {/* Section 4: Metrics groups */}
      {snapshot && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {METRIC_GROUPS.map(group => (
            <div key={group.label} className="card">
              <p className="section-label mb-3">{group.label}</p>
              {group.metrics.map(key => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-border/30 last:border-b-0">
                  <span className="text-xs text-text-muted uppercase tracking-wider">
                    {METRIC_LABELS[key] || key}
                  </span>
                  <span className={`text-sm font-mono font-semibold ${snapshot[key] == null ? 'text-text-muted/40' : 'text-text-primary'}`}>
                    {formatMetric(key, snapshot[key])}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Section 5 (bottom repeat) + Section 6 secondary actions */}
      <div className="flex flex-col sm:flex-row gap-3 mt-6">
        <Link to={findSimilarTo} className="btn-primary inline-flex items-center gap-2">
          Find similar stocks →
        </Link>
        <button
          className={`btn-secondary ${watchlisted ? 'text-emerald-400 border-emerald-500/20' : ''}`}
          onClick={handleAddToWatchlist}
          disabled={watchlisted || !snapshot}
        >
          {watchlisted ? '✓ Watchlisted' : '+ Watchlist'}
        </button>
      </div>
    </main>
  );
}
