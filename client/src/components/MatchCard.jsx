import { useNavigate } from 'react-router-dom';
import { formatMetric, METRIC_LABELS } from '../utils/format';

export default function MatchCard({ match, snapshot, rank }) {
  const navigate = useNavigate();

  function goToComparison() {
    navigate('/comparison', { state: { snapshot, matchTicker: match.ticker } });
  }

  return (
    <div className="card hover:border-accent/40 transition-colors cursor-default">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2.5 mb-0.5">
            <span className="text-xs text-slate-600 font-medium">#{rank}</span>
            <span className="font-mono font-bold text-slate-100 text-lg">{match.ticker}</span>
            <span className="text-slate-400">{match.companyName}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {match.sector && (
              <span className="text-xs border border-dark-border text-slate-500 px-2 py-0.5 rounded-full">
                {match.sector}
              </span>
            )}
            <span className="text-sm text-slate-300 font-medium">
              {formatMetric('price', match.price)}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div
            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold"
            style={{
              background: 'linear-gradient(135deg, #6c63ff22, #6c63ff44)',
              border: '1px solid #6c63ff66',
              color: '#a09cf5',
            }}
          >
            {match.matchScore}% Match
          </div>
        </div>
      </div>

      {/* Metric tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
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

      <div className="flex justify-end">
        <button className="btn-secondary" onClick={goToComparison}>
          View Comparison →
        </button>
      </div>
    </div>
  );
}
