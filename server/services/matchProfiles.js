/**
 * Match Profiles — predefined weight configurations for different screening strategies.
 *
 * Each profile defines:
 *   - name / description: UI display
 *   - weights: override map for METRIC_WEIGHTS (missing keys fall back to defaults)
 *   - sectorBonus: override for SECTOR_MATCH_BONUS (default 0.06)
 *   - hardFilters: optional metric thresholds applied BEFORE similarity scoring
 *     { metric, op: 'gte'|'lte'|'gt'|'lt', value }
 *
 * The default "growth_breakout" profile reproduces the original METRIC_WEIGHTS exactly.
 */

const PROFILES = {

  // ─── Default: the original Celestica-style breakout matcher ───────────────
  growth_breakout: {
    name: 'Growth Breakout',
    description: 'Find stocks in a similar high-growth, pre-breakout phase — heavy on revenue/EPS acceleration, momentum near highs, and growth-adjusted valuation.',
    weights: {
      // Tier 1 — Core breakout signals (3.0)
      revenueGrowthYoY: 3.0,
      epsGrowthYoY: 3.0,
      pegRatio: 3.0,
      operatingMargin: 3.0,
      // Tier 2 — Valuation & momentum (2.5)
      peRatio: 2.5,
      evToEBITDA: 2.5,
      pctBelowHigh: 2.5,
      priceVsMa200: 2.5,
      marketCap: 2.5,
      // Tier 3 — Quality confirmation (2.0)
      returnOnEquity: 2.0,
      revenueGrowth3yr: 2.0,
      freeCashFlowYield: 2.0,
      returnOnCapital: 2.0,
      priceVsMa50: 2.0,
      // Tier 4 — Risk guardrails (1.5)
      debtToEquity: 1.5,
      netDebtToEBITDA: 1.5,
      rsi14: 1.5,
      grossMargin: 1.5,
      // Tier 5 — Supporting context (1.0)
      beta: 1.0,
      netMargin: 1.0,
      ebitdaMargin: 1.0,
      returnOnAssets: 1.0,
      priceToBook: 1.0,
      priceToSales: 1.0,
      evToRevenue: 1.0,
      currentRatio: 1.0,
      interestCoverage: 1.0,
    },
    sectorBonus: 0.06,
    hardFilters: [],
  },

  // ─── Value Inflection: find undervalued companies with improving fundamentals ─
  value_inflection: {
    name: 'Value Inflection',
    description: 'Find undervalued companies where fundamentals are turning a corner — cheap valuations, strong cash flow, and improving margins before the market catches on.',
    weights: {
      // Valuation is king
      peRatio: 3.0,
      evToEBITDA: 3.0,
      priceToBook: 3.0,
      freeCashFlowYield: 3.0,
      pegRatio: 2.5,
      // Profitability / quality confirmation
      operatingMargin: 2.5,
      grossMargin: 2.5,
      returnOnEquity: 2.0,
      returnOnCapital: 2.0,
      debtToEquity: 2.0,
      netDebtToEBITDA: 2.0,
      // Growth matters but isn't dominant
      revenueGrowthYoY: 1.5,
      epsGrowthYoY: 1.5,
      revenueGrowth3yr: 1.5,
      // Supporting
      priceToSales: 1.5,
      evToRevenue: 1.5,
      currentRatio: 1.5,
      interestCoverage: 1.5,
      netMargin: 1.0,
      ebitdaMargin: 1.0,
      returnOnAssets: 1.0,
      marketCap: 1.0,
      // Technicals de-emphasized
      rsi14: 1.0,
      pctBelowHigh: 0.5,
      priceVsMa50: 0.5,
      priceVsMa200: 0.5,
      beta: 0.5,
    },
    sectorBonus: 0.08, // sector matters more for value comps
    hardFilters: [
      { metric: 'peRatio', op: 'gt', value: 0 },   // must be profitable
      { metric: 'peRatio', op: 'lte', value: 35 },  // not wildly expensive
    ],
  },

  // ─── Momentum / Technical: pure price-action matching ─────────────────────
  momentum_technical: {
    name: 'Momentum / Technical',
    description: 'Match based on price action and technical setup — RSI, moving average positioning, proximity to highs, and volatility profile.',
    weights: {
      // Technicals dominate
      rsi14: 3.0,
      pctBelowHigh: 3.0,
      priceVsMa50: 3.0,
      priceVsMa200: 3.0,
      beta: 2.5,
      // Market cap matters (micro-caps move differently)
      marketCap: 2.0,
      // Growth as confirmation
      revenueGrowthYoY: 2.0,
      epsGrowthYoY: 1.5,
      revenueGrowth3yr: 1.0,
      // Valuation context (light)
      peRatio: 1.5,
      evToEBITDA: 1.0,
      pegRatio: 1.0,
      priceToSales: 1.0,
      // Profitability — supporting only
      operatingMargin: 1.0,
      grossMargin: 0.5,
      netMargin: 0.5,
      ebitdaMargin: 0.5,
      returnOnEquity: 0.5,
      returnOnAssets: 0.5,
      returnOnCapital: 0.5,
      freeCashFlowYield: 0.5,
      // Balance sheet — minimal
      debtToEquity: 0.5,
      netDebtToEBITDA: 0.5,
      currentRatio: 0.5,
      interestCoverage: 0.5,
      priceToBook: 0.5,
      evToRevenue: 0.5,
    },
    sectorBonus: 0.03, // sector less relevant for momentum
    hardFilters: [],
  },

  // ─── Quality Compounder: match on durable business quality ────────────────
  quality_compounder: {
    name: 'Quality Compounder',
    description: 'Find businesses with similar quality DNA — high returns on capital, strong margins, consistent multi-year growth, and clean balance sheets.',
    weights: {
      // Quality is the center of gravity
      returnOnEquity: 3.0,
      returnOnCapital: 3.0,
      operatingMargin: 3.0,
      revenueGrowth3yr: 3.0,
      // Cash generation & balance sheet
      freeCashFlowYield: 2.5,
      grossMargin: 2.5,
      debtToEquity: 2.5,
      interestCoverage: 2.0,
      netDebtToEBITDA: 2.0,
      // Current growth confirmation
      revenueGrowthYoY: 2.0,
      epsGrowthYoY: 1.5,
      // Valuation context
      peRatio: 1.5,
      evToEBITDA: 1.5,
      pegRatio: 1.5,
      // Supporting
      returnOnAssets: 1.5,
      ebitdaMargin: 1.5,
      netMargin: 1.0,
      currentRatio: 1.0,
      marketCap: 1.0,
      priceToBook: 1.0,
      priceToSales: 1.0,
      evToRevenue: 1.0,
      // Technicals — light
      rsi14: 0.5,
      pctBelowHigh: 0.5,
      priceVsMa50: 0.5,
      priceVsMa200: 0.5,
      beta: 0.5,
    },
    sectorBonus: 0.08, // quality is very sector-relative
    hardFilters: [
      { metric: 'returnOnEquity', op: 'gte', value: 0.05 }, // at least 5% ROE
    ],
  },

  // ─── GARP: Growth at a Reasonable Price — balanced Peter Lynch style ──────
  garp: {
    name: 'GARP',
    description: 'Growth at a Reasonable Price — balanced matching that prioritizes PEG ratio, revenue growth vs. valuation multiples, and cash flow. The classic Peter Lynch approach.',
    weights: {
      // PEG is the north star
      pegRatio: 3.5,
      revenueGrowthYoY: 3.0,
      epsGrowthYoY: 2.5,
      // Valuation must be reasonable
      peRatio: 2.5,
      evToEBITDA: 2.5,
      freeCashFlowYield: 2.5,
      // Quality confirmation
      operatingMargin: 2.0,
      returnOnEquity: 2.0,
      returnOnCapital: 2.0,
      revenueGrowth3yr: 2.0,
      // Balance sheet
      debtToEquity: 1.5,
      netDebtToEBITDA: 1.5,
      grossMargin: 1.5,
      // Supporting valuation
      priceToSales: 1.0,
      evToRevenue: 1.0,
      priceToBook: 1.0,
      // Size & context
      marketCap: 1.0,
      currentRatio: 1.0,
      interestCoverage: 1.0,
      netMargin: 1.0,
      ebitdaMargin: 1.0,
      returnOnAssets: 1.0,
      // Technicals — supporting
      rsi14: 1.0,
      pctBelowHigh: 1.0,
      priceVsMa50: 1.0,
      priceVsMa200: 1.0,
      beta: 0.5,
    },
    sectorBonus: 0.06,
    hardFilters: [
      { metric: 'revenueGrowthYoY', op: 'gt', value: 0 }, // must be growing
    ],
  },
};

