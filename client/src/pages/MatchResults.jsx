import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MatchCard from '../components/MatchCard';
import { formatMetric } from '../utils/format';

const LOADING_MESSAGES = [
  'Scanning the stock universe…',
  'Calculating similarity scores…',
  'Ranking closest matches…',
  'Almost there…',
];

export default function MatchResults() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const snapshot = state?.snapshot;

  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);

  // Redirect if no snapshot in state
  useEffect(() => {
    if (!snapshot) navigate('/', { replace: true });
  }, [snapshot, navigate]);

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setMsgIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!snapshot) return;
    const params = new URLSearchParams({
      ticker: snapshot.ticker,
      date: snapshot.date,
      ...(snapshot.peRatio          != null && { peRatio:          snapshot.peRatio }),
      ...(snapshot.revenueGrowthYoY != null && { revenueGrowthYoY: snapshot.revenueGrowthYoY }),
      ...(snapshot.grossMargin      != null && { grossMargin:      snapshot.grossMargin }),
      ...(snapshot.marketCap        != null && { marketCap:        snapshot.marketCap }),
      ...(snapshot.rsi14            != null && { rsi14:            snapshot.rsi14 }),
      ...(snapshot.pctBelowHigh     != null && { pctBelowHigh:     snapshot.pctBelowHigh }),
    });

    fetch(`/api/matches?${params}`)
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Match failed'); });
        return res.json();
      })
      .then(data => { setMatches(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [snapshot]);

  if (!snapshot) return null;

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      {/* Summary bar */}
      <div className="card mb-8 flex flex-wrap items-center gap-4 justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-bold text-xl text-slate-100">{snapshot.ticker}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400 text-sm">{snapshot.date}</span>
          </div>
          <p className="text-sm text-slate-400">{snapshot.companyName}</p>
        </div>
        <div className="flex gap-6">
          {[
            { key: 'peRatio', label: 'P/E' },
            { key: 'revenueGrowthYoY', label: 'Growth' },
            { key: 'grossMargin', label: 'Margin' },
          ].map(({ key, label }) => (
            <div key={key} className="text-center">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-slate-200">{formatMetric(key, snapshot[key])}</p>
            </div>
          ))}
        </div>
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back</button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm animate-pulse">{LOADING_MESSAGES[msgIdx]}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="card border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Match results */}
      {matches && !loading && (
        <>
          <p className="text-sm text-slate-500 mb-5">
            {matches.length} stocks matched — ranked by similarity
          </p>
          <div className="flex flex-col gap-4">
            {matches.map((match, i) => (
              <MatchCard key={match.ticker} match={match} snapshot={snapshot} rank={i + 1} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
