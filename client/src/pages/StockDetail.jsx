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
  { key: 'templateMatch',     name: 'Template Match',     note: 'Needs a template ticker to score this engine.' },
  { key: 'momentumBreakout',  name: 'Momentum Breakout',  note: 'Price coiling under resistance with volume lift.' },
  { key: 'catalystDriven',    name: 'Catalyst-Driven',    note: 'Fresh fundamental catalyst hit within 24h.' },
  { key: 'ensembleConsensus', name: 'Ensemble Consensus', note: 'Top-of-pool across multiple engines.' },
];

function scoreTier(score) {
  if (score == null) return 'low';
  if (score >= 85) return 'high';
  if (score >= 70) return 'mid';
  return 'low';
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
  const [watchlisted, setWatchlisted] = useState(false);
  useEffect(() => { setWatchlisted(isOnWatchlist(ticker)); }, [ticker]);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    const snapshotUrl = date
      ? `/api/snapshot?ticker=${encodeURIComponent(ticker)}&date=${date}`
      : `/api/stock/${encodeURIComponent(ticker)}`;
    const scoresUrl = `/api/stock/${encodeURIComponent(ticker)}/engine-scores`;

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
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <BackLink onClick={() => navigate(-1)} />
        <div className="card text-center py-14 mt-6">
          <p className="font-display text-[28px] leading-tight mb-2">
            <span className="gold-grad">{ticker}</span> isn&rsquo;t in the universe
          </p>
          <p className="text-text-secondary text-[13px] mb-6">
            We only score tickers in the investable universe. Try another symbol.
          </p>
          <button className="btn-secondary" onClick={() => navigate(-1)}>Back</button>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
        <BackLink onClick={() => navigate(-1)} />
        <StockDetailSkeleton />
      </main>
    );
  }

  const findSimilarTo = date
    ? `/matches?ticker=${encodeURIComponent(ticker)}&date=${date}&algo=templateMatch`
    : `/matches?ticker=${encodeURIComponent(ticker)}&algo=templateMatch`;

  const subtitleParts = [
    snapshot?.companyName,
    snapshot?.sector,
    snapshot?.marketCap != null ? formatMetric('marketCap', snapshot.marketCap) : null,
  ].filter(Boolean);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <BackLink onClick={() => navigate(-1)} />
          <h1 className="font-display leading-[1.15] m-0 mt-3" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
            <span className="gold-grad">{ticker}</span>
          </h1>
          {subtitleParts.length > 0 && (
            <p className="text-text-secondary text-[13px] mt-2 m-0">
              {subtitleParts.join(' · ')}
            </p>
          )}
          {date && (
            <p className="label-xs mt-2" style={{ color: 'var(--color-brand-2)' }}>
              Snapshot · {date}
            </p>
          )}
          {snapshotError && !snapshot && (
            <p className="text-xs text-loss mt-2">Snapshot unavailable: {snapshotError}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            className={`btn-secondary text-[12px] ${watchlisted ? 'text-gain' : ''}`}
            onClick={handleAddToWatchlist}
            disabled={watchlisted || !snapshot}
          >
            {watchlisted ? '✓ Watchlisted' : '+ Watchlist'}
          </button>
          <Link to={findSimilarTo} className="btn-primary text-[12px] inline-flex items-center gap-1.5">
            Find similar
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      {snapshot?.price != null && (
        <div className="card mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="label-xs m-0">{date ? 'Close price' : 'Last price'}</p>
              <p className="num text-[28px] text-text-primary m-0 mt-1">
                {formatMetric('price', snapshot.price)}
              </p>
            </div>
            {snapshot.recentCloses?.length > 2 && (
              <MiniSparkline prices={snapshot.recentCloses} width={220} height={48} />
            )}
          </div>
        </div>
      )}

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <p className="section-label m-0">Engine scores</p>
          {date && scores && (
            <span className="label-xs" style={{ color: 'var(--color-brand-2)' }}>
              Live engines · metrics as of {date}
            </span>
          )}
        </div>

        {scoresError && !scores && (
          <p className="text-[13px] text-text-muted">Scores temporarily unavailable.</p>
        )}

        {scores && (
          <div className="flex flex-col divide-y divide-border/60">
            {ENGINE_META.map(meta => {
              const entry = scores.engines[meta.key];
              const isTemplate = meta.key === 'templateMatch';

              if (isTemplate) {
                return (
                  <div key={meta.key} className="flex items-center justify-between py-3 gap-4">
                    <div className="min-w-0">
                      <div className="text-[13px] text-text-primary">{meta.name}</div>
                      <div className="text-[11px] text-text-muted mt-0.5">{meta.note}</div>
                    </div>
                    <Link to={findSimilarTo} className="text-[12px] shrink-0" style={{ color: 'var(--color-brand-2)' }}>
                      Find similar →
                    </Link>
                  </div>
                );
              }

              if (!entry || entry.score == null) {
                return (
                  <div key={meta.key} className="flex items-center justify-between py-3 gap-4 opacity-70">
                    <div className="min-w-0">
                      <div className="text-[13px] text-text-primary">{meta.name}</div>
                      <div className="text-[11px] text-text-muted mt-0.5">{meta.note}</div>
                    </div>
                    <span className="label-xs">Insufficient data</span>
                  </div>
                );
              }

              const tier = scoreTier(entry.score);
              return (
                <Link
                  key={meta.key}
                  to={`/matches?algo=${meta.key}`}
                  className="group flex items-start justify-between gap-4 py-3 -mx-2 px-2 rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-[13px] text-text-primary">{meta.name}</span>
                      <span className="num text-[10px] text-text-muted">
                        #{entry.rank} of {entry.totalRanked}
                      </span>
                    </div>
                    {meta.key === 'ensembleConsensus' && entry.consensusEngines != null && (
                      <p className="text-[11px] text-text-muted mt-1 m-0">
                        {entry.consensusEngines} of {entry.totalEngines} engines rank this top-of-pool
                      </p>
                    )}
                    {entry.topSignals?.length > 0 && (
                      <p className="text-[11px] text-text-muted mt-1 m-0">
                        <span className="label-xs mr-1.5">Top</span>
                        {entry.topSignals.join(' · ')}
                      </p>
                    )}
                    {entry.weakSignals?.length > 0 && (
                      <p className="text-[11px] text-text-muted/70 mt-0.5 m-0">
                        <span className="label-xs mr-1.5">Weak</span>
                        {entry.weakSignals.join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`score-badge score-${tier}`}>{entry.score}</div>
                    <svg
                      className="w-3.5 h-3.5 text-text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {snapshot && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          {METRIC_GROUPS.map(group => (
            <div key={group.label} className="card">
              <p className="section-label mb-3 m-0">{group.label}</p>
              <div className="divide-y divide-border/50">
                {group.metrics.map(key => (
                  <div key={key} className="flex items-center justify-between py-2">
                    <span className="label-xs">
                      {METRIC_LABELS[key] || key}
                    </span>
                    <span className={`num text-[13px] ${snapshot[key] == null ? 'text-text-muted/50' : 'text-text-primary'}`}>
                      {formatMetric(key, snapshot[key])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function BackLink({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}

function StockDetailSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mt-3 h-10 w-32 bg-surface-2 rounded-md" />
      <div className="mt-3 h-4 w-64 bg-surface-2 rounded" />
      <div className="card mt-6 mb-6">
        <div className="h-3 w-20 bg-surface-2 rounded mb-3" />
        <div className="h-8 w-28 bg-surface-2 rounded" />
      </div>
      <div className="card mb-6">
        <div className="h-3 w-24 bg-surface-2 rounded mb-4" />
        <div className="flex flex-col gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-3 w-40 bg-surface-2 rounded" />
              <div className="h-7 w-11 bg-surface-2 rounded" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card">
            <div className="h-3 w-20 bg-surface-2 rounded mb-3" />
            {[...Array(4)].map((_, j) => (
              <div key={j} className="flex items-center justify-between py-2">
                <div className="h-3 w-24 bg-surface-2 rounded" />
                <div className="h-3 w-14 bg-surface-2 rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
