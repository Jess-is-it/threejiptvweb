'use client';

import { readJsonSafe } from './readJsonSafe';

const MOVIES_TTL_MS = 60 * 1000;
const SERIES_TTL_MS = 60 * 1000;
const UPCOMING_TTL_MS = 60 * 1000;
const LEAVING_SOON_TTL_MS = 60 * 1000;
const SESSION_STORAGE_PREFIX = '3jtv.public-catalog:';
const cache = new Map();
const inflight = new Map();

function opaqueKeyPart(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(36)}`;
}

function readSessionStorageValue(key, ttlMs) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${SESSION_STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - Number(parsed?.ts || 0) > ttlMs) {
      window.sessionStorage.removeItem(`${SESSION_STORAGE_PREFIX}${key}`);
      return null;
    }
    return parsed?.value ?? null;
  } catch {
    return null;
  }
}

function writeSessionStorageValue(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      `${SESSION_STORAGE_PREFIX}${key}`,
      JSON.stringify({ ts: Date.now(), value })
    );
  } catch {}
}

function clearSessionStorageValue(key) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(`${SESSION_STORAGE_PREFIX}${key}`);
  } catch {}
}

function getFreshValue(key, ttlMs, { persistToSession = false } = {}) {
  const entry = cache.get(key);
  if (entry) {
    if (Date.now() - entry.ts > ttlMs) {
      cache.delete(key);
    } else {
      return entry.value;
    }
  }
  if (!persistToSession) return null;
  const stored = readSessionStorageValue(key, ttlMs);
  if (stored) {
    cache.set(key, { ts: Date.now(), value: stored });
  }
  return stored;
}

function setCachedValue(key, value, { persistToSession = false } = {}) {
  cache.set(key, { ts: Date.now(), value });
  if (persistToSession) writeSessionStorageValue(key, value);
  return value;
}

async function fetchWithCache(key, ttlMs, fetcher, { persistToSession = false, validate } = {}) {
  const cached = getFreshValue(key, ttlMs, { persistToSession });
  if (cached) {
    const ok = typeof validate === 'function' ? Boolean(validate(cached)) : true;
    if (ok) return cached;
    cache.delete(key);
    if (persistToSession) clearSessionStorageValue(key);
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const value = await fetcher();
    if (value) setCachedValue(key, value, { persistToSession });
    return value;
  })().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

function seriesKey(streamBase = '', { resolveKids = false } = {}) {
  return `series:${opaqueKeyPart(streamBase)}:${resolveKids ? 'kids' : 'base'}`;
}

function movieKey(streamBase = '', { resolveKids = false } = {}) {
  return `movies:${opaqueKeyPart(streamBase)}:${resolveKids ? 'kids' : 'base'}`;
}

function upcomingKey({ username = '', state = 'upcoming', mediaType = 'all', limit = 40 } = {}) {
  return `upcoming:${String(state || 'upcoming').trim().toLowerCase()}:${String(mediaType || 'all').trim().toLowerCase()}:${Number(limit || 40) || 40}:${String(username || '').trim().toLowerCase()}`;
}

function leavingSoonKey({ mediaType = 'all', limit = 40 } = {}) {
  return `leaving:${String(mediaType || 'all').trim().toLowerCase()}:${Number(limit || 40) || 40}`;
}

function hasKidsSafetyMetadata(items = []) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return true;
  return list.every((item) => {
    if (!String(item?.title || '').trim()) return true;
    return typeof item?.kidsSafe === 'boolean';
  });
}

export function readMovieCatalog(streamBase = '', { resolveKids = false } = {}) {
  const key = movieKey(streamBase, { resolveKids });
  if (!key.endsWith(':')) {
    return getFreshValue(key, MOVIES_TTL_MS, { persistToSession: true });
  }
  return null;
}

export async function prefetchMovieCatalog(streamBase = '', { resolveKids = false } = {}) {
  const normalizedStreamBase = String(streamBase || '').trim();
  if (!normalizedStreamBase) return null;

  const key = movieKey(normalizedStreamBase, { resolveKids });
  return fetchWithCache(key, MOVIES_TTL_MS, async () => {
    const params = new URLSearchParams();
    params.set('streamBase', normalizedStreamBase);
    if (resolveKids) params.set('resolveKids', '1');
    const response = await fetch(`/api/xuione/vod?${params.toString()}`, {
      cache: 'no-store',
    });
    const data = await readJsonSafe(response);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Failed to load movies');
    }
    return data;
  }, {
    persistToSession: true,
    validate: (data) => {
      if (!data?.ok || !Array.isArray(data.items)) return false;
      if (data.items.length === 0) return true;
      return data.items.some((item) => String(item?.genre || item?.categoryName || '').trim());
    },
  });
}

export function readSeriesCatalog(streamBase = '', { resolveKids = false } = {}) {
  const key = seriesKey(streamBase, { resolveKids });
  if (!key.endsWith(':')) {
    return getFreshValue(key, SERIES_TTL_MS, { persistToSession: true });
  }
  return null;
}

export async function prefetchSeriesCatalog(streamBase = '', { resolveKids = false } = {}) {
  const normalizedStreamBase = String(streamBase || '').trim();
  if (!normalizedStreamBase) return null;

  const key = seriesKey(normalizedStreamBase, { resolveKids });
  return fetchWithCache(key, SERIES_TTL_MS, async () => {
    const params = new URLSearchParams();
    params.set('streamBase', normalizedStreamBase);
    if (resolveKids) params.set('resolveKids', '1');
    const response = await fetch(`/api/xuione/series?${params.toString()}`, {
      cache: 'no-store',
    });
    const data = await readJsonSafe(response);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'Failed to load series');
    }
    return data;
  }, {
    persistToSession: true,
    validate: (data) => {
      if (!data?.ok || !Array.isArray(data.items)) return false;
      if (data.items.length === 0) return true;
      return data.items.some((item) => String(item?.genre || item?.categoryName || '').trim());
    },
  });
}

export function readUpcomingCatalog({ username = '', state = 'upcoming', mediaType = 'all', limit = 40 } = {}) {
  return getFreshValue(upcomingKey({ username, state, mediaType, limit }), UPCOMING_TTL_MS, {
    persistToSession: true,
  });
}

export async function prefetchUpcomingCatalog({ username = '', state = 'upcoming', mediaType = 'all', limit = 40 } = {}) {
  const key = upcomingKey({ username, state, mediaType, limit });
  return fetchWithCache(
    key,
    UPCOMING_TTL_MS,
    async () => {
      const params = new URLSearchParams();
      if (username) params.set('username', String(username).trim());
      if (state) params.set('state', String(state).trim());
      if (mediaType) params.set('mediaType', String(mediaType).trim());
      params.set('limit', String(Number(limit || 40) || 40));
      const response = await fetch(`/api/public/autodownload/upcoming?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load upcoming titles');
      }
      return data;
    },
    {
      persistToSession: true,
      validate: (data) => {
        if (!data?.ok || !Array.isArray(data.items)) return false;
        return hasKidsSafetyMetadata(data.items);
      },
    }
  );
}

export function readLeavingSoonCatalog({ mediaType = 'all', limit = 40 } = {}) {
  return getFreshValue(leavingSoonKey({ mediaType, limit }), LEAVING_SOON_TTL_MS, {
    persistToSession: true,
  });
}

export async function prefetchLeavingSoonCatalog({ mediaType = 'all', limit = 40 } = {}) {
  const key = leavingSoonKey({ mediaType, limit });
  return fetchWithCache(
    key,
    LEAVING_SOON_TTL_MS,
    async () => {
      const params = new URLSearchParams();
      if (mediaType) params.set('mediaType', String(mediaType).trim());
      params.set('limit', String(Number(limit || 40) || 40));
      const response = await fetch(`/api/public/autodownload/leaving-soon?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await readJsonSafe(response);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load leaving soon titles');
      }
      return data;
    },
    {
      persistToSession: true,
      validate: (data) => {
        if (!data?.ok || !Array.isArray(data.items)) return false;
        return hasKidsSafetyMetadata(data.items);
      },
    }
  );
}
