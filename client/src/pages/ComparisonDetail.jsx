import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sparkline from '../components/Sparkline';
import ComparisonRow, { MetricLabel } from '../components/ComparisonRow';
import { formatMetric, METRIC_LABELS } from '../utils/format';

const DISPLAY_METRICS = [
  'peRatio', 'priceToSales', 'revenueGrowthYoY',
  'grossMargin', 'rsi14', 'pctBelowHigh',
];

const WATCHLIST_KEY = 'blueprint_watchlist';

function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); } catch { return []; }
}

function saveToWatchlist(ticker, companyName) {
  const list = getWatchlist();
  if (list.find(item => item.ticker === ticker)) return; // already saved
  list.push({ ticker, companyName, addedAt: new Date().toISOString() });
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

export default function ComparisonDetail() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const snapshot = state?.snapshot;
  const matchTicker = state?.matchTicker;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [watchlisted, setWatchlisted] = useState(false);

  useEffect(() => {
    if (!snapshot || !matchTicker) navigate('/', { replace: true });
  }, [snapshot, matchTicker, navigate]);

  useEffect(() => {
    if (!snapshot || !matchTicker) return;
    const params = new URLSearchParams({
      ticker:      snapshot.ticker,
      date:        snapshot.date,
      matchTicker: matchTicker,
    });
    fetch(`/api/comparison?${params}`)
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Failed'); });
        return res.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [snapshot, matchTicker]);

  function addToWatchlist() {
    if (!data?.match) return;
    saveToWatchlist(data.match.ticker, data.match.companyName);
    setWatchlisted(true);
  }

  if (!snapshot || !matchTicker) return null;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      {/* Nav */}
      <div className="flex items-center justify-between mb-8">
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back to Results</button>
        {data && (
          <button
            className={`btn-secondary ${watchlisted ? 'text-green-400 border-green-500/30' : ''}`}
            onClick={addToWatchlist}
            disabled={watchlisted}
          >
            {watchlisted ? '✓ Added to Watchlist' : 'Add to Watchlist'}
          </button>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="card border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {data && !loading && (
        <div className="grid grid-cols-2 gap-6">
          {/* LEFT PANEL — Template (historical) */}
          <div className="card">
            <div className="mb-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Template · {data.template.date}</p>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xl text-slate-100">{data.template.ticker}</span>
                <span className="text-slate-400 text-sm">{data.template.companyName}</span>
              </div>
              {data.template.sector && (
                <span className="text-xs border border-dark-border text-slate-500 px-2 py-0.5 rounded-full mt-1 inline-block">
                  {data.template.sector}
                </span>
              )}
            </div>

            {/* Sparkline */}
            <div className="bg-dark-bg rounded-lg p-4 mb-6">
              <Sparkline data={data.sparkline} gainPct={data.sparklineGainPct} />
            </div>

            {/* Price */}
            <div className="flex items-center justify-between py-3 border-b border-dark-border mb-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Price</span>
              <span className="text-sm font-semibold text-slate-100">
                {formatMetric('price', data.template.price)}
              </span>
            </div>

            {/* Metrics */}
            {DISPLAY_METRICS.map(key => (
              <div key={key} className="flex items-center justify-between py-3 border-b border-dark-border last:border-0">
                <span className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key]}</span>
                <span className={`text-sm font-semibold ${data.template[key] == null ? 'text-slate-600' : 'text-slate-100'}`}>
                  {formatMetric(key, data.template[key])}
                </span>
              </div>
            ))}
          </div>

          {/* RIGHT PANEL — Match (current) */}
          <div className="card">
            <div className="mb-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                Current · {data.match.date}
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xl text-slate-100">{data.match.ticker}</span>
                <span className="text-slate-400 text-sm">{data.match.companyName}</span>
              </div>
              {data.match.sector && (
                <span className="text-xs border border-dark-border text-slate-500 px-2 py-0.5 rounded-full mt-1 inline-block">
                  {data.match.sector}
                </span>
              )}
            </div>

            {/* Spacer to align with sparkline area */}
            <div className="bg-dark-bg rounded-lg p-4 mb-6 flex items-center justify-center" style={{ minHeight: '120px' }}>
              <p className="text-slate-600 text-sm text-center">
                Current profile as of today
              </p>
            </div>

            {/* Price with color coding vs template */}
            <div className="flex items-center justify-between py-3 border-b border-dark-border mb-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Price</span>
              <span className="text-sm font-semibold text-slate-100">
                {formatMetric('price', data.match.price)}
              </span>
            </div>

            {/* Metrics with color coding */}
            {DISPLAY_METRICS.map(key => {
              const leftVal = data.template[key];
              const rightVal = data.match[key];
              let colorClass = 'text-slate-100';
              if (leftVal != null && rightVal != null && leftVal !== 0) {
                const pct = Math.abs((rightVal - leftVal) / Math.abs(leftVal)) * 100;
                if (pct <= 15) colorClass = 'text-green-400';
                else if (pct <= 40) colorClass = 'text-yellow-400';
                else colorClass = 'text-red-400';
              } else if (rightVal == null) {
                colorClass = 'text-slate-600';
              }
              return (
                <div key={key} className="flex items-center justify-between py-3 border-b border-dark-border last:border-0">
                  <span className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key]}</span>
                  <span className={`text-sm font-semibold ${colorClass}`}>
                    {formatMetric(key, rightVal)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
