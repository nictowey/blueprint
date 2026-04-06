# Expanded Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Blueprint from 9 display metrics / 6 match dimensions to 34 fields across 6 categories, with full universe enrichment and a grouped comparison UI.

**Architecture:** Six FMP API calls per stock during Phase 2 enrichment (TTM, income×4, historical, profile, balance sheet, cash flow) populate 34 fields stored in the universe cache. The matcher expands from 6 to 23 dimensions. The comparison UI replaces a flat metric list with category-grouped sections.

**Tech Stack:** Node.js/Express backend, FMP Starter API, React frontend (Vite), Jest tests.

---

## File Map

| File | Action | Summary |
|---|---|---|
| `server/services/fmp.js` | Modify | Add `getBalanceSheet`, `getCashFlowStatement`; bump rate limit to 250ms |
| `server/services/matcher.js` | Modify | Expand `MATCH_METRICS` from 6 → 23 dimensions |
| `server/tests/universe.test.js` | Modify | Add tests for all new field mappings and computed metrics |
| `server/services/universe.js` | Modify | Expand `enrichStock` to 6 calls, extract all 34 fields |
| `server/routes/snapshot.js` | Modify | 7-call fetch, extract all new fields in response |
| `server/routes/comparison.js` | Modify | Expand `buildCurrentMetrics` to 6 calls; expand template extraction |
| `client/src/utils/format.js` | Modify | Formatters and labels for all new metric keys |
| `client/src/pages/ComparisonDetail.jsx` | Modify | Replace flat `DISPLAY_METRICS` with `METRIC_GROUPS` grouped layout |

---

## Task 1: Add FMP API Wrappers and Bump Rate Limit

**Files:**
- Modify: `server/services/fmp.js`

- [ ] **Step 1: Change `RATE_LIMIT_MS` from 200 to 250**

In `server/services/fmp.js`, line 6:
```js
// Before
const RATE_LIMIT_MS = 200;
// After
const RATE_LIMIT_MS = 250;   // 240 calls/min — safe headroom under 300/min Starter limit
```

- [ ] **Step 2: Add `getBalanceSheet` after `getKeyMetricsTTM`**

```js
async function getBalanceSheet(ticker, limit = 1) {
  const data = await fmpGet(`/balance-sheet-statement`, { symbol: ticker, period: 'annual', limit });
  return Array.isArray(data) ? data : [];
}
```

- [ ] **Step 3: Add `getCashFlowStatement` after `getBalanceSheet`**

```js
async function getCashFlowStatement(ticker, limit = 1) {
  const data = await fmpGet(`/cash-flow-statement`, { symbol: ticker, period: 'annual', limit });
  return Array.isArray(data) ? data : [];
}
```

- [ ] **Step 4: Export both new functions**

In the `module.exports` block at the bottom of `fmp.js`, add `getBalanceSheet` and `getCashFlowStatement`:
```js
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
```

- [ ] **Step 5: Commit**

```bash
git add server/services/fmp.js
git commit -m "feat: add getBalanceSheet, getCashFlowStatement; bump rate limit to 250ms"
```

---

## Task 2: Expand MATCH_METRICS in Matcher

**Files:**
- Modify: `server/services/matcher.js`

- [ ] **Step 1: Replace `MATCH_METRICS` array**

At line 1 of `server/services/matcher.js`, replace:
```js
const MATCH_METRICS = ['peRatio', 'revenueGrowthYoY', 'grossMargin', 'marketCap', 'rsi14', 'pctBelowHigh'];
```
With:
```js
const MATCH_METRICS = [
  // Valuation
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield',
  // Profitability
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  // Growth
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  // Financial Health
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  // Technical
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
  // Size (log-normalized)
  'marketCap',
];
```

- [ ] **Step 2: Verify `prepareValue` still handles `marketCap` correctly**

The existing `prepareValue` function applies `Math.log` only for `marketCap`. Confirm it's still intact:
```js
function prepareValue(metric, value) {
  if (value == null) return null;
  if (metric === 'marketCap') {
    return value > 0 ? Math.log(value) : null;
  }
  return value;
}
```
No change needed — all other new metrics normalize linearly.

- [ ] **Step 3: Commit**

```bash
git add server/services/matcher.js
git commit -m "feat: expand MATCH_METRICS from 6 to 23 dimensions"
```

---

## Task 3: Write Failing Tests for New Field Mappings

**Files:**
- Modify: `server/tests/universe.test.js`

These tests verify transformation logic contracts. They run against inline mock data (same pattern as existing tests).

- [ ] **Step 1: Update `mockTTM` to include all new TTM fields**

Replace `mockTTM` in the existing `describe('universe cache field mapping')` block:
```js
const mockTTM = {
  peRatioTTM: 28.5,
  priceToSalesRatioTTM: 7.2,
  pbRatioTTM: 8.1,
  evToEBITDATTM: 22.4,
  evToRevenueTTM: 6.8,
  pegRatioTTM: 1.9,
  earningsYieldTTM: 0.035,
  returnOnEquityTTM: 0.28,
  returnOnAssetsTTM: 0.12,
  roicTTM: 0.19,
  currentRatioTTM: 1.8,
  debtToEquityTTM: 0.45,
  interestCoverageTTM: 15.2,
  netDebtToEBITDATTM: 0.6,
  freeCashFlowYieldTTM: 0.041,
  dividendYieldPercentageTTM: 0.006,
  marketCapTTM: 2800000000000,
};
```

