const store = new Map();

/**
 * Wrap an async function so its result is cached by key for `ttlMs` milliseconds.
 * Usage: const cachedGet = withCache(fmpGet, 5 * 60 * 1000);
 */
function withCache(fn, ttlMs = 5 * 60 * 1000) {
  return async function cached(key, ...args) {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && now - hit.ts < ttlMs) return hit.value;
    const value = await fn(key, ...args);
    store.set(key, { value, ts: now });
    return value;
  };
}

module.exports = { withCache };
