import 'server-only';

import { getTmdbDetailsById, resolveTmdbTitle } from './autodownload/tmdbService';
import { ensureArtworkCached } from './artworkCache';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 4000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MAX_RESOLVED = 120;
const DEFAULT_MAX_SEARCH = 24;

const idCache = new Map();
const idInflight = new Map();
const queryCache = new Map();
const queryInflight = new Map();

function now() {
  return Date.now();
}

function normalizeMediaType(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'tv' || raw === 'series' ? 'tv' : 'movie';
}

function normalizeKind(value = '') {
  return normalizeMediaType(value) === 'tv' ? 'series' : 'movie';
}

function normalizeTitle(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYear(value = '') {
  const match = String(value || '').trim().match(/^(\d{4})/);
  return match ? match[1] : '';
}

export function parseTmdbId(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const s = String(value || '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const tagged = s.match(/tmdb[^0-9]{0,6}(\d{2,9})/i);
  return tagged ? Number(tagged[1]) : 0;
}

export function tmdbPosterUrl(pathValue, size = 'w500') {
  const path = String(pathValue || '').trim();
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : '';
}

export function tmdbBackdropUrl(pathValue, size = 'w1280') {
  const path = String(pathValue || '').trim();
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : '';
}

function mergeResolvedVisual(item, resolved) {
  if (!resolved) return item;

  const posterPath = String(resolved?.posterPath || item?.posterPath || '').trim();
  const backdropPath = String(resolved?.backdropPath || item?.backdropPath || '').trim();
  const poster = tmdbPosterUrl(posterPath);
  const backdrop = tmdbBackdropUrl(backdropPath);
  const fallbackImage = String(item?.imageFallback || item?.image || '').trim();

  return {
    ...item,
    tmdbId: parseTmdbId(resolved?.tmdbId || item?.tmdbId) || null,
    mediaType: normalizeMediaType(resolved?.mediaType || item?.mediaType || item?.kind),
    posterPath,
    backdropPath,
    image: poster || fallbackImage,
    imageFallback: fallbackImage,
    backdropImage: backdrop || item?.backdropImage || '',
    backdrop: backdrop || item?.backdrop || item?.backdropImage || '',
    year: String(item?.year || resolved?.year || '').trim() || null,
  };
}

function trimCache(cache) {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function readFresh(cache, key) {
  const entry = cache.get(key);
  if (!entry) return { hit: false, value: null };
  if (now() - Number(entry.at || 0) >= CACHE_TTL_MS) {
    cache.delete(key);
    return { hit: false, value: null };
  }
  return { hit: true, value: entry.value ?? null };
}

function writeFresh(cache, key, value) {
  cache.set(key, { at: now(), value: value ?? null });
  trimCache(cache);
  return value ?? null;
}

async function cachedLoad({ cache, inflight, key, loader }) {
  const cached = readFresh(cache, key);
  if (cached.hit) return cached.value;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const value = await loader();
      return writeFresh(cache, key, value);
    } catch {
      return writeFresh(cache, key, null);
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

function titleQueryKey({ kind = 'movie', title = '', year = '' } = {}) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return '';
  return `${normalizeMediaType(kind)}:${normalizedTitle}:${parseYear(year)}`;
}

function itemPrioritySignature(item = {}) {
  const tmdbId = parseTmdbId(item?.tmdbId);
  if (tmdbId > 0) return `tmdb:${normalizeMediaType(item?.mediaType || item?.kind)}:${tmdbId}`;
  const xuiId = Number(item?.id || item?.xuiId || 0);
  if (Number.isFinite(xuiId) && xuiId > 0) return `xui:${normalizeMediaType(item?.mediaType || item?.kind)}:${xuiId}`;
  const title = normalizeTitle(item?.title);
  const year = parseYear(item?.year);
  return `title:${normalizeMediaType(item?.mediaType || item?.kind)}:${title}:${year}`;
}

function itemLookupKey(item = {}) {
  return itemPrioritySignature(item);
}

function prioritizedItems(items = [], maxResolved = DEFAULT_MAX_RESOLVED) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(0, Number(maxResolved || 0) || 0);
  if (!limit || !list.length) return [];

  const seen = new Set();
  const out = [];
  const pushItems = (rows) => {
    for (const row of rows) {
      const key = itemPrioritySignature(row);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      if (out.length >= limit) break;
    }
  };

  pushItems(list.slice(0, limit));
  if (out.length < limit) {
    pushItems(
      [...list]
        .sort((a, b) => {
          const ratingDiff = Number(b?.rating || 0) - Number(a?.rating || 0);
          if (ratingDiff !== 0) return ratingDiff;
          const addedDiff = Number(b?.added || 0) - Number(a?.added || 0);
          if (addedDiff !== 0) return addedDiff;
          return String(a?.title || '').localeCompare(String(b?.title || ''));
        })
        .slice(0, limit)
    );
  }
  if (out.length < limit) {
    pushItems(
      [...list]
        .sort((a, b) => {
          const addedDiff = Number(b?.added || 0) - Number(a?.added || 0);
          if (addedDiff !== 0) return addedDiff;
          const ratingDiff = Number(b?.rating || 0) - Number(a?.rating || 0);
          if (ratingDiff !== 0) return ratingDiff;
          return String(a?.title || '').localeCompare(String(b?.title || ''));
        })
        .slice(0, limit)
    );
  }

  return out.slice(0, limit);
}

async function runLimited(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(limit || DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY);
  if (!list.length) return;

  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      await worker(list[index], index);
    }
  });
  await Promise.all(runners);
}