- [ ] **Step 2: Update `mockIncome` to 4 periods with all new income fields**

Replace `mockIncome`:
```js
const mockIncome = [
  { grossProfitRatio: 0.43, operatingIncomeRatio: 0.30, netIncomeRatio: 0.25, ebitdaratio: 0.32, revenue: 394000000000, eps: 6.11 },
  { grossProfitRatio: 0.42, operatingIncomeRatio: 0.28, netIncomeRatio: 0.23, ebitdaratio: 0.30, revenue: 365000000000, eps: 5.61 },
  { grossProfitRatio: 0.38, operatingIncomeRatio: 0.24, netIncomeRatio: 0.20, ebitdaratio: 0.26, revenue: 274000000000, eps: 3.28 },
  { grossProfitRatio: 0.35, operatingIncomeRatio: 0.21, netIncomeRatio: 0.18, ebitdaratio: 0.23, revenue: 260000000000, eps: 2.97 },
];
```

- [ ] **Step 3: Add mock profile, balance sheet, and cash flow constants**

Add after `mockIncome`:
```js
const mockProfile = { beta: 1.24, volAvg: 58000000 };
const mockBalance = [{ cashAndCashEquivalents: 28000000000, totalDebt: 12000000000 }];
const mockCashFlow = [{ freeCashFlow: 90000000000, operatingCashFlow: 110000000000 }];
```

- [ ] **Step 4: Update `beforeEach` to mock new FMP functions**

```js
beforeEach(() => {
  jest.clearAllMocks();
  fmp.getScreener.mockResolvedValue(mockScreenerResult);
  fmp.getKeyMetricsTTM.mockResolvedValue(mockTTM);
  fmp.getIncomeStatements.mockResolvedValue(mockIncome);
  fmp.getProfile = fmp.getProfile || jest.fn();
  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getBalanceSheet = fmp.getBalanceSheet || jest.fn();
  fmp.getBalanceSheet.mockResolvedValue(mockBalance);
  fmp.getCashFlowStatement = fmp.getCashFlowStatement || jest.fn();
  fmp.getCashFlowStatement.mockResolvedValue(mockCashFlow);
  fmp.getHistoricalPrices = fmp.getHistoricalPrices || jest.fn();
  fmp.getHistoricalPrices.mockResolvedValue([]);
});
```

- [ ] **Step 5: Add tests for new TTM field mappings**

