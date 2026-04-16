/**
 * Template-match engine adapter.
 *
 * Thin wrapper around the original `server/services/matcher.js` engine that
 * conforms to the shared algorithm interface defined in `./index.js`. The
 * underlying matcher.js remains the source of truth for similarity scoring —
 * this file exists so the engine registry can treat template-match as one
 * engine among several, not as a hardcoded default.
 *
 * Contract:
 *   rank({ template, universe, topN, options }) → Array<Match>
 *
 * Template-match REQUIRES a template (pre-breakout snapshot of a winner).
 * The caller is responsible for applying profile hard filters to the universe
 * before calling rank() — this engine only scores similarity; it does not
 * know about profiles.
 */

const { findMatches } = require('../matcher');

function rank({ template, universe, topN = 10, options = {} }) {
  if (!template) {
    throw new Error('templateMatch requires a template snapshot');
  }
  const profileOptions = {
    weights: options.weights,
  };
  return findMatches(template, universe, topN, profileOptions);
}

module.exports = {
  key: 'templateMatch',
  name: 'Template Match',
  description: 'Similarity-score the universe against a historical breakout stock\'s pre-breakout snapshot. Five weight profiles (growth_breakout, value_inflection, momentum_technical, quality_compounder, garp) tune what similarity means.',
  requiresTemplate: true,
  rank,
};
