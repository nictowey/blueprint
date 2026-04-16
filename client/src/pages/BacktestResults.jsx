import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { httpError } from '../utils/httpError';
import { toCSV, downloadCSV } from '../utils/export';
import ShareBar from '../components/ShareBar';
import ReturnBarChart from '../components/ReturnBarChart';

const PERIODS = ['1m', '3m', '6m', '12m'];
const PERIOD_LABELS = { '1m': '1 Month', '3m': '3 Months', '6m': '6 Months', '12m': '12 Months' };

function ReturnCell({ value, benchmark }) {
  if (value == null) return <td className="px-3 py-2.5 text-center text-text-muted/40 text-sm font-mono">—</td>;
  const positive = value > 0;
  const color = positive ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-text-secondary';
  const vsBench = benchmark != null ? value - benchmark : null;

  return (
    <td className="px-3 py-2.5 text-center">
      <span className={`text-sm font-semibold font-mono ${color}`}>
        {positive ? '+' : ''}{value.toFixed(1)}%
      </span>
      {vsBench != null && (
        <span className={`block text-xs mt-0.5 font-mono ${vsBench > 0 ? 'text-emerald-500/60' : vsBench < 0 ? 'text-red-500/60' : 'text-text-muted'}`}>
          {vsBench > 0 ? '+' : ''}{vsBench.toFixed(1)}% vs SPY
        </span>
      )}
    </td>
  );
}

