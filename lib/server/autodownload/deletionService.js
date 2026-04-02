import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { createUserNotification } from '../notifications';
import { decryptString } from '../vault';
import { getAutodownloadSettings, getEngineHost } from './autodownloadDb';
import { fetchMountStatus, fetchVodStorageDevices } from './mountService';
import { SSHService } from './sshService';
import { getTmdbDetailsById } from './tmdbService';
import { xuiApiCall } from './xuiService';
import { getRecentWatchMap } from './activityService';
import { clearXuiMediaIndexCache, getXuiMediaIndex, matchXuiMedia } from './xuiMediaIndexService';
import { clearXuiLibraryCatalogCache } from './xuiLibraryCatalogService';
import { addDaysToDateKey, dateKeyInTimezone, normalizeReleaseTimezone } from './releaseSchedule';
import { computeVolumeState, deriveStoragePolicy, gbToBytes } from './storagePolicy';

const DAY_MS = 24 * 60 * 60 * 1000;
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const TMDB_VISUAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const tmdbVisualCache = new Map();

function now() {
  return Date.now();
}

function normalizeType(type) {
  return String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
}

function toQueueKey(type) {
  return normalizeType(type) === 'series' ? 'downloadsSeries' : 'downloadsMovies';
}

function rowKey(tmdbId, mediaType) {
  const mt = String(mediaType || '').trim().toLowerCase() === 'tv' ? 'tv' : 'movie';
  return `${mt}:${Number(tmdbId || 0)}`;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function posterUrl(pathValue) {
  const p = String(pathValue || '').trim();
  return p ? `${TMDB_IMAGE_BASE}/w500${p}` : '/placeholders/poster-fallback.jpg';
}

function backdropUrl(pathValue) {
  const p = String(pathValue || '').trim();
  return p ? `${TMDB_IMAGE_BASE}/w1280${p}` : '';
}

async function getTmdbVisualFallback({ tmdbId, mediaType } = {}) {
  const id = Number(tmdbId || 0);
  if (!Number.isFinite(id) || id <= 0) return null;
  const mt = String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  const key = `${mt}:${id}`;
  const cached = tmdbVisualCache.get(key);
  if (cached && now() - Number(cached.at || 0) < TMDB_VISUAL_CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const details = await getTmdbDetailsById({ mediaType: mt, id });
    const value = {
      posterPath: String(details?.posterPath || '').trim(),
      backdropPath: String(details?.backdropPath || '').trim(),
      overview: String(details?.overview || '').trim(),
      rating: details?.rating ?? null,
      genres: Array.isArray(details?.genres) ? details.genres : [],
      title: String(details?.title || '').trim(),
      releaseDate: String(details?.releaseDate || '').trim(),
      year: String(details?.year || '').trim(),
    };
    tmdbVisualCache.set(key, { at: now(), value });
    return value;
  } catch {
    tmdbVisualCache.set(key, { at: now(), value: null });
    return null;
  }
}

function shQuote(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
}

function toMinutes(value, fallback = 0) {
  const raw = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return fallback;
  const [hh, mm] = raw.split(':').map((item) => Number(item));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return hh * 60 + mm;
}

function shiftDateKey(dateKey, deltaDays = 0) {
  const match = String(dateKey || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKeyInTimezone(now(), 'Asia/Manila');
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  dt.setUTCDate(dt.getUTCDate() + Math.floor(Number(deltaDays || 0) || 0));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function zonedPartsAt(timestamp, timeZone) {
  const tz = normalizeReleaseTimezone(timeZone);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(Number(timestamp || now())));
  const pick = (type) => parts.find((entry) => entry.type === type)?.value || '';
  return {
    year: Number(pick('year') || 0),
    month: Number(pick('month') || 0),
    day: Number(pick('day') || 0),
    hour: Number(pick('hour') || 0),
    minute: Number(pick('minute') || 0),
  };
}

function zonedDateTimeToUtcMs({ dateKey, timeHHMM = '00:00', timeZone = 'Asia/Manila' } = {}) {
  const match = String(dateKey || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const [hours, minutes] = String(timeHHMM || '00:00')
    .trim()
    .split(':')
    .map((value) => Number(value || 0));
  let guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(hours || 0), Number(minutes || 0), 0, 0);
  for (let index = 0; index < 3; index += 1) {
    const parts = zonedPartsAt(guess, timeZone);
    const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(hours || 0), Number(minutes || 0), 0, 0);
    const actual = Date.UTC(parts.year, Math.max(0, parts.month - 1), parts.day, parts.hour, parts.minute, 0, 0);
    const delta = desired - actual;
    if (!delta) break;
    guess += delta;
  }
  return guess;
}

function zonedClockParts(timeZone, at = now()) {
  const tz = normalizeReleaseTimezone(timeZone);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(Number(at || now())));
  const hour = Number(parts.find((entry) => entry.type === 'hour')?.value || 0);
  const minute = Number(parts.find((entry) => entry.type === 'minute')?.value || 0);
  return {
    timeZone: tz,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
}

function deletionPreviewTimeZone(settings = {}) {
  return normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
}

function buildPreviewCycleMeta({ nowTs = now(), settings = {} } = {}) {
  const refreshTime = String(settings?.deletion?.previewRefreshTime || '00:00').trim() || '00:00';
  const timeZone = deletionPreviewTimeZone(settings);
  const currentDateKey = dateKeyInTimezone(nowTs, timeZone);
  const currentClock = zonedClockParts(timeZone, nowTs);
  const refreshMinutes = toMinutes(refreshTime, 0);
  const cycleDate = currentClock.minutes >= refreshMinutes ? currentDateKey : shiftDateKey(currentDateKey, -1);
  const nextRefreshDate = shiftDateKey(cycleDate, 1);
  return {
    cycleKey: `${cycleDate}@${refreshTime}`,
    cycleDate,
    refreshTime,
    refreshMinutes,
    timeZone,
    nextRefreshDate,
  };
}

function emptyPreviewGroup() {
  return {
    items: [],
    totalVodBytes: 0,
    totalNasBytes: 0,
    totalEstimatedBytes: 0,
  };
}

function makeEmptyDeletionPreview(settings = {}, reason = '') {
  const cycle = buildPreviewCycleMeta({ settings });
  return {
    generatedAt: now(),
    refreshedAt: now(),
    cycleKey: cycle.cycleKey,
    refreshTime: cycle.refreshTime,
    timeZone: cycle.timeZone,
    reason: String(reason || '').trim(),
    targetBytes: 0,
    totalVodBytes: 0,
    totalNasBytes: 0,
    totalEstimatedBytes: 0,
    counts: { movies: 0, series: 0, total: 0 },
    seriesCandidateCount: 0,
    seriesEligible: false,
    movie: emptyPreviewGroup(),
    series: emptyPreviewGroup(),
    nextRefreshDate: cycle.nextRefreshDate,
    lastError: '',
  };
}

function previewNeedsVisualRefresh(preview = null) {
  if (!preview || typeof preview !== 'object') return true;
  if (!preview.protectionMode) return true;
  if (!preview.sortMode) return true;
  if (!preview.diagnostics || typeof preview.diagnostics !== 'object') return true;
  const groups = [preview?.movie?.items, preview?.series?.items];
  for (const rows of groups) {
    for (const item of Array.isArray(rows) ? rows : []) {
      const tmdbId = Number(item?.tmdbId || 0) || 0;
      const image = String(item?.image || '').trim();
      if (tmdbId > 0 && image === '/placeholders/poster-fallback.jpg') return true;
    }
  }
  return false;
}

function previewNeedsProtectionFallback(preview = null) {
  if (!preview || typeof preview !== 'object') return false;
  const mode = String(preview?.protectionMode || '').trim().toLowerCase();
  const diagnostics = preview?.diagnostics && typeof preview.diagnostics === 'object' ? preview.diagnostics : {};
  const strictEligible = Number(diagnostics?.strictEligible || 0) || 0;
  const actionableCandidates = Number(diagnostics?.actionableCandidates || 0) || 0;
  return mode === 'strict' && strictEligible === 0 && actionableCandidates > 0;
}

function canReusePreviewForPageLoad(preview = null, settings = {}) {
  if (!preview || typeof preview !== 'object') return false;
  const cycle = buildPreviewCycleMeta({ settings });
  const currentReason = String(preview?.reason || '').trim().toLowerCase();
  return (
    preview?.cycleKey === cycle.cycleKey &&
    currentReason !== 'disabled' &&
    !previewNeedsVisualRefresh(preview) &&
    !previewNeedsProtectionFallback(preview)
  );
}

function buildPreviewDiagnostics(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const actionable = rows.filter((row) => row.vodExists || row.libraryExists);
  return {
    totalCandidates: rows.length,
    actionableCandidates: actionable.length,
    missingTargets: rows.filter((row) => !row.vodExists && !row.libraryExists).length,
    protectedByAge: actionable.filter((row) => row.protectedByAge).length,
    protectedByWatch: actionable.filter((row) => row.protectedByWatch).length,
    strictEligible: actionable.filter((row) => !row.protectedByAge && !row.protectedByWatch).length,
  };
}

function sshFromEngineHost(engineHost) {
  return new SSHService({
    host: engineHost.host,
    port: engineHost.port,
    username: engineHost.username,
    authType: engineHost.authType,
    password: engineHost.passwordEnc ? decryptString(engineHost.passwordEnc) : '',
    privateKey: engineHost.privateKeyEnc ? decryptString(engineHost.privateKeyEnc) : '',
    passphrase: engineHost.passphraseEnc ? decryptString(engineHost.passphraseEnc) : '',
    sudoPassword: engineHost.sudoPasswordEnc ? decryptString(engineHost.sudoPasswordEnc) : '',
  });
}

function titleSortTimestamp(row = {}) {
  const values = [row?.releasedAt, row?.cleanedAt, row?.completedAt, row?.addedAt, row?.updatedAt].map((value) => Number(value || 0) || 0);
  return values.find((value) => value > 0) || 0;
}

function parseReleaseTimestamp(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function deriveReleaseDate(row = {}) {
  const tmdb = row?.tmdb && typeof row.tmdb === 'object' ? row.tmdb : {};
  const direct = String(tmdb?.releaseDate || tmdb?.firstAirDate || '').trim();
  if (direct) return direct;
  const year = String(tmdb?.year || row?.year || '').trim();
  return /^\d{4}$/.test(year) ? `${year}-01-01` : '';
}

function findReminderSubscribers(db, tmdbId, mediaType) {
  const rows = Array.isArray(db?.upcomingReminders) ? db.upcomingReminders : [];
  const key = rowKey(tmdbId, mediaType);
  const row = rows.find((entry) => rowKey(entry?.tmdbId, entry?.mediaType) === key);
  return (Array.isArray(row?.subscribers) ? row.subscribers : [])
    .map((entry) => normalizeUsername(entry?.username))
    .filter(Boolean);
}

function buildCandidateFromDownload(row = {}, { type, xuiIndex, watchMap }) {
  const mediaType = normalizeType(type) === 'series' ? 'tv' : 'movie';
  const tmdb = row?.tmdb && typeof row.tmdb === 'object' ? row.tmdb : {};
  const matched = matchXuiMedia({
    type,
    tmdbId: tmdb?.id || 0,
    title: tmdb?.title || row?.title || '',
    originalTitle: '',
    year: tmdb?.year || row?.year || '',
    index: xuiIndex,
  });
  const xuiId = Number(matched?.xuiId || 0) || 0;
  const lastWatchedAt = Number((normalizeType(type) === 'series' ? watchMap?.seriesMap : watchMap?.movieMap)?.get(xuiId) || 0) || 0;
  const releaseDate = deriveReleaseDate(row);
  return {
    queueId: String(row?.id || '').trim(),
    type: normalizeType(type),
    mediaType,
    tmdbId: Number(tmdb?.id || 0) || 0,
    xuiId,
    title: String(tmdb?.title || row?.title || '').trim(),
    year: String(tmdb?.year || row?.year || '').trim(),
    rating: tmdb?.rating ?? null,
    genres: Array.isArray(tmdb?.genres) ? tmdb.genres : [],
    overview: String(tmdb?.overview || row?.overview || '').trim(),
    posterPath: String(tmdb?.posterPath || '').trim(),
    backdropPath: String(tmdb?.backdropPath || '').trim(),
    image: posterUrl(tmdb?.posterPath),
    backdropImage: backdropUrl(tmdb?.backdropPath),
    finalTargetDir: String(row?.finalTargetDir || row?.finalDir || '').trim(),
    libraryPath: String(row?.finalTargetDir || row?.finalDir || '').trim(),
    releaseState: String(row?.releaseState || '').trim().toLowerCase(),
    status: String(row?.status || '').trim(),
    releasedAt: Number(row?.releasedAt || 0) || 0,
    completedAt: Number(row?.completedAt || 0) || 0,
    cleanedAt: Number(row?.cleanedAt || 0) || 0,
    addedAt: Number(row?.addedAt || 0) || 0,
    ageTimestamp: titleSortTimestamp(row),
    releaseDate,
    releaseTimestamp: parseReleaseTimestamp(releaseDate),
    lastWatchedAt,
    sourceSizeBytes: Number(row?.sizeBytes || 0) || 0,
    matchedXui: matched || null,
  };
}

async function hydrateCandidateVisuals(items = []) {
  const rows = Array.isArray(items) ? items : [];
  return Promise.all(
    rows.map(async (row) => {
      let posterPath = String(row?.posterPath || '').trim();
      let backdropPath = String(row?.backdropPath || '').trim();
      let overview = String(row?.overview || '').trim();
      let rating = row?.rating ?? null;
      let genres = Array.isArray(row?.genres) ? row.genres : [];
      let title = String(row?.title || '').trim();
      let year = String(row?.year || '').trim();
      let releaseDate = String(row?.releaseDate || '').trim();

      if (!posterPath || !backdropPath) {
        const fallback = await getTmdbVisualFallback({ tmdbId: row?.tmdbId, mediaType: row?.mediaType });
        if (fallback) {
          if (!posterPath) posterPath = String(fallback.posterPath || '').trim();
          if (!backdropPath) backdropPath = String(fallback.backdropPath || '').trim();
          if (!overview) overview = String(fallback.overview || '').trim();
          if ((rating === null || rating === undefined) && fallback.rating !== null && fallback.rating !== undefined) rating = fallback.rating;
          if ((!genres || !genres.length) && Array.isArray(fallback.genres)) genres = fallback.genres;
          if (!title) title = String(fallback.title || '').trim();
          if (!year) year = String(fallback.year || '').trim();
          if (!releaseDate) releaseDate = String(fallback.releaseDate || '').trim();
        }
      }

      return {
        ...row,
        title,
        year,
        overview,
        rating,
        genres,
        releaseDate,
        releaseTimestamp: parseReleaseTimestamp(releaseDate) || Number(row?.releaseTimestamp || 0) || 0,
        posterPath,
        backdropPath,
        image: posterUrl(posterPath),
        backdropImage: backdropUrl(backdropPath),
      };
    })
  );
}

async function hydrateCandidateReleaseDates(items = []) {
  const rows = Array.isArray(items) ? items : [];
  return Promise.all(
    rows.map(async (row) => {
      let releaseDate = String(row?.releaseDate || '').trim();
      const year = String(row?.year || '').trim();
      const yearFallback = /^\d{4}$/.test(year) ? `${year}-01-01` : '';
      const needsTmdbDate = !releaseDate || releaseDate === yearFallback || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate);
      if (needsTmdbDate && Number(row?.tmdbId || 0) > 0) {
        const fallback = await getTmdbVisualFallback({ tmdbId: row?.tmdbId, mediaType: row?.mediaType });
        if (fallback?.releaseDate) releaseDate = String(fallback.releaseDate || '').trim();
      }
      if (!releaseDate) {
        if (/^\d{4}$/.test(year)) releaseDate = `${year}-01-01`;
      }
      return {
        ...row,
        releaseDate,
        releaseTimestamp: parseReleaseTimestamp(releaseDate) || Number(row?.releaseTimestamp || 0) || 0,
      };
    })
  );
}

async function pathStats({ ssh, pathValue } = {}) {
  const target = String(pathValue || '').trim();
  if (!ssh || !target) return { exists: false, sizeBytes: 0 };
  const cmd = [
    'set -euo pipefail',
    `TARGET=${shQuote(target)}`,
    'if [ ! -e "$TARGET" ]; then',
    '  echo "__EXISTS__:0"',
    '  echo "__SIZE__:0"',
    '  exit 0',
    'fi',
    'size=$(du -sb "$TARGET" 2>/dev/null | awk "{print \$1}" | head -n1)',
    'echo "__EXISTS__:1"',
    'echo "__SIZE__:${size:-0}"',
  ].join('\n');
  const result = await ssh.exec(cmd, { sudo: true, timeoutMs: 120000 });
  const out = String(result?.stdout || '');
  const exists = /__EXISTS__:1/.test(out);
  const sizeMatch = out.match(/__SIZE__:(\d+)/);
  return { exists, sizeBytes: sizeMatch ? Number(sizeMatch[1] || 0) : 0 };
}

async function vodStatsForIds({ ssh, vodRoot, ids = [] } = {}) {
  const root = String(vodRoot || '').trim().replace(/\/+$/, '');
  const cleanIds = [...new Set((Array.isArray(ids) ? ids : []).map((value) => Number(value || 0)).filter((value) => Number.isFinite(value) && value > 0))];
  if (!ssh || !root || !cleanIds.length) {
    return { exists: false, sizeBytes: 0, matchedIds: [] };
  }
  const patterns = cleanIds.map((id) => `-name ${shQuote(`${id}.*`)} -o -name ${shQuote(String(id))}`).join(' -o ');
  const cmd = [
    'set -euo pipefail',
    `ROOT=${shQuote(root)}`,
    'if [ ! -d "$ROOT" ]; then',
    '  echo "__EXISTS__:0"',
    '  echo "__SIZE__:0"',
    '  exit 0',
    'fi',
    `find "$ROOT" -maxdepth 1 -type f \\( ${patterns} \\) -printf '__FILE__:%f\\t%s\\n' 2>/dev/null || true`,
  ].join('\n');
  const result = await ssh.exec(cmd, { sudo: true, timeoutMs: 120000 });
  const out = String(result?.stdout || '');
  const files = out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('__FILE__:'))
    .map((line) => line.replace(/^__FILE__:/, ''))
    .map((line) => {
      const [name, sizeText] = line.split('\t');
      const id = Number(String(name || '').split('.')[0] || 0) || 0;
      return {
        id,
        sizeBytes: Number(sizeText || 0) || 0,
      };
    })
    .filter((entry) => entry.id > 0);
  return {
    exists: files.length > 0,
    sizeBytes: files.reduce((sum, entry) => sum + (Number(entry.sizeBytes || 0) || 0), 0),
    matchedIds: [...new Set(files.map((entry) => entry.id))],
  };
}

