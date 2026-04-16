/**
 * Algorithm registry — owns the ENGINES map and lookup helpers.
 *
 * This module intentionally imports NO engine modules. Engines self-register
 * by calling `register(engine)` at the bottom of their own file. The engine
 * registry's `index.js` pulls in every engine (triggering registration) and
 * re-exports this module's public API.
 *
 * Why split this out: `ensembleConsensus` needs to read the registry at
 * rank-time to know which component engines exist. If it imported
 * `./index` it would create a circular require (since index.js imports
 * ensembleConsensus). By keeping the map in this leaf module, ensemble can
 * `require('./registry')` at the top like a normal import.
 */

const ENGINES = {};

/**
 * Register an engine on the registry. Called by each engine file at the
 * bottom of its module. Throws on duplicate registration — deterministic
 * behavior beats silent clobbering.
 */
function register(engine) {
  if (!engine || typeof engine.key !== 'string') {
    throw new Error('register(): engine must have a string `key`');
  }
  if (Object.prototype.hasOwnProperty.call(ENGINES, engine.key)) {
    throw new Error(`register(): duplicate engine key "${engine.key}"`);
  }
  ENGINES[engine.key] = engine;
  return engine;
}

/**
 * Test-only: remove an engine from the registry. Lets integration tests
 * register fake engines in beforeEach and clean up in afterEach without
 * leaking state across tests.
 */
function unregister(key) {
  delete ENGINES[key];
}

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
  register,
  unregister,
  getEngine,
  listEngines,
  isValidEngineKey,
};
