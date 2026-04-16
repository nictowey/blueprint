const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const REDIS_KEY = 'proof_results';
const MEMORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const LOCAL_CACHE_PATH = path.join(__dirname, '../.cache/proof-results.json');

let memoryCache = null;
let memoryCacheTs = 0;

async function loadFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(`${url}/get/${REDIS_KEY}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.result) return null;
    return JSON.parse(json.result);
  } catch (err) {
    console.warn('[proof] Failed to load from Redis:', err.message);
    return null;
  }
}

function loadFromFile() {
  try {
    if (!fs.existsSync(LOCAL_CACHE_PATH)) return null;
    const raw = fs.readFileSync(LOCAL_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[proof] Failed to load from file:', err.message);
    return null;
  }
}

/**
 * Migrate v1 proof data (single-engine, templateMatch only) into v2 shape.
 *
 * v1 shape (per case):
 *   { templateTicker, templateDate, ..., matches: [...], benchmark: {...}, status }
 *
 * v2 shape (per case):
 *   { templateTicker, templateDate, ..., engines: { templateMatch: {...} }, random: null, benchmark }
 *
 * The migration is lossless w.r.t. what the UI displays — every v1 match
 * carries over into engines.templateMatch.matches — and non-destructive on
 * disk (we don't write back; the next run-proof.js run produces v2 directly).
 *
 * If the input is already v2 it's returned unchanged.
 *
 * Exported for unit tests.
 */
function migrateToV2(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.version === 2) return data;

  // Anything with no `version` or `version: 1` is treated as v1.
  const cases = Array.isArray(data.cases) ? data.cases.map(c => {
    // Preserve everything that was on the old case-block, but reshape matches.
    const { matches, status, snapshotsBuilt, ...rest } = c;
    return {
      ...rest,
      engines: {
        templateMatch: {
          status: status || 'completed',
          snapshotsBuilt: snapshotsBuilt ?? null,
          matches: Array.isArray(matches) ? matches : [],
        },
      },
      random: null,
    };
  }) : [];

  // Aggregate migration: v1 had `{ periods, correlation, totalMatches, totalCases }`
  // flat; v2 nests those under `engines.templateMatch`.
  let aggregate = null;
  if (data.aggregate) {
    const legacy = data.aggregate;
    // Augment legacy period stats with the new Phase-5a metrics so the UI
    // contract `{ avgReturn, medianReturn, hitRateVsBenchmark, maxDrawdownPct,
    // winRate, alpha, caseCount }` is stable even before a real regeneration.
    const augmentedPeriods = {};
    for (const [period, s] of Object.entries(legacy.periods || {})) {
      if (!s) { augmentedPeriods[period] = null; continue; }
      augmentedPeriods[period] = {
        avgReturn: s.avgReturn ?? null,
        medianReturn: s.medianReturn ?? null,
        benchmarkReturn: s.benchmarkReturn ?? null,
        alpha: s.alpha ?? null,
        winRate: s.winRate ?? null,
        hitRateVsBenchmark: null,
        maxDrawdownPct: null,
        caseCount: s.caseCount ?? null,
      };
    }
    aggregate = {
      engines: {
        templateMatch: {
          periods: augmentedPeriods,
          correlation: legacy.correlation || null,
          totalMatches: legacy.totalMatches ?? 0,
          totalCases: legacy.totalCases ?? 0,
        },
      },
      totalMatches: legacy.totalMatches ?? 0,
      totalCases: legacy.totalCases ?? 0,
    };
  }

  return {
    version: 2,
    generatedAt: data.generatedAt,
    profile: data.profile,
    engines: ['templateMatch'],
    cases,
    aggregate,
    disclaimers: data.disclaimers || [],
    _migratedFromV1: true,
  };
}

router.get('/', async (_req, res) => {
  // Check memory cache first
  if (memoryCache && Date.now() - memoryCacheTs < MEMORY_CACHE_TTL) {
    return res.json(memoryCache);
  }

  // Try Redis
  let data = await loadFromRedis();

  // Fallback to local file
  if (!data) {
    data = loadFromFile();
  }

  if (!data) {
    return res.status(404).json({
      error: 'Proof data not yet generated. Run server/scripts/run-proof.js to generate.',
    });
  }

  const v2 = migrateToV2(data);

  // Cache in memory
  memoryCache = v2;
  memoryCacheTs = Date.now();

  res.json(v2);
});

module.exports = router;
module.exports.migrateToV2 = migrateToV2;