async function getSeriesEpisodeIds(seriesId, cacheMap) {
  const key = Number(seriesId || 0) || 0;
  if (!(key > 0)) return [];
  if (cacheMap?.has(key)) return cacheMap.get(key) || [];
  try {
    const response = await xuiApiCall({ action: 'get_series_info', params: { series_id: key } });
    const episodes = response?.episodes && typeof response.episodes === 'object' ? response.episodes : {};
    const ids = [];
    for (const rows of Object.values(episodes)) {
      for (const episode of Array.isArray(rows) ? rows : []) {
        const episodeId = Number(episode?.id || episode?.episode_id || 0) || 0;
        if (episodeId > 0) ids.push(episodeId);
      }
    }
    const unique = [...new Set(ids)];
    if (cacheMap) cacheMap.set(key, unique);
    return unique;
  } catch {
    if (cacheMap) cacheMap.set(key, []);
    return [];
  }
}

async function enrichCandidatesWithStorage({ candidates = [], ssh = null, vodStorage = null, nasOnline = true } = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) return rows;
  const vodRoot = String(vodStorage?.resolvedPath || vodStorage?.preferredPath || '').trim();
  const seriesEpisodeCache = new Map();
  for (const row of rows) {
    if (nasOnline) {
      const nasStats = await pathStats({ ssh, pathValue: row.libraryPath }).catch(() => ({ exists: false, sizeBytes: 0 }));
      row.libraryExists = nasStats.exists;
      row.nasExists = nasStats.exists;
      row.nasSizeBytes = Number(nasStats.sizeBytes || 0) || 0;
    } else {
      row.libraryExists = false;
      row.nasExists = false;
      row.nasSizeBytes = 0;
    }
    const vodIds =
      normalizeType(row?.type) === 'series'
        ? await getSeriesEpisodeIds(row?.xuiId, seriesEpisodeCache)
        : Number(row?.xuiId || 0) > 0
          ? [Number(row.xuiId)]
          : [];
    row.vodIds = vodIds;
    const vodStats =
      ssh && vodRoot && vodIds.length
        ? await vodStatsForIds({ ssh, vodRoot, ids: vodIds }).catch(() => ({ exists: false, sizeBytes: 0, matchedIds: [] }))
        : { exists: false, sizeBytes: 0, matchedIds: [] };
    row.vodExists = Boolean(vodStats.exists);
    row.vodSizeBytes = Number(vodStats.sizeBytes || 0) || 0;
    row.vodMatchedIds = Array.isArray(vodStats.matchedIds) ? vodStats.matchedIds : [];
    row.targetSizeBytes = row.vodSizeBytes || row.nasSizeBytes || Number(row.sourceSizeBytes || 0) || 0;
    row.estimatedSizeBytes = row.vodSizeBytes || row.nasSizeBytes || Number(row.sourceSizeBytes || 0) || 0;
  }
  return rows;
}

