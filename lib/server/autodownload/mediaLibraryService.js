import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { getEngineHost } from './autodownloadDb';
import { getLibraryInventorySnapshot, getOrRefreshLibraryInventory } from './libraryInventoryService';
import { fetchMountStatus } from './mountService';
import { SSHService } from './sshService';
import { clearXuiLibraryCatalogCache } from './xuiLibraryCatalogService';
import { clearXuiMediaIndexCache, getXuiMediaIndex } from './xuiMediaIndexService';
import { xuiApiCall } from './xuiService';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_MEDIA_LIBRARY_LOGS = 2000;

function now() {
  return Date.now();
}

function normalizeType(type) {
  return String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizePresenceFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'both' || normalized === 'xui_only' || normalized === 'nas_only') return normalized;
  return 'all';
}

function normalizeSort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'title_desc') return normalized;
  if (normalized === 'year_desc') return normalized;
  if (normalized === 'year_asc') return normalized;
  if (normalized === 'presence') return normalized;
  return 'title_asc';
}

function clampInt(value, fallback, minValue, maxValue) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxValue, Math.max(minValue, Math.floor(parsed)));
}

function parseYear(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
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

function stripMediaTitleDecorators(value) {
  return String(value || '')
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s*[-_. ]+(?:2160p|1080p|720p|576p|480p|4k|uhd|fhd|hd|sd)\b.*$/i, '')
    .replace(/\s*\((19|20)\d{2}\)\s*$/i, '')
    .replace(/\s+(19|20)\d{2}\s*$/i, '')
    .trim();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function uniqueNumbers(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => Number(value || 0)).filter((value) => Number.isFinite(value) && value > 0))];
}

function mediaGroupKey({ title = '', originalTitle = '', year = '', fallback = '' } = {}) {
  const normalized = normalizeTitle(stripMediaTitleDecorators(title || originalTitle || fallback));
  if (normalized) return `${normalized}::${parseYear(year || title || originalTitle || fallback)}`;
  return normalizeId(fallback) || 'unknown::';
}

function mediaTitleOnlyKey({ title = '', originalTitle = '', fallback = '' } = {}) {
  const normalized = normalizeTitle(stripMediaTitleDecorators(title || originalTitle || fallback));
  if (normalized) return normalized;
  return normalizeId(fallback) || 'unknown::';
}

function fileLeafTitle(pathValue = '') {
  const raw = String(pathValue || '').trim();
  if (!raw) return '';
  const leaf = raw.split('/').filter(Boolean).pop() || '';
  return leaf.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
}

function calcAgeMs(timestamp) {
  const value = Number(timestamp || 0);
  return value > 0 ? Math.max(0, now() - value) : null;
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

function shQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function statusCounts(items = []) {
  return (Array.isArray(items) ? items : []).reduce(
    (acc, item) => {
      const status = String(item?.status || '').trim().toLowerCase();
      if (status === 'deleted') acc.deleted += 1;
      else if (status === 'missing') acc.missing += 1;
      else if (status === 'unavailable') acc.unavailable += 1;
      else if (status === 'failed') acc.failed += 1;
      return acc;
    },
    { deleted: 0, missing: 0, unavailable: 0, failed: 0 }
  );
}

function isSatisfiedStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'deleted' || normalized === 'missing';
}

function isDeletedStatus(status) {
  return String(status || '').trim().toLowerCase() === 'deleted';
}

