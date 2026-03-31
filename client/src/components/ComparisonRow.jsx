import { formatMetric } from '../utils/format';

// Color-code by % difference between two metric values
function getDiffColor(key, leftVal, rightVal) {
  if (leftVal == null || rightVal == null) return 'text-slate-600';
  let leftNum = leftVal;
  let rightNum = rightVal;
  if (leftNum === 0) return rightNum === 0 ? 'text-green-400' : 'text-red-400';
  const pctDiff = Math.abs((rightNum - leftNum) / Math.abs(leftNum)) * 100;
  if (pctDiff <= 15) return 'text-green-400';
  if (pctDiff <= 40) return 'text-yellow-400';
  return 'text-red-400';
}

function DotIndicator({ colorClass }) {
  return (
    <div className={`w-2 h-2 rounded-full bg-current ${colorClass} mx-auto`} />
  );
}

export default function ComparisonRow({ label, metricKey, leftValue, rightValue }) {
  const colorClass = getDiffColor(metricKey, leftValue, rightValue);

  return (
    <div className="grid grid-cols-[1fr_2px_40px_2px_1fr] items-center gap-0 py-3 border-b border-dark-border last:border-0">
      {/* Left value */}
      <div className="text-right pr-4">
        <span className={`text-sm font-semibold ${leftValue == null ? 'text-slate-600' : 'text-slate-100'}`}>
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
        <span className={`text-sm font-semibold ${rightValue == null ? 'text-slate-600' : 'text-slate-100'}`}>
          {formatMetric(metricKey, rightValue)}
        </span>
      </div>
    </div>
  );
}

// Static row for the label column (rendered separately)
export function MetricLabel({ label }) {
  return (
    <div className="py-3 border-b border-dark-border last:border-0 text-center">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}