async function removePath({ ssh, pathValue } = {}) {
  const target = String(pathValue || '').trim();
  if (!ssh || !target) return { ok: false, skipped: true, reason: 'missing_path' };
  const cmd = [
    'set -euo pipefail',
    `TARGET=${shQuote(target)}`,
    'if [ ! -e "$TARGET" ]; then',
    '  echo "__MISSING__"',
    '  exit 0',
    'fi',
    'rm -rf "$TARGET"',
    'if [ -e "$TARGET" ]; then',
    '  echo "__FAILED__"',
    'else',
    '  echo "__REMOVED__"',
    'fi',
  ].join('\n');
  const result = await ssh.exec(cmd, { sudo: true, timeoutMs: 120000 });
  const out = String(result?.stdout || '');
  return {
    ok: !/__FAILED__/.test(out),
    removed: /__REMOVED__/.test(out),
    missing: /__MISSING__/.test(out),
  };
}

function isPendingDeletionItem(item = {}) {
  const status = String(item?.status || '').trim().toLowerCase();
  return status === 'scheduled' || status === 'leaving_soon' || status === 'deleting' || status === '';
}

function existingScheduledKeys(db, type = 'all') {
  const logs = Array.isArray(db?.deletionLogs) ? db.deletionLogs : [];
  const out = new Set();
  for (const log of logs) {
    const logType = normalizeType(log?.deletionType || 'movie');
    if (type !== 'all' && logType !== normalizeType(type)) continue;
    for (const item of Array.isArray(log?.items) ? log.items : []) {
      if (!isPendingDeletionItem(item)) continue;
      const key = `${logType}:${Number(item?.tmdbId || 0)}:${Number(item?.xuiId || 0)}`;
      out.add(key);
    }
  }
  return out;
}