function SummaryCard({ label, period, summary, benchmark }) {
  if (!summary) return null;
  const benchReturn = benchmark?.returns?.[period]?.returnPct;

  return (
    <div className="card flex-1 min-w-[140px]">
      <p className="section-label mb-2">{label}</p>
      <p className={`text-xl font-bold font-mono ${summary.avgReturn > 0 ? 'text-emerald-400' : summary.avgReturn < 0 ? 'text-red-400' : 'text-text-primary'}`}>
        {summary.avgReturn > 0 ? '+' : ''}{summary.avgReturn.toFixed(1)}%
      </p>
      <p className="text-xs text-text-muted mt-1 font-light">Avg return</p>
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Median</span>
          <span className="text-text-primary font-mono">{summary.medianReturn > 0 ? '+' : ''}{summary.medianReturn.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Win rate</span>
          <span className={`font-mono ${summary.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{summary.winRate}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Best</span>
          <span className="text-emerald-400 font-mono">+{summary.bestReturn.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Worst</span>
          <span className="text-red-400 font-mono">{summary.worstReturn.toFixed(1)}%</span>
        </div>
        {benchReturn != null && (
          <div className="flex justify-between pt-1 border-t border-border/50">
            <span className="text-text-muted">SPY</span>
            <span className="text-text-secondary font-mono">{benchReturn > 0 ? '+' : ''}{benchReturn.toFixed(1)}%</span>
          </div>
        )}
        {summary.avgVsBenchmark != null && (
          <div className="flex justify-between">
            <span className="text-text-muted">Alpha</span>
            <span className={`font-mono ${summary.avgVsBenchmark > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.avgVsBenchmark > 0 ? '+' : ''}{summary.avgVsBenchmark.toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BacktestResults() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ticker = searchParams.get('ticker');
  const date = searchParams.get('date');
  const profile = searchParams.get('profile') || 'growth_breakout';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartPeriod, setChartPeriod] = useState('3m');

  useEffect(() => {
    if (!ticker || !date) { navigate('/', { replace: true }); return; }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ ticker, date });
    if (profile !== 'growth_breakout') params.set('profile', profile);

    fetch(`/api/backtest?${params}`)
      .then(async res => {
        if (!res.ok) throw new Error(await httpError(res, 'Backtest failed'));
        return res.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [ticker, date, profile, navigate]);

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col items-center justify-center py-14 gap-4">
          <div className="w-8 h-8 border-3 border-border border-t-brand rounded-full animate-spin" />
          <p className="text-text-secondary text-sm animate-pulse font-light">Running backtest — fetching forward returns…</p>
          <p className="text-text-muted text-xs">This may take 15–30 seconds</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="card border-red-500/20 text-red-400 text-sm mb-4">{error}</div>
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back to matches</button>
      </main>
    );
  }

  if (!data || data.results.length === 0) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="card text-center py-10">
          <p className="text-text-primary text-sm">No backtest data available for this template.</p>
        </div>
        <button className="btn-secondary mt-4" onClick={() => navigate(-1)}>← Back to matches</button>
      </main>
    );
  }

  const { results, benchmark, summary } = data;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-display text-text-primary">
            Backtest: <span className="text-brand italic">{ticker}</span>
            <span className="text-text-muted text-base font-sans font-normal ml-2 font-mono">{date}</span>
          </h1>
          <p className="text-sm text-text-secondary mt-1 font-light">
            How did the top {results.length} matches perform after the snapshot date?
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ShareBar
            onExportCSV={() => {
              const columns = [
                { key: 'ticker', label: 'Ticker' },
                { key: 'companyName', label: 'Company' },
                { key: 'sector', label: 'Sector' },
                { key: 'matchScore', label: 'Match Score' },
                { key: 'startPrice', label: 'Start Price', format: r => r.startPrice?.toFixed(2) },
                { key: '1m', label: '1M Return %', format: r => r.returns?.['1m']?.returnPct?.toFixed(1) },
                { key: '3m', label: '3M Return %', format: r => r.returns?.['3m']?.returnPct?.toFixed(1) },
                { key: '6m', label: '6M Return %', format: r => r.returns?.['6m']?.returnPct?.toFixed(1) },
                { key: '12m', label: '12M Return %', format: r => r.returns?.['12m']?.returnPct?.toFixed(1) },
              ];
              const csv = toCSV(results, columns);
              downloadCSV(csv, `blueprint-backtest-${ticker}-${date}.csv`);
            }}
            exportLabel="Export backtest"
          />
          <button className="btn-secondary text-xs" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="card mb-6 border-amber-500/15 bg-amber-500/5">
        <p className="text-xs text-amber-400/80 leading-relaxed font-light">
          This backtest finds stocks that currently resemble the historical template, then measures their actual price
          changes from the template date. Matches are based on today's fundamentals, not what these companies looked like
          at the template date. Survivorship bias may affect results. Past performance does not guarantee future results.
        </p>
      </div>

      {/* Summary cards */}
      <div className="flex flex-wrap gap-3 mb-6">
        {PERIODS.map(p => (
          <SummaryCard
            key={p}
            label={PERIOD_LABELS[p]}
            period={p}
            summary={summary[p]}
            benchmark={benchmark}
          />
        ))}
      </div>

      {/* Return visualization */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <span className="section-label">Return distribution</span>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p}
                className={`text-xs px-2.5 py-1 rounded font-mono transition-colors duration-200 ${chartPeriod === p ? 'bg-brand/15 text-brand' : 'text-text-muted hover:text-text-secondary'}`}
                onClick={() => setChartPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <ReturnBarChart
          results={results}
          period={chartPeriod}
          benchmarkReturn={benchmark?.returns?.[chartPeriod]?.returnPct}
        />
      </div>

      {/* Results table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border/50">
              <th className="px-3 py-2 section-label">#</th>
              <th className="px-3 py-2 section-label">Ticker</th>
              <th className="px-3 py-2 section-label hidden sm:table-cell">Sector</th>
              <th className="px-3 py-2 section-label text-center">Score</th>
              <th className="px-3 py-2 section-label text-center">Start $</th>
              {PERIODS.map(p => (
                <th key={p} className="px-3 py-2 section-label text-center">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.ticker} className="even:bg-surface/50 hover:bg-surface-hover transition-colors duration-150">
                <td className="px-3 py-2.5 text-text-muted text-sm font-mono">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <span className="font-mono font-semibold text-text-primary text-sm">{r.ticker}</span>
                  <span className="block text-xs text-text-muted truncate max-w-[120px] font-light">{r.companyName}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-text-muted hidden sm:table-cell">{r.sector || '—'}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`text-sm font-semibold font-mono ${r.matchScore >= 70 ? 'text-emerald-400' : r.matchScore >= 55 ? 'text-brand' : 'text-red-400'}`}>
                    {Math.round(r.matchScore)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center text-sm text-text-primary font-mono">
                  {r.startPrice != null ? `$${r.startPrice.toFixed(2)}` : '—'}
                </td>
                {PERIODS.map(p => (
                  <ReturnCell
                    key={p}
                    value={r.returns?.[p]?.returnPct}
                    benchmark={benchmark?.returns?.[p]?.returnPct}
                  />
                ))}
              </tr>
            ))}
            {/* Benchmark row */}
            {benchmark && (
              <tr className="border-t-2 border-border/50 bg-surface">
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5">
                  <span className="font-mono font-semibold text-text-secondary text-sm">SPY</span>
                  <span className="block text-xs text-text-muted font-light">Benchmark</span>
                </td>
                <td className="px-3 py-2.5 hidden sm:table-cell" />
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-center text-sm text-text-secondary font-mono">
                  {benchmark.startPrice != null ? `$${benchmark.startPrice.toFixed(2)}` : '—'}
                </td>
                {PERIODS.map(p => (
                  <td key={p} className="px-3 py-2.5 text-center">
                    {benchmark.returns?.[p]?.returnPct != null ? (
                      <span className={`text-sm font-semibold font-mono ${benchmark.returns[p].returnPct > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                        {benchmark.returns[p].returnPct > 0 ? '+' : ''}{benchmark.returns[p].returnPct.toFixed(1)}%
                      </span>
                    ) : <span className="text-text-muted text-sm font-mono">—</span>}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
