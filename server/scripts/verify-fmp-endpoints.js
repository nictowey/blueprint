#!/usr/bin/env node

/**
 * FMP Endpoint Verification Script — Phase 0 of multi-algorithm ensemble.
 *
 * Probes each FMP endpoint that the planned catalyst-driven engine would
 * depend on, and reports availability + shape under the current plan tier.
 *
 * Usage:
 *   node server/scripts/verify-fmp-endpoints.js [--ticker AAPL]
 *
 * Requires: FMP_API_KEY in .env (or env).
 *
 * Output: per-endpoint ✓/✗ + first row preview, then a summary of which
 * catalyst signals are buildable vs. blocked.
 *
 * To add a new endpoint to probe, append to ENDPOINTS_TO_PROBE below.
 *
 * See docs/superpowers/plans/2026-04-16-multi-algorithm-ensemble.md (Phase 0).
 */

require('dotenv').config();

const fetch = require('node-fetch');

const BASE = 'https://financialmodelingprep.com/stable';
const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Endpoints to probe — easy to extend
// ---------------------------------------------------------------------------
//
// Each entry:
//   path             — URL path under BASE (no query string; apikey added automatically)
//   params           — extra query params (symbol/limit/etc.)
//   purpose          — one-line description of what catalyst signal this would feed
//   requiredFor      — which engine signal needs this
//   shapeCheck       — (data) => { ok: boolean, note: string } — verifies response shape
//
// Multiple paths per signal are listed when FMP has alternates; we report all
// and the catalyst engine will pick the best one available.

function nonEmptyArray(data) {
  return Array.isArray(data) && data.length > 0
    ? { ok: true, note: `array with ${data.length} rows; first row keys: ${Object.keys(data[0]).slice(0, 8).join(', ')}` }
    : { ok: false, note: `expected non-empty array, got: ${typeof data === 'object' ? JSON.stringify(data).slice(0, 120) : typeof data}` };
}

function buildEndpoints(ticker) {
  return [
    // --- Earnings surprises (catalyst signal #1) ---
    {
      path: '/earnings-surprises',
      params: { symbol: ticker },
      purpose: 'Recent earnings surprise magnitude (actual vs. estimate)',
      requiredFor: 'catalystDriven: earnings-surprise score',
      shapeCheck: nonEmptyArray,
    },
    {
      path: '/earnings',
      params: { symbol: ticker, limit: 10 },
      purpose: 'Alternate earnings calendar endpoint',
      requiredFor: 'catalystDriven: earnings-surprise score (fallback)',
      shapeCheck: nonEmptyArray,
    },

    // --- Analyst estimates / revisions (catalyst signal #2) ---
    {
      path: '/analyst-estimates',
      params: { symbol: ticker, period: 'annual', limit: 10 },
      purpose: 'Forward EPS/revenue estimates (revision-breadth requires multiple snapshots over time)',
      requiredFor: 'catalystDriven: estimate-revision score',
      shapeCheck: nonEmptyArray,
    },
    {
      path: '/grades-consensus',
      params: { symbol: ticker },
      purpose: 'Aggregated analyst grade / consensus (buy/hold/sell counts)',
      requiredFor: 'catalystDriven: estimate-revision score (fallback)',
      shapeCheck: (data) => {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          return { ok: true, note: `object with keys: ${Object.keys(data).slice(0, 8).join(', ')}` };
        }
        return nonEmptyArray(data);
      },
    },
    {
      path: '/grades-historical',
      params: { symbol: ticker, limit: 30 },
      purpose: 'Historical analyst upgrade/downgrade events — best for revision-breadth scoring',
      requiredFor: 'catalystDriven: estimate-revision score (preferred)',
      shapeCheck: nonEmptyArray,
    },

    // --- Insider trading (catalyst signal #3) ---
    {
      path: '/insider-trading/latest',
      params: { symbol: ticker, limit: 30 },
      purpose: 'Recent Form 4 insider transactions',
      requiredFor: 'catalystDriven: insider-buying-cluster score',
      shapeCheck: nonEmptyArray,
    },
    {
      path: '/insider-trading-statistics',
      params: { symbol: ticker },
      purpose: 'Aggregated insider buying vs. selling stats',
      requiredFor: 'catalystDriven: insider-buying-cluster score (alt)',
      shapeCheck: nonEmptyArray,
    },
  ];
}

