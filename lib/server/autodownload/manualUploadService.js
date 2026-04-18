import 'server-only';

import crypto from 'node:crypto';
import { Readable } from 'node:stream';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { appendProcessingLog, getAutodownloadSettings, getEngineHost, getMountSettings, updateXuiScanState } from './autodownloadDb';
import { getOrRefreshLibraryInventory } from './libraryInventoryService';
import { buildLibraryPaths, buildManualUploadPaths, getManualUploadFolderConfig } from './libraryFolders';
import { buildReleaseTagFromDateKey, computeReleaseMeta, dateKeyInTimezone, normalizeReleaseDelayDays, normalizeReleaseTimezone } from './releaseSchedule';
import { SSHService } from './sshService';
import { getTmdbDetailsById, resolveTmdbTitle } from './tmdbService';
import { processOneCompleted } from './processingService';
import { releaseDueSelections } from './releaseService';
import { clearXuiMediaIndexCache, getCachedXuiMediaIndex, matchXuiMedia } from './xuiMediaIndexService';
import { clearXuiLibraryCatalogCache } from './xuiLibraryCatalogService';
import { clearPublicCatalogDataCache } from '../publicCatalogDataCache';

const manualUploadPostProcessQueue = [];
const manualUploadPostProcessKeys = new Set();
const MANUAL_UPLOAD_POST_PROCESS_DELAY_MS = 10_000;
const MANUAL_UPLOAD_STALE_PROCESSING_MS = 2 * 60 * 60 * 1000;
let manualUploadPostProcessActive = false;
let manualUploadPostProcessTimer = null;

function now() {
  return Date.now();
}

function sanitizeType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'series') return 'series';
  return 'movie';
}

function dbKeyForType(type) {
  return sanitizeType(type) === 'series' ? 'downloadsSeries' : 'downloadsMovies';
}

