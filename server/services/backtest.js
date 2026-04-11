const { getHistoricalPrices } = require('./fmp');

/**
 * Calculate forward returns for a stock from a given start date.
 * Returns { ticker, startPrice, returns: { 1m, 3m, 6m, 12m } }
 * Each return period is { endDate, endPrice, returnPct } or null if data unavailable.
 */
async function getForwardReturns(ticker, startDate) {
  // Fetch prices from startDate to ~13 months later (extra buffer for trading days)
  const start = new Date(startDate);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 13);
  const endStr = end.toISOString().slice(0, 10);

  const prices = await getHistoricalPrices(ticker, startDate, endStr, false);
  if (!prices || prices.length === 0) return null;

  // Prices come newest-first from FMP; sort ascending
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));

  // Find the starting price (closest trading day on or after startDate)
  const startEntry = sorted.find(p => p.date >= startDate);
  if (!startEntry) return null;

  const startPrice = startEntry.adjClose || startEntry.close;
  if (!startPrice) return null;

  // Helper: find price closest to N months after start
  function priceAtOffset(months) {
    const target = new Date(startEntry.date);
    target.setMonth(target.getMonth() + months);
    const targetStr = target.toISOString().slice(0, 10);

    // Find the trading day closest to (but not after) the target + 5 day buffer
    const bufferDate = new Date(target);
    bufferDate.setDate(bufferDate.getDate() + 5);
    const bufferStr = bufferDate.toISOString().slice(0, 10);

    // Get entries within a reasonable window (target - 7 days to target + 5 days)
    const windowStart = new Date(target);
    windowStart.setDate(windowStart.getDate() - 7);
    const windowStartStr = windowStart.toISOString().slice(0, 10);

    const candidates = sorted.filter(p => p.date >= windowStartStr && p.date <= bufferStr);
    if (candidates.length === 0) return null;

    // Pick the one closest to target date
    let closest = candidates[0];
    let closestDist = Math.abs(new Date(candidates[0].date) - target);
    for (const c of candidates) {
      const dist = Math.abs(new Date(c.date) - target);
      if (dist < closestDist) {
        closest = c;
        closestDist = dist;
      }
    }

    const endPrice = closest.adjClose || closest.close;
    if (!endPrice) return null;

    return {
      endDate: closest.date,
      endPrice: Math.round(endPrice * 100) / 100,
      returnPct: Math.round(((endPrice - startPrice) / startPrice) * 10000) / 100, // 2 decimal %
    };
  }

  return {
    ticker,
    startDate: startEntry.date,
    startPrice: Math.round(startPrice * 100) / 100,
    returns: {
      '1m': priceAtOffset(1),
      '3m': priceAtOffset(3),
      '6m': priceAtOffset(6),
      '12m': priceAtOffset(12),
    },
  };
}

/**
 * Get benchmark (SPY) forward returns for the same period.
 */
async function getBenchmarkReturns(startDate) {
  return getForwardReturns('SPY', startDate);
}

/**
 * Run a backtest: given match results (array of { ticker, matchScore, ... }) and the
 * original match date, fetch forward returns for each match + benchmark.
 */
async function runBacktest(matches, matchDate) {
  // Fetch forward returns for all matches + benchmark in parallel (batched to avoid rate limit)
  const BATCH_SIZE = 5;
  const results = [];

  for (let i = 0; i < matches.length; i += BATCH_SIZE) {
    const batch = matches.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(m => getForwardReturns(m.ticker, matchDate))
    );

    for (let j = 0; j < batch.length; j++) {
      const match = batch[j];
      const result = batchResults[j];
      if (result.status === 'fulfilled' && result.value) {
        results.push({
          ticker: match.ticker,
          companyName: match.companyName,
          sector: match.sector,
          matchScore: match.matchScore,
          ...result.value,
        });
      } else {
        results.push({
          ticker: match.ticker,
          companyName: match.companyName,
          sector: match.sector,
          matchScore: match.matchScore,
          startDate: matchDate,
          startPrice: null,
          returns: { '1m': null, '3m': null, '6m': null, '12m': null },
          error: 'Price data unavailable',
        });
      }
    }
  }

  // Benchmark
  const benchmark = await getBenchmarkReturns(matchDate).catch(() => null);

  // Summary statistics
  const summary = computeSummary(results, benchmark);

  return { matchDate, results, benchmark, summary };
}

/**
 * Compute summary stats across all match results.
 */
function computeSummary(results, benchmark) {
  const periods = ['1m', '3m', '6m', '12m'];
  const summary = {};

  for (const period of periods) {
    const returns = results
      .map(r => r.returns?.[period]?.returnPct)
      .filter(r => r != null);

    if (returns.length === 0) {
      summary[period] = null;
      continue;
    }

    const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
    const winners = returns.filter(r => r > 0).length;
    const sorted = [...returns].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const benchReturn = benchmark?.returns?.[period]?.returnPct ?? null;

    summary[period] = {
      avgReturn: Math.round(avg * 100) / 100,
      medianReturn: Math.round(median * 100) / 100,
      winRate: Math.round((winners / returns.length) * 100),
      totalStocks: returns.length,
      bestReturn: Math.round(Math.max(...returns) * 100) / 100,
      worstReturn: Math.round(Math.min(...returns) * 100) / 100,
      benchmarkReturn: benchReturn,
      avgVsBenchmark: benchReturn != null ? Math.round((avg - benchReturn) * 100) / 100 : null,
    };
  }

  return summary;
}

module.exports = { runBacktest, getForwardReturns, getBenchmarkReturns };
