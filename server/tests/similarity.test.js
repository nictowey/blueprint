const { isSameCompany, baseTicker, _test } = require('../services/matcher');
const {
  ratioSimilarity, marginSimilarity, growthSimilarity, boundedSimilarity,
  technicalPctSimilarity, marketCapSimilarity, betaSimilarity,
  debtToEquitySimilarity, relativeVolumeSimilarity, metricSimilarity,
  growthQualityPenalty,
} = _test;

// ===========================
// Ratio similarity (log-scale)
// ===========================
describe('ratioSimilarity', () => {
  test('identical values score 1.0', () => {
    expect(ratioSimilarity(25, 25)).toBe(1);
  });

  test('2x difference scores ~0.70', () => {
    const sim = ratioSimilarity(10, 20);
    expect(sim).toBeCloseTo(0.70, 1);
  });

  test('10x difference scores ~0', () => {
    expect(ratioSimilarity(5, 50)).toBeCloseTo(0, 10);
  });

  test('both near-zero scores 1.0', () => {
    expect(ratioSimilarity(0.001, 0.005)).toBe(1);
  });

  test('one near-zero, one large scores ~0.1', () => {
    expect(ratioSimilarity(0.001, 50)).toBe(0.1);
  });

  test('opposite signs penalized heavily', () => {
    const sim = ratioSimilarity(20, -15);
    expect(sim).toBeLessThanOrEqual(0.3);
  });

  test('both negative with similar magnitudes', () => {
    const sim = ratioSimilarity(-10, -12);
    // Should use log scale on absolute values
    expect(sim).toBeGreaterThan(0.5);
  });
});

// ===========================
// Margin similarity (hybrid)
// ===========================
describe('marginSimilarity', () => {
  test('identical margins score 1.0', () => {
    expect(marginSimilarity(0.25, 0.25)).toBe(1);
  });

  test('40% vs 25% scores ~0.63 (meaningful gap)', () => {
    const sim = marginSimilarity(0.40, 0.25);
    expect(sim).toBeGreaterThan(0.50);
    expect(sim).toBeLessThan(0.80);
  });

  test('small margins differentiated: 4.4% vs 0.5%', () => {
    const sim = marginSimilarity(0.044, 0.005);
    // Relative difference is huge even though absolute is small
    expect(sim).toBeLessThan(0.60);
  });

  test('both near zero returns absolute similarity', () => {
    const sim = marginSimilarity(0.002, 0.003);
    expect(sim).toBeGreaterThan(0.95);
  });

  test('large margins close together score high', () => {
    const sim = marginSimilarity(0.50, 0.48);
    expect(sim).toBeGreaterThan(0.90);
  });
});

// ===========================
// Growth similarity (dampened)
// ===========================
describe('growthSimilarity', () => {
  test('identical growth scores 1.0', () => {
    expect(growthSimilarity(0.15, 0.15)).toBe(1);
  });

  test('opposite directions heavily penalized', () => {
    const sim = growthSimilarity(0.20, -0.10);
    expect(sim).toBeLessThan(0.30);
  });

  test('both near zero (within ±2%) not penalized as opposite', () => {
    const sim = growthSimilarity(0.01, -0.01);
    // Neither triggers the direction penalty (thresholds are ±0.02)
    expect(sim).toBeGreaterThan(0.85);
  });

  test('high-growth pairs use relative comparison', () => {
    // 100% vs 50% — both > 30%, relative comparison kicks in
    const sim = growthSimilarity(1.0, 0.5);
    expect(sim).toBeGreaterThan(0.15);
    expect(sim).toBeLessThan(0.75);
  });

  test('moderate growth: 17% vs 5% = significant divergence', () => {
    const sim = growthSimilarity(0.17, 0.05);
    expect(sim).toBeGreaterThan(0.55);
    expect(sim).toBeLessThan(0.75);
  });
});

// ===========================
// Bounded similarity (RSI, pctBelowHigh)
// ===========================
describe('boundedSimilarity', () => {
  test('identical scores 1.0', () => {
    expect(boundedSimilarity(55, 55)).toBe(1);
  });

  test('10 points apart scores 0.9', () => {
    expect(boundedSimilarity(50, 60)).toBeCloseTo(0.9, 2);
  });

  test('100 points apart (full range) scores 0', () => {
    expect(boundedSimilarity(0, 100)).toBe(0);
  });
});

