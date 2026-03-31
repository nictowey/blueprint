const fmp = require('./fmp');
const { computeRSI } = require('./rsi');

const EXCLUDED_SECTORS = new Set(['Financial Services', 'Utilities']);
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETRY_ON_FAIL_MS = 60 * 60 * 1000;          // 1 hour

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

// Fetch all metrics needed for a single stock in the universe
async function fetchStockData(symbol) {
  const today = dateStr(new Date());
  const oneYearAgo = dateStr(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));

  // Three parallel FMP calls per stock
  const [ttmData, incomeData, histData] = await Promise.all([
    fmp.getKeyMetricsTTM(symbol),
    fmp.getIncomeStatements(symbol, 2),
    fmp.getHistoricalPrices(symbol, oneYearAgo, today),
  ]);

  // Income statement: newest first from FMP
  const income0 = incomeData[0] || {};
  const income1 = incomeData[1] || {};

  // Gross margin from most recent income statement
  const grossMargin = income0.grossProfitRatio ?? null;

  // Revenue growth YoY
  let revenueGrowthYoY = null;
  if (income0.revenue != null && income1.revenue && income1.revenue !== 0) {
    revenueGrowthYoY = (income0.revenue - income1.revenue) / Math.abs(income1.revenue);
  }

  // Historical prices: FMP returns newest-first, reverse for RSI (needs oldest-first)
  const pricesOldestFirst = [...histData].reverse().map(h => h.close);
  const rsi14 = computeRSI(pricesOldestFirst.slice(-30));

  // Current price (newest entry)
  const currentPrice = histData[0]?.close ?? null;

  const high52w = histData.length > 0 ? histData.reduce((m, h) => Math.max(m, h.close), -Infinity) : null;
  const pctBelowHigh =
    currentPrice != null && high52w != null && high52w > 0
      ? ((high52w - currentPrice) / high52w) * 100
      : null;

  return {
    peRatio: ttmData.peRatioTTM ?? null,
    priceToSales: ttmData.priceToSalesRatioTTM ?? null,
    revenueGrowthYoY,
    grossMargin,
    marketCap: ttmData.marketCapTTM ?? null,
    rsi14,
    pctBelowHigh,
    price: currentPrice,
  };
}

async function buildCache() {
  console.log('[universe] Starting cache build...');
  try {
    const screenerResults = await fmp.getScreener({
      marketCapMoreThan: 1_000_000_000,
      marketCapLessThan: 100_000_000_000,
      country: 'US',
      exchange: 'NYSE,NASDAQ',
    });

    const filtered = screenerResults.filter(
      s => s.sector && !EXCLUDED_SECTORS.has(s.sector)
    );

    console.log(`[universe] ${filtered.length} stocks after filtering. Fetching metrics...`);

    const newCache = new Map();

    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async stock => {
          try {
            const metrics = await fetchStockData(stock.symbol);
            // Skip stocks with no usable metrics
            const hasAnyMetric = metrics.peRatio != null || metrics.revenueGrowthYoY != null ||
              metrics.grossMargin != null || metrics.rsi14 != null ||
              metrics.pctBelowHigh != null || metrics.marketCap != null;
            if (!hasAnyMetric) {
              console.warn(`[universe] Skipped ${stock.symbol}: no usable metrics`);
              return;
            }
            newCache.set(stock.symbol, {
              ticker: stock.symbol,
              companyName: stock.companyName,
              sector: stock.sector,
              price: metrics.price ?? stock.price,
              peRatio: metrics.peRatio,
              priceToSales: metrics.priceToSales,
              revenueGrowthYoY: metrics.revenueGrowthYoY,
              grossMargin: metrics.grossMargin,
              marketCap: metrics.marketCap,
              rsi14: metrics.rsi14,
              pctBelowHigh: metrics.pctBelowHigh,
            });
          } catch (err) {
            // Silent skip — one bad stock won't break the cache
            console.warn(`[universe] Skipped ${stock.symbol}: ${err.message}`);
          }
        })
      );
      if (i + BATCH_SIZE < filtered.length) await sleep(BATCH_DELAY_MS);
    }

    state.cache = newCache;
    state.ready = true;
    state.lastRefreshed = new Date().toISOString();
    console.log(`[universe] Cache ready: ${newCache.size} stocks`);
  } catch (err) {
    console.error('[universe] Cache build failed:', err.message);
    state.ready = false;
    setTimeout(buildCache, RETRY_ON_FAIL_MS);
  }
}

function startCache() {
  buildCache();
  setInterval(buildCache, REFRESH_INTERVAL_MS);
}

module.exports = { startCache, getCache, isReady, getStatus };
