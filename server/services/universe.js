const fetch = require('node-fetch');
const fmp = require('./fmp');
const { computeRSI } = require('./rsi');

const REDIS_KEY = 'universe_cache';
const CACHE_TTL_SECONDS = 90000; // 25 hours

async function saveCacheToRedis(cache) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    const data = JSON.stringify(Array.from(cache.entries()));
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', REDIS_KEY, data, 'EX', String(CACHE_TTL_SECONDS)]),
    });
    console.log(`[universe] Cache saved to Redis: ${cache.size} stocks`);
  } catch (err) {
    console.warn(`[universe] Failed to save cache to Redis: ${err.message}`);
  }
}

async function loadCacheFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${REDIS_KEY}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.result) return null;
    const cache = new Map(JSON.parse(json.result));
    console.log(`[universe] Loaded cache from Redis: ${cache.size} stocks`);
    return cache;
  } catch (err) {
    console.warn(`[universe] Failed to load cache from Redis: ${err.message}`);
    return null;
  }
}

const RETRY_ON_FAIL_MS = 60 * 60 * 1000;          // 1 hour
const INCREMENTAL_INTERVAL_MS = 10 * 60 * 1000;   // 10 minutes
const INCREMENTAL_BATCH_SIZE = 10;                 // stocks per interval (~24h full cycle)

const state = {
  cache: new Map(),
  ready: false,
  lastRefreshed: null,
};

