import 'server-only';

import crypto from 'node:crypto';

import { decryptString } from '../vault';
import { getAdminDb, saveAdminDb } from '../adminDb';
import { getAutodownloadSettings, getEngineHost, getMountSettings, updateAutodownloadSettings } from './autodownloadDb';
import { appendSelectionLog, getAutodownloadHealth, setAutodownloadHealth } from './autodownloadDb';
import { fetchMountStatus } from './mountService';
import { SSHService } from './sshService';
import { discoverMovies, discoverSeries, getTmdbDetailsById } from './tmdbService';
import { addQueueItemFromTmdb } from './downloadService';
import { testQbittorrentApi } from './qbittorrentService';
import { getDownloadSourcesState, searchBestDownloadSource } from './sourceProvidersService';
import { getOrRefreshLibraryInventory, hasInventoryMatch, makeLibraryInventoryKey } from './libraryInventoryService';
import { computeReleaseMeta, normalizeReleaseDelayDays, normalizeReleaseTimezone } from './releaseSchedule';
import { getXuiLibraryCatalog, hasXuiCatalogMatch } from './xuiLibraryCatalogService';
import { deriveStoragePolicy, storageLimitMessage } from './storagePolicy';

const DEFAULT_TIMEZONE = 'Asia/Manila';
const bootstrapLocks = new Map();

function now() {
  return Date.now();
}

function sanitizeType(type) {
  return String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
}

function selectionLastRunKey(type) {
  return sanitizeType(type) === 'series' ? 'lastSeriesRunAt' : 'lastMoviesRunAt';
}

