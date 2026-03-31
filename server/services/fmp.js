const fetch = require('node-fetch');

const BASE = 'https://financialmodelingprep.com/api/v3';

function key() {
  if (!process.env.FMP_API_KEY) throw new Error('FMP_API_KEY not set');
  return process.env.FMP_API_KEY;
}

async function fmpGet(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apikey', key());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`FMP ${path} returned HTTP ${res.status}`);
  }
  const data = await res.json();
  // FMP returns { "Error Message": "..." } on auth failures
  if (data && data['Error Message']) {
    throw new Error(`FMP error: ${data['Error Message']}`);
  }
  return data;
}

// Ticker typeahead search
async function searchTickers(query) {
  const results = await fmpGet('/search', { query, limit: 10 });
  return Array.isArray(results) ? results : [];
}

// Company profile (name, sector, etc.)
async function getProfile(ticker) {
  const data = await fmpGet(`/profile/${ticker}`);
  return Array.isArray(data) ? data[0] : data;
}

// Annual income statements (newest first)
// limit=2 returns 2 most recent annual periods
async function getIncomeStatements(ticker, limit = 10) {
  const data = await fmpGet(`/income-statement/${ticker}`, { period: 'annual', limit });
  return Array.isArray(data) ? data : [];
}

// Annual key metrics (newest first)
async function getKeyMetricsAnnual(ticker) {
  const data = await fmpGet(`/key-metrics/${ticker}`, { period: 'annual' });
  return Array.isArray(data) ? data : [];
}

// TTM key metrics for a single ticker (for universe cache + comparison right panel)
async function getKeyMetricsTTM(ticker) {
  const data = await fmpGet(`/key-metrics/${ticker}/ttm`);
  const obj = Array.isArray(data) ? data[0] : data;
  return obj || {};
}

// Historical daily prices, newest first
// from/to are YYYY-MM-DD strings (optional)
async function getHistoricalPrices(ticker, from, to) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const data = await fmpGet(`/historical-price-full/${ticker}`, params);
  return Array.isArray(data?.historical) ? data.historical : [];
}

// Stock screener — returns array of basic stock info
async function getScreener(params = {}) {
  const data = await fmpGet('/stock-screener', params);
  return Array.isArray(data) ? data : [];
}

// Short interest for a ticker (may be null on some plans)
async function getShortInterest(ticker) {
  try {
    const data = await fmpGet(`/stock-short-interest/${ticker}`);
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null; // endpoint may not be available on all plans
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
};
