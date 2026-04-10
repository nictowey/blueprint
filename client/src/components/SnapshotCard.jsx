import { formatMetric, METRIC_LABELS } from '../utils/format';

const METRICS = [
  'price', 'marketCap', 'peRatio',
  'revenueGrowthYoY', 'epsGrowthYoY', 'operatingMargin',
  'returnOnEquity', 'pctBelowHigh', 'priceVsMa200',
  'debtToEquity', 'freeCashFlowYield', 'rsi14',
];

function MetricCell({ label, value }) {
  return (
    <div className="bg-dark-bg rounded-lg p-2.5 sm:p-4 flex flex-col gap-1">
      <span className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wider leading-tight">{label}</span>
      <span className={`text-sm sm:text-lg font-semibold ${value === '—' ? 'text-slate-600' : 'text-slate-100'}`}>
        {value}
      </span>
    </div>
  );
}

export default function SnapshotCard({ snapshot }) {
  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-0 mb-4 sm:mb-5">
        <div>
          <div className="flex items-center gap-2 sm:gap-3 mb-1">
            <span className="text-xl sm:text-2xl font-bold text-slate-100 font-mono">{snapshot.ticker}</span>
            {snapshot.sector && (
              <span className="text-xs border border-dark-border text-slate-400 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full">
                {snapshot.sector}
              </span>
            )}
          </div>
          <p className="text-slate-400 text-sm sm:text-base">{snapshot.companyName}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Snapshot Date</p>
          <p className="text-sm font-medium text-slate-300">{snapshot.date}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
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
