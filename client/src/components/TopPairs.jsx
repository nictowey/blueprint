import { useEffect, useState } from 'react';

function formatMarketCap(val) {
  if (val == null) return '—';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function ScoreRing({ score }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';

  return (
    <div className="relative w-11 h-11 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={radius} fill="none" stroke="#1e293b" strokeWidth="3" />
        <circle
          cx="22" cy="22" r={radius} fill="none"
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

export default function TopPairs() {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/top-pairs')
      .then(res => {
        if (!res.ok) throw new Error('not ready');
        return res.json();
      })
      .then(data => { setPairs(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mt-12">
        <h2 className="text-lg font-semibold text-slate-300 mb-4">Top Matches Today</h2>
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-dark-border border-t-accent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (pairs.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-lg font-semibold text-slate-300 mb-1">Top Matches Today</h2>
      <p className="text-sm text-slate-500 mb-4">
        Highest similarity pairs across the entire stock universe right now.
      </p>
      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <div key={i} className="card flex items-center gap-4 py-3 px-4">
            <ScoreRing score={pair.matchScore} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono font-bold text-slate-100">{pair.stockA.ticker}</span>
                <span className="text-slate-600">vs</span>
                <span className="font-mono font-bold text-slate-100">{pair.stockB.ticker}</span>
                {pair.stockA.sector && (
                  <span className="text-xs text-slate-600 border border-dark-border px-1.5 py-0.5 rounded-full ml-auto hidden sm:inline">
                    {pair.stockA.sector}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <span>{pair.stockA.companyName}</span>
                <span className="text-slate-700">|</span>
                <span>{pair.stockB.companyName}</span>
              </div>
            </div>
            <div className="text-right shrink-0 hidden sm:block">
              <div className="text-xs text-slate-500">{pair.metricsCompared} metrics</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {pair.topMatches?.slice(0, 2).join(', ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