async function loadVisualById({ tmdbId, mediaType }) {
  const id = parseTmdbId(tmdbId);
  if (!(id > 0)) return null;
  const mt = normalizeMediaType(mediaType);
  const key = `${mt}:${id}`;
  return cachedLoad({
    cache: idCache,
    inflight: idInflight,
    key,
    loader: async () => {
      const details = await getTmdbDetailsById({ mediaType: mt, id });
      return {
        tmdbId: id,
        mediaType: mt,
        title: String(details?.title || '').trim(),
        year: String(details?.year || '').trim(),
        posterPath: String(details?.posterPath || '').trim(),
        backdropPath: String(details?.backdropPath || '').trim(),
      };
    },
  });
}

async function loadVisualByTitle({ kind = 'movie', title = '', year = '' }) {
  const key = titleQueryKey({ kind, title, year });
  if (!key) return null;
  return cachedLoad({
    cache: queryCache,
    inflight: queryInflight,
    key,
    loader: async () => {
      const details = await resolveTmdbTitle({ kind, title, year });
      if (!details?.ok) return null;
      return {
        tmdbId: parseTmdbId(details?.id),
        mediaType: normalizeMediaType(details?.mediaType || kind),
        title: String(details?.title || '').trim(),
        year: String(details?.year || '').trim(),
        posterPath: String(details?.posterPath || '').trim(),
        backdropPath: String(details?.backdropPath || '').trim(),
      };
    },
  });
}

function readCachedVisualForItem(item, kind) {
  const tmdbId = parseTmdbId(item?.tmdbId);
  if (tmdbId > 0) {
    return readFresh(idCache, `${normalizeMediaType(item?.mediaType || kind)}:${tmdbId}`);
  }
  const key = titleQueryKey({
    kind,
    title: item?.title,
    year: item?.year,
  });
  if (!key) return { hit: false, value: null };
  return readFresh(queryCache, key);
}

export async function hydrateCatalogItemsWithTmdb(items = [], { kind = 'movie', maxResolved = DEFAULT_MAX_RESOLVED, maxSearch = DEFAULT_MAX_SEARCH, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const priority = prioritizedItems(list, maxResolved);
  const results = new Map();

  const itemsWithTmdbId = priority.filter((item) => parseTmdbId(item?.tmdbId) > 0);
  const itemsWithoutTmdbId = priority.filter((item) => parseTmdbId(item?.tmdbId) <= 0).slice(0, Math.max(0, Number(maxSearch || 0) || 0));

  await runLimited(itemsWithTmdbId, concurrency, async (item) => {
    const value = await loadVisualById({
      tmdbId: item?.tmdbId,
      mediaType: item?.mediaType || kind,
    });
    results.set(itemLookupKey(item), value);
  });

  await runLimited(itemsWithoutTmdbId, concurrency, async (item) => {
    const value = await loadVisualByTitle({
      kind,
      title: item?.title,
      year: item?.year,
    });
    results.set(itemLookupKey(item), value);
  });

  return list.map((item) => {
    const key = itemLookupKey(item);
    const resolved = results.has(key) ? results.get(key) : readCachedVisualForItem(item, kind).value;
    return mergeResolvedVisual(item, resolved);
  });
}

export function applyCachedCatalogArtwork(items = [], { kind = 'movie' } = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => mergeResolvedVisual(item, readCachedVisualForItem(item, kind).value));
}

export async function warmCatalogArtwork(items = [], { kind = 'movie', maxResolved = DEFAULT_MAX_RESOLVED, maxSearch = DEFAULT_MAX_SEARCH, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  const priority = prioritizedItems(list, maxResolved);
  const itemsWithTmdbId = priority.filter((item) => parseTmdbId(item?.tmdbId) > 0);
  const itemsWithoutTmdbId = priority.filter((item) => parseTmdbId(item?.tmdbId) <= 0).slice(0, Math.max(0, Number(maxSearch || 0) || 0));

  await runLimited(itemsWithTmdbId, concurrency, async (item) => {
    await loadVisualById({
      tmdbId: item?.tmdbId,
      mediaType: item?.mediaType || kind,
    });
  });

  await runLimited(itemsWithoutTmdbId, concurrency, async (item) => {
    await loadVisualByTitle({
      kind,
      title: item?.title,
      year: item?.year,
    });
  });
}

export async function warmCatalogImageCache(
  items = [],
  { posterCount = 48, backdropCount = 12, concurrency = 6 } = {}
) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  const posterLimit = Math.max(0, Number(posterCount || 0) || 0);
  const backdropLimit = Math.max(0, Number(backdropCount || 0) || 0);
  const priority = prioritizedItems(list, Math.max(posterLimit, backdropLimit));
  const seen = new Set();
  const jobs = [];

  const pushSource = (source) => {
    const raw = String(source || '').trim();
    if (!raw || seen.has(raw)) return;
    seen.add(raw);
    jobs.push(raw);
  };

  if (posterLimit > 0) {
    for (const item of priority.slice(0, posterLimit)) {
      pushSource(item?.image);
    }
  }

  if (backdropLimit > 0) {
    for (const item of priority.slice(0, backdropLimit)) {
      pushSource(item?.backdropImage || item?.backdrop);
    }
  }

  await runLimited(jobs, concurrency, async (source) => {
    await ensureArtworkCached({ source }).catch(() => null);
  });
}
