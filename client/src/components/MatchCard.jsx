import { useNavigate } from 'react-router-dom';
import { formatMetric, METRIC_LABELS } from '../utils/format';
import MiniSparkline from './MiniSparkline';

const KEY_STATS = [
  { key: 'peRatio', label: 'P/E' },
  { key: 'revenueGrowthYoY', label: 'Rev Growth' },
  { key: 'operatingMargin', label: 'Op Margin' },
  { key: 'returnOnEquity', label: 'ROE' },
];

const CIRCUMFERENCE = 150.8; // 2π × r=24

export default function MatchCard({ match, snapshot, rank, profile }) {
  const navigate = useNavigate();
  const offset = CIRCUMFERENCE * (1 - match.matchScore / 100);
  const scoreColor = match.matchScore >= 70 ? '#22c55e' : match.matchScore >= 55 ? '#c9a84c' : '#ef4444';

  function goToComparison() {
    const profileParam = profile && profile !== 'growth_breakout' ? `&profile=${profile}` : '';
    navigate(`/comparison?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}&match=${encodeURIComponent(match.ticker)}${profileParam}`, { state: { snapshot, matchTicker: match.ticker, profile } });
  }

  return (
    <div className="card hover:border-dark-border-hover transition-all duration-200 cursor-default group">
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 sm:gap-2.5 mb-0.5 flex-wrap">
            <span className="text-xs text-warm-muted font-mono">#{rank}</span>
            <span className="font-mono font-bold text-warm-white text-base sm:text-lg">{match.ticker}</span>
            <span className="text-warm-gray text-sm truncate font-light">{match.companyName}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {match.sector && (
              <span className="text-xs border border-dark-border text-warm-muted px-2 py-0.5 rounded-full">
                {match.sector}
              </span>
            )}
            <span className="text-sm text-warm-white font-mono font-medium">
              {formatMetric('price', match.price)}
            </span>
            {match.recentCloses?.length > 2 && (
              <MiniSparkline prices={match.recentCloses} width={64} height={22} />
            )}
          </div>
        </div>

        {/* Score ring */}
        <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }} className="ml-2 glow-gold">
          <svg
            width="56"
            height="56"
            viewBox="0 0 60 60"
            style={{ transform: 'rotate(-90deg)' }}
          >
            <circle
              cx="30" cy="30" r="24"
              fill="none"
              stroke="#1c1c2e"
              strokeWidth="4"
            />
            <circle
              cx="30" cy="30" r="24"
              fill="none"
              stroke={scoreColor}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="text-[0.9rem] font-bold font-mono" style={{ color: scoreColor, lineHeight: 1 }}>
              {match.matchScore}
            </span>
            <span className="text-[0.45rem] uppercase tracking-widest text-warm-muted">
              match
            </span>
          </div>
        </div>
      </div>

      {/* Key stats row */}
      <div className="flex flex-wrap gap-3 sm:gap-4 mb-3 py-2 px-1">
        {KEY_STATS.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className="text-[10px] text-warm-muted uppercase tracking-wider">{label}</p>
            <p className="text-xs font-semibold text-warm-white font-mono">{formatMetric(key, match[key])}</p>
            {snapshot?.[key] != null && (
              <p className="text-[9px] text-warm-muted font-mono">vs {formatMetric(key, snapshot[key])}</p>
            )}
          </div>
        ))}
        <div className="text-center">
          <p className="text-[10px] text-warm-muted uppercase tracking-wider">Mkt Cap</p>
          <p className="text-xs font-semibold text-warm-white font-mono">{formatMetric('marketCap', match.marketCap)}</p>
          {snapshot?.marketCap != null && (
            <p className="text-[9px] text-warm-muted font-mono">vs {formatMetric('marketCap', snapshot.marketCap)}</p>
          )}
        </div>
      </div>

      {/* Metric tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {match.topMatches.map(key => (
          <span key={key} className="tag-green">
            {METRIC_LABELS[key] || key} ✓
          </span>
        ))}
        {match.topDifferences.map(key => (
          <span key={key} className="tag-yellow">
            {METRIC_LABELS[key] || key} ~
          </span>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-warm-muted font-mono">
            {match.metricsCompared}/28 metrics
          </span>
          {match.confidence && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
              match.confidence.level === 'high'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : match.confidence.level === 'medium'
                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                  : 'border-red-500/20 bg-red-500/10 text-red-400'
            }`} title={`Confidence: ${match.confidence.score}% — Data coverage: ${match.confidence.coverageRatio}%`}>
              {match.confidence.level === 'high' ? 'High' : match.confidence.level === 'medium' ? 'Med' : 'Low'} confidence
            </span>
          )}
        </div>
        <button className="btn-secondary w-full sm:w-auto hover:border-accent/30 hover:text-accent" onClick={goToComparison}>
          View Comparison →
        </button>
      </div>
    </div>
  );
}
