jest.mock('../services/fmp');

const fmp = require('../services/fmp');
const catalyst = require('../services/catalystSnapshot');
const {
  piecewise,
  scoreEarningsSurprise,
  scoreEstimateRevisions,
  scoreInsiderBuying,
  gradeRowBullishness,
  isBuyTransaction,
  deriveSignals,
  EARNINGS_SURPRISE_POINTS,
  REVISION_POINTS,
  INSIDER_BUYERS_POINTS,
  INSIDER_WINDOW_DAYS,
  REVISION_MIN_GAP_DAYS,
} = catalyst._test;

// ---------------------------------------------------------------------------
// Date helpers — build ISO date strings N days ago from "now" for fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// piecewise — baseline sanity (reuses shape tested in momentumBreakout)
// ---------------------------------------------------------------------------

describe('piecewise interpolator', () => {
  const pts = [[-1, -1.0], [0, 0], [1, 1.0]];
  test('clamps below first breakpoint', () => {
    expect(piecewise(-5, pts)).toBe(-1.0);
  });
  test('clamps above last breakpoint', () => {
    expect(piecewise(5, pts)).toBe(1.0);
  });
  test('interpolates linearly', () => {
    expect(piecewise(0.5, pts)).toBeCloseTo(0.5);
    expect(piecewise(-0.5, pts)).toBeCloseTo(-0.5);
  });
  test('returns null for null / NaN / non-finite input', () => {
    expect(piecewise(null, pts)).toBeNull();
    expect(piecewise(NaN, pts)).toBeNull();
    expect(piecewise(Infinity, pts)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scoreEarningsSurprise
// ---------------------------------------------------------------------------

describe('scoreEarningsSurprise', () => {
  test('empty array returns null', () => {
    expect(scoreEarningsSurprise([])).toBeNull();
  });
  test('null input returns null', () => {
    expect(scoreEarningsSurprise(null)).toBeNull();
  });
  test('rows without both actual & estimate return null', () => {
    const rows = [
      { date: daysAgo(5), epsActual: 1.0, epsEstimated: null },
      { date: daysAgo(90), epsActual: null, epsEstimated: 1.0 },
    ];
    expect(scoreEarningsSurprise(rows)).toBeNull();
  });

  test('exact 10% beat on a single row maps to +0.5', () => {
    // surprise = (1.10 - 1.00) / max(1.00, 0.01) = 0.10 → piecewise → 0.5
    const rows = [{ date: daysAgo(5), epsActual: 1.10, epsEstimated: 1.00 }];
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(0.5);
  });
  test('exact 10% miss on a single row maps to -0.5', () => {
    const rows = [{ date: daysAgo(5), epsActual: 0.90, epsEstimated: 1.00 }];
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(-0.5);
  });
  test('50% beat clamps to +1.0', () => {
    const rows = [{ date: daysAgo(5), epsActual: 1.50, epsEstimated: 1.00 }];
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(1.0);
  });
  test('75% beat clamps to +1.0 (above final breakpoint)', () => {
    const rows = [{ date: daysAgo(5), epsActual: 1.75, epsEstimated: 1.00 }];
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(1.0);
  });
  test('zero surprise maps to 0', () => {
    const rows = [{ date: daysAgo(5), epsActual: 1.00, epsEstimated: 1.00 }];
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(0);
  });
  test('tiny estimate uses 0.01 floor to avoid div-by-zero blowup', () => {
    // epsEstimated = 0.001; denom is 0.01; actual = 0.011 → surprise = 0.01/0.01 = 1.0 → clamp +1.0
    const rows = [{ date: daysAgo(5), epsActual: 0.011, epsEstimated: 0.001 }];
    const score = scoreEarningsSurprise(rows);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test('averages most-recent 2 qualifying rows', () => {
    // Newest: 20% beat → 0.75. Older: 0% surprise → 0. Average = 0.10 → 0.5
    const rows = [
      { date: daysAgo(5), epsActual: 1.20, epsEstimated: 1.00 },
      { date: daysAgo(95), epsActual: 1.00, epsEstimated: 1.00 },
    ];
    // surprise avg = (0.20 + 0) / 2 = 0.10 → piecewise → 0.5
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(0.5);
  });
  test('sorts unsorted rows newest-first before averaging', () => {
    const rows = [
      { date: daysAgo(95), epsActual: 1.00, epsEstimated: 1.00 }, // older first in input
      { date: daysAgo(5),  epsActual: 1.20, epsEstimated: 1.00 },
    ];
    // Must still pick the same 2 rows → same result as the sorted test above
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(0.5);
  });
  test('only 1 qualifying row still returns a score', () => {
    const rows = [
      { date: daysAgo(5), epsActual: 1.10, epsEstimated: 1.00 },
      { date: daysAgo(95), epsActual: null, epsEstimated: 1.00 }, // filtered out
    ];
    expect(scoreEarningsSurprise(rows)).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// gradeRowBullishness
// ---------------------------------------------------------------------------

describe('gradeRowBullishness', () => {
  test('all strong buys = 1.0', () => {
    const row = {
      analystRatingsStrongBuy: 10,
      analystRatingsBuy: 0,
      analystRatingsHold: 0,
      analystRatingsSell: 0,
      analystRatingsStrongSell: 0,
    };
    // (10*2) / 10 = 2.0 (this helper isn't clamped — the piecewise below is)
    expect(gradeRowBullishness(row)).toBeCloseTo(2.0);
  });
  test('all strong sells = -2.0', () => {
    const row = {
      analystRatingsStrongBuy: 0,
      analystRatingsBuy: 0,
      analystRatingsHold: 0,
      analystRatingsSell: 0,
      analystRatingsStrongSell: 5,
    };
    expect(gradeRowBullishness(row)).toBeCloseTo(-2.0);
  });
  test('all holds = 0', () => {
    const row = {
      analystRatingsStrongBuy: 0,
      analystRatingsBuy: 0,
      analystRatingsHold: 8,
      analystRatingsSell: 0,
      analystRatingsStrongSell: 0,
    };
    expect(gradeRowBullishness(row)).toBeCloseTo(0);
  });
  test('zero total returns null', () => {
    const row = {
      analystRatingsStrongBuy: 0,
      analystRatingsBuy: 0,
      analystRatingsHold: 0,
      analystRatingsSell: 0,
      analystRatingsStrongSell: 0,
    };
    expect(gradeRowBullishness(row)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// scoreEstimateRevisions
// ---------------------------------------------------------------------------

describe('scoreEstimateRevisions', () => {
  const neutral = {
    analystRatingsStrongBuy: 0,
    analystRatingsBuy: 0,
    analystRatingsHold: 10,
    analystRatingsSell: 0,
    analystRatingsStrongSell: 0,
  };
  const bullish = {
    analystRatingsStrongBuy: 5,
    analystRatingsBuy: 5,
    analystRatingsHold: 0,
    analystRatingsSell: 0,
    analystRatingsStrongSell: 0,
  };
  const bearish = {
    analystRatingsStrongBuy: 0,
    analystRatingsBuy: 0,
    analystRatingsHold: 0,
    analystRatingsSell: 5,
    analystRatingsStrongSell: 5,
  };

  test('empty / single-row returns null', () => {
    expect(scoreEstimateRevisions([])).toBeNull();
    expect(scoreEstimateRevisions(null)).toBeNull();
    expect(scoreEstimateRevisions([{ ...neutral, date: daysAgo(1) }])).toBeNull();
  });
  test('returns null when the older row is < 30 days old', () => {
    const rows = [
      { ...bullish, date: daysAgo(0) },
      { ...neutral, date: daysAgo(15) },
    ];
    expect(scoreEstimateRevisions(rows)).toBeNull();
  });
  test('bullish shift of +1.5 over 90d clamps to +1.0', () => {
    // bullish bullishness = (5*2 + 5*1) / 10 = 1.5
    // neutral bullishness = 0
    // delta = +1.5 → piecewise → clamps at +1.0
    const rows = [
      { ...bullish, date: daysAgo(0) },
      { ...neutral, date: daysAgo(90) },
    ];
    expect(scoreEstimateRevisions(rows)).toBeCloseTo(1.0);
  });
  test('bearish shift of -1.5 over 90d clamps to -1.0', () => {
    const rows = [
      { ...bearish, date: daysAgo(0) },
      { ...neutral, date: daysAgo(90) },
    ];
    expect(scoreEstimateRevisions(rows)).toBeCloseTo(-1.0);
  });
  test('exact +0.10 delta maps to +0.5', () => {
    // Construct two rows where delta = 0.10 exactly
    const a = {
      analystRatingsStrongBuy: 0, analystRatingsBuy: 2, analystRatingsHold: 8,
      analystRatingsSell: 0, analystRatingsStrongSell: 0,
      date: daysAgo(0),
    }; // (2) / 10 = 0.2
    const b = {
      analystRatingsStrongBuy: 0, analystRatingsBuy: 1, analystRatingsHold: 9,
      analystRatingsSell: 0, analystRatingsStrongSell: 0,
      date: daysAgo(90),
    }; // (1) / 10 = 0.1
    // delta = 0.1 → +0.5
    expect(scoreEstimateRevisions([a, b])).toBeCloseTo(0.5);
  });
  test('picks closest-to-90d row from unsorted input', () => {
    const latest = { ...bullish, date: daysAgo(0) };
    const closeTo90 = { ...neutral, date: daysAgo(88) };
    const tooOld = { ...bullish, date: daysAgo(300) };
    const rows = [tooOld, closeTo90, latest];
    // Must pick closeTo90; delta = 1.5 - 0 = 1.5 → clamp +1.0
    expect(scoreEstimateRevisions(rows)).toBeCloseTo(1.0);
  });
  test('returns null if bullishness cannot be computed on either endpoint', () => {
    const blank = {
      analystRatingsStrongBuy: 0, analystRatingsBuy: 0, analystRatingsHold: 0,
      analystRatingsSell: 0, analystRatingsStrongSell: 0,
    };
    const rows = [
      { ...blank, date: daysAgo(0) },
      { ...neutral, date: daysAgo(90) },
    ];
    expect(scoreEstimateRevisions(rows)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isBuyTransaction
// ---------------------------------------------------------------------------

describe('isBuyTransaction', () => {
  test('P-Purchase variants are buys (case insensitive)', () => {
    expect(isBuyTransaction({ transactionType: 'P-Purchase' })).toBe(true);
    expect(isBuyTransaction({ transactionType: 'p-purchase' })).toBe(true);
    expect(isBuyTransaction({ transactionType: '  P-Purchase ' })).toBe(true);
  });
  test('other SEC codes are not buys', () => {
    expect(isBuyTransaction({ transactionType: 'S-Sale' })).toBe(false);
    expect(isBuyTransaction({ transactionType: 'A-Award' })).toBe(false);
    expect(isBuyTransaction({ transactionType: 'M-Exercise' })).toBe(false);
    expect(isBuyTransaction({ transactionType: 'G-Gift' })).toBe(false);
  });
  test('missing / non-string type is not a buy', () => {
    expect(isBuyTransaction({ transactionType: null })).toBe(false);
    expect(isBuyTransaction({ transactionType: 42 })).toBe(false);
    expect(isBuyTransaction({})).toBe(false);
    expect(isBuyTransaction(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scoreInsiderBuying
// ---------------------------------------------------------------------------

describe('scoreInsiderBuying', () => {
  function buyRow(name, daysBack, shares) {
    return {
      transactionType: 'P-Purchase',
      transactionDate: daysAgo(daysBack),
      reportingName: name,
      securitiesTransacted: shares,
    };
  }
  function sellRow(name, daysBack, shares) {
    return {
      transactionType: 'S-Sale',
      transactionDate: daysAgo(daysBack),
      reportingName: name,
      securitiesTransacted: shares,
    };
  }

  test('empty / null returns null', () => {
    expect(scoreInsiderBuying([])).toBeNull();
    expect(scoreInsiderBuying(null)).toBeNull();
  });
  test('all rows outside window returns null', () => {
    const rows = [buyRow('CEO', 200, 1000), buyRow('CFO', 180, 500)];
    expect(scoreInsiderBuying(rows)).toBeNull();
  });
  test('only sales in window returns 0 (no buying, but data was present)', () => {
    const rows = [sellRow('CEO', 10, 1000), sellRow('CFO', 20, 500)];
    expect(scoreInsiderBuying(rows)).toBe(0);
  });
  test('1 distinct buyer scores 0.3 (piecewise breakpoint)', () => {
    const rows = [buyRow('CEO', 10, 1000)];
    expect(scoreInsiderBuying(rows)).toBeCloseTo(0.3);
  });
  test('3 distinct buyers scores 0.7', () => {
    const rows = [
      buyRow('CEO', 10, 1000),
      buyRow('CFO', 20, 500),
      buyRow('COO', 30, 200),
    ];
    expect(scoreInsiderBuying(rows)).toBeCloseTo(0.7);
  });
  test('5+ distinct buyers clamps to 1.0', () => {
    const rows = [
      buyRow('A', 1, 100),
      buyRow('B', 2, 100),
      buyRow('C', 3, 100),
      buyRow('D', 4, 100),
      buyRow('E', 5, 100),
      buyRow('F', 6, 100),
    ];
    expect(scoreInsiderBuying(rows)).toBeCloseTo(1.0);
  });
  test('same buyer multiple rows counts once', () => {
    const rows = [
      buyRow('CEO', 10, 1000),
      buyRow('CEO', 20, 500),
      buyRow('CEO', 30, 200),
    ];
    // 1 distinct buyer → 0.3
    expect(scoreInsiderBuying(rows)).toBeCloseTo(0.3);
  });
  test('mixes sales (ignored) and buys', () => {
    const rows = [
      sellRow('Insider-X', 5, 100000),
      buyRow('CEO', 10, 1000),
      buyRow('CFO', 20, 500),
    ];
    // 2 distinct buyers → interpolate between (1, 0.3) and (3, 0.7) → 0.5
    expect(scoreInsiderBuying(rows)).toBeCloseTo(0.5);
  });
  test('missing securitiesTransacted does not crash', () => {
    const rows = [
      { transactionType: 'P-Purchase', transactionDate: daysAgo(5), reportingName: 'CEO' },
    ];
    expect(scoreInsiderBuying(rows)).toBeCloseTo(0.3);
  });
  test('buyer with missing reportingName is not counted as distinct', () => {
    const rows = [
      buyRow('CEO', 10, 1000),
      { ...buyRow(null, 20, 500), reportingName: null },
      { ...buyRow(undefined, 30, 200), reportingName: undefined },
    ];
    // Only 'CEO' counts → 1 distinct buyer
    expect(scoreInsiderBuying(rows)).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// deriveSignals
// ---------------------------------------------------------------------------

describe('deriveSignals', () => {
  test('wires the three scorers together, passing nulls through', () => {
    const s = deriveSignals({ earnings: [], gradesHistorical: [], insiderTrading: [] });
    expect(s).toEqual({
      earningsSurprise: null,
      estimateRevisions: null,
      insiderBuying: null,
    });
  });
});

// ---------------------------------------------------------------------------
// populateCatalystCache — sequential, TTL, error handling
// ---------------------------------------------------------------------------

describe('populateCatalystCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalyst._resetCacheForTest();
    fmp.getEarnings.mockResolvedValue([]);
    fmp.getGradesHistorical.mockResolvedValue([]);
    fmp.getInsiderTradingLatest.mockResolvedValue([]);
  });

  test('iterates tickers in input order (sequential)', async () => {
    const calls = [];
    fmp.getEarnings.mockImplementation(async (t) => { calls.push(`e:${t}`); return []; });
    fmp.getGradesHistorical.mockImplementation(async (t) => { calls.push(`g:${t}`); return []; });
    fmp.getInsiderTradingLatest.mockImplementation(async (t) => { calls.push(`i:${t}`); return []; });

    await catalyst.populateCatalystCache(['AAA', 'BBB', 'CCC']);

    // Per-ticker the 3 fetches must be in order; tickers must be in input order
    expect(calls).toEqual([
      'e:AAA', 'g:AAA', 'i:AAA',
      'e:BBB', 'g:BBB', 'i:BBB',
      'e:CCC', 'g:CCC', 'i:CCC',
    ]);
  });

  test('populates the cache and derives signals', async () => {
    fmp.getEarnings.mockResolvedValue([
      { date: daysAgo(5), epsActual: 1.10, epsEstimated: 1.00 },
    ]);
    fmp.getGradesHistorical.mockResolvedValue([]);
    fmp.getInsiderTradingLatest.mockResolvedValue([]);

    const summary = await catalyst.populateCatalystCache(['AAPL']);
    expect(summary).toEqual({ fetched: 1, failed: 0, skipped: 0 });

    const snap = catalyst.getCatalystSnapshot('AAPL');
    expect(snap).not.toBeNull();
    expect(snap.ticker).toBe('AAPL');
    expect(typeof snap.fetchedAt).toBe('number');
    expect(snap.earnings).toHaveLength(1);
    expect(snap.signals.earningsSurprise).toBeCloseTo(0.5);
    expect(snap.signals.estimateRevisions).toBeNull();
    expect(snap.signals.insiderBuying).toBeNull();
  });

  test('skips tickers with fresh cache; force=true bypasses', async () => {
    await catalyst.populateCatalystCache(['AAPL']);
    expect(fmp.getEarnings).toHaveBeenCalledTimes(1);

    // Second run: should skip (fresh TTL)
    const summary2 = await catalyst.populateCatalystCache(['AAPL']);
    expect(summary2).toEqual({ fetched: 0, failed: 0, skipped: 1 });
    expect(fmp.getEarnings).toHaveBeenCalledTimes(1); // no refetch

    // Force=true: refetches even fresh entries
    const summary3 = await catalyst.populateCatalystCache(['AAPL'], { force: true });
    expect(summary3).toEqual({ fetched: 1, failed: 0, skipped: 0 });
    expect(fmp.getEarnings).toHaveBeenCalledTimes(2);
  });

  test('expired TTL entries are refetched', async () => {
    await catalyst.populateCatalystCache(['AAPL']);
    const snap = catalyst.getCatalystSnapshot('AAPL');
    expect(snap).not.toBeNull();

    // Advance Date.now past the TTL so the next populate sees the entry as stale.
    // The entry is frozen, so we can't backdate fetchedAt directly; moving
    // "now" forward is equivalent and exercises the same code path.
    const originalNow = Date.now;
    const advanceMs = catalyst.CATALYST_CACHE_TTL_MS + 1000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => originalNow() + advanceMs);
    try {
      const summary = await catalyst.populateCatalystCache(['AAPL']);
      expect(summary).toEqual({ fetched: 1, failed: 0, skipped: 0 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('an error on one ticker does not kill the loop', async () => {
    fmp.getEarnings.mockImplementation(async (t) => {
      if (t === 'BROKEN') throw new Error('rate limit exhausted');
      return [];
    });

    const progress = [];
    const summary = await catalyst.populateCatalystCache(['AAA', 'BROKEN', 'CCC'], {
      onProgress: (i, total, ticker, status) => progress.push({ i, ticker, status }),
    });

    expect(summary).toEqual({ fetched: 2, failed: 1, skipped: 0 });
    expect(catalyst.getCatalystSnapshot('AAA')).not.toBeNull();
    expect(catalyst.getCatalystSnapshot('BROKEN')).toBeNull();
    expect(catalyst.getCatalystSnapshot('CCC')).not.toBeNull();
    expect(progress.map(p => p.status)).toEqual(['fetched', 'failed', 'fetched']);
    expect(progress.map(p => p.ticker)).toEqual(['AAA', 'BROKEN', 'CCC']);
  });

  test('onProgress callback errors do not kill the loop', async () => {
    const summary = await catalyst.populateCatalystCache(['AAA', 'BBB'], {
      onProgress: () => { throw new Error('callback blew up'); },
    });
    expect(summary).toEqual({ fetched: 2, failed: 0, skipped: 0 });
  });

  test('empty ticker list yields zero summary', async () => {
    const summary = await catalyst.populateCatalystCache([]);
    expect(summary).toEqual({ fetched: 0, failed: 0, skipped: 0 });
  });

  test('non-array input is tolerated', async () => {
    const summary = await catalyst.populateCatalystCache(null);
    expect(summary).toEqual({ fetched: 0, failed: 0, skipped: 0 });
  });
});

// ---------------------------------------------------------------------------
// getCatalystSnapshot, getCatalystCacheStatus, _resetCacheForTest
// ---------------------------------------------------------------------------

describe('cache accessors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalyst._resetCacheForTest();
    fmp.getEarnings.mockResolvedValue([]);
    fmp.getGradesHistorical.mockResolvedValue([]);
    fmp.getInsiderTradingLatest.mockResolvedValue([]);
  });

  test('getCatalystSnapshot returns null for uncached tickers', () => {
    expect(catalyst.getCatalystSnapshot('AAPL')).toBeNull();
    expect(catalyst.getCatalystSnapshot('')).toBeNull();
    expect(catalyst.getCatalystSnapshot(null)).toBeNull();
    expect(catalyst.getCatalystSnapshot(undefined)).toBeNull();
  });

  test('getCatalystSnapshot returns the populated entry', async () => {
    await catalyst.populateCatalystCache(['AAPL']);
    const snap = catalyst.getCatalystSnapshot('AAPL');
    expect(snap).toMatchObject({
      ticker: 'AAPL',
      fetchedAt: expect.any(Number),
      earnings: expect.any(Array),
      gradesHistorical: expect.any(Array),
      insiderTrading: expect.any(Array),
      signals: {
        earningsSurprise: null,
        estimateRevisions: null,
        insiderBuying: null,
      },
    });
  });

  test('getCatalystCacheStatus exposes size, ttl, lastBuild', async () => {
    const before = catalyst.getCatalystCacheStatus();
    expect(before.size).toBe(0);
    expect(before.ttlMs).toBe(24 * 60 * 60 * 1000);
    expect(before.lastBuild).toBeNull();

    await catalyst.populateCatalystCache(['AAPL', 'MSFT']);
    const after = catalyst.getCatalystCacheStatus();
    expect(after.size).toBe(2);
    expect(after.lastBuild).toMatchObject({
      fetched: 2, failed: 0, skipped: 0,
      finishedAt: expect.any(String),
    });
  });

  test('_resetCacheForTest clears both cache and lastBuild', async () => {
    await catalyst.populateCatalystCache(['AAPL']);
    expect(catalyst.getCatalystCacheStatus().size).toBe(1);
    catalyst._resetCacheForTest();
    expect(catalyst.getCatalystCacheStatus()).toMatchObject({
      size: 0,
      lastBuild: null,
    });
    expect(catalyst.getCatalystSnapshot('AAPL')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Module constants — surface for Phase 3b assertions
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  test('TTL constant is 24h', () => {
    expect(catalyst.CATALYST_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
  test('piecewise breakpoint arrays are exported for introspection', () => {
    expect(EARNINGS_SURPRISE_POINTS.length).toBeGreaterThan(0);
    expect(REVISION_POINTS.length).toBeGreaterThan(0);
    expect(INSIDER_BUYERS_POINTS.length).toBeGreaterThan(0);
    expect(INSIDER_WINDOW_DAYS).toBe(90);
    expect(REVISION_MIN_GAP_DAYS).toBe(30);
  });
});
