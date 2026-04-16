/**
 * Algorithm registry — the pluggable engine layer.
 *
 * Each entry is an engine that ranks the stock universe. Engines share a
 * common interface so the /api/matches route can dispatch to any of them
 * based on the ?algo= query param.
 *
 * Engine contract:
 *   key            (string)  unique identifier, used in ?algo=<key>
 *   name           (string)  human-readable name
 *   description    (string)  short methodology summary
 *   requiresTemplate (bool)  if true, rank() throws without a template snapshot
 *   rank(args)     (fn)      ({ template?, universe, topN, options }) → Match[]
 *
 * Today: only templateMatch is registered. Phase 2+ adds momentumBreakout,
 * catalystDriven, ensembleConsensus. See
 * docs/superpowers/plans/2026-04-16-multi-algorithm-ensemble.md.
 */

const templateMatch = require('./templateMatch');
const momentumBreakout = require('./momentumBreakout');
const ensembleConsensus = require('./ensembleConsensus');
const { isInvestable } = require('./shared');

const ENGINES = {
  [templateMatch.key]: templateMatch,
  [momentumBreakout.key]: momentumBreakout,
  [ensembleConsensus.key]: ensembleConsensus,
};

const DEFAULT_ENGINE = templateMatch.key;

function getEngine(key) {
  return ENGINES[key] || null;
}

function listEngines() {
  return Object.values(ENGINES).map(({ key, name, description, requiresTemplate }) => ({
    key,
    name,
    description,
    requiresTemplate,
  }));
}

function isValidEngineKey(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(ENGINES, key);
}

module.exports = {
  ENGINES,
  DEFAULT_ENGINE,
  getEngine,
  listEngines,
  isValidEngineKey,
  isInvestable,
};