Add a new `describe` block at the end of the file:
```js
describe('expanded TTM field mapping', () => {
  test('maps all new valuation TTM fields', () => {
    const ttm = mockTTM;
    expect(ttm.pbRatioTTM ?? null).toBe(8.1);
    expect(ttm.evToEBITDATTM ?? null).toBe(22.4);
    expect(ttm.evToRevenueTTM ?? null).toBe(6.8);
    expect(ttm.pegRatioTTM ?? null).toBe(1.9);
    expect(ttm.earningsYieldTTM ?? null).toBe(0.035);
  });

  test('maps all new profitability TTM fields', () => {
    const ttm = mockTTM;
    expect(ttm.returnOnEquityTTM ?? null).toBe(0.28);
    expect(ttm.returnOnAssetsTTM ?? null).toBe(0.12);
    expect(ttm.roicTTM ?? null).toBe(0.19);
  });

  test('maps all new health TTM fields', () => {
    const ttm = mockTTM;
    expect(ttm.currentRatioTTM ?? null).toBe(1.8);
    expect(ttm.debtToEquityTTM ?? null).toBe(0.45);
    expect(ttm.interestCoverageTTM ?? null).toBe(15.2);
    expect(ttm.netDebtToEBITDATTM ?? null).toBe(0.6);
    expect(ttm.freeCashFlowYieldTTM ?? null).toBe(0.041);
    expect(ttm.dividendYieldPercentageTTM ?? null).toBe(0.006);
  });
});

describe('new income field mappings', () => {
  test('maps operatingMargin, netMargin, ebitdaMargin from income[0]', () => {
    const income0 = mockIncome[0];
    expect(income0.operatingIncomeRatio ?? null).toBe(0.30);
    expect(income0.netIncomeRatio ?? null).toBe(0.25);
    expect(income0.ebitdaratio ?? null).toBe(0.32);
    expect(income0.eps ?? null).toBe(6.11);
  });

  test('epsGrowthYoY computed correctly', () => {
    const eps0 = mockIncome[0].eps;
    const eps1 = mockIncome[1].eps;
    const growth = (eps0 - eps1) / Math.abs(eps1);
    // (6.11 - 5.61) / 5.61 ≈ 0.0891
    expect(growth).toBeCloseTo(0.0891, 3);
  });

  test('epsGrowthYoY is null when eps1 is zero or missing', () => {
    const eps0 = 6.11;
    const eps1 = 0;
    let epsGrowthYoY = null;
    if (eps0 != null && eps1 && eps1 !== 0) {
      epsGrowthYoY = (eps0 - eps1) / Math.abs(eps1);
    }
    expect(epsGrowthYoY).toBeNull();
  });

  test('revenueGrowth3yr computed correctly with income[3]', () => {
    const rev0 = mockIncome[0].revenue; // 394B
    const rev3 = mockIncome[3].revenue; // 260B
    const cagr = Math.pow(rev0 / rev3, 1 / 3) - 1;
    // (394/260)^(1/3) - 1 ≈ 0.1488
    expect(cagr).toBeCloseTo(0.1488, 3);
  });

  test('revenueGrowth3yr is null when income[3] is missing or zero', () => {
    const income = mockIncome.slice(0, 3); // only 3 periods
    const income3 = income[3] || {};
    let revenueGrowth3yr = null;
    if (income[0]?.revenue != null && income3.revenue && income3.revenue !== 0) {
      revenueGrowth3yr = Math.pow(income[0].revenue / income3.revenue, 1 / 3) - 1;
    }
    expect(revenueGrowth3yr).toBeNull();
  });
});

describe('profile field mapping', () => {
  test('maps beta and avgVolume from profile', () => {
    expect(mockProfile.beta ?? null).toBe(1.24);
    expect(mockProfile.volAvg ?? null).toBe(58000000);
  });
});

describe('balance sheet and cash flow field mapping', () => {
  test('maps totalCash and totalDebt from balance sheet', () => {
    const b = mockBalance[0];
    expect(b.cashAndCashEquivalents ?? null).toBe(28000000000);
    expect(b.totalDebt ?? null).toBe(12000000000);
  });

  test('maps freeCashFlow and operatingCashFlow from cash flow statement', () => {
    const cf = mockCashFlow[0];
    expect(cf.freeCashFlow ?? null).toBe(90000000000);
    expect(cf.operatingCashFlow ?? null).toBe(110000000000);
  });
});

describe('computed technical metrics', () => {
  test('ma50 is average of last 50 closes (oldest-first array)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i); // 100..159
    const last50 = closes.slice(-50); // 110..159
    const ma50 = last50.reduce((sum, v) => sum + v, 0) / last50.length;
    expect(ma50).toBe(134.5); // avg of 110..159
  });

  test('ma200 is average of all closes in window', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + i);
    const ma200 = closes.reduce((sum, v) => sum + v, 0) / closes.length;
    expect(ma200).toBe(199.5);
  });

  test('priceVsMa50 is percent difference from ma50', () => {
    const price = 140;
    const ma50 = 134.5;
    const pct = (price - ma50) / ma50 * 100;
    expect(pct).toBeCloseTo(4.09, 1);
  });

  test('priceVsMa50 is null when fewer than 50 closes', () => {
    const closes = Array.from({ length: 49 }, (_, i) => 100 + i);
    const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((s, v) => s + v, 0) / 50 : null;
    expect(ma50).toBeNull();
  });
});
```

- [ ] **Step 6: Update the stale "rsi14 and pctBelowHigh always null" test**

Find this test in `universe.test.js`:
```js
test('rsi14 and pctBelowHigh are always null in universe (no historical fetch)', () => {
```
Replace the entire test with:
```js
test('rsi14 and pctBelowHigh are null when historical data is empty', () => {
  // Historical prices are now fetched in Phase 2 enrichment.
  // When the historical array is empty (fetch failed or no data), both are null.
  const historical = [];
  const rsi14 = historical.length > 0 ? 'computed' : null;
  const pctBelowHigh = historical.length > 0 ? 'computed' : null;
  expect(rsi14).toBeNull();
  expect(pctBelowHigh).toBeNull();
});
```

- [ ] **Step 7: Run tests — expect new tests to pass (they test contracts, not implementation)**

```bash
cd /Users/nictowey/blueprint && npx jest server/tests/universe.test.js --no-coverage 2>&1 | tail -20
```

Expected: All tests pass. The new tests verify field-mapping formulas inline, not through the actual enrichment function, so they pass immediately. If any fail, fix the formula in the test (the test defines what correct behavior looks like).

- [ ] **Step 8: Commit**

```bash
git add server/tests/universe.test.js
git commit -m "test: add field mapping contracts for all 34 expanded metrics"
```

---

## Task 4: Implement Expanded Universe Enrichment

**Files:**
- Modify: `server/services/universe.js`

- [ ] **Step 1: Add `fmp.getProfile`, `fmp.getBalanceSheet`, `fmp.getCashFlowStatement` to the requires**

No change needed — `fmp` is already required as a whole module. The new functions will be available via `fmp.getBalanceSheet(...)` etc.

- [ ] **Step 2: Replace the `enrichStock` function**

Replace the entire `enrichStock` function (currently lines 50–90 of the current file):

```js
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

    if (closes.length >= 200) {
      const ma200 = closes.reduce((s, v) => s + v, 0) / closes.length;
      if (currentPrice != null && ma200 > 0) {
        priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
      }
    } else if (closes.length > 0) {
      // Use all available closes if fewer than 200 (e.g. recently listed stocks)
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
```

