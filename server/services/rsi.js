/**
 * Compute 14-period RSI from an array of closing prices (oldest first).
 * Returns null if fewer than 15 prices are provided (need 14 periods of change).
 * Returns a number 0-100 rounded to 1 decimal place.
 */
function computeRSI(prices) {
  if (!prices || prices.length < 15) return null;

  // Use the last 15 prices (oldest-first) to compute 14 periods of change
  const window = prices.slice(-15);
  const changes = [];
  for (let i = 1; i < window.length; i++) {
    changes.push(window[i] - window[i - 1]);
  }

  let totalGain = 0;
  let totalLoss = 0;
  for (const change of changes) {
    if (change > 0) totalGain += change;
    else totalLoss += Math.abs(change);
  }

  const avgGain = totalGain / 14;
  const avgLoss = totalLoss / 14;

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Math.round(rsi * 10) / 10;
}

module.exports = { computeRSI };
