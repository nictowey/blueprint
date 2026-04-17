const request = require('supertest');
const express = require('express');
const universe = require('../services/universe');

const searchRoute = require('../routes/search');

function makeApp() {
  const app = express();
  app.use('/api/search', searchRoute);
  return app;
}

function mockUniverse(entries) {
  const cache = new Map();
  for (const e of entries) cache.set(e.ticker, e);
  jest.spyOn(universe, 'getCache').mockReturnValue(cache);
  jest.spyOn(universe, 'isReady').mockReturnValue(true);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/search', () => {
  test('empty query returns []', async () => {
    mockUniverse([{ ticker: 'NVDA', companyName: 'NVIDIA Corp' }]);
    const res = await request(makeApp()).get('/api/search?q=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('symbol prefix match (case-insensitive) returned first', async () => {
    mockUniverse([
      { ticker: 'NVDA', companyName: 'NVIDIA Corp' },
      { ticker: 'AAPL', companyName: 'Apple Inc' },
      { ticker: 'MSFT', companyName: 'Microsoft Corp' }, // has "M" in name
    ]);
    const res = await request(makeApp()).get('/api/search?q=nvd');
    expect(res.status).toBe(200);
    expect(res.body.map(r => r.symbol)).toEqual(['NVDA']);
    expect(res.body[0].name).toBe('NVIDIA Corp');
    expect(res.body[0].exchangeShortName).toBe('US');
  });

  test('company name substring match fills after symbol matches', async () => {
    mockUniverse([
      { ticker: 'NVDA', companyName: 'NVIDIA Corp' },
      { ticker: 'XYZ',  companyName: 'Nvidia-adjacent Co' }, // name hit, no symbol hit
      { ticker: 'AAPL', companyName: 'Apple Inc' },
    ]);
    const res = await request(makeApp()).get('/api/search?q=nvidia');
    const symbols = res.body.map(r => r.symbol);
    // NVDA matches name (contains "NVIDIA"), XYZ matches name too — both surface
    expect(symbols).toContain('NVDA');
    expect(symbols).toContain('XYZ');
    expect(symbols).not.toContain('AAPL');
  });

  test('symbol prefix hits sort before name-only hits', async () => {
    mockUniverse([
      { ticker: 'ZZZ',  companyName: 'AppCo Inc' },     // name hit only
      { ticker: 'APP',  companyName: 'AppLovin' },      // symbol prefix hit
      { ticker: 'APPL', companyName: 'AppleTest' },     // symbol prefix hit
    ]);
    const res = await request(makeApp()).get('/api/search?q=app');
    const symbols = res.body.map(r => r.symbol);
    // Prefix matches first (any order between them), then name hits
    expect(symbols.slice(0, 2).sort()).toEqual(['APP', 'APPL']);
    expect(symbols[2]).toBe('ZZZ');
  });

  test('results capped at 10', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      ticker: `T${String(i).padStart(2, '0')}`,
      companyName: `Company ${i}`,
    }));
    mockUniverse(many);
    const res = await request(makeApp()).get('/api/search?q=t');
    expect(res.body.length).toBe(10);
  });

  test('universe not ready returns []', async () => {
    jest.spyOn(universe, 'isReady').mockReturnValue(false);
    jest.spyOn(universe, 'getCache').mockReturnValue(new Map());
    const res = await request(makeApp()).get('/api/search?q=nvda');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('query with no matches returns []', async () => {
    mockUniverse([{ ticker: 'NVDA', companyName: 'NVIDIA Corp' }]);
    const res = await request(makeApp()).get('/api/search?q=zzzxxx');
    expect(res.body).toEqual([]);
  });
});