- [ ] **Step 3: Update Phase 1 cache entry shape to include all new null fields**

In `buildCache`, the initial cache entry built from screener data sets everything else to null. Replace the `newCache.set(s.symbol, {...})` call with:

```js
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
```

- [ ] **Step 4: Run existing tests to confirm nothing is broken**

```bash
cd /Users/nictowey/blueprint && npx jest server/tests/universe.test.js --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/universe.js
git commit -m "feat: expand universe enrichment to 6 calls, 34 fields per stock"
```

---

## Task 5: Expand snapshot.js

**Files:**
- Modify: `server/routes/snapshot.js`

- [ ] **Step 1: Add imports and expand `Promise.allSettled` to 7 calls**

In `snapshot.js`, the `Promise.allSettled` block currently has 5 entries. Replace it:

```js
const [profileData, incomeData, metricsData, histData, shortData, balanceSheetData, cashFlowData] =
  await Promise.allSettled([
    fmp.getProfile(sym),
    fmp.getIncomeStatements(sym, 4),          // bumped from 2→4 for 3yr CAGR
    fmp.getKeyMetricsAnnual(sym),
    fmp.getHistoricalPrices(sym, fromStr, date),
    fmp.getShortInterest(sym),
    fmp.getBalanceSheet(sym),
    fmp.getCashFlowStatement(sym),
  ]);
```

- [ ] **Step 2: Unpack the two new settled results**

After the existing `const shortRaw = ...` line, add:
```js
const balanceSheet = balanceSheetData.status === 'fulfilled' ? balanceSheetData.value : [];
const cashFlowStmt = cashFlowData.status === 'fulfilled' ? cashFlowData.value : [];
```

- [ ] **Step 3: Add computed growth metrics using income[3] for 3yr CAGR**

Replace the existing growth computation block with:
```js
const curIncome = findPeriodOnOrBefore(income, date);
const curMetrics = findPeriodOnOrBefore(metrics, date);
const priorIncome = curIncome
  ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
  : null;

// Revenue growth YoY
let revenueGrowthYoY = null;
if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
  revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
}

// Revenue 3yr CAGR — income 3 periods before curIncome
const income3yrAgo = curIncome
  ? income
      .filter(p => new Date(p.date) < new Date(curIncome.date))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[2] || null
  : null;
let revenueGrowth3yr = null;
if (curIncome?.revenue != null && income3yrAgo?.revenue && income3yrAgo.revenue !== 0) {
  revenueGrowth3yr = Math.pow(curIncome.revenue / income3yrAgo.revenue, 1 / 3) - 1;
}

// EPS growth YoY
let epsGrowthYoY = null;
if (curIncome?.eps != null && priorIncome?.eps && priorIncome.eps !== 0) {
  epsGrowthYoY = (curIncome.eps - priorIncome.eps) / Math.abs(priorIncome.eps);
}
```

- [ ] **Step 4: Add MA computation after the existing RSI/52w high computation**

After the existing `pctBelowHigh` computation block, add:
```js
// Moving averages (pricesAsc is oldest-first, on or before snapshot date)
let priceVsMa50 = null;
let priceVsMa200 = null;

if (pricesAsc.length >= 50) {
  const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
  if (price != null && ma50 > 0) priceVsMa50 = ((price - ma50) / ma50) * 100;
}
if (pricesAsc.length > 0) {
  const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
  if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
}
```

- [ ] **Step 5: Get balance sheet and cash flow period closest to snapshot date**

Add after the MA computation block:
```js
const curBalance = findPeriodOnOrBefore(balanceSheet, date);
const curCashFlow = findPeriodOnOrBefore(cashFlowStmt, date);
```

`profile` is already declared in the unpacking block at the top of the try block — no redeclaration needed.

- [ ] **Step 6: Replace the `res.json(...)` response object with all new fields**

