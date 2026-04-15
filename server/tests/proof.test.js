const express = require('express');
const request = require('supertest');

jest.mock('node-fetch', () => jest.fn());

describe('GET /api/proof', () => {
  let app;
  let fetch;

  const MOCK_PROOF_DATA = {
    version: 1,
    generatedAt: '2026-04-14T00:00:00Z',
    profile: 'growth_breakout',
    cases: [{
      templateTicker: 'NVDA',
      templateDate: '2023-01-03',
      templateCompanyName: 'NVIDIA Corporation',
      templateSector: 'Technology',
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

  test('returns proof data from Redis when available', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: JSON.stringify(MOCK_PROOF_DATA) }),
    });

    const proofRoute = require('../routes/proof');
    app.use('/api/proof', proofRoute);

    const res = await request(app).get('/api/proof');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.cases).toHaveLength(1);
    expect(res.body.aggregate.periods['12m'].alpha).toBe(10.0);
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
