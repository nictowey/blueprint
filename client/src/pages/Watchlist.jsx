import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWatchlist, removeFromWatchlist, clearWatchlist } from '../utils/watchlist';
import { toCSV, downloadCSV } from '../utils/export';

function timeSince(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function scoreTier(score) {
  if (score == null) return 'low';
  if (score >= 85) return 'high';
  if (score >= 70) return 'mid';
  return 'low';
}

export default function WatchlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState(() => getWatchlist());
  const [liveData, setLiveData] = useState({});
  const [loadingLive, setLoadingLive] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const fetchLiveData = useCallback(async () => {
    if (items.length === 0) return;
    setLoadingLive(true);
    const results = {};

    for (let i = 0; i < items.length; i += 3) {
      const batch = items.slice(i, i + 3);
      const promises = batch.map(async (item) => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(item.ticker)}`);
          if (!res.ok) return;
          const data = await res.json();
          const match = Array.isArray(data) ? data.find(d => d.symbol === item.ticker) : null;
          if (match) {
            results[item.ticker] = {
              price: match.price || null,
              change: match.changesPercentage || null,
            };
          }
        } catch { /* ignore individual failures */ }
      });
      await Promise.allSettled(promises);
    }

    setLiveData(results);
    setLoadingLive(false);
  }, [items]);

  useEffect(() => {
    fetchLiveData();
  }, [fetchLiveData]);

  function handleRemove(ticker, e) {
    e?.stopPropagation();
    removeFromWatchlist(ticker);
    setItems(getWatchlist());
  }

  function handleClearAll() {
    clearWatchlist();
    setItems([]);
    setConfirmClear(false);
  }

  function gainSinceAdd(item) {
    const live = liveData[item.ticker];
    if (!live?.price || !item.priceAtAdd) return null;
    return ((live.price - item.priceAtAdd) / item.priceAtAdd) * 100;
  }

  function handleExport() {
    const columns = [
      { key: 'ticker', label: 'Ticker' },
      { key: 'companyName', label: 'Company' },
      { key: 'sector', label: 'Sector' },
      { key: 'matchScore', label: 'Match Score' },
      { key: 'templateTicker', label: 'Template Ticker' },
      { key: 'templateDate', label: 'Template Date' },
      { key: 'priceAtAdd', label: 'Price When Added', format: r => r.priceAtAdd?.toFixed(2) },
      { key: 'currentPrice', label: 'Current Price', format: r => liveData[r.ticker]?.price?.toFixed(2) },
      { key: 'gainPct', label: 'Gain %', format: r => { const g = gainSinceAdd(r); return g != null ? g.toFixed(1) : ''; } },
      { key: 'addedAt', label: 'Added Date', format: r => r.addedAt?.slice(0, 10) },
    ];
    const csv = toCSV(items, columns);
    downloadCSV(csv, `blueprint-watchlist-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="min-w-0">
          <p className="label-xs mb-2">Your workspace</p>
          <h1 className="font-display leading-[1.05] m-0" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}>
            <span className="gold-grad">Watchlist</span>
          </h1>
          <p className="text-text-secondary text-[13px] mt-2 m-0">
            {items.length === 0
              ? 'Nothing tracked yet. Save matches you want to revisit.'
              : `${items.length} ${items.length === 1 ? 'stock' : 'stocks'} · live quotes update on refresh`}
          </p>
        </div>

        {items.length > 0 && (
          <div className="flex flex-wrap gap-2 shrink-0 justify-end">
            <button
              className="btn-secondary text-[12px]"
              onClick={fetchLiveData}
              disabled={loadingLive}
            >
              {loadingLive ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 border border-text-muted/50 border-t-text-secondary rounded-full animate-spin" />
                  Refreshing
                </span>
              ) : 'Refresh'}
            </button>
            <button className="btn-secondary text-[12px]" onClick={handleExport}>
              Export CSV
            </button>
            {!confirmClear ? (
              <button
                className="btn-secondary text-[12px] text-text-muted hover:text-loss"
                onClick={() => setConfirmClear(true)}
              >
                Clear
              </button>
            ) : (
              <>
                <button className="btn-secondary text-[12px] text-loss" onClick={handleClearAll}>Confirm</button>
                <button className="btn-secondary text-[12px]" onClick={() => setConfirmClear(false)}>Cancel</button>
              </>
            )}
          </div>
        )}
      </div>

      {items.length === 0 && (
        <div className="card text-center py-14">
          <div className="w-12 h-12 mx-auto mb-5 rounded-full bg-brand/10 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 2z" stroke="#c9a84c" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
            </svg>
          </div>
          <p className="font-display text-[24px] leading-tight mb-2 m-0">
            Start a <span className="gold-grad">watchlist</span>
          </p>
          <p className="text-text-secondary text-[13px] mb-6 max-w-sm mx-auto">
            Find matches you want to track — we&rsquo;ll keep live prices and gain-since-added here.
          </p>
          <button className="btn-primary" onClick={() => navigate('/')}>
            Start screening →
          </button>
          <p className="text-text-muted text-[11px] mt-6 m-0">
            Or try a quick example:{' '}
            <button className="hover:underline" style={{ color: 'var(--color-brand-2)' }} onClick={() => navigate('/matches?ticker=CLS&date=2023-12-01')}>CLS · Dec 2023</button>
            {' · '}
            <button className="hover:underline" style={{ color: 'var(--color-brand-2)' }} onClick={() => navigate('/matches?ticker=NVDA&date=2023-01-03')}>NVDA · Jan 2023</button>
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="card p-0 overflow-hidden">
          {items.map((item, idx) => {
            const live = liveData[item.ticker];
            const gain = gainSinceAdd(item);
            const tier = scoreTier(item.matchScore);
            const hasMatch = item.templateTicker && item.templateDate;

            return (
              <div
                key={item.ticker}
                className={`group relative flex items-start gap-4 px-4 sm:px-5 py-4 cursor-pointer transition-colors hover:bg-surface-2 ${idx < items.length - 1 ? 'border-b border-border/60' : ''}`}
                onClick={() => navigate(`/stock/${encodeURIComponent(item.ticker)}`)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/stock/${encodeURIComponent(item.ticker)}`)}
              >
                {item.matchScore != null && (
                  <div className={`score-badge score-${tier} shrink-0 mt-0.5`}>
                    {Math.round(item.matchScore)}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="ticker text-[15px] text-text-primary">{item.ticker}</span>
                    <span className="text-[12px] text-text-secondary truncate">{item.companyName}</span>
                    {item.sector && (
                      <span className="text-[10px] text-text-muted">· {item.sector}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                    {live?.price != null ? (
                      <span className="num text-[13px] text-text-primary">
                        ${live.price.toFixed(2)}
                      </span>
                    ) : (
                      <span className="num text-[13px] text-text-muted/60">—</span>
                    )}
                    {live?.change != null && (
                      <span className={`num text-[11px] ${live.change >= 0 ? 'text-gain' : 'text-loss'}`}>
                        {live.change >= 0 ? '+' : ''}{live.change.toFixed(2)}% today
                      </span>
                    )}
                    {gain != null && (
                      <span className={`num text-[11px] ${gain >= 0 ? 'text-gain/80' : 'text-loss/80'}`}>
                        {gain >= 0 ? '+' : ''}{gain.toFixed(1)}% since added
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px] text-text-muted">
                    {item.templateTicker && (
                      <span>
                        Matched to <span className="ticker text-[11px] text-text-secondary">{item.templateTicker}</span>
                        {item.templateDate && <span className="num"> · {item.templateDate}</span>}
                      </span>
                    )}
                    {item.priceAtAdd != null && (
                      <span className="num">Added at ${item.priceAtAdd.toFixed(2)}</span>
                    )}
                    <span>· {timeSince(item.addedAt)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {hasMatch && (
                    <button
                      className="text-[11px] text-text-muted hover:text-text-primary px-2 py-1 rounded-md hover:bg-surface transition-colors"
                      onClick={e => {
                        e.stopPropagation();
                        navigate(`/comparison?ticker=${encodeURIComponent(item.templateTicker)}&date=${item.templateDate}&match=${encodeURIComponent(item.ticker)}`);
                      }}
                      title="View comparison"
                    >
                      Compare
                    </button>
                  )}
                  <button
                    className="text-[11px] text-text-muted/60 hover:text-loss px-2 py-1 rounded-md transition-colors"
                    onClick={e => handleRemove(item.ticker, e)}
                    title="Remove"
                  >
                    ×
                  </button>
                  <svg
                    className="w-3.5 h-3.5 text-text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all ml-1"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
