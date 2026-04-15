const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const fmp = require('./fmp');
const { computeRSI } = require('./rsi');

const REDIS_KEY = 'universe_cache';
const CACHE_VERSION_KEY = 'universe_cache_version';
const CACHE_VERSION = 2; // accept existing Redis cache; incremental refresh applies new formulas
const CACHE_TTL_SECONDS = 604800; // 7 days — incremental refresh keeps data fresh

async function saveCacheToRedis(cache) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    const data = JSON.stringify(Array.from(cache.entries()));
    // Save cache data and version atomically
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', REDIS_KEY, data, 'EX', String(CACHE_TTL_SECONDS)]),
    });
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', CACHE_VERSION_KEY, String(CACHE_VERSION), 'EX', String(CACHE_TTL_SECONDS)]),
    });
    console.log(`[universe] Cache saved to Redis: ${cache.size} stocks (v${CACHE_VERSION})`);
  } catch (err) {
    console.warn(`[universe] Failed to save cache to Redis: ${err.message}`);
  }
}

async function loadCacheFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    // Check version first
    const vRes = await fetch(`${url}/get/${CACHE_VERSION_KEY}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const vJson = await vRes.json();
    const storedVersion = parseInt(vJson.result, 10);
    if (storedVersion !== CACHE_VERSION) {
      console.log(`[universe] Redis cache version mismatch (stored: ${storedVersion || 'none'}, expected: ${CACHE_VERSION}) — rebuilding`);
      return null;
    }

    const res = await fetch(`${url}/get/${REDIS_KEY}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.result) return null;
    const cache = new Map(JSON.parse(json.result));
    console.log(`[universe] Loaded cache from Redis: ${cache.size} stocks (v${CACHE_VERSION})`);
    return cache;
  } catch (err) {
    console.warn(`[universe] Failed to load cache from Redis: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local file cache — fast fallback when Redis is unavailable or expired
// ---------------------------------------------------------------------------

const LOCAL_CACHE_DIR = path.join(__dirname, '..', '.cache');
const LOCAL_CACHE_FILE = path.join(LOCAL_CACHE_DIR, 'universe.json');

function saveLocalCache(cache) {
  try {
    if (!fs.existsSync(LOCAL_CACHE_DIR)) fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
    const data = JSON.stringify({
      version: CACHE_VERSION,
      savedAt: new Date().toISOString(),
      entries: Array.from(cache.entries()),
    });
    fs.writeFileSync(LOCAL_CACHE_FILE, data);
    console.log(`[universe] Local cache saved: ${cache.size} stocks`);
  } catch (err) {
    console.warn(`[universe] Failed to save local cache: ${err.message}`);
  }
}

function loadLocalCache() {
  try {
    if (!fs.existsSync(LOCAL_CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(LOCAL_CACHE_FILE, 'utf8'));
    if (raw.version !== CACHE_VERSION) {
      console.log(`[universe] Local cache version mismatch (${raw.version} vs ${CACHE_VERSION}) — skipping`);
      return null;
    }
    const cache = new Map(raw.entries);
    console.log(`[universe] Loaded local cache: ${cache.size} stocks (saved ${raw.savedAt})`);
    return cache;
  } catch (err) {
    console.warn(`[universe] Failed to load local cache: ${err.message}`);
    return null;
  }
}

const RETRY_ON_FAIL_MS = 60 * 60 * 1000;          // 1 hour
const INCREMENTAL_INTERVAL_MS = 5 * 60 * 1000;    // 5 minutes
const INCREMENTAL_BATCH_SIZE = 100;                // stocks per interval (~4h full cycle for ~5000 stocks)

const state = {
  cache: new Map(),
  ready: false,
  lastRefreshed: null,
  lastIncrementalRefresh: null,
};

function getCache() { return state.cache; }
function isReady() { return state.ready; }
function getStatus() {
  const entries = Array.from(state.cache.values());
  const now = Date.now();
  const stalest = entries.length > 0
    ? Math.min(...entries.map(e => e.lastEnriched ?? 0))
    : null;
  const freshest = entries.length > 0
    ? Math.max(...entries.map(e => e.lastEnriched ?? 0))
    : null;
  return {
    ready: state.ready,
    stockCount: state.cache.size,
    lastRefreshed: state.lastRefreshed,
    lastIncrementalRefresh: state.lastIncrementalRefresh,
    nextIncrementalRefreshIn: state.lastIncrementalRefresh
      ? Math.max(0, INCREMENTAL_INTERVAL_MS - (now - new Date(state.lastIncrementalRefresh).getTime()))
      : null,
    oldestEntryAge: stalest ? Math.round((now - stalest) / 1000 / 60) + 'm' : null,
    newestEntryAge: freshest ? Math.round((now - freshest) / 1000 / 60) + 'm' : null,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(d) { return d.toISOString().slice(0, 10); }

// Sum flow metrics across quarterly periods — mirrors snapshot.js exactly
function sumQuarters(quarters) {
  const sum = (field) => quarters.reduce((s, q) => s + (q[field] ?? 0), 0);
  const sharesOut = quarters[0]?.weightedAverageShsOutDil ?? null;
  return {
    revenue: sum('revenue'),
    grossProfit: sum('grossProfit'),
    operatingIncome: sum('operatingIncome'),
    netIncome: sum('netIncome'),
    ebitda: sum('ebitda'),
    eps: sum('eps'),
    interestExpense: sum('interestExpense'),
    sharesOut,
  };
}

async function enrichStock(entry) {
  const symbol = entry.ticker;

  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const from = fromDate.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);

  // Sequential calls with per-call resilience — if individual calls fail,
  // we still use whatever data we got instead of skipping the entire stock.
  // Calls are sequential to respect FMP rate limits (220ms delay per call).
  async function safeFmpCall(fn) {
    try { return await fn(); } catch { return null; }
  }

  const incomeData   = await safeFmpCall(() => fmp.getIncomeStatements(symbol, 16, true, 'quarter')) || [];
  const balanceData  = await safeFmpCall(() => fmp.getBalanceSheet(symbol, 4, true, 'quarter')) || [];
  const cashFlowData = await safeFmpCall(() => fmp.getCashFlowStatement(symbol, 4, true, 'quarter')) || [];
  const historical   = await safeFmpCall(() => fmp.getHistoricalPrices(symbol, from, to)) || [];
  const profileData  = await safeFmpCall(() => fmp.getProfile(symbol)) || {};

  // --- TTM from 4 most recent quarters ---
  // Sort newest-first defensively (FMP usually returns this order, but not guaranteed)
  incomeData.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Validate that the 4 quarters span a ~12-month window to avoid
  // summing misaligned quarters (e.g., a missing quarter compressing to 9 months).
  const ttmQ = incomeData.slice(0, 4);
  const priorTtmQ = incomeData.slice(4, 8);
  function validTtmWindow(quarters) {
    if (quarters.length < 4) return false;
    const newest = new Date(quarters[0].date);
    const oldest = new Date(quarters[3].date);
    const spanMonths = (newest - oldest) / (30.44 * 24 * 60 * 60 * 1000);
    return spanMonths >= 8 && spanMonths <= 15;
  }
  const ttm = validTtmWindow(ttmQ) ? sumQuarters(ttmQ) : null;
  const priorTtm = validTtmWindow(priorTtmQ) ? sumQuarters(priorTtmQ) : null;

  // --- Growth: TTM vs prior-year TTM ---
  let revenueGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.revenue !== 0) {
    revenueGrowthYoY = (ttm.revenue - priorTtm.revenue) / Math.abs(priorTtm.revenue);
  }

  const ttm3yrAgoQ = incomeData.slice(12, 16);
  const ttm3yrAgo = validTtmWindow(ttm3yrAgoQ) ? sumQuarters(ttm3yrAgoQ) : null;
  let revenueGrowth3yr = null;
  // Both current and 3yr-ago TTM revenue must be positive for CAGR to be meaningful
  if (ttm && ttm.revenue > 0 && ttm3yrAgo && ttm3yrAgo.revenue > 0) {
    revenueGrowth3yr = Math.pow(ttm.revenue / ttm3yrAgo.revenue, 1 / 3) - 1;
  }

  let epsGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.eps !== 0) {
    epsGrowthYoY = (ttm.eps - priorTtm.eps) / Math.abs(priorTtm.eps);
  }

  // --- Balance sheet (latest quarterly) ---
  // Sort newest-first defensively, then take the most recent quarter.
  // If FMP call failed (empty array), preserve existing cached values
  // rather than overwriting with null.
  if (Array.isArray(balanceData) && balanceData.length > 1) {
    balanceData.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  const balance = Array.isArray(balanceData) && balanceData.length > 0 ? balanceData[0] : null;
  const equity = balance?.totalStockholdersEquity ?? entry.equity ?? null;
  const totalAssets = balance?.totalAssets ?? entry.totalAssets ?? null;
  const totalCurrentAssets = balance?.totalCurrentAssets ?? entry.totalCurrentAssets ?? null;
  const totalCurrentLiabilities = balance?.totalCurrentLiabilities ?? entry.totalCurrentLiabilities ?? null;
  const totalDebt = balance?.totalDebt ?? entry.totalDebt ?? null;
  const cash = balance?.cashAndCashEquivalents ?? entry.totalCash ?? null;

  // --- Cash flow TTM (sum 4 quarters — must have all 4 for accuracy) ---
  const cfQuarters = Array.isArray(cashFlowData) ? [...cashFlowData].sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
  const cfTtmQ = cfQuarters.slice(0, 4);
  const cfTtmValid = validTtmWindow(cfTtmQ);
  const ttmFCF = cfTtmValid
    ? cfTtmQ.reduce((s, q) => s + (q.freeCashFlow ?? 0), 0)
    : null;
  const ttmOperatingCF = cfTtmValid
    ? cfTtmQ.reduce((s, q) => s + (q.operatingCashFlow ?? 0), 0)
    : null;

  // --- Historical prices ---
  let rsi14 = null;
  let pctBelowHigh = null;
  let priceVsMa50 = null;
  let priceVsMa200 = null;

  if (Array.isArray(historical) && historical.length > 0) {
    const oldestFirst = [...historical].reverse();
    const closes = oldestFirst.map(d => d.close).filter(c => c != null);

    rsi14 = computeRSI(closes.slice(-30));

    // Use only the last 252 trading days (~1 year) for 52-week high.
    // Require at least 200 days for meaningful "52-week" reference.
    const closes52w = closes.slice(-252);
    const high52w = closes52w.length >= 200 ? Math.max(...closes52w) : null;
    const currentPrice = historical[0].close;

    if (high52w > 0 && currentPrice != null) {
      pctBelowHigh = ((high52w - currentPrice) / high52w) * 100;
    }

    if (closes.length >= 50) {
      const ma50 = closes.slice(-50).reduce((s, v) => s + v, 0) / 50;
      if (currentPrice != null && ma50 > 0) priceVsMa50 = ((currentPrice - ma50) / ma50) * 100;
    }

    if (closes.length >= 200) {
      const ma200 = closes.slice(-200).reduce((s, v) => s + v, 0) / 200;
      if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
    }

    entry.price = currentPrice ?? entry.price;

    // Store last 30 daily closes for mini sparklines in match cards
    entry.recentCloses = closes.slice(-30);

    // Volume profile: relative volume (recent 5-day avg vs 50-day avg)
    const volumes = oldestFirst.map(d => d.volume).filter(v => v != null && v > 0);
    if (volumes.length >= 50) {
      const vol50 = volumes.slice(-50).reduce((s, v) => s + v, 0) / 50;
      const vol5 = volumes.slice(-5).reduce((s, v) => s + v, 0) / Math.min(5, volumes.slice(-5).length);
      if (vol50 > 0) {
        entry.relativeVolume = vol5 / vol50; // 1.0 = normal, 2.0 = 2x average
      }
    }
  }

  // --- Computed ratios (same formulas as snapshot.js) ---
  const sharesOut = ttm?.sharesOut ?? null;
  const price = entry.price;
  const computedMarketCap = (price != null && sharesOut != null) ? price * sharesOut : null;
  const ev = (computedMarketCap != null && totalDebt != null && cash != null)
    ? computedMarketCap + totalDebt - cash : null;

  // Valuation
  entry.peRatio        = (price > 0 && ttm?.eps > 0) ? price / ttm.eps : null;
  entry.priceToSales   = (computedMarketCap > 0 && ttm?.revenue > 0) ? computedMarketCap / ttm.revenue : null;
  entry.priceToBook    = (computedMarketCap > 0 && equity > 0) ? computedMarketCap / equity : null;
  entry.evToEBITDA     = (ev != null && ttm?.ebitda > 0) ? ev / ttm.ebitda : null;
  entry.evToRevenue    = (ev != null && ttm?.revenue > 0) ? ev / ttm.revenue : null;
  entry.earningsYield  = (price > 0 && ttm) ? ttm.eps / price : null;
  entry.pegRatio       = (entry.peRatio > 0 && epsGrowthYoY > 0) ? entry.peRatio / (epsGrowthYoY * 100) : null;

  // Margins
  entry.grossMargin     = ttm && ttm.revenue ? ttm.grossProfit / ttm.revenue : null;
  entry.operatingMargin = ttm && ttm.revenue ? ttm.operatingIncome / ttm.revenue : null;
  entry.netMargin       = ttm && ttm.revenue ? ttm.netIncome / ttm.revenue : null;
  entry.ebitdaMargin    = ttm && ttm.revenue ? ttm.ebitda / ttm.revenue : null;

  // Returns — require positive equity/assets to avoid nonsensical negative ratios
  entry.returnOnEquity   = (ttm && equity != null && equity > 0) ? ttm.netIncome / equity : null;
  entry.returnOnAssets   = (ttm && totalAssets != null && totalAssets > 0) ? ttm.netIncome / totalAssets : null;
  const investedCapital  = (equity != null && totalDebt != null && cash != null) ? equity + totalDebt - cash : null;
  entry.returnOnCapital  = (ttm && investedCapital != null && investedCapital > 0)
    ? ttm.operatingIncome / investedCapital : null;

  // Growth
  entry.revenueGrowthYoY = revenueGrowthYoY;
  entry.revenueGrowth3yr = revenueGrowth3yr;
  entry.epsGrowthYoY     = epsGrowthYoY;
  entry.eps              = ttm ? ttm.eps : null;

  // Financial Health
  entry.currentRatio     = (totalCurrentAssets != null && totalCurrentLiabilities != null && totalCurrentLiabilities > 0)
    ? totalCurrentAssets / totalCurrentLiabilities : null;
  entry.debtToEquity     = (totalDebt != null && equity != null && equity > 0) ? totalDebt / equity : null;
  entry.interestCoverage = (ttm && ttm.interestExpense != null && ttm.interestExpense !== 0)
    ? ttm.operatingIncome / Math.abs(ttm.interestExpense) : null;
  entry.netDebtToEBITDA  = (totalDebt != null && cash != null && ttm?.ebitda > 0) ? (totalDebt - cash) / ttm.ebitda : null;
  entry.freeCashFlowYield = (ttmFCF != null && computedMarketCap > 0) ? ttmFCF / computedMarketCap : null;
  entry.dividendYield    = profileData?.lastDiv && price > 0 ? profileData.lastDiv / price : null;
  entry.marketCap        = computedMarketCap ?? entry.marketCap;
  entry.totalCash        = cash;
  entry.totalDebt        = totalDebt;
  entry.freeCashFlow     = ttmFCF;
  entry.operatingCashFlow = ttmOperatingCF;

  // Technical
  entry.rsi14        = rsi14;
  entry.pctBelowHigh = pctBelowHigh;
  entry.priceVsMa50  = priceVsMa50;
  entry.priceVsMa200 = priceVsMa200;
  entry.beta         = profileData?.beta ?? entry.beta ?? null;
  entry.avgVolume    = profileData?.averageVolume ?? entry.avgVolume ?? null;
  entry.lastEnriched = Date.now();
}

async function buildCache() {
  // Try Redis first, then local file, then FMP screener
  const cachedData = await loadCacheFromRedis() || loadLocalCache();
  if (cachedData) {
    // Spread lastEnriched timestamps across the next 24h so incremental
    // refresh cycles evenly rather than refreshing all stocks at once.
    const stocks = Array.from(cachedData.values());
    const now = Date.now();
    const window = 24 * 60 * 60 * 1000;
    stocks.forEach((entry, i) => {
      if (!entry.lastEnriched) {
        entry.lastEnriched = now - window + (i / stocks.length) * window;
      }
    });
    state.cache = cachedData;
    state.ready = true;
    state.lastRefreshed = new Date().toISOString();
    return;
  }

  console.log('[universe] Starting cache build...');
  try {
    // FMP screener caps at 1000 per request — paginate by market cap tiers
    const baseParams = {
      country: 'US',
      isEtf: false,
      isFund: false,
      isActivelyTrading: true,
      limit: 1000,
    };

    const tiers = [
      { marketCapMoreThan: 10_000_000_000 },                                          // large cap ($10B+)
      { marketCapMoreThan: 2_000_000_000, marketCapLowerThan: 10_000_000_000 },        // mid cap ($2B–$10B)
      { marketCapMoreThan: 500_000_000,   marketCapLowerThan: 2_000_000_000 },         // small cap ($500M–$2B)
      { marketCapMoreThan: 100_000_000,   marketCapLowerThan: 500_000_000 },           // micro cap ($100M–$500M)
      { marketCapMoreThan: 50_000_000,    marketCapLowerThan: 100_000_000 },           // nano cap ($50M–$100M)
      { marketCapMoreThan: 10_000_000,    marketCapLowerThan: 50_000_000 },            // nano cap ($10M–$50M)
    ];

    const allResults = [];
    for (const tier of tiers) {
      const results = await fmp.getScreener({ ...baseParams, ...tier });
      console.log(`[universe] Screener tier $${(tier.marketCapMoreThan / 1e9).toFixed(1)}B+: ${results.length} results`);
      allResults.push(...results);
    }

    // Dedupe by symbol, exclude ETFs/funds
    const seen = new Set();
    const filtered = allResults.filter(s => {
      if (!s.symbol || s.isEtf || s.isFund || seen.has(s.symbol)) return false;
      seen.add(s.symbol);
      return true;
    });

    console.log(`[universe] ${filtered.length} stocks to process. Fetching metrics...`);

    const buildStart = Date.now();
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

        // Make server usable early — mark ready once we have 100+ enriched stocks
        if (!state.ready && newCache.size >= 100) {
          state.cache = newCache;
          state.ready = true;
          state.lastRefreshed = new Date().toISOString();
          console.log(`[universe] Early ready: ${newCache.size} stocks available while build continues`);
        }

        if (newCache.size % 100 === 0 || newCache.size === 1) {
          const elapsed = ((Date.now() - buildStart) / 1000 / 60).toFixed(1);
          const rate = newCache.size / ((Date.now() - buildStart) / 1000 / 60) || 0;
          const remaining = rate > 0 ? ((filtered.length - newCache.size) / rate).toFixed(0) : '?';
          console.log(`[universe] Progress: ${newCache.size}/${filtered.length} stocks (${elapsed}min elapsed, ~${remaining}min remaining)`);
        }

        // Save to Redis + local file every 500 stocks so progress survives restarts
        if (newCache.size % 500 === 0) {
          state.cache = newCache;
          await saveCacheToRedis(newCache);
          saveLocalCache(newCache);
          console.log(`[universe] Checkpoint saved: ${newCache.size} stocks`);
        }
      } catch (err) {
        console.warn(`[universe] Skipped ${s.symbol}: ${err.message}`);
        newCache.delete(s.symbol);
      }
    }

    state.cache = newCache;
    state.ready = true;
    state.lastRefreshed = new Date().toISOString();
    const totalMin = ((Date.now() - buildStart) / 1000 / 60).toFixed(1);
    console.log(`[universe] ✓ Cache ready: ${newCache.size} stocks in ${totalMin} minutes`);
    await saveCacheToRedis(newCache);
    saveLocalCache(newCache);
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

  state.lastIncrementalRefresh = new Date().toISOString();
  await saveCacheToRedis(state.cache);
  saveLocalCache(state.cache);
}

function startCache() {
  buildCache();
  setInterval(refreshStalest, INCREMENTAL_INTERVAL_MS);
}

module.exports = { startCache, buildCache, getCache, isReady, getStatus, saveCacheToRedis, loadCacheFromRedis };
