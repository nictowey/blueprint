import { formatMetric } from '../utils/format';
import { getMetricColor } from '../utils/metricColor';

// Color-code match metric: green = better, yellow = in line, red = worse
function getDiffColor(key, leftVal, rightVal) {
  return getMetricColor(key, leftVal, rightVal);
}

function DotIndicator({ colorClass }) {
  return (
    <div className={`w-2 h-2 rounded-full bg-current ${colorClass} mx-auto`} />
  );
}

export default function ComparisonRow({ label, metricKey, leftValue, rightValue }) {
  const colorClass = getDiffColor(metricKey, leftValue, rightValue);

  return (
    <div className="grid grid-cols-[1fr_2px_40px_2px_1fr] items-center gap-0 py-3 border-b border-dark-border/30 last:border-0">
      {/* Left value */}
      <div className="text-right pr-4">
        <span className={`text-sm font-semibold font-mono ${leftValue == null ? 'text-warm-muted/40' : 'text-warm-white'}`}>
          {formatMetric(metricKey, leftValue)}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px bg-dark-border h-full" />

      {/* Color dot */}
      <div className="flex justify-center">
        <DotIndicator colorClass={colorClass} />
      </div>

      {/* Divider */}
      <div className="w-px bg-dark-border h-full" />

      {/* Right value */}
      <div className="pl-4">
        <span className={`text-sm font-semibold font-mono ${rightValue == null ? 'text-warm-muted/40' : 'text-warm-white'}`}>
          {formatMetric(metricKey, rightValue)}
        </span>
      </div>
    </div>
  );
}

// Static row for the label column (rendered separately)
export function MetricLabel({ label }) {
  return (
    <div className="py-3 border-b border-dark-border/30 last:border-0 text-center">
      <span className="text-xs text-warm-muted uppercase tracking-wider">{label}</span>
    </div>
  );
}
