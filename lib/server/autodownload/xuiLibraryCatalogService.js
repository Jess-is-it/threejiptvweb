import 'server-only';

import { xuiApiCall } from './xuiService';

const DEFAULT_CACHE_MS = 5 * 60 * 1000;

let catalogCache = {
  at: 0,
  data: null,
};

export function clearXuiLibraryCatalogCache() {
  catalogCache = { at: 0, data: null };
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

function buildTitleSignatures(value) {
  const base = normalizeTitle(value);
  if (!base) return [];
  const out = new Set([base, base.replace(/\s+/g, '')]);
  const withoutTrailingYear = base.replace(/\s+\b(19|20)\d{2}\b$/, '').trim();
  if (withoutTrailingYear && withoutTrailingYear !== base) {
    out.add(withoutTrailingYear);
    out.add(withoutTrailingYear.replace(/\s+/g, ''));
  }
  return [...out].filter(Boolean);
}

function parseYear(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

function parseTmdbId(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const s = String(value || '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const tmdbTagged = s.match(/tmdb[^0-9]{0,6}(\d{2,9})/i);
  if (tmdbTagged) return Number(tmdbTagged[1]);
  return 0;
}

function parseMovieProperties(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function addCatalogEntry(setExact, setTitleOnly, setTmdbIds, { title, originalTitle = '', year = '', tmdbId = 0 } = {}) {
  const parsedTmdbId = parseTmdbId(tmdbId);
  if (parsedTmdbId > 0) setTmdbIds.add(parsedTmdbId);
  const signatures = new Set([...buildTitleSignatures(title), ...buildTitleSignatures(originalTitle)]);
  if (!signatures.size) return;
  const parsedYear = parseYear(year);
  for (const sig of signatures) {
    setTitleOnly.add(sig);
    if (parsedYear) setExact.add(`${sig}::${parsedYear}`);
  }
}

export async function getXuiLibraryCatalog({ maxAgeMs = DEFAULT_CACHE_MS, force = false } = {}) {
  const ttl = Math.max(0, Number(maxAgeMs || 0) || 0);
  const now = Date.now();
  if (!force && catalogCache.data && now - Number(catalogCache.at || 0) < ttl) return catalogCache.data;

  const [moviesRaw, seriesRaw] = await Promise.all([
    xuiApiCall({ action: 'get_movies', params: { limit: 5000 } }),
    xuiApiCall({ action: 'get_series_list', params: { limit: 5000 } }),
  ]);

  const movieExact = new Set();
  const movieTitleOnly = new Set();
  const movieTmdbIds = new Set();
  const seriesExact = new Set();
  const seriesTitleOnly = new Set();
  const seriesTmdbIds = new Set();

  for (const row of Array.isArray(moviesRaw?.data) ? moviesRaw.data : []) {
    const props = parseMovieProperties(row?.movie_properties);
    addCatalogEntry(movieExact, movieTitleOnly, movieTmdbIds, {
      title: props?.name || row?.stream_display_name || row?.title || '',
      originalTitle: props?.o_name || props?.name || '',
      year: props?.release_date || row?.year || props?.year || '',
      tmdbId: props?.tmdb_id || row?.tmdb_id || row?.tmdbId || 0,
    });
  }

  for (const row of Array.isArray(seriesRaw?.data) ? seriesRaw.data : []) {
    addCatalogEntry(seriesExact, seriesTitleOnly, seriesTmdbIds, {
      title: row?.title || row?.name || '',
      originalTitle: row?.o_name || row?.original_title || '',
      year: row?.release_date || row?.year || '',
      tmdbId: row?.tmdb_id || row?.tmdbId || 0,
    });
  }

  const data = {
    movieExact,
    movieTitleOnly,
    movieTmdbIds,
    seriesExact,
    seriesTitleOnly,
    seriesTmdbIds,
    fetchedAt: now,
  };
  catalogCache = { at: now, data };
  return data;
}

export function hasXuiCatalogMatch({ catalog, type = 'movie', title, originalTitle = '', year = null, tmdbId = null } = {}) {
  if (!catalog) return false;
  const isSeries = String(type || '').toLowerCase() === 'series';
  const parsedTmdbId = parseTmdbId(tmdbId);
  if (parsedTmdbId > 0) {
    if (isSeries && catalog.seriesTmdbIds.has(parsedTmdbId)) return true;
    if (!isSeries && catalog.movieTmdbIds.has(parsedTmdbId)) return true;
  }

  const parsedYear = parseYear(year);
  const signatures = new Set([...buildTitleSignatures(title), ...buildTitleSignatures(originalTitle)]);
  if (!signatures.size) return false;

  const exactSet = isSeries ? catalog.seriesExact : catalog.movieExact;
  const titleOnlySet = isSeries ? catalog.seriesTitleOnly : catalog.movieTitleOnly;
  if (parsedYear) {
    for (const sig of signatures) {
      if (exactSet.has(`${sig}::${parsedYear}`)) return true;
    }
  }
  for (const sig of signatures) {
    if (titleOnlySet.has(sig)) return true;
  }
  return false;
}
