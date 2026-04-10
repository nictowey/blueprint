import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Sparkline from '../components/Sparkline';
import ComparisonRow, { MetricLabel } from '../components/ComparisonRow';
import { formatMetric, METRIC_LABELS } from '../utils/format';
import { getMetricColorFromScore, getMetricColor } from '../utils/metricColor';
import { httpError } from '../utils/httpError';
import PriceOverlayChart from '../components/PriceOverlayChart';
import ShareBar from '../components/ShareBar';

const METRIC_GROUPS = [
  { label: 'Overview',         metrics: ['marketCap', 'eps', 'dividendYield'] },
  { label: 'Valuation',        metrics: ['peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio'] },
  { label: 'Profitability',    metrics: ['grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin', 'returnOnEquity', 'returnOnAssets', 'returnOnCapital'] },
  { label: 'Growth',           metrics: ['revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY'] },
  { label: 'Financial Health', metrics: ['currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield', 'totalCash', 'totalDebt', 'freeCashFlow', 'operatingCashFlow'] },
  { label: 'Technical',        metrics: ['rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta', 'avgVolume'] },
];

import { addToWatchlist as saveToWatchlist, isOnWatchlist } from '../utils/watchlist';

function getInsight(data) {
  if (!data) return null;
  const s = data.matchScore;
  const tpl = data.template;
  const mtch = data.match;

  // Score tier description
  let tier;
  if (s >= 85) tier = { label: 'Excellent Match', color: 'text-green-400', borderColor: 'border-green-500/20', bgColor: 'bg-green-500/5', desc: 'These two stocks share remarkably similar financial profiles. The current stock mirrors the template across nearly all key metrics.' };
  else if (s >= 70) tier = { label: 'Strong Match', color: 'text-green-400', borderColor: 'border-green-500/20', bgColor: 'bg-green-500/5', desc: 'A strong resemblance. Most valuation, profitability, and growth metrics align well, though a few areas diverge.' };
  else if (s >= 55) tier = { label: 'Moderate Match', color: 'text-yellow-400', borderColor: 'border-yellow-500/20', bgColor: 'bg-yellow-500/5', desc: 'A partial match. Some key metrics align, but there are notable differences in certain areas worth investigating.' };
  else tier = { label: 'Weak Match', color: 'text-red-400', borderColor: 'border-red-500/20', bgColor: 'bg-red-500/5', desc: 'Limited similarity. These stocks share some characteristics but differ substantially across multiple dimensions.' };

  // Build specific observations
  const observations = [];

  // Growth comparison
  if (tpl.revenueGrowthYoY != null && mtch.revenueGrowthYoY != null) {
    const tGrowth = (tpl.revenueGrowthYoY * 100).toFixed(0);
    const mGrowth = (mtch.revenueGrowthYoY * 100).toFixed(0);
    if (Math.abs(tpl.revenueGrowthYoY - mtch.revenueGrowthYoY) < 0.1) {
      observations.push(`Both show similar revenue growth (~${mGrowth}% YoY)`);
    } else if (mtch.revenueGrowthYoY > tpl.revenueGrowthYoY) {
      observations.push(`Match is growing faster (${mGrowth}% vs ${tGrowth}% revenue YoY)`);
    } else {
      observations.push(`Template had higher revenue growth (${tGrowth}% vs ${mGrowth}% YoY)`);
    }
  }

  // Valuation comparison
  if (tpl.peRatio != null && mtch.peRatio != null) {
    if (Math.abs(tpl.peRatio - mtch.peRatio) / Math.max(tpl.peRatio, 1) < 0.2) {
      observations.push(`Valuations are aligned (P/E ~${mtch.peRatio.toFixed(0)}x)`);
    } else if (mtch.peRatio < tpl.peRatio) {
      observations.push(`Match trades at a lower P/E (${mtch.peRatio.toFixed(1)}x vs ${tpl.peRatio.toFixed(1)}x)`);
    } else {
      observations.push(`Match trades at a higher P/E (${mtch.peRatio.toFixed(1)}x vs ${tpl.peRatio.toFixed(1)}x)`);
    }
  }

  // Margin comparison
  if (tpl.operatingMargin != null && mtch.operatingMargin != null) {
    const diff = Math.abs(tpl.operatingMargin - mtch.operatingMargin);
    if (diff < 0.05) {
      observations.push(`Operating margins closely aligned (~${(mtch.operatingMargin * 100).toFixed(0)}%)`);
    }
  }

  // Sector note
  if (tpl.sector && mtch.sector) {
    if (tpl.sector === mtch.sector) {
      observations.push(`Both in the ${mtch.sector} sector`);
    } else {
      observations.push(`Different sectors: ${tpl.sector} vs ${mtch.sector}`);
    }
  }

  return { tier, observations };
}

