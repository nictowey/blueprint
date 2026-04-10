import { formatMetric, METRIC_LABELS } from '../utils/format';

const METRICS = [
  'price', 'marketCap', 'peRatio',
  'revenueGrowthYoY', 'epsGrowthYoY', 'operatingMargin',
  'returnOnEquity', 'pctBelowHigh', 'priceVsMa200',
  'debtToEquity', 'freeCashFlowYield', 'rsi14',
];

function MetricCell({ label, value }) {
  return (
    <div className="bg-dark-surface rounded-lg p-2.5 sm:p-4 flex flex-col gap-1 border border-dark-border/30 hover:border-dark-border/60 transition-colors duration-200">
      <span className="text-[10px] sm:text-xs font-medium text-warm-muted uppercase tracking-wider leading-tight">{label}</span>
      <span className={`text-sm sm:text-lg font-semibold font-mono ${value === '—' ? 'text-warm-muted/50' : 'text-warm-white'}`}>
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
            <span className="text-xl sm:text-2xl font-bold text-warm-white font-mono">{snapshot.ticker}</span>
            {snapshot.sector && (
              <span className="text-xs border border-dark-border text-warm-gray px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full">
                {snapshot.sector}
              </span>
            )}
          </div>
          <p className="text-warm-gray text-sm sm:text-base font-light">{snapshot.companyName}</p>
        </div>
        <div className="sm:text-right">
          <p className="section-label mb-1">Snapshot Date</p>
          <p className="text-sm font-medium text-warm-white font-mono">{snapshot.date}</p>
          {snapshot.dataAsOf && snapshot.dataAsOf !== snapshot.date && (
            <p className="text-[10px] sm:text-xs text-amber-500/80 mt-1">
              Financials as of {snapshot.dataAsOf}
              {snapshot.ttmQuarters < 4 ? ` (${snapshot.ttmQuarters}/4 quarters)` : ''}
            </p>
          )}
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
