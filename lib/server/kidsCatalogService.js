import 'server-only';

import { readJSON, writeJSON } from './blobStore';
import { getTmdbDetailsById, resolveTmdbTitle } from './autodownload/tmdbService';
import {
  getKidsSafetyCacheKey,
  normalizeKidsMediaType,
  normalizeKidsTitle,
  normalizeKidsYear,
  normalizeTmdbId,
} from '../kidsTmdbShared';

const STORE_KEY = 'kids_catalog_cache';
const STORE_VERSION = 1;
const ENTRY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_BACKGROUND_LIMIT = 180;

let memoryStore = null;
let loadPromise = null;
const inflightResolvers = new Map();
let writeQueue = Promise.resolve();

function emptyStore() {
  return {
    version: STORE_VERSION,
    updatedAt: 0,
    entries: {},
  };
}

function normalizeStore(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  return {
    version: STORE_VERSION,
    updatedAt: Number(base.updatedAt || 0) || 0,
    entries: base.entries && typeof base.entries === 'object' ? base.entries : {},
  };
}

async function loadStore() {
  if (memoryStore) return memoryStore;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const raw = await readJSON(STORE_KEY);
    memoryStore = normalizeStore(raw);
    loadPromise = null;
    return memoryStore;
  })();
  return loadPromise;
}

async function persistStore(nextStore) {
  memoryStore = normalizeStore(nextStore);
  writeQueue = writeQueue
    .catch(() => {})
    .then(() => writeJSON(STORE_KEY, memoryStore));
  await writeQueue;
}

function isFreshEntry(entry) {
  const updatedAt = Number(entry?.updatedAt || 0) || 0;
  if (!updatedAt) return false;
  return Date.now() - updatedAt < ENTRY_TTL_MS;
}

function lookupEntry(entries, item, mediaType) {
  const key = getKidsSafetyCacheKey(item, { mediaType });
  if (key && isFreshEntry(entries[key])) return { key, entry: entries[key] };

  const mt = normalizeKidsMediaType(mediaType || item?.mediaType || item?.kind);
  const title = normalizeKidsTitle(item?.title);
  const year = normalizeKidsYear(item?.year);
  const queryKey = title ? `q:${mt}:${title}:${year}` : '';
  if (queryKey && queryKey !== key && isFreshEntry(entries[queryKey])) {
    return { key: queryKey, entry: entries[queryKey] };
  }

  const tmdbId = normalizeTmdbId(item?.tmdbId);
  const idKey = tmdbId ? `id:${mt}:${tmdbId}` : '';
  if (idKey && idKey !== key && isFreshEntry(entries[idKey])) {
    return { key: idKey, entry: entries[idKey] };
  }

  return { key, entry: null };
}

function applyEntryToItem(item, entry) {
  if (!entry) return item;
  return {
    ...item,
    tmdbId: normalizeTmdbId(item?.tmdbId) || normalizeTmdbId(entry?.tmdbId) || null,
    kidsSafe: entry?.kidsSafe === true,
    kidsReason: String(entry?.kidsReason || '').trim(),
    certification: String(entry?.certification || '').trim(),
    contentRating: String(entry?.contentRating || '').trim(),
  };
}

function queryKeyForItem(item, mediaType) {
  const mt = normalizeKidsMediaType(mediaType || item?.mediaType || item?.kind);
  const title = normalizeKidsTitle(item?.title);
  if (!title) return '';
  const year = normalizeKidsYear(item?.year);
  return `q:${mt}:${title}:${year}`;
}

async function resolveEntry(item, mediaType) {
  const mt = normalizeKidsMediaType(mediaType || item?.mediaType || item?.kind);
  const primaryKey = getKidsSafetyCacheKey(item, { mediaType: mt });
  const queryKey = queryKeyForItem(item, mt);
  if (!primaryKey && !queryKey) return null;

  const inflightKey = primaryKey || queryKey;
  if (inflightResolvers.has(inflightKey)) return inflightResolvers.get(inflightKey);

  const promise = (async () => {
    let details = null;
    const tmdbId = normalizeTmdbId(item?.tmdbId);

    if (tmdbId) {
      details = await getTmdbDetailsById({ mediaType: mt, id: tmdbId }).catch(() => null);
    } else if (String(item?.title || '').trim()) {
      details = await resolveTmdbTitle({
        kind: mt === 'tv' ? 'series' : 'movie',
        title: item?.title,
        year: item?.year,
      }).catch(() => null);
    }

    const now = Date.now();
    const entry = {
      kidsSafe: details?.ok ? details?.kidsSafe === true : false,
      kidsReason: String(details?.kidsReason || (details?.ok ? 'Unknown' : 'Not found')).trim(),
      certification: String(details?.certification || '').trim(),
      contentRating: String(details?.contentRating || '').trim(),
      tmdbId: normalizeTmdbId(details?.tmdbId || details?.id || item?.tmdbId) || null,
      title: String(details?.title || item?.title || '').trim(),
      year: String(details?.year || item?.year || '').trim(),
      mediaType: mt,
      matched: details?.ok === true,
      updatedAt: now,
    };

    const updates = {};
    if (queryKey) updates[queryKey] = entry;
    if (entry.tmdbId) updates[`id:${mt}:${entry.tmdbId}`] = entry;
    if (primaryKey) updates[primaryKey] = entry;

    return { entry, updates };
  })().finally(() => {
    inflightResolvers.delete(inflightKey);
  });

  inflightResolvers.set(inflightKey, promise);
  return promise;
}

