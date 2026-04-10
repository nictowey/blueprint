/**
 * Compute 14-period RSI using Wilder's smoothing method (exponential moving average).
 *
 * Wilder's smoothing is the industry-standard RSI calculation used by TradingView,
 * Bloomberg, and most professional charting platforms. It requires at least 28 prices
 * (27 changes) for a stable reading, but will fall back to the simple average method
 * with fewer data points.
 *
 * @param {number[]} prices - Array of closing prices, oldest first
 * @returns {number|null} RSI value 0-100 (1 decimal), or null if insufficient data
 */
function computeRSI(prices) {
  if (!prices || prices.length < 15) return null;

  const period = 14;

  // Compute all daily changes
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  if (changes.length < period) return null;

  // ── Step 1: Seed the initial average using the first `period` changes (SMA) ──
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // ── Step 2: Apply Wilder's smoothing for all subsequent changes ──
  // Formula: avgGain = (prevAvgGain × 13 + currentGain) / 14
  // This is an exponential moving average with smoothing factor 1/period
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  // ── Step 3: Compute RS and RSI ──
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Math.round(rsi * 10) / 10;
}

module.exports = { computeRSI };