function toMinutes(hhmm) {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function normalizeScheduleTimezone(timeZone) {
  const tz = String(timeZone || '').trim();
  if (!tz || tz === 'UTC') return DEFAULT_TIMEZONE;
  return tz;
}

function zonedNowParts(timeZone) {
  const tz = normalizeScheduleTimezone(timeZone);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return { tz, weekday, time: `${hour}:${minute}` };
}

function weekdayToNumber(weekday) {
  const w = String(weekday || '').slice(0, 3).toLowerCase();
  if (w === 'sun') return 0;
  if (w === 'mon') return 1;
  if (w === 'tue') return 2;
  if (w === 'wed') return 3;
  if (w === 'thu') return 4;
  if (w === 'fri') return 5;
  if (w === 'sat') return 6;
  return 0;
}

export function isScheduleActive(schedule) {
  const sch = schedule && typeof schedule === 'object' ? schedule : {};
  const days = Array.isArray(sch.days) ? sch.days.map((d) => Number(d)).filter((d) => Number.isFinite(d)) : [];
  const startMin = toMinutes(sch.startTime || '00:00') ?? 0;
  const endMin = toMinutes(sch.endTime || '23:59') ?? 24 * 60 - 1;

  const z = zonedNowParts(normalizeScheduleTimezone(sch.timezone));
  const dow = weekdayToNumber(z.weekday);
  const curMin = toMinutes(z.time) ?? 0;

  const daySelected = (d) => (days.length ? days.includes(d) : true);

  if (startMin <= endMin) {
    return daySelected(dow) && curMin >= startMin && curMin <= endMin;
  }

  if (curMin >= startMin) {
    return daySelected(dow);
  }

  const prev = (dow + 6) % 7;
  return daySelected(prev) && curMin <= endMin;
}

function dateToYmd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sanitizeFsName(name) {
  const s = String(name || '').trim();
  const cleaned = s
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned.slice(0, 150) || 'Untitled';
}

function escapeFindGlob(s) {
  return String(s || '')
    .replaceAll('[', '[[]')
    .replaceAll(']', '[]]');
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

async function existsInFinalMoviesLibrary({ ssh, mountDir, title, year }) {
  const base = sanitizeFsName(`${title}${year ? ` (${year})` : ''}`);
  const pattern = `${escapeFindGlob(base)}.*`;
  const root = `${String(mountDir || '').replace(/\/+$/, '')}/Movies`;
  const cmd = `find ${JSON.stringify(root)} -maxdepth 5 -type f -iname ${JSON.stringify(pattern)} -print -quit 2>/dev/null || true`;
  const r = await ssh.exec(cmd, { timeoutMs: 30000 });
  return Boolean(String(r.stdout || '').trim());
}

async function existsInFinalSeriesLibrary({ ssh, mountDir, title, year }) {
  const base = sanitizeFsName(`${title}${year ? ` (${year})` : ''}`);
  const baseNoYear = sanitizeFsName(`${title}`);
  const root = `${String(mountDir || '').replace(/\/+$/, '')}/Series`;
  const cmd = [
    `ROOT=${JSON.stringify(root)}`,
    `P1=${JSON.stringify(escapeFindGlob(base))}`,
    `P2=${JSON.stringify(escapeFindGlob(baseNoYear))}`,
    'find "$ROOT" -maxdepth 4 -type d \\( -iname "$P1" -o -iname "$P2" \\) -print -quit 2>/dev/null || true',
  ].join('\n');
  const r = await ssh.exec(cmd, { timeoutMs: 30000 });
  return Boolean(String(r.stdout || '').trim());
}

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sourcePolicyForType(settings, type) {
  const t = sanitizeType(type);
  const sizeLimits = settings?.sizeLimits || {};
  const sourceFilters = settings?.sourceFilters || {};
  const minSeedersRaw = t === 'series' ? sourceFilters?.minSeriesSeeders : sourceFilters?.minMovieSeeders;
  const maxSizeRaw = t === 'series' ? sizeLimits?.maxEpisodeGb : sizeLimits?.maxMovieGb;
  const minSeeders = Math.max(0, Math.floor(toFiniteNumber(minSeedersRaw, 1) ?? 1));
  const maxSizeGb = toFiniteNumber(maxSizeRaw, null);
  return {
    minSeeders,
    maxSizeGb: maxSizeGb !== null && maxSizeGb > 0 ? maxSizeGb : null,
  };
}

async function collectCandidates({ params, maxPages = 6, discoverFn } = {}) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const r = await discoverFn({ params: { ...params, page } });
    for (const item of r.results || []) {
      if (!item?.id) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    if (page >= (r.totalPages || 1)) break;
  }
  return out;
}

function buildDedupeSet(db, type) {
  const t = sanitizeType(type);
  const ids = new Set();

  const key = t === 'series' ? 'downloadsSeries' : 'downloadsMovies';
  const rows = Array.isArray(db?.[key]) ? db[key] : [];
  for (const rec of rows) {
    if (String(rec?.status || '').toLowerCase() === 'deleted') continue;
    const id = Number(rec?.tmdb?.id || 0);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }

  return ids;
}

function parseYearFromDateString(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
}

function buildInventoryIndex(inventory, type) {
  const t = sanitizeType(type);
  const rows = Array.isArray(inventory?.[t === 'series' ? 'series' : 'movies'])
    ? inventory[t === 'series' ? 'series' : 'movies']
    : [];
  const titleOnly = new Set();
  const exact = new Set();
  for (const row of rows) {
    const key = String(row?.key || '').trim();
    if (!key) continue;
    exact.add(key);
    // key format: "{normalizedTitle}::{year?}"
    const normTitle = key.split('::')[0] || '';
    if (normTitle) titleOnly.add(normTitle);
  }
  return { exact, titleOnly };
}

function inventoryIndexHas({ index, title, year = null } = {}) {
  if (!index || !title) return false;
  const exactKey = makeLibraryInventoryKey(title, year);
  if (index.exact.has(exactKey)) return true;
  const noYearKey = makeLibraryInventoryKey(title, null); // "{normalizedTitle}::"
  const normTitle = String(noYearKey || '').split('::')[0] || '';
  if (!normTitle) return false;
  return index.titleOnly.has(normTitle);
}

function xuiCatalogHasTmdbId({ catalog, type = 'movie', tmdbId = 0 } = {}) {
  if (!catalog) return false;
  const id = Number(tmdbId || 0);
  if (!Number.isFinite(id) || id <= 0) return false;
  const t = sanitizeType(type);
  if (t === 'series') return Boolean(catalog?.seriesTmdbIds?.has?.(id));
  return Boolean(catalog?.movieTmdbIds?.has?.(id));
}

function discoverItemTitleAndYear(mediaType, item) {
  const mt = String(mediaType || '').trim().toLowerCase();
  const isTv = mt === 'tv';
  const title = String((isTv ? item?.name : item?.title) || item?.title || item?.name || '').trim();
  const dateStr = String((isTv ? item?.first_air_date : item?.release_date) || item?.release_date || item?.first_air_date || '').trim();
  const year = parseYearFromDateString(dateStr);
  return { title, year };
}

function normalizeStrategy(type, settings) {
  const t = sanitizeType(type);
  const fallback =
    t === 'series'
      ? {
          recentMonthsRange: 12,
          classicYearStart: 1990,
          classicYearEnd: 2018,
          recentAnimationCount: 1,
          recentLiveActionCount: 2,
          classicAnimationCount: 1,
          classicLiveActionCount: 2,
        }
      : {
          recentMonthsRange: 5,
          classicYearStart: 1996,
          classicYearEnd: 2012,
          recentAnimationCount: 1,
          recentLiveActionCount: 3,
          classicAnimationCount: 1,
          classicLiveActionCount: 3,
        };

  const strat = t === 'series' ? settings?.seriesSelectionStrategy || {} : settings?.movieSelectionStrategy || {};

  return {
    recentMonthsRange: Math.max(1, Number(strat.recentMonthsRange ?? fallback.recentMonthsRange) || fallback.recentMonthsRange),
    classicYearStart: Number(strat.classicYearStart ?? fallback.classicYearStart) || fallback.classicYearStart,
    classicYearEnd: Number(strat.classicYearEnd ?? fallback.classicYearEnd) || fallback.classicYearEnd,
    counts: {
      recentAnimation: Math.max(0, Number(strat.recentAnimationCount ?? fallback.recentAnimationCount) || 0),
      recentLive: Math.max(0, Number(strat.recentLiveActionCount ?? fallback.recentLiveActionCount) || 0),
      classicAnimation: Math.max(0, Number(strat.classicAnimationCount ?? fallback.classicAnimationCount) || 0),
      classicLive: Math.max(0, Number(strat.classicLiveActionCount ?? fallback.classicLiveActionCount) || 0),
    },
  };
}

function buildBuckets({ type, recentMonthsRange, classicYearStart, classicYearEnd, counts }) {
  const since = new Date();
  const recentStart = new Date(since);
  recentStart.setMonth(recentStart.getMonth() - recentMonthsRange);
  const recentGte = dateToYmd(recentStart);
  const recentLte = dateToYmd(since);
  const classicGte = `${classicYearStart}-01-01`;
  const classicLte = `${classicYearEnd}-12-31`;

  const animationGenreId = 16;
  const t = sanitizeType(type);

  const dateFromKey = t === 'series' ? 'first_air_date.gte' : 'primary_release_date.gte';
  const dateToKey = t === 'series' ? 'first_air_date.lte' : 'primary_release_date.lte';

  return [
    {
      key: 'recentAnimation',
      count: counts.recentAnimation,
      discover: {
        [dateFromKey]: recentGte,
        [dateToKey]: recentLte,
        with_genres: String(animationGenreId),
      },
    },
    {
      key: 'recentLive',
      count: counts.recentLive,
      discover: {
        [dateFromKey]: recentGte,
        [dateToKey]: recentLte,
        without_genres: String(animationGenreId),
      },
    },
    {
      key: 'classicAnimation',
      count: counts.classicAnimation,
      discover: {
        [dateFromKey]: classicGte,
        [dateToKey]: classicLte,
        with_genres: String(animationGenreId),
      },
    },
    {
      key: 'classicLive',
      count: counts.classicLive,
      discover: {
        [dateFromKey]: classicGte,
        [dateToKey]: classicLte,
        without_genres: String(animationGenreId),
      },
    },
  ];
}

function updatePickedCount(pickedCounts, bucket) {
  if (bucket === 'recentAnimation') pickedCounts.recentAnimationSelected++;
  else if (bucket === 'recentLive') pickedCounts.recentLiveActionSelected++;
  else if (bucket === 'classicAnimation') pickedCounts.classicAnimationSelected++;
  else if (bucket === 'classicLive') pickedCounts.classicLiveActionSelected++;
}

function tmdbIdFromSelectedItem(row) {
  const id = Number(row?.tmdbId || row?.tmdb?.id || row?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function numericTimestamp(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function selectionLogSortValue(log = {}) {
  return Math.max(numericTimestamp(log?.updatedAt), numericTimestamp(log?.runAt), numericTimestamp(log?.releasedAt));
}

function isRecoveredReferenceLog(log = {}) {
  return String(log?.triggerReason || '').trim().toLowerCase() === 'recovered_reference';
}

function stableSelectionLogIdForRelease({ type = 'movie', releaseDate = '' } = {}) {
  const t = String(type || 'movie').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const rd = String(releaseDate || '').trim();
  if (!rd) return '';
  // Keep it readable; this becomes the selectionLogId attached to queued downloads.
  return `autoselect:${t}:${rd}`;
}

function resolveSelectionLogIdForRelease(db, { type = 'movie', releaseDate = '' } = {}) {
  const t = String(type || 'movie').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const rd = String(releaseDate || '').trim();
  if (!rd) return '';

  const logs = Array.isArray(db?.selectionLogs) ? db.selectionLogs : [];
  const matches = logs.filter(
    (row) => String(row?.selectionType || 'movie').trim().toLowerCase() === t && String(row?.releaseDate || '').trim() === rd
  );
  if (matches.length) {
    // Prefer non-recovered references so the canonical log survives and any recovered data gets merged into it.
    const sorted = [...matches].sort((a, b) => {
      const aRecovered = isRecoveredReferenceLog(a);
      const bRecovered = isRecoveredReferenceLog(b);
      if (aRecovered !== bRecovered) return aRecovered ? 1 : -1;
      const aItems = Array.isArray(a?.selectedItems) ? a.selectedItems.length : 0;
      const bItems = Array.isArray(b?.selectedItems) ? b.selectedItems.length : 0;
      if (aItems !== bItems) return bItems - aItems;
      return selectionLogSortValue(b) - selectionLogSortValue(a);
    });
    const bestId = String(sorted[0]?.id || '').trim();
    if (bestId) return bestId;
  }

  return stableSelectionLogIdForRelease({ type: t, releaseDate: rd });
}

function dedupeSelectedItems(items = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(items) ? items : []) {
    const tmdbId = tmdbIdFromSelectedItem(row);
    const key = tmdbId > 0 ? `tmdb:${tmdbId}` : `row:${JSON.stringify(row || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function recountPickedCounts(items = []) {
  const counts = {
    recentAnimationSelected: 0,
    recentLiveActionSelected: 0,
    classicAnimationSelected: 0,
    classicLiveActionSelected: 0,
  };
  for (const row of Array.isArray(items) ? items : []) {
    updatePickedCount(counts, row?.bucket);
  }
  return counts;
}

async function upsertSelectionLog(logEntry, { appendToLogId = null } = {}) {
  const targetId = String(appendToLogId || '').trim();
  if (!targetId) {
    const normalizedSelectedItems = dedupeSelectedItems(logEntry?.selectedItems || []);
    const normalizedLogEntry = {
      ...logEntry,
      selectedItems: normalizedSelectedItems,
      totalSelected: normalizedSelectedItems.length,
      ...recountPickedCounts(normalizedSelectedItems),
    };
    await appendSelectionLog(normalizedLogEntry);
    return normalizedLogEntry;
  }

  const db = await getAdminDb();
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  const idx = db.selectionLogs.findIndex((x) => String(x?.id || '') === targetId);
  if (idx < 0) {
    await appendSelectionLog(logEntry);
    return logEntry;
  }

  const prev = db.selectionLogs[idx] || {};
  const mergedSelectedItems = dedupeSelectedItems([
    ...(Array.isArray(prev?.selectedItems) ? prev.selectedItems : []),
    ...(logEntry?.selectedItems || []),
  ]);
  const merged = {
    ...prev,
    totalSelected: mergedSelectedItems.length,
    ...recountPickedCounts(mergedSelectedItems),
    skippedDuplicatesCount:
      Math.max(0, Number(prev?.skippedDuplicatesCount || 0) + Number(logEntry?.skippedDuplicatesCount || 0)),
    skippedNoSourceCount:
      Math.max(0, Number(prev?.skippedNoSourceCount || 0) + Number(logEntry?.skippedNoSourceCount || 0)),
    skippedStorageLimitCount:
      Math.max(0, Number(prev?.skippedStorageLimitCount || 0) + Number(logEntry?.skippedStorageLimitCount || 0)),
    selectedItems: mergedSelectedItems,
    insufficient: [...(Array.isArray(prev?.insufficient) ? prev.insufficient : []), ...(logEntry?.insufficient || [])],
    triggerReason: logEntry?.triggerReason || prev?.triggerReason || null,
    updatedAt: now(),
    errorMessage: Object.prototype.hasOwnProperty.call(logEntry || {}, 'errorMessage')
      ? (String(logEntry?.errorMessage || '').trim() ? String(logEntry.errorMessage).trim() : null)
      : prev?.errorMessage || null,
    releaseDate: String(prev?.releaseDate || logEntry?.releaseDate || '').trim(),
    releaseTag: String(prev?.releaseTag || logEntry?.releaseTag || '').trim(),
    releaseDelayDays: Number(prev?.releaseDelayDays ?? logEntry?.releaseDelayDays ?? 3) || 3,
    releaseTimezone: String(prev?.releaseTimezone || logEntry?.releaseTimezone || DEFAULT_TIMEZONE),
  };

  db.selectionLogs[idx] = merged;
  await saveAdminDb(db);
  return merged;
}

async function runSelectionJob({
  type,
  force = false,
  preserveLastRun = false,
  targetTotal = null,
  triggerReason = '',
  selectionLogId = null,
  releaseDate = '',
  releaseTag = '',
  releaseTimezone = '',
  releaseDelayDays = null,
  minSeedersOverride = null,
  maxSizeGbOverride = null,
  maxPagesPerBucket = 8,
  maxCandidatesPerBucket = null,
} = {}) {
  const startedAt = now();
  const t = sanitizeType(type);
  const mediaType = t === 'series' ? 'tv' : 'movie';
  const settings = await getAutodownloadSettings();
  const appendToLogId = String(selectionLogId || '').trim() || null;
  const releaseTz = normalizeReleaseTimezone(
    releaseTimezone || settings?.release?.timezone || settings?.schedule?.timezone || DEFAULT_TIMEZONE
  );
  const releaseDays = normalizeReleaseDelayDays(releaseDelayDays ?? settings?.release?.delayDays ?? 3);
  const computedRelease = computeReleaseMeta({
    startedAt,
    delayDays: releaseDays,
    timeZone: releaseTz,
  });

  const intervalHours = Math.max(1, Number(settings?.selection?.intervalHours ?? 24) || 24);
  const lastRunAt = Number(settings?.selection?.[selectionLastRunKey(t)] || 0);
  if (!force && lastRunAt && startedAt - lastRunAt < intervalHours * 60 * 60 * 1000) {
    return { ok: true, skipped: true, reason: 'interval', nextAt: lastRunAt + intervalHours * 60 * 60 * 1000 };
  }

  const enabled = Boolean(settings?.enabled && (t === 'series' ? settings?.seriesEnabled : settings?.moviesEnabled));
  if (!enabled && !force) return { ok: true, skipped: true, reason: 'disabled' };

  const dbForDeletionState = await getAdminDb();
  if (settings?.deletion?.pauseSelectionWhileActive !== false && dbForDeletionState?.deletionState?.active) {
    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: false, type: t, lastRunAt: startedAt, error: 'Selection paused while deletion scheduling is active.' },
    });
    return { ok: true, skipped: true, reason: 'deletion_active' };
  }

  if (!force && !isScheduleActive(settings?.schedule || {})) {
    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: false, type: t, lastRunAt: startedAt, error: 'Outside schedule window' },
    });
    return { ok: true, skipped: true, reason: 'outside_schedule' };
  }

  const mountStatus = await fetchMountStatus().catch(() => null);
  if (!mountStatus?.ok) {
    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: false, type: t, lastRunAt: startedAt, error: 'NAS not mounted/writable' },
    });
    return { ok: true, skipped: true, reason: 'mount_not_ready' };
  }

  const total = Number(mountStatus?.space?.total || 0);
  const used = Number(mountStatus?.space?.used || 0);
  const policy = deriveStoragePolicy({ settings, totalBytes: total });
  const usedGb = total > 0 ? used / (1024 * 1024 * 1024) : 0;
  if (policy.limitUsedGb !== null && usedGb >= policy.limitUsedGb) {
    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: false, type: t, lastRunAt: startedAt, error: storageLimitMessage({ usedGb, limitUsedGb: policy.limitUsedGb }) },
    });
    return { ok: true, skipped: true, reason: 'storage_limit' };
  }

  const qbTest = await testQbittorrentApi({ port: settings?.downloadClient?.port }).catch((e) => ({ ok: false, error: e?.message }));
  if (!qbTest?.ok) {
    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: false, type: t, lastRunAt: startedAt, error: qbTest?.error || 'qBittorrent not reachable' },
    });
    return { ok: true, skipped: true, reason: 'qb_not_ready' };
  }

  // If no compatible download sources are enabled for this media type, don't burn time on large TMDB discovery loops.
  const sourceState = await getDownloadSourcesState({ type: t }).catch(() => null);
  const enabledProviders = Array.isArray(sourceState?.providers) ? sourceState.providers.filter((p) => p?.enabled) : [];
  if (!enabledProviders.length) {
    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: false, type: t, lastRunAt: startedAt, error: `No ${t === 'series' ? 'Series' : 'Movie'} Download Sources are enabled.` },
    });
    return { ok: true, skipped: true, reason: 'no_sources_enabled' };
  }

  const db = await getAdminDb();
  let effectiveReleaseDate = String(releaseDate || '').trim() || computedRelease.releaseDate;
  let effectiveReleaseTag = String(releaseTag || '').trim() || computedRelease.releaseTag;
  let effectiveReleaseTimezone = releaseTz;
  let effectiveReleaseDelayDays = releaseDays;
  let existingLogSelectedTmdbIds = new Set();
  if (appendToLogId) {
    const existingLog = (Array.isArray(db?.selectionLogs) ? db.selectionLogs : []).find(
      (x) => String(x?.id || '') === appendToLogId
    );
    if (existingLog) {
      existingLogSelectedTmdbIds = new Set(
        (Array.isArray(existingLog?.selectedItems) ? existingLog.selectedItems : [])
          .map((row) => tmdbIdFromSelectedItem(row))
          .filter((id) => id > 0)
      );
      effectiveReleaseDate = String(existingLog?.releaseDate || effectiveReleaseDate).trim() || effectiveReleaseDate;
      effectiveReleaseTag = String(existingLog?.releaseTag || effectiveReleaseTag).trim() || effectiveReleaseTag;
      effectiveReleaseTimezone = normalizeReleaseTimezone(
        existingLog?.releaseTimezone || effectiveReleaseTimezone || DEFAULT_TIMEZONE
      );
      effectiveReleaseDelayDays = normalizeReleaseDelayDays(
        existingLog?.releaseDelayDays ?? effectiveReleaseDelayDays
      );
    }
  }
  const dedupeIds = buildDedupeSet(db, t);
  for (const tmdbId of existingLogSelectedTmdbIds) dedupeIds.add(tmdbId);
  const sourcePolicyBase = sourcePolicyForType(settings, t);
  const minSeedersOverrideNum =
    minSeedersOverride === null || minSeedersOverride === undefined || String(minSeedersOverride).trim() === ''
      ? null
      : Math.max(0, Math.floor(Number(minSeedersOverride) || 0));
  const maxSizeGbOverrideNum =
    maxSizeGbOverride === null || maxSizeGbOverride === undefined || String(maxSizeGbOverride).trim() === ''
      ? null
      : Number(maxSizeGbOverride);
  const sourcePolicy = {
    ...sourcePolicyBase,
    minSeeders: minSeedersOverrideNum !== null ? minSeedersOverrideNum : sourcePolicyBase.minSeeders,
    maxSizeGb:
      maxSizeGbOverrideNum !== null && Number.isFinite(maxSizeGbOverrideNum) && maxSizeGbOverrideNum > 0
        ? maxSizeGbOverrideNum
        : sourcePolicyBase.maxSizeGb,
  };
  const inventoryResult = await getOrRefreshLibraryInventory({ maxAgeMs: 6 * 60 * 60 * 1000, force: false }).catch(() => null);
  const inventory = inventoryResult?.inventory || null;
  const xuiCatalog = await getXuiLibraryCatalog({ maxAgeMs: 5 * 60 * 1000, force: false }).catch(() => null);
  const inventoryIndex = buildInventoryIndex(inventory, t);

  const mount = await getMountSettings();
  const engineHost = await getEngineHost();
  const mountDir = mount?.mountDir || mountStatus?.mountDir || '';
  const canCheckFinalLibrary = Boolean(engineHost?.host && mountDir);
  const ssh = canCheckFinalLibrary ? sshFromEngineHost(engineHost) : null;

  const strategy = normalizeStrategy(t, settings);
  const buckets = buildBuckets({ type: t, ...strategy });
  const pagesPerBucket = Math.max(1, Math.min(8, Number(maxPagesPerBucket || 8) || 8));
  const candidatesPerBucket =
    maxCandidatesPerBucket === null || maxCandidatesPerBucket === undefined || String(maxCandidatesPerBucket).trim() === ''
      ? null
      : Math.max(1, Math.min(200, Math.floor(Number(maxCandidatesPerBucket) || 0)));
  const hasTargetOverride = targetTotal !== null && targetTotal !== undefined && String(targetTotal).trim() !== '';
  const targetTotalNum = Number(targetTotal);
  const cappedTarget =
    hasTargetOverride && Number.isFinite(targetTotalNum) ? Math.max(0, Math.floor(targetTotalNum)) : null;
  const discoverFn = t === 'series' ? discoverSeries : discoverMovies;

  const runLogId =
    appendToLogId ||
    resolveSelectionLogIdForRelease(db, { type: t, releaseDate: effectiveReleaseDate }) ||
    crypto.randomUUID();
  const selected = [];
  const pickedCounts = {
    recentAnimationSelected: 0,
    recentLiveActionSelected: 0,
    classicAnimationSelected: 0,
    classicLiveActionSelected: 0,
  };
  let skippedDuplicatesCount = 0;
  let skippedNoSourceCount = 0;
  let skippedStorageLimitCount = 0;
  const insufficient = [];

  try {
    if (ssh) await ssh.connect({ timeoutMs: 15000 });

    for (const b of buckets) {
      if (cappedTarget !== null && selected.length >= cappedTarget) break;
      if (!b.count) continue;
      let candidates = await collectCandidates({ params: b.discover, maxPages: pagesPerBucket, discoverFn });
      if (candidatesPerBucket !== null) candidates = candidates.slice(0, candidatesPerBucket);
      // Pre-filter obvious duplicates before we do any expensive lookups. This prevents wasting
      // TMDB detail calls and source probes on titles we already have.
      candidates = candidates.filter((c) => {
        const id = Number(c?.id || 0);
        if (!Number.isFinite(id) || id <= 0) return false;
        if (dedupeIds.has(id)) return false;
        if (xuiCatalogHasTmdbId({ catalog: xuiCatalog, type: t, tmdbId: id })) {
          dedupeIds.add(id);
          return false;
        }
        const { title, year } = discoverItemTitleAndYear(mediaType, c);
        if (title && inventoryIndexHas({ index: inventoryIndex, title, year })) {
          // Conservatively mark as deduped so it doesn't re-appear in other buckets.
          dedupeIds.add(id);
          return false;
        }
        return true;
      });
      let got = 0;

      for (const c of candidates) {
        if (cappedTarget !== null && selected.length >= cappedTarget) break;
        if (got >= b.count) break;

        const id = Number(c?.id || 0);
        if (!Number.isFinite(id) || id <= 0) continue;

        if (dedupeIds.has(id)) {
          skippedDuplicatesCount++;
          continue;
        }

        const details = await getTmdbDetailsById({ mediaType, id }).catch(() => null);
        if (!details?.ok || !details.title) continue;

        let checkedFinalLibrary = false;
        if (ssh) {
          checkedFinalLibrary = true;
          const exists =
            t === 'series'
              ? await existsInFinalSeriesLibrary({
                  ssh,
                  mountDir,
                  title: details.title,
                  year: details.year,
                }).catch(() => false)
              : await existsInFinalMoviesLibrary({
                  ssh,
                  mountDir,
                  title: details.title,
                  year: details.year,
                }).catch(() => false);
          if (exists) {
            dedupeIds.add(id);
            skippedDuplicatesCount++;
            continue;
          }
        }

        if (
          !checkedFinalLibrary &&
          hasInventoryMatch({
            inventory,
            type: t,
            title: details.title,
            year: details.year,
          })
        ) {
          dedupeIds.add(id);
          skippedDuplicatesCount++;
          continue;
        }

        if (
          hasXuiCatalogMatch({
            catalog: xuiCatalog,
            type: t,
            title: details.title,
            year: details.year,
            tmdbId: details.id,
          })
        ) {
          dedupeIds.add(id);
          skippedDuplicatesCount++;
          continue;
        }

        if (policy.limitUsedGb !== null && usedGb >= policy.limitUsedGb) {
          skippedStorageLimitCount++;
          continue;
        }

        const sourceQuery = t === 'series' && details?.imdbId ? String(details.imdbId).trim() : details.title;
        const sourceProbe = await searchBestDownloadSource({
          query: sourceQuery,
          year: Number(details.year || 0) || null,
          type: t,
          correlationId: `selection-${t}-${startedAt}-${id}`,
          jobId: `selection-${t}-${id}`,
          stopOnFirstValid: true,
          minSeeders: sourcePolicy.minSeeders,
          maxSizeGb: sourcePolicy.maxSizeGb,
        }).catch((e) => ({ ok: false, error: e?.message || 'Source lookup failed.' }));

        const selectedSource = sourceProbe?.selected || null;
        const sourceUrl = String(selectedSource?.sourceUrl || selectedSource?.magnet || '').trim();
        if (!sourceUrl) {
          skippedNoSourceCount++;
          continue;
        }

        await addQueueItemFromTmdb({
          type: t,
          tmdbId: id,
          mediaType,
          preselectedSource: selectedSource,
          sourceAttemptsLog: Array.isArray(sourceProbe?.attempts) ? sourceProbe.attempts : [],
          sourceLastAttemptAt: now(),
          selectionLogId: runLogId,
          releaseDate: effectiveReleaseDate,
          releaseTag: effectiveReleaseTag,
          releaseTimezone: effectiveReleaseTimezone,
          releaseDelayDays: effectiveReleaseDelayDays,
        });
        dedupeIds.add(id);
        selected.push({
          id,
          tmdbId: id,
          title: details.title,
          year: details.year || '',
          bucket: b.key,
          type: t,
          provider: String(selectedSource?.provider || '').trim(),
          selectionLogId: runLogId,
          releaseDate: effectiveReleaseDate,
          releaseTag: effectiveReleaseTag,
        });
        got++;
        updatePickedCount(pickedCounts, b.key);
      }

      if (got < b.count) {
        insufficient.push({ bucket: b.key, requested: b.count, selected: got });
      }
    }

    const logEntry = {
      id: runLogId,
      selectionType: t,
      triggerReason: String(triggerReason || '').trim() || null,
      runAt: startedAt,
      updatedAt: startedAt,
      totalSelected: selected.length,
      ...pickedCounts,
      skippedDuplicatesCount,
      skippedNoSourceCount,
      skippedStorageLimitCount,
      insufficient,
      selectedItems: selected,
      errorMessage: null,
      releaseDate: effectiveReleaseDate,
      releaseTag: effectiveReleaseTag,
      releaseDelayDays: effectiveReleaseDelayDays,
      releaseTimezone: effectiveReleaseTimezone,
      releasedAt: null,
    };

    const savedLog = await upsertSelectionLog(logEntry, { appendToLogId });
    if (!preserveLastRun) {
      await updateAutodownloadSettings({
        selection: {
          ...(settings?.selection || {}),
          [selectionLastRunKey(t)]: startedAt,
        },
      });
    }

    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: true, type: t, lastRunAt: startedAt, error: '', totalSelected: selected.length },
    });

    return { ok: true, type: t, selected, log: savedLog };
  } catch (e) {
    const msg = e?.message || 'Selection job failed.';
    const logEntry = {
      id: runLogId,
      selectionType: t,
      triggerReason: String(triggerReason || '').trim() || null,
      runAt: startedAt,
      updatedAt: startedAt,
      totalSelected: selected.length,
      ...pickedCounts,
      skippedDuplicatesCount,
      skippedNoSourceCount,
      skippedStorageLimitCount,
      insufficient,
      selectedItems: selected,
      errorMessage: msg,
      releaseDate: effectiveReleaseDate,
      releaseTag: effectiveReleaseTag,
      releaseDelayDays: effectiveReleaseDelayDays,
      releaseTimezone: effectiveReleaseTimezone,
      releasedAt: null,
    };

    const savedLog = await upsertSelectionLog(logEntry, { appendToLogId });
    const health = (await getAutodownloadHealth()) || {};
    await setAutodownloadHealth({
      ...health,
      selection: { ok: false, type: t, lastRunAt: startedAt, error: msg },
    });

    return { ok: false, type: t, error: msg, selected, log: savedLog };
  } finally {
    if (ssh) await ssh.close();
  }
}

export async function runMovieSelectionJob({
  force = false,
  preserveLastRun = false,
  targetTotal = null,
  triggerReason = '',
  selectionLogId = null,
  releaseDate = '',
  releaseTag = '',
  releaseTimezone = '',
  releaseDelayDays = null,
  minSeedersOverride = null,
  maxSizeGbOverride = null,
  maxPagesPerBucket = 8,
  maxCandidatesPerBucket = null,
} = {}) {
  return runSelectionJob({
    type: 'movie',
    force,
    preserveLastRun,
    targetTotal,
    triggerReason,
    selectionLogId,
    releaseDate,
    releaseTag,
    releaseTimezone,
    releaseDelayDays,
    minSeedersOverride,
    maxSizeGbOverride,
    maxPagesPerBucket,
    maxCandidatesPerBucket,
  });
}

export async function runSeriesSelectionJob({
  force = false,
  preserveLastRun = false,
  targetTotal = null,
  triggerReason = '',
  selectionLogId = null,
  releaseDate = '',
  releaseTag = '',
  releaseTimezone = '',
  releaseDelayDays = null,
  minSeedersOverride = null,
  maxSizeGbOverride = null,
  maxPagesPerBucket = 8,
  maxCandidatesPerBucket = null,
} = {}) {
  return runSelectionJob({
    type: 'series',
    force,
    preserveLastRun,
    targetTotal,
    triggerReason,
    selectionLogId,
    releaseDate,
    releaseTag,
    releaseTimezone,
    releaseDelayDays,
    minSeedersOverride,
    maxSizeGbOverride,
    maxPagesPerBucket,
    maxCandidatesPerBucket,
  });
}

export async function runSelectionJobForType({
  type = 'movie',
  force = false,
  preserveLastRun = false,
  targetTotal = null,
  triggerReason = '',
  selectionLogId = null,
  releaseDate = '',
  releaseTag = '',
  releaseTimezone = '',
  releaseDelayDays = null,
  minSeedersOverride = null,
  maxSizeGbOverride = null,
  maxPagesPerBucket = 8,
  maxCandidatesPerBucket = null,
} = {}) {
  const t = sanitizeType(type);
  return t === 'series'
    ? runSelectionJob({
        type: 'series',
        force,
        preserveLastRun,
        targetTotal,
        triggerReason,
        selectionLogId,
        releaseDate,
        releaseTag,
        releaseTimezone,
        releaseDelayDays,
        minSeedersOverride,
        maxSizeGbOverride,
        maxPagesPerBucket,
        maxCandidatesPerBucket,
      })
    : runSelectionJob({
        type: 'movie',
        force,
        preserveLastRun,
        targetTotal,
        triggerReason,
        selectionLogId,
        releaseDate,
        releaseTag,
        releaseTimezone,
        releaseDelayDays,
        minSeedersOverride,
        maxSizeGbOverride,
        maxPagesPerBucket,
        maxCandidatesPerBucket,
      });
}

export async function ensureAutoSelectionSeeded({ type = 'movie' } = {}) {
  const t = sanitizeType(type);
  const lockKey = `seed:${t}`;

  if (bootstrapLocks.has(lockKey)) {
    await bootstrapLocks.get(lockKey);
    return { ok: true, type: t, skipped: true, reason: 'in_progress' };
  }

  const work = (async () => {
    const settings = await getAutodownloadSettings();
    const enabledForType = Boolean(settings?.enabled && (t === 'series' ? settings?.seriesEnabled : settings?.moviesEnabled));
    if (!enabledForType) return { ok: true, type: t, skipped: true, reason: 'disabled' };

    const db = await getAdminDb();
    const listKey = t === 'series' ? 'downloadsSeries' : 'downloadsMovies';
    const list = Array.isArray(db?.[listKey]) ? db[listKey] : [];
    const hasActive = list.some((x) => String(x?.status || '').toLowerCase() !== 'deleted');
    if (hasActive) return { ok: true, type: t, skipped: true, reason: 'queue_has_items' };

    const lastRunAt = Number(settings?.selection?.[selectionLastRunKey(t)] || 0);
    if (lastRunAt > 0) {
      return { ok: true, type: t, skipped: true, reason: 'already_ran' };
    }

    const result = await runSelectionJobForType({ type: t, force: true });
    return { ok: true, type: t, ran: !result?.skipped, result };
  })();

  bootstrapLocks.set(lockKey, work);
  try {
    return await work;
  } finally {
    bootstrapLocks.delete(lockKey);
  }
}
