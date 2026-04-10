const WATCHLIST_KEY = 'blueprint_watchlist';

/**
 * Get the full watchlist from localStorage.
 * Each item: { ticker, companyName, addedAt, templateTicker?, templateDate?, matchScore?, sector? }
 */
export function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); } catch { return []; }
}

/**
 * Save a stock to the watchlist with match context.
 */
export function addToWatchlist({
  ticker,
  companyName,
  sector,
  matchScore,
  templateTicker,
  templateDate,
  price,
}) {
  const list = getWatchlist();
  if (list.find(item => item.ticker === ticker)) return false; // already saved
  list.push({
    ticker,
    companyName,
    sector: sector || null,
    matchScore: matchScore || null,
    templateTicker: templateTicker || null,
    templateDate: templateDate || null,
    priceAtAdd: price || null,
    addedAt: new Date().toISOString(),
  });
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  return true;
}

/**
 * Remove a stock from the watchlist.
 */
export function removeFromWatchlist(ticker) {
  const list = getWatchlist().filter(item => item.ticker !== ticker);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  return list;
}

/**
 * Check if a ticker is already on the watchlist.
 */
export function isOnWatchlist(ticker) {
  return getWatchlist().some(item => item.ticker === ticker);
}

/**
 * Clear the entire watchlist.
 */
export function clearWatchlist() {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify([]));
}
