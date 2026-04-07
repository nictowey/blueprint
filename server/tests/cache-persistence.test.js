jest.mock('fs');
jest.mock('../services/fmp');

describe('saveCacheToDisk', () => {
  let fs;
  let saveCacheToDisk;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('fs');
    jest.mock('../services/fmp');
    fs = require('fs');
    fs.existsSync = jest.fn();
    fs.readFileSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.mkdirSync = jest.fn();
    process.env.CACHE_DIR = '/tmp/test-cache';
    ({ saveCacheToDisk } = require('../services/universe'));
  });

  const sampleCache = new Map([
    ['AAPL', { ticker: 'AAPL', companyName: 'Apple Inc', peRatio: 28.5 }],
    ['MSFT', { ticker: 'MSFT', companyName: 'Microsoft Corp', peRatio: 32.1 }],
  ]);

  test('writes JSON file containing savedAt timestamp and all stock entries', () => {
    saveCacheToDisk(sampleCache);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content] = fs.writeFileSync.mock.calls[0];
    expect(filePath).toContain('universe.json');
    const parsed = JSON.parse(content);
    expect(parsed.savedAt).toBeDefined();
    expect(new Date(parsed.savedAt).getTime()).toBeGreaterThan(0);
    expect(parsed.stocks).toHaveLength(2);
    expect(parsed.stocks[0][0]).toBe('AAPL');
    expect(parsed.stocks[1][0]).toBe('MSFT');
  });

  test('creates cache directory before writing', () => {
    saveCacheToDisk(sampleCache);
    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/test-cache', { recursive: true });
  });

  test('does not throw when write fails', () => {
    fs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });
    expect(() => saveCacheToDisk(sampleCache)).not.toThrow();
  });
});

describe('loadCacheFromDisk', () => {
  let fs;
  let loadCacheFromDisk;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('fs');
    jest.mock('../services/fmp');
    fs = require('fs');
    fs.existsSync = jest.fn();
    fs.readFileSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.mkdirSync = jest.fn();
    process.env.CACHE_DIR = '/tmp/test-cache';
    ({ loadCacheFromDisk } = require('../services/universe'));
  });

  test('returns null when cache file does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(loadCacheFromDisk()).toBeNull();
  });

  test('returns null when cache file is older than 24 hours', () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      savedAt: staleDate,
      stocks: [['AAPL', { ticker: 'AAPL' }]],
    }));
    expect(loadCacheFromDisk()).toBeNull();
  });

  test('returns a Map with all stock entries when cache is fresh', () => {
    const freshDate = new Date().toISOString();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      savedAt: freshDate,
      stocks: [
        ['AAPL', { ticker: 'AAPL', peRatio: 28.5 }],
        ['MSFT', { ticker: 'MSFT', peRatio: 32.1 }],
      ],
    }));

    const result = loadCacheFromDisk();
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get('AAPL').peRatio).toBe(28.5);
    expect(result.get('MSFT').peRatio).toBe(32.1);
  });

  test('returns null when cache file contains invalid JSON', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('not valid json {{{');
    expect(loadCacheFromDisk()).toBeNull();
  });
});
