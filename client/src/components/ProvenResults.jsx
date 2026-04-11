import { useEffect, useState } from 'react';

function formatPct(val) {
  if (val == null) return '—';
  // Server sends values already in percentage form (e.g. 47.5 means 47.5%)
  const pct = val.toFixed(1);
  return val >= 0 ? `+${pct}%` : `${pct}%`;
}

function formatWinRate(val) {
  if (val == null) return '—';
  // Server sends winRate already as percentage (e.g. 89 means 89%)
  return `${Math.round(val)}%`;
}

function ReturnCell({ value, label }) {
  if (value == null) return (
    <div className="text-center">
      <p className="text-[10px] text-warm-muted uppercase tracking-wider">{label}</p>
      <p className="text-xs text-warm-muted font-mono">—</p>
    </div>
  );

  const isPositive = value >= 0;
  return (
    <div className="text-center">
      <p className="text-[10px] text-warm-muted uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-bold font-mono ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {formatPct(value)}
      </p>
    </div>
  );
}

export default function ProvenResults() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    async function fetchTrackRecord() {
      try {
        const res = await fetch('/api/track-record');
        if (cancelled) return;

        if (res.status === 202) {
          // Still computing — retry in 15s
          setRetrying(true);
          retryTimer = setTimeout(fetchTrackRecord, 15000);
          return;
        }

        if (!res.ok) throw new Error('Failed');

        const data = await res.json();
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setRecords(data);
          setLoading(false);
          setRetrying(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTrackRecord();
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, []);

  if (loading && !retrying) return null; // Don't show anything until we have data
  if (loading && retrying) {
    return (
      <div className="my-10 animate-fade-in">
        <div className="divider-gold mb-8" />
        <h2 className="text-lg font-display text-warm-white text-center mb-2">Historical Backtest</h2>
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <div className="w-5 h-5 border-2 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-xs text-warm-muted font-light">Computing historical backtest results...</p>
        </div>
      </div>
    );
  }

  if (records.length === 0) return null;

  // Compute aggregate stats
  const allReturns12m = records.map(r => r.avgReturn12m).filter(v => v != null);
  const avgAlpha = records.map(r => r.alpha12m).filter(v => v != null);
  const avgWinRate = records.map(r => r.winRate12m).filter(v => v != null);

  const overallAvgReturn = allReturns12m.length > 0
    ? allReturns12m.reduce((s, v) => s + v, 0) / allReturns12m.length
    : null;
  const overallAlpha = avgAlpha.length > 0
    ? avgAlpha.reduce((s, v) => s + v, 0) / avgAlpha.length
    : null;
  const overallWinRate = avgWinRate.length > 0
    ? avgWinRate.reduce((s, v) => s + v, 0) / avgWinRate.length
    : null;

  return (
    <div className="my-10 animate-fade-in">
      <div className="divider-gold mb-8" />

      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-lg font-display text-warm-white mb-1">Historical Backtest</h2>
        <p className="text-sm text-warm-gray font-light">
          Hypothetical performance of Blueprint's top matches from known breakout dates
        </p>
      </div>

      {/* Aggregate stats */}
      {(overallAvgReturn != null || overallAlpha != null) && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="card text-center py-3">
            <p className={`text-xl font-mono font-bold ${overallAvgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPct(overallAvgReturn)}
            </p>
            <p className="text-[10px] text-warm-muted mt-0.5">Avg 12m return</p>
          </div>
          <div className="card text-center py-3">
            <p className={`text-xl font-mono font-bold ${overallAlpha >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {overallAlpha != null ? formatPct(overallAlpha) : '—'}
            </p>
            <p className="text-[10px] text-warm-muted mt-0.5">Alpha vs SPY</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-xl font-mono font-bold text-accent">
              {formatWinRate(overallWinRate)}
            </p>
            <p className="text-[10px] text-warm-muted mt-0.5">Win rate (12m)</p>
          </div>
        </div>
      )}

      {/* Per-breakout results */}
      <div className="space-y-2">
        {records.map(record => (
          <div key={record.ticker} className="card hover:border-dark-border-hover transition-all duration-200">
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="font-mono font-bold text-warm-white text-base">{record.ticker}</span>
                <span className="text-xs text-warm-gray font-light">{record.label}</span>
                <span className="text-[10px] text-warm-muted font-mono">{record.date}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-warm-muted">Template gained</span>
                <span className="text-sm font-mono font-bold text-emerald-400">{record.templateGain}</span>
              </div>
            </div>

            {/* Returns grid */}
            <div className="grid grid-cols-4 gap-2 py-2 px-1 rounded-lg bg-dark-surface/50">
              <ReturnCell value={record.avgReturn1m} label="1 month" />
              <ReturnCell value={record.avgReturn3m} label="3 months" />
              <ReturnCell value={record.avgReturn6m} label="6 months" />
              <ReturnCell value={record.avgReturn12m} label="12 months" />
            </div>

            {/* Footer stats */}
            <div className="flex items-center gap-4 mt-2 text-[10px] text-warm-muted">
              <span>{record.matchCount} matches found</span>
              {record.winRate12m != null && (
                <span>Win rate: <span className="text-warm-gray font-mono">{formatWinRate(record.winRate12m)}</span></span>
              )}
              {record.alpha12m != null && (
                <span>Alpha: <span className={`font-mono ${record.alpha12m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatPct(record.alpha12m)}</span></span>
              )}
              {record.topMatchTicker && (
                <span className="ml-auto">Top match: <span className="text-warm-gray font-mono">{record.topMatchTicker}</span> ({record.topMatchScore})</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-warm-muted text-center mt-4 font-light">
        Hypothetical results based on Blueprint's matching algorithm applied to historical breakout dates.
        Top 10 matches per template — forward returns measured from the template date.
        This is not a live trading record. Past performance does not guarantee future results.
      </p>
    </div>
  );
}
