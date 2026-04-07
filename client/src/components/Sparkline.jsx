export default function Sparkline({ data, gainPct, label = 'What happened after this snapshot', period = '18 months' }) {
  if (!data || data.length < 2) {
    return <div className="h-24 flex items-center justify-center text-slate-600 text-sm">No price history</div>;
  }

  const prices = data.map(d => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const W = 600;
  const H = 80;
  const PAD = 4;

  const points = prices.map((p, i) => {
    const x = PAD + (i / (prices.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p - minP) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  const isPositive = gainPct == null || gainPct >= 0;
  const strokeColor = isPositive ? '#22c55e' : '#ef4444';
  const gainStr = gainPct == null
    ? '—'
    : `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 uppercase tracking-wider">
          {label}
        </span>
        <span
          className="text-sm font-bold"
          style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
        >
          {gainStr} over {period}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: '80px' }}
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
