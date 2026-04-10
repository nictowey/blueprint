import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sparkline from '../components/Sparkline';
import ComparisonRow, { MetricLabel } from '../components/ComparisonRow';
import { formatMetric, METRIC_LABELS } from '../utils/format';
import { getMetricColor } from '../utils/metricColor';

const METRIC_GROUPS = [
  { label: 'Overview',         metrics: ['marketCap', 'eps', 'dividendYield'] },
  { label: 'Valuation',        metrics: ['peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio'] },
  { label: 'Profitability',    metrics: ['grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin', 'returnOnEquity', 'returnOnAssets', 'returnOnCapital'] },
  { label: 'Growth',           metrics: ['revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY'] },
  { label: 'Financial Health', metrics: ['currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield', 'totalCash', 'totalDebt', 'freeCashFlow', 'operatingCashFlow'] },
  { label: 'Technical',        metrics: ['rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta', 'avgVolume'] },
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
        <>
        {/* Match score header */}
        {data.matchScore != null && (
          <div className="card mb-6 flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
            <div className="relative w-20 h-20 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#1e293b" strokeWidth="5" />
                <circle
                  cx="40" cy="40" r="34" fill="none"
                  stroke={data.matchScore >= 70 ? '#22c55e' : data.matchScore >= 50 ? '#eab308' : '#ef4444'}
                  strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 34}
                  strokeDashoffset={2 * Math.PI * 34 * (1 - data.matchScore / 100)}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-slate-100">
                {Math.round(data.matchScore)}
              </span>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="text-sm text-slate-400 mb-1">
                <span className="font-mono font-bold text-slate-200">{data.template.ticker}</span>
                <span className="text-slate-600 mx-2">vs</span>
                <span className="font-mono font-bold text-slate-200">{data.match.ticker}</span>
              </p>
              <p className="text-xs text-slate-500">{data.metricsCompared}/27 metrics compared</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {data.topMatches?.map(key => (
                  <span key={key} className="tag-green">{METRIC_LABELS[key] || key} ✓</span>
                ))}
                {data.topDifferences?.map(key => (
                  <span key={key} className="tag-yellow">{METRIC_LABELS[key] || key} ~</span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LEFT PANEL — Template (historical) */}
          <div className="card">
            <div className="mb-4 min-h-[72px]">
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
            <div className="bg-dark-bg rounded-lg p-4 mb-6 h-[140px]">
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
            {METRIC_GROUPS.map(group => (
              <div key={group.label}>
                <div className="text-xs text-slate-500 uppercase tracking-widest pt-4 pb-1 font-medium border-b border-dark-border/50">
                  {group.label}
                </div>
                {group.metrics.map(key => (
                  <div key={key} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0">
                    <span className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key]}</span>
                    <span className={`text-sm font-semibold ${data.template[key] == null ? 'text-slate-600' : 'text-slate-100'}`}>
                      {formatMetric(key, data.template[key])}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* RIGHT PANEL — Match (current) */}
          <div className="card">
            <div className="mb-4 min-h-[72px]">
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

            {/* Match sparkline — last 12 months */}
            <div className="bg-dark-bg rounded-lg p-4 mb-6 h-[140px]">
              <Sparkline
                data={data.matchSparkline}
                gainPct={data.matchSparklineGainPct}
                label="Last 12 months"
                period="12 months"
              />
            </div>

            {/* Price with color coding vs template */}
            <div className="flex items-center justify-between py-3 border-b border-dark-border mb-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Price</span>
              <span className="text-sm font-semibold text-slate-100">
                {formatMetric('price', data.match.price)}
              </span>
            </div>

            {/* Metrics with color coding and similarity bars */}
            {METRIC_GROUPS.map(group => (
              <div key={group.label}>
                <div className="text-xs text-slate-500 uppercase tracking-widest pt-4 pb-1 font-medium border-b border-dark-border/50">
                  {group.label}
                </div>
                {group.metrics.map(key => {
                  const leftVal = data.template[key];
                  const rightVal = data.match[key];
                  const colorClass = getMetricColor(key, leftVal, rightVal);
                  // Find per-metric similarity from API response
                  const metricScore = data.metricScores?.find(ms => ms.metric === key);
                  const sim = metricScore ? Math.round(metricScore.similarity * 100) : null;
                  return (
                    <div key={key} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0 gap-2">
                      <span className="text-xs text-slate-500 uppercase tracking-wider flex-shrink-0">{METRIC_LABELS[key]}</span>
                      <div className="flex items-center gap-2">
                        {sim != null && (
                          <div className="w-12 flex items-center gap-1" title={`${sim}% similar`}>
                            <div className="w-8 h-1.5 bg-dark-bg rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${sim}%`,
                                  backgroundColor: sim >= 80 ? '#22c55e' : sim >= 50 ? '#eab308' : '#ef4444',
                                }}
                              />
                            </div>
                            <span className="text-[9px] text-slate-600 w-6 text-right">{sim}</span>
                          </div>
                        )}
                        <span className={`text-sm font-semibold ${colorClass}`}>
                          {formatMetric(key, rightVal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        </>
      )}
    </main>
  );
}
