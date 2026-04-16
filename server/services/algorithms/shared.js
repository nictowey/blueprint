/**
 * Shared helpers used across algorithm engines.
 *
 * Kept in a standalone module (rather than algorithms/index.js) to avoid
 * circular requires: individual engine modules import from here, and
 * algorithms/index.js imports the engines — if shared helpers lived in
 * index.js, engines would see a partial export during load.
 */

// Exclude preferred shares, warrants, units, rights, stocks without
// price/marketCap, and stocks flagged stale (>14 days since last trade —
// likely delisted or halted).
const NON_INVESTABLE = /-(P[A-Z]?|WS|WT|U|UN|R|W)$|\.P$/i;

function isInvestable(stock) {
  if (!stock || !stock.ticker) return false;
  if (NON_INVESTABLE.test(stock.ticker)) return false;
  if (stock.ticker.endsWith('-UN') || (stock.ticker.endsWith('UN') && stock.ticker.length > 5)) return false;
  if (!stock.price || stock.price <= 0) return false;
  if (!stock.marketCap || stock.marketCap <= 0) return false;
  if (stock._priceStale) return false;
  return true;
}

module.exports = {
  isInvestable,
};