async function runLimited(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const concurrency = Math.max(1, Number(limit || DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY);
  const results = new Array(list.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function classifyMissingItems(items, mediaType) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return {};

  const resultMaps = await runLimited(rows, DEFAULT_CONCURRENCY, async (item) => {
    const resolved = await resolveEntry(item, mediaType);
    return resolved?.updates || {};
  });

  const updates = {};
  for (const map of resultMaps) {
    if (!map || typeof map !== 'object') continue;
    Object.assign(updates, map);
  }
  return updates;
}

async function mergeUpdates(updates = {}) {
  const keys = Object.keys(updates);
  if (!keys.length) return;
  const store = await loadStore();
  const nextStore = {
    ...store,
    updatedAt: Date.now(),
    entries: {
      ...store.entries,
      ...updates,
    },
  };
  await persistStore(nextStore);
}

export async function applyKidsCatalogTags(items = [], { mediaType = 'movie' } = {}) {
  const store = await loadStore();
  return (Array.isArray(items) ? items : []).map((item) => {
    const { entry } = lookupEntry(store.entries, item, mediaType);
    return applyEntryToItem(item, entry);
  });
}

export async function warmKidsCatalogTags(items = [], { mediaType = 'movie', backgroundLimit = DEFAULT_BACKGROUND_LIMIT } = {}) {
  const store = await loadStore();
  const candidates = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const key = getKidsSafetyCacheKey(item, { mediaType });
    const queryKey = queryKeyForItem(item, mediaType);
    const dedupeKey = key || queryKey;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const { entry } = lookupEntry(store.entries, item, mediaType);
    if (entry) continue;
    candidates.push(item);
    if (candidates.length >= backgroundLimit) break;
  }
  if (!candidates.length) return;
  const updates = await classifyMissingItems(candidates, mediaType);
  await mergeUpdates(updates);
}

export async function ensureKidsCatalogTags(items = [], { mediaType = 'movie' } = {}) {
  const store = await loadStore();
  const rows = Array.isArray(items) ? items : [];
  const missing = [];
  const seen = new Set();

  for (const item of rows) {
    const key = getKidsSafetyCacheKey(item, { mediaType }) || queryKeyForItem(item, mediaType);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const { entry } = lookupEntry(store.entries, item, mediaType);
    if (!entry) missing.push(item);
  }

  if (!missing.length) {
    return applyKidsCatalogTags(rows, { mediaType });
  }

  const updates = await classifyMissingItems(missing, mediaType);
  await mergeUpdates(updates);
  return applyKidsCatalogTags(rows, { mediaType });
}

export async function getKidsCatalogCacheSummary() {
  const store = await loadStore();
  const entries = store.entries && typeof store.entries === 'object' ? store.entries : {};
  return {
    updatedAt: Number(store.updatedAt || 0) || 0,
    total: Object.keys(entries).length,
  };
}

async function tagMixedItems(items, methodName) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return [];

  const movieIndexes = [];
  const tvIndexes = [];
  for (let index = 0; index < rows.length; index += 1) {
    const item = rows[index];
    const mediaType = normalizeKidsMediaType(item?.mediaType || item?.kind);
    if (mediaType === 'tv') tvIndexes.push(index);
    else movieIndexes.push(index);
  }

  const out = [...rows];
  if (movieIndexes.length) {
    const movieItems = movieIndexes.map((index) => rows[index]);
    const tagged = await (methodName === 'ensure'
      ? ensureKidsCatalogTags(movieItems, { mediaType: 'movie' })
      : applyKidsCatalogTags(movieItems, { mediaType: 'movie' }));
    movieIndexes.forEach((index, offset) => {
      out[index] = tagged[offset];
    });
  }
  if (tvIndexes.length) {
    const tvItems = tvIndexes.map((index) => rows[index]);
    const tagged = await (methodName === 'ensure'
      ? ensureKidsCatalogTags(tvItems, { mediaType: 'tv' })
      : applyKidsCatalogTags(tvItems, { mediaType: 'tv' }));
    tvIndexes.forEach((index, offset) => {
      out[index] = tagged[offset];
    });
  }
  return out;
}

export async function applyKidsCatalogTagsMixed(items = []) {
  return tagMixedItems(items, 'apply');
}

export async function ensureKidsCatalogTagsMixed(items = []) {
  return tagMixedItems(items, 'ensure');
}

export async function warmKidsCatalogTagsMixed(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const movies = rows.filter((item) => normalizeKidsMediaType(item?.mediaType || item?.kind) !== 'tv');
  const tv = rows.filter((item) => normalizeKidsMediaType(item?.mediaType || item?.kind) === 'tv');
  await Promise.all([
    movies.length ? warmKidsCatalogTags(movies, { mediaType: 'movie' }) : Promise.resolve(),
    tv.length ? warmKidsCatalogTags(tv, { mediaType: 'tv' }) : Promise.resolve(),
  ]);
}
