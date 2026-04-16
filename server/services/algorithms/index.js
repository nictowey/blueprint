/**
 * Algorithm registry — the pluggable engine layer.
 *
 * Each engine ranks the stock universe. Engines share a common interface so
 * the /api/matches route can dispatch to any of them based on the ?algo=
 * query param.
 *
 * Engine contract:
 *   key            (string)  unique identifier, used in ?algo=<key>
 *   name           (string)  human-readable name
 *   description    (string)  short methodology summary
 *   requiresTemplate (bool)  if true, rank() throws without a template snapshot
 *   rank(args)     (fn)      ({ template?, universe, topN, options }) → Match[]
 *
 * This file is a thin composition layer:
 *   - `./registry` owns the ENGINES map and helper functions
 *   - This file imports each engine and calls register() to add them
 *   - Consumers outside the algorithms/ directory import from here
 *   - ensembleConsensus.js imports `./registry` directly to read ENGINES at
 *     rank-time without a circular dependency on this file
 *
 * See docs/superpowers/plans/2026-04-16-multi-algorithm-ensemble.md.
 */

const registry = require('./registry');
const templateMatch = require('./templateMatch');
const momentumBreakout = require('./momentumBreakout');
const catalystDriven = require('./catalystDriven');
const ensembleConsensus = require('./ensembleConsensus');
const { isInvestable } = require('./shared');

registry.register(templateMatch);
registry.register(momentumBreakout);
registry.register(catalystDriven);
registry.register(ensembleConsensus);

const DEFAULT_ENGINE = templateMatch.key;

module.exports = {
  ENGINES: registry.ENGINES,
  DEFAULT_ENGINE,
  getEngine: registry.getEngine,
  listEngines: registry.listEngines,
  isValidEngineKey: registry.isValidEngineKey,
  isInvestable,
};