function summarizeXuiStatus({ row, items = [] } = {}) {
  const xuiIds = uniqueNumbers(row?.xuiIds || []);
  if (!xuiIds.length) {
    return {
      status: 'missing',
      ids: [],
      items: [],
      counts: { deleted: 0, missing: 1, unavailable: 0, failed: 0 },
      label: 'Not existing in XUI',
    };
  }

  const counts = statusCounts(items);
  const hasUnavailable = counts.unavailable > 0;
  const hasFailed = counts.failed > 0;
  const hasDeleted = counts.deleted > 0;
  const hasMissing = counts.missing > 0;
  let status = 'failed';
  if (hasDeleted && !hasFailed && !hasUnavailable) status = 'deleted';
  else if (!hasDeleted && hasMissing && !hasFailed && !hasUnavailable) status = 'missing';
  else if ((hasDeleted || hasMissing) && (hasFailed || hasUnavailable)) status = 'partial';
  else if (hasUnavailable && !hasDeleted && !hasMissing && !hasFailed) status = 'unavailable';
  return {
    status,
    ids: xuiIds,
    items,
    counts,
    label:
      status === 'deleted'
        ? 'Deleted in XUI'
        : status === 'missing'
          ? 'Not existing in XUI'
          : status === 'partial'
            ? 'Partially deleted in XUI'
            : status === 'unavailable'
              ? 'XUI unavailable'
              : 'XUI delete failed',
  };
}

function summarizeOverallStatus({ xuiStatus = 'missing', nasStatus = 'missing' } = {}) {
  const statuses = [String(xuiStatus || 'missing').trim().toLowerCase(), String(nasStatus || 'missing').trim().toLowerCase()];
  const allMissing = statuses.every((status) => status === 'missing');
  const allSatisfied = statuses.every(isSatisfiedStatus);
  const anySatisfied = statuses.some(isSatisfiedStatus);
  const anyDeleted = statuses.some(isDeletedStatus);
  if (allMissing) return 'not_found';
  if (allSatisfied && anyDeleted) return 'completed';
  if (anySatisfied) return 'partial';
  return 'failed';
}

function buildEmptyGroup(type, groupKey) {
  return {
    id: `${normalizeType(type)}:${groupKey}`,
    type: normalizeType(type),
    groupKey,
    title: '',
    originalTitle: '',
    year: '',
    image: '',
    tmdbIds: [],
    xuiIds: [],
    aliases: [],
    category: '',
    genre: '',
    fileName: '',
    folder: '',
    nasPath: '',
  };
}

