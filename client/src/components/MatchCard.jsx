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

function scoreGrade(score) {
  if (score >= 85) return { label: 'Excellent', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)' };
  if (score >= 70) return { label: 'Strong', color: '#22c55e', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.15)' };
  if (score >= 55) return { label: 'Good', color: '#c9a84c', bg: 'rgba(201,168,76,0.06)', border: 'rgba(201,168,76,0.15)' };
  return { label: 'Fair', color: '#ef4444', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.15)' };
}

export default function MatchCard({ match, snapshot, rank, profile }) {
  const navigate = useNavigate();
  const offset = CIRCUMFERENCE * (1 - match.matchScore / 100);
  const grade = scoreGrade(match.matchScore);

  function goToComparison() {
    const profileParam = profile && profile !== 'growth_breakout' ? `&profile=${profile}` : '';
    navigate(`/comparison?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}&match=${encodeURIComponent(match.ticker)}${profileParam}`, { state: { snapshot, matchTicker: match.ticker, profile } });
  }

  return (
    <div
      className="card hover:border-dark-border-hover transition-all duration-200 cursor-pointer group"
      onClick={goToComparison}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && goToComparison()}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Rank badge */}
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span className="text-xs text-warm-muted font-mono w-6 text-center">#{rank}</span>
        </div>

        {/* Score ring */}
        <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }} className="glow-gold">
          <svg width="56" height="56" viewBox="0 0 60 60" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="30" cy="30" r="24" fill="none" stroke="#1c1c2e" strokeWidth="4" />
            <circle
              cx="30" cy="30" r="24" fill="none"
              stroke={grade.color} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset}
              className="transition-all duration-700"
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span className="text-[0.95rem] font-bold font-mono" style={{ color: grade.color, lineHeight: 1 }}>
              {match.matchScore}
            </span>
            <span className="text-[0.4rem] uppercase tracking-widest text-warm-muted mt-0.5">
              match
            </span>
          </div>
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-2.5 mb-0.5 flex-wrap">
            <span className="font-mono font-bold text-warm-white text-base sm:text-lg group-hover:text-accent transition-colors duration-200">{match.ticker}</span>
            <span className="text-warm-gray text-sm truncate font-light">{match.companyName}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {match.sector && (
              <span className="text-[10px] border border-dark-border text-warm-muted px-2 py-0.5 rounded-full">
                {match.sector}
              </span>
            )}
            <span className="text-sm text-warm-white font-mono font-medium">
              {formatMetric('price', match.price)}
            </span>
            {match.recentCloses?.length > 2 && (
              <MiniSparkline prices={match.recentCloses} width={64} height={22} />
            )}
            {/* Grade badge */}
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full ml-auto hidden sm:inline-block"
              style={{ color: grade.color, background: grade.bg, border: `1px solid ${grade.border}` }}
            >
              {grade.label}
            </span>
          </div>
        </div>
      </div>

      {/* Key stats row */}
      <div className="flex flex-wrap gap-3 sm:gap-5 mt-3 pt-3 border-t border-dark-border/50 px-1">
        {KEY_STATS.map(({ key, label }) => (
          <div key={key} className="text-center min-w-[48px]">
            <p className="text-[10px] text-warm-muted uppercase tracking-wider">{label}</p>
            <p className="text-xs font-semibold text-warm-white font-mono">{formatMetric(key, match[key])}</p>
            {snapshot?.[key] != null && (
              <p className="text-[9px] text-warm-muted font-mono">vs {formatMetric(key, snapshot[key])}</p>
            )}
          </div>
        ))}
        <div className="text-center min-w-[48px]">
          <p className="text-[10px] text-warm-muted uppercase tracking-wider">Mkt Cap</p>
          <p className="text-xs font-semibold text-warm-white font-mono">{formatMetric('marketCap', match.marketCap)}</p>
          {snapshot?.marketCap != null && (
            <p className="text-[9px] text-warm-muted font-mono">vs {formatMetric('marketCap', snapshot.marketCap)}</p>
          )}
        </div>
      </div>

      {/* Metric tags + confidence */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
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
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-warm-muted font-mono">
            {match.metricsCompared}/28
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
          <svg className="w-4 h-4 text-warm-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </div>
  );
}
