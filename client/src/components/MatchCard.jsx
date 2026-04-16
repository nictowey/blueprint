import { useNavigate } from 'react-router-dom';
import { formatMetric } from '../utils/format';
import MiniSparkline from './MiniSparkline';

function scoreColorClass(score) {
  if (score >= 70) return 'text-gain';
  if (score >= 55) return 'text-brand';
  return 'text-loss';
}

export default function MatchCard({ match, snapshot, rank, profile }) {
  const navigate = useNavigate();

  function goToComparison() {
    const profileParam = profile && profile !== 'growth_breakout' ? `&profile=${profile}` : '';
    navigate(`/comparison?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}&match=${encodeURIComponent(match.ticker)}${profileParam}`, { state: { snapshot, matchTicker: match.ticker, profile } });
  }

  return (
    <div
      className="group flex items-center gap-3 sm:gap-4 px-4 py-3 rounded-xl border-b border-border transition-all duration-200 cursor-pointer hover:bg-surface-hover hover:-translate-y-[1px]"
      onClick={goToComparison}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && goToComparison()}
    >
      {/* Rank */}
      <span className="text-xs text-text-muted font-mono w-5 text-right shrink-0">
        {rank}
      </span>

      {/* Score */}
      <span className={`text-base font-bold font-mono w-10 text-right shrink-0 ${scoreColorClass(match.matchScore)}`}>
        {match.matchScore}
      </span>

      {/* Ticker + Company name */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-bold text-text-primary text-sm">{match.ticker}</span>
          <span className="text-text-secondary text-xs font-light truncate">{match.companyName}</span>
        </div>
      </div>

      {/* Sector pill */}
      {match.sector && (
        <span className="hidden sm:inline-block text-[10px] text-text-muted px-2 py-0.5 rounded-md bg-surface border border-border shrink-0">
          {match.sector}
        </span>
      )}

      {/* Price + sparkline */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <span className="text-xs font-mono text-text-primary">
          {formatMetric('price', match.price)}
        </span>
        {match.recentCloses?.length > 2 && (
          <MiniSparkline prices={match.recentCloses} width={48} height={18} />
        )}
      </div>

      {/* P/E ratio */}
      <span className="hidden md:inline-block text-xs font-mono text-text-secondary w-14 text-right shrink-0">
        {formatMetric('peRatio', match.peRatio)}
      </span>

      {/* Chevron (hover only) */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        <svg
          className="w-4 h-4 text-text-muted opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}