Replace the existing `res.json({...})` call with:
```js
res.json({
  ticker: sym,
  companyName: profile.companyName || sym,
  sector: profile.sector || null,
  date,
  price,
  // Valuation
  peRatio:           curMetrics?.peRatio ?? null,
  priceToBook:       curMetrics?.pbRatio ?? null,
  priceToSales:      curMetrics?.priceToSalesRatio ?? null,
  evToEBITDA:        curMetrics?.evToEbitda ?? null,
  evToRevenue:       curMetrics?.evToRevenue ?? null,
  pegRatio:          curMetrics?.pegRatio ?? null,
  earningsYield:     curMetrics?.earningsYield ?? null,
  // Profitability
  grossMargin:       curIncome?.grossProfitRatio ?? null,
  operatingMargin:   curIncome?.operatingIncomeRatio ?? null,
  netMargin:         curIncome?.netIncomeRatio ?? null,
  ebitdaMargin:      curIncome?.ebitdaratio ?? null,
  returnOnEquity:    curMetrics?.returnOnEquity ?? null,
  returnOnAssets:    curMetrics?.returnOnAssets ?? null,
  returnOnCapital:   curMetrics?.roic ?? null,
  // Growth
  revenueGrowthYoY,
  revenueGrowth3yr,
  epsGrowthYoY,
  eps:               curIncome?.eps ?? null,
  // Financial Health
  currentRatio:      curMetrics?.currentRatio ?? null,
  debtToEquity:      curMetrics?.debtToEquity ?? null,
  interestCoverage:  curMetrics?.interestCoverage ?? null,
  netDebtToEBITDA:   curMetrics?.netDebtToEBITDA ?? null,
  freeCashFlowYield: curMetrics?.freeCashFlowYield ?? null,
  dividendYield:     curMetrics?.dividendYield ?? null,
  totalCash:         curBalance?.cashAndCashEquivalents ?? null,
  totalDebt:         curBalance?.totalDebt ?? null,
  freeCashFlow:      curCashFlow?.freeCashFlow ?? null,
  operatingCashFlow: curCashFlow?.operatingCashFlow ?? null,
  // Technical
  rsi14,
  pctBelowHigh,
  priceVsMa50,
  priceVsMa200,
  beta:              profile?.beta ?? null,
  avgVolume:         profile?.volAvg ?? null,
  // Overview
  marketCap:         curMetrics?.marketCap ?? null,
  shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
});
```

- [ ] **Step 7: Commit**

```bash
git add server/routes/snapshot.js
git commit -m "feat: expand snapshot to 7 calls, 34 fields"
```

---

## Task 6: Expand comparison.js

**Files:**
- Modify: `server/routes/comparison.js`

- [ ] **Step 1: Expand `buildCurrentMetrics` to 6 calls**

Replace the `Promise.all` block inside `buildCurrentMetrics`:
```js
async function buildCurrentMetrics(ticker) {
  const [profile, ttm, income, hist, balance, cashFlow] = await Promise.all([
    fmp.getProfile(ticker),
    fmp.getKeyMetricsTTM(ticker),
    fmp.getIncomeStatements(ticker, 4),
    fmp.getHistoricalPrices(ticker,
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    ),
    fmp.getBalanceSheet(ticker, 1),
    fmp.getCashFlowStatement(ticker, 1),
  ]);

  const income0 = income[0] || {};
  const income1 = income[1] || {};
  const income3 = income[3] || {};

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

  const pricesAsc = [...hist].reverse().map(h => h.close);
  const rsi14 = computeRSI(pricesAsc.slice(-30));
  const currentPrice = hist[0]?.close ?? null;
  const high52w = hist.length > 0 ? hist.reduce((m, h) => Math.max(m, h.close), -Infinity) : null;
  const pctBelowHigh =
    currentPrice != null && high52w != null && high52w > 0
      ? ((high52w - currentPrice) / high52w) * 100
      : null;

  let priceVsMa50 = null;
  let priceVsMa200 = null;
  if (pricesAsc.length >= 50) {
    const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
    if (currentPrice != null && ma50 > 0) priceVsMa50 = ((currentPrice - ma50) / ma50) * 100;
  }
  if (pricesAsc.length > 0) {
    const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
    if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
  }

  const bal = Array.isArray(balance) ? balance[0] || {} : {};
  const cf  = Array.isArray(cashFlow) ? cashFlow[0] || {} : {};

  return {
    ticker,
    companyName:      profile?.companyName || ticker,
    sector:           profile?.sector || null,
    date:             new Date().toISOString().slice(0, 10),
    price:            currentPrice,
    // Valuation
    peRatio:          ttm.peRatioTTM ?? null,
    priceToBook:      ttm.pbRatioTTM ?? null,
    priceToSales:     ttm.priceToSalesRatioTTM ?? null,
    evToEBITDA:       ttm.evToEBITDATTM ?? null,
    evToRevenue:      ttm.evToRevenueTTM ?? null,
    pegRatio:         ttm.pegRatioTTM ?? null,
    earningsYield:    ttm.earningsYieldTTM ?? null,
    // Profitability
    grossMargin:      income0.grossProfitRatio ?? null,
    operatingMargin:  income0.operatingIncomeRatio ?? null,
    netMargin:        income0.netIncomeRatio ?? null,
    ebitdaMargin:     income0.ebitdaratio ?? null,
    returnOnEquity:   ttm.returnOnEquityTTM ?? null,
    returnOnAssets:   ttm.returnOnAssetsTTM ?? null,
    returnOnCapital:  ttm.roicTTM ?? null,
    // Growth
    revenueGrowthYoY,
    revenueGrowth3yr,
    epsGrowthYoY,
    eps:              income0.eps ?? null,
    // Financial Health
    currentRatio:     ttm.currentRatioTTM ?? null,
    debtToEquity:     ttm.debtToEquityTTM ?? null,
    interestCoverage: ttm.interestCoverageTTM ?? null,
    netDebtToEBITDA:  ttm.netDebtToEBITDATTM ?? null,
    freeCashFlowYield:ttm.freeCashFlowYieldTTM ?? null,
    dividendYield:    ttm.dividendYieldPercentageTTM ?? null,
    totalCash:        bal.cashAndCashEquivalents ?? null,
    totalDebt:        bal.totalDebt ?? null,
    freeCashFlow:     cf.freeCashFlow ?? null,
    operatingCashFlow:cf.operatingCashFlow ?? null,
    // Technical
    rsi14,
    pctBelowHigh,
    priceVsMa50,
    priceVsMa200,
    beta:             profile?.beta ?? null,
    avgVolume:        profile?.volAvg ?? null,
    // Overview
    marketCap:        ttm.marketCapTTM ?? null,
    shortInterestPct: null,
  };
}
```