// Keep the list of valid profile keys exportable for validation
const PROFILE_KEYS = Object.keys(PROFILES);
const DEFAULT_PROFILE = 'growth_breakout';

/**
 * Returns the full profile object, falling back to growth_breakout.
 */
function getProfile(profileKey) {
  return PROFILES[profileKey] || PROFILES[DEFAULT_PROFILE];
}

/**
 * Returns the serializable list of profiles for the /api/profiles endpoint.
 */
function listProfiles() {
  return PROFILE_KEYS.map(key => ({
    key,
    name: PROFILES[key].name,
    description: PROFILES[key].description,
    hardFilters: PROFILES[key].hardFilters,
  }));
}

/**
 * Applies hard filters to a stock universe (Map). Returns a new Map with only
 * stocks that pass all filter conditions.
 */
function applyHardFilters(universe, filters) {
  if (!filters || filters.length === 0) return universe;

  const filtered = new Map();
  for (const [key, stock] of universe) {
    let passes = true;
    for (const { metric, op, value } of filters) {
      const v = stock[metric];
      if (v == null || !isFinite(v)) continue; // skip filter if data missing
      switch (op) {
        case 'gte': if (!(v >= value)) passes = false; break;
        case 'lte': if (!(v <= value)) passes = false; break;
        case 'gt':  if (!(v > value))  passes = false; break;
        case 'lt':  if (!(v < value))  passes = false; break;
      }
      if (!passes) break;
    }
    if (passes) filtered.set(key, stock);
  }
  return filtered;
}

module.exports = {
  PROFILES,
  PROFILE_KEYS,
  DEFAULT_PROFILE,
  getProfile,
  listProfiles,
  applyHardFilters,
};