function buildVolumeStates({ mountStatus, vodStorage, settings }) {
  const nasTotalBytes = Number(mountStatus?.space?.total || 0);
  const vodTotalBytes = Number(vodStorage?.logical?.size || 0);
  const primaryTotalBytes = vodTotalBytes > 0 ? vodTotalBytes : nasTotalBytes;
  const policy = deriveStoragePolicy({ settings, totalBytes: primaryTotalBytes });
  const nasPolicy = deriveStoragePolicy({ settings, totalBytes: nasTotalBytes || primaryTotalBytes });
  const nasState = computeVolumeState({
    label: 'nas',
    totalBytes: nasTotalBytes,
    usedBytes: Number(mountStatus?.space?.used || 0),
    availBytes: Number(mountStatus?.space?.avail || 0),
    policy: nasPolicy,
  });
  const vodState = computeVolumeState({
    label: 'vod',
    totalBytes: vodTotalBytes,
    usedBytes: Number(vodStorage?.logical?.used || 0),
    availBytes: Number(vodStorage?.logical?.avail || 0),
    policy,
  });
  vodState.resolvedPath = String(vodStorage?.resolvedPath || vodStorage?.preferredPath || '').trim();
  vodState.source = String(vodStorage?.logical?.source || '').trim();
  vodState.fstype = String(vodStorage?.logical?.fstype || '').trim();
  vodState.poolType = String(vodStorage?.logical?.poolType || '').trim();
  vodState.memberDiskCount = Number(vodStorage?.memberDiskCount || 0) || 0;
  return { policy, nasState, vodState };
}

function buildTriggerSummary({ nasState, vodState, policy }) {
  const primary = Number(vodState?.totalBytes || 0) > 0 ? vodState : nasState;
  const active = Boolean(primary?.triggerReached);
  return {
    active,
    triggerReached: active,
    triggeredVolume: active ? primary?.label || '' : '',
    policy,
    nas: nasState,
    vod: vodState,
  };
}

async function collectCandidates({ db, settings, watchMap, xuiIndex }) {
  const scheduledKeys = existingScheduledKeys(db, 'all');
  const movieRows = (Array.isArray(db?.downloadsMovies) ? db.downloadsMovies : [])
    .filter((row) => String(row?.releaseState || '').trim().toLowerCase() === 'released')
    .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'deleted')
    .filter((row) => String(row?.deletionState || '').trim().toLowerCase() !== 'deleted')
    .map((row) => buildCandidateFromDownload(row, { type: 'movie', xuiIndex, watchMap }))
    .filter((row) => row.tmdbId > 0 || row.xuiId > 0);
  const seriesRows = (Array.isArray(db?.downloadsSeries) ? db.downloadsSeries : [])
    .filter((row) => String(row?.releaseState || '').trim().toLowerCase() === 'released')
    .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'deleted')
    .filter((row) => String(row?.deletionState || '').trim().toLowerCase() !== 'deleted')
    .map((row) => buildCandidateFromDownload(row, { type: 'series', xuiIndex, watchMap }))
    .filter((row) => row.tmdbId > 0 || row.xuiId > 0);

  const nowMs = now();
  const policy = deriveStoragePolicy({ settings, totalBytes: Number(db?.mountStatus?.space?.total || 0) });
  const all = [...movieRows, ...seriesRows]
    .filter((row) => !scheduledKeys.has(`${row.type}:${Number(row.tmdbId || 0)}:${Number(row.xuiId || 0)}`))
    .map((row) => {
      const ageDays = row.ageTimestamp > 0 ? Math.floor((nowMs - row.ageTimestamp) / DAY_MS) : 99999;
      const watchedDays = row.lastWatchedAt > 0 ? Math.floor((nowMs - row.lastWatchedAt) / DAY_MS) : null;
      return {
        ...row,
        ageDays,
        watchedDays,
        protectedByAge: ageDays < Number(policy.protectRecentReleaseDays || 0),
        protectedByWatch: row.lastWatchedAt > 0 && watchedDays !== null && watchedDays < Number(policy.protectRecentWatchDays || 0),
      };
    })
    .sort((a, b) => Number(a.ageTimestamp || 0) - Number(b.ageTimestamp || 0) || String(a.title || '').localeCompare(String(b.title || '')));
  return { all, policy, movieCount: movieRows.length, seriesCount: seriesRows.length };
}

function chooseCandidates(
  candidates = [],
  {
    targetBytes = 0,
    seriesEligible = true,
    maxSeriesPerBatch = 1,
    allowProtectionBypass = false,
    bypassOnlyWhenEmpty = false,
  } = {}
) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const strictRows = rows.filter((row) => !row.protectedByAge && !row.protectedByWatch);
  const oldestReleaseRows = [...rows].sort((a, b) => {
    const aRelease = Number(a?.releaseTimestamp || 0) || 0;
    const bRelease = Number(b?.releaseTimestamp || 0) || 0;
    const aRank = aRelease > 0 ? aRelease : Number.MAX_SAFE_INTEGER;
    const bRank = bRelease > 0 ? bRelease : Number.MAX_SAFE_INTEGER;
    return aRank - bRank || String(a?.title || '').localeCompare(String(b?.title || ''));
  });
  const selected = [];
  const seen = new Set();
  let selectedTargetBytes = 0;
  let selectedSeriesCount = 0;
  const addRows = (list = [], allow = () => true) => {
    for (const row of list) {
      const key = `${row.type}:${row.tmdbId}:${row.xuiId}`;
      if (seen.has(key)) continue;
      if (!allow(row)) continue;
      if (normalizeType(row?.type) === 'series') {
        if (!seriesEligible) continue;
        if (Number(maxSeriesPerBatch || 0) >= 0 && selectedSeriesCount >= Number(maxSeriesPerBatch || 0)) continue;
      }
      selected.push(row);
      seen.add(key);
      if (normalizeType(row?.type) === 'series') selectedSeriesCount += 1;
      selectedTargetBytes += Number(row?.targetSizeBytes || row?.vodSizeBytes || row?.estimatedSizeBytes || row?.sourceSizeBytes || 0) || 0;
      if (targetBytes > 0 && selectedTargetBytes >= targetBytes) return true;
    }
    return false;
  };

  if (addRows(strictRows)) return selected;
  if (!allowProtectionBypass) return selected;

  if (!strictRows.length) {
    if (!bypassOnlyWhenEmpty && addRows(oldestReleaseRows, (row) => !row.protectedByAge)) return selected;
    addRows(oldestReleaseRows);
    return selected;
  }

  if (bypassOnlyWhenEmpty) return selected;
  if (addRows(rows, (row) => !row.protectedByAge)) return selected;
  addRows(rows);
  return selected;
}