function buildMediaRows({ type = 'movie', inventory = null, xuiIndex = null } = {}) {
  const resolvedType = normalizeType(type);
  const groups = new Map();
  const groupsByTitle = new Map();
  const xuiRows = Array.isArray(xuiIndex?.[resolvedType === 'series' ? 'series' : 'movies'])
    ? xuiIndex[resolvedType === 'series' ? 'series' : 'movies']
    : [];
  const inventoryRows = Array.isArray(inventory?.[resolvedType === 'series' ? 'series' : 'movies'])
    ? inventory[resolvedType === 'series' ? 'series' : 'movies']
    : [];

  const ensureGroup = ({ title = '', originalTitle = '', year = '', fallback = '' } = {}) => {
    const groupKey = mediaGroupKey({ title, originalTitle, year, fallback });
    if (groups.has(groupKey)) return groups.get(groupKey);

    const titleKey = mediaTitleOnlyKey({ title, originalTitle, fallback });
    const titleMatches = Array.isArray(groupsByTitle.get(titleKey)) ? groupsByTitle.get(titleKey) : [];
    if (resolvedType === 'series' && titleMatches.length === 1) {
      const existing = titleMatches[0];
      const existingYear = parseYear(existing?.year);
      const candidateYear = parseYear(year || title || originalTitle || fallback);
      if (!existingYear || !candidateYear || existingYear === candidateYear) {
        groups.set(groupKey, existing);
        return existing;
      }
    }

    const group = buildEmptyGroup(resolvedType, groupKey);
    groups.set(groupKey, group);
    if (titleKey) {
      const nextMatches = titleMatches.slice();
      nextMatches.push(group);
      groupsByTitle.set(titleKey, nextMatches);
    }
    return group;
  };

  for (const row of xuiRows) {
    const group = ensureGroup({
      title: row?.title || '',
      originalTitle: row?.originalTitle || '',
      year: row?.year || '',
      fallback: `xui:${Number(row?.xuiId || 0) || crypto.randomUUID()}`,
    });
    if (!group.title && row?.title) group.title = String(row.title || '').trim();
    if (!group.originalTitle && row?.originalTitle) group.originalTitle = String(row.originalTitle || '').trim();
    if (!group.year && row?.year) group.year = parseYear(row.year);
    if (!group.image && row?.image) group.image = String(row.image || '').trim();
    if (Number(row?.tmdbId || 0) > 0) group.tmdbIds.push(Number(row.tmdbId));
    if (Number(row?.xuiId || 0) > 0) group.xuiIds.push(Number(row.xuiId));
    group.aliases.push(row?.title, row?.originalTitle, row?.filename, row?.xuiId, row?.tmdbId);
  }

  for (const row of inventoryRows) {
    const group = ensureGroup({
      title: row?.title || '',
      originalTitle: '',
      year: row?.year || '',
      fallback: `nas:${row?.path || crypto.randomUUID()}`,
    });
    if (!group.title && row?.title) group.title = String(row.title || '').trim();
    if (!group.year && row?.year) group.year = parseYear(row.year);
    if (!group.nasPath && row?.path) group.nasPath = String(row.path || '').trim();
    if (!group.genre && row?.genre) group.genre = String(row.genre || '').trim();
    if (resolvedType === 'movie') {
      if (!group.category && row?.category) group.category = String(row.category || '').trim();
      if (!group.fileName && row?.fileName) group.fileName = String(row.fileName || '').trim();
    } else if (!group.folder && row?.folder) {
      group.folder = String(row.folder || '').trim();
    }
    group.aliases.push(row?.title, row?.path, row?.fileName, row?.folder, row?.genre, row?.category);
  }

  const uniqueGroups = [...new Map([...groups.values()].map((group) => [group.id, group])).values()];

  return uniqueGroups
    .map((group) => {
      const xuiIds = uniqueNumbers(group.xuiIds);
      const tmdbIds = uniqueNumbers(group.tmdbIds);
      const aliases = uniqueStrings(group.aliases);
      const title = String(group.title || group.originalTitle || fileLeafTitle(group.nasPath) || 'Untitled').trim();
      const presence = xuiIds.length > 0 ? (group.nasPath ? 'both' : 'xui_only') : 'nas_only';
      const searchText = uniqueStrings([
        title,
        group.originalTitle,
        group.year,
        group.category,
        group.genre,
        group.fileName,
        group.folder,
        group.nasPath,
        ...aliases,
        ...xuiIds.map((value) => String(value)),
        ...tmdbIds.map((value) => String(value)),
      ])
        .join(' ')
        .toLowerCase();

      return {
        id: group.id,
        type: resolvedType,
        title,
        originalTitle: String(group.originalTitle || '').trim(),
        year: parseYear(group.year),
        image: String(group.image || '').trim(),
        tmdbId: tmdbIds[0] || 0,
        tmdbIds,
        xuiIds,
        xuiCount: xuiIds.length,
        xuiPrimaryId: xuiIds[0] || 0,
        category: String(group.category || '').trim(),
        genre: String(group.genre || '').trim(),
        fileName: String(group.fileName || '').trim(),
        folder: String(group.folder || '').trim(),
        nasPath: String(group.nasPath || '').trim(),
        presence,
        searchText,
      };
    })
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')) || String(a.year || '').localeCompare(String(b.year || '')));
}

function applyFilters(rows = [], { q = '', presence = 'all', category = '', genre = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const resolvedPresence = normalizePresenceFilter(presence);
  const resolvedCategory = String(category || '').trim().toLowerCase();
  const resolvedGenre = String(genre || '').trim().toLowerCase();

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (resolvedPresence !== 'all' && row?.presence !== resolvedPresence) return false;
    if (resolvedCategory && String(row?.category || '').trim().toLowerCase() !== resolvedCategory) return false;
    if (resolvedGenre && String(row?.genre || '').trim().toLowerCase() !== resolvedGenre) return false;
    if (!needle) return true;
    return String(row?.searchText || '').includes(needle);
  });
}

