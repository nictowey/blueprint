/**
 * Color-code match metrics by SIMILARITY to the template value.
 *
 * This is a pattern-matching tool — we care about "how close is this metric?"
 * not "is the match stock better or worse?" Colors align with the similarity
 * bar so users get one consistent signal per metric.
 *
 * Green  = very similar to template (≥75% similarity)
 * Yellow = moderately similar (40-75%)
 * Red    = significantly different (<40%)
 *
 * When a per-metric similarity score is available (from the API), use it directly.
 * Otherwise fall back to a generic percentage-difference heuristic.
 */

/**
 * Primary: use the per-metric similarity score from the matcher engine.
 * @param {number|null} similarity - 0-1 similarity score from metricScores array
 * @returns {string} Tailwind color class
 */
export function getMetricColorFromScore(similarity) {
  if (similarity == null) return 'text-slate-600';
  const pct = similarity * 100;
  if (pct >= 75) return 'text-green-400';
  if (pct >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

/**
 * Fallback: estimate similarity from raw values when no scorer is available.
 * Uses relative difference for a rough approximation.
 */
export function getMetricColor(key, templateVal, matchVal) {
  if (templateVal == null || matchVal == null) return 'text-slate-600';
  if (templateVal === 0 && matchVal === 0) return 'text-green-400';

  const denom = Math.max(Math.abs(templateVal), Math.abs(matchVal), 0.01);
  const pctDiff = Math.abs(matchVal - templateVal) / denom * 100;

  if (pctDiff <= 15) return 'text-green-400';
  if (pctDiff <= 50) return 'text-yellow-400';
  return 'text-red-400';
}