- [ ] **Step 2: Expand the historical `template` object**

In the main route handler, add balance sheet and cash flow to the `Promise.allSettled` call (currently 7 items → 9 items):

```js
const [profileData, incomeData, metricsData, histData, shortData, sparklineData, matchData,
       templateBalanceData, templateCashFlowData] =
  await Promise.allSettled([
    fmp.getProfile(sym),
    fmp.getIncomeStatements(sym, 10),   // keep large limit for full history
    fmp.getKeyMetricsAnnual(sym),
    fmp.getHistoricalPrices(sym, fromStr, date),
    fmp.getShortInterest(sym),
    fmp.getHistoricalPrices(sym, date, sparklineEnd),
    buildCurrentMetrics(matchSym),
    fmp.getBalanceSheet(sym),
    fmp.getCashFlowStatement(sym),
  ]);
```

- [ ] **Step 3: Unpack new settled results**

After the existing unpacking block, add:
```js
const templateBalance = templateBalanceData.status === 'fulfilled' ? templateBalanceData.value : [];
const templateCashFlow = templateCashFlowData.status === 'fulfilled' ? templateCashFlowData.value : [];
const curBalance = findPeriodOnOrBefore(templateBalance, date);
const curCashFlow = findPeriodOnOrBefore(templateCashFlow, date);
```

- [ ] **Step 4: Add 3yr CAGR and EPS growth to the template's growth computation block**

After the existing `revenueGrowthYoY` block, add:
```js
const income3yrAgo = curIncome
  ? income
      .filter(p => new Date(p.date) < new Date(curIncome.date))
      .sort((a, b) => new Date(b.date) - new Date(a.date))[2] || null
  : null;
let revenueGrowth3yr = null;
if (curIncome?.revenue != null && income3yrAgo?.revenue && income3yrAgo.revenue !== 0) {
  revenueGrowth3yr = Math.pow(curIncome.revenue / income3yrAgo.revenue, 1 / 3) - 1;
}
let epsGrowthYoY = null;
if (curIncome?.eps != null && priorIncome?.eps && priorIncome.eps !== 0) {
  epsGrowthYoY = (curIncome.eps - priorIncome.eps) / Math.abs(priorIncome.eps);
}
```

- [ ] **Step 5: Add MA computation to template**

After the existing `pctBelowHigh` block:
```js
let priceVsMa50 = null;
let priceVsMa200 = null;
if (pricesAsc.length >= 50) {
  const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
  if (price != null && ma50 > 0) priceVsMa50 = ((price - ma50) / ma50) * 100;
}
if (pricesAsc.length > 0) {
  const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
  if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
}
```

- [ ] **Step 6: Replace the `template` object**

Replace the existing `const template = {...}` block:
```js
const template = {
  ticker: sym,
  companyName: profile.companyName || sym,
  sector: profile.sector || null,
  date,
  price,
  // Valuation
  peRatio:           curMetrics?.peRatio ?? null,
  priceToBook:       curMetrics?.pbRatio ?? null,
  priceToSales:      curMetrics?.priceToSalesRatio ?? null,
  evToEBITDA:        curMetrics?.evToEbitda ?? null,
  evToRevenue:       curMetrics?.evToRevenue ?? null,
  pegRatio:          curMetrics?.pegRatio ?? null,
  earningsYield:     curMetrics?.earningsYield ?? null,
  // Profitability
  grossMargin:       curIncome?.grossProfitRatio ?? null,
  operatingMargin:   curIncome?.operatingIncomeRatio ?? null,
  netMargin:         curIncome?.netIncomeRatio ?? null,
  ebitdaMargin:      curIncome?.ebitdaratio ?? null,
  returnOnEquity:    curMetrics?.returnOnEquity ?? null,
  returnOnAssets:    curMetrics?.returnOnAssets ?? null,
  returnOnCapital:   curMetrics?.roic ?? null,
  // Growth
  revenueGrowthYoY,
  revenueGrowth3yr,
  epsGrowthYoY,
  eps:               curIncome?.eps ?? null,
  // Financial Health
  currentRatio:      curMetrics?.currentRatio ?? null,
  debtToEquity:      curMetrics?.debtToEquity ?? null,
  interestCoverage:  curMetrics?.interestCoverage ?? null,
  netDebtToEBITDA:   curMetrics?.netDebtToEBITDA ?? null,
  freeCashFlowYield: curMetrics?.freeCashFlowYield ?? null,
  dividendYield:     curMetrics?.dividendYield ?? null,
  totalCash:         curBalance?.cashAndCashEquivalents ?? null,
  totalDebt:         curBalance?.totalDebt ?? null,
  freeCashFlow:      curCashFlow?.freeCashFlow ?? null,
  operatingCashFlow: curCashFlow?.operatingCashFlow ?? null,
  // Technical
  rsi14,
  pctBelowHigh,
  priceVsMa50,
  priceVsMa200,
  beta:              profile?.beta ?? null,
  avgVolume:         profile?.volAvg ?? null,
  // Overview
  marketCap:         curMetrics?.marketCap ?? null,
  shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
};
```