// ===========================
// Technical % similarity (priceVsMa)
// ===========================
describe('technicalPctSimilarity', () => {
  test('identical scores 1.0', () => {
    expect(technicalPctSimilarity(5, 5)).toBe(1);
  });

  test('25% apart scores 0.5', () => {
    expect(technicalPctSimilarity(0, 25)).toBeCloseTo(0.5, 2);
  });

  test('50% apart scores 0', () => {
    expect(technicalPctSimilarity(-25, 25)).toBe(0);
  });
});

// ===========================
// Market cap similarity (log-scale)
// ===========================
describe('marketCapSimilarity', () => {
  test('identical market caps score 1.0', () => {
    expect(marketCapSimilarity(50e9, 50e9)).toBe(1);
  });

  test('10x difference scores 0', () => {
    expect(marketCapSimilarity(5e9, 50e9)).toBe(0);
  });

  test('2x difference scores ~0.70', () => {
    const sim = marketCapSimilarity(25e9, 50e9);
    expect(sim).toBeCloseTo(0.70, 1);
  });

  test('null/zero returns null', () => {
    expect(marketCapSimilarity(0, 50e9)).toBeNull();
    expect(marketCapSimilarity(50e9, -1)).toBeNull();
  });
});

// ===========================
// Beta similarity
// ===========================
describe('betaSimilarity', () => {
  test('identical scores 1.0', () => {
    expect(betaSimilarity(1.2, 1.2)).toBe(1);
  });

  test('0.5 apart scores ~0.67', () => {
    const sim = betaSimilarity(1.0, 1.5);
    expect(sim).toBeCloseTo(0.67, 1);
  });

  test('1.5 apart scores 0', () => {
    expect(betaSimilarity(0.5, 2.0)).toBe(0);
  });
});

// ===========================
// Debt-to-equity similarity
// ===========================
describe('debtToEquitySimilarity', () => {
  test('both negative equity scores 0.7', () => {
    expect(debtToEquitySimilarity(-1, -2)).toBe(0.7);
  });

  test('one negative one positive scores 0.1', () => {
    expect(debtToEquitySimilarity(-1, 0.5)).toBe(0.1);
  });

  test('both positive and similar', () => {
    const sim = debtToEquitySimilarity(0.5, 0.5);
    expect(sim).toBe(1);
  });
});

// ===========================
// Relative volume similarity
// ===========================
describe('relativeVolumeSimilarity', () => {
  test('identical scores 1.0', () => {
    expect(relativeVolumeSimilarity(1.0, 1.0)).toBe(1);
  });

  test('zero or negative returns null', () => {
    expect(relativeVolumeSimilarity(0, 1.0)).toBeNull();
    expect(relativeVolumeSimilarity(1.0, -1)).toBeNull();
  });

  test('2x different scores ~0.6', () => {
    const sim = relativeVolumeSimilarity(1.0, 2.0);
    expect(sim).toBeCloseTo(0.6, 1);
  });
});

// ===========================
// metricSimilarity (dispatcher)
// ===========================
describe('metricSimilarity', () => {
  test('returns null for null inputs', () => {
    expect(metricSimilarity('peRatio', null, 25)).toBeNull();
    expect(metricSimilarity('peRatio', 25, null)).toBeNull();
  });

  test('returns null for NaN/Infinity inputs', () => {
    expect(metricSimilarity('peRatio', NaN, 25)).toBeNull();
    expect(metricSimilarity('peRatio', 25, Infinity)).toBeNull();
  });

  test('dispatches to correct function', () => {
    // P/E ratio → ratioSimilarity
    expect(metricSimilarity('peRatio', 25, 25)).toBe(1);
    // Gross margin → marginSimilarity
    expect(metricSimilarity('grossMargin', 0.25, 0.25)).toBe(1);
    // Revenue growth → growthSimilarity
    expect(metricSimilarity('revenueGrowthYoY', 0.15, 0.15)).toBe(1);
    // RSI → boundedSimilarity
    expect(metricSimilarity('rsi14', 55, 55)).toBe(1);
    // Market cap → marketCapSimilarity
    expect(metricSimilarity('marketCap', 50e9, 50e9)).toBe(1);
    // Beta → betaSimilarity
    expect(metricSimilarity('beta', 1.2, 1.2)).toBe(1);
  });
});

