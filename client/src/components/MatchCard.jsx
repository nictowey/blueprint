import { useNavigate } from 'react-router-dom';
import { formatMetric } from '../utils/format';
import MiniSparkline from './MiniSparkline';

const TEMPLATE_FREE_ALGOS = new Set(['momentumBreakout', 'catalystDriven', 'ensembleConsensus']);

const ENGINE_ABBREV = {
  templateMatch: 'T',
  momentumBreakout: 'M',
  catalystDriven: 'C',
};

function scoreTier(score) {
  if (score == null) return 'low';
  if (score >= 85) return 'high';
  if (score >= 70) return 'mid';
  return 'low';
}

export default function MatchCard({ match, snapshot, rank, profile, algo }) {
  const navigate = useNavigate();

  const isTemplateFree = TEMPLATE_FREE_ALGOS.has(algo);
  const hasTemplate = !!snapshot;
  const useComparison = (!isTemplateFree && hasTemplate) || (algo === 'ensembleConsensus' && hasTemplate);

  function handleClick() {
    if (useComparison) {
      const profileParam = profile && profile !== 'growth_breakout' ? `&profile=${profile}` : '';
      navigate(
        `/comparison?ticker=${encodeURIComponent(snapshot.ticker)}&date=${snapshot.date}&match=${encodeURIComponent(match.ticker)}${profileParam}`,
        { state: { snapshot, matchTicker: match.ticker, profile } }
      );
    } else {
      navigate(`/stock/${encodeURIComponent(match.ticker)}`, {
        state: { snapshot: match },
      });
    }
  }

  const perEngineEntries = match.perEngineRanks
    ? Object.entries(match.perEngineRanks).filter(([, r]) => r != null)
    : null;
  const tier = scoreTier(match.matchScore);
  const scoreDisplay = typeof match.matchScore === 'number' ? Math.round(match.matchScore) : '—';

  return (
    <div
      className="match-row group"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
    >
      <span className="num text-[11px] text-text-muted text-right">{rank}</span>

      <div className={`score-badge score-${tier}`}>{scoreDisplay}</div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="ticker text-[13px] text-text-primary">{match.ticker}</span>
          <span className="text-[12px] text-text-secondary truncate">{match.companyName}</span>
        </div>
        {perEngineEntries && perEngineEntries.length > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {perEngineEntries.map(([key, r], i) => (
              <span key={key} className="num text-[10px] text-text-muted">
                {ENGINE_ABBREV[key] || key}#{r}{i < perEngineEntries.length - 1 ? ' ·' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {match.sector ? (
        <span className="hidden sm:inline-block text-[10px] text-text-muted truncate">
          {match.sector}
        </span>
      ) : <span />}

      <div className="hidden sm:flex items-center gap-2 justify-end">
        <span className="num text-[12px] text-text-primary">
          {formatMetric('price', match.price)}
        </span>
      </div>

      <div className="hidden sm:flex items-center justify-center">
        {match.recentCloses?.length > 2 && (
          <MiniSparkline prices={match.recentCloses} width={56} height={20} />
        )}
      </div>

      <span className="hidden md:inline-block num text-[12px] text-text-secondary text-right">
        {formatMetric('peRatio', match.peRatio)}
      </span>

      <svg
        className="w-3.5 h-3.5 text-text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
        fill="none" viewBox="0 0 24 24" stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}
