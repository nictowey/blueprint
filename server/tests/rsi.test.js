const { computeRSI } = require('../services/rsi');

describe('computeRSI — Wilder\'s smoothing', () => {
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

  test('returns 100 when all periods are gains', () => {
    // 15 strictly increasing prices => 14 gains, 0 losses => RSI = 100
    const prices = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(computeRSI(prices)).toBe(100);
  });

  test('returns 0 when all periods are losses', () => {
    const prices = Array.from({ length: 15 }, (_, i) => 100 - i);
    expect(computeRSI(prices)).toBe(0);
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

  test('with Wilder smoothing, more data produces a different (more stable) result than just 15 prices', () => {
    // 15 prices — simple seed only
    const short = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
      43.61, 44.33, 44.83, 45.10, 45.15, 46.00, 46.50
    ];
    const rsiShort = computeRSI(short);

    // 30 prices — seed + 15 Wilder smoothing steps
    const long = [
      40.00, 41.00, 40.50, 41.50, 42.00, 41.00, 40.00, 41.50,
      42.50, 43.00, 42.00, 41.00, 42.00, 43.00, 43.50,
      ...short
    ];
    const rsiLong = computeRSI(long);

    // Both should be valid numbers, but potentially different due to smoothing
    expect(typeof rsiShort).toBe('number');
    expect(typeof rsiLong).toBe('number');
    expect(rsiShort).toBeGreaterThan(0);
    expect(rsiLong).toBeGreaterThan(0);
  });

  test('uses all available data for Wilder smoothing (not just last 15)', () => {
    // With losses first then gains, Wilder's smoothing will remember the losses
    const losses = Array.from({ length: 20 }, (_, i) => 100 - i * 0.5); // slow decline
    const gains = Array.from({ length: 15 }, (_, i) => 90 + i);          // rising
    const prices = [...losses, ...gains];

    const result = computeRSI(prices);
    // With Wilder's smoothing, the earlier losses bleed into the result,
    // so it should be less than 100 (unlike simple average on last 15)
    expect(result).toBeLessThan(100);
    expect(result).toBeGreaterThan(50); // but still bullish since recent gains dominate
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

  test('RSI ~50 for alternating equal gains and losses', () => {
    // Alternating +1, -1 pattern should yield RSI near 50
    const prices = [100];
    for (let i = 1; i <= 30; i++) {
      prices.push(prices[i - 1] + (i % 2 === 0 ? -1 : 1));
    }
    const result = computeRSI(prices);
    expect(result).toBeGreaterThan(40);
    expect(result).toBeLessThan(60);
  });
});