function sortRows(rows = [], sort = 'title_asc') {
  const resolvedSort = normalizeSort(sort);
  const presenceRank = { both: 0, xui_only: 1, nas_only: 2 };
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const titleOrder = String(a?.title || '').localeCompare(String(b?.title || ''));
    const yearA = Number(parseYear(a?.year) || 0) || 0;
    const yearB = Number(parseYear(b?.year) || 0) || 0;
    if (resolvedSort === 'title_desc') return titleOrder * -1 || String(b?.year || '').localeCompare(String(a?.year || ''));
    if (resolvedSort === 'year_desc') return yearB - yearA || titleOrder;
    if (resolvedSort === 'year_asc') return yearA - yearB || titleOrder;
    if (resolvedSort === 'presence') {
      const rankDiff = (presenceRank[a?.presence] ?? 9) - (presenceRank[b?.presence] ?? 9);
      return rankDiff || titleOrder;
    }
    return titleOrder || String(a?.year || '').localeCompare(String(b?.year || ''));
  });
}

function buildFilterOptions(rows = [], type = 'movie') {
  const categories = uniqueStrings(
    (Array.isArray(rows) ? rows : [])
      .map((row) => (normalizeType(type) === 'movie' ? String(row?.category || '').trim() : ''))
      .filter(Boolean)
  ).sort((a, b) => a.localeCompare(b));

  const genres = uniqueStrings((Array.isArray(rows) ? rows : []).map((row) => String(row?.genre || '').trim()).filter(Boolean)).sort((a, b) =>
    a.localeCompare(b)
  );

  return { categories, genres };
}

function summarizeRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => {
      acc.total += 1;
      if (row?.presence === 'both') acc.both += 1;
      else if (row?.presence === 'xui_only') acc.xuiOnly += 1;
      else if (row?.presence === 'nas_only') acc.nasOnly += 1;
      return acc;
    },
    { total: 0, both: 0, xuiOnly: 0, nasOnly: 0 }
  );
}

function normalizeLogEntry(entry = {}) {
  const xui = entry?.xui && typeof entry.xui === 'object' ? entry.xui : {};
  const nas = entry?.nas && typeof entry.nas === 'object' ? entry.nas : {};
  return {
    id: normalizeId(entry?.id) || crypto.randomUUID(),
    createdAt: Number(entry?.createdAt || 0) || now(),
    action: 'delete',
    type: normalizeType(entry?.type),
    rowId: normalizeId(entry?.rowId),
    title: String(entry?.title || '').trim(),
    year: parseYear(entry?.year),
    tmdbId: Number(entry?.tmdbId || 0) || 0,
    image: String(entry?.image || '').trim(),
    createdBy: String(entry?.createdBy || 'admin').trim() || 'admin',
    presenceAtAction: normalizePresenceFilter(entry?.presenceAtAction),
    status: ['completed', 'partial', 'failed', 'not_found'].includes(String(entry?.status || '').trim().toLowerCase())
      ? String(entry.status).trim().toLowerCase()
      : 'failed',
    xui: {
      status: String(xui?.status || 'missing').trim().toLowerCase() || 'missing',
      ids: uniqueNumbers(xui?.ids),
      items: (Array.isArray(xui?.items) ? xui.items : []).map((item) => ({
        xuiId: Number(item?.xuiId || 0) || 0,
        status: String(item?.status || 'failed').trim().toLowerCase() || 'failed',
        error: String(item?.error || '').trim(),
      })),
      counts: {
        deleted: Number(xui?.counts?.deleted || 0) || 0,
        missing: Number(xui?.counts?.missing || 0) || 0,
        unavailable: Number(xui?.counts?.unavailable || 0) || 0,
        failed: Number(xui?.counts?.failed || 0) || 0,
      },
      label: String(xui?.label || '').trim(),
    },
    nas: {
      status: String(nas?.status || 'missing').trim().toLowerCase() || 'missing',
      path: String(nas?.path || '').trim(),
      error: String(nas?.error || '').trim(),
    },
  };
}

