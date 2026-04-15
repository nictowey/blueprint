import { useEffect, useState } from 'react';
import { httpError } from '../utils/httpError';

const PERIODS = ['1m', '3m', '6m', '12m'];
const PERIOD_LABELS = { '1m': '1 Month', '3m': '3 Months', '6m': '6 Months', '12m': '12 Months' };

function correlationLabel(rho) {
  if (rho > 0.15) return { text: 'Positive', color: 'text-emerald-400' };
  if (rho > 0.05) return { text: 'Weak positive', color: 'text-emerald-400/70' };
  if (rho > -0.05) return { text: 'No correlation', color: 'text-warm-muted' };
  if (rho > -0.15) return { text: 'Weak negative', color: 'text-red-400/70' };
  return { text: 'Negative', color: 'text-red-400' };
}

function SignedPct({ value, className = '' }) {
  if (value == null) return <span className="text-warm-muted/40 font-mono">—</span>;
  const positive = value > 0;
  const color = positive ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-warm-gray';
  return (
    <span className={`font-mono font-semibold ${color} ${className}`}>
      {positive ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

function StatCard({ label, children }) {
  return (
    <div className="card flex-1 min-w-[160px] text-center">
      <p className="section-label mb-2">{label}</p>
      {children}
    </div>
  );
}

function CaseCard({ c }) {
  const [expanded, setExpanded] = useState(false);
  const displayMatches = expanded ? c.matches : c.matches.slice(0, 3);
  const alpha12 = c.alpha?.['12m'];

  return (
    <div className="card">
      {/* Case header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-warm-white">{c.ticker}</span>
            <span className="text-warm-muted text-xs font-mono">{c.date}</span>
            {alpha12 != null && (
              <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${alpha12 > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {alpha12 > 0 ? '+' : ''}{alpha12.toFixed(1)}% alpha
              </span>
            )}
          </div>
          {c.companyName && (
            <p className="text-sm text-warm-gray font-light mt-0.5">{c.companyName}</p>
          )}
        </div>
      </div>

      {/* Matches table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-dark-border/50">
              <th className="px-2 py-1.5 section-label">#</th>
              <th className="px-2 py-1.5 section-label">Match</th>
              <th className="px-2 py-1.5 section-label text-center">Score</th>
              {PERIODS.map(p => (
                <th key={p} className="px-2 py-1.5 section-label text-center">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayMatches.map((m, i) => (
              <tr key={m.ticker + i} className="border-b border-dark-border/20">
                <td className="px-2 py-2 text-warm-muted text-xs font-mono">{m.rank ?? i + 1}</td>
                <td className="px-2 py-2">
                  <span className="font-mono font-semibold text-warm-white text-sm">{m.ticker}</span>
                  {m.companyName && (
                    <span className="block text-xs text-warm-muted truncate max-w-[140px] font-light">{m.companyName}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`text-sm font-semibold font-mono ${m.matchScore >= 70 ? 'text-emerald-400' : m.matchScore >= 55 ? 'text-accent' : 'text-red-400'}`}>
                    {Math.round(m.matchScore)}
                  </span>
                </td>
                {PERIODS.map(p => (
                  <td key={p} className="px-2 py-2 text-center text-sm">
                    <SignedPct value={m.forwardReturns?.[p]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Expand toggle */}
      {c.matches.length > 3 && (
        <button
          className="mt-3 text-xs text-accent hover:text-accent-dim transition-colors duration-200 font-mono"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'Show fewer' : `Show all ${c.matches.length} matches`}
        </button>
      )}
    </div>
  );
}

export default function Proof() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/proof')
      .then(async res => {
        if (!res.ok) throw new Error(await httpError(res, 'Failed to load proof data'));
        return res.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-warm-gray text-sm animate-pulse font-light">Loading performance data...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="card border-red-500/20 text-red-400 text-sm">{error}</div>
      </main>
    );
  }

  if (!data) return null;

  const { cases = [], aggregate = {}, disclaimers = [] } = data;
  const periods = aggregate.periods || {};
  const correlation = aggregate.correlation || {};
  const p12 = periods['12m'] || {};
  const totalMatches = cases.reduce((sum, c) => sum + (c.matches?.length || 0), 0);
  const corrLabel = correlationLabel(correlation.rho ?? 0);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* A. Hero */}
      <div className="text-center mb-10">
        <h1 className="text-2xl sm:text-3xl font-display text-warm-white mb-2">
          How Blueprint Performs
        </h1>
        <p className="text-warm-gray text-sm font-light">
          Walk-forward validation across {cases.length} historical case{cases.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* B. Aggregate stat cards */}
      <div className="flex flex-wrap gap-3 mb-8">
        <StatCard label="12-Month Alpha vs SPY">
          <p className={`text-2xl font-bold font-mono ${(p12.alpha ?? 0) > 0 ? 'text-emerald-400' : (p12.alpha ?? 0) < 0 ? 'text-red-400' : 'text-warm-white'}`}>
            {p12.alpha != null ? `${p12.alpha > 0 ? '+' : ''}${p12.alpha.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-warm-muted mt-1 font-light">Average excess return</p>
        </StatCard>

        <StatCard label="12-Month Win Rate">
          <p className={`text-2xl font-bold font-mono ${(p12.winRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
            {p12.winRate != null ? `${p12.winRate.toFixed(0)}%` : '—'}
          </p>
          <p className="text-xs text-warm-muted mt-1 font-light">% beating SPY</p>
        </StatCard>

        <StatCard label="Score-Return Correlation">
          <p className={`text-2xl font-bold font-mono ${corrLabel.color}`}>
            {correlation.rho != null ? correlation.rho.toFixed(3) : '—'}
          </p>
          <p className={`text-xs mt-1 font-light ${corrLabel.color}`}>{corrLabel.text}</p>
        </StatCard>

        <StatCard label="Cases Tested">
          <p className="text-2xl font-bold font-mono text-warm-white">{cases.length}</p>
          <p className="text-xs text-warm-muted mt-1 font-light">{totalMatches.toLocaleString()} total matches</p>
        </StatCard>
      </div>

      {/* C. Period breakdown table */}
      <div className="card mb-8 overflow-x-auto">
        <p className="section-label mb-3">Performance by Period</p>
        <div className="divider-gold mb-4" />
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-dark-border/50">
              <th className="px-3 py-2 section-label">Period</th>
              <th className="px-3 py-2 section-label text-center">Avg Return</th>
              <th className="px-3 py-2 section-label text-center">SPY Return</th>
              <th className="px-3 py-2 section-label text-center">Alpha</th>
              <th className="px-3 py-2 section-label text-center">Win Rate</th>
              <th className="px-3 py-2 section-label text-center">Cases</th>
            </tr>
          </thead>
          <tbody>
            {PERIODS.map(p => {
              const pd = periods[p] || {};
              return (
                <tr key={p} className="border-b border-dark-border/20 hover:bg-dark-card-hover transition-colors duration-150">
                  <td className="px-3 py-2.5 text-warm-white text-sm font-medium">{PERIOD_LABELS[p]}</td>
                  <td className="px-3 py-2.5 text-center text-sm">
                    <SignedPct value={pd.avgReturn} />
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm">
                    <SignedPct value={pd.spyReturn} />
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm">
                    <SignedPct value={pd.alpha} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {pd.winRate != null ? (
                      <span className={`text-sm font-mono font-semibold ${pd.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pd.winRate.toFixed(0)}%
                      </span>
                    ) : <span className="text-warm-muted/40 font-mono">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm text-warm-gray font-mono">{pd.cases ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* D. Individual case cards */}
      {cases.length > 0 && (
        <div className="mb-8">
          <p className="section-label mb-4">Individual Cases</p>
          <div className="divider-gold mb-4" />
          <div className="flex flex-col gap-4">
            {cases.map((c, i) => (
              <CaseCard key={`${c.ticker}-${c.date}-${i}`} c={c} />
            ))}
          </div>
        </div>
      )}

      {/* E. Methodology */}
      <div className="card mb-8">
        <p className="section-label mb-3">Methodology</p>
        <div className="divider-gold mb-4" />
        <div className="text-sm text-warm-gray leading-relaxed space-y-3 font-light">
          <p>
            Blueprint compares stocks across <span className="text-warm-white font-medium">28 financial metrics</span> organized into
            6 categories: valuation, profitability, growth, financial health, market dynamics, and size.
          </p>
          <p>
            Each category uses <span className="text-warm-white font-medium">specialized similarity functions</span> tuned
            to the metric type — log-ratio for valuations and market caps, absolute difference for margins and ratios,
            and proportional scaling for growth rates.
          </p>
          <p>
            Historical snapshots are <span className="text-warm-white font-medium">reconstructed from point-in-time data</span>,
            using only financials that were actually reported as of the template date, preventing look-ahead bias.
          </p>
          <p>
            Walk-forward validation tests each case by running the matching algorithm on a historical date, then measuring
            how the top matches performed over the following 1, 3, 6, and 12 months versus SPY.
          </p>
        </div>
      </div>

      {/* F. Disclaimers */}
      {disclaimers.length > 0 && (
        <div className="card border-amber-500/15 bg-amber-500/5">
          <p className="section-label mb-3">Disclaimers</p>
          <div className="space-y-2">
            {disclaimers.map((d, i) => (
              <p key={i} className="text-xs text-amber-400/80 leading-relaxed font-light">{d}</p>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