export default function ComparisonDetail() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Support both navigate state and URL query params
  const ticker = state?.snapshot?.ticker || searchParams.get('ticker');
  const date = state?.snapshot?.date || searchParams.get('date');
  const matchTicker = state?.matchTicker || searchParams.get('match');
  const profile = state?.profile || searchParams.get('profile') || 'growth_breakout';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [watchlisted, setWatchlisted] = useState(() => matchTicker ? isOnWatchlist(matchTicker) : false);

  useEffect(() => {
    if (!ticker || !date || !matchTicker) navigate('/', { replace: true });
  }, [ticker, date, matchTicker, navigate]);

  // Update URL for shareable links
  useEffect(() => {
    if (!ticker || !date || !matchTicker) return;
    const currentT = searchParams.get('ticker');
    const currentD = searchParams.get('date');
    const currentM = searchParams.get('match');
    const profileParam = profile && profile !== 'growth_breakout' ? `&profile=${profile}` : '';
    if (currentT !== ticker || currentD !== date || currentM !== matchTicker) {
      navigate(`/comparison?ticker=${encodeURIComponent(ticker)}&date=${date}&match=${encodeURIComponent(matchTicker)}${profileParam}`, { replace: true, state });
    }
  }, [ticker, date, matchTicker]);

  useEffect(() => {
    if (!ticker || !date || !matchTicker) return;
    const params = new URLSearchParams({ ticker, date, matchTicker });
    if (profile && profile !== 'growth_breakout') params.set('profile', profile);
    fetch(`/api/comparison?${params}`)
      .then(async res => {
        if (!res.ok) throw new Error(await httpError(res, 'Comparison failed'));
        return res.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [ticker, date, matchTicker]);

  function handleAddToWatchlist() {
    if (!data?.match) return;
    saveToWatchlist({
      ticker: data.match.ticker,
      companyName: data.match.companyName,
      sector: data.match.sector,
      matchScore: data.matchScore,
      templateTicker: ticker,
      templateDate: date,
      price: data.match.price,
    });
    setWatchlisted(true);
  }

  if (!ticker || !date || !matchTicker) return null;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      {/* Nav */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mb-6 sm:mb-8">
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back to Results</button>
        <div className="flex items-center gap-2 flex-wrap">
          <ShareBar />
          {data && (
            <button
              className={`btn-secondary text-xs ${watchlisted ? 'text-green-400 border-green-500/30' : ''}`}
              onClick={handleAddToWatchlist}
              disabled={watchlisted}
          >
              {watchlisted ? '✓ Watchlisted' : '+ Watchlist'}
            </button>
          )}
        </div>
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

        {/* Investor insight */}
        {(() => {
          const insight = getInsight(data);
          if (!insight) return null;
          const { tier, observations } = insight;
          return (
            <div className={`card mb-6 ${tier.borderColor} ${tier.bgColor}`}>
              <div className="flex items-start gap-3">
                <div className={`text-lg font-bold ${tier.color} shrink-0`}>
                  {data.matchScore >= 70 ? '✦' : data.matchScore >= 55 ? '◆' : '○'}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200 mb-1">
                    <span className={tier.color}>{tier.label}</span>
                    <span className="text-slate-500 font-normal ml-2">— {tier.desc}</span>
                  </p>
                  {observations.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {observations.map((obs, i) => (
                        <span key={i} className="text-xs text-slate-400">• {obs}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Price overlay chart */}
        {data?.sparkline?.length > 1 && data?.matchSparkline?.length > 1 && (
          <div className="card mb-6 bg-dark-bg">
            <PriceOverlayChart
              templateData={data.sparkline}
              matchData={data.matchSparkline}
              templateTicker={data.template.ticker}
              matchTicker={data.match.ticker}
              templateLabel={`${data.template.ticker} (post-snapshot)`}
              matchLabel={`${data.match.ticker} (last 12mo)`}
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* LEFT PANEL — Template (historical) */}
          <div className="card">
            <div className="mb-4 min-h-[72px]">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Template · {data.template.date}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-lg sm:text-xl text-slate-100">{data.template.ticker}</span>
                <span className="text-slate-400 text-xs sm:text-sm">{data.template.companyName}</span>
              </div>
              {data.template.sector && (
                <span className="text-xs border border-dark-border text-slate-500 px-2 py-0.5 rounded-full mt-1 inline-block">
                  {data.template.sector}
                </span>
              )}
            </div>

            {/* Sparkline */}
            <div className="bg-dark-bg rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 h-[120px] sm:h-[140px]">
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
                  <div key={key} className="flex items-center justify-between py-2 sm:py-2.5 border-b border-dark-border last:border-0">
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
            <div className="bg-dark-bg rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 h-[120px] sm:h-[140px]">
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
                  // Find per-metric similarity from API response
                  const metricScore = data.metricScores?.find(ms => ms.metric === key);
                  const sim = metricScore ? Math.round(metricScore.similarity * 100) : null;
                  // Color based on similarity score (consistent with similarity bar)
                  const colorClass = metricScore ? getMetricColorFromScore(metricScore.similarity) : getMetricColor(key, leftVal, rightVal);
                  return (
                    <div key={key} className="flex items-center justify-between py-2 sm:py-2.5 border-b border-dark-border last:border-0 gap-2">
                      <span className="text-xs text-slate-500 uppercase tracking-wider flex-shrink-0">{METRIC_LABELS[key]}</span>
                      <div className="flex items-center gap-2">
                        {sim != null && (
                          <div className="w-12 flex items-center gap-1" title={`${sim}% similar`}>
                            <div className="w-8 h-1.5 bg-dark-bg rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${sim}%`,
                                  backgroundColor: sim >= 75 ? '#22c55e' : sim >= 40 ? '#eab308' : '#ef4444',
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
