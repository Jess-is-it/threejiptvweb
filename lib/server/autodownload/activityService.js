import 'server-only';

import { xuiApiCall } from './xuiService';
import { getXuiMediaIndex } from './xuiMediaIndexService';
import { getTmdbDetailsById } from './tmdbService';

const DEFAULT_LIMIT = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/original';

function now() {
  return Date.now();
}

function toTimestampSeconds(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toTimestampMs(value) {
  const n = toTimestampSeconds(value);
  return n > 0 ? n * 1000 : 0;
}

function normalizeContainer(value) {
  return String(value || '').trim().toUpperCase();
}

function detectType(row = {}) {
  const seriesNo = Number(row?.series_no || 0);
  if (Number.isFinite(seriesNo) && seriesNo > 0) return 'series';
  return 'movie';
}

function resolveXuiId(row = {}) {
  const type = detectType(row);
  if (type === 'series') {
    const seriesNo = Number(row?.series_no || 0);
    return Number.isFinite(seriesNo) && seriesNo > 0 ? seriesNo : 0;
  }
  const streamId = Number(row?.stream_id || 0);
  return Number.isFinite(streamId) && streamId > 0 ? streamId : 0;
}

function normalizeActivityRow(row = {}, index = null) {
  if (normalizeContainer(row?.container) !== 'VOD') return null;
  const type = detectType(row);
  const xuiId = resolveXuiId(row);
  if (!(xuiId > 0)) return null;
  const isSeries = type === 'series';
  const maps = isSeries ? index?.seriesMaps : index?.movieMaps;
  const matched = maps?.byXuiId?.get(xuiId) || null;
  const startedAt = toTimestampMs(row?.date_start);
  const endedAt = toTimestampMs(row?.date_end);
  const timestamp = Math.max(startedAt, endedAt);
  const username = String(row?.username || row?.user_id || '').trim();
  return {
    type,
    xuiId,
    tmdbId: Number(matched?.tmdbId || 0) || 0,
    title: String(matched?.title || row?.stream_display_name || '').trim(),
    year: String(matched?.year || '').trim(),
    image: String(matched?.image || '').trim(),
    backdropImage: String(matched?.backdropImage || matched?.backdrop_image || '').trim(),
    username,
    userId: String(row?.user_id || '').trim(),
    userIp: String(row?.user_ip || '').trim(),
    startedAt,
    endedAt,
    timestamp,
    streamDisplayName: String(row?.stream_display_name || '').trim(),
    raw: row,
  };
}

function tmdbImageUrl(pathValue) {
  const raw = String(pathValue || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `${TMDB_IMAGE_BASE}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

export async function fetchXuiActivityEntries({ limit = DEFAULT_LIMIT, maxAgeDays = 120 } = {}) {
  const max = Math.max(1, Math.min(5000, Number(limit || DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const [raw, index] = await Promise.all([
    xuiApiCall({ action: 'activity_logs', params: { limit: max } }),
    getXuiMediaIndex({ maxAgeMs: 5 * 60 * 1000, force: false }).catch(() => null),
  ]);
  const cutoff = maxAgeDays > 0 ? now() - maxAgeDays * DAY_MS : 0;
  return (Array.isArray(raw?.data) ? raw.data : [])
    .map((row) => normalizeActivityRow(row, index))
    .filter(Boolean)
    .filter((row) => !cutoff || Number(row.timestamp || 0) >= cutoff)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}

function aggregateRows(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = `${row.type}:${row.xuiId}`;
    const current = groups.get(key) || {
      key,
      type: row.type,
      xuiId: row.xuiId,
      tmdbId: Number(row.tmdbId || 0) || 0,
      title: row.title,
      year: row.year,
      image: row.image,
      playCount: 0,
      viewerSet: new Set(),
      lastWatchedAt: 0,
      recentRows: [],
    };
    current.playCount += 1;
    if (row.username) current.viewerSet.add(row.username.toLowerCase());
    else if (row.userId) current.viewerSet.add(`id:${row.userId}`);
    else if (row.userIp) current.viewerSet.add(`ip:${row.userIp}`);
    current.lastWatchedAt = Math.max(current.lastWatchedAt, Number(row.timestamp || 0));
    if (current.recentRows.length < 25) current.recentRows.push(row);
    groups.set(key, current);
  }

  return [...groups.values()].map((row) => ({
    ...row,
    viewerCount: row.viewerSet.size,
    viewerSet: undefined,
  }));
}

export async function getActivitySummary({ limit = DEFAULT_LIMIT, recentLimit = 200 } = {}) {
  const rows = await fetchXuiActivityEntries({ limit });
  const recent = rows.slice(0, Math.max(1, Math.min(1000, Number(recentLimit || 200) || 200)));
  const aggregates = aggregateRows(rows);
  const topMovies = aggregates
    .filter((row) => row.type === 'movie')
    .sort((a, b) => Number(b.viewerCount || 0) - Number(a.viewerCount || 0) || Number(b.playCount || 0) - Number(a.playCount || 0) || Number(b.lastWatchedAt || 0) - Number(a.lastWatchedAt || 0))
    .slice(0, 10);
  const topSeries = aggregates
    .filter((row) => row.type === 'series')
    .sort((a, b) => Number(b.viewerCount || 0) - Number(a.viewerCount || 0) || Number(b.playCount || 0) - Number(a.playCount || 0) || Number(b.lastWatchedAt || 0) - Number(a.lastWatchedAt || 0))
    .slice(0, 10);

  const enrichTopRows = async (items = [], mediaType = 'movie') => {
    const enriched = await Promise.all(
      items.map(async (row) => {
        const tmdbId = Number(row?.tmdbId || 0);
        if (!(tmdbId > 0)) return row;
        try {
          const details = await getTmdbDetailsById({ mediaType: mediaType === 'series' ? 'tv' : 'movie', id: tmdbId });
          return {
            ...row,
            image: row?.image || tmdbImageUrl(details?.posterPath),
            backdropImage: row?.backdropImage || tmdbImageUrl(details?.backdropPath),
          };
        } catch {
          return row;
        }
      })
    );
    return enriched;
  };

  const [topMoviesEnriched, topSeriesEnriched] = await Promise.all([
    enrichTopRows(topMovies, 'movie'),
    enrichTopRows(topSeries, 'series'),
  ]);
  return {
    rows: recent,
    topMovies: topMoviesEnriched,
    topSeries: topSeriesEnriched,
    fetchedAt: now(),
  };
}

export async function getRecentWatchMap({ watchWindowDays = 7, limit = DEFAULT_LIMIT } = {}) {
  const rows = await fetchXuiActivityEntries({ limit, maxAgeDays: Math.max(7, watchWindowDays + 7) });
  const cutoff = watchWindowDays > 0 ? now() - watchWindowDays * DAY_MS : 0;
  const movieMap = new Map();
  const seriesMap = new Map();
  for (const row of rows) {
    if (cutoff && Number(row.timestamp || 0) < cutoff) continue;
    const target = row.type === 'series' ? seriesMap : movieMap;
    const prev = Number(target.get(row.xuiId) || 0);
    if (row.timestamp > prev) target.set(row.xuiId, row.timestamp);
  }
  return { movieMap, seriesMap, fetchedAt: now() };
}