// ---------------------------------------------------------------------------
// Probe runner
// ---------------------------------------------------------------------------

async function probe(endpoint, apiKey) {
  const url = new URL(`${BASE}${endpoint.path}`);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(endpoint.params)) {
    url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    const statusInfo = `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: statusInfo, note: 'authentication / plan-tier denied — needs upgrade or different endpoint' };
    }
    if (res.status === 404) {
      return { ok: false, status: statusInfo, note: 'endpoint path does not exist on this plan' };
    }
    if (!res.ok) {
      return { ok: false, status: statusInfo, note: 'unexpected HTTP error' };
    }

    const data = await res.json();
    if (data && data['Error Message']) {
      return { ok: false, status: statusInfo, note: `FMP error: ${data['Error Message']}` };
    }

    const shape = endpoint.shapeCheck(data);
    return { ok: shape.ok, status: statusInfo, note: shape.note };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 'network error', note: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function getArg(args, flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

(async () => {
  const args = process.argv.slice(2);
  const ticker = getArg(args, '--ticker', 'AAPL').toUpperCase();

  if (!process.env.FMP_API_KEY) {
    console.error('FMP_API_KEY not set. Add it to .env (see .env.example).');
    process.exit(1);
  }

  const apiKey = process.env.FMP_API_KEY;
  const endpoints = buildEndpoints(ticker);

  console.log(`\nProbing ${endpoints.length} FMP endpoints with ticker=${ticker}\n`);

  const results = [];
  for (const ep of endpoints) {
    process.stdout.write(`  ${ep.path.padEnd(36)} `);
    const result = await probe(ep, apiKey);
    results.push({ endpoint: ep, result });
    const mark = result.ok ? '✓' : '✗';
    console.log(`${mark} ${result.status.padEnd(20)} ${result.note}`);
    // gentle pacing — well under FMP's 300/min limit
    await new Promise(r => setTimeout(r, 250));
  }

  // ---- Summary by signal -------------------------------------------------
  console.log('\n--- Summary by catalyst signal ---\n');

  const signalGroups = {};
  for (const { endpoint, result } of results) {
    const signal = endpoint.requiredFor;
    if (!signalGroups[signal]) signalGroups[signal] = [];
    signalGroups[signal].push({ path: endpoint.path, ok: result.ok, note: result.note });
  }

  for (const [signal, paths] of Object.entries(signalGroups)) {
    const anyAvailable = paths.some(p => p.ok);
    const mark = anyAvailable ? '✓' : '✗';
    console.log(`${mark} ${signal}`);
    for (const p of paths) {
      console.log(`     ${p.ok ? '✓' : '✗'} ${p.path}`);
    }
  }

  // ---- Verdict -----------------------------------------------------------
  const allOk = results.every(r => r.result.ok);
  const noneOk = results.every(r => !r.result.ok);

  console.log('\n--- Verdict ---\n');
  if (allOk) {
    console.log('All catalyst endpoints available. Phase 3 (catalystDriven engine) is unblocked.');
  } else if (noneOk) {
    console.log('No catalyst endpoints available on current plan. Phase 3 is blocked — consider plan upgrade or substituting an alternative engine.');
  } else {
    const blockedSignals = Object.entries(signalGroups)
      .filter(([, paths]) => !paths.some(p => p.ok))
      .map(([s]) => s);
    if (blockedSignals.length === 0) {
      console.log('At least one path available for every catalyst signal. Phase 3 buildable with the available endpoints (see ✓ rows above).');
    } else {
      console.log('Some catalyst signals have NO available path — these are blockers:');
      for (const s of blockedSignals) console.log(`  - ${s}`);
      console.log('\nDecide: upgrade plan, find third-party data source, or scope catalyst engine down to the signals that ARE available.');
    }
  }

  console.log('\nUpdate Phase 0 checkboxes in docs/superpowers/plans/2026-04-16-multi-algorithm-ensemble.md based on the results above.\n');
})().catch(err => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