function getCache() { return state.cache; }
function isReady() { return state.ready; }
function getStatus() {
  return {
    ready: state.ready,
    stockCount: state.cache.size,
    lastRefreshed: state.lastRefreshed,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(d) { return d.toISOString().slice(0, 10); }

async function enrichStock(entry) {
  const symbol = entry.ticker;

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const from = fromDate.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);

  // 6 sequential calls — each waits for the 250ms rate-limit delay in fmp.js
  const ttmData = await fmp.getKeyMetricsTTM(symbol);
  const ttmRatios = await fmp.getRatiosTTM(symbol);
  const incomeData = await fmp.getIncomeStatements(symbol, 4);
  const historical = await fmp.getHistoricalPrices(symbol, from, to);
  const profileData = await fmp.getProfile(symbol);
  const balanceData = await fmp.getBalanceSheet(symbol, 1);
  const cashFlowData = await fmp.getCashFlowStatement(symbol, 1);

  // --- Income ---
  const income0 = incomeData[0] || {};
  const income1 = incomeData[1] || {};
  const income3 = incomeData[3] || {};

  let revenueGrowthYoY = null;
  if (income0.revenue != null && income1.revenue && income1.revenue !== 0) {
    revenueGrowthYoY = (income0.revenue - income1.revenue) / Math.abs(income1.revenue);
  }

  let revenueGrowth3yr = null;
  if (income0.revenue != null && income3.revenue && income3.revenue !== 0) {
    revenueGrowth3yr = Math.pow(income0.revenue / income3.revenue, 1 / 3) - 1;
  }

  let epsGrowthYoY = null;
  if (income0.eps != null && income1.eps && income1.eps !== 0) {
    epsGrowthYoY = (income0.eps - income1.eps) / Math.abs(income1.eps);
  }

  // --- Historical prices ---
  let rsi14 = null;
  let pctBelowHigh = null;
  let priceVsMa50 = null;
  let priceVsMa200 = null;

  if (Array.isArray(historical) && historical.length > 0) {
    // historical comes back newest-first; reverse for oldest-first
    const oldestFirst = [...historical].reverse();
    const closes = oldestFirst.map(d => d.close).filter(c => c != null);

    rsi14 = computeRSI(closes.slice(-30));

    const high52w = Math.max(...historical.map(d => d.close).filter(c => c != null));
    const currentPrice = historical[0].close;

    if (high52w > 0 && currentPrice != null) {
      pctBelowHigh = ((high52w - currentPrice) / high52w) * 100;
    }

    if (closes.length >= 50) {
      const ma50 = closes.slice(-50).reduce((s, v) => s + v, 0) / 50;
      if (currentPrice != null && ma50 > 0) {
        priceVsMa50 = ((currentPrice - ma50) / ma50) * 100;
      }
    }

    if (closes.length > 0) {
      const ma200 = closes.reduce((s, v) => s + v, 0) / closes.length;
      if (currentPrice != null && ma200 > 0) {
        priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
      }
    }

    entry.price = currentPrice ?? entry.price;
  }

  // --- Balance sheet ---
  const balance = Array.isArray(balanceData) ? balanceData[0] || {} : {};
  // --- Cash flow ---
  const cashFlow = Array.isArray(cashFlowData) ? cashFlowData[0] || {} : {};

  // Update cache entry in-place
  entry.peRatio            = ttmRatios.priceToEarningsRatioTTM ?? null;
  entry.priceToBook        = ttmRatios.priceToBookRatioTTM ?? null;
  entry.priceToSales       = ttmRatios.priceToSalesRatioTTM ?? null;
  entry.evToEBITDA         = ttmData.evToEBITDATTM ?? null;
  entry.evToRevenue        = ttmData.evToSalesTTM ?? null;
  entry.pegRatio           = ttmRatios.priceToEarningsGrowthRatioTTM ?? null;
  entry.earningsYield      = ttmData.earningsYieldTTM ?? null;
  entry.grossMargin        = ttmRatios.grossProfitMarginTTM ?? null;
  entry.operatingMargin    = ttmRatios.operatingProfitMarginTTM ?? null;
  entry.netMargin          = ttmRatios.netProfitMarginTTM ?? null;
  entry.ebitdaMargin       = ttmRatios.ebitdaMarginTTM ?? null;
  entry.returnOnEquity     = ttmData.returnOnEquityTTM ?? null;
  entry.returnOnAssets     = ttmData.returnOnAssetsTTM ?? null;
  entry.returnOnCapital    = ttmData.returnOnInvestedCapitalTTM ?? null;
  entry.revenueGrowthYoY  = revenueGrowthYoY;
  entry.revenueGrowth3yr  = revenueGrowth3yr;
  entry.epsGrowthYoY      = epsGrowthYoY;
  entry.eps                = income0.eps ?? null;
  entry.currentRatio       = ttmRatios.currentRatioTTM ?? ttmData.currentRatioTTM ?? null;
  entry.debtToEquity       = ttmRatios.debtToEquityRatioTTM ?? null;
  entry.interestCoverage   = ttmRatios.interestCoverageRatioTTM ?? null;
  entry.netDebtToEBITDA    = ttmData.netDebtToEBITDATTM ?? null;
  entry.freeCashFlowYield  = ttmData.freeCashFlowYieldTTM ?? null;
  entry.dividendYield      = ttmRatios.dividendYieldTTM ?? null;
  entry.marketCap          = ttmData.marketCap ?? entry.marketCap;
  entry.totalCash          = balance.cashAndCashEquivalents ?? null;
  entry.totalDebt          = balance.totalDebt ?? null;
  entry.freeCashFlow       = cashFlow.freeCashFlow ?? null;
  entry.operatingCashFlow  = cashFlow.operatingCashFlow ?? null;
  entry.rsi14              = rsi14;
  entry.pctBelowHigh       = pctBelowHigh;
  entry.priceVsMa50        = priceVsMa50;
  entry.priceVsMa200       = priceVsMa200;
  entry.beta               = profileData?.beta ?? entry.beta ?? null;
  entry.avgVolume          = profileData?.averageVolume ?? entry.avgVolume ?? null;
  entry.lastEnriched       = Date.now();
}

async function buildCache() {
  const redisCache = await loadCacheFromRedis();
  if (redisCache) {
    // Spread lastEnriched timestamps across the next 24h so incremental
    // refresh cycles evenly rather than refreshing all stocks at once.
    const stocks = Array.from(redisCache.values());
    const now = Date.now();
    const window = 24 * 60 * 60 * 1000;
    stocks.forEach((entry, i) => {
      if (!entry.lastEnriched) {
        entry.lastEnriched = now - window + (i / stocks.length) * window;
      }
    });
    state.cache = redisCache;
    state.ready = true;
    state.lastRefreshed = new Date().toISOString();
    return;
  }

  console.log('[universe] Starting cache build...');
  try {
    const screenerResults = await fmp.getScreener({
      marketCapMoreThan: 100_000_000,
      country: 'US',
      exchange: 'NYSE,NASDAQ,AMEX',
      limit: 1000,
    });

    // Only skip stocks with no symbol — include all sectors and all market caps
    const filtered = screenerResults.filter(s => s.symbol);

    console.log(`[universe] ${filtered.length} stocks to process. Fetching metrics...`);

    const newCache = new Map();

    for (const s of filtered) {
      try {
        newCache.set(s.symbol, {
          ticker:           s.symbol,
          companyName:      s.name || s.companyName || s.symbol,
          sector:           s.sector || null,
          price:            s.price ?? null,
          marketCap:        s.marketCap ?? null,
          beta:             s.beta ?? null,
          avgVolume:        s.volume ?? null,
          // Valuation
          peRatio:          null,
          priceToBook:      null,
          priceToSales:     null,
          evToEBITDA:       null,
          evToRevenue:      null,
          pegRatio:         null,
          earningsYield:    null,
          // Profitability
          grossMargin:      null,
          operatingMargin:  null,
          netMargin:        null,
          ebitdaMargin:     null,
          returnOnEquity:   null,
          returnOnAssets:   null,
          returnOnCapital:  null,
          // Growth
          revenueGrowthYoY: null,
          revenueGrowth3yr: null,
          epsGrowthYoY:     null,
          eps:              null,
          // Financial Health
          currentRatio:     null,
          debtToEquity:     null,
          interestCoverage: null,
          netDebtToEBITDA:  null,
          freeCashFlowYield:null,
          dividendYield:    null,
          totalCash:        null,
          totalDebt:        null,
          freeCashFlow:     null,
          operatingCashFlow:null,
          // Technical
          rsi14:            null,
          pctBelowHigh:     null,
          priceVsMa50:      null,
          priceVsMa200:     null,
          beta:             null,
          avgVolume:        null,
        });

        const entry = newCache.get(s.symbol);
        await enrichStock(entry);

        if (newCache.size % 10 === 0) {
          console.log(`[universe] Progress: ${newCache.size} stocks loaded...`);
        }
      } catch (err) {
        console.warn(`[universe] Skipped ${s.symbol}: ${err.message}`);
        newCache.delete(s.symbol);
      }
    }

    state.cache = newCache;
    state.ready = true;
    state.lastRefreshed = new Date().toISOString();
    console.log(`[universe] Cache ready: ${newCache.size} stocks`);
    await saveCacheToRedis(newCache);
  } catch (err) {
    console.error('[universe] Cache build failed:', err.message);
    state.ready = false;
    setTimeout(buildCache, RETRY_ON_FAIL_MS);
  }
}

async function refreshStalest(n = INCREMENTAL_BATCH_SIZE) {
  if (!state.ready) return; // don't run during initial build
  const entries = Array.from(state.cache.values())
    .sort((a, b) => (a.lastEnriched ?? 0) - (b.lastEnriched ?? 0))
    .slice(0, n);

  if (entries.length === 0) return;
  console.log(`[universe] Incremental refresh: ${entries.length} stocks`);

  for (const entry of entries) {
    try {
      await enrichStock(entry);
    } catch (err) {
      console.warn(`[universe] Incremental skip ${entry.ticker}: ${err.message}`);
    }
  }

  await saveCacheToRedis(state.cache);
}

function startCache() {
  buildCache();
  setInterval(refreshStalest, INCREMENTAL_INTERVAL_MS);
}

module.exports = { startCache, getCache, isReady, getStatus, saveCacheToRedis, loadCacheFromRedis };
