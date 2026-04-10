import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

function formatMarketCap(val) {
  if (val == null) return '—';
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

const METRIC_LABELS = {
  revenueGrowthYoY: 'Rev Growth',
  epsGrowthYoY: 'EPS Growth',
  pegRatio: 'PEG',
  operatingMargin: 'Op Margin',
  peRatio: 'P/E',
  evToEBITDA: 'EV/EBITDA',
  pctBelowHigh: '% Below High',
  priceVsMa200: 'vs 200MA',
  marketCap: 'Mkt Cap',
  returnOnEquity: 'ROE',
  revenueGrowth3yr: '3yr Rev CAGR',
  freeCashFlowYield: 'FCF Yield',
  priceVsMa50: 'vs 50MA',
  rsi14: 'RSI',
  grossMargin: 'Gross Margin',
  debtToEquity: 'D/E',
  returnOnCapital: 'ROIC',
  netMargin: 'Net Margin',
  priceToBook: 'P/B',
  priceToSales: 'P/S',
};

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
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);

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
          <p className="text-xs text-slate-600">Scanning the universe against proven breakout profiles...</p>
        </div>
      </div>
    );
  }

  if (candidates.length === 0) return null;

  return (
    <div className="mt-12">
      <h2 className="text-lg font-semibold text-slate-300 mb-1">Breakout Candidates</h2>
      <p className="text-sm text-slate-500 mb-4">
        Current stocks whose profiles most closely match proven breakout stocks before their big moves.
      </p>
      <div className="space-y-2">
        {candidates.map((entry, i) => (
          <div
            key={i}
            className="card flex items-center gap-3 sm:gap-4 py-3 px-3 sm:px-4 cursor-pointer hover:border-accent/40 transition-colors"
            onClick={() => {
              navigate(`/comparison?ticker=${encodeURIComponent(entry.template.ticker)}&date=${entry.template.date}&match=${encodeURIComponent(entry.candidate.ticker)}`, {
                state: {
                  snapshot: {
                    ticker: entry.template.ticker,
                    date: entry.template.date,
                  },
                  matchTicker: entry.candidate.ticker,
                },
              });
            }}
          >
            <ScoreRing score={entry.matchScore} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 text-sm flex-wrap">
                <span className="font-mono font-bold text-slate-100">{entry.candidate.ticker}</span>
                {entry.candidate.sector && (
                  <span className="text-xs text-slate-600 border border-dark-border px-1.5 py-0.5 rounded-full hidden sm:inline">
                    {entry.candidate.sector}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-0.5 truncate">
                {entry.candidate.companyName}
              </div>
              <div className="flex items-center gap-1 mt-1 text-[10px] sm:text-xs text-slate-600">
                <span>Matches</span>
                <span className="font-mono text-accent font-semibold">{entry.template.ticker}</span>
                <span className="text-slate-700">({entry.template.date.slice(0, 7)})</span>
                {entry.templateMatchCount > 1 && (
                  <span className="text-slate-600 ml-1">+{entry.templateMatchCount - 1} more</span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0 hidden sm:block">
              <div className="text-xs text-slate-500">{entry.metricsCompared} metrics</div>
              <div className="text-xs text-slate-600 mt-0.5">
                {entry.topMatches?.slice(0, 2).map(m => METRIC_LABELS[m] || m).join(', ')}
              </div>
              {entry.candidate.marketCap && (
                <div className="text-xs text-slate-600 mt-0.5">{formatMarketCap(entry.candidate.marketCap)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
