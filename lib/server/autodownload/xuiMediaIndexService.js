import 'server-only';

import { xuiApiCall } from './xuiService';

const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const XUI_MEDIA_INDEX_PAGE_BYTES = 8 * 1024 * 1024;
const XUI_MEDIA_INDEX_PAGE_SIZE = 100;
const XUI_MEDIA_INDEX_MAX_ROWS_PER_TYPE = 10000;

let cache = {
  at: 0,
  data: null,
};
let inflight = null;

export function clearXuiMediaIndexCache() {
  cache = { at: 0, data: null };
}

export function getCachedXuiMediaIndex({ maxAgeMs = DEFAULT_CACHE_MS } = {}) {
  const ttl = Math.max(0, Number(maxAgeMs || 0) || 0);
  if (cache.data && now() - Number(cache.at || 0) < ttl) return cache.data;
  return null;
}

function now() {
  return Date.now();
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYear(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
}

function parseTmdbId(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const match = String(value || '').match(/tmdb[^0-9]{0,6}(\d{2,9})/i);
  return match ? Number(match[1]) : 0;
}

function parseMovieProperties(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    return JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
}

function cleanSerializedImage(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:\/images\/|\/)([^\s"']+\.(?:jpg|jpeg|png|webp))/i);
  return match ? `/${String(match[1] || '').replace(/^\/+/, '')}` : raw;
}

function buildMovieEntry(row = {}) {
  const props = parseMovieProperties(row?.movie_properties);
  const xuiId = Number(row?.id || row?.stream_id || 0);
  const tmdbId = parseTmdbId(props?.tmdb_id || row?.tmdb_id || row?.tmdbId || 0);
  const title = String(props?.name || row?.stream_display_name || row?.title || '').trim();
  const originalTitle = String(props?.o_name || '').trim();
  const year = parseYear(props?.release_date || row?.year || props?.year || '');
  const image = cleanSerializedImage(props?.cover_big || props?.movie_image || row?.stream_icon || '');
  const filename = String(props?.filename || row?.stream_info?.filename || '').trim();
  return {
    type: 'movie',
    xuiId: Number.isFinite(xuiId) && xuiId > 0 ? xuiId : 0,
    tmdbId,
    title,
    originalTitle,
    year,
    normalizedTitle: normalizeTitle(title || originalTitle),
    image,
    filename,
  };
}

function buildSeriesEntry(row = {}) {
  const xuiId = Number(row?.id || row?.series_id || row?.series_no || 0);
  const tmdbId = parseTmdbId(row?.tmdb_id || row?.tmdbId || 0);
  const title = String(row?.title || row?.name || '').trim();
  const originalTitle = String(row?.o_name || row?.original_title || '').trim();
  const year = parseYear(row?.release_date || row?.year || '');
  const image = cleanSerializedImage(row?.cover || row?.series_cover || '');
  return {
    type: 'series',
    xuiId: Number.isFinite(xuiId) && xuiId > 0 ? xuiId : 0,
    tmdbId,
    title,
    originalTitle,
    year,
    normalizedTitle: normalizeTitle(title || originalTitle),
    image,
  };
}

function buildMaps(items = []) {
  const byXuiId = new Map();
  const byTmdbId = new Map();
  const byKey = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.xuiId) byXuiId.set(item.xuiId, item);
    if (item?.tmdbId) byTmdbId.set(item.tmdbId, item);
    const titleKey = `${item?.normalizedTitle || ''}::${item?.year || ''}`;
    if (item?.normalizedTitle && !byKey.has(titleKey)) byKey.set(titleKey, item);
    if (item?.normalizedTitle && !byKey.has(`${item.normalizedTitle}::`)) byKey.set(`${item.normalizedTitle}::`, item);
  }
  return { byXuiId, byTmdbId, byKey };
}

