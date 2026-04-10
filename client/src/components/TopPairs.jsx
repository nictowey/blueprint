import { useEffect, useState } from 'react';

function formatMarketCap(val) {
  if (val == null) return '—';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function ScoreRing({ score, size = 44 }) {
  const radius = size * 0.41;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#1e293b" strokeWidth="3" />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-200">
        {Math.round(score)}
      </span>
    </div>
  );
}

function CategoryBar({ label, score }) {
  if (score == null) return null;
  const color = score >= 70 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-slate-500 w-16 text-right shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-dark-border rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-slate-500 w-6 text-right">{score}</span>
    </div>
  );
}

function SignalTag({ signal }) {
  const bgColor = signal.score >= 0.7
    ? 'bg-green-500/10 text-green-400 border-green-500/20'
    : signal.score >= 0.5
      ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
      : 'bg-red-500/10 text-red-400 border-red-500/20';

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${bgColor}`}>
      <span className="font-medium">{signal.signal}</span>
      <span className="opacity-75">{signal.value}</span>
    </span>
  );
}

export default function TopPairs() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    async function fetchCandidates() {
      try {
        const res = await fetch('/api/top-pairs');
        if (cancelled) return;

        if (res.status === 202) {
          retryTimer = setTimeout(fetchCandidates, 10000);
          return;
        }
        if (!res.ok) throw new Error('not ready');

        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setCandidates(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCandidates();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, []);

  if (loading) {
    return (
      <div className="mt-12">
        <h2 className="text-lg font-semibold text-slate-300 mb-4">Breakout Candidates</h2>
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <div className="w-6 h-6 border-2 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-xs text-slate-600">Screening the universe for breakout setups...</p>
        </div>
      </div>
    );
  }

  if (candidates.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-lg font-semibold text-slate-300 mb-1">Breakout Candidates</h2>
      <p className="text-sm text-slate-500 mb-4">
        Stocks scoring highest on growth, valuation, quality, and technical momentum signals.
      </p>
      <div className="space-y-2">
        {candidates.map((entry, i) => {
          const isExpanded = expanded === i;
          const cat = entry.categoryScores || {};

          return (
            <div
              key={i}
              className="card cursor-pointer hover:border-accent/40 transition-colors"
              onClick={() => setExpanded(isExpanded ? null : i)}
            >
              {/* Main row */}
              <div className="flex items-center gap-3 sm:gap-4">
                <ScoreRing score={entry.breakoutScore} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-sm flex-wrap">
                    <span className="font-mono font-bold text-slate-100">{entry.candidate.ticker}</span>
                    {entry.candidate.sector && (
                      <span className="text-xs text-slate-600 border border-dark-border px-1.5 py-0.5 rounded-full hidden sm:inline">
                        {entry.candidate.sector}
                      </span>
                    )}
                    {entry.candidate.marketCap && (
                      <span className="text-xs text-slate-600 hidden sm:inline">{formatMarketCap(entry.candidate.marketCap)}</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                    {entry.candidate.companyName}
                  </div>
                  {/* Top signals preview (always visible) */}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {entry.topSignals?.slice(0, 3).map((sig, j) => (
                      <SignalTag key={j} signal={sig} />
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-xs text-slate-500">{entry.signalCount} signals</div>
                  <svg
                    className={`w-4 h-4 text-slate-600 mt-1 ml-auto transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-dark-border">
                  {/* Category breakdown */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mb-3">
                    <CategoryBar label="Growth" score={cat.growth} />
                    <CategoryBar label="Valuation" score={cat.valuation} />
                    <CategoryBar label="Quality" score={cat.quality} />
                    <CategoryBar label="Technical" score={cat.technical} />
                    <CategoryBar label="Health" score={cat.health} />
                  </div>

                  {/* All top signals */}
                  <div className="mb-2">
                    <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Strongest Signals</div>
                    <div className="flex flex-wrap gap-1">
                      {entry.topSignals?.map((sig, j) => (
                        <SignalTag key={j} signal={sig} />
                      ))}
                    </div>
                  </div>

                  {/* Weak signals / risks */}
                  {entry.weakSignals?.length > 0 && (
                    <div>
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1">Key Risks</div>
                      <div className="flex flex-wrap gap-1">
                        {entry.weakSignals.map((sig, j) => (
                          <SignalTag key={j} signal={sig} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
