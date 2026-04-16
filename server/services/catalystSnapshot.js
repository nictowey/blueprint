/**
 * Catalyst Signal Cache — Phase 3a.
 *
 * In-memory cache of catalyst signals derived from FMP's earnings, analyst-grades,
 * and insider-trading endpoints. Each cached entry stores the raw source arrays
 * alongside three derived signals in the range [-1, +1]:
 *
 *   - earningsSurprise     EPS beat/miss over the last 1–2 reports
 *   - estimateRevisions    analyst bullishness delta over ~90d
 *   - insiderBuying        recent insider purchases (positive-only; sells ignored)
 *
 * Signals are `null` when source data is insufficient; downstream engines decide
 * how to treat a null (Phase 3b). This module does no ranking.
 *
 * Persistence: memory only. TTL is 24h. No Redis / file fallback in Phase 3a.
 *
 * Rate limit: cache population is strictly sequential per the FMP 220ms/call
 * convention. Never parallelize fetches from the same cache build.
 */

const fmp = require('./fmp');

const CATALYST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EARNINGS_LIMIT = 8;
const GRADES_LIMIT = 100;
const INSIDER_LIMIT = 100;

const INSIDER_WINDOW_DAYS = 90;
const REVISION_WINDOW_DAYS = 90;
const REVISION_MIN_GAP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const state = {
  cache: new Map(),
  lastBuild: null,
};

// ---------------------------------------------------------------------------
// Piecewise-linear interpolator (same shape as momentumBreakout._test.piecewise)
// ---------------------------------------------------------------------------