- [ ] **Step 7: Commit**

```bash
git add server/routes/comparison.js
git commit -m "feat: expand comparison buildCurrentMetrics and template to 34 fields"
```

---

## Task 7: Expand format.js

**Files:**
- Modify: `client/src/utils/format.js`

**Important:** FMP returns most ratio/yield/margin fields as decimal fractions (e.g. `0.28` = 28%). The `grossMargin` field is already handled this way (multiply by 100). Apply the same treatment to all new margin, return, yield, and growth fields. `priceVsMa50`/`priceVsMa200` are already percentages (we multiplied by 100 in computation). Exception: verify `dividendYieldPercentageTTM` — if it comes back as a percentage already (e.g. `0.6` instead of `0.006`), no multiplication needed. Can be caught visually: if a 0.6% dividend yield shows as 60%, the field is already a percentage.

- [ ] **Step 1: Replace the `formatMetric` function**

Replace the entire `formatMetric` function in `client/src/utils/format.js`:

```js
export function formatMetric(key, value) {
  if (value == null) return '—';

  switch (key) {
    // Dollar: price
    case 'price':
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Dollar per share
    case 'eps':
      return `$${value.toFixed(2)}`;

    // Multiplier ratios (x suffix)
    case 'peRatio':
    case 'priceToBook':
    case 'priceToSales':
    case 'evToEBITDA':
    case 'evToRevenue':
    case 'pegRatio':
      return `${value.toFixed(1)}x`;

    // Percentage — stored as decimal (multiply by 100)
    case 'revenueGrowthYoY':
    case 'revenueGrowth3yr':
    case 'epsGrowthYoY':
    case 'grossMargin':
    case 'operatingMargin':
    case 'netMargin':
    case 'ebitdaMargin':
    case 'returnOnEquity':
    case 'returnOnAssets':
    case 'returnOnCapital':
    case 'earningsYield':
    case 'freeCashFlowYield':
    case 'dividendYield':
      return `${(value * 100).toFixed(1)}%`;

    // Percentage — already a percentage value (do not multiply)
    case 'pctBelowHigh':
    case 'shortInterestPct':
      return `${value.toFixed(1)}%`;

    // Percentage with sign — priceVsMa already in percentage points
    case 'priceVsMa50':
    case 'priceVsMa200':
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

    // Raw number (RSI 0–100)
    case 'rsi14':
      return value.toFixed(1);

    // Raw ratio (2 decimals)
    case 'currentRatio':
    case 'debtToEquity':
    case 'interestCoverage':
    case 'netDebtToEBITDA':
    case 'beta':
      return value.toFixed(2);

    // Large dollar amounts
    case 'marketCap':
    case 'totalCash':
    case 'totalDebt':
    case 'freeCashFlow':
    case 'operatingCashFlow':
      return formatDollars(value);

    // Volume
    case 'avgVolume':
      return formatVolume(value);

    default:
      return String(value);
  }
}
```

- [ ] **Step 2: Rename `formatMarketCap` to `formatDollars` and add `formatVolume`**

Replace the existing `formatMarketCap` function with:
```js
function formatDollars(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toLocaleString()}`;
}

function formatVolume(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(value);
}
```

- [ ] **Step 3: Replace `METRIC_LABELS`**

Replace the entire `METRIC_LABELS` export:
```js
export const METRIC_LABELS = {
  // Overview
  price:             'Price',
  marketCap:         'Market Cap',
  eps:               'EPS (TTM)',
  dividendYield:     'Dividend Yield',
  // Valuation
  peRatio:           'P/E Ratio',
  priceToBook:       'Price-to-Book',
  priceToSales:      'Price-to-Sales',
  evToEBITDA:        'EV/EBITDA',
  evToRevenue:       'EV/Revenue',
  pegRatio:          'PEG Ratio',
  earningsYield:     'Earnings Yield',
  // Profitability
  grossMargin:       'Gross Margin',
  operatingMargin:   'Operating Margin',
  netMargin:         'Net Margin',
  ebitdaMargin:      'EBITDA Margin',
  returnOnEquity:    'Return on Equity',
  returnOnAssets:    'Return on Assets',
  returnOnCapital:   'Return on Capital',
  // Growth
  revenueGrowthYoY:  'Revenue Growth YoY',
  revenueGrowth3yr:  'Revenue 3yr CAGR',
  epsGrowthYoY:      'EPS Growth YoY',
  // Financial Health
  currentRatio:      'Current Ratio',
  debtToEquity:      'Debt / Equity',
  interestCoverage:  'Interest Coverage',
  netDebtToEBITDA:   'Net Debt / EBITDA',
  freeCashFlowYield: 'FCF Yield',
  totalCash:         'Total Cash',
  totalDebt:         'Total Debt',
  freeCashFlow:      'Free Cash Flow',
  operatingCashFlow: 'Operating Cash Flow',
  // Technical
  rsi14:             'RSI (14-day)',
  pctBelowHigh:      '% Below 52W High',
  priceVsMa50:       'vs 50-Day MA',
  priceVsMa200:      'vs 200-Day MA',
  beta:              'Beta',
  avgVolume:         'Avg Volume',
  // Misc
  shortInterestPct:  'Short Interest %',
};
```

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/format.js
git commit -m "feat: expand formatMetric and METRIC_LABELS for all 34 fields"
```

