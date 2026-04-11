const { _test } = require('../services/validation');
const { spearmanCorrelation, toRanks, computeAggregate, computeCorrelation } = _test;

// ---------------------------------------------------------------------------
// toRanks
// ---------------------------------------------------------------------------

describe('toRanks', () => {
  test('ranks ascending values', () => {
    expect(toRanks([10, 20, 30])).toEqual([1, 2, 3]);
  });

  test('handles ties with average rank', () => {
    expect(toRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  test('handles all identical values', () => {
    expect(toRanks([5, 5, 5])).toEqual([2, 2, 2]);
  });

  test('handles descending values', () => {
    expect(toRanks([30, 20, 10])).toEqual([3, 2, 1]);
  });
});

// ---------------------------------------------------------------------------
// spearmanCorrelation
// ---------------------------------------------------------------------------

describe('spearmanCorrelation', () => {
  test('perfect positive correlation', () => {
    const rho = spearmanCorrelation([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]);
    expect(rho).toBeCloseTo(1.0, 5);
  });

  test('perfect negative correlation', () => {
    const rho = spearmanCorrelation([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]);
    expect(rho).toBeCloseTo(-1.0, 5);
  });

  test('no correlation', () => {
    const rho = spearmanCorrelation([1, 2, 3, 4, 5], [3, 1, 5, 2, 4]);
    expect(Math.abs(rho)).toBeLessThan(0.5);
  });

  test('returns null for single element', () => {
    expect(spearmanCorrelation([1], [2])).toBeNull();
  });

  test('returns 0 for constant array', () => {
    expect(spearmanCorrelation([5, 5, 5], [1, 2, 3])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeCorrelation
// ---------------------------------------------------------------------------

describe('computeCorrelation', () => {
  test('returns null spearman with note for insufficient data', () => {
    const pairs = Array.from({ length: 5 }, (_, i) => ({
      matchScore: i,
      returnPct: i * 2,
      period: '1m',
    }));
    const result = computeCorrelation(pairs);
    expect(result['1m'].rho).toBeNull();
    expect(result['1m'].note).toMatch(/Insufficient/);
    expect(result['1m'].n).toBe(5);
  });

  test('returns high rho for enough perfectly correlated data', () => {
    const pairs = Array.from({ length: 20 }, (_, i) => ({
      matchScore: i,
      returnPct: i * 10,
      period: '12m',
    }));
    const result = computeCorrelation(pairs);
    expect(result['12m'].rho).toBeGreaterThan(0.9);
    expect(result['12m'].n).toBe(20);
    expect(result['12m'].note).toBeUndefined();
  });

  test('returns null for empty input', () => {
    expect(computeCorrelation([])).toBeNull();
    expect(computeCorrelation(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeAggregate
// ---------------------------------------------------------------------------

describe('computeAggregate', () => {
  test('returns null when no completed cases', () => {
    const cases = [
      { status: 'skipped', reason: 'no data' },
      { status: 'error', error: 'timeout' },
    ];
    expect(computeAggregate(cases)).toBeNull();
  });

  test('correctly averages two cases with 12m data', () => {
    const cases = [
      {
        status: 'completed',
        summary: {
          '1m': null,
          '3m': null,
          '6m': null,
          '12m': { avgReturn: 40, benchmarkReturn: 20, winRate: 0.8 },
        },
      },
      {
        status: 'completed',
        summary: {
          '1m': null,
          '3m': null,
          '6m': null,
          '12m': { avgReturn: 60, benchmarkReturn: 30, winRate: 0.6 },
        },
      },
    ];
    const agg = computeAggregate(cases);

    expect(agg['12m'].avgReturn).toBe(50);        // (40+60)/2
    expect(agg['12m'].avgBenchmarkReturn).toBe(25); // (20+30)/2
    expect(agg['12m'].alpha).toBe(25);              // 50 - 25
    expect(agg['12m'].avgWinRate).toBe(0.7);        // (0.8+0.6)/2
    expect(agg['12m'].caseCount).toBe(2);
  });

  test('handles missing periods gracefully', () => {
    const cases = [
      {
        status: 'completed',
        summary: {
          '1m': { avgReturn: 5, benchmarkReturn: 2, winRate: 0.6 },
          '3m': null,
          '6m': null,
          '12m': null,
        },
      },
    ];
    const agg = computeAggregate(cases);

    expect(agg['1m'].avgReturn).toBe(5);
    expect(agg['3m']).toBeNull();
    expect(agg['6m']).toBeNull();
    expect(agg['12m']).toBeNull();
  });
});
