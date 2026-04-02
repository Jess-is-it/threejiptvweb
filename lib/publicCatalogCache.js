'use client';

import { readJsonSafe } from './readJsonSafe';

const MOVIES_TTL_MS = 60 * 1000;
const SERIES_TTL_MS = 60 * 1000;
const cache = new Map();
const inflight = new Map();

function getFreshValue(key, ttlMs) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue(key, value) {
  cache.set(key, { ts: Date.now(), value });
  return value;
}

async function fetchWithCache(key, ttlMs, fetcher) {
  const cached = getFreshValue(key, ttlMs);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const value = await fetcher();
    if (value) setCachedValue(key, value);
    return value;
  })().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

function seriesKey(streamBase = '') {
  return `series:${String(streamBase || '').trim()}`;
}

function movieKey(streamBase = '') {
  return `movies:${String(streamBase || '').trim()}`;
}

export function readMovieCatalog(streamBase = '') {
  const key = movieKey(streamBase);
  if (!key.endsWith(':')) return getFreshValue(key, MOVIES_TTL_MS);
  return null;
}

export async function prefetchMovieCatalog(streamBase = '') {
  const normalizedStreamBase = String(streamBase || '').trim();
  if (!normalizedStreamBase) return null;

  const key = movieKey(normalizedStreamBase);
  return fetchWithCache(key, MOVIES_TTL_MS, async () => {
    const response = await fetch(`/api/xuione/vod?streamBase=${encodeURIComponent(normalizedStreamBase)}`, {
      cache: 'no-store',
    });
    const data = await readJsonSafe(response);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Failed to load movies');
    }
    return data;
  });
}

export function readSeriesCatalog(streamBase = '') {
  const key = seriesKey(streamBase);
  if (!key.endsWith(':')) return getFreshValue(key, SERIES_TTL_MS);
  return null;
}

export async function prefetchSeriesCatalog(streamBase = '') {
  const normalizedStreamBase = String(streamBase || '').trim();
  if (!normalizedStreamBase) return null;

  const key = seriesKey(normalizedStreamBase);
  return fetchWithCache(key, SERIES_TTL_MS, async () => {
    const response = await fetch(`/api/xuione/series?streamBase=${encodeURIComponent(normalizedStreamBase)}`, {
      cache: 'no-store',
    });
    const data = await readJsonSafe(response);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Failed to load series');
    }
    return data;
  });
}
