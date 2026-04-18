import 'server-only';

const DEFAULT_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 32;

const cache = new Map();
const inflight = new Map();

function now() {
  return Date.now();
}

function trimCache() {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function readFresh(key, ttlMs) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (now() - Number(entry.at || 0) >= ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value ?? null;
}

export async function loadPublicCatalogData(key, loader, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return loader();
  }

  const cached = readFresh(normalizedKey, ttlMs);
  if (cached) return cached;

  const existing = inflight.get(normalizedKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const value = await loader();
      cache.set(normalizedKey, { at: now(), value });
      trimCache();
      return value;
    } finally {
      inflight.delete(normalizedKey);
    }
  })();

  inflight.set(normalizedKey, promise);
  return promise;
}

export function clearPublicCatalogDataCache(prefix = '') {
  const normalizedPrefix = String(prefix || '').trim();
  if (!normalizedPrefix) {
    cache.clear();
    inflight.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (String(key).startsWith(normalizedPrefix)) cache.delete(key);
  }
  for (const key of Array.from(inflight.keys())) {
    if (String(key).startsWith(normalizedPrefix)) inflight.delete(key);
  }
}
