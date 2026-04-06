const fetch = require('node-fetch');

const BASE = 'https://financialmodelingprep.com/stable';

// Very safe rate limiting for Starter plan (300 calls/min max)
const RATE_LIMIT_MS = 250;   // 240 calls/min — safe headroom under 300/min Starter limit
const MAX_RETRIES = 3;

function key() {
  if (!process.env.FMP_API_KEY) throw new Error('FMP_API_KEY not set');
  return process.env.FMP_API_KEY;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fmpGet(path, params = {}) {
  let retries = 0;

  while (true) {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set('apikey', key());
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    try {
      const res = await fetch(url.toString());

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

      // Enforce delay after every successful call
      await delay(RATE_LIMIT_MS);

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
  const results = await fmpGet('/search', { query, limit: 10 });
  return Array.isArray(results) ? results : [];
}

async function getProfile(ticker) {
  const data = await fmpGet(`/profile/${ticker}`);
  return Array.isArray(data) ? data[0] : data;
}

async function getIncomeStatements(ticker, limit = 10) {
  const data = await fmpGet(`/income-statement`, { symbol: ticker, period: 'annual', limit });
  return Array.isArray(data) ? data : [];
}

async function getKeyMetricsAnnual(ticker) {
  const data = await fmpGet(`/key-metrics`, { symbol: ticker, period: 'annual' });
  return Array.isArray(data) ? data : [];
}

async function getKeyMetricsTTM(ticker) {
  const data = await fmpGet(`/key-metrics-ttm`, { symbol: ticker });
  const obj = Array.isArray(data) ? data[0] : data;
  return obj || {};
}

async function getBalanceSheet(ticker, limit = 1) {
  const data = await fmpGet(`/balance-sheet-statement`, { symbol: ticker, period: 'annual', limit });
  return Array.isArray(data) ? data : [];
}

async function getCashFlowStatement(ticker, limit = 1) {
  const data = await fmpGet(`/cash-flow-statement`, { symbol: ticker, period: 'annual', limit });
  return Array.isArray(data) ? data : [];
}

async function getHistoricalPrices(ticker, from, to) {
  const params = { symbol: ticker };
  if (from) params.from = from;
  if (to) params.to = to;
  const data = await fmpGet(`/historical-price-eod/full`, params);
  return Array.isArray(data?.historical) ? data.historical : (Array.isArray(data) ? data : []);
}

async function getScreener(params = {}) {
  console.log('[FMP] Starting screener...');
  const data = await fmpGet('/company-screener', params);
  console.log(`[FMP] Screener returned ${Array.isArray(data) ? data.length : 0} results`);
  return Array.isArray(data) ? data : [];
}

async function getShortInterest(ticker) {
  try {
    const data = await fmpGet(`/stock-short-interest/${ticker}`);
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

module.exports = {
  searchTickers,
  getProfile,
  getIncomeStatements,
  getKeyMetricsAnnual,
  getKeyMetricsTTM,
  getHistoricalPrices,
  getScreener,
  getShortInterest,
  getBalanceSheet,
  getCashFlowStatement,
};