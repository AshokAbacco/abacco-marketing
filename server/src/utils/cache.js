// src/utils/cache.js
//
// In-process cache shared by controllers and middleware.
//
// NOTE: this cache is per PROCESS. The API and the worker each have their
// own copy, so the worker cannot invalidate API cache entries — keep TTLs
// short for anything the worker changes (campaign status, counts).
import NodeCache from "node-cache";

const cache = new NodeCache({
  stdTTL: 60, // default TTL in seconds
  checkperiod: 120, // expired-key sweep interval
  // useClones:false — node-cache deep-clones every value on get() AND set()
  // by default. For multi-KB JSON payloads polled every few seconds that
  // clone cost is pure CPU waste. Callers must treat cached values as
  // read-only (never mutate what get() returns).
  useClones: false,
});

// In-flight de-duplication: when many requests miss the same key at the
// same moment, only ONE of them hits the database; the rest await it.
const inflight = new Map();

/**
 * Return the cached value for `key`, or compute it with `loader()`, cache it
 * for `ttlSeconds`, and return it. Concurrent callers share one load.
 * `undefined` / `null` results are not cached.
 */
export async function getOrSet(key, ttlSeconds, loader) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await loader();
      if (value !== undefined && value !== null) {
        cache.set(key, value, ttlSeconds);
      }
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** Delete every key that starts with `prefix`. */
export function delByPrefix(prefix) {
  const keys = cache.keys().filter((k) => k.startsWith(prefix));
  if (keys.length) cache.del(keys);
  return keys.length;
}

/** cache.set that logs instead of throwing. */
export function safeSet(key, value, ttlSeconds) {
  try {
    return cache.set(key, value, ttlSeconds);
  } catch (err) {
    console.warn(`⚠️ cache.set failed for ${key}: ${err.message}`);
    return false;
  }
}

export default cache;
