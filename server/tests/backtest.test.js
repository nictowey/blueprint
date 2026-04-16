jest.mock('../services/fmp');

const fmp = require('../services/fmp');
const {
  computeMaxDrawdown,
  computeSummary,
  getForwardReturns,
} = require('../services/backtest');

// ---------------------------------------------------------------------------
// computeMaxDrawdown
// ---------------------------------------------------------------------------

describe('computeMaxDrawdown', () => {
  test('returns null for empty or missing input', () => {
    expect(computeMaxDrawdown([], '2023-02-01')).toBeNull();
    expect(computeMaxDrawdown(null, '2023-02-01')).toBeNull();
    expect(computeMaxDrawdown(undefined, '2023-02-01')).toBeNull();
    expect(computeMaxDrawdown([{ date: '2023-01-01', close: 100 }], null)).toBeNull();
  });

  test('returns 0 when price monotonically rises', () => {
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2023-01-02', close: 105 },
      { date: '2023-01-03', close: 110 },
    ];
    expect(computeMaxDrawdown(prices, '2023-01-03')).toBe(0);
  });

  test('captures peak-to-trough decline in percent', () => {
    // peak 200 on day 3, trough 150 on day 5 → 25% drawdown
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2023-01-02', close: 150 },
      { date: '2023-01-03', close: 200 },
      { date: '2023-01-04', close: 170 },
      { date: '2023-01-05', close: 150 },
      { date: '2023-01-06', close: 180 },
    ];
    expect(computeMaxDrawdown(prices, '2023-01-06')).toBeCloseTo(25, 1);
  });

  test('ignores prices after endDate', () => {
    // If we only look through 2023-01-03, peak is 200, no subsequent drop counted
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2023-01-02', close: 150 },
      { date: '2023-01-03', close: 200 },
      { date: '2023-01-04', close: 100 }, // dramatic crash — must not count
    ];
    expect(computeMaxDrawdown(prices, '2023-01-03')).toBe(0);
  });

  test('prefers adjClose when available', () => {
    const prices = [
      { date: '2023-01-01', close: 100, adjClose: 50 },
      { date: '2023-01-02', close: 200, adjClose: 100 },
      { date: '2023-01-03', close: 150, adjClose: 75 },
    ];
    // adj peak 100, adj trough 75 → 25%
    expect(computeMaxDrawdown(prices, '2023-01-03')).toBeCloseTo(25, 1);
  });

  test('skips entries with null close', () => {
    const prices = [
      { date: '2023-01-01', close: 100 },
      { date: '2023-01-02', close: null },
      { date: '2023-01-03', close: 80 },
    ];
    expect(computeMaxDrawdown(prices, '2023-01-03')).toBeCloseTo(20, 1);
  });
});

// ---------------------------------------------------------------------------
// computeSummary — new metrics
// ---------------------------------------------------------------------------

