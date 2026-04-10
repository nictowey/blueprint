import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { httpError } from '../utils/httpError';
import { toCSV, downloadCSV } from '../utils/export';
import ShareBar from '../components/ShareBar';
import ReturnBarChart from '../components/ReturnBarChart';

const PERIODS = ['1m', '3m', '6m', '12m'];
const PERIOD_LABELS = { '1m': '1 Month', '3m': '3 Months', '6m': '6 Months', '12m': '12 Months' };

function ReturnCell({ value, benchmark }) {
  if (value == null) return <td className="px-3 py-2.5 text-center text-slate-600 text-sm">—</td>;
  const positive = value > 0;
  const color = positive ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-slate-400';
  const vsBench = benchmark != null ? value - benchmark : null;

  return (
    <td className="px-3 py-2.5 text-center">
      <span className={`text-sm font-semibold ${color}`}>
        {positive ? '+' : ''}{value.toFixed(1)}%
      </span>
      {vsBench != null && (
        <span className={`block text-xs mt-0.5 ${vsBench > 0 ? 'text-green-500/60' : vsBench < 0 ? 'text-red-500/60' : 'text-slate-600'}`}>
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
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-bold ${summary.avgReturn > 0 ? 'text-green-400' : summary.avgReturn < 0 ? 'text-red-400' : 'text-slate-300'}`}>
        {summary.avgReturn > 0 ? '+' : ''}{summary.avgReturn.toFixed(1)}%
      </p>
      <p className="text-xs text-slate-500 mt-1">Avg return</p>
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">Median</span>
          <span className="text-slate-300">{summary.medianReturn > 0 ? '+' : ''}{summary.medianReturn.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Win rate</span>
          <span className={summary.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>{summary.winRate}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Best</span>
          <span className="text-green-400">+{summary.bestReturn.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Worst</span>
          <span className="text-red-400">{summary.worstReturn.toFixed(1)}%</span>
        </div>
        {benchReturn != null && (
          <div className="flex justify-between pt-1 border-t border-dark-border/50">
            <span className="text-slate-500">SPY</span>
            <span className="text-slate-400">{benchReturn > 0 ? '+' : ''}{benchReturn.toFixed(1)}%</span>
          </div>
        )}
        {summary.avgVsBenchmark != null && (
          <div className="flex justify-between">
            <span className="text-slate-500">Alpha</span>
            <span className={summary.avgVsBenchmark > 0 ? 'text-green-400' : 'text-red-400'}>
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
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm animate-pulse">Running backtest — fetching forward returns…</p>
          <p className="text-slate-600 text-xs">This may take 15–30 seconds</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="card border-red-500/30 text-red-400 text-sm mb-4">{error}</div>
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back to matches</button>
      </main>
    );
  }

  if (!data || data.results.length === 0) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="card text-center py-10">
          <p className="text-slate-300 text-sm">No backtest data available for this template.</p>
        </div>
        <button className="btn-secondary mt-4" onClick={() => navigate(-1)}>← Back to matches</button>
      </main>
    );
  }

  const { results, benchmark, summary } = data;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100">
            Backtest: <span className="text-accent">{ticker}</span>
            <span className="text-slate-500 text-base font-normal ml-2">{date}</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
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
      <div className="card mb-6 border-yellow-500/20 bg-yellow-500/5">
        <p className="text-xs text-yellow-400/80 leading-relaxed">
          Past performance does not guarantee future results. This backtest uses current universe data matched against
          a historical snapshot — survivorship bias may affect results. Use as one input among many.
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
          <span className="text-xs text-slate-500 uppercase tracking-wider">Return distribution</span>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p}
                className={`text-xs px-2.5 py-1 rounded ${chartPeriod === p ? 'bg-accent/20 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
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
            <tr className="border-b border-dark-border/50">
              <th className="px-3 py-2 text-xs text-slate-500 uppercase tracking-wider">#</th>
              <th className="px-3 py-2 text-xs text-slate-500 uppercase tracking-wider">Ticker</th>
              <th className="px-3 py-2 text-xs text-slate-500 uppercase tracking-wider hidden sm:table-cell">Sector</th>
              <th className="px-3 py-2 text-xs text-slate-500 uppercase tracking-wider text-center">Score</th>
              <th className="px-3 py-2 text-xs text-slate-500 uppercase tracking-wider text-center">Start $</th>
              {PERIODS.map(p => (
                <th key={p} className="px-3 py-2 text-xs text-slate-500 uppercase tracking-wider text-center">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={r.ticker} className="border-b border-dark-border/30 hover:bg-dark-border/20 transition-colors">
                <td className="px-3 py-2.5 text-slate-600 text-sm">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <span className="font-mono font-semibold text-slate-100 text-sm">{r.ticker}</span>
                  <span className="block text-xs text-slate-500 truncate max-w-[120px]">{r.companyName}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500 hidden sm:table-cell">{r.sector || '—'}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`text-sm font-semibold ${r.matchScore >= 70 ? 'text-green-400' : r.matchScore >= 55 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {Math.round(r.matchScore)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-center text-sm text-slate-300">
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
              <tr className="border-t-2 border-dark-border/50 bg-dark-border/10">
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5">
                  <span className="font-mono font-semibold text-slate-400 text-sm">SPY</span>
                  <span className="block text-xs text-slate-600">Benchmark</span>
                </td>
                <td className="px-3 py-2.5 hidden sm:table-cell" />
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-center text-sm text-slate-400">
                  {benchmark.startPrice != null ? `$${benchmark.startPrice.toFixed(2)}` : '—'}
                </td>
                {PERIODS.map(p => (
                  <td key={p} className="px-3 py-2.5 text-center">
                    {benchmark.returns?.[p]?.returnPct != null ? (
                      <span className={`text-sm font-semibold ${benchmark.returns[p].returnPct > 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                        {benchmark.returns[p].returnPct > 0 ? '+' : ''}{benchmark.returns[p].returnPct.toFixed(1)}%
                      </span>
                    ) : <span className="text-slate-600 text-sm">—</span>}
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