function piecewise(v, points) {
  if (v == null || !isFinite(v)) return null;
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (v <= x1) {
      const t = (v - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

// ---------------------------------------------------------------------------
// Signal: earningsSurprise
// ---------------------------------------------------------------------------

const EARNINGS_SURPRISE_POINTS = [
  [-0.50, -1.0],
  [-0.10, -0.5],
  [0, 0],
  [0.10, 0.5],
  [0.50, 1.0],
];

/**
 * Average % EPS surprise over the most-recent 1–2 reports where both actual
 * and estimate are present, mapped piecewise into [-1, +1].
 * Returns `null` if no qualifying rows.
 */
function scoreEarningsSurprise(earnings) {
  if (!Array.isArray(earnings) || earnings.length === 0) return null;

  // Sort newest-first defensively (FMP usually returns this order, but not guaranteed)
  const sorted = [...earnings]
    .filter(r => r && r.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const usable = sorted.filter(r => r.epsActual != null && r.epsEstimated != null);
  if (usable.length === 0) return null;

  const recent = usable.slice(0, 2);
  const surprises = recent.map(r => {
    const denom = Math.max(Math.abs(r.epsEstimated), 0.01);
    return (r.epsActual - r.epsEstimated) / denom;
  });

  const avg = surprises.reduce((s, v) => s + v, 0) / surprises.length;
  return piecewise(avg, EARNINGS_SURPRISE_POINTS);
}

// ---------------------------------------------------------------------------
// Signal: estimateRevisions
// ---------------------------------------------------------------------------

const REVISION_POINTS = [
  [-0.40, -1.0],
  [-0.10, -0.5],
  [0, 0],
  [0.10, 0.5],
  [0.40, 1.0],
];

function gradeRowBullishness(row) {
  const sb = row.analystRatingsStrongBuy ?? 0;
  const b = row.analystRatingsBuy ?? 0;
  const h = row.analystRatingsHold ?? 0;
  const s = row.analystRatingsSell ?? 0;
  const ss = row.analystRatingsStrongSell ?? 0;
  const total = sb + b + h + s + ss;
  if (total <= 0) return null;
  return (sb * 2 + b * 1 - s * 1 - ss * 2) / total;
}

/**
 * Bullishness delta between the most-recent grades row and the row closest to
 * ~90 days older. Requires at least 30 days between the two rows to be
 * meaningful; otherwise returns `null`.
 */
function scoreEstimateRevisions(grades) {
  if (!Array.isArray(grades) || grades.length < 2) return null;

  const sorted = [...grades]
    .filter(r => r && r.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length < 2) return null;

  const latest = sorted[0];
  const latestDate = new Date(latest.date);
  const targetTime = latestDate.getTime() - REVISION_WINDOW_DAYS * DAY_MS;

  // Pick the row whose date is closest to 90 days before latest
  let older = sorted[1];
  let bestDelta = Math.abs(new Date(older.date).getTime() - targetTime);
  for (let i = 2; i < sorted.length; i++) {
    const d = Math.abs(new Date(sorted[i].date).getTime() - targetTime);
    if (d < bestDelta) {
      bestDelta = d;
      older = sorted[i];
    }
  }

  const gapDays = (latestDate.getTime() - new Date(older.date).getTime()) / DAY_MS;
  if (gapDays < REVISION_MIN_GAP_DAYS) return null;

  const bullLatest = gradeRowBullishness(latest);
  const bullOlder = gradeRowBullishness(older);
  if (bullLatest == null || bullOlder == null) return null;

  const delta = bullLatest - bullOlder;
  return piecewise(delta, REVISION_POINTS);
}

// ---------------------------------------------------------------------------
// Signal: insiderBuying
// ---------------------------------------------------------------------------

const INSIDER_BUYERS_POINTS = [
  [0, 0],
  [1, 0.3],
  [3, 0.7],
  [5, 1.0],
];

function isBuyTransaction(row) {
  const t = row && row.transactionType;
  if (typeof t !== 'string') return false;
  return t.toLowerCase().includes('p-purchase');
}

/**
 * Positive-only insider-buying signal over the trailing INSIDER_WINDOW_DAYS.
 * Maps the count of distinct insider buyers to [0, 1]. Insider sales are not
 * currently scored (future work could net them out). Returns `null` if no
 * insider rows fall in the window.
 */
function scoreInsiderBuying(insiderRows) {
  if (!Array.isArray(insiderRows) || insiderRows.length === 0) return null;

  const now = Date.now();
  const windowStart = now - INSIDER_WINDOW_DAYS * DAY_MS;

  const recent = insiderRows.filter(r => {
    if (!r || !r.transactionDate) return false;
    const t = new Date(r.transactionDate).getTime();
    return isFinite(t) && t >= windowStart && t <= now;
  });
  if (recent.length === 0) return null;

  const buys = recent.filter(isBuyTransaction);
  if (buys.length === 0) return 0;

  const distinctBuyers = new Set(
    buys.map(r => r.reportingName).filter(Boolean)
  ).size;

  // Sum shares bought; rows without securitiesTransacted fall back to 0
  // (we don't substitute securitiesOwned — that's post-trade holdings, not
  // trade size). Kept here in case a future caller wants the aggregate.
  let sharesBought = 0;
  for (const r of buys) {
    if (r.securitiesTransacted != null && isFinite(r.securitiesTransacted)) {
      sharesBought += Number(r.securitiesTransacted);
    } else if (process.env.CATALYST_DEBUG) {
      console.debug(
        `[catalystSnapshot] missing securitiesTransacted for ${r.symbol} ${r.transactionDate} ${r.reportingName}`
      );
    }
  }

  return piecewise(distinctBuyers, INSIDER_BUYERS_POINTS);
}

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

function deriveSignals({ earnings, gradesHistorical, insiderTrading }) {
  return {
    earningsSurprise: scoreEarningsSurprise(earnings),
    estimateRevisions: scoreEstimateRevisions(gradesHistorical),
    insiderBuying: scoreInsiderBuying(insiderTrading),
  };
}

async function fetchCatalystData(ticker) {
  // Strictly sequential — FMP 220ms/call rate limit, never parallel batches
  const earnings = await fmp.getEarnings(ticker, EARNINGS_LIMIT);
  const gradesHistorical = await fmp.getGradesHistorical(ticker, GRADES_LIMIT);
  const insiderTrading = await fmp.getInsiderTradingLatest(ticker, INSIDER_LIMIT);
  return { earnings, gradesHistorical, insiderTrading };
}

function getCatalystSnapshot(ticker) {
  if (!ticker) return null;
  return state.cache.get(ticker) || null;
}

/**
 * Populate the cache for a list of tickers. Sequential by contract — the FMP
 * rate limit means `Promise.all` over fetches is unsafe.
 *
 * @param {string[]} tickers
 * @param {object}   [options]
 * @param {boolean}  [options.force=false]    bypass TTL skip
 * @param {function} [options.onProgress]     (i, total, ticker, status) => void
 *                                            status ∈ 'fetched' | 'failed' | 'skipped'
 * @returns {Promise<{fetched: number, failed: number, skipped: number}>}
 */
async function populateCatalystCache(tickers, options = {}) {
  const { force = false, onProgress } = options;
  const list = Array.isArray(tickers) ? tickers : [];

  const summary = { fetched: 0, failed: 0, skipped: 0 };
  const now = Date.now();

  for (let i = 0; i < list.length; i++) {
    const ticker = list[i];
    let status;
    try {
      const existing = state.cache.get(ticker);
      const fresh = existing && (now - existing.fetchedAt) < CATALYST_CACHE_TTL_MS;
      if (!force && fresh) {
        summary.skipped += 1;
        status = 'skipped';
      } else {
        const raw = await fetchCatalystData(ticker);
        const signals = deriveSignals(raw);
        state.cache.set(ticker, {
          ticker,
          fetchedAt: Date.now(),
          earnings: raw.earnings,
          gradesHistorical: raw.gradesHistorical,
          insiderTrading: raw.insiderTrading,
          signals,
        });
        summary.fetched += 1;
        status = 'fetched';
      }
    } catch (err) {
      summary.failed += 1;
      status = 'failed';
      console.warn(`[catalystSnapshot] Failed ${ticker}: ${err.message}`);
    }
    if (typeof onProgress === 'function') {
      try {
        onProgress(i, list.length, ticker, status);
      } catch {
        // onProgress is advisory; a bad callback shouldn't kill the loop
      }
    }
  }

  state.lastBuild = {
    finishedAt: new Date().toISOString(),
    ...summary,
  };
  return summary;
}

function getCatalystCacheStatus() {
  return {
    size: state.cache.size,
    ttlMs: CATALYST_CACHE_TTL_MS,
    lastBuild: state.lastBuild,
  };
}

function _resetCacheForTest() {
  state.cache.clear();
  state.lastBuild = null;
}

module.exports = {
  getCatalystSnapshot,
  populateCatalystCache,
  getCatalystCacheStatus,
  _resetCacheForTest,
  CATALYST_CACHE_TTL_MS,
  // Exported for unit testing
  _test: {
    piecewise,
    scoreEarningsSurprise,
    scoreEstimateRevisions,
    scoreInsiderBuying,
    gradeRowBullishness,
    isBuyTransaction,
    deriveSignals,
    EARNINGS_SURPRISE_POINTS,
    REVISION_POINTS,
    INSIDER_BUYERS_POINTS,
    INSIDER_WINDOW_DAYS,
    REVISION_MIN_GAP_DAYS,
  },
};
