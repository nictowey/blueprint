jest.mock('node-fetch');
jest.mock('../services/fmp');

const sampleEntries = [
  ['AAPL', { ticker: 'AAPL', companyName: 'Apple Inc', peRatio: 28.5 }],
  ['MSFT', { ticker: 'MSFT', companyName: 'Microsoft Corp', peRatio: 32.1 }],
];
const sampleCache = new Map(sampleEntries);

function setup() {
  jest.resetModules();
  jest.mock('node-fetch');
  jest.mock('../services/fmp');
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
  const fetch = require('node-fetch');
  const { saveCacheToRedis, loadCacheFromRedis } = require('../services/universe');
  return { fetch, saveCacheToRedis, loadCacheFromRedis };
}

describe('saveCacheToRedis', () => {
  test('POSTs a SET command with all stock entries, TTL, and version', async () => {
    const { fetch, saveCacheToRedis } = setup();
    fetch.mockResolvedValue({ ok: true, json: async () => ({ result: 'OK' }) });

    await saveCacheToRedis(sampleCache);

    // 2 calls: one for cache data, one for version
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://fake.upstash.io');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer fake-token');

    const body = JSON.parse(options.body);
    expect(body[0]).toBe('SET');
    expect(body[1]).toBe('universe_cache');
    const stored = JSON.parse(body[2]);
    expect(stored).toHaveLength(2);
    expect(stored[0][0]).toBe('AAPL');
    expect(body[3]).toBe('EX');
    expect(Number(body[4])).toBeGreaterThan(0);

    // Version call
    const versionBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(versionBody[0]).toBe('SET');
    expect(versionBody[1]).toBe('universe_cache_version');
  });

  test('does not throw when Redis request fails', async () => {
    const { fetch, saveCacheToRedis } = setup();
    fetch.mockRejectedValue(new Error('network error'));
    await expect(saveCacheToRedis(sampleCache)).resolves.toBeUndefined();
  });

  test('skips silently when env vars are not set', async () => {
    jest.resetModules();
    jest.mock('node-fetch');
    jest.mock('../services/fmp');
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetch = require('node-fetch');
    const { saveCacheToRedis } = require('../services/universe');

    await saveCacheToRedis(sampleCache);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('loadCacheFromRedis', () => {
  test('returns null when env vars are not set', async () => {
    jest.resetModules();
    jest.mock('node-fetch');
    jest.mock('../services/fmp');
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { loadCacheFromRedis } = require('../services/universe');

    expect(await loadCacheFromRedis()).toBeNull();
  });

  test('returns null on version mismatch', async () => {
    const { fetch, loadCacheFromRedis } = setup();
    fetch.mockResolvedValue({ ok: true, json: async () => ({ result: '1' }) });
    expect(await loadCacheFromRedis()).toBeNull();
  });

  test('returns null on a Redis cache miss', async () => {
    const { fetch, loadCacheFromRedis } = setup();
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: '3' }) }) // version OK
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: null }) }); // no data
    expect(await loadCacheFromRedis()).toBeNull();
  });

  test('returns a Map with all stock entries on a cache hit', async () => {
    const { fetch, loadCacheFromRedis } = setup();
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: '3' }) }) // version OK
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: JSON.stringify(sampleEntries) }) });

    const result = await loadCacheFromRedis();
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get('AAPL').peRatio).toBe(28.5);
    expect(result.get('MSFT').peRatio).toBe(32.1);
  });

  test('returns null when Redis returns corrupt data', async () => {
    const { fetch, loadCacheFromRedis } = setup();
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: '3' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'not valid json {{{' }) });
    expect(await loadCacheFromRedis()).toBeNull();
  });

  test('returns null when Redis request throws', async () => {
    const { fetch, loadCacheFromRedis } = setup();
    fetch.mockRejectedValue(new Error('network error'));
    expect(await loadCacheFromRedis()).toBeNull();
  });
});
