const fetch = require('node-fetch');

const BASE = 'https://financialmodelingprep.com/stable';

// Rate limiting for Starter plan (300 calls/min max)
// 220ms = ~272 calls/min — slightly above old 240, safely under 300
const RATE_LIMIT_MS = 220;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 15000; // 15s timeout per FMP request

function key() {
  if (!process.env.FMP_API_KEY) throw new Error('FMP_API_KEY not set');
  return process.env.FMP_API_KEY;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// throttle=true: enforce rate-limit delay (used during cache build)
// throttle=false: skip delay (used for live user-initiated requests)
async function fmpGet(path, params = {}, throttle = true) {
  let retries = 0;

  while (true) {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set('apikey', key());
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 429) {
        const waitTime = 8000 + (retries * 3000);
        console.warn(`[FMP Rate Limit] Hit on ${path}. Waiting ${waitTime}ms...`);
        await delay(waitTime);
        retries++;
        if (retries > MAX_RETRIES) throw new Error(`Rate limit exceeded on ${path}`);
        continue;
      }

      if (!res.ok) {
        throw new Error(`FMP ${path} returned HTTP ${res.status}`);
      }

      const data = await res.json();

      if (data && data['Error Message']) {
        throw new Error(`FMP error: ${data['Error Message']}`);
      }

      // Enforce delay after every successful call — only during cache build
      if (throttle) await delay(RATE_LIMIT_MS);

      return data;

    } catch (error) {
      if (retries >= MAX_RETRIES) {
        console.error(`[FMP] Failed ${path} after ${retries} retries`);
        throw error;
      }
      retries++;
      await delay(2000 * retries);
    }
  }
}

// ==================== API Functions ====================

async function searchTickers(query) {
  // Try symbol search first (exact ticker match)
  try {
    const results = await fmpGet('/search-symbol', { query, limit: 10 }, false);
    if (Array.isArray(results) && results.length > 0) return results;
  } catch (err) {
    console.warn(`[FMP] /search-symbol failed for "${query}": ${err.message}`);
  }
  // Fallback: search by name
  try {
    const results = await fmpGet('/search-name', { query, limit: 10 }, false);
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

async function getProfile(ticker, throttle = true) {
  const data = await fmpGet(`/profile`, { symbol: ticker }, throttle);
  return Array.isArray(data) ? data[0] : data;
}

async function getIncomeStatements(ticker, limit = 10, throttle = true, period = 'annual') {
  const data = await fmpGet(`/income-statement`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

async function getKeyMetricsAnnual(ticker, throttle = true, period = 'annual', limit = 15) {
  const data = await fmpGet(`/key-metrics`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

async function getRatiosAnnual(ticker, throttle = true, period = 'annual', limit = 10) {
  const data = await fmpGet(`/ratios`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

async function getKeyMetricsTTM(ticker, throttle = true) {
  const data = await fmpGet(`/key-metrics-ttm`, { symbol: ticker }, throttle);
  const obj = Array.isArray(data) ? data[0] : data;
  return obj || {};
}

async function getRatiosTTM(ticker, throttle = true) {
  const data = await fmpGet(`/ratios-ttm`, { symbol: ticker }, throttle);
  const obj = Array.isArray(data) ? data[0] : data;
  return obj || {};
}

async function getBalanceSheet(ticker, limit = 1, throttle = true, period = 'annual') {
  const data = await fmpGet(`/balance-sheet-statement`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

async function getCashFlowStatement(ticker, limit = 1, throttle = true, period = 'annual') {
  const data = await fmpGet(`/cash-flow-statement`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

async function getHistoricalPrices(ticker, from, to, throttle = true) {
  const params = { symbol: ticker };
  if (from) params.from = from;
  if (to) params.to = to;
  const data = await fmpGet(`/historical-price-eod/full`, params, throttle);
  return Array.isArray(data?.historical) ? data.historical : (Array.isArray(data) ? data : []);
}

async function getScreener(params = {}) {
  console.log('[FMP] Starting screener...');
  const data = await fmpGet('/company-screener', params);
  console.log(`[FMP] Screener returned ${Array.isArray(data) ? data.length : 0} results`);
  return Array.isArray(data) ? data : [];
}

async function getShortInterest(ticker, throttle = true) {
  try {
    const data = await fmpGet(`/stock-short-interest`, { symbol: ticker }, throttle);
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

/**
 * Recent quarterly earnings history for a ticker. Rows include actual and estimated
 * EPS/revenue. FMP returns rows most-recent-first by `date`.
 *
 * Row shape: { symbol, date, epsActual, epsEstimated, revenueActual,
 *              revenueEstimated, lastUpdated }
 *
 * Errors from `fmpGet` (HTTP failures, rate-limit exhaustion) propagate; the
 * wrapper does not swallow them. Empty-but-successful responses return `[]`.
 */
async function getEarnings(ticker, limit = 8, throttle = true) {
  const data = await fmpGet(`/earnings`, { symbol: ticker, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

/**
 * Historical analyst rating snapshots for a ticker. Each row is a point-in-time
 * count of analyst ratings across five buckets.
 *
 * Row shape: { symbol, date, analystRatingsStrongBuy, analystRatingsBuy,
 *              analystRatingsHold, analystRatingsSell, analystRatingsStrongSell }
 *
 * Used to compute estimate-revision deltas over time (today vs. ~90 days ago).
 */
async function getGradesHistorical(ticker, limit = 100, throttle = true) {
  const data = await fmpGet(`/grades-historical`, { symbol: ticker, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

/**
 * Recent insider-trading filings (Form 4) for a ticker. Rows include transaction
 * type, buyer identity, shares transacted, and dates.
 *
 * Row shape: { symbol, filingDate, transactionDate, reportingCik, companyCik,
 *              transactionType, securitiesOwned, securitiesTransacted,
 *              reportingName, ... }
 *
 * Note: `transactionType` strings follow SEC Form 4 codes — e.g. "P-Purchase",
 * "S-Sale", "A-Award", "M-Exercise". Buys vs. sells are detected via substring
 * match on that code.
 */
async function getInsiderTradingLatest(ticker, limit = 100, throttle = true) {
  const data = await fmpGet(`/insider-trading/latest`, { symbol: ticker, limit }, throttle);
  return Array.isArray(data) ? data : [];
}

module.exports = {
  searchTickers,
  getProfile,
  getIncomeStatements,
  getKeyMetricsAnnual,
  getRatiosAnnual,
  getKeyMetricsTTM,
  getRatiosTTM,
  getHistoricalPrices,
  getScreener,
  getShortInterest,
  getBalanceSheet,
  getCashFlowStatement,
  getEarnings,
  getGradesHistorical,
  getInsiderTradingLatest,
};