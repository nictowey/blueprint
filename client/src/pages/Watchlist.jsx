import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWatchlist, removeFromWatchlist, clearWatchlist } from '../utils/watchlist';
import { toCSV, downloadCSV } from '../utils/export';
import MiniSparkline from '../components/MiniSparkline';

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

export default function WatchlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState(() => getWatchlist());
  const [liveData, setLiveData] = useState({});
  const [loadingLive, setLoadingLive] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Fetch live prices for all watchlist items
  const fetchLiveData = useCallback(async () => {
    if (items.length === 0) return;
    setLoadingLive(true);
    const results = {};

    // Batch fetch — 3 at a time to stay within rate limits
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

    // Also fetch recent sparkline data from universe status
    try {
      const statusRes = await fetch('/api/status');
      if (statusRes.ok) {
        const status = await statusRes.json();
        // We don't get individual prices from status, but we know the server is up
      }
    } catch { /* ignore */ }

    setLiveData(results);
    setLoadingLive(false);
  }, [items]);

  useEffect(() => {
    fetchLiveData();
  }, [fetchLiveData]);

  function handleRemove(ticker) {
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

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display text-warm-white">Watchlist</h1>
          <p className="text-sm text-warm-muted mt-1 font-light">
            {items.length === 0 ? 'No stocks saved yet' : `${items.length} stock${items.length > 1 ? 's' : ''} tracked`}
          </p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <button
              className="btn-secondary text-xs"
              onClick={() => {
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
              }}
            >
              Export CSV
            </button>
          )}
          {items.length > 0 && (
            <button
              className="btn-secondary text-xs"
              onClick={fetchLiveData}
              disabled={loadingLive}
            >
              {loadingLive ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border border-warm-muted/50 border-t-warm-gray rounded-full animate-spin" />
                  Refreshing…
                </span>
              ) : 'Refresh'}
            </button>
          )}
          {items.length > 0 && !confirmClear && (
            <button className="btn-secondary text-xs text-red-400/60 hover:text-red-400" onClick={() => setConfirmClear(true)}>
              Clear all
            </button>
          )}
          {confirmClear && (
            <div className="flex gap-1">
              <button className="btn-secondary text-xs text-red-400" onClick={handleClearAll}>Confirm</button>
              <button className="btn-secondary text-xs" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="card text-center py-16">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <path d="M8 2l1.8 3.6L14 6.4l-3 2.9.7 4.1L8 11.4l-3.7 2 .7-4.1-3-2.9 4.2-.8L8 2z" stroke="#c9a84c" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
            </svg>
          </div>
          <p className="text-warm-white text-lg mb-2 font-display">Your watchlist is empty</p>
          <p className="text-warm-muted text-sm mb-4 max-w-sm mx-auto font-light">
            Find matching stocks and add them to your watchlist from the comparison page to track their performance.
          </p>
          <button className="btn-primary mb-4" onClick={() => navigate('/')}>
            Start screening →
          </button>
          <p className="text-warm-muted text-xs font-light">
            Or try a quick example: <button className="text-accent hover:underline" onClick={() => navigate('/matches?ticker=CLS&date=2023-12-01')}>CLS Dec 2023</button>
            {' · '}
            <button className="text-accent hover:underline" onClick={() => navigate('/matches?ticker=NVDA&date=2023-01-03')}>NVDA Jan 2023</button>
          </p>
        </div>
      )}

      {/* Watchlist items */}
      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map(item => {
            const live = liveData[item.ticker];
            const gain = gainSinceAdd(item);

            return (
              <div key={item.ticker} className="card hover:border-dark-border-hover transition-all duration-200">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: ticker info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-mono font-bold text-warm-white text-base">{item.ticker}</span>
                      <span className="text-warm-gray text-sm truncate font-light">{item.companyName}</span>
                      {item.sector && (
                        <span className="text-xs border border-dark-border text-warm-muted px-2 py-0.5 rounded-full">
                          {item.sector}
                        </span>
                      )}
                    </div>

                    {/* Price row */}
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {live?.price != null && (
                        <span className="text-sm text-warm-white font-semibold font-mono">
                          ${live.price.toFixed(2)}
                        </span>
                      )}
                      {live?.change != null && (
                        <span className={`text-xs font-medium font-mono ${live.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {live.change >= 0 ? '+' : ''}{live.change.toFixed(2)}% today
                        </span>
                      )}
                      {gain != null && (
                        <span className={`text-xs font-mono ${gain >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                          {gain >= 0 ? '+' : ''}{gain.toFixed(1)}% since added
                        </span>
                      )}
                    </div>

                    {/* Match context */}
                    <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-warm-muted">
                      {item.matchScore && (
                        <span>
                          Score: <span className={`font-mono ${item.matchScore >= 70 ? 'text-emerald-400/70' : item.matchScore >= 55 ? 'text-accent/70' : 'text-red-400/70'}`}>
                            {Math.round(item.matchScore)}
                          </span>
                        </span>
                      )}
                      {item.templateTicker && (
                        <span className="font-light">
                          Matched to <span className="text-warm-gray font-mono">{item.templateTicker}</span>
                          {item.templateDate && <span className="text-warm-muted"> ({item.templateDate})</span>}
                        </span>
                      )}
                      {item.priceAtAdd != null && (
                        <span className="font-mono">Added at ${item.priceAtAdd.toFixed(2)}</span>
                      )}
                      <span className="font-light">{timeSince(item.addedAt)}</span>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {item.templateTicker && item.templateDate && (
                      <button
                        className="btn-secondary text-xs px-2.5 py-1 hover:border-accent/30 hover:text-accent"
                        onClick={() => navigate(`/comparison?ticker=${encodeURIComponent(item.templateTicker)}&date=${item.templateDate}&match=${encodeURIComponent(item.ticker)}`)}
                      >
                        View match
                      </button>
                    )}
                    <button
                      className="text-xs text-red-400/50 hover:text-red-400 transition-colors px-2.5 py-1"
                      onClick={() => handleRemove(item.ticker)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