function getMediaLibraryLogs(db, type = 'movie', limit = 20) {
  const resolvedType = normalizeType(type);
  const allLogs = (Array.isArray(db?.mediaLibraryLogs) ? db.mediaLibraryLogs : [])
    .map(normalizeLogEntry)
    .filter((entry) => entry.type === resolvedType);
  const logs = allLogs.slice(0, Math.max(0, Number(limit || 0) || 0));
  const last7dCutoff = now() - 7 * DAY_MS;
  const summary = allLogs.reduce(
    (acc, log) => {
      acc.total += 1;
      if (log.status === 'completed') acc.completed += 1;
      else if (log.status === 'partial') acc.partial += 1;
      else if (log.status === 'failed') acc.failed += 1;
      else if (log.status === 'not_found') acc.notFound += 1;
      if (Number(log.createdAt || 0) >= last7dCutoff) acc.last7d += 1;
      return acc;
    },
    { total: 0, completed: 0, partial: 0, failed: 0, notFound: 0, last7d: 0 }
  );
  return { items: logs, summary };
}

export async function listMediaLibraryLogs({ type = 'movie', limit = 100 } = {}) {
  const resolvedType = normalizeType(type);
  const db = await getAdminDb();
  return {
    ok: true,
    type: resolvedType,
    logs: getMediaLibraryLogs(db, resolvedType, clampInt(limit, 100, 1, 200)),
  };
}

function removeInventoryRowFromDb(db, row) {
  const inventory = db?.libraryInventory && typeof db.libraryInventory === 'object' ? db.libraryInventory : null;
  if (!inventory) return;
  const listKey = normalizeType(row?.type) === 'series' ? 'series' : 'movies';
  const rows = Array.isArray(inventory?.[listKey]) ? inventory[listKey] : [];
  const groupKey = mediaGroupKey({
    title: row?.title,
    originalTitle: row?.originalTitle,
    year: row?.year,
    fallback: row?.nasPath || row?.id,
  });
  inventory[listKey] = rows.filter((entry) => {
    const samePath = normalizeId(entry?.path) && normalizeId(entry?.path) === normalizeId(row?.nasPath);
    const entryGroupKey = mediaGroupKey({
      title: entry?.title,
      originalTitle: '',
      year: entry?.year,
      fallback: entry?.path || '',
    });
    return !samePath && entryGroupKey !== groupKey;
  });
  const movieCount = Array.isArray(inventory.movies) ? inventory.movies.length : 0;
  const seriesCount = Array.isArray(inventory.series) ? inventory.series.length : 0;
  inventory.stats = {
    ...(inventory.stats && typeof inventory.stats === 'object' ? inventory.stats : {}),
    movies: movieCount,
    series: seriesCount,
    total: movieCount + seriesCount,
  };
}

async function removePath({ ssh, pathValue } = {}) {
  const target = normalizeId(pathValue);
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
  const output = String(result?.stdout || '');
  return {
    ok: !/__FAILED__/.test(output),
    removed: /__REMOVED__/.test(output),
    missing: /__MISSING__/.test(output),
  };
}

async function deleteXuiItem({ type, xuiId } = {}) {
  const resolvedType = normalizeType(type);
  const mediaId = Number(xuiId || 0);
  if (!(mediaId > 0)) return { status: 'missing', error: '' };

  const action = resolvedType === 'series' ? 'delete_series' : 'delete_movie';
  const attempts =
    resolvedType === 'series'
      ? [{ id: mediaId }, { series_id: mediaId }]
      : [{ id: mediaId }, { movie_id: mediaId }, { stream_id: mediaId }];

  let lastError = '';
  for (const params of attempts) {
    try {
      const response = await xuiApiCall({ action, params });
      if (String(response?.status || '').trim().toUpperCase() === 'STATUS_SUCCESS') {
        return { status: 'deleted', error: '' };
      }
      lastError = String(response?.status || response?.message || '').trim() || 'delete failed';
    } catch (error) {
      lastError = String(error?.message || 'delete failed').trim();
      if (/not configured|required/i.test(lastError)) {
        return { status: 'unavailable', error: lastError };
      }
    }
  }

  return { status: 'failed', error: lastError || 'delete failed' };
}