function shQuote(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
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

function normalizeYear(value) {
  const y = String(value || '').trim().slice(0, 4);
  return /^\d{4}$/.test(y) ? y : '';
}

function normalizeReleaseDateKey(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function clampInt(value, fallback, minValue, maxValue) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxValue, Math.max(minValue, Math.floor(parsed)));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTmdbSearchTitle(title = '') {
  let value = String(title || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  value = value.replace(/\.[a-z0-9]{2,4}$/i, '').trim();
  value = value.replace(/[._]/g, ' ');
  value = value.replace(/\[[^\]]+\]/g, ' ');
  value = value.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  value = value.replace(/\b(?:2160p|1080p|720p|480p|4k|hdr|hevc|x265|x264|h265|h264|bluray|web[- ]?dl|webrip|dvdrip|brrip|proper|repack)\b/gi, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  value = value.replace(/\b(?:part|pt)\.?\s*1\b$/i, '').trim();
  if (/\s+1$/i.test(value)) {
    const candidate = value.replace(/\s+1$/i, '').trim();
    if (candidate.split(/\s+/).length >= 2) return candidate;
  }
  return value;
}

function stripLeadingManualMovieIndex(title = '') {
  const value = String(title || '').trim();
  const match = value.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return value;
  const rawIndex = String(match[1] || '');
  const rest = String(match[2] || '').trim();
  const indexValue = Number(rawIndex);
  if (!rest || !Number.isFinite(indexValue) || indexValue <= 0) return value;
  const repeatedIndex = new RegExp(`\\b0*${indexValue}\\b`).test(rest);
  const zeroPaddedIndex = /^0\d$/.test(rawIndex);
  if (repeatedIndex || zeroPaddedIndex) return rest;
  return value;
}

function stripManualMovieTitleNoise(title = '') {
  let value = normalizeTmdbSearchTitle(title);
  value = stripLeadingManualMovieIndex(value).trim();
  value = value
    .replace(/\b(?:eng(?:lish)?\s+subs?|subs?|subtitles?|h24[56]|h26[45]|x26[45]|mp4|mkv|avi)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = value
    .replace(
      /\s+[-–—]\s+(?:family\s+)?(?:action|adventure|animation|anime|comedy|crime|documentary|drama|family|fantasy|horror|kids|mystery|romance|sci[- ]?fi|science fiction|thriller|war|western)(?:\s+.*)?$/i,
      ''
    )
    .trim();
  return normalizeTmdbSearchTitle(value);
}

function compactManualMovieSequelTitle(title = '') {
  const value = stripManualMovieTitleNoise(title);
  const match = value.match(/^(.+?\b(?:[2-9]|1[0-9]|[IVX]{2,6}))\b(?:\s*[:\-–—]\s+|\s+).+$/i);
  return match ? String(match[1] || '').trim() : '';
}

function manualTmdbTitleCandidates({ type = 'movie', title = '' } = {}) {
  const t = sanitizeType(type);
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  const normalized = normalizeTmdbSearchTitle(raw);
  const candidates =
    t === 'series'
      ? [normalized, raw]
      : [compactManualMovieSequelTitle(raw), stripManualMovieTitleNoise(raw), normalized, raw];
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const value = String(candidate || '').replace(/\s+/g, ' ').trim();
    const key = normalizeText(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function titleIdentityKeys({ type = 'movie', title = '' } = {}) {
  const values = [title, ...manualTmdbTitleCandidates({ type, title })];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = normalizeTitleIdentity(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function sameTitleIdentity({ type = 'movie', rowTitle = '', wantedTitle = '' } = {}) {
  const rowKeys = titleIdentityKeys({ type, title: rowTitle });
  const wantedKeys = titleIdentityKeys({ type, title: wantedTitle });
  if (!rowKeys.length || !wantedKeys.length) return false;
  return rowKeys.some((key) => wantedKeys.includes(key));
}

async function resolveManualUploadTmdbTitle({ kind = 'movie', title = '', year = '' } = {}) {
  const t = sanitizeType(kind);
  let lastError = null;
  for (const candidate of manualTmdbTitleCandidates({ type: t, title })) {
    try {
      const tmdb = await resolveTmdbTitle({ kind: t, title: candidate, year });
      if (tmdb?.ok) return tmdb;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return { ok: false, notFound: true };
}

function buildManualUploadTmdbFallback({
  type = 'movie',
  tmdbId = 0,
  tmdbMediaType = null,
  title = '',
  year = '',
} = {}) {
  const t = sanitizeType(type);
  const pickedType = String(tmdbMediaType || (t === 'series' ? 'tv' : 'movie')).trim().toLowerCase();
  const cleanId = Number(tmdbId || 0) || 0;
  const cleanTitle = String(title || '').trim();
  const cleanYear = normalizeYear(year);
  if (cleanId <= 0 || !cleanTitle) return null;
  return {
    ok: true,
    id: cleanId,
    mediaType: pickedType === 'tv' || pickedType === 'series' ? 'tv' : 'movie',
    title: cleanTitle,
    releaseDate: cleanYear ? `${cleanYear}-01-01` : '',
    year: cleanYear,
    imdbId: '',
    numberOfSeasons: t === 'series' ? 0 : null,
    numberOfEpisodes: t === 'series' ? 0 : null,
    originalLanguage: '',
    genres: [],
    genresDetailed: [],
    certification: '',
    contentRating: '',
    kidsSafe: false,
    kidsReason: '',
    rating: null,
    runtime: null,
    overview: '',
    posterPath: '',
    backdropPath: '',
  };
}

function manualCleanedReadyPatterns({ type = 'movie', tmdb = null, title = '', year = '' } = {}) {
  const t = sanitizeType(type);
  const resolvedTitle = String(tmdb?.title || title || '').trim();
  const resolvedYear = normalizeYear(tmdb?.year || year || '');
  if (!resolvedTitle) return [];

  const labels = [];
  if (resolvedYear) {
    labels.push(`${resolvedTitle} (${resolvedYear})`);
    labels.push(`${resolvedTitle} ${resolvedYear}`);
  }
  labels.push(resolvedTitle);

  const patterns = [];
  for (const label of labels) {
    const safe = sanitizeFsName(label);
    if (!safe) continue;
    patterns.push(t === 'movie' ? `${safe}*` : safe);
    patterns.push(`${safe}-*`);
  }
  return uniqueStrings(patterns);
}

async function findManualCleanedReadyDuplicate({
  ssh = null,
  type = 'movie',
  tmdb = null,
  title = '',
  year = '',
  mountDir = '',
  settings = null,
} = {}) {
  if (!ssh || !mountDir) return null;
  const t = sanitizeType(type);
  const paths = buildManualUploadPaths({ mountDir, type: t, settings: settings || {} });
  const cleanedRoot = normalizeDirPath(paths?.processingDir || '');
  if (!cleanedRoot) return null;

  const patterns = manualCleanedReadyPatterns({ type: t, tmdb, title, year });
  if (!patterns.length) return null;

  const expr = patterns.map((pattern) => `-iname ${shQuote(pattern)}`).join(' -o ');
  const cmd = [
    'set -e',
    `ROOT=${shQuote(cleanedRoot)}`,
    'if [ ! -d "$ROOT" ]; then exit 0; fi',
    `find "$ROOT" -mindepth 1 -maxdepth 2 -type d \\( ${expr} \\) -print -quit 2>/dev/null || true`,
  ].join('\n');

  const direct = await ssh.exec(cmd, { timeoutMs: 30000 }).catch(() => null);
  const directPath = String(direct?.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || '';
  if (directPath) {
    return {
      source: 'manual_cleaned_ready',
      path: directPath,
      root: cleanedRoot,
    };
  }

  const elevated = await ssh.exec(cmd, { timeoutMs: 30000, sudo: true }).catch(() => null);
  const elevatedPath = String(elevated?.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || '';
  if (!elevatedPath) return null;
  return {
    source: 'manual_cleaned_ready',
    path: elevatedPath,
    root: cleanedRoot,
  };
}

function normalizeManualSort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'title_asc') return normalized;
  if (normalized === 'title_desc') return normalized;
  if (normalized === 'release_date_asc') return normalized;
  if (normalized === 'release_date_desc') return normalized;
  if (normalized === 'uploaded_asc') return normalized;
  return 'uploaded_desc';
}

function compareStrings(a, b, dir = 'asc') {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  const result = left.localeCompare(right, undefined, { sensitivity: 'base' });
  return dir === 'desc' ? -result : result;
}

function compareNumbers(a, b, dir = 'desc') {
  const left = Number(a || 0) || 0;
  const right = Number(b || 0) || 0;
  return dir === 'asc' ? left - right : right - left;
}

function isStaleManualProcessing(row = {}, ts = now()) {
  if (row?.manualUpload !== true) return false;
  if (String(row?.status || '').trim().toLowerCase() !== 'processing') return false;
  const startedAt = Number(row?.processingStartedAt || row?.manualUploadedAt || row?.addedAt || 0) || 0;
  return Boolean(startedAt && ts - startedAt > MANUAL_UPLOAD_STALE_PROCESSING_MS);
}

function normalizeManualStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeManualReleaseState(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeManualResult(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'failed' || normalized === 'unsuccessful') return 'failed';
  if (normalized === 'successful' || normalized === 'success') return 'successful';
  return 'all';
}

function normalizeManualItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const title = String(item?.tmdb?.title || item?.title || '').trim() || 'Untitled';
    const year = String(item?.tmdb?.year || item?.year || '').trim();
    const staleProcessing = isStaleManualProcessing(item);
    const status = staleProcessing ? 'Failed' : String(item?.status || '').trim();
    const releaseState = staleProcessing ? 'failed_upload' : String(item?.releaseState || '').trim();
    const error = staleProcessing
      ? String(item?.error || 'Manual upload processing was interrupted by a server restart. Re-upload or delete this failed record.').trim()
      : String(item?.error || '').trim();
    const uploadedAt = Number(item?.manualUploadedAt || item?.addedAt || 0) || null;
    const statusKey = normalizeManualStatus(status);
    const releaseStateKey = normalizeManualReleaseState(releaseState);
    const resultKey = statusKey === 'failed' ? 'failed' : 'successful';
    return {
      ...item,
      title,
      year,
      status,
      releaseState,
      error,
      uploadedAt,
      statusKey,
      releaseStateKey,
      resultKey,
      staleProcessing,
      searchKey: normalizeText(
        [
          title,
          year,
          item?.tmdb?.title,
          item?.downloadPath,
          item?.manualUploadedBy,
          status,
          releaseState,
          item?.releaseDate,
          error,
        ]
          .filter(Boolean)
          .join(' ')
      ),
    };
  });
}

function getVideoExtensions(settings) {
  const list = Array.isArray(settings?.fileRules?.videoExtensions) ? settings.fileRules.videoExtensions : [];
  const exts = list
    .map((x) => String(x || '').trim().toLowerCase().replace(/^\./, ''))
    .filter((x) => /^[a-z0-9]+$/.test(x));
  return exts.length ? exts : ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'];
}

function hasAnyVideoFile(files = [], videoExts = []) {
  const allowed = new Set(videoExts.map((x) => String(x || '').trim().toLowerCase().replace(/^\./, '')).filter(Boolean));
  for (const file of Array.isArray(files) ? files : []) {
    const name = String(file?.name || '').trim();
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (allowed.has(ext)) return true;
  }
  return false;
}

function normalizeDirPath(pathValue = '') {
  return String(pathValue || '')
    .trim()
    .replace(/\/+$/, '');
}

function uniquePaths(values = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = normalizeDirPath(raw);
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function isStrictChildPath(pathValue = '', rootValue = '') {
  const path = normalizeDirPath(pathValue);
  const root = normalizeDirPath(rootValue);
  if (!path || !root) return false;
  if (path === root) return false;
  return path.startsWith(`${root}/`);
}

function parentDir(pathValue = '') {
  const value = normalizeDirPath(pathValue);
  if (!value) return '';
  const idx = value.lastIndexOf('/');
  if (idx <= 0) return '';
  return value.slice(0, idx);
}

function baseName(pathValue = '') {
  const value = normalizeDirPath(pathValue);
  if (!value) return '';
  const idx = value.lastIndexOf('/');
  return idx >= 0 ? value.slice(idx + 1) : value;
}

function releaseTagDirFromHold({ holdDir, releaseTag } = {}) {
  const parent = parentDir(holdDir);
  if (!parent) return '';
  const tag = String(releaseTag || '').trim();
  if (!tag) return parent;
  return baseName(parent) === tag ? parent : '';
}

function resolveReleasedManualTargetDir({ rec = {}, type = 'movie' } = {}) {
  const t = sanitizeType(type);
  const target = normalizeDirPath(rec?.finalTargetDir || rec?.finalDir || '');
  if (!target) return '';
  if (t !== 'movie') return target;
  const holdBase = baseName(rec?.holdDir || '');
  if (!holdBase) return target;
  const targetBase = baseName(target);
  if (String(targetBase || '').toLowerCase() === String(holdBase || '').toLowerCase()) return target;
  return `${target}/${holdBase}`;
}

function reminderMediaType(type = 'movie') {
  return sanitizeType(type) === 'series' ? 'tv' : 'movie';
}

function reminderKey(tmdbId, mediaType) {
  return `${String(mediaType || '').trim().toLowerCase() === 'tv' ? 'tv' : 'movie'}:${Number(tmdbId || 0)}`;
}

async function remotePathExists(ssh, targetPath) {
  const path = normalizeDirPath(targetPath);
  if (!path) return false;
  const cmd = `[ -e ${shQuote(path)} ] && echo 1 || echo 0`;
  const direct = await ssh.exec(cmd, { timeoutMs: 15000 }).catch(() => null);
  if (String(direct?.stdout || '').trim() === '1') return true;
  const elevated = await ssh.exec(cmd, { timeoutMs: 15000, sudo: true }).catch(() => null);
  return String(elevated?.stdout || '').trim() === '1';
}

async function removeRemoteDirIfSafe({ ssh, targetPath, allowedRoots = [] } = {}) {
  const path = normalizeDirPath(targetPath);
  const roots = uniquePaths(allowedRoots);
  if (!path) return { ok: true, removed: false, skipped: true, reason: 'empty', path };
  if (!roots.some((root) => isStrictChildPath(path, root))) {
    return { ok: false, removed: false, skipped: true, reason: 'unsafe_path', path };
  }
  const exists = await remotePathExists(ssh, path);
  if (!exists) return { ok: true, removed: false, skipped: true, reason: 'not_found', path };
  await ssh.exec(`rm -rf -- ${shQuote(path)}`, { timeoutMs: 2 * 60 * 1000, sudo: true });
  return { ok: true, removed: true, skipped: false, reason: 'removed', path };
}

async function removeRemoteDirIfEmptySafe({ ssh, targetPath, allowedRoots = [] } = {}) {
  const path = normalizeDirPath(targetPath);
  const roots = uniquePaths(allowedRoots);
  if (!path) return { ok: true, removed: false, skipped: true, reason: 'empty', path };
  if (!roots.some((root) => isStrictChildPath(path, root))) {
    return { ok: false, removed: false, skipped: true, reason: 'unsafe_path', path };
  }
  const exists = await remotePathExists(ssh, path);
  if (!exists) return { ok: true, removed: false, skipped: true, reason: 'not_found', path };
  const cmd = [
    'set -euo pipefail',
    `DIR=${shQuote(path)}`,
    'if [ ! -d "$DIR" ]; then',
    '  echo "__MISSING__"',
    '  exit 0',
    'fi',
    'if find "$DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then',
    '  echo "__NOT_EMPTY__"',
    '  exit 0',
    'fi',
    'rmdir "$DIR" >/dev/null 2>&1 || true',
    'if [ -d "$DIR" ]; then',
    '  echo "__FAILED__"',
    'else',
    '  echo "__REMOVED__"',
    'fi',
  ].join('\n');
  const result = await ssh.exec(cmd, { timeoutMs: 60000, sudo: true });
  const out = String(result?.stdout || '');
  return {
    ok: !out.includes('__FAILED__'),
    removed: out.includes('__REMOVED__'),
    skipped: out.includes('__NOT_EMPTY__'),
    reason: out.includes('__NOT_EMPTY__') ? 'not_empty' : out.includes('__MISSING__') ? 'not_found' : out.includes('__REMOVED__') ? 'removed' : out.includes('__FAILED__') ? 'failed' : 'checked',
    path,
  };
}

async function cleanupManualUploadResidue({ ssh, targets = [], allowedRoots = [] } = {}) {
  const result = {
    ok: true,
    attempted: 0,
    removed: 0,
    notFound: 0,
    unsafe: 0,
    failed: 0,
    items: [],
  };
  for (const target of uniquePaths(targets)) {
    result.attempted += 1;
    try {
      const cleanup = await removeRemoteDirIfSafe({ ssh, targetPath: target, allowedRoots });
      result.items.push(cleanup);
      if (cleanup.removed) result.removed += 1;
      else if (cleanup.reason === 'not_found') result.notFound += 1;
      else if (cleanup.reason === 'unsafe_path') result.unsafe += 1;
    } catch (error) {
      result.ok = false;
      result.failed += 1;
      result.items.push({
        ok: false,
        removed: false,
        skipped: false,
        reason: 'error',
        path: normalizeDirPath(target),
        error: error?.message || 'Failed to remove remote path.',
      });
    }
  }
  return result;
}

function canDeleteManualUploadRecord(row = {}) {
  if (row?.manualUpload !== true) return false;
  const statusLower = String(row?.status || '').trim().toLowerCase();
  return statusLower !== 'processing' || isStaleManualProcessing(row);
}

function hasWaitingQueueForReminder(db, { tmdbId = 0, mediaType = 'movie', skipId = '' } = {}) {
  const wantedKey = reminderKey(tmdbId, mediaType);
  if (!wantedKey || wantedKey.endsWith(':0')) return false;
  for (const collection of ['downloadsMovies', 'downloadsSeries']) {
    const rows = Array.isArray(db?.[collection]) ? db[collection] : [];
    for (const row of rows) {
      if (String(row?.id || '').trim() === String(skipId || '').trim()) continue;
      if (String(row?.status || '').trim().toLowerCase() === 'deleted') continue;
      if (String(row?.releaseState || '').trim().toLowerCase() !== 'waiting') continue;
      const rowMediaType = String(row?.tmdb?.mediaType || (collection === 'downloadsSeries' ? 'tv' : 'movie')).trim().toLowerCase() === 'tv' ? 'tv' : 'movie';
      if (reminderKey(row?.tmdb?.id || 0, rowMediaType) !== wantedKey) continue;
      return true;
    }
  }
  return false;
}

function buildManualDeleteSummary(results = []) {
  const list = Array.isArray(results) ? results : [];
  return {
    requested: list.length,
    deleted: list.filter((item) => item?.status === 'deleted').length,
    failed: list.filter((item) => item?.status === 'failed').length,
    notFound: list.filter((item) => item?.status === 'not_found').length,
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

function fileToNodeStream(file) {
  if (!file) return null;
  if (typeof file.stream === 'function') {
    const stream = file.stream();
    if (stream && typeof Readable.fromWeb === 'function') {
      return Readable.fromWeb(stream);
    }
  }
  return null;
}

async function uploadFilesToEngine({
  ssh,
  type,
  mountDir,
  settings,
  uploadId,
  folderLabel,
  files = [],
  filePaths = [],
} = {}) {
  const t = sanitizeType(type);
  const paths = buildManualUploadPaths({ mountDir, type: t, settings });
  const destRoot = normalizeDirPath(paths?.incomingDir || '');
  if (!destRoot) throw new Error('Manual Upload Incoming folder is not configured.');

  const folderSafe = sanitizeFsName(folderLabel || `Manual Upload ${uploadId}`);
  const destDir = `${destRoot}/${folderSafe}-${String(uploadId).slice(0, 8)}`;

  const tmpBaseRoot = '/tmp/3j-tv-manual-upload';
  const tmpRoot = `${tmpBaseRoot}/${sanitizeFsName(uploadId)}`;
  await ssh.exec(`mkdir -p -- ${shQuote(tmpRoot)}`, { timeoutMs: 30000 });

  const uploaded = [];
  const safeRelPath = (value = '') => {
    const raw = String(value || '').replace(/\\/g, '/');
    const parts = raw
      .split('/')
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .filter((p) => p !== '.' && p !== '..');
    if (!parts.length) return sanitizeFsName('upload.bin');
    return parts.map((p) => sanitizeFsName(p)).filter(Boolean).join('/');
  };

  const mkdirpForFile = async (remoteFilePath) => {
    const p = String(remoteFilePath || '').replace(/\\/g, '/').trim();
    const idx = p.lastIndexOf('/');
    const dir = idx > 0 ? p.slice(0, idx) : '';
    if (!dir) return;
    await ssh.exec(`mkdir -p -- ${shQuote(dir)}`, { timeoutMs: 30000 });
  };

  const srcFiles = Array.isArray(files) ? files : [];
  const relPaths = Array.isArray(filePaths) ? filePaths : [];
  try {
    for (let i = 0; i < srcFiles.length; i += 1) {
      const file = srcFiles[i];
      const rel = safeRelPath(relPaths[i] || file?.name || '');
      const tmpPath = `${tmpRoot}/${rel}`;
      const nodeStream = fileToNodeStream(file);
      if (!nodeStream) throw new Error('Upload stream is not supported in this runtime.');
      await mkdirpForFile(tmpPath);
      await ssh.uploadStream(nodeStream, tmpPath);
      uploaded.push({ name: rel.split('/').pop(), relPath: rel, tmpPath, size: Number(file?.size || 0) || null });
    }

    await ssh.exec(`mkdir -p -- ${shQuote(destDir)}`, { timeoutMs: 30000, sudo: true });
    await ssh.exec(`cp -R --no-preserve=all -- ${shQuote(tmpRoot)}/. ${shQuote(destDir)}/`, { timeoutMs: 120000, sudo: true });
    await ssh.exec(`rm -rf -- ${shQuote(tmpRoot)} 2>/dev/null || true`, { timeoutMs: 30000, sudo: true });

    return { ok: true, destDir, uploaded };
  } catch (error) {
    await cleanupManualUploadResidue({
      ssh,
      targets: [tmpRoot, destDir],
      allowedRoots: [tmpBaseRoot, destRoot],
    }).catch(() => null);
    throw error;
  }
}

function buildSelectionLog({ selectionType, releaseMeta, tmdb, actor = '' } = {}) {
  const ts = now();
  const logId = crypto.randomUUID();
  return {
    id: logId,
    selectionType,
    triggerReason: 'manual_upload',
    runAt: ts,
    updatedAt: ts,
    totalSelected: 1,
    recentAnimationSelected: 0,
    recentLiveActionSelected: 0,
    classicAnimationSelected: 0,
    classicLiveActionSelected: 0,
    skippedDuplicatesCount: 0,
    skippedNoSourceCount: 0,
    skippedStorageLimitCount: 0,
    insufficient: [],
    selectedItems: [
      {
        id: Number(tmdb?.id || 0) || `${tmdb?.title || 'manual'}`,
        tmdbId: Number(tmdb?.id || 0) || 0,
        title: String(tmdb?.title || '').trim(),
        year: String(tmdb?.year || '').trim(),
        type: selectionType,
        provider: 'manual_upload',
        bucket: '',
        selectionLogId: logId,
        releaseDate: String(releaseMeta?.releaseDate || '').trim(),
        releaseTag: String(releaseMeta?.releaseTag || '').trim(),
      },
    ],
    errorMessage: null,
    releaseDate: String(releaseMeta?.releaseDate || '').trim(),
    releaseTag: String(releaseMeta?.releaseTag || '').trim(),
    releaseDelayDays: Number(releaseMeta?.releaseDelayDays || 0) || 0,
    releaseTimezone: String(releaseMeta?.releaseTimezone || '').trim(),
    releasedAt: null,
    actor: String(actor || '').trim() || null,
    manualUpload: true,
  };
}

function buildManualDownloadRecord({
  type,
  tmdb,
  selectionLogId,
  releaseMeta,
  uploadDir,
  actor = '',
  status = 'Completed',
  error = '',
  progress = 1,
  releaseState = 'waiting',
  cleanup = null,
  uploadedFiles = [],
  completedAt = null,
} = {}) {
  const t = sanitizeType(type);
  const ts = now();
  const cleanTitle = String(tmdb?.title || '').trim();
  const cleanYear = String(tmdb?.year || '').trim();
  const recordId = crypto.randomUUID();
  const normalizedUploadDir = normalizeDirPath(uploadDir);
  const statusText = String(status || 'Completed').trim() || 'Completed';
  const errorText = String(error || '').trim();
  const cleanupInfo = cleanup && typeof cleanup === 'object' ? cleanup : null;
  const uploadedFileList = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const qbName = sanitizeFsName(`${cleanTitle}${cleanYear ? ` (${cleanYear})` : ''}`) || `Manual-${recordId.slice(0, 8)}`;

  return {
    id: recordId,
    type: t,
    title: cleanTitle,
    year: cleanYear,
    tmdb: tmdb && typeof tmdb === 'object' ? { ...tmdb } : null,
    targetCategory: null,
    targetGenre: null,
    url: null,
    qbHash: null,
    qbName,
    status: statusText,
    progress: Number(progress || 0),
    sizeBytes: null,
    addedAt: ts,
    completedAt: Number(completedAt || ts) || ts,
    cleanedAt: null,
    error: errorText,
    savePath: null,
    downloadPath: normalizedUploadDir,
    sourceCleanupPath: normalizedUploadDir,
    category: null,
    source: {
      provider: 'manual_upload',
      name: 'Manual upload',
      hash: '',
      quality: '',
      fetchedAt: ts,
      attempts: [],
    },
    sourceAttempts: 0,
    sourceLastAttemptAt: null,
    nextSourceRetryAt: null,
    seriesMeta: null,
    selectionLogId: String(selectionLogId || '').trim() || null,
    releaseDate: String(releaseMeta?.releaseDate || '').trim(),
    releaseTag: String(releaseMeta?.releaseTag || '').trim(),
    releaseTimezone: String(releaseMeta?.releaseTimezone || 'Asia/Manila').trim() || 'Asia/Manila',
    releaseDelayDays: Math.max(0, Math.min(30, Math.floor(Number(releaseMeta?.releaseDelayDays ?? 3) || 3))),
    releaseState: String(releaseState || 'waiting').trim() || 'waiting',
    releasedAt: null,
    holdDir: null,
    finalTargetDir: null,
    manualUpload: true,
    manualUploadedAt: ts,
    manualUploadedBy: String(actor || '').trim() || null,
    manualUploadCleanup: cleanupInfo,
    manualUploadFiles: uploadedFileList.slice(0, 500).map((item) => ({
      name: String(item?.name || '').trim(),
      relPath: String(item?.relPath || '').trim(),
      size: Number(item?.size || 0) || null,
    })),
  };
}

function sameManualIdentity(row = {}, { type = 'movie', tmdb = null, title = '', year = '' } = {}) {
  const rowTmdbId = Number(row?.tmdb?.id || row?.tmdbId || 0) || 0;
  const wantedTmdbId = Number(tmdb?.id || 0) || 0;
  if (rowTmdbId > 0 && wantedTmdbId > 0) return rowTmdbId === wantedTmdbId;

  const rowTitle = String(row?.tmdb?.title || row?.title || '').trim();
  const wantedTitle = String(tmdb?.title || title || '').trim();
  if (!sameTitleIdentity({ type, rowTitle, wantedTitle })) return false;

  const rowYear = normalizeYear(row?.tmdb?.year || row?.year || '');
  const wantedYear = normalizeYear(tmdb?.year || year || '');
  if (rowYear && wantedYear) return rowYear === wantedYear;
  return true;
}

function isActiveDuplicateCandidate(row = {}) {
  const statusLower = String(row?.status || '').trim().toLowerCase();
  const releaseStateLower = String(row?.releaseState || '').trim().toLowerCase();
  if (isStaleManualProcessing(row)) return false;
  if (statusLower === 'deleted' || statusLower === 'failed') return false;
  if (releaseStateLower === 'superseded' || releaseStateLower === 'failed_upload' || releaseStateLower === 'failed_retry') return false;
  return true;
}

function sameInventoryIdentity(row = {}, { type = 'movie', tmdb = null, title = '', year = '' } = {}) {
  const rowTitle = String(row?.title || '').trim();
  const wantedTitle = String(tmdb?.title || title || '').trim();
  if (!sameTitleIdentity({ type, rowTitle, wantedTitle })) return false;

  const rowYear = normalizeYear(row?.year || '');
  const wantedYear = normalizeYear(tmdb?.year || year || '');
  if (rowYear && wantedYear) return rowYear === wantedYear;
  return true;
}

function describeExistingPresence({ inventoryMatch = null, xuiMatch = null } = {}) {
  if (inventoryMatch && xuiMatch) return 'XUI + NAS';
  if (xuiMatch) return 'XUI';
  if (inventoryMatch) return 'NAS';
  return '';
}

function describeExistingQueueRow(row = {}) {
  const source = row?.manualUpload === true ? 'manual upload' : 'download';
  const status = String(row?.status || '').trim() || 'Unknown';
  const releaseState = String(row?.releaseState || '').trim();
  return releaseState ? `${source} record (${status}, ${releaseState})` : `${source} record (${status})`;
}

async function resolveDuplicateCheckTmdb({ type = 'movie', title = '', year = '', tmdbId = null, tmdbMediaType = null } = {}) {
  const t = sanitizeType(type);
  const cleanTitle = String(title || '').trim();
  const cleanYear = normalizeYear(year);
  const pickedId = tmdbId === null || tmdbId === undefined || String(tmdbId).trim() === '' ? 0 : Number(tmdbId || 0);
  const pickedType = String(tmdbMediaType || (t === 'series' ? 'tv' : 'movie'))
    .trim()
    .toLowerCase();

  if (pickedId > 0) {
    try {
      return await getTmdbDetailsById({
        mediaType: pickedType === 'tv' || pickedType === 'series' ? 'tv' : 'movie',
        id: pickedId,
      });
    } catch {
      const fallback = buildManualUploadTmdbFallback({
        type: t,
        tmdbId: pickedId,
        tmdbMediaType: pickedType,
        title: cleanTitle,
        year: cleanYear,
      });
      if (fallback) return fallback;
      throw new Error('TMDB duplicate check failed.');
    }
  }

  if (!cleanTitle) return { ok: false, notFound: true, missingTitle: true };
  return resolveManualUploadTmdbTitle({ kind: t, title: cleanTitle, year: cleanYear });
}

async function findManualUploadDuplicate({
  type = 'movie',
  tmdb = null,
  title = '',
  year = '',
  db = null,
  inventory = null,
  xuiIndex = null,
  manualCleanedReadyMatch = null,
} = {}) {
  const t = sanitizeType(type);
  const key = dbKeyForType(t);
  const rows = Array.isArray(db?.[key]) ? db[key] : [];
  const existingQueueRow = rows.find((row) => isActiveDuplicateCandidate(row) && sameManualIdentity(row, { type: t, tmdb, title, year })) || null;

  const inventoryRows = Array.isArray(inventory?.[t === 'series' ? 'series' : 'movies']) ? inventory[t === 'series' ? 'series' : 'movies'] : [];
  const inventoryMatch = inventoryRows.find((row) => sameInventoryIdentity(row, { type: t, tmdb, title, year })) || null;

  const xuiMatch =
    matchXuiMedia({
      type: t,
      tmdbId: Number(tmdb?.id || 0) || 0,
      title: String(tmdb?.title || title || '').trim(),
      originalTitle: String(tmdb?.originalTitle || '').trim(),
      year: String(tmdb?.year || year || '').trim(),
      index: xuiIndex,
    }) || null;

  const itemLabel = t === 'series' ? 'series' : 'movie';
  const resolvedTitle = String(tmdb?.title || title || 'Untitled').trim();
  const resolvedYear = normalizeYear(tmdb?.year || year || '');
  const reasons = [];
  const presence = describeExistingPresence({ inventoryMatch, xuiMatch });
  if (presence) reasons.push(`library: ${presence}`);
  if (existingQueueRow) reasons.push(describeExistingQueueRow(existingQueueRow));
  if (manualCleanedReadyMatch) reasons.push('manual upload cleaned-ready folder');

  const duplicate = Boolean(existingQueueRow || inventoryMatch || xuiMatch || manualCleanedReadyMatch);
  return {
    duplicate,
    type: t,
    title: resolvedTitle,
    year: resolvedYear,
    itemLabel,
    reasons,
    message: duplicate
      ? `This ${itemLabel} already exists in the system: ${resolvedTitle}${resolvedYear ? ` (${resolvedYear})` : ''} (${reasons.join('; ')}). Manual upload cancelled.`
      : '',
    libraryPresence: presence,
    queueRecord: existingQueueRow
      ? {
          id: String(existingQueueRow?.id || ''),
          status: String(existingQueueRow?.status || '').trim(),
          releaseState: String(existingQueueRow?.releaseState || '').trim(),
          label: describeExistingQueueRow(existingQueueRow),
        }
      : null,
    matched: {
      inventory: Boolean(inventoryMatch),
      xui: Boolean(xuiMatch),
      queue: Boolean(existingQueueRow),
      manualCleanedReady: Boolean(manualCleanedReadyMatch),
    },
    manualCleanedReady: manualCleanedReadyMatch
      ? {
          path: String(manualCleanedReadyMatch?.path || '').trim(),
          root: String(manualCleanedReadyMatch?.root || '').trim(),
        }
      : null,
  };
}

async function assertManualUploadNotDuplicate({
  type = 'movie',
  tmdb = null,
  title = '',
  year = '',
  settings = null,
  mount = null,
  engineHost = null,
} = {}) {
  const db = await getAdminDb();
  const inventoryResult = await getOrRefreshLibraryInventory().catch(() => null);
  const inventory = inventoryResult?.inventory || null;
  const xuiIndex = getCachedXuiMediaIndex();
  let ssh = null;
  let manualCleanedReadyMatch = null;
  try {
    if (engineHost && mount?.mountDir) {
      ssh = sshFromEngineHost(engineHost);
      manualCleanedReadyMatch = await findManualCleanedReadyDuplicate({
        ssh,
        type,
        tmdb,
        title,
        year,
        mountDir: mount.mountDir,
        settings,
      }).catch(() => null);
    }
  } finally {
    if (ssh) await ssh.close().catch(() => null);
  }
  const duplicate = await findManualUploadDuplicate({
    type,
    tmdb,
    title,
    year,
    db,
    inventory,
    xuiIndex,
    manualCleanedReadyMatch,
  });
  if (duplicate?.duplicate) {
    throw new Error(duplicate.message || 'This title already exists in the system.');
  }
}

export async function checkManualUploadDuplicateItems({ items = [] } = {}) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      key: String(item?.key || '').trim() || `item_${index}`,
      type: sanitizeType(item?.type || 'movie'),
      title: String(item?.title || '').trim(),
      year: normalizeYear(item?.year || ''),
      tmdbId: item?.tmdbId ?? null,
      tmdbMediaType: String(item?.tmdbMediaType || '').trim(),
    }))
    .filter((item) => item.title);

  if (!normalizedItems.length) return { ok: true, items: [] };

  const [db, inventoryResult, xuiIndex, settings, mount, engineHost] = await Promise.all([
    getAdminDb(),
    getOrRefreshLibraryInventory().catch(() => null),
    Promise.resolve(getCachedXuiMediaIndex()),
    getAutodownloadSettings().catch(() => null),
    getMountSettings().catch(() => null),
    getEngineHost().catch(() => null),
  ]);
  const inventory = inventoryResult?.inventory || null;
  const ssh = engineHost && mount?.mountDir ? sshFromEngineHost(engineHost) : null;

  try {
    const results = [];
    for (const item of normalizedItems) {
      let tmdb = null;
      let error = '';
      try {
        tmdb = await resolveDuplicateCheckTmdb(item);
        if (!tmdb?.ok) {
          error = 'TMDB match not found yet.';
          tmdb = null;
        }
      } catch (tmdbError) {
        error = tmdbError?.message || 'TMDB duplicate check failed.';
        tmdb = null;
      }

      const manualCleanedReadyMatch = ssh
        ? await findManualCleanedReadyDuplicate({
            ssh,
            type: item.type,
            tmdb,
            title: item.title,
            year: item.year,
            mountDir: mount?.mountDir || '',
            settings,
          }).catch(() => null)
        : null;

      const duplicate = await findManualUploadDuplicate({
        type: item.type,
        tmdb,
        title: item.title,
        year: item.year,
        db,
        inventory,
        xuiIndex,
        manualCleanedReadyMatch,
      });

      results.push({
        key: item.key,
        type: item.type,
        inputTitle: item.title,
        inputYear: item.year,
        title: duplicate?.title || item.title,
        year: duplicate?.year || item.year,
        duplicate: Boolean(duplicate?.duplicate),
        ready: !error,
        error,
        message: duplicate?.message || '',
        reasons: Array.isArray(duplicate?.reasons) ? duplicate.reasons : [],
        libraryPresence: duplicate?.libraryPresence || '',
        queueRecord: duplicate?.queueRecord || null,
        matched: duplicate?.matched || { inventory: false, xui: false, queue: false, manualCleanedReady: false },
        manualCleanedReady: duplicate?.manualCleanedReady || null,
        tmdb: tmdb?.ok
          ? {
              id: Number(tmdb?.id || 0) || 0,
              mediaType: String(tmdb?.mediaType || '').trim(),
              title: String(tmdb?.title || '').trim(),
              year: String(tmdb?.year || '').trim(),
            }
          : null,
      });
    }

    return {
      ok: true,
      items: results,
    };
  } finally {
    if (ssh) await ssh.close().catch(() => null);
  }
}

async function retirePreviousManualUploads({
  type = 'movie',
  tmdb = null,
  title = '',
  year = '',
  actor = '',
  ssh,
  mountDir = '',
  settings = null,
} = {}) {
  const t = sanitizeType(type);
  const db = await getAdminDb();
  const key = dbKeyForType(t);
  db[key] = Array.isArray(db[key]) ? db[key] : [];
  const manualPaths = buildManualUploadPaths({ mountDir, type: t, settings: settings || {} });
  const allowedRoots = [manualPaths?.incomingDir || '', manualPaths?.processingDir || ''];
  const summary = {
    ok: true,
    matched: 0,
    updated: 0,
    cleaned: 0,
    items: [],
  };

  for (let index = 0; index < db[key].length; index += 1) {
    const row = db[key][index];
    if (row?.manualUpload !== true) continue;
    const statusLower = String(row?.status || '').trim().toLowerCase();
    const releaseStateLower = String(row?.releaseState || '').trim().toLowerCase();
    if (statusLower === 'deleted' || statusLower === 'failed' || statusLower === 'cleaned') continue;
    if (releaseStateLower === 'released') continue;
    if (!sameManualIdentity(row, { type: t, tmdb, title, year })) continue;

    summary.matched += 1;
    const cleanup = await cleanupManualUploadResidue({
      ssh,
      targets: [row?.downloadPath || '', row?.holdDir || '', row?.finalDir || ''],
      allowedRoots,
    }).catch((error) => ({
      ok: false,
      attempted: 0,
      removed: 0,
      notFound: 0,
      unsafe: 0,
      failed: 1,
      items: [
        {
          ok: false,
          removed: false,
          skipped: false,
          reason: 'error',
          path: '',
          error: error?.message || 'Failed to clean previous manual upload residue.',
        },
      ],
    }));

    const cleanupError = cleanup?.items?.find((item) => String(item?.error || '').trim())?.error || '';
    const cleanupStatus = cleanup?.failed
      ? 'error'
      : cleanup?.removed
        ? 'removed'
        : cleanup?.notFound === cleanup?.attempted
          ? 'not_found'
          : cleanup?.unsafe
            ? 'unsafe_path'
            : 'checked';

    db[key][index] = {
      ...row,
      status: 'Deleted',
      error: 'Superseded by a newer manual upload retry.',
      releaseState: 'superseded',
      downloadPath: '',
      sourceCleanupPath: '',
      holdDir: null,
      finalDir: null,
      finalTargetDir: null,
      finalVideo: null,
      sourceCleanupStatus: cleanupStatus,
      sourceCleanupError: cleanupError,
      sourceCleanupCheckedAt: now(),
      sourceCleanupAt: cleanup?.removed ? now() : row?.sourceCleanupAt || null,
      manualUploadCleanup: cleanup,
      manualSupersededAt: now(),
      manualSupersededBy: String(actor || '').trim() || null,
      updatedAt: now(),
    };

    if (cleanup?.removed) summary.cleaned += 1;
    summary.updated += 1;
    summary.items.push({
      id: String(row?.id || ''),
      title: String(row?.tmdb?.title || row?.title || '').trim(),
      cleanup,
    });
  }

  if (summary.updated > 0) {
    await saveAdminDb(db);
  }

  return summary;
}

function getSubtitleExtensions(settings) {
  const list = Array.isArray(settings?.fileRules?.subtitleExtensions) ? settings.fileRules.subtitleExtensions : [];
  const exts = list
    .map((x) => String(x || '').trim().toLowerCase().replace(/^\./, ''))
    .filter((x) => /^[a-z0-9]+$/.test(x));
  return exts.length ? exts : ['srt', 'ass', 'ssa', 'sub', 'vtt'];
}

function getKeepSubtitleLanguages(settings) {
  const list = Array.isArray(settings?.fileRules?.keepSubtitleLanguages) ? settings.fileRules.keepSubtitleLanguages : [];
  const langs = list
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean)
    .filter((x, idx, arr) => arr.indexOf(x) === idx);
  return langs.length ? langs : ['en', 'tl'];
}

function getLanguagePatterns(settings) {
  const fallback = { en: '(eng|english|en)', tl: '(tag|fil|filipino|tl|tagalog)' };
  const raw = settings?.fileRules?.languagePatterns && typeof settings.fileRules.languagePatterns === 'object' ? settings.fileRules.languagePatterns : {};
  const out = {};
  for (const [k, v] of Object.entries({ ...fallback, ...raw })) {
    const key = String(k || '').trim().toLowerCase();
    const expr = String(v || '').trim();
    if (!key || !expr) continue;
    out[key] = expr;
  }
  return out;
}

function windowsShareGuessFromMountDir(mountDir = '') {
  const md = String(mountDir || '').trim();
  if (!md) return '';
  // Heuristic: this project often mounts `\\iptv_files` at `/mnt/windows_vod`.
  if (md === '/mnt/windows_vod') return '\\\\iptv_files';
  return '';
}

function toWindowsPath(p = '') {
  return String(p || '').replace(/\//g, '\\');
}

export async function listManualUploads({
  type = 'movie',
  limit = 50,
  q = '',
  result = 'all',
  status = '',
  releaseState = '',
  sort = 'uploaded_desc',
  page = 1,
  pageSize = 25,
} = {}) {
  const t = sanitizeType(type);
  const resolvedLimit = clampInt(limit, 5000, 1, 5000);
  const resolvedPageSize = clampInt(pageSize || limit, 25, 10, 100);
  const resolvedPage = clampInt(page, 1, 1, 100000);
  const normalizedQuery = normalizeText(q);
  const normalizedResult = normalizeManualResult(result);
  const normalizedStatus = normalizeManualStatus(status);
  const normalizedReleaseState = normalizeManualReleaseState(releaseState);
  const resolvedSort = normalizeManualSort(sort);
  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const rows = Array.isArray(db[key]) ? db[key] : [];
  const logs = Array.isArray(db.processingLogs) ? db.processingLogs : [];
  const latestLogFor = (downloadId) => {
    const wanted = String(downloadId || '').trim();
    if (!wanted) return null;
    const matches = logs.filter((log) => String(log?.downloadId || '').trim() === wanted);
    if (!matches.length) return null;
    matches.sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
    return matches[0] || null;
  };

  const allItems = rows
    .filter((row) => row?.manualUpload === true && String(row?.status || '').toLowerCase() !== 'deleted')
    .map((row) => {
      const log = latestLogFor(row?.id);
      const summary = log?.summary && typeof log.summary === 'object' ? log.summary : null;
      return {
        ...row,
        processingLog: log
          ? {
              id: String(log?.id || ''),
              createdAt: Number(log?.createdAt || 0) || null,
              status: String(log?.status || '').trim(),
              error: String(log?.error || '').trim() || null,
              summary,
            }
          : null,
      };
    });
  const normalizedItems = normalizeManualItems(allItems);
  const resultItems = normalizedItems.filter((item) => {
    if (normalizedResult === 'failed') return item.resultKey === 'failed';
    if (normalizedResult === 'successful') return item.resultKey === 'successful';
    return true;
  });
  const filteredItems = resultItems
    .filter((item) => (normalizedQuery ? item.searchKey.includes(normalizedQuery) : true))
    .filter((item) => (normalizedStatus && normalizedStatus !== 'all' ? item.statusKey === normalizedStatus : true))
    .filter((item) => (normalizedReleaseState && normalizedReleaseState !== 'all' ? item.releaseStateKey === normalizedReleaseState : true))
    .sort((left, right) => {
      if (resolvedSort === 'title_asc') return compareStrings(left.title, right.title, 'asc');
      if (resolvedSort === 'title_desc') return compareStrings(left.title, right.title, 'desc');
      if (resolvedSort === 'release_date_asc') return compareStrings(left.releaseDate, right.releaseDate, 'asc');
      if (resolvedSort === 'release_date_desc') return compareStrings(left.releaseDate, right.releaseDate, 'desc');
      if (resolvedSort === 'uploaded_asc') return compareNumbers(left.uploadedAt, right.uploadedAt, 'asc');
      return compareNumbers(left.uploadedAt, right.uploadedAt, 'desc');
    });

  const limitedItems = filteredItems.slice(0, resolvedLimit);
  const totalItems = limitedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / resolvedPageSize));
  const pageClamped = Math.min(resolvedPage, totalPages);
  const startIndex = (pageClamped - 1) * resolvedPageSize;
  const items = limitedItems.slice(startIndex, startIndex + resolvedPageSize);

  return {
    ok: true,
    type: t,
    items,
    pagination: {
      page: pageClamped,
      pageSize: resolvedPageSize,
      totalItems,
      totalPages,
      startIndex: totalItems ? startIndex + 1 : 0,
      endIndex: Math.min(totalItems, startIndex + resolvedPageSize),
    },
    summary: {
      total: resultItems.length,
      filtered: totalItems,
      allSuccessful: normalizedItems.filter((item) => item.resultKey === 'successful').length,
      allFailed: normalizedItems.filter((item) => item.resultKey === 'failed').length,
      successful: resultItems.filter((item) => item.resultKey === 'successful').length,
      failed: resultItems.filter((item) => item.resultKey === 'failed').length,
      released: resultItems.filter((item) => item.releaseStateKey === 'released').length,
      waiting: resultItems.filter((item) => item.releaseStateKey === 'waiting').length,
      processing: resultItems.filter((item) => item.statusKey === 'processing').length,
      cleaned: resultItems.filter((item) => item.statusKey === 'cleaned').length,
    },
    filters: {
      statuses: [...new Set(resultItems.map((item) => item.statusKey).filter(Boolean))].sort(),
      releaseStates: [...new Set(resultItems.map((item) => item.releaseStateKey).filter(Boolean))].sort(),
    },
    sort: resolvedSort,
    result: normalizedResult,
  };
}

export async function getManualUploadPreflight({ type = 'movie' } = {}) {
  const t = sanitizeType(type);
  const settings = await getAutodownloadSettings();
  const mount = await getMountSettings();
  if (!mount?.mountDir) throw new Error('Configure Storage & Mount first.');

  const paths = buildManualUploadPaths({ mountDir: mount.mountDir, type: t, settings });
  const incomingDir = String(paths?.incomingDir || '').trim();
  const cleanedDir = String(paths?.processingDir || '').trim();
  const processingFolderName = String(paths?.processingName || '').trim() || 'Processing';
  const cleanedFolderName = String(paths?.cleanedFolderName || '').trim() || 'Cleaned and Ready';

  const share = windowsShareGuessFromMountDir(mount.mountDir);
  const stageShare = share ? `${share}\\${String(paths?.rootName || 'Manual Upload')}\\${t === 'series' ? 'Series' : 'Movies'}` : '';
  const incomingShare = stageShare ? `${stageShare}\\${processingFolderName}` : '';
  const processingShare = stageShare ? `${stageShare}\\${cleanedFolderName}` : '';

  const tz = normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const delayDays = normalizeReleaseDelayDays(settings?.release?.delayDays ?? 3);
  const releaseDefaults = computeReleaseMeta({ startedAt: Date.now(), delayDays, timeZone: tz });

  return {
    ok: true,
    type: t,
    mountDir: mount.mountDir,
    manualUploadFolders: getManualUploadFolderConfig(settings),
    stage: {
      incomingDir,
      processingDir: cleanedDir,
      processingFolderName,
      cleanedFolderName,
      incomingShare,
      processingShare,
      incomingShareWindows: incomingShare ? toWindowsPath(incomingShare) : '',
      processingShareWindows: processingShare ? toWindowsPath(processingShare) : '',
    },
    rules: {
      videoExtensions: getVideoExtensions(settings),
      subtitleExtensions: getSubtitleExtensions(settings),
      keepSubtitleLanguages: getKeepSubtitleLanguages(settings),
      languagePatterns: getLanguagePatterns(settings),
    },
    releaseDefaults,
  };
}

function normalizeFolderName(value, fallback) {
  const s = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  const cleaned = s.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  return (cleaned || fallback).slice(0, 80);
}

export async function saveManualUploadFolderSettings({
  rootName = 'Manual Upload',
  moviesProcessing = 'Processing',
  moviesCleaned = 'Cleaned and Ready',
  seriesProcessing = 'Processing',
  seriesCleaned = 'Cleaned and Ready',
} = {}) {
  const db = await getAdminDb();
  db.autodownloadSettings = db.autodownloadSettings && typeof db.autodownloadSettings === 'object' ? db.autodownloadSettings : {};
  const current = db.autodownloadSettings.manualUploadFolders && typeof db.autodownloadSettings.manualUploadFolders === 'object' ? db.autodownloadSettings.manualUploadFolders : {};

  const next = {
    ...current,
    rootName: normalizeFolderName(rootName, 'Manual Upload'),
    movies: {
      ...(current.movies && typeof current.movies === 'object' ? current.movies : {}),
      processing: normalizeFolderName(moviesProcessing, 'Processing'),
      cleaned: normalizeFolderName(moviesCleaned, 'Cleaned and Ready'),
    },
    series: {
      ...(current.series && typeof current.series === 'object' ? current.series : {}),
      processing: normalizeFolderName(seriesProcessing, 'Processing'),
      cleaned: normalizeFolderName(seriesCleaned, 'Cleaned and Ready'),
    },
  };

  db.autodownloadSettings.manualUploadFolders = next;
  await saveAdminDb(db);
  return { ok: true, manualUploadFolders: next };
}

async function logManualUploadBackgroundError({ type = 'movie', id = '', error = null, actor = '' } = {}) {
  const t = sanitizeType(type);
  const cleanId = String(id || '').trim();
  if (!cleanId) return;

  try {
    const db = await getAdminDb();
    const key = dbKeyForType(t);
    const list = Array.isArray(db[key]) ? db[key] : [];
    const rec = list.find((row) => String(row?.id || '') === cleanId) || null;
    await appendProcessingLog({
      id: crypto.randomUUID(),
      createdAt: now(),
      type: t,
      downloadId: cleanId,
      tmdbId: rec?.tmdb?.id || null,
      title: rec?.title || rec?.tmdb?.title || '',
      status: 'error',
      error: error?.message || 'Manual upload background processing failed.',
      summary: {
        action: 'manual_upload_background_queue',
        actor: String(actor || '').trim() || null,
      },
    });
  } catch {}
}

async function runManualUploadPostProcessTask(task = {}) {
  const t = sanitizeType(task?.type);
  const cleanId = String(task?.id || '').trim();
  if (!cleanId) return;
  try {
    const processed = await processOneCompleted({ type: t, id: cleanId });
    if (!processed?.ok || !task?.releaseNow) return;
    await manualReleaseNow({ type: t, id: cleanId, actor: task?.actor || '' });
  } catch (error) {
    await logManualUploadBackgroundError({
      type: t,
      id: cleanId,
      error,
      actor: task?.actor || '',
    });
  }
}

async function drainManualUploadPostProcessQueue() {
  if (manualUploadPostProcessActive) return;
  manualUploadPostProcessActive = true;
  try {
    while (manualUploadPostProcessQueue.length) {
      const task = manualUploadPostProcessQueue.shift();
      const key = `${sanitizeType(task?.type)}:${String(task?.id || '').trim()}`;
      manualUploadPostProcessKeys.delete(key);
      await runManualUploadPostProcessTask(task);
    }
  } finally {
    manualUploadPostProcessActive = false;
    if (manualUploadPostProcessQueue.length) scheduleManualUploadPostProcessDrain();
  }
}

function scheduleManualUploadPostProcessDrain() {
  if (manualUploadPostProcessActive || manualUploadPostProcessTimer) return;
  manualUploadPostProcessTimer = setTimeout(() => {
    manualUploadPostProcessTimer = null;
    drainManualUploadPostProcessQueue().catch(() => null);
  }, MANUAL_UPLOAD_POST_PROCESS_DELAY_MS);
}

function startManualUploadPostProcess({ type = 'movie', id = '', releaseNow = false, actor = '' } = {}) {
  const t = sanitizeType(type);
  const cleanId = String(id || '').trim();
  if (!cleanId) return false;
  const key = `${t}:${cleanId}`;
  if (manualUploadPostProcessKeys.has(key)) return true;

  manualUploadPostProcessKeys.add(key);
  manualUploadPostProcessQueue.push({
    type: t,
    id: cleanId,
    releaseNow: Boolean(releaseNow),
    actor: String(actor || '').trim(),
    queuedAt: now(),
  });
  scheduleManualUploadPostProcessDrain();

  return true;
}

export async function createManualUpload({
  type = 'movie',
  title = '',
  year = '',
  tmdbId = null,
  tmdbMediaType = null,
  files = [],
  filePaths = [],
  releaseDate = '',
  processNow = true,
  releaseNow = false,
  actor = '',
} = {}) {
  const t = sanitizeType(type);
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('Title is required.');
  const cleanYear = normalizeYear(year);
  if (releaseNow && !processNow) {
    throw new Error('Release now requires cleaning first.');
  }

  const settings = await getAutodownloadSettings();
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const mount = await getMountSettings();
  if (!mount?.mountDir) throw new Error('Configure Storage & Mount first.');

  const fileList = Array.isArray(files) ? files : [];
  if (!fileList.length) throw new Error('At least one file is required.');
  const videoExts = getVideoExtensions(settings);
  if (!hasAnyVideoFile(fileList, videoExts)) {
    throw new Error(`No recognized video file found. Allowed extensions: ${videoExts.join(', ')}.`);
  }

  const tmdbPickedId = tmdbId === null || tmdbId === undefined || String(tmdbId).trim() === '' ? 0 : Number(tmdbId || 0);
  const tmdbPickedType = String(tmdbMediaType || (t === 'series' ? 'tv' : 'movie')).trim().toLowerCase();
  let tmdb = null;
  if (tmdbPickedId > 0) {
    try {
      tmdb = await getTmdbDetailsById({
        mediaType: tmdbPickedType === 'tv' || tmdbPickedType === 'series' ? 'tv' : 'movie',
        id: tmdbPickedId,
      });
    } catch {
      tmdb = buildManualUploadTmdbFallback({
        type: t,
        tmdbId: tmdbPickedId,
        tmdbMediaType: tmdbPickedType,
        title: cleanTitle,
        year: cleanYear,
      });
    }
  } else {
    tmdb = await resolveManualUploadTmdbTitle({ kind: t, title: cleanTitle, year: cleanYear });
  }
  if (!tmdb?.ok) throw new Error('TMDB match not found. Provide a better title/year.');

  const tz = normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const delayDays = normalizeReleaseDelayDays(settings?.release?.delayDays ?? 3);
  const defaultMeta = computeReleaseMeta({ startedAt: now(), delayDays, timeZone: tz });
  const desiredReleaseDate = normalizeReleaseDateKey(releaseDate) || defaultMeta.releaseDate;
  const releaseMeta = {
    ...defaultMeta,
    releaseDate: desiredReleaseDate,
    releaseTag: buildReleaseTagFromDateKey(desiredReleaseDate),
  };

  await assertManualUploadNotDuplicate({
    type: t,
    tmdb,
    title: cleanTitle,
    year: cleanYear,
    settings,
    mount,
    engineHost,
  });

  const selectionLog = buildSelectionLog({ selectionType: t, releaseMeta, tmdb, actor });
  const uploadId = crypto.randomUUID();
  const folderLabel = `${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}`;

  const ssh = sshFromEngineHost(engineHost);
  let uploaded = null;
  let record = null;
  let recordSaved = false;
  let retired = null;
  try {
    uploaded = await uploadFilesToEngine({
      ssh,
      type: t,
      mountDir: mount.mountDir,
      settings,
      uploadId,
      folderLabel,
      files: fileList,
      filePaths,
    });

    retired = await retirePreviousManualUploads({
      type: t,
      tmdb,
      title: cleanTitle,
      year: cleanYear,
      actor,
      ssh,
      mountDir: mount.mountDir,
      settings,
    });

    record = buildManualDownloadRecord({
      type: t,
      tmdb,
      selectionLogId: selectionLog.id,
      releaseMeta,
      uploadDir: uploaded.destDir,
      actor,
      uploadedFiles: uploaded.uploaded,
    });

    const db = await getAdminDb();
    db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
    const key = dbKeyForType(t);
    db[key] = Array.isArray(db[key]) ? db[key] : [];

    db.selectionLogs.unshift(selectionLog);
    db.selectionLogs = db.selectionLogs.slice(0, 2000);
    db[key].unshift(record);
    db[key] = db[key].slice(0, 5000);
    await saveAdminDb(db);
    recordSaved = true;

    const queuedProcessing = processNow ? startManualUploadPostProcess({ type: t, id: record.id, releaseNow, actor }) : false;

    return {
      ok: true,
      item: record,
      uploaded,
      retired,
      processed: queuedProcessing ? { ok: true, queued: true } : null,
      processingLog: null,
      released: releaseNow && queuedProcessing ? { ok: true, queued: true } : null,
      queuedProcessing,
      queuedReleaseNow: Boolean(releaseNow && queuedProcessing),
    };
  } catch (error) {
    const message = error?.message || 'Manual upload failed.';
    if (!recordSaved) {
      const manualPaths = buildManualUploadPaths({ mountDir: mount.mountDir, type: t, settings });
      const cleanup = await cleanupManualUploadResidue({
        ssh,
        targets: [uploaded?.destDir || ''],
        allowedRoots: [manualPaths?.incomingDir || '', manualPaths?.processingDir || ''],
      }).catch((cleanupError) => ({
        ok: false,
        attempted: 1,
        removed: 0,
        notFound: 0,
        unsafe: 0,
        failed: 1,
        items: [
          {
            ok: false,
            removed: false,
            skipped: false,
            reason: 'error',
            path: normalizeDirPath(uploaded?.destDir || ''),
            error: cleanupError?.message || 'Failed to clean manual upload residue.',
          },
        ],
      }));

      const failedRecord = buildManualDownloadRecord({
        type: t,
        tmdb: tmdb && typeof tmdb === 'object'
          ? tmdb
          : {
              id: 0,
              mediaType: t === 'series' ? 'tv' : 'movie',
              title: cleanTitle,
              year: cleanYear,
            },
        selectionLogId: null,
        releaseMeta,
        uploadDir: '',
        actor,
        status: 'Failed',
        error: message,
        progress: 0,
        releaseState: 'failed_upload',
        cleanup,
      });

      const db = await getAdminDb();
      const key = dbKeyForType(t);
      db[key] = Array.isArray(db[key]) ? db[key] : [];
      db[key].unshift(failedRecord);
      db[key] = db[key].slice(0, 5000);
      await saveAdminDb(db);
    }
    throw error;
  } finally {
    await ssh.close();
  }
}

export async function updateManualReleaseDate({ type = 'movie', id = '', releaseDate = '', actor = '' } = {}) {
  const t = sanitizeType(type);
  const releaseKey = normalizeReleaseDateKey(releaseDate);
  if (!releaseKey) throw new Error('releaseDate must be YYYY-MM-DD.');

  const settings = await getAutodownloadSettings();
  const tz = normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const delayDays = normalizeReleaseDelayDays(settings?.release?.delayDays ?? 3);
  const meta = {
    ...computeReleaseMeta({ startedAt: now(), delayDays, timeZone: tz }),
    releaseDate: releaseKey,
    releaseTag: buildReleaseTagFromDateKey(releaseKey),
  };

  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const list = Array.isArray(db[key]) ? db[key] : [];
  const idx = list.findIndex((row) => String(row?.id || '') === String(id || ''));
  if (idx < 0) throw new Error('Upload record not found.');
  const rec = list[idx];
  if (rec?.manualUpload !== true) throw new Error('This item is not a manual upload.');
  if (String(rec?.status || '').trim().toLowerCase() === 'failed') {
    throw new Error('Failed manual uploads cannot be scheduled for release.');
  }

  list[idx] = {
    ...rec,
    releaseDate: meta.releaseDate,
    releaseTag: meta.releaseTag,
    releaseTimezone: meta.releaseTimezone,
    releaseDelayDays: meta.releaseDelayDays,
    releaseState: String(rec?.releaseState || '').toLowerCase() === 'released' ? 'released' : 'waiting',
    updatedAt: now(),
    manualReleaseDateUpdatedAt: now(),
    manualReleaseDateUpdatedBy: String(actor || '').trim() || null,
  };
  db[key] = list;

  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  const logId = String(rec?.selectionLogId || '').trim();
  if (logId) {
    const logIdx = db.selectionLogs.findIndex((row) => String(row?.id || '').trim() === logId);
    if (logIdx >= 0) {
      const log = db.selectionLogs[logIdx] || {};
      db.selectionLogs[logIdx] = {
        ...log,
        updatedAt: now(),
        releaseDate: meta.releaseDate,
        releaseTag: meta.releaseTag,
        releaseTimezone: meta.releaseTimezone,
        releaseDelayDays: meta.releaseDelayDays,
        actor: String(actor || '').trim() || log?.actor || null,
      };
    }
  }

  await saveAdminDb(db);
  return { ok: true, item: db[key][idx], releaseMeta: meta };
}

export async function manualReleaseNow({ type = 'movie', id = '', actor = '' } = {}) {
  const t = sanitizeType(type);
  const settings = await getAutodownloadSettings();
  const tz = normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const today = dateKeyInTimezone(Date.now(), tz);

  let db = await getAdminDb();
  const key = dbKeyForType(t);
  db[key] = Array.isArray(db[key]) ? db[key] : [];
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  let idx = db[key].findIndex((row) => String(row?.id || '') === String(id || ''));
  if (idx < 0) throw new Error('Upload record not found.');
  let rec = db[key][idx];
  if (rec?.manualUpload !== true) throw new Error('This item is not a manual upload.');
  if (String(rec?.status || '').trim().toLowerCase() === 'failed') {
    throw new Error('Failed manual uploads cannot be released.');
  }

  const statusLower = String(rec?.status || '').toLowerCase();
  if (statusLower === 'completed') {
    await processOneCompleted({ type: t, id });
    db = await getAdminDb();
    db[key] = Array.isArray(db[key]) ? db[key] : [];
    db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
    idx = db[key].findIndex((row) => String(row?.id || '') === String(id || ''));
    if (idx < 0) throw new Error('Upload record not found after processing.');
    rec = db[key][idx];
  }

  const releaseTag = buildReleaseTagFromDateKey(today);
  db[key][idx] = {
    ...db[key][idx],
    releaseDate: today,
    releaseTag,
    releaseTimezone: tz,
    releaseState: 'waiting',
    manualReleaseNowAt: now(),
    manualReleaseNowBy: String(actor || '').trim() || null,
    updatedAt: now(),
  };

  const logId = String(db[key][idx]?.selectionLogId || '').trim();
  if (logId) {
    const logIdx = db.selectionLogs.findIndex((row) => String(row?.id || '').trim() === logId);
    if (logIdx >= 0) {
      db.selectionLogs[logIdx] = {
        ...(db.selectionLogs[logIdx] || {}),
        updatedAt: now(),
        releaseDate: today,
        releaseTag,
        releaseTimezone: tz,
        actor: String(actor || '').trim() || db.selectionLogs[logIdx]?.actor || null,
      };
    }
  }

  await saveAdminDb(db);
  const released = await releaseDueSelections({ type: t });
  return { ok: true, releaseDate: today, released };
}

export async function deleteManualUploads({ type = 'movie', ids = [], actor = '' } = {}) {
  const t = sanitizeType(type);
  const targetIds = uniqueStrings(ids);
  if (!targetIds.length) throw new Error('Choose at least one manual upload to delete.');

  const [settings, mount, engineHost, db] = await Promise.all([
    getAutodownloadSettings(),
    getMountSettings(),
    getEngineHost(),
    getAdminDb(),
  ]);
  const key = dbKeyForType(t);
  db[key] = Array.isArray(db[key]) ? db[key] : [];
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  db.upcomingReminders = Array.isArray(db.upcomingReminders) ? db.upcomingReminders : [];

  const manualPaths = buildManualUploadPaths({ mountDir: mount?.mountDir || '', type: t, settings });
  const libraryPaths = buildLibraryPaths({ mountDir: mount?.mountDir || '', type: t, settings });
  const allowedRoots = uniquePaths([manualPaths?.incomingDir, manualPaths?.processingDir, libraryPaths?.root]);

  const found = [];
  const results = [];
  for (const id of targetIds) {
    const idx = db[key].findIndex((row) => String(row?.id || '').trim() === id);
    if (idx < 0) {
      results.push({ id, status: 'not_found', title: 'Unavailable item', cleanup: null, releaseTagCleanup: null, error: 'Manual upload record not found.' });
      continue;
    }
    found.push({ id, idx, row: db[key][idx] });
  }

  const needsRemoteDelete = found.some(({ row }) => {
    const rec = row || {};
    return Boolean(
      normalizeDirPath(rec?.downloadPath || '') ||
        normalizeDirPath(rec?.holdDir || '') ||
        normalizeDirPath(resolveReleasedManualTargetDir({ rec, type: t }) || '')
    );
  });

  let ssh = null;
  let remoteUnavailable = '';
  if (needsRemoteDelete) {
    if (!mount?.mountDir) {
      remoteUnavailable = 'Configure Storage & Mount first.';
    } else if (!engineHost?.host) {
      remoteUnavailable = 'Engine Host is not configured.';
    } else {
      try {
        ssh = sshFromEngineHost(engineHost);
        await ssh.connect({ timeoutMs: 20000 });
      } catch (error) {
        remoteUnavailable = String(error?.message || 'Failed to connect to Engine Host.').trim() || 'Failed to connect to Engine Host.';
      }
    }
  }

  let shouldTriggerXuiScan = false;
  const deletedRecordsById = new Map();
  const removedSelectionLogIds = new Set();
  const removedReminderKeys = new Set();
  let dbToSave = db;
  const persistDeleteState = async () => {
    if (!deletedRecordsById.size && !removedSelectionLogIds.size && !removedReminderKeys.size) {
      dbToSave = db;
      await saveAdminDb(dbToSave);
      return dbToSave;
    }

    const latestDb = await getAdminDb();
    latestDb[key] = Array.isArray(latestDb[key]) ? latestDb[key] : [];
    latestDb.selectionLogs = Array.isArray(latestDb.selectionLogs) ? latestDb.selectionLogs : [];
    latestDb.upcomingReminders = Array.isArray(latestDb.upcomingReminders) ? latestDb.upcomingReminders : [];

    const appliedIds = new Set();
    latestDb[key] = latestDb[key].map((row) => {
      const rowId = String(row?.id || '').trim();
      if (!deletedRecordsById.has(rowId)) return row;
      appliedIds.add(rowId);
      return { ...row, ...deletedRecordsById.get(rowId) };
    });
    for (const [id, record] of deletedRecordsById.entries()) {
      if (!appliedIds.has(id)) latestDb[key].unshift(record);
    }

    if (removedSelectionLogIds.size) {
      latestDb.selectionLogs = latestDb.selectionLogs.filter((row) => {
        const logId = String(row?.id || '').trim();
        if (!removedSelectionLogIds.has(logId)) return true;
        return latestDb[key].some(
          (item) =>
            String(item?.selectionLogId || '').trim() === logId &&
            String(item?.status || '').trim().toLowerCase() !== 'deleted'
        );
      });
    }

    if (removedReminderKeys.size) {
      latestDb.upcomingReminders = latestDb.upcomingReminders.filter(
        (row) => !removedReminderKeys.has(reminderKey(row?.tmdbId || 0, row?.mediaType || ''))
      );
    }

    dbToSave = latestDb;
    await saveAdminDb(dbToSave);
    return dbToSave;
  };
  try {
    for (const entry of found) {
      const rec = entry.row || {};
      const statusLower = String(rec?.status || '').trim().toLowerCase();
      if (!canDeleteManualUploadRecord(rec)) {
        results.push({
          id: entry.id,
          title: String(rec?.tmdb?.title || rec?.title || '').trim() || 'Untitled',
          year: String(rec?.tmdb?.year || rec?.year || '').trim(),
          status: 'failed',
          cleanup: null,
          releaseTagCleanup: null,
          error: statusLower === 'processing' ? 'This manual upload is still cleaning. Delete it after processing finishes.' : 'This row is not a manual upload.',
        });
        continue;
      }

      const deleteTargets = uniquePaths([
        rec?.downloadPath || '',
        rec?.holdDir || '',
        String(rec?.releaseState || '').trim().toLowerCase() === 'released' ? resolveReleasedManualTargetDir({ rec, type: t }) : '',
      ]);
      const releaseTagDir = releaseTagDirFromHold({ holdDir: rec?.holdDir || '', releaseTag: rec?.releaseTag || '' });

      if (deleteTargets.length && !ssh) {
        results.push({
          id: entry.id,
          title: String(rec?.tmdb?.title || rec?.title || '').trim() || 'Untitled',
          year: String(rec?.tmdb?.year || rec?.year || '').trim(),
          status: 'failed',
          cleanup: null,
          releaseTagCleanup: null,
          error: remoteUnavailable || 'Remote delete is unavailable.',
        });
        continue;
      }

      const nowTs = now();
      const deletionNote = 'Deleted by admin from Manual Uploads.';
      const pendingCleanup = {
        ok: true,
        attempted: 0,
        removed: 0,
        notFound: 0,
        unsafe: 0,
        failed: 0,
        pending: Boolean(deleteTargets.length),
        items: [],
      };
      const pendingDeletedRecord = {
        ...rec,
        status: 'Deleted',
        releaseState: 'deleted',
        error: deletionNote,
        manualUploadCleanup: pendingCleanup,
        manualDeletedAt: nowTs,
        manualDeletedBy: String(actor || '').trim() || null,
        updatedAt: nowTs,
      };
      db[key][entry.idx] = pendingDeletedRecord;
      deletedRecordsById.set(entry.id, pendingDeletedRecord);

      const logId = String(rec?.selectionLogId || '').trim();
      if (logId) {
        const stillReferenced = db[key].some(
          (row, index) =>
            index !== entry.idx &&
            String(row?.selectionLogId || '').trim() === logId &&
            String(row?.status || '').trim().toLowerCase() !== 'deleted'
        );
        if (!stillReferenced) {
          removedSelectionLogIds.add(logId);
          db.selectionLogs = db.selectionLogs.filter((row) => String(row?.id || '').trim() !== logId);
        }
      }

      const tmdbId = Number(rec?.tmdb?.id || 0) || 0;
      const mediaType = reminderMediaType(t);
      if (tmdbId > 0 && !hasWaitingQueueForReminder(db, { tmdbId, mediaType, skipId: entry.id })) {
        const wantedReminderKey = reminderKey(tmdbId, mediaType);
        removedReminderKeys.add(wantedReminderKey);
        db.upcomingReminders = db.upcomingReminders.filter(
          (row) => reminderKey(row?.tmdbId || 0, row?.mediaType || '') !== wantedReminderKey
        );
      }

      if (String(rec?.releaseState || '').trim().toLowerCase() === 'released') {
        shouldTriggerXuiScan = true;
      }

      await persistDeleteState();

      let cleanup = {
        ok: true,
        attempted: 0,
        removed: 0,
        notFound: 0,
        unsafe: 0,
        failed: 0,
        items: [],
      };
      let releaseTagCleanup = null;
      try {
        if (ssh && deleteTargets.length) {
          cleanup = await cleanupManualUploadResidue({ ssh, targets: deleteTargets, allowedRoots });
        }
        if (ssh && releaseTagDir) {
          releaseTagCleanup = await removeRemoteDirIfEmptySafe({
            ssh,
            targetPath: releaseTagDir,
            allowedRoots: [manualPaths?.processingDir || ''],
          });
        }
      } catch (error) {
        const failedDeletedRecord = {
          ...pendingDeletedRecord,
          error: error?.message || 'Deleted from Manual Uploads, but failed to delete one or more NAS paths.',
          manualUploadCleanup: {
            ...cleanup,
            ok: false,
            failed: Number(cleanup?.failed || 0) || 1,
            pending: false,
          },
          updatedAt: now(),
        };
        db[key][entry.idx] = failedDeletedRecord;
        deletedRecordsById.set(entry.id, failedDeletedRecord);
        await persistDeleteState();
        results.push({
          id: entry.id,
          title: String(rec?.tmdb?.title || rec?.title || '').trim() || 'Untitled',
          year: String(rec?.tmdb?.year || rec?.year || '').trim(),
          status: 'failed',
          cleanup,
          releaseTagCleanup,
          error: error?.message || 'Failed to delete manual upload files.',
        });
        continue;
      }

      const cleanupFailed = Boolean(cleanup?.failed) || Boolean(cleanup?.unsafe);
      if (cleanupFailed) {
        const cleanupError =
          cleanup?.items?.find((item) => String(item?.error || '').trim())?.error ||
          'Failed to delete one or more NAS paths for this manual upload.';
        const failedDeletedRecord = {
          ...pendingDeletedRecord,
          error: cleanupError,
          manualUploadCleanup: {
            ...cleanup,
            pending: false,
          },
          updatedAt: now(),
        };
        db[key][entry.idx] = failedDeletedRecord;
        deletedRecordsById.set(entry.id, failedDeletedRecord);
        await persistDeleteState();
        results.push({
          id: entry.id,
          title: String(rec?.tmdb?.title || rec?.title || '').trim() || 'Untitled',
          year: String(rec?.tmdb?.year || rec?.year || '').trim(),
          status: 'failed',
          cleanup,
          releaseTagCleanup,
          error: cleanupError,
        });
        continue;
      }

      const deletedRecord = {
        ...pendingDeletedRecord,
        status: 'Deleted',
        releaseState: 'deleted',
        error: deletionNote,
        downloadPath: '',
        sourceCleanupPath: '',
        holdDir: null,
        finalDir: null,
        finalTargetDir: null,
        finalVideo: null,
        manualUploadCleanup: {
          ...cleanup,
          pending: false,
        },
        updatedAt: now(),
      };
      db[key][entry.idx] = deletedRecord;
      deletedRecordsById.set(entry.id, deletedRecord);

      results.push({
        id: entry.id,
        title: String(rec?.tmdb?.title || rec?.title || '').trim() || 'Untitled',
        year: String(rec?.tmdb?.year || rec?.year || '').trim(),
        status: 'deleted',
        cleanup,
        releaseTagCleanup,
        error: '',
      });
    }
  } finally {
    if (ssh) await ssh.close().catch(() => null);
  }

  await persistDeleteState();
  if (deletedRecordsById.size) {
    clearPublicCatalogDataCache('public-upcoming:');
  }

  if (shouldTriggerXuiScan) {
    await updateXuiScanState({ [t === 'series' ? 'seriesScanPending' : 'moviesScanPending']: true }).catch(() => null);
    clearXuiMediaIndexCache();
    clearXuiLibraryCatalogCache();
  }

  return {
    ok: true,
    type: t,
    results,
    summary: buildManualDeleteSummary(results),
  };
}
