/**
 * Horizontal bar chart showing returns per stock for a given time period.
 * Bars extend left (red) for losses, right (green) for gains.
 */
export default function ReturnBarChart({ results, period, benchmarkReturn }) {
  // Filter to stocks with data for this period
  const items = results
    .filter(r => r.returns?.[period]?.returnPct != null)
    .map(r => ({ ticker: r.ticker, returnPct: r.returns[period].returnPct }))
    .sort((a, b) => b.returnPct - a.returnPct);

  if (items.length === 0) return null;

  const maxAbs = Math.max(
    ...items.map(i => Math.abs(i.returnPct)),
    benchmarkReturn != null ? Math.abs(benchmarkReturn) : 0,
    10 // min scale
  );

  return (
    <div className="space-y-1.5">
      {items.map(item => {
        const pct = item.returnPct;
        const barWidth = Math.abs(pct) / maxAbs * 50; // max 50% width
        const isPositive = pct >= 0;

        return (
          <div key={item.ticker} className="flex items-center gap-2 h-6">
            <span className="text-xs font-mono text-warm-gray w-12 text-right shrink-0">{item.ticker}</span>
            <div className="flex-1 relative h-full flex items-center">
              {/* Center line */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-dark-border" />
              {/* Bar */}
              <div
                className="absolute h-4 rounded-sm transition-all duration-500"
                style={{
                  backgroundColor: isPositive ? '#22c55e' : '#ef4444',
                  opacity: 0.6,
                  width: `${barWidth}%`,
                  ...(isPositive
                    ? { left: '50%' }
                    : { right: '50%' }),
                }}
              />
              {/* Label */}
              <span
                className={`absolute text-[10px] font-semibold font-mono ${isPositive ? 'text-emerald-300' : 'text-red-300'}`}
                style={{
                  ...(isPositive
                    ? { left: `calc(50% + ${barWidth}% + 4px)` }
                    : { right: `calc(50% + ${barWidth}% + 4px)` }),
                }}
              >
                {isPositive ? '+' : ''}{pct.toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}
      {/* Benchmark line */}
      {benchmarkReturn != null && (
        <div className="flex items-center gap-2 h-6 border-t border-dark-border/50 pt-1">
          <span className="text-xs font-mono text-warm-muted w-12 text-right shrink-0">SPY</span>
          <div className="flex-1 relative h-full flex items-center">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-dark-border" />
            <div
              className="absolute h-4 rounded-sm transition-all duration-500"
              style={{
                backgroundColor: benchmarkReturn >= 0 ? '#60a5fa' : '#f87171',
                opacity: 0.4,
                width: `${Math.abs(benchmarkReturn) / maxAbs * 50}%`,
                ...(benchmarkReturn >= 0
                  ? { left: '50%' }
                  : { right: '50%' }),
              }}
            />
            <span
              className="absolute text-[10px] font-semibold font-mono text-blue-300"
              style={{
                ...(benchmarkReturn >= 0
                  ? { left: `calc(50% + ${Math.abs(benchmarkReturn) / maxAbs * 50}% + 4px)` }
                  : { right: `calc(50% + ${Math.abs(benchmarkReturn) / maxAbs * 50}% + 4px)` }),
              }}
            >
              {benchmarkReturn >= 0 ? '+' : ''}{benchmarkReturn.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
