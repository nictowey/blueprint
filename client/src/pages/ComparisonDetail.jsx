import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
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
  if (s >= 85) tier = { label: 'Excellent Match', color: 'text-emerald-400', borderColor: 'border-emerald-500/15', bgColor: 'bg-emerald-500/5', desc: 'These two stocks share remarkably similar financial profiles. The current stock mirrors the template across nearly all key metrics.' };
  else if (s >= 70) tier = { label: 'Strong Match', color: 'text-emerald-400', borderColor: 'border-emerald-500/15', bgColor: 'bg-emerald-500/5', desc: 'A strong resemblance. Most valuation, profitability, and growth metrics align well, though a few areas diverge.' };
  else if (s >= 55) tier = { label: 'Moderate Match', color: 'text-brand', borderColor: 'border-brand/15', bgColor: 'bg-brand/5', desc: 'A partial match. Some key metrics align, but there are notable differences in certain areas worth investigating.' };
  else tier = { label: 'Weak Match', color: 'text-red-400', borderColor: 'border-red-500/15', bgColor: 'bg-red-500/5', desc: 'Limited similarity. These stocks share some characteristics but differ substantially across multiple dimensions.' };

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
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 animate-fade-in">
      {/* Editorial header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="text-[12px] text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1.5 mb-3"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Back to results
          </button>
          {data ? (
            <h1 className="font-display leading-[1.15] m-0" style={{ fontSize: 'clamp(1.75rem, 3vw, 2.25rem)' }}>
              <Link to={`/stock/${encodeURIComponent(data.template.ticker)}?date=${data.template.date}`} className="gold-grad hover:underline">{data.template.ticker}</Link>
              <span className="text-text-muted italic mx-3" style={{ fontSize: '0.75em' }}>vs</span>
              <Link to={`/stock/${encodeURIComponent(data.match.ticker)}?date=${data.match.date || data.template.date}`} className="gold-grad hover:underline">{data.match.ticker}</Link>
            </h1>
          ) : (
            <h1 className="font-display leading-[1.15] m-0" style={{ fontSize: 'clamp(1.75rem, 3vw, 2.25rem)' }}>
              <span className="gold-grad">{ticker}</span>
              <span className="text-text-muted italic mx-3" style={{ fontSize: '0.75em' }}>vs</span>
              <span className="gold-grad">{matchTicker}</span>
            </h1>
          )}
          {data && (
            <p className="text-text-secondary text-sm mt-2 max-w-2xl leading-relaxed m-0">
              How closely {data.match.ticker} today mirrors {data.template.ticker} at {data.template.date}.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <ShareBar />
          {data && (
            <button
              className={`btn-secondary text-xs ${watchlisted ? 'text-emerald-400 border-emerald-500/20' : 'hover:border-brand/30 hover:text-brand'}`}
              onClick={handleAddToWatchlist}
              disabled={watchlisted}
            >
              {watchlisted ? '✓ Watchlisted' : '+ Watchlist'}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-14">
          <div className="w-8 h-8 border-3 border-border border-t-brand rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="card border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {data && !loading && (
        <>
        {/* Match score — ring + signals */}
        {data.matchScore != null && (() => {
          const s = data.matchScore;
          const scoreColor = s >= 70 ? '#22c55e' : s >= 55 ? '#c9a84c' : '#ef4444';
          const gradeLabel = s >= 85 ? 'Excellent' : s >= 70 ? 'Strong' : s >= 55 ? 'Good' : 'Fair';
          const circumference = 2 * Math.PI * 34;

          return (
            <div className="card mb-6">
              <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-7">
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-border)" strokeWidth="5" />
                    <circle
                      cx="40" cy="40" r="34" fill="none"
                      stroke={scoreColor} strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference * (1 - s / 100)}
                      className="transition-all duration-700"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="num text-2xl sm:text-3xl font-bold" style={{ color: scoreColor, lineHeight: 1 }}>
                      {Math.round(s)}
                    </span>
                  </div>
                </div>

                <div className="flex-1 min-w-0 text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-2 flex-wrap">
                    <span className="label-xs">Similarity</span>
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ color: scoreColor, background: `${scoreColor}10`, border: `1px solid ${scoreColor}30` }}
                    >
                      {gradeLabel}
                    </span>
                    <span className="num text-[11px] text-text-muted">{data.metricsCompared}/{data.totalMetrics || 28} metrics</span>
                    {data.confidence && (
                      <span className="num text-[11px] text-text-muted">· {data.confidence.coverageRatio}% coverage</span>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-center sm:justify-start gap-1.5">
                    {data.topMatches?.map(key => (
                      <span key={key} className="tag-green">{METRIC_LABELS[key] || key} ✓</span>
                    ))}
                    {data.topDifferences?.map(key => (
                      <span key={key} className="tag-yellow">{METRIC_LABELS[key] || key} ~</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}


        {/* Investor insight */}
        {(() => {
          const insight = getInsight(data);
          if (!insight) return null;
          const { tier, observations } = insight;
          return (
            <div className={`card mb-6 ${tier.bgColor} border-l-2 ${data.matchScore >= 70 ? 'border-l-emerald-500' : data.matchScore >= 55 ? 'border-l-brand' : 'border-l-red-500'}`}>
              <div>
                <div>
                  <p className="text-sm text-text-primary mb-1">
                    <span className={`font-semibold ${tier.color}`}>{tier.label}</span>
                    <span className="text-text-secondary font-light ml-2">— {tier.desc}</span>
                  </p>
                  {observations.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {observations.map((obs, i) => (
                        <span key={i} className="text-xs text-text-secondary font-light">• {obs}</span>
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
          <div className="card mb-6 bg-surface">
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
              <p className="section-label mb-1">Template · {data.template.date}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-lg sm:text-xl text-text-primary">{data.template.ticker}</span>
                <a href={`https://finance.yahoo.com/quote/${data.template.ticker}`} target="_blank" rel="noopener noreferrer" className="text-text-muted/40 hover:text-brand transition-colors" title="View on Yahoo Finance">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 1H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V8M7 1h4v4M5 7l6-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
                <span className="text-text-secondary text-xs sm:text-sm font-light">{data.template.companyName}</span>
              </div>
              {data.template.sector && (
                <span className="text-xs border border-border text-text-muted px-2 py-0.5 rounded-full mt-1 inline-block">
                  {data.template.sector}
                </span>
              )}
            </div>

            {/* Sparkline */}
            <div className="bg-bg rounded-lg p-3 sm:p-4 mb-4 h-[120px] sm:h-[140px] border border-border/30">
              <Sparkline data={data.sparkline} gainPct={data.sparklineGainPct} />
            </div>

            {/* Price */}
            <div className="flex items-center justify-between py-3 border-b border-border mb-1">
              <span className="section-label">Price</span>
              <span className="text-sm font-semibold text-text-primary font-mono">
                {formatMetric('price', data.template.price)}
              </span>
            </div>

            {/* Metrics */}
            {METRIC_GROUPS.map(group => (
              <div key={group.label}>
                <div className="section-label pt-4 pb-1 border-b border-border/50">
                  {group.label}
                </div>
                {group.metrics.map(key => (
                  <div key={key} className="flex items-center justify-between py-2 sm:py-2.5 hover:bg-surface/40 rounded px-1 -mx-1 transition-colors">
                    <span className="text-xs text-text-muted uppercase tracking-wider">{METRIC_LABELS[key]}</span>
                    <span className={`text-sm font-semibold font-mono ${data.template[key] == null ? 'text-text-muted/40' : 'text-text-primary'}`}>
                      {formatMetric(key, data.template[key])}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            {/* Post-snapshot performance + TTM breakdown (after metrics to keep alignment) */}
            {data.sparklineGainPct != null && (
              <p className="text-xs text-text-muted mt-6 pt-4 border-t border-border/30 font-light">
                Post-snapshot performance:
                <span className={`ml-1 font-mono font-semibold ${data.sparklineGainPct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.sparklineGainPct > 0 ? '+' : ''}{data.sparklineGainPct.toFixed(1)}% over 18 months
                </span>
              </p>
            )}
            {data.template.ttmBreakdown && data.template.ttmBreakdown.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="text-text-muted/60 cursor-pointer hover:text-text-muted transition-colors">
                  Show quarterly data behind TTM calculations
                </summary>
                <div className="mt-2 bg-bg rounded-lg p-3 border border-border/30">
                  <table className="w-full">
                    <thead>
                      <tr className="text-text-muted/60">
                        <th className="text-left pb-1 font-normal">Quarter</th>
                        <th className="text-right pb-1 font-normal">Revenue</th>
                        <th className="text-right pb-1 font-normal">EPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.template.ttmBreakdown.map(q => (
                        <tr key={q.date} className="border-t border-border/20">
                          <td className="py-1 text-text-secondary font-mono">{q.date}</td>
                          <td className="py-1 text-right text-text-primary font-mono">${(q.revenue / 1e9).toFixed(2)}B</td>
                          <td className="py-1 text-right text-text-primary font-mono">${q.eps?.toFixed(2)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-border/50 font-semibold">
                        <td className="py-1 text-text-muted">TTM Total</td>
                        <td className="py-1 text-right text-brand font-mono">
                          ${(data.template.ttmBreakdown.reduce((s, q) => s + (q.revenue || 0), 0) / 1e9).toFixed(2)}B
                        </td>
                        <td className="py-1 text-right text-brand font-mono">
                          ${data.template.ttmBreakdown.reduce((s, q) => s + (q.eps || 0), 0).toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {data.template.priorTtmRevenue != null && (
                    <p className="text-text-muted/60 mt-2">
                      Prior TTM Revenue: <span className="text-text-secondary font-mono">${(data.template.priorTtmRevenue / 1e9).toFixed(2)}B</span>
                      {' → '}Revenue Growth: <span className="text-emerald-400 font-mono">
                        {((data.template.ttmBreakdown.reduce((s, q) => s + (q.revenue || 0), 0) / data.template.priorTtmRevenue - 1) * 100).toFixed(1)}%
                      </span>
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>

          {/* RIGHT PANEL — Match (current) */}
          <div className="card">
            <div className="mb-4 min-h-[72px]">
              <p className="section-label mb-1">
                Current · {data.match.date}
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xl text-text-primary">{data.match.ticker}</span>
                <a href={`https://finance.yahoo.com/quote/${data.match.ticker}`} target="_blank" rel="noopener noreferrer" className="text-text-muted/40 hover:text-brand transition-colors" title="View on Yahoo Finance">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 1H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V8M7 1h4v4M5 7l6-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
                <span className="text-text-secondary text-sm font-light">{data.match.companyName}</span>
              </div>
              {data.match.sector && (
                <span className="text-xs border border-border text-text-muted px-2 py-0.5 rounded-full mt-1 inline-block">
                  {data.match.sector}
                </span>
              )}
            </div>

            {/* Match sparkline */}
            <div className="bg-bg rounded-lg p-3 sm:p-4 mb-4 h-[120px] sm:h-[140px] border border-border/30">
              <Sparkline
                data={data.matchSparkline}
                gainPct={data.matchSparklineGainPct}
                label="Last 12 months"
                period="12 months"
              />
            </div>

            {/* Price */}
            <div className="flex items-center justify-between py-3 border-b border-border mb-1">
              <span className="section-label">Price</span>
              <span className="text-sm font-semibold text-text-primary font-mono">
                {formatMetric('price', data.match.price)}
              </span>
            </div>

            {/* Metrics with similarity bars */}
            {METRIC_GROUPS.map(group => (
              <div key={group.label}>
                <div className="section-label pt-4 pb-1 border-b border-border/50">
                  {group.label}
                </div>
                {group.metrics.map(key => {
                  const leftVal = data.template[key];
                  const rightVal = data.match[key];
                  const metricScore = data.metricScores?.find(ms => ms.metric === key);
                  const sim = metricScore ? Math.round(metricScore.similarity * 100) : null;
                  const colorClass = metricScore ? getMetricColorFromScore(metricScore.similarity) : getMetricColor(key, leftVal, rightVal);
                  return (
                    <div key={key} className="flex items-center justify-between py-2 sm:py-2.5 hover:bg-surface/40 rounded px-1 -mx-1 transition-colors gap-2">
                      <span className="text-xs text-text-muted uppercase tracking-wider flex-shrink-0">{METRIC_LABELS[key]}</span>
                      <div className="flex items-center gap-2">
                        {sim != null && (
                          <div
                            className="w-16 flex items-center cursor-help"
                            title={`${sim}% similarity — Template: ${formatMetric(key, leftVal)} vs Match: ${formatMetric(key, rightVal)}. ${sim >= 75 ? 'Strong match' : sim >= 40 ? 'Partial match' : 'Weak match'} on this metric.`}
                          >
                            <div className="w-16 h-1.5 bg-bg rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{
                                  width: `${sim}%`,
                                  backgroundColor: sim >= 75 ? '#22c55e' : sim >= 40 ? '#c9a84c' : '#ef4444',
                                }}
                              />
                            </div>
                          </div>
                        )}
                        <span className={`text-sm font-semibold font-mono ${colorClass}`}>
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
