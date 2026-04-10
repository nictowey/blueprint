/**
 * Tiny inline sparkline for match cards.
 * Shows last N prices as a simple SVG line.
 */
export default function MiniSparkline({ prices, width = 80, height = 28 }) {
  if (!prices || prices.length < 2) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * width;
    const y = height - 2 - ((p - min) / range) * (height - 4);
    return `${x},${y}`;
  }).join(' ');

  const gainPct = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  const color = gainPct >= 0 ? '#22c55e' : '#ef4444';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
