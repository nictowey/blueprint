const fmp = require('./fmp');
const { computeRSI } = require('./rsi');

const BATCH_SIZE = 1;
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

async function enrichStock(entry) {
  const symbol = entry.ticker;

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const from = fromDate.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);

  // 6 sequential calls — each waits for the 250ms rate-limit delay in fmp.js
  const ttmData = await fmp.getKeyMetricsTTM(symbol);
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
  }

  // --- Balance sheet ---
  const balance = Array.isArray(balanceData) ? balanceData[0] || {} : {};
  // --- Cash flow ---
  const cashFlow = Array.isArray(cashFlowData) ? cashFlowData[0] || {} : {};

  // Update cache entry in-place
  entry.peRatio            = ttmData.peRatioTTM ?? null;
  entry.priceToBook        = ttmData.pbRatioTTM ?? null;
  entry.priceToSales       = ttmData.priceToSalesRatioTTM ?? null;
  entry.evToEBITDA         = ttmData.evToEBITDATTM ?? null;
  entry.evToRevenue        = ttmData.evToRevenueTTM ?? null;
  entry.pegRatio           = ttmData.pegRatioTTM ?? null;
  entry.earningsYield      = ttmData.earningsYieldTTM ?? null;
  entry.grossMargin        = income0.grossProfitRatio ?? null;
  entry.operatingMargin    = income0.operatingIncomeRatio ?? null;
  entry.netMargin          = income0.netIncomeRatio ?? null;
  entry.ebitdaMargin       = income0.ebitdaratio ?? null;
  entry.returnOnEquity     = ttmData.returnOnEquityTTM ?? null;
  entry.returnOnAssets     = ttmData.returnOnAssetsTTM ?? null;
  entry.returnOnCapital    = ttmData.roicTTM ?? null;
  entry.revenueGrowthYoY  = revenueGrowthYoY;
  entry.revenueGrowth3yr  = revenueGrowth3yr;
  entry.epsGrowthYoY      = epsGrowthYoY;
  entry.eps                = income0.eps ?? null;
  entry.currentRatio       = ttmData.currentRatioTTM ?? null;
  entry.debtToEquity       = ttmData.debtToEquityTTM ?? null;
  entry.interestCoverage   = ttmData.interestCoverageTTM ?? null;
  entry.netDebtToEBITDA    = ttmData.netDebtToEBITDATTM ?? null;
  entry.freeCashFlowYield  = ttmData.freeCashFlowYieldTTM ?? null;
  entry.dividendYield      = ttmData.dividendYieldPercentageTTM ?? null;
  entry.marketCap          = ttmData.marketCapTTM ?? entry.marketCap;
  entry.totalCash          = balance.cashAndCashEquivalents ?? null;
  entry.totalDebt          = balance.totalDebt ?? null;
  entry.freeCashFlow       = cashFlow.freeCashFlow ?? null;
  entry.operatingCashFlow  = cashFlow.operatingCashFlow ?? null;
  entry.rsi14              = rsi14;
  entry.pctBelowHigh       = pctBelowHigh;
  entry.priceVsMa50        = priceVsMa50;
  entry.priceVsMa200       = priceVsMa200;
  entry.beta               = profileData?.beta ?? null;
  entry.avgVolume          = profileData?.volAvg ?? null;
}

async function buildCache() {
  console.log('[universe] Starting cache build...');
  try {
    const screenerResults = await fmp.getScreener({
      marketCapMoreThan: 500_000_000,
      country: 'US',
      exchange: 'NYSE,NASDAQ',
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