function normalizePositiveInt(value, fallback = 0) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function fetchPagedXuiRows({ action, pageSize = XUI_MEDIA_INDEX_PAGE_SIZE, maxRows = XUI_MEDIA_INDEX_MAX_ROWS_PER_TYPE } = {}) {
  const resolvedPageSize = Math.max(1, Math.min(250, normalizePositiveInt(pageSize, XUI_MEDIA_INDEX_PAGE_SIZE)));
  const resolvedMaxRows = Math.max(resolvedPageSize, normalizePositiveInt(maxRows, XUI_MEDIA_INDEX_MAX_ROWS_PER_TYPE));
  const rows = [];
  let start = 0;
  let expectedTotal = 0;

  while (rows.length < resolvedMaxRows) {
    const response = await xuiApiCall({
      action,
      params: { start, limit: resolvedPageSize },
      maxResponseBytes: XUI_MEDIA_INDEX_PAGE_BYTES,
    });
    const pageRows = Array.isArray(response?.data) ? response.data : [];
    if (!pageRows.length) break;

    rows.push(...pageRows.slice(0, Math.max(0, resolvedMaxRows - rows.length)));
    expectedTotal = Math.max(
      expectedTotal,
      normalizePositiveInt(response?.recordsTotal, 0),
      normalizePositiveInt(response?.recordsFiltered, 0)
    );

    start += pageRows.length;
    if (pageRows.length < resolvedPageSize) break;
    if (expectedTotal > 0 && start >= expectedTotal) break;
  }

  return {
    rows,
    total: expectedTotal || rows.length,
    truncated: rows.length >= resolvedMaxRows && (expectedTotal || rows.length) > resolvedMaxRows,
  };
}

async function refreshXuiMediaIndex() {
  const [moviesResult, seriesResult] = await Promise.all([
    fetchPagedXuiRows({ action: 'get_movies' }),
    fetchPagedXuiRows({ action: 'get_series_list' }),
  ]);

  const movies = moviesResult.rows.map(buildMovieEntry).filter((item) => item.xuiId > 0);
  const series = seriesResult.rows.map(buildSeriesEntry).filter((item) => item.xuiId > 0);
  const data = {
    movies,
    series,
    movieMaps: buildMaps(movies),
    seriesMaps: buildMaps(series),
    fetchedAt: now(),
    source: 'xui_paged',
    totals: {
      movies: moviesResult.total,
      series: seriesResult.total,
      moviesTruncated: Boolean(moviesResult.truncated),
      seriesTruncated: Boolean(seriesResult.truncated),
    },
  };
  cache = { at: now(), data };
  return data;
}

export async function getXuiMediaIndex({ maxAgeMs = DEFAULT_CACHE_MS, force = false } = {}) {
  const ttl = Math.max(0, Number(maxAgeMs || 0) || 0);
  if (!force && cache.data && now() - Number(cache.at || 0) < ttl) return cache.data;
  if (inflight) return inflight;

  inflight = refreshXuiMediaIndex().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function matchXuiMedia({ type = 'movie', tmdbId = 0, title = '', originalTitle = '', year = '', index = null } = {}) {
  const resolved = index && typeof index === 'object' ? index : null;
  if (!resolved) return null;
  const isSeries = String(type || '').toLowerCase() === 'series';
  const maps = isSeries ? resolved.seriesMaps : resolved.movieMaps;
  const parsedTmdbId = parseTmdbId(tmdbId);
  if (parsedTmdbId > 0 && maps.byTmdbId.has(parsedTmdbId)) return maps.byTmdbId.get(parsedTmdbId) || null;
  const keys = new Set();
  const y = parseYear(year);
  const titles = [title, originalTitle]
    .map((value) => normalizeTitle(value))
    .filter(Boolean);
  for (const value of titles) {
    keys.add(`${value}::${y}`);
    keys.add(`${value}::`);
  }
  for (const key of keys) {
    if (maps.byKey.has(key)) return maps.byKey.get(key) || null;
  }
  return null;
}
