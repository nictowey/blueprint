const { computeRSI } = require('../services/rsi');

describe('computeRSI', () => {
  test('returns null for null input', () => {
    expect(computeRSI(null)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(computeRSI([])).toBeNull();
  });

  test('returns null for fewer than 15 prices', () => {
    const prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113];
    expect(computeRSI(prices)).toBeNull(); // 14 prices, needs 15
  });

  test('returns 100 when all 14 periods are gains', () => {
    // 15 strictly increasing prices => 14 gains, 0 losses => RSI = 100
    const prices = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(computeRSI(prices)).toBe(100);
  });

  test('returns a number between 0 and 100 for mixed prices', () => {
    const prices = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
      43.61, 44.33, 44.83, 45.10, 45.15, 46.00, 46.50
    ];
    const result = computeRSI(prices);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });

  test('uses only the last 15 prices when given more', () => {
    // First half: all losses. Last 15: all gains. RSI should be 100.
    const losses = Array.from({ length: 20 }, (_, i) => 100 - i); // decreasing
    const gains = Array.from({ length: 15 }, (_, i) => 80 + i);   // increasing
    const prices = [...losses, ...gains];
    expect(computeRSI(prices)).toBe(100);
  });

  test('result is rounded to 1 decimal place', () => {
    const prices = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
      43.61, 44.33, 44.83, 45.10, 45.15, 46.00, 46.50
    ];
    const result = computeRSI(prices);
    const rounded = Math.round(result * 10) / 10;
    expect(result).toBe(rounded);
  });
});
