import { formatMetric, METRIC_LABELS } from '../utils/format';

const METRICS = [
  'price', 'marketCap', 'peRatio',
  'revenueGrowthYoY', 'epsGrowthYoY', 'operatingMargin',
  'returnOnEquity', 'pctBelowHigh', 'priceVsMa200',
  'debtToEquity', 'freeCashFlowYield', 'rsi14',
];

function MetricCell({ label, value }) {
  return (
    <div className="bg-dark-bg rounded-lg p-4 flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-lg font-semibold ${value === '—' ? 'text-slate-600' : 'text-slate-100'}`}>
        {value}
      </span>
    </div>
  );
}

export default function SnapshotCard({ snapshot }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl font-bold text-slate-100 font-mono">{snapshot.ticker}</span>
            {snapshot.sector && (
              <span className="text-xs border border-dark-border text-slate-400 px-2.5 py-1 rounded-full">
                {snapshot.sector}
              </span>
            )}
          </div>
          <p className="text-slate-400">{snapshot.companyName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Snapshot Date</p>
          <p className="text-sm font-medium text-slate-300">{snapshot.date}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {METRICS.map(key => (
          <MetricCell
            key={key}
            label={METRIC_LABELS[key]}
            value={formatMetric(key, snapshot[key])}
          />
        ))}
      </div>
    </div>
  );
}