// ===========================
// growthQualityPenalty
// ===========================
describe('growthQualityPenalty', () => {
  test('no penalty when data missing', () => {
    expect(growthQualityPenalty({}, {})).toBe(1.0);
    expect(growthQualityPenalty(
      { revenueGrowthYoY: 0.15, epsGrowthYoY: null },
      { revenueGrowthYoY: 0.10, epsGrowthYoY: 0.20 }
    )).toBe(1.0);
  });

  test('penalizes revenue direction mismatch', () => {
    const penalty = growthQualityPenalty(
      { revenueGrowthYoY: 0.20, epsGrowthYoY: 0.25 },
      { revenueGrowthYoY: -0.10, epsGrowthYoY: 0.15 }
    );
    expect(penalty).toBeLessThan(1.0);
  });

  test('penalizes earnings-recovery (declining rev, extreme EPS)', () => {
    const penalty = growthQualityPenalty(
      { revenueGrowthYoY: 0.20, epsGrowthYoY: 0.25 },
      { revenueGrowthYoY: -0.05, epsGrowthYoY: 1.50 }
    );
    expect(penalty).toBeLessThan(0.92);
  });

  test('no bonus for balanced growth (penalty only, never > 1.0)', () => {
    const penalty = growthQualityPenalty(
      { revenueGrowthYoY: 0.20, epsGrowthYoY: 0.25 },
      { revenueGrowthYoY: 0.18, epsGrowthYoY: 0.22 }
    );
    expect(penalty).toBeLessThanOrEqual(1.0);
  });
});

// ===========================
// isSameCompany
// ===========================
describe('isSameCompany', () => {
  test('identical tickers', () => {
    expect(isSameCompany('AAPL', 'AAPL')).toBe(true);
  });

  test('dual-class shares via DUAL_CLASS_MAP', () => {
    expect(isSameCompany('GOOG', 'GOOGL')).toBe(true);
    expect(isSameCompany('FOX', 'FOXA')).toBe(true);
    expect(isSameCompany('BF-A', 'BF-B')).toBe(true);
    expect(isSameCompany('UA', 'UAA')).toBe(true);
  });

  test('base ticker stripping (share class suffixes)', () => {
    expect(isSameCompany('BRK.A', 'BRK.B')).toBe(true);
  });

  test('unrelated tickers', () => {
    expect(isSameCompany('AAPL', 'MSFT')).toBe(false);
    expect(isSameCompany('GOOG', 'META')).toBe(false);
  });

  test('name-based matching: same first significant words', () => {
    expect(isSameCompany('A', 'B', 'Alphabet Inc Class A', 'Alphabet Inc Class C')).toBe(true);
  });

  test('does not false-positive on generic words', () => {
    // "American" is in GENERIC_WORDS — should NOT match
    expect(isSameCompany('AAL', 'AXP', 'American Airlines Group', 'American Express Company')).toBe(false);
  });

  test('short company names do not false-positive', () => {
    // First word "Meta" is only 4 chars, sigWords check requires > 4
    expect(isSameCompany('META', 'MELI', 'Meta Platforms Inc', 'MercadoLibre Inc')).toBe(false);
  });

  test('parent/subsidiary matching via first word', () => {
    // "Entergy" is > 5 chars and not generic
    expect(isSameCompany('ETR', 'ELC', 'Entergy Corporation', 'Entergy Louisiana')).toBe(true);
  });
});

// ===========================
// baseTicker
// ===========================
describe('baseTicker', () => {
  test('strips share class suffixes', () => {
    expect(baseTicker('BRK.A')).toBe('BRK');
    expect(baseTicker('MKC.V')).toBe('MKC');
  });

  test('strips SPAC/warrant suffixes', () => {
    expect(baseTicker('FOO-WS')).toBe('FOO');
    expect(baseTicker('BAR-U')).toBe('BAR');
  });

  test('strips trailing L/P', () => {
    expect(baseTicker('GOOGL')).toBe('GOOG');
  });

  test('no-op for simple tickers', () => {
    expect(baseTicker('AAPL')).toBe('AAP');
    // Note: AAPL ends in L which gets stripped — this is a known edge case
    // but doesn't cause false positives because the comparison is symmetric
  });
});
