import { useNavigate } from 'react-router-dom';
import { formatMetric, METRIC_LABELS } from '../utils/format';

const CIRCUMFERENCE = 150.8; // 2π × r=24

export default function MatchCard({ match, snapshot, rank }) {
  const navigate = useNavigate();
  const offset = CIRCUMFERENCE * (1 - match.matchScore / 100);

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

        {/* Score ring */}
        <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
          <svg
            width="60"
            height="60"
            viewBox="0 0 60 60"
            style={{ transform: 'rotate(-90deg)' }}
          >
            <circle
              cx="30" cy="30" r="24"
              fill="none"
              stroke="#1e2433"
              strokeWidth="5"
            />
            <circle
              cx="30" cy="30" r="24"
              fill="none"
              stroke="#6c63ff"
              strokeWidth="5"
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
            <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#a09cf5', lineHeight: 1 }}>
              {match.matchScore}
            </span>
            <span style={{ fontSize: '0.48rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#475569' }}>
              match
            </span>
          </div>
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

      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-600">
          {match.metricsCompared}/26 metrics compared
        </span>
        <button className="btn-secondary" onClick={goToComparison}>
          View Comparison →
        </button>
      </div>
    </div>
  );
}
