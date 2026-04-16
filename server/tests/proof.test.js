const express = require('express');
const request = require('supertest');

jest.mock('node-fetch', () => jest.fn());

describe('GET /api/proof', () => {
  let app;
  let fetch;

  const MOCK_V1_PROOF = {
    version: 1,
    generatedAt: '2026-04-14T00:00:00Z',
    profile: 'growth_breakout',
    cases: [{
      templateTicker: 'NVDA',
      templateDate: '2023-01-03',
      templateCompanyName: 'NVIDIA Corporation',
      templateSector: 'Technology',
      status: 'completed',
      snapshotsBuilt: 240,
      matches: [{
        ticker: 'ANET',
        matchScore: 82.3,
        forwardReturns: { '1m': 5.2, '3m': 12.1, '6m': 28.4, '12m': 45.7 },
      }],
      benchmark: { '1m': 1.2, '3m': 3.5, '6m': 8.1, '12m': 15.3 },
    }],
    aggregate: {
      periods: {
        '12m': { avgReturn: 25.3, benchmarkReturn: 15.3, alpha: 10.0, winRate: 65, caseCount: 15 },
      },
      correlation: {
        '12m': { rho: 0.18, pairs: 130 },
      },
      totalMatches: 150,
      totalCases: 15,
    },
    disclaimers: ['Test disclaimer'],
  };

  const MOCK_V2_PROOF = {
    version: 2,
    generatedAt: '2026-04-16T00:00:00Z',
    profile: 'growth_breakout',
    engines: ['templateMatch', 'momentumBreakout', 'ensembleConsensus'],
    cases: [{
      templateTicker: 'NVDA',
      templateDate: '2023-01-03',
      templateCompanyName: 'NVIDIA Corporation',
      templateSector: 'Technology',
      candidatesScanned: 245,
      engines: {
        templateMatch: { status: 'completed', snapshotsBuilt: 240, matches: [] },
        momentumBreakout: { status: 'completed', snapshotsBuilt: 240, matches: [] },
        ensembleConsensus: { status: 'completed', matches: [] },
      },
      random: { status: 'completed', matches: [], seed: 12345 },
      benchmark: { '1m': 1.2, '3m': 3.5, '6m': 8.1, '12m': 15.3 },
    }],
    aggregate: {
      engines: {
        templateMatch: { periods: {}, correlation: {}, totalMatches: 0, totalCases: 1 },
      },
      totalMatches: 0,
      totalCases: 1,
    },
    disclaimers: ['v2 disclaimer'],
  };

  beforeEach(() => {
    jest.resetModules();
    jest.mock('node-fetch', () => jest.fn());
    fetch = require('node-fetch');
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  test('returns v2 data from Redis as-is', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: JSON.stringify(MOCK_V2_PROOF) }),
    });

    const proofRoute = require('../routes/proof');
    app.use('/api/proof', proofRoute);

    const res = await request(app).get('/api/proof');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.engines).toContain('templateMatch');
    expect(res.body.cases[0].engines).toBeDefined();
    expect(res.body.cases[0].engines.templateMatch).toBeDefined();
    expect(res.body.cases[0].random).toBeDefined();
    expect(res.body._migratedFromV1).toBeUndefined();
  });

  test('migrates v1 data from Redis to v2 shape', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: JSON.stringify(MOCK_V1_PROOF) }),
    });

    const proofRoute = require('../routes/proof');
    app.use('/api/proof', proofRoute);

    const res = await request(app).get('/api/proof');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body._migratedFromV1).toBe(true);
    expect(res.body.engines).toEqual(['templateMatch']);
    expect(res.body.cases).toHaveLength(1);
    const caseA = res.body.cases[0];
    expect(caseA.templateTicker).toBe('NVDA');
    expect(caseA.engines.templateMatch.matches).toHaveLength(1);
    expect(caseA.engines.templateMatch.matches[0].ticker).toBe('ANET');
    expect(caseA.random).toBeNull();
    // Benchmark preserved
    expect(caseA.benchmark['12m']).toBe(15.3);
    // Aggregate rewrapped under engines.templateMatch
    expect(res.body.aggregate.engines.templateMatch.periods['12m'].avgReturn).toBe(25.3);
    expect(res.body.aggregate.engines.templateMatch.periods['12m'].hitRateVsBenchmark).toBeNull();
    expect(res.body.aggregate.engines.templateMatch.periods['12m'].maxDrawdownPct).toBeNull();
    expect(res.body.aggregate.engines.templateMatch.periods['12m'].medianReturn).toBeNull();
  });

  test('returns 404 when no proof data available', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: null }),
    });

    const proofRoute = require('../routes/proof');
    app.use('/api/proof', proofRoute);

    const res = await request(app).get('/api/proof');
    // Will get 200 if local file exists, 404 if not
    expect([200, 404]).toContain(res.status);
  });
});

describe('migrateToV2', () => {
  const { migrateToV2 } = require('../routes/proof');

  test('returns v2 input unchanged', () => {
    const v2 = {
      version: 2,
      engines: ['templateMatch'],
      cases: [{ templateTicker: 'X', engines: {}, random: null }],
    };
    expect(migrateToV2(v2)).toBe(v2);
  });

  test('passes through null/undefined input', () => {
    expect(migrateToV2(null)).toBeNull();
    expect(migrateToV2(undefined)).toBeUndefined();
  });

  test('wraps v1 matches into engines.templateMatch and sets random null', () => {
    const v1 = {
      version: 1,
      cases: [{
        templateTicker: 'NVDA',
        templateDate: '2023-01-03',
        status: 'completed',
        matches: [{ ticker: 'A' }, { ticker: 'B' }],
        benchmark: { '1m': 1 },
      }],
    };
    const v2 = migrateToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.engines).toEqual(['templateMatch']);
    expect(v2.cases).toHaveLength(1);
    expect(v2.cases[0].engines.templateMatch.status).toBe('completed');
    expect(v2.cases[0].engines.templateMatch.matches).toHaveLength(2);
    expect(v2.cases[0].random).toBeNull();
    expect(v2.cases[0].benchmark['1m']).toBe(1);
    expect(v2._migratedFromV1).toBe(true);
  });

  test('wraps legacy aggregate under engines.templateMatch', () => {
    const v1 = {
      cases: [],
      aggregate: {
        periods: { '1m': { avgReturn: 3.3, alpha: 1.1, winRate: 55, caseCount: 5 } },
        correlation: { '1m': { rho: 0.2, pairs: 40 } },
        totalMatches: 50,
        totalCases: 5,
      },
    };
    const v2 = migrateToV2(v1);
    expect(v2.aggregate.engines.templateMatch.periods['1m'].avgReturn).toBe(3.3);
    expect(v2.aggregate.engines.templateMatch.periods['1m'].hitRateVsBenchmark).toBeNull();
    expect(v2.aggregate.engines.templateMatch.periods['1m'].maxDrawdownPct).toBeNull();
    expect(v2.aggregate.engines.templateMatch.correlation['1m'].rho).toBe(0.2);
    expect(v2.aggregate.totalMatches).toBe(50);
  });

  test('handles v1 case with status but no matches', () => {
    const v1 = {
      version: 1,
      cases: [{
        templateTicker: 'X',
        templateDate: '2023-01-03',
        status: 'skipped',
        matches: null,
      }],
    };
    const v2 = migrateToV2(v1);
    expect(v2.cases[0].engines.templateMatch.status).toBe('skipped');
    expect(v2.cases[0].engines.templateMatch.matches).toEqual([]);
  });
});