describe('computeSummary', () => {
  const mkResult = (ticker, rets, series) => ({
    ticker,
    returns: {
      '1m': rets['1m'] != null ? { returnPct: rets['1m'], endDate: '2023-02-01' } : null,
      '3m': rets['3m'] != null ? { returnPct: rets['3m'], endDate: '2023-04-01' } : null,
      '6m': rets['6m'] != null ? { returnPct: rets['6m'], endDate: '2023-07-01' } : null,
      '12m': rets['12m'] != null ? { returnPct: rets['12m'], endDate: '2024-01-01' } : null,
    },
    ...(series ? { dailySeries: series } : {}),
  });

  test('medianReturn is present', () => {
    const results = [
      mkResult('A', { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }),
      mkResult('B', { '1m': 2, '3m': 4, '6m': 7, '12m': 14 }),
      mkResult('C', { '1m': 5, '3m': 6, '6m': 10, '12m': 20 }),
    ];
    const benchmark = { returns: { '1m': { returnPct: 1 }, '3m': { returnPct: 2 }, '6m': { returnPct: 3 }, '12m': { returnPct: 4 } } };
    const summary = computeSummary(results, benchmark);
    expect(summary['1m'].medianReturn).toBe(2);
    expect(summary['12m'].medianReturn).toBe(14);
  });

  test('hitRateVsBenchmark — % of matches that beat the benchmark', () => {
    // benchmark 1m = 5.  returns 1, 6, 10 → 2/3 beat = 67%
    const results = [
      mkResult('A', { '1m': 1, '3m': 0, '6m': 0, '12m': 0 }),
      mkResult('B', { '1m': 6, '3m': 0, '6m': 0, '12m': 0 }),
      mkResult('C', { '1m': 10, '3m': 0, '6m': 0, '12m': 0 }),
    ];
    const benchmark = { returns: { '1m': { returnPct: 5 }, '3m': { returnPct: 0 }, '6m': { returnPct: 0 }, '12m': { returnPct: 0 } } };
    const summary = computeSummary(results, benchmark);
    expect(summary['1m'].hitRateVsBenchmark).toBe(67);
    // When return equals benchmark it doesn't count as a beat
    expect(summary['3m'].hitRateVsBenchmark).toBe(0);
  });

  test('hitRateVsBenchmark is null when benchmark missing', () => {
    const results = [mkResult('A', { '1m': 5, '3m': 6, '6m': 7, '12m': 8 })];
    const summary = computeSummary(results, null);
    expect(summary['1m'].hitRateVsBenchmark).toBeNull();
  });

  test('maxDrawdownPct is null when no dailySeries provided', () => {
    const results = [
      mkResult('A', { '1m': 5, '3m': 6, '6m': 7, '12m': 8 }),
      mkResult('B', { '1m': 10, '3m': 9, '6m': 8, '12m': 7 }),
    ];
    const benchmark = { returns: { '1m': { returnPct: 2 }, '3m': { returnPct: 3 }, '6m': { returnPct: 4 }, '12m': { returnPct: 5 } } };
    const summary = computeSummary(results, benchmark);
    expect(summary['1m'].maxDrawdownPct).toBeNull();
  });

  test('maxDrawdownPct is the median across matches when dailySeries present', () => {
    // Match A: peak 100 → trough 80 → 20% dd
    // Match B: peak 100 → trough 90 → 10% dd
    // Match C: peak 100 → trough 50 → 50% dd
    // Median of [20, 10, 50] sorted = [10, 20, 50] → 20
    const seriesFor = (troughClose) => ({
      '1m': [
        { date: '2023-01-01', close: 100 },
        { date: '2023-01-15', close: troughClose },
        { date: '2023-02-01', close: 95 },
      ],
    });
    const results = [
      { ticker: 'A', returns: { '1m': { returnPct: 5, endDate: '2023-02-01' } }, dailySeries: seriesFor(80) },
      { ticker: 'B', returns: { '1m': { returnPct: 5, endDate: '2023-02-01' } }, dailySeries: seriesFor(90) },
      { ticker: 'C', returns: { '1m': { returnPct: 5, endDate: '2023-02-01' } }, dailySeries: seriesFor(50) },
    ];
    const summary = computeSummary(results, null);
    expect(summary['1m'].maxDrawdownPct).toBeCloseTo(20, 1);
  });

  test('no returns → null summary for period', () => {
    const results = [mkResult('A', { '1m': null, '3m': null, '6m': null, '12m': null })];
    const summary = computeSummary(results, null);
    expect(summary['1m']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getForwardReturns — withSeries flag
// ---------------------------------------------------------------------------

describe('getForwardReturns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Build a plausible daily series spanning ~13 months
  function mockPriceSeries(startDate, startPrice, growthPct = 0.5) {
    const out = [];
    const cur = new Date(startDate);
    const end = new Date(cur);
    end.setMonth(end.getMonth() + 13);
    let price = startPrice;
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        out.push({
          date: cur.toISOString().slice(0, 10),
          close: Math.round(price * 100) / 100,
          adjClose: Math.round(price * 100) / 100,
        });
        price *= 1 + (growthPct / 100) / 20; // ~growthPct% per month
      }
      cur.setDate(cur.getDate() + 1);
    }
    // FMP returns newest-first
    return out.reverse();
  }

  test('returns returns object without dailySeries by default', async () => {
    fmp.getHistoricalPrices.mockResolvedValue(mockPriceSeries('2023-01-03', 100, 10));

    const result = await getForwardReturns('TEST', '2023-01-03');
    expect(result).not.toBeNull();
    expect(result.returns).toBeDefined();
    expect(result.returns['1m']).toBeDefined();
    expect(result.dailySeries).toBeUndefined();
  });

  test('attaches dailySeries when withSeries: true', async () => {
    fmp.getHistoricalPrices.mockResolvedValue(mockPriceSeries('2023-01-03', 100, 10));

    const result = await getForwardReturns('TEST', '2023-01-03', { withSeries: true });
    expect(result).not.toBeNull();
    expect(result.dailySeries).toBeDefined();
    expect(result.dailySeries['1m']).not.toBeNull();
    // Series entries ascending in date
    const series = result.dailySeries['1m'];
    expect(series.length).toBeGreaterThan(10);
    for (let i = 1; i < series.length; i++) {
      expect(series[i].date >= series[i - 1].date).toBe(true);
    }
    // Each entry has date + close
    expect(series[0]).toHaveProperty('date');
    expect(series[0]).toHaveProperty('close');
    // 12m series is longer than 1m series
    expect(result.dailySeries['12m'].length).toBeGreaterThan(series.length);
  });

  test('returns null when no prices', async () => {
    fmp.getHistoricalPrices.mockResolvedValue([]);
    const result = await getForwardReturns('TEST', '2023-01-03');
    expect(result).toBeNull();
  });

  test('dailySeries is null for period when returns are null', async () => {
    // Only 1 week of data — 1m onwards will be null
    const short = [
      { date: '2023-01-03', close: 100, adjClose: 100 },
      { date: '2023-01-04', close: 101, adjClose: 101 },
      { date: '2023-01-05', close: 102, adjClose: 102 },
    ];
    fmp.getHistoricalPrices.mockResolvedValue(short.reverse());
    const result = await getForwardReturns('TEST', '2023-01-03', { withSeries: true });
    // 1m onwards unreachable
    expect(result.dailySeries['1m']).toBeNull();
  });
});
