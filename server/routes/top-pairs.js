const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS } = require('../services/matcher');
const fetch = require('node-fetch');

// ---------------------------------------------------------------------------
// Curated breakout templates — verified multi-hundred-percent breakouts.
// Each entry captures the ticker + a pre-breakout date when the stock's
// fundamental/technical profile was set up for the move.
// ---------------------------------------------------------------------------
const BREAKOUT_TEMPLATES = [
  {
    ticker: 'CLS',
    date: '2023-12-01',
    label: 'Celestica',
    description: 'AI infrastructure / EMS breakout',
  },
  {
    ticker: 'NVDA',
    date: '2023-01-15',
    label: 'NVIDIA',
    description: 'AI compute supercycle',
  },
  {
    ticker: 'SMCI',
    date: '2023-06-01',
    label: 'Super Micro',
    description: 'AI server infrastructure',
  },
  {
    ticker: 'META',
    date: '2022-11-01',
    label: 'Meta Platforms',
    description: 'Efficiency pivot turnaround',
  },
  {
    ticker: 'APP',
    date: '2024-03-01',
    label: 'AppLovin',
    description: 'AI-powered ad-tech breakout',
  },
  {
    ticker: 'VST',
    date: '2024-01-15',
    label: 'Vistra Energy',
    description: 'AI data center energy play',
  },
  {
    ticker: 'PLTR',
    date: '2023-05-01',
    label: 'Palantir',
    description: 'AI + government contract breakout',
  },
];

// ---------------------------------------------------------------------------
// Template snapshot cache — fetch each template's historical snapshot once,
// keep for 7 days. These are static historical profiles that rarely change
// (only if FMP backfills data).
// ---------------------------------------------------------------------------
const templateSnapshotCache = new Map();
const TEMPLATE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Fetch a historical snapshot for a template by hitting our own snapshot
 * endpoint logic internally. We import the snapshot route's computation
 * rather than making an HTTP call to ourselves.
 */
async function fetchTemplateSnapshot(ticker, date) {
  const cacheKey = `${ticker}:${date}`;
  const cached = templateSnapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TEMPLATE_CACHE_TTL) {
    return cached.data;
  }

  // Use the internal snapshot route by making a local request
  // We build the URL relative to the server's own address
  const port = process.env.PORT || 10000;
  const url = `http://127.0.0.1:${port}/api/snapshot?ticker=${ticker}&date=${date}`;

  try {
    const res = await fetch(url, { timeout: 30000 });
    if (!res.ok) {
      console.error(`[top-pairs] Failed to fetch snapshot for ${ticker}@${date}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    templateSnapshotCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  } catch (err) {
    console.error(`[top-pairs] Error fetching snapshot for ${ticker}@${date}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Top candidates computation
// ---------------------------------------------------------------------------
let cachedResult = null;
let lastComputed = 0;
let computing = false;
const CACHE_TTL = 30 * 60 * 1000; // recompute every 30 min
const BATCH_SIZE = 5;

/**
 * For each curated breakout template, find current stocks that most closely
 * match its pre-breakout profile. Return the top candidates across all
 * templates, deduplicated by candidate ticker.
 */
async function computeBreakoutCandidates(limit = 20) {
  const cache = getCache();
  if (cache.size < 10) return [];

  // Step 1: Fetch all template snapshots in parallel
  console.log(`[top-pairs] Fetching ${BREAKOUT_TEMPLATES.length} template snapshots...`);
  const snapshotResults = await Promise.all(
    BREAKOUT_TEMPLATES.map(t => fetchTemplateSnapshot(t.ticker, t.date))
  );

  // Build array of valid template snapshots with their metadata
  const templates = [];
  for (let i = 0; i < BREAKOUT_TEMPLATES.length; i++) {
    const snapshot = snapshotResults[i];
    if (!snapshot) {
      console.warn(`[top-pairs] Skipping template ${BREAKOUT_TEMPLATES[i].ticker} — no snapshot data`);
      continue;
    }
    templates.push({
      ...BREAKOUT_TEMPLATES[i],
      snapshot,
    });
  }

  if (templates.length === 0) {
    console.error('[top-pairs] No valid template snapshots — cannot compute candidates');
    return [];
  }

  console.log(`[top-pairs] Running ${templates.length} templates against ${cache.size} stocks...`);

  // Step 2: For each template, find the best matches in the current universe
  const allCandidates = [];

  for (const template of templates) {
    // findMatches expects a snapshot object and the universe cache map
    const matches = findMatches(template.snapshot, cache, 10);

    for (const match of matches) {
      allCandidates.push({
        candidate: {
          ticker: match.ticker,
          companyName: match.companyName,
          sector: match.sector,
          price: match.price,
          marketCap: match.marketCap,
        },
        template: {
          ticker: template.ticker,
          label: template.label,
          date: template.date,
          description: template.description,
        },
        matchScore: match.matchScore,
        metricsCompared: match.metricsCompared,
        topMatches: match.topMatches,
        topDifferences: match.topDifferences,
      });
    }
  }

  // Step 3: Deduplicate by candidate ticker — keep the highest-scoring entry
  const bestByCandidate = new Map();
  for (const entry of allCandidates) {
    const key = entry.candidate.ticker;
    const existing = bestByCandidate.get(key);
    if (!existing || entry.matchScore > existing.matchScore) {
      // Also collect all templates this candidate matched
      const allTemplates = existing?.allTemplates || [];
      allTemplates.push({
        ticker: entry.template.ticker,
        label: entry.template.label,
        score: entry.matchScore,
      });
      bestByCandidate.set(key, { ...entry, allTemplates });
    } else {
      // Still track that this candidate matched another template
      existing.allTemplates = existing.allTemplates || [];
      existing.allTemplates.push({
        ticker: entry.template.ticker,
        label: entry.template.label,
        score: entry.matchScore,
      });
    }
  }

  // Step 4: Sort by best match score, return top N
  const results = Array.from(bestByCandidate.values())
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit)
    .map(entry => ({
      candidate: entry.candidate,
      template: entry.template,  // best-matching template
      matchScore: entry.matchScore,
      metricsCompared: entry.metricsCompared,
      topMatches: entry.topMatches,
      topDifferences: entry.topDifferences,
      templateMatchCount: entry.allTemplates?.length || 1,  // how many templates matched
    }));

  return results;
}

// Background pre-computation
async function triggerBackgroundCompute() {
  if (computing) return;
  computing = true;
  try {
    console.log('[top-pairs] Starting breakout candidate computation...');
    const start = Date.now();
    cachedResult = await computeBreakoutCandidates(20);
    lastComputed = Date.now();
    console.log(`[top-pairs] Computed ${cachedResult.length} breakout candidates in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('[top-pairs] Background computation failed:', err.message);
  } finally {
    computing = false;
  }
}

// Poll for universe readiness and trigger pre-computation
let bootPollRef = setInterval(() => {
  if (isReady() && !cachedResult && !computing) {
    clearInterval(bootPollRef);
    // Wait a short delay after universe is ready to avoid competing with initial cache build
    setTimeout(triggerBackgroundCompute, 5000);
  }
}, 5000);

router.get('/', (req, res) => {
  if (!isReady()) {
    return res.status(503).json({ error: 'Universe cache not ready' });
  }

  if (cachedResult) {
    const now = Date.now();
    if (now - lastComputed > CACHE_TTL && !computing) {
      triggerBackgroundCompute();
    }
    return res.json(cachedResult);
  }

  if (!computing) {
    triggerBackgroundCompute();
  }
  return res.status(202).json({ computing: true, message: 'Scanning for breakout candidates, check back shortly.' });
});

module.exports = router;
