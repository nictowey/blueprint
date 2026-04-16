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
  const matches = c.matches || [];
  const displayMatches = expanded ? matches : matches.slice(0, 3);

  // Compute alpha: avg match 12m return minus benchmark 12m return
  const match12mReturns = matches.map(m => m.forwardReturns?.['12m']).filter(r => r != null);
  const avgMatch12m = match12mReturns.length > 0 ? match12mReturns.reduce((s, r) => s + r, 0) / match12mReturns.length : null;
  const bench12m = c.benchmark?.['12m'] ?? null;
  const alpha12 = (avgMatch12m != null && bench12m != null) ? avgMatch12m - bench12m : null;

  const ticker = c.templateTicker || c.ticker || '?';
  const date = c.templateDate || c.date || '';
  const companyName = c.templateCompanyName || c.companyName || '';
  const sector = c.templateSector || c.sector || '';

  return (
    <div className="card">
      {/* Case header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-warm-white">{ticker}</span>
            {sector && <span className="text-[10px] text-warm-muted border border-dark-border/50 rounded-full px-2 py-0.5">{sector}</span>}
            <span className="text-warm-muted text-xs font-mono">{date}</span>
            {alpha12 != null && (
              <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${alpha12 > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {alpha12 > 0 ? '+' : ''}{alpha12.toFixed(1)}% alpha
              </span>
            )}
          </div>
          {companyName && (
            <p className="text-sm text-warm-gray font-light mt-0.5">{companyName}</p>
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
  const rho12 = correlation['12m']?.rho ?? null;
  const corrLabel = correlationLabel(rho12 ?? 0);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* A. Hero */}
      <div className="text-center mb-10">
        <h1 className="text-2xl sm:text-3xl font-display text-warm-white mb-2">
          Methodology
        </h1>
        <p className="text-warm-gray text-sm font-light max-w-xl mx-auto">
          How Blueprint finds stocks with similar financial DNA to proven breakout winners.
        </p>
      </div>

      {/* B. Methodology — FIRST, before data */}
      <div className="card mb-8">
        <p className="section-label mb-3">How It Works</p>
        <div className="divider-gold mb-4" />
        <div className="text-sm text-warm-gray leading-relaxed space-y-3 font-light">
          <p>
            Blueprint compares stocks across <span className="text-warm-white font-medium">28 financial metrics</span> organized into
            6 categories: valuation, profitability, growth, financial health, size, and technical indicators.
          </p>
          <p>
            Each category uses <span className="text-warm-white font-medium">specialized similarity functions</span> tuned
            to the metric type — log-ratio for valuations and market caps, hybrid absolute/relative for margins,
            dampened comparison for growth rates, and bounded scales for technical indicators.
          </p>
          <p>
            Categories are weighted by relevance to breakout detection: <span className="text-warm-white font-medium">Growth and Profitability (25% each)</span> are
            the strongest signals, followed by Valuation (22%), Financial Health and Technical (10% each), and Size (8%).
          </p>
          <p>
            <span className="text-warm-white font-medium">5 strategy profiles</span> shift these weights to match different investing styles —
            Growth Breakout emphasizes revenue acceleration, Value Inflection prioritizes cheap valuations,
            and Quality Compounder focuses on returns on capital.
          </p>
        </div>
      </div>

      {/* C. Key stats — honest, framed as validation context */}
      <p className="section-label mb-4">Walk-Forward Validation</p>
      <p className="text-sm text-warm-gray font-light mb-4 max-w-2xl">
        We tested the algorithm against {cases.length} historical breakout cases using reconstructed point-in-time financial data.
        Here's how the top matches performed.
      </p>
      <div className="flex flex-wrap gap-3 mb-8">
        <StatCard label="Avg 12-Month Return">
          <p className={`text-2xl font-bold font-mono ${(p12.avgReturn ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {p12.avgReturn != null ? `${p12.avgReturn > 0 ? '+' : ''}${p12.avgReturn.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-warm-muted mt-1 font-light">Across all matches</p>
        </StatCard>

        <StatCard label="12-Month Win Rate">
          <p className={`text-2xl font-bold font-mono ${(p12.winRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
            {p12.winRate != null ? `${p12.winRate.toFixed(0)}%` : '—'}
          </p>
          <p className="text-xs text-warm-muted mt-1 font-light">% of matches with positive returns</p>
        </StatCard>

        <StatCard label="SPY Benchmark">
          <p className="text-2xl font-bold font-mono text-warm-gray">
            {p12.benchmarkReturn != null ? `+${p12.benchmarkReturn.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-warm-muted mt-1 font-light">Same period average</p>
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
                    <SignedPct value={pd.benchmarkReturn} />
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
                  <td className="px-3 py-2.5 text-center text-sm text-warm-gray font-mono">{pd.caseCount ?? '—'}</td>
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

      {/* E. Disclaimers */}
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
