const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { snapshotCache, SNAPSHOT_CACHE_TTL } = require('./snapshot');
const { MATCH_METRICS } = require('../services/matcher');

/**
 * POST /api/blend
 * Body: { templates: [{ ticker: 'CLS', date: '2023-12-01' }, { ticker: 'NVDA', date: '2023-01-03' }, ...] }
 *
 * Creates a composite snapshot by blending 2-5 template snapshots.
 * Uses median for each metric (robust to outliers), with metadata about
 * which templates contributed to each metric.
 */
router.post('/', async (req, res) => {
  const { templates } = req.body;

  if (!Array.isArray(templates) || templates.length < 2 || templates.length > 5) {
    return res.status(400).json({ error: 'Provide 2-5 templates as [{ ticker, date }, ...]' });
  }

  // Validate each template
  for (const t of templates) {
    if (!t.ticker || !t.date) {
      return res.status(400).json({ error: 'Each template requires ticker and date' });
    }
    if (!/^[A-Z0-9.]{1,10}$/i.test(t.ticker)) {
      return res.status(400).json({ error: `Invalid ticker: ${t.ticker}` });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
      return res.status(400).json({ error: `Invalid date: ${t.date}` });
    }
  }

  try {
    // Fetch all snapshots (reuse cache when available)
    const snapshots = await Promise.all(
      templates.map(async ({ ticker, date }) => {
        const sym = ticker.toUpperCase();
        const cacheKey = `${sym}:${date}`;
        const cached = snapshotCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < SNAPSHOT_CACHE_TTL) {
          return cached.data;
        }

        // Fetch fresh snapshot via internal call
        const snapshotRes = await fetch(
          `http://localhost:${process.env.PORT || 3001}/api/snapshot?ticker=${sym}&date=${date}`
        );
        if (!snapshotRes.ok) {
          throw new Error(`Failed to fetch snapshot for ${sym} (${date})`);
        }
        return snapshotRes.json();
      })
    );

    // Blend: for each metric, collect all non-null values and take the median
    const composite = {
      ticker: templates.map(t => t.ticker.toUpperCase()).join('+'),
      companyName: `Blend: ${snapshots.map(s => s.companyName || s.ticker).join(' + ')}`,
      sector: mostCommon(snapshots.map(s => s.sector).filter(Boolean)) || null,
      date: templates.map(t => t.date).join(','),
      isBlend: true,
      templateCount: templates.length,
      templates: templates.map((t, i) => ({
        ticker: t.ticker.toUpperCase(),
        date: t.date,
        companyName: snapshots[i]?.companyName || t.ticker,
        sector: snapshots[i]?.sector || null,
      })),
    };

    // Compute median for each match metric
    const metricCoverage = {};
    for (const metric of MATCH_METRICS) {
      const values = snapshots
        .map(s => s[metric])
        .filter(v => v != null && isFinite(v));

      if (values.length === 0) {
        composite[metric] = null;
        metricCoverage[metric] = 0;
      } else {
        composite[metric] = median(values);
        metricCoverage[metric] = values.length;
      }
    }

    // Blend recent closes for momentum (average normalized to base 100)
    const closesArrays = snapshots
      .map(s => s.recentCloses)
      .filter(c => Array.isArray(c) && c.length >= 20);

    if (closesArrays.length > 0) {
      // Normalize each to base 100, then average
      const minLen = Math.min(...closesArrays.map(c => c.length));
      const normalized = closesArrays.map(closes => {
        const base = closes[closes.length - minLen] || closes[0];
        return closes.slice(-minLen).map(v => (v / base) * 100);
      });

      composite.recentCloses = [];
      for (let i = 0; i < minLen; i++) {
        const avg = normalized.reduce((s, arr) => s + arr[i], 0) / normalized.length;
        composite.recentCloses.push(avg);
      }
    }

    // Also blend price (for display) and other non-metric fields
    composite.price = median(snapshots.map(s => s.price).filter(v => v != null));
    composite.ttmRevenue = median(snapshots.map(s => s.ttmRevenue).filter(v => v != null));
    composite.metricCoverage = metricCoverage;

    res.json(composite);
  } catch (err) {
    console.error('[blend] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to blend templates' });
  }
});

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mostCommon(arr) {
  if (arr.length === 0) return null;
  const counts = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

module.exports = router;