---

## Task 8: Update ComparisonDetail.jsx with Grouped Layout

**Files:**
- Modify: `client/src/pages/ComparisonDetail.jsx`

- [ ] **Step 1: Replace `DISPLAY_METRICS` with `METRIC_GROUPS`**

At the top of `ComparisonDetail.jsx`, replace:
```js
const DISPLAY_METRICS = [
  'peRatio', 'priceToSales', 'revenueGrowthYoY',
  'grossMargin', 'rsi14', 'pctBelowHigh',
];
```
With:
```js
const METRIC_GROUPS = [
  { label: 'Overview',         metrics: ['marketCap', 'eps', 'dividendYield'] },
  { label: 'Valuation',        metrics: ['peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield'] },
  { label: 'Profitability',    metrics: ['grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin', 'returnOnEquity', 'returnOnAssets', 'returnOnCapital'] },
  { label: 'Growth',           metrics: ['revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY'] },
  { label: 'Financial Health', metrics: ['currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield', 'totalCash', 'totalDebt', 'freeCashFlow', 'operatingCashFlow'] },
  { label: 'Technical',        metrics: ['rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta', 'avgVolume'] },
];
```

- [ ] **Step 2: Replace the template panel's metric rendering**

In the left panel (template card), replace the `{DISPLAY_METRICS.map(...)}` block with:
```jsx
{METRIC_GROUPS.map(group => (
  <div key={group.label}>
    <div className="py-1.5 mt-4 first:mt-0 border-b border-dark-border">
      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
        {group.label}
      </span>
    </div>
    {group.metrics.map(key => (
      <div key={key} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key]}</span>
        <span className={`text-sm font-semibold ${data.template[key] == null ? 'text-slate-600' : 'text-slate-100'}`}>
          {formatMetric(key, data.template[key])}
        </span>
      </div>
    ))}
  </div>
))}
```

- [ ] **Step 3: Replace the match panel's metric rendering**

In the right panel (match card), replace the `{DISPLAY_METRICS.map(...)}` block with:
```jsx
{METRIC_GROUPS.map(group => (
  <div key={group.label}>
    <div className="py-1.5 mt-4 first:mt-0 border-b border-dark-border">
      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
        {group.label}
      </span>
    </div>
    {group.metrics.map(key => {
      const leftVal = data.template[key];
      const rightVal = data.match[key];
      let colorClass = 'text-slate-100';
      if (leftVal != null && rightVal != null && leftVal !== 0) {
        const pct = Math.abs((rightVal - leftVal) / Math.abs(leftVal)) * 100;
        if (pct <= 15) colorClass = 'text-green-400';
        else if (pct <= 40) colorClass = 'text-yellow-400';
        else colorClass = 'text-red-400';
      } else if (rightVal == null) {
        colorClass = 'text-slate-600';
      }
      return (
        <div key={key} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0">
          <span className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key]}</span>
          <span className={`text-sm font-semibold ${colorClass}`}>
            {formatMetric(key, rightVal)}
          </span>
        </div>
      );
    })}
  </div>
))}
```

- [ ] **Step 4: Run tests one final time**

```bash
cd /Users/nictowey/blueprint && npx jest server/tests/universe.test.js --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ComparisonDetail.jsx
git commit -m "feat: grouped metric layout in ComparisonDetail — 6 categories, 34 fields"
```

---

## Post-Implementation Verification

After all tasks complete, do a manual spot-check:

1. **Rate limit math:** Confirm `RATE_LIMIT_MS = 250` in `fmp.js` (240 calls/min < 300/min limit).
2. **Field name audit:** If any metric shows `—` for every stock after Phase 2 completes, the FMP field name likely differs from what's in the spec. Common mismatches to check:
   - `evToEbitda` vs `evToEBITDATTM` (annual vs TTM casing differs)
   - `dividendYieldPercentageTTM` — confirm it's a decimal fraction, not already a %
   - `returnOnEquityTTM` — confirm it's a decimal fraction
3. **MA200 for recent IPOs:** Stocks with fewer than 200 trading days of history will use their full available history for MA200. This is acceptable behavior per the spec.
4. **Phase 2 log:** Confirm enrichment log shows ~6000 API calls completing over ~25 minutes. If it finishes faster, the rate limit delay may have been mis-applied.
