import { useState, useRef, useCallback } from 'react';

/**
 * Interactive normalized price overlay chart.
 * Draws two price series on the same axes, normalized to 100 at start.
 * Supports hover tooltip showing date, prices, and returns.
 */
export default function PriceOverlayChart({
  templateData,   // [{ date, price }]
  matchData,       // [{ date, price }]
  templateTicker,
  matchTicker,
  templateLabel = 'Template',
  matchLabel = 'Match',
}) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  // Normalize to 100 at start
  function normalize(data) {
    if (!data || data.length < 2) return [];
    const base = data[0].price;
    if (!base) return [];
    return data.map(d => ({ date: d.date, value: (d.price / base) * 100 }));
  }

  const tplNorm = normalize(templateData);
  const matchNorm = normalize(matchData);

  if (tplNorm.length < 2 && matchNorm.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-slate-600 text-sm">
        No price data available for overlay
      </div>
    );
  }

  // Find global min/max across both series
  const allValues = [...tplNorm.map(d => d.value), ...matchNorm.map(d => d.value)];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  const W = 700;
  const H = 200;
  const PAD_L = 45;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 24;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  function toPoints(data) {
    return data.map((d, i) => {
      const x = PAD_L + (i / (data.length - 1)) * plotW;
      const y = PAD_T + plotH - ((d.value - minVal) / range) * plotH;
      return { x, y, ...d };
    });
  }

  const tplPoints = toPoints(tplNorm);
  const matchPoints = toPoints(matchNorm);

  const tplPolyline = tplPoints.map(p => `${p.x},${p.y}`).join(' ');
  const matchPolyline = matchPoints.map(p => `${p.x},${p.y}`).join(' ');

  // Y-axis gridlines
  const yTicks = 5;
  const yLines = [];
  for (let i = 0; i <= yTicks; i++) {
    const val = minVal + (i / yTicks) * range;
    const y = PAD_T + plotH - (i / yTicks) * plotH;
    yLines.push({ y, label: val.toFixed(0) });
  }

  // 100 baseline
  const baseY = PAD_T + plotH - ((100 - minVal) / range) * plotH;

  // Hover handler
  const handleMouseMove = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;

    // Find nearest template point
    const longerSeries = tplPoints.length >= matchPoints.length ? tplPoints : matchPoints;
    let nearest = longerSeries[0];
    let nearestDist = Math.abs(mouseX - nearest.x);
    let nearestIdx = 0;
    for (let i = 1; i < longerSeries.length; i++) {
      const dist = Math.abs(mouseX - longerSeries[i].x);
      if (dist < nearestDist) {
        nearest = longerSeries[i];
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    // Get values from both series at this index ratio
    const ratio = nearestIdx / (longerSeries.length - 1);
    const tplIdx = Math.min(Math.round(ratio * (tplNorm.length - 1)), tplNorm.length - 1);
    const matchIdx = Math.min(Math.round(ratio * (matchNorm.length - 1)), matchNorm.length - 1);

    setHover({
      x: nearest.x,
      tplDate: tplNorm[tplIdx]?.date,
      tplVal: tplNorm[tplIdx]?.value,
      tplPrice: templateData?.[tplIdx]?.price,
      matchDate: matchNorm[matchIdx]?.date,
      matchVal: matchNorm[matchIdx]?.value,
      matchPrice: matchData?.[matchIdx]?.price,
    });
  }, [tplPoints, matchPoints, tplNorm, matchNorm, templateData, matchData]);

  // Final returns
  const tplReturn = tplNorm.length > 1 ? tplNorm[tplNorm.length - 1].value - 100 : null;
  const matchReturn = matchNorm.length > 1 ? matchNorm[matchNorm.length - 1].value - 100 : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Price overlay (normalized to 100)</span>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-accent inline-block rounded" />
            <span className="text-slate-400">{templateTicker || templateLabel}</span>
            {tplReturn != null && (
              <span className={tplReturn >= 0 ? 'text-green-400' : 'text-red-400'}>
                {tplReturn >= 0 ? '+' : ''}{tplReturn.toFixed(1)}%
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-purple-400 inline-block rounded" />
            <span className="text-slate-400">{matchTicker || matchLabel}</span>
            {matchReturn != null && (
              <span className={matchReturn >= 0 ? 'text-green-400' : 'text-red-400'}>
                {matchReturn >= 0 ? '+' : ''}{matchReturn.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: '200px' }}
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Grid lines */}
          {yLines.map((line, i) => (
            <g key={i}>
              <line x1={PAD_L} y1={line.y} x2={W - PAD_R} y2={line.y} stroke="#334155" strokeWidth="0.5" />
              <text x={PAD_L - 4} y={line.y + 3} textAnchor="end" fill="#64748b" fontSize="9">{line.label}</text>
            </g>
          ))}

          {/* 100 baseline */}
          {baseY >= PAD_T && baseY <= PAD_T + plotH && (
            <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="4,3" />
          )}

          {/* Template line */}
          {tplPoints.length > 1 && (
            <polyline
              points={tplPolyline}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Match line */}
          {matchPoints.length > 1 && (
            <polyline
              points={matchPolyline}
              fill="none"
              stroke="#c084fc"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Hover crosshair */}
          {hover && (
            <>
              <line x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + plotH} stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3,2" />
              {hover.tplVal != null && (() => {
                const cy = PAD_T + plotH - ((hover.tplVal - minVal) / range) * plotH;
                return <circle cx={hover.x} cy={cy} r="3" fill="#60a5fa" />;
              })()}
              {hover.matchVal != null && (() => {
                const cy = PAD_T + plotH - ((hover.matchVal - minVal) / range) * plotH;
                return <circle cx={hover.x} cy={cy} r="3" fill="#c084fc" />;
              })()}
            </>
          )}
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <div
            className="absolute top-0 pointer-events-none bg-dark-card/95 border border-dark-border rounded-lg px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min((hover.x / W) * 100, 75)}%` }}
          >
            {hover.tplDate && (
              <div className="flex items-center gap-2 mb-0.5">
                <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                <span className="text-slate-400">{hover.tplDate}</span>
                <span className="text-slate-200 font-semibold">
                  ${hover.tplPrice?.toFixed(2)}
                </span>
                <span className={hover.tplVal >= 100 ? 'text-green-400' : 'text-red-400'}>
                  {hover.tplVal >= 100 ? '+' : ''}{(hover.tplVal - 100).toFixed(1)}%
                </span>
              </div>
            )}
            {hover.matchDate && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
                <span className="text-slate-400">{hover.matchDate}</span>
                <span className="text-slate-200 font-semibold">
                  ${hover.matchPrice?.toFixed(2)}
                </span>
                <span className={hover.matchVal >= 100 ? 'text-green-400' : 'text-red-400'}>
                  {hover.matchVal >= 100 ? '+' : ''}{(hover.matchVal - 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