async function verifyFailedXuiStatuses(type, results = []) {
  const failedIds = [];
  for (const result of Array.isArray(results) ? results : []) {
    for (const item of Array.isArray(result?.xui?.items) ? result.xui.items : []) {
      if (item?.status === 'failed' && Number(item?.xuiId || 0) > 0) failedIds.push(Number(item.xuiId));
    }
  }
  if (!failedIds.length) return results;

  clearXuiMediaIndexCache();
  try {
    const fresh = await getXuiMediaIndex({ force: true });
    const liveIds = new Set(
      (Array.isArray(fresh?.[normalizeType(type) === 'series' ? 'series' : 'movies'])
        ? fresh[normalizeType(type) === 'series' ? 'series' : 'movies']
        : []
      )
        .map((row) => Number(row?.xuiId || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
    );

    for (const result of Array.isArray(results) ? results : []) {
      const items = Array.isArray(result?.xui?.items) ? result.xui.items : [];
      for (const item of items) {
        if (item?.status === 'failed' && Number(item?.xuiId || 0) > 0 && !liveIds.has(Number(item.xuiId))) {
          item.status = 'missing';
          item.error = '';
        }
      }
      result.xui = summarizeXuiStatus({ row: result, items });
      result.status = summarizeOverallStatus({ xuiStatus: result?.xui?.status, nasStatus: result?.nas?.status });
    }
    return results;
  } catch {
    return results;
  }
}

function buildNasStatus({ row, raw = null, unavailableReason = '' } = {}) {
  if (!normalizeId(row?.nasPath)) {
    return { status: 'missing', path: '', error: '' };
  }
  if (raw?.removed) return { status: 'deleted', path: normalizeId(row.nasPath), error: '' };
  if (raw?.missing || raw?.reason === 'missing_path') return { status: 'missing', path: normalizeId(row.nasPath), error: '' };
  if (unavailableReason || raw?.reason === 'unavailable' || raw?.skipped) {
    return {
      status: 'unavailable',
      path: normalizeId(row.nasPath),
      error: unavailableReason || String(raw?.error || 'NAS is unavailable.').trim() || 'NAS is unavailable.',
    };
  }
  return { status: 'failed', path: normalizeId(row.nasPath), error: String(raw?.error || 'delete failed').trim() || 'delete failed' };
}

function summarizeDeleteResults(results = []) {
  return (Array.isArray(results) ? results : []).reduce(
    (acc, result) => {
      acc.requested += 1;
      if (result?.status === 'completed') acc.completed += 1;
      else if (result?.status === 'partial') acc.partial += 1;
      else if (result?.status === 'failed') acc.failed += 1;
      else if (result?.status === 'not_found') acc.notFound += 1;

      const xuiCounts = result?.xui?.counts || {};
      acc.xuiDeleted += Number(xuiCounts.deleted || 0) || 0;
      acc.xuiMissing += Number(xuiCounts.missing || 0) || 0;
      acc.xuiUnavailable += Number(xuiCounts.unavailable || 0) || 0;
      acc.xuiFailed += Number(xuiCounts.failed || 0) || 0;

      const nasStatus = String(result?.nas?.status || '').trim().toLowerCase();
      if (nasStatus === 'deleted') acc.nasDeleted += 1;
      else if (nasStatus === 'missing') acc.nasMissing += 1;
      else if (nasStatus === 'unavailable') acc.nasUnavailable += 1;
      else if (nasStatus === 'failed') acc.nasFailed += 1;

      return acc;
    },
    {
      requested: 0,
      completed: 0,
      partial: 0,
      failed: 0,
      notFound: 0,
      xuiDeleted: 0,
      xuiMissing: 0,
      xuiUnavailable: 0,
      xuiFailed: 0,
      nasDeleted: 0,
      nasMissing: 0,
      nasUnavailable: 0,
      nasFailed: 0,
    }
  );
}

export async function listMediaLibrary({
  type = 'movie',
  q = '',
  presence = 'all',
  category = '',
  genre = '',
  sort = 'title_asc',
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  refresh = false,
} = {}) {
  const resolvedType = normalizeType(type);
  const resolvedPageSize = clampInt(pageSize, DEFAULT_PAGE_SIZE, 10, MAX_PAGE_SIZE);
  const db = await getAdminDb();

  let inventory = await getLibraryInventorySnapshot();
  let inventoryMeta = {
    refreshed: false,
    stale: false,
    updatedAt: Number(inventory?.updatedAt || 0) || null,
    ageMs: calcAgeMs(inventory?.updatedAt),
    error: String(inventory?.lastError || '').trim(),
  };
  if (refresh) {
    const refreshedInventory = await getOrRefreshLibraryInventory({ force: true });
    inventory = refreshedInventory?.inventory || inventory;
    inventoryMeta = {
      refreshed: Boolean(refreshedInventory?.refreshed),
      stale: refreshedInventory?.ok === false,
      updatedAt: Number(inventory?.updatedAt || 0) || null,
      ageMs: calcAgeMs(inventory?.updatedAt),
      error: String(refreshedInventory?.error || inventory?.lastError || '').trim(),
    };
  }

  let mountStatus = db?.mountStatus || null;
  if (refresh) {
    mountStatus = await fetchMountStatus().catch(() => db?.mountStatus || null);
  }

  let xuiIndex = null;
  let xuiMeta = { available: false, fetchedAt: null, error: '', count: 0 };
  try {
    xuiIndex = await getXuiMediaIndex({ force: refresh });
    xuiMeta = {
      available: true,
      fetchedAt: Number(xuiIndex?.fetchedAt || 0) || null,
      error: '',
      count: Array.isArray(xuiIndex?.[resolvedType === 'series' ? 'series' : 'movies'])
        ? xuiIndex[resolvedType === 'series' ? 'series' : 'movies'].length
        : 0,
    };
  } catch (error) {
    xuiMeta = {
      available: false,
      fetchedAt: null,
      error: String(error?.message || 'Failed to load XUI media index.').trim(),
      count: 0,
    };
  }

  const allRows = buildMediaRows({ type: resolvedType, inventory, xuiIndex });
  const filteredRows = sortRows(applyFilters(allRows, { q, presence, category, genre }), sort);
  const totals = summarizeRows(allRows);
  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / resolvedPageSize));
  const resolvedPage = clampInt(page, 1, 1, totalPages);
  const startIndex = (resolvedPage - 1) * resolvedPageSize;
  const items = filteredRows.slice(startIndex, startIndex + resolvedPageSize);
  const logs = getMediaLibraryLogs(db, resolvedType, 20);

  return {
    ok: true,
    type: resolvedType,
    items,
    filters: buildFilterOptions(allRows, resolvedType),
    pagination: {
      page: resolvedPage,
      pageSize: resolvedPageSize,
      totalItems,
      totalPages,
      startIndex: totalItems ? startIndex + 1 : 0,
      endIndex: Math.min(totalItems, startIndex + resolvedPageSize),
    },
    summary: {
      ...totals,
      filtered: totalItems,
      recentDeletes: Number(logs?.summary?.last7d || 0) || 0,
    },
    sourceStatus: {
      xui: xuiMeta,
      nas: {
        available: Boolean(mountStatus?.ok === true && mountStatus?.writable === true),
        mountStatus,
        updatedAt: inventoryMeta.updatedAt,
        ageMs: inventoryMeta.ageMs,
        stale: Boolean(inventoryMeta.stale),
        error: inventoryMeta.error,
        count: Array.isArray(inventory?.[resolvedType === 'series' ? 'series' : 'movies'])
          ? inventory[resolvedType === 'series' ? 'series' : 'movies'].length
          : 0,
      },
    },
    logs,
  };
}