function deriveDeleteAt({ delayDays = 3, scheduledAt = now(), timeZone = 'Asia/Manila', executionTime = '00:00' } = {}) {
  const tz = normalizeReleaseTimezone(timeZone);
  const baseDate = dateKeyInTimezone(scheduledAt, tz);
  const deleteDate = addDaysToDateKey(baseDate, Math.max(0, Number(delayDays || 0)));
  return zonedDateTimeToUtcMs({ dateKey: deleteDate, timeHHMM: executionTime, timeZone: tz }) || scheduledAt + Math.max(0, Number(delayDays || 0)) * DAY_MS;
}

function formatDateKey(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function summarizePreviewItems(items = []) {
  const rows = Array.isArray(items) ? items : [];
  return {
    items: rows,
    totalVodBytes: rows.reduce((sum, row) => sum + (Number(row?.vodSizeBytes || 0) || 0), 0),
    totalNasBytes: rows.reduce((sum, row) => sum + (Number(row?.nasSizeBytes || 0) || 0), 0),
    totalEstimatedBytes: rows.reduce((sum, row) => sum + (Number(row?.estimatedSizeBytes || 0) || 0), 0),
  };
}

function toPreviewItem(row = {}) {
  return {
    queueId: row.queueId,
    type: normalizeType(row.type),
    mediaType: row.mediaType,
    tmdbId: row.tmdbId,
    xuiId: row.xuiId,
    title: row.title,
    year: row.year,
    rating: row.rating,
    genres: Array.isArray(row.genres) ? row.genres : [],
    overview: row.overview,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    image: row.image,
    backdropImage: row.backdropImage,
    libraryPath: row.libraryPath,
    libraryExists: Boolean(row.libraryExists),
    vodExists: Boolean(row.vodExists),
    vodIds: Array.isArray(row.vodIds) ? row.vodIds : [],
    sourceSizeBytes: Number(row.sourceSizeBytes || 0) || 0,
    targetSizeBytes: Number(row.targetSizeBytes || 0) || 0,
    estimatedSizeBytes: Number(row.estimatedSizeBytes || 0) || 0,
    vodSizeBytes: Number(row.vodSizeBytes || 0) || 0,
    nasSizeBytes: Number(row.nasSizeBytes || 0) || 0,
    releaseState: row.releaseState,
    releaseDate: row.releaseDate,
    ageDays: row.ageDays,
    lastWatchedAt: row.lastWatchedAt,
    watchedDays: row.watchedDays,
    protectedByAge: Boolean(row.protectedByAge),
    protectedByWatch: Boolean(row.protectedByWatch),
  };
}

function buildLogItem(row = {}, { type, deleteAt, deleteDate }) {
  return {
    id: crypto.randomUUID(),
    queueId: row.queueId,
    type,
    mediaType: row.mediaType,
    tmdbId: row.tmdbId,
    xuiId: row.xuiId,
    title: row.title,
    year: row.year,
    rating: row.rating,
    genres: row.genres,
    overview: row.overview,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    image: row.image,
    backdropImage: row.backdropImage,
    libraryPath: row.libraryPath,
    libraryExists: Boolean(row.libraryExists),
    vodExists: Boolean(row.vodExists),
    vodIds: Array.isArray(row.vodIds) ? row.vodIds : [],
    vodSizeBytes: Number(row.vodSizeBytes || 0) || 0,
    nasSizeBytes: Number(row.nasSizeBytes || 0) || 0,
    estimatedSizeBytes: Number(row.estimatedSizeBytes || 0) || 0,
    releaseState: row.releaseState,
    releaseDate: row.releaseDate,
    ageDays: row.ageDays,
    lastWatchedAt: row.lastWatchedAt,
    watchedDays: row.watchedDays,
    protectedByAge: Boolean(row.protectedByAge),
    protectedByWatch: Boolean(row.protectedByWatch),
    deleteAt,
    deleteDate,
    status: 'scheduled',
    leavingSoonNotifiedAt: null,
    deletedAt: null,
    nasDeleteStatus: row.libraryPath ? (row.libraryExists ? 'pending' : 'missing') : 'missing',
    vodDeleteStatus: row.xuiId > 0 ? 'pending' : 'missing',
    xuiDeleteStatus: row.xuiId > 0 ? 'pending' : 'missing_in_xui',
    deletedTargets: '',
    error: '',
  };
}

async function ensureDeletionPreview({
  db,
  settings,
  vodStorage,
  force = false,
  reason = '',
  allowProtectionBypass = false,
} = {}) {
  const deletionSettings = settings?.deletion || {};
  const cycle = buildPreviewCycleMeta({ settings });
  const currentPreview = db?.deletionPreview && typeof db.deletionPreview === 'object' ? db.deletionPreview : null;
  const currentReason = String(currentPreview?.reason || '').trim().toLowerCase();
  const currentMode = String(currentPreview?.protectionMode || 'strict').trim().toLowerCase() || 'strict';
  const requestedMode = allowProtectionBypass ? 'bypass' : 'strict';
  const reusableFallbackMode = !allowProtectionBypass && currentMode === 'bypass_oldest_release';
  if (
    !force &&
    currentPreview?.cycleKey === cycle.cycleKey &&
    currentReason !== 'disabled' &&
    !previewNeedsVisualRefresh(currentPreview) &&
    !previewNeedsProtectionFallback(currentPreview) &&
    (currentMode === requestedMode || reusableFallbackMode)
  ) {
    return currentPreview;
  }

  const nextPreview = makeEmptyDeletionPreview(settings, reason || 'daily_refresh');
  nextPreview.refreshTime = cycle.refreshTime;
  nextPreview.timeZone = cycle.timeZone;
  nextPreview.cycleKey = cycle.cycleKey;
  nextPreview.nextRefreshDate = cycle.nextRefreshDate;
  nextPreview.targetBytes = gbToBytes(deletionSettings?.deleteBatchTargetGb);

  try {
    const xuiIndex = await getXuiMediaIndex({ maxAgeMs: 5 * 60 * 1000, force: true }).catch(() => null);
    const watchMap = await getRecentWatchMap({
      watchWindowDays: Number(deletionSettings?.protectRecentWatchDays || 0) || 7,
      limit: 5000,
    }).catch(() => ({ movieMap: new Map(), seriesMap: new Map() }));
    const { all, seriesCount } = await collectCandidates({ db, settings, watchMap, xuiIndex });

    const engineHost = await getEngineHost();
    const ssh = engineHost?.host ? sshFromEngineHost(engineHost) : null;
    const nasOnline = Boolean(db?.mountStatus?.ok && db?.mountStatus?.writable);
    let connectedSsh = null;
    try {
      if (ssh) {
        try {
          await ssh.connect({ timeoutMs: 20000 });
          connectedSsh = ssh;
        } catch {}
      }
      await enrichCandidatesWithStorage({ candidates: all, ssh: connectedSsh, vodStorage, nasOnline });
    } finally {
      if (ssh) await ssh.close();
    }

    const actionableCandidates = all.filter((row) => row.vodExists || row.libraryExists);
    const diagnostics = buildPreviewDiagnostics(all);
    const seriesEligibleThreshold = Math.max(0, Math.floor(Number(deletionSettings?.seriesEligibleThreshold ?? 10) || 10));
    const maxSeriesPerBatch = Math.max(0, Math.floor(Number(deletionSettings?.maxSeriesPerBatch ?? 1) || 1));
    const seriesEligible = seriesCount > seriesEligibleThreshold;
    const targetBytes = gbToBytes(deletionSettings?.deleteBatchTargetGb);
    const strictSelected = chooseCandidates(actionableCandidates, {
      targetBytes,
      seriesEligible,
      maxSeriesPerBatch,
      allowProtectionBypass: false,
    });
    const usedFallbackBypass = !strictSelected.length && actionableCandidates.length > 0;
    const fallbackCandidates = usedFallbackBypass ? await hydrateCandidateReleaseDates(actionableCandidates) : actionableCandidates;
    const selected = await hydrateCandidateVisuals(
      usedFallbackBypass
        ? chooseCandidates(fallbackCandidates, {
            targetBytes,
            seriesEligible,
            maxSeriesPerBatch,
            allowProtectionBypass: true,
            bypassOnlyWhenEmpty: true,
          })
        : chooseCandidates(actionableCandidates, {
            targetBytes,
            seriesEligible,
            maxSeriesPerBatch,
            allowProtectionBypass,
          })
    );
    const previewItems = selected.map(toPreviewItem);
    const movieItems = previewItems.filter((item) => normalizeType(item.type) === 'movie');
    const seriesItems = previewItems.filter((item) => normalizeType(item.type) === 'series');
    const movie = summarizePreviewItems(movieItems);
    const series = summarizePreviewItems(seriesItems);

    db.deletionPreview = {
      generatedAt: now(),
      refreshedAt: now(),
      cycleKey: cycle.cycleKey,
      refreshTime: cycle.refreshTime,
      timeZone: cycle.timeZone,
      reason: reason || 'daily_refresh',
      protectionMode: usedFallbackBypass ? 'bypass_oldest_release' : requestedMode,
      sortMode: usedFallbackBypass ? 'tmdb_release_oldest' : 'library_age_oldest',
      targetBytes: gbToBytes(deletionSettings?.deleteBatchTargetGb),
      totalVodBytes: movie.totalVodBytes + series.totalVodBytes,
      totalNasBytes: movie.totalNasBytes + series.totalNasBytes,
      totalEstimatedBytes: movie.totalEstimatedBytes + series.totalEstimatedBytes,
      counts: {
        movies: movie.items.length,
        series: series.items.length,
        total: movie.items.length + series.items.length,
      },
      seriesCandidateCount: seriesCount,
      seriesEligible,
      diagnostics,
      movie,
      series,
      nextRefreshDate: cycle.nextRefreshDate,
      lastError: '',
    };
  } catch (error) {
    db.deletionPreview = {
      ...nextPreview,
      lastError: error?.message || 'Failed to build deletion preview.',
      reason: reason || 'error',
    };
  }

  await saveAdminDb(db);
  return db.deletionPreview;
}

async function scheduleDeletionLogs({ db, mountStatus, vodStorage, settings }) {
  const { policy, nasState, vodState } = buildVolumeStates({ mountStatus, vodStorage, settings });
  if (!policy.deletionEnabled) {
    const preview = await ensureDeletionPreview({
      db,
      settings,
      vodStorage,
      force: false,
      reason: 'disabled',
    });
    db.deletionState = {
      ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
      active: false,
      reason: '',
      triggerVolume: '',
      updatedAt: now(),
      targetFreeGb: Number(policy.deleteBatchTargetGb || 0),
      nasState,
      vodState,
    };
    await saveAdminDb(db);
    return { ok: true, skipped: true, reason: 'disabled', active: false, policy, nasState, vodState, preview };
  }

  const trigger = buildTriggerSummary({ nasState, vodState, policy });
  const preview = await ensureDeletionPreview({
    db,
    settings,
    vodStorage,
    force: false,
    reason: trigger.active ? 'trigger' : 'daily_refresh',
    allowProtectionBypass: Boolean(trigger.active),
  });
  const hasPending = (Array.isArray(db?.deletionLogs) ? db.deletionLogs : []).some((log) =>
    (Array.isArray(log?.items) ? log.items : []).some((item) => isPendingDeletionItem(item))
  );
  const nasReady = Boolean(nasState?.totalBytes > 0 && nasState?.availBytes >= 0 && mountStatus?.ok === true && mountStatus?.writable === true);
  if (!trigger.active && !hasPending) {
    db.deletionState = {
      ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
      active: false,
      reason: '',
      triggerVolume: '',
      updatedAt: now(),
      targetFreeGb: Number(policy.deleteBatchTargetGb || 0),
      nasState,
      vodState,
    };
    await saveAdminDb(db);
    return { ok: true, skipped: true, reason: 'below_trigger', active: false, policy, nasState, vodState, preview };
  }

  if (!nasReady) {
    db.deletionState = {
      ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
      active: Boolean(trigger.active || hasPending),
      reason: 'nas_offline',
      triggerVolume: trigger.triggeredVolume || db?.deletionState?.triggerVolume || '',
      updatedAt: now(),
      targetFreeGb: Number(policy.deleteBatchTargetGb || 0),
      nasState,
      vodState,
    };
    await saveAdminDb(db);
    return { ok: true, skipped: true, reason: 'nas_offline', active: Boolean(trigger.active || hasPending), policy, nasState, vodState, preview };
  }

  if (hasPending) {
    db.deletionState = {
      ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
      active: true,
      reason: 'pending_logs',
      triggerVolume: trigger.triggeredVolume || db?.deletionState?.triggerVolume || '',
      updatedAt: now(),
      targetFreeGb: Number(policy.deleteBatchTargetGb || 0),
      nasState,
      vodState,
    };
    await saveAdminDb(db);
    return { ok: true, skipped: true, reason: 'pending_logs', active: true, policy, nasState, vodState, preview };
  }

  const chosen = [
    ...(Array.isArray(preview?.movie?.items) ? preview.movie.items : []),
    ...(Array.isArray(preview?.series?.items) ? preview.series.items : []),
  ];
  if (!chosen.length) {
    db.deletionState = {
      ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
      active: true,
      reason: 'no_candidates',
      triggerVolume: trigger.triggeredVolume || '',
      updatedAt: now(),
      targetFreeGb: Number(policy.deleteBatchTargetGb || 0),
      nasState,
      vodState,
    };
    await saveAdminDb(db);
    return { ok: true, skipped: true, reason: 'no_candidates', active: true, policy, nasState, vodState, preview };
  }

  db.deletionLogs = Array.isArray(db.deletionLogs) ? db.deletionLogs : [];
  const scheduledAt = now();
  const deleteAt = deriveDeleteAt({
    delayDays: policy.deleteDelayDays,
    scheduledAt,
    timeZone: settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila',
    executionTime: policy.deleteExecutionTime || '00:00',
  });
  const deleteDate = dateKeyInTimezone(deleteAt, settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const typeGroups = new Map();
  for (const row of chosen) {
    const type = normalizeType(row.type);
    if (!typeGroups.has(type)) typeGroups.set(type, []);
    typeGroups.get(type).push(row);
  }

  for (const [type, rows] of typeGroups.entries()) {
    const log = {
      id: crypto.randomUUID(),
      deletionType: type,
      scheduledAt,
      deleteAt,
      deleteDate,
      deleteDelayDays: policy.deleteDelayDays,
      deleteExecutionTime: policy.deleteExecutionTime || '00:00',
      triggerVolume: trigger.triggeredVolume || '',
      storageSnapshot: { nas: nasState, vod: vodState },
      storageLimitGb: policy.limitUsedGb,
      triggerUsedGb: policy.triggerUsedGb,
      deleteBatchTargetGb: policy.deleteBatchTargetGb,
      totalVodBytes: rows.reduce((sum, row) => sum + (Number(row?.vodSizeBytes || 0) || 0), 0),
      totalNasBytes: rows.reduce((sum, row) => sum + (Number(row?.nasSizeBytes || 0) || 0), 0),
      totalEstimatedBytes: rows.reduce((sum, row) => sum + (Number(row.estimatedSizeBytes || 0) || 0), 0),
      previewCycleKey: String(preview?.cycleKey || '').trim(),
      previewGeneratedAt: Number(preview?.generatedAt || 0) || null,
      status: 'scheduled',
      createdAt: scheduledAt,
      updatedAt: scheduledAt,
      items: rows.map((row) => buildLogItem(row, { type, deleteAt, deleteDate })),
    };
    db.deletionLogs.unshift(log);
    const queueKey = toQueueKey(type);
    db[queueKey] = (Array.isArray(db[queueKey]) ? db[queueKey] : []).map((entry) => {
      if (!rows.some((row) => String(row.queueId || '') === String(entry?.id || ''))) return entry;
      return {
        ...entry,
        deletionState: 'scheduled',
        deletionLogId: log.id,
        deleteAt,
        deleteDate,
        updatedAt: scheduledAt,
      };
    });
  }

  db.deletionLogs = db.deletionLogs.slice(0, 2000);
  db.deletionState = {
    ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
    active: true,
    reason: 'scheduled',
    triggerVolume: trigger.triggeredVolume || '',
    updatedAt: scheduledAt,
    targetFreeGb: Number(policy.deleteBatchTargetGb || 0),
    nasState,
    vodState,
  };
  await saveAdminDb(db);
  await notifyLeavingSoonSubscribers({ logs: db.deletionLogs.slice(0, typeGroups.size), db });
  const refreshedDb = await getAdminDb();
  const nextPreview = await ensureDeletionPreview({
    db: refreshedDb,
    settings,
    vodStorage,
    force: true,
    reason: 'after_schedule',
  });
  return { ok: true, scheduled: chosen.length, logsCreated: typeGroups.size, active: true, policy, nasState, vodState, preview: nextPreview };
}

async function notifyLeavingSoonSubscribers({ logs = [], db }) {
  for (const log of Array.isArray(logs) ? logs : []) {
    for (const item of Array.isArray(log?.items) ? log.items : []) {
      if (Number(item?.leavingSoonNotifiedAt || 0) > 0) continue;
      const usernames = findReminderSubscribers(db, item.tmdbId, item.mediaType);
      if (!usernames.length) continue;
      for (const username of usernames) {
        await createUserNotification({
          username,
          type: 'leaving_soon',
          title: 'Leaving soon',
          message: `${item.title || 'A title'} is scheduled to leave the library on ${item.deleteDate || 'its scheduled date'}.`,
          meta: {
            tmdbId: item.tmdbId,
            mediaType: item.mediaType,
            xuiId: item.xuiId,
            deleteDate: item.deleteDate,
          },
        }).catch(() => null);
      }
      item.leavingSoonNotifiedAt = now();
    }
  }
  await saveAdminDb(db);
}

async function deleteInXui({ type, xuiId }) {
  const action = normalizeType(type) === 'series' ? 'delete_series' : 'delete_movie';
  const attempts = normalizeType(type) === 'series'
    ? [{ id: xuiId }, { series_id: xuiId }]
    : [{ id: xuiId }, { movie_id: xuiId }, { stream_id: xuiId }];
  let lastRaw = null;
  for (const params of attempts) {
    try {
      const response = await xuiApiCall({ action, params });
      lastRaw = response;
      if (String(response?.status || '').trim().toUpperCase() === 'STATUS_SUCCESS') {
        return { ok: true, action, params, raw: response };
      }
    } catch (error) {
      lastRaw = { error: error?.message || 'delete failed' };
    }
  }
  return { ok: false, action, raw: lastRaw };
}

function removeInventoryRows(db, item) {
  const mediaType = normalizeType(item?.type || 'movie');
  if (!db?.libraryInventory || typeof db.libraryInventory !== 'object') return;
  if (mediaType === 'movie') {
    db.libraryInventory.movies = (Array.isArray(db.libraryInventory.movies) ? db.libraryInventory.movies : []).filter((row) => {
      const tmdbMatch = Number(item?.tmdbId || 0) > 0 && Number(row?.tmdbId || 0) === Number(item.tmdbId);
      const titleMatch = String(row?.title || '').trim().toLowerCase() === String(item?.title || '').trim().toLowerCase();
      const yearMatch = String(row?.year || '').trim() === String(item?.year || '').trim();
      const pathMatch = String(row?.path || '').trim() === String(item?.libraryPath || '').trim();
      return !(pathMatch || tmdbMatch || (titleMatch && yearMatch));
    });
  } else {
    db.libraryInventory.series = (Array.isArray(db.libraryInventory.series) ? db.libraryInventory.series : []).filter((row) => {
      const tmdbMatch = Number(item?.tmdbId || 0) > 0 && Number(row?.tmdbId || 0) === Number(item.tmdbId);
      const titleMatch = String(row?.title || '').trim().toLowerCase() === String(item?.title || '').trim().toLowerCase();
      const yearMatch = String(row?.year || '').trim() === String(item?.year || '').trim();
      const pathMatch = String(row?.path || '').trim() === String(item?.libraryPath || '').trim();
      return !(pathMatch || tmdbMatch || (titleMatch && yearMatch));
    });
  }
  db.libraryInventory.stats = {
    ...(db.libraryInventory.stats || {}),
    movies: Array.isArray(db.libraryInventory.movies) ? db.libraryInventory.movies.length : 0,
    series: Array.isArray(db.libraryInventory.series) ? db.libraryInventory.series.length : 0,
    total:
      (Array.isArray(db.libraryInventory.movies) ? db.libraryInventory.movies.length : 0) +
      (Array.isArray(db.libraryInventory.series) ? db.libraryInventory.series.length : 0),
  };
}

async function executeDueDeletionLogs({ db, mountStatus = null }) {
  const dueLogs = (Array.isArray(db?.deletionLogs) ? db.deletionLogs : []).filter((log) =>
    (Array.isArray(log?.items) ? log.items : []).some((item) => isPendingDeletionItem(item) && Number(item?.deleteAt || 0) > 0 && Number(item.deleteAt) <= now())
  );
  if (!dueLogs.length) {
    return { ok: true, skipped: true, reason: 'no_due_logs' };
  }

  const nasReady = Boolean(mountStatus?.ok === true && mountStatus?.writable === true);
  if (!nasReady) {
    db.deletionState = {
      ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
      active: true,
      reason: 'nas_offline',
      updatedAt: now(),
    };
    await saveAdminDb(db);
    return { ok: true, skipped: true, reason: 'nas_offline', active: true };
  }

  const engineHost = await getEngineHost();
  const ssh = engineHost?.host ? sshFromEngineHost(engineHost) : null;
  try {
    if (ssh) await ssh.connect({ timeoutMs: 20000 });
    for (const log of dueLogs) {
      let releasedBytes = 0;
      let failed = 0;
      for (const item of Array.isArray(log?.items) ? log.items : []) {
        if (!isPendingDeletionItem(item) || Number(item?.deleteAt || 0) > now()) continue;
        item.status = 'deleting';
        item.updatedAt = now();
        const xuiResult = item.xuiId > 0 ? await deleteInXui({ type: log.deletionType, xuiId: item.xuiId }) : { ok: false, raw: 'missing_xui_id' };
        item.vodDeleteStatus = xuiResult.ok ? 'deleted' : item.xuiId > 0 ? 'failed' : 'missing';
        item.xuiDeleteStatus = xuiResult.ok ? 'deleted' : item.xuiId > 0 ? 'failed' : 'missing_in_xui';
        let nasResult = { ok: false, skipped: true, reason: 'missing_path' };
        if (item.libraryPath) {
          nasResult = await removePath({ ssh, pathValue: item.libraryPath }).catch((error) => ({ ok: false, error: error?.message || 'delete failed' }));
        }
        item.nasDeleteStatus = nasResult.removed ? 'deleted' : nasResult.missing || nasResult.skipped ? 'missing' : 'failed';
        const xuiSatisfied = item.xuiId > 0 ? xuiResult.ok : true;
        const nasSatisfied = item.libraryPath ? Boolean(nasResult.removed || nasResult.missing) : true;
        const success = xuiSatisfied && nasSatisfied;
        if (success) {
          item.status = 'deleted';
          item.deletedAt = now();
          item.error = '';
          releasedBytes += Number(item.estimatedSizeBytes || 0) || 0;
          item.deletedTargets =
            item.vodDeleteStatus === 'deleted' && item.nasDeleteStatus === 'deleted'
              ? 'vod_and_nas'
              : item.vodDeleteStatus === 'deleted'
                ? 'vod_only'
                : item.nasDeleteStatus === 'deleted'
                  ? 'nas_only'
                  : '';
          const queueKey = toQueueKey(log.deletionType);
          db[queueKey] = (Array.isArray(db[queueKey]) ? db[queueKey] : []).map((row) => {
            if (String(row?.id || '') !== String(item?.queueId || '')) return row;
            return {
              ...row,
              status: 'Deleted',
              deletionState: 'deleted',
              deletedAt: now(),
              deletedReason: 'Auto deletion scheduler removed this title after storage threshold was reached.',
              updatedAt: now(),
            };
          });
          removeInventoryRows(db, item);
        } else {
          item.status = 'failed';
          item.deletedAt = now();
          item.deletedTargets = '';
          item.error = String(xuiResult?.raw?.error || nasResult?.error || 'Deletion failed').trim() || 'Deletion failed';
          failed += 1;
        }
      }
      log.status = failed > 0 ? 'failed' : 'deleted';
      log.deletedAt = now();
      log.releasedBytes = releasedBytes;
      log.updatedAt = now();
    }
  } finally {
    if (ssh) await ssh.close();
  }

  clearXuiMediaIndexCache();
  clearXuiLibraryCatalogCache();

  const pendingLogs = (Array.isArray(db?.deletionLogs) ? db.deletionLogs : []).some((log) =>
    (Array.isArray(log?.items) ? log.items : []).some((item) => isPendingDeletionItem(item))
  );
  db.deletionState = {
    ...(db.deletionState && typeof db.deletionState === 'object' ? db.deletionState : {}),
    active: pendingLogs,
    reason: pendingLogs ? 'pending_logs' : 'idle',
    updatedAt: now(),
  };
  await saveAdminDb(db);
  return { ok: true, processedLogs: dueLogs.length, active: pendingLogs };
}

export async function runDeletionCycle() {
  const db = await getAdminDb();
  const settings = db?.autodownloadSettings || (await getAutodownloadSettings());
  const mountStatus = db?.mountStatus?.space?.total ? db.mountStatus : await fetchMountStatus().catch(() => null);
  const vodStorage = await fetchVodStorageDevices().catch(() => null);
  const scheduled = await scheduleDeletionLogs({ db, mountStatus, vodStorage, settings });
  const refreshedDb = await getAdminDb();
  const executed = await executeDueDeletionLogs({ db: refreshedDb, mountStatus });
  const finalDb = await getAdminDb();
  const state = finalDb?.deletionState || null;
  return {
    ok: true,
    scheduled,
    executed,
    active: Boolean(state?.active),
    state,
    preview: finalDb?.deletionPreview || null,
  };
}

export async function getDeletionLogs({ type = 'all', limit = 200 } = {}) {
  const db = await getAdminDb();
  const settings = db?.autodownloadSettings || (await getAutodownloadSettings());
  const currentPreview = db?.deletionPreview || null;
  if (!canReusePreviewForPageLoad(currentPreview, settings)) {
    const vodStorage = await fetchVodStorageDevices().catch(() => null);
    await ensureDeletionPreview({
      db,
      settings,
      vodStorage,
      force: false,
      reason: 'page_load',
    }).catch(() => null);
  }
  const refreshedDb = await getAdminDb();
  const max = Math.max(1, Math.min(500, Number(limit || 200) || 200));
  const logs = (Array.isArray(refreshedDb?.deletionLogs) ? refreshedDb.deletionLogs : [])
    .filter((log) => type === 'all' || normalizeType(log?.deletionType || 'movie') === normalizeType(type))
    .slice(0, max);
  return {
    logs,
    state: refreshedDb?.deletionState || null,
    settings: refreshedDb?.autodownloadSettings?.deletion || null,
    preview: refreshedDb?.deletionPreview || null,
  };
}

export async function listLeavingSoonItems({ type = 'all', limit = 40 } = {}) {
  const db = await getAdminDb();
  const max = Math.max(1, Math.min(200, Number(limit || 40) || 40));
  const items = [];
  const seen = new Set();
  for (const log of Array.isArray(db?.deletionLogs) ? db.deletionLogs : []) {
    const logType = normalizeType(log?.deletionType || 'movie');
    if (type !== 'all' && logType !== normalizeType(type)) continue;
    for (const item of Array.isArray(log?.items) ? log.items : []) {
      if (!isPendingDeletionItem(item)) continue;
      const key = `${logType}:${Number(item?.xuiId || 0)}:${Number(item?.tmdbId || 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: key,
        xuiId: Number(item?.xuiId || 0) || 0,
        tmdbId: Number(item?.tmdbId || 0) || 0,
        mediaType: item?.mediaType || (logType === 'series' ? 'tv' : 'movie'),
        kind: logType === 'series' ? 'tv' : 'movie',
        title: item?.title || '',
        year: item?.year || '',
        rating: item?.rating ?? null,
        genres: Array.isArray(item?.genres) ? item.genres : [],
        overview: item?.overview || '',
        posterPath: item?.posterPath || '',
        backdropPath: item?.backdropPath || '',
        image: item?.image || posterUrl(item?.posterPath),
        backdropImage: item?.backdropImage || backdropUrl(item?.backdropPath),
        deleteDate: item?.deleteDate || log?.deleteDate || '',
        deleteAt: Number(item?.deleteAt || log?.deleteAt || 0) || 0,
        href:
          logType === 'series'
            ? `/series/${Number(item?.xuiId || 0)}?leavingSoon=1`
            : `/movies/${Number(item?.xuiId || 0)}?leavingSoon=1`,
      });
    }
  }
  items.sort((a, b) => Number(a?.deleteAt || 0) - Number(b?.deleteAt || 0) || String(a?.title || '').localeCompare(String(b?.title || '')));
  return items.slice(0, max);
}

export async function findLeavingSoonItem({ type = 'movie', xuiId = 0 } = {}) {
  const targetType = normalizeType(type);
  const targetId = Number(xuiId || 0) || 0;
  if (!(targetId > 0)) return null;
  const db = await getAdminDb();
  for (const log of Array.isArray(db?.deletionLogs) ? db.deletionLogs : []) {
    if (normalizeType(log?.deletionType || 'movie') !== targetType) continue;
    for (const item of Array.isArray(log?.items) ? log.items : []) {
      if (!isPendingDeletionItem(item)) continue;
      if (Number(item?.xuiId || 0) !== targetId) continue;
      return {
        ...item,
        deleteDate: item?.deleteDate || log?.deleteDate || '',
        deleteAt: Number(item?.deleteAt || log?.deleteAt || 0) || 0,
        mediaType: item?.mediaType || (targetType === 'series' ? 'tv' : 'movie'),
      };
    }
  }
  return null;
}