export async function deleteMediaLibraryItems({ type = 'movie', ids = [], actor = 'admin' } = {}) {
  const resolvedType = normalizeType(type);
  const targetIds = uniqueStrings((Array.isArray(ids) ? ids : []).map(normalizeId).filter(Boolean));
  if (!targetIds.length) {
    throw new Error('Choose at least one title to delete.');
  }

  const inventory = await getLibraryInventorySnapshot();
  let xuiIndex = null;
  try {
    xuiIndex = await getXuiMediaIndex({ force: true });
  } catch {}
  const rows = buildMediaRows({ type: resolvedType, inventory, xuiIndex });
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const foundRows = [];
  const missingResults = [];

  for (const id of targetIds) {
    const row = rowMap.get(id);
    if (row) foundRows.push(row);
    else {
      missingResults.push({
        id,
        type: resolvedType,
        title: 'Unavailable item',
        year: '',
        tmdbId: 0,
        image: '',
        presenceAtAction: 'all',
        xui: { status: 'missing', ids: [], items: [], counts: { deleted: 0, missing: 1, unavailable: 0, failed: 0 }, label: 'Not existing in XUI' },
        nas: { status: 'missing', path: '', error: '' },
        status: 'not_found',
      });
    }
  }

  const mountStatus = await fetchMountStatus().catch(async () => {
    const db = await getAdminDb();
    return db?.mountStatus || null;
  });

  const needsNasDelete = foundRows.some((row) => normalizeId(row?.nasPath));
  let ssh = null;
  let nasUnavailableReason = '';
  if (needsNasDelete) {
    const mountReady = Boolean(mountStatus?.ok === true && mountStatus?.writable === true);
    if (!mountReady) {
      nasUnavailableReason = String(mountStatus?.error || 'NAS is offline or not writable.').trim() || 'NAS is offline or not writable.';
    } else {
      const engineHost = await getEngineHost();
      if (!engineHost?.host) {
        nasUnavailableReason = 'Engine Host is not configured.';
      } else {
        try {
          ssh = sshFromEngineHost(engineHost);
          await ssh.connect({ timeoutMs: 20000 });
        } catch (error) {
          nasUnavailableReason = String(error?.message || 'Failed to connect to Engine Host.').trim() || 'Failed to connect to Engine Host.';
        }
      }
    }
  }

  const results = [];
  try {
    for (const row of foundRows) {
      const xuiItems = [];
      for (const xuiId of uniqueNumbers(row?.xuiIds)) {
        const response = await deleteXuiItem({ type: resolvedType, xuiId });
        xuiItems.push({
          xuiId,
          status: response?.status || 'failed',
          error: String(response?.error || '').trim(),
        });
      }

      let nasRaw = null;
      if (normalizeId(row?.nasPath)) {
        if (ssh) {
          try {
            nasRaw = await removePath({ ssh, pathValue: row.nasPath });
          } catch (error) {
            nasRaw = { ok: false, error: String(error?.message || 'delete failed').trim() || 'delete failed' };
          }
        } else {
          nasRaw = { ok: false, skipped: true, reason: 'unavailable' };
        }
      }

      const xui = summarizeXuiStatus({ row, items: xuiItems });
      const nas = buildNasStatus({ row, raw: nasRaw, unavailableReason: normalizeId(row?.nasPath) ? nasUnavailableReason : '' });
      results.push({
        ...row,
        xui,
        nas,
        status: summarizeOverallStatus({ xuiStatus: xui.status, nasStatus: nas.status }),
      });
    }
  } finally {
    if (ssh) await ssh.close().catch(() => null);
  }

  await verifyFailedXuiStatuses(resolvedType, results);

  clearXuiMediaIndexCache();
  clearXuiLibraryCatalogCache();

  const db = await getAdminDb();
  db.mediaLibraryLogs = Array.isArray(db.mediaLibraryLogs) ? db.mediaLibraryLogs : [];
  for (const result of results) {
    if (result?.nas?.status === 'deleted' || result?.nas?.status === 'missing') {
      removeInventoryRowFromDb(db, result);
    }
    db.mediaLibraryLogs.unshift(
      normalizeLogEntry({
        id: crypto.randomUUID(),
        createdAt: now(),
        action: 'delete',
        type: resolvedType,
        rowId: result.id,
        title: result.title,
        year: result.year,
        tmdbId: result.tmdbId,
        image: result.image,
        createdBy: String(actor || 'admin').trim() || 'admin',
        presenceAtAction: result.presence,
        status: result.status,
        xui: result.xui,
        nas: result.nas,
      })
    );
  }
  db.mediaLibraryLogs = db.mediaLibraryLogs.slice(0, MAX_MEDIA_LIBRARY_LOGS);
  await saveAdminDb(db);

  const combinedResults = [...results, ...missingResults];
  return {
    ok: true,
    type: resolvedType,
    results: combinedResults,
    summary: summarizeDeleteResults(combinedResults),
  };
}
