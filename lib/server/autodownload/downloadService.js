import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { msUntilRelease } from '../../releaseTime';
import { getEngineHost, getMountSettings, getAutodownloadSettings, updateXuiScanState } from './autodownloadDb';
import { SSHService } from './sshService';
import { getTmdbDetailsById } from './tmdbService';
import { buildLibraryPaths } from './libraryFolders';
import { searchBestDownloadSource, sourceMatchesRequestedMedia } from './sourceProvidersService';
import { getOrRefreshLibraryInventory, hasInventoryMatch } from './libraryInventoryService';
import { ensureQbittorrentVpnReadyForDispatch } from './vpnService';
import { getXuiLibraryCatalog, hasXuiCatalogMatch } from './xuiLibraryCatalogService';
import { deriveStoragePolicy, storageLimitMessage, storageProjectionMessage } from './storagePolicy';
import { fetchMountStatus } from './mountService';

function now() {
  return Date.now();
}

const SOURCE_RETRY_MINUTES = 10;
const MOUNT_OFFLINE_PAUSE_REASON = 'Paused: NAS mount is not mounted/writable.';

function shQuote(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
}

function sanitizeType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'series') return 'series';
  return 'movie';
}

function dbKeyForType(type) {
  return sanitizeType(type) === 'series' ? 'downloadsSeries' : 'downloadsMovies';
}

function statusFromTorrent(t) {
  const state = String(t?.state || '').toLowerCase();
  if (!state) return 'Queued';
  if (state.includes('error')) return 'Failed';
  if (state.includes('paused') && (t?.progress ?? 0) < 1) return 'Queued';
  if (Number(t?.progress ?? 0) >= 1) return 'Completed';
  return 'Downloading';
}

function isAutoDeleteEligibleStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'completed' || s === 'processing' || s === 'cleaned' || s === 'released' || s === 'deleted';
}

function isTerminalDownloadStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return s === 'completed' || s === 'processing' || s === 'cleaned' || s === 'released' || s === 'deleted';
}

function resolveCompletedAtMs({ record = null, torrent = null, fallbackMs = null } = {}) {
  const fromRecord = [record?.completedAt, record?.downloadedAt, record?.cleanedAt, record?.releasedAt]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  if (fromRecord) return fromRecord;

  const completionOn = Number(torrent?.completion_on || 0);
  if (Number.isFinite(completionOn) && completionOn > 0) return completionOn * 1000;

  const addedOn = Number(torrent?.added_on || 0);
  if (Number.isFinite(addedOn) && addedOn > 0) return addedOn * 1000;

  const fallback = Number(fallbackMs || 0);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return now();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasStaleDeleteMarker(record = null) {
  const status = String(record?.qbDeleteStatus || '').trim().toLowerCase();
  if (!record?.qbDeletedAt) return false;
  return status === 'deleted' || status === 'deleted_after_download' || status === 'already_deleted' || status === 'missing_in_client';
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

async function qbCurl(ssh, { port, path, method = 'GET', form = null, multipart = false, cookieJar = '', cookieOut = '', timeoutMs = 30000 }) {
  const url = `http://127.0.0.1:${Number(port || 8080) || 8080}${path}`;
  const referer = `http://127.0.0.1:${Number(port || 8080) || 8080}`;
  const parts = ['curl', '-sS', '-m', String(Math.ceil(timeoutMs / 1000)), '-H', `Referer: ${referer}`];
  if (method !== 'GET') parts.push('-X', method);
  if (cookieJar) parts.push('-b', String(cookieJar));
  if (cookieOut) parts.push('-c', String(cookieOut));

  if (form && typeof form === 'object') {
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined || v === null) continue;
      if (multipart) parts.push('-F', `${k}=${String(v)}`);
      else parts.push('--data-urlencode', `${k}=${String(v)}`);
    }
  }

  parts.push(url);

  // Build a shell-safe command. (No secrets should appear here because we use localhost whitelist provisioning.)
  const cmd = parts.map(shQuote).join(' ');
  const r = await ssh.exec(cmd, { sudo: false, timeoutMs });
  if (Number(r?.code) !== 0) {
    const msg = String(r?.stderr || r?.stdout || '').trim();
    throw new Error(`qBittorrent API ${method} ${path} failed${msg ? `: ${msg.slice(0, 220)}` : ''}`);
  }
  return r.stdout || '';
}

function ensureQbAddAccepted(responseText, action = 'add torrent') {
  const txt = String(responseText || '').trim();
  if (!txt) throw new Error(`qBittorrent ${action} returned an empty response.`);
  if (/^ok\.?$/i.test(txt)) return;
  throw new Error(`qBittorrent ${action} rejected: ${txt.slice(0, 180)}`);
}

function parseQbArray(text, action = 'qBittorrent response') {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    const firstBracket = raw.indexOf('[');
    const lastBracket = raw.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      try {
        const arr = JSON.parse(raw.slice(firstBracket, lastBracket + 1));
        return Array.isArray(arr) ? arr : [];
      } catch {}
    }
    throw new Error(`${action} returned non-JSON: ${raw.slice(0, 180).trim()}`);
  }
}

function normalizeDirPath(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function baseNamePath(pathValue) {
  const p = normalizeDirPath(pathValue);
  if (!p) return '';
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

function parentDirPath(pathValue) {
  const p = normalizeDirPath(pathValue);
  if (!p || !p.includes('/')) return '';
  return p.slice(0, p.lastIndexOf('/')) || '';
}

function pathJoin(base, name) {
  const b = normalizeDirPath(base);
  const n = String(name || '').trim().replace(/^\/+/, '');
  if (!b) return n;
  if (!n) return b;
  return `${b}/${n}`;
}

function buildManagedSourcePath(savePath, name) {
  const dir = normalizeDirPath(savePath);
  const leaf = String(name || '').trim();
  if (!dir || !leaf) return '';
  return pathJoin(dir, leaf);
}

function isStrictChildPath(pathValue, rootValue) {
  const p = normalizeDirPath(pathValue);
  const r = normalizeDirPath(rootValue);
  if (!p || !r) return false;
  if (p === r) return false;
  return p.startsWith(`${r}/`);
}

function canRemoveManagedPath(targetPath, allowedRoots = []) {
  const target = normalizeDirPath(targetPath);
  if (!target || target === '/' || target === '.' || target === '..') return false;
  const normalizedSegments = `/${target.replace(/^\/+/, '')}/`;
  if (normalizedSegments.includes('/../') || normalizedSegments.includes('/./')) return false;
  const leaf = baseNamePath(target).toLowerCase();
  if (!leaf || leaf === '.' || leaf === '..') return false;
  return (Array.isArray(allowedRoots) ? allowedRoots : []).some((root) => isStrictChildPath(target, root));
}

async function remotePathExists(ssh, targetPath) {
  const target = normalizeDirPath(targetPath);
  if (!target) return false;
  const cmd = `[ -e ${shQuote(target)} ] && echo 1 || echo 0`;
  const direct = await ssh.exec(cmd, { timeoutMs: 15000 }).catch(() => null);
  if (String(direct?.stdout || '').trim() === '1') return true;
  const elevated = await ssh.exec(cmd, { timeoutMs: 15000, sudo: true }).catch(() => null);
  return String(elevated?.stdout || '').trim() === '1';
}

async function removeManagedPath({ ssh, targetPath, allowedRoots = [] } = {}) {
  const target = normalizeDirPath(targetPath);
  if (!canRemoveManagedPath(target, allowedRoots)) {
    return { ok: false, removed: false, skipped: true, reason: 'unsafe_path', path: target };
  }
  if (!(await remotePathExists(ssh, target))) {
    return { ok: true, removed: false, skipped: true, reason: 'not_found', path: target };
  }
  await ssh.exec(`rm -rf -- ${shQuote(target)}`, { timeoutMs: 2 * 60 * 1000, sudo: true });
  return { ok: true, removed: true, skipped: false, reason: 'removed', path: target };
}

async function pruneEmptyManagedDir({ ssh, dirPath, allowedRoots = [] } = {}) {
  const dir = normalizeDirPath(dirPath);
  if (!canRemoveManagedPath(dir, allowedRoots)) return { ok: false, removed: false, skipped: true, reason: 'unsafe_path', path: dir };
  const script = [
    `d=${shQuote(dir)}`,
    '[ -d "$d" ] || exit 0',
    'find "$d" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q . && exit 0',
    'rmdir "$d" >/dev/null 2>&1 || true',
  ].join('\n');
  await ssh.exec(script, { timeoutMs: 20000, sudo: true }).catch(() => null);
  const stillExists = await remotePathExists(ssh, dir);
  return { ok: true, removed: !stillExists, skipped: false, reason: stillExists ? 'not_empty' : 'removed', path: dir };
}

function normalizeHash(value) {
  // qBittorrent's `hashes=` filters are case-sensitive and expose hashes in lowercase.
  // Keep a canonical lowercase form so lookups and delete confirmations hit the live torrent.
  return String(value || '').trim().toLowerCase();
}

function pickTorrentMatch({ torrents, selectedHash = '', preferredPath = '', title = '', strictHash = false } = {}) {
  const arr = Array.isArray(torrents) ? torrents : [];
  if (!arr.length) return null;

  const wantedHash = normalizeHash(selectedHash);
  if (wantedHash) {
    const byHash = arr.find((x) => normalizeHash(x?.hash) === wantedHash);
    if (byHash) return byHash;
    if (strictHash) return null;
  }

  const preferred = String(preferredPath || '').trim();
  const byPath = preferred
    ? arr
        .filter((x) => String(x?.save_path || '').startsWith(preferred))
        .sort((a, b) => Number(b?.added_on || 0) - Number(a?.added_on || 0))
    : [];

  const needle = String(title || '').trim().toLowerCase();
  if (needle) {
    const byTitleInPath = byPath.find((x) => String(x?.name || '').toLowerCase().includes(needle));
    if (byTitleInPath) return byTitleInPath;

    const byTitle = arr.find((x) => String(x?.name || '').toLowerCase().includes(needle));
    if (byTitle) return byTitle;
  }

  if (byPath.length === 1) return byPath[0];
  return byPath[0] || null;
}

async function fetchTorrentInfoByHash({ ssh, port, cookieJar, hash } = {}) {
  const wantedHash = normalizeHash(hash);
  if (!wantedHash) return null;
  try {
    const text = await qbCurl(ssh, {
      port,
      path: `/api/v2/torrents/info?hashes=${encodeURIComponent(wantedHash)}`,
      method: 'GET',
      cookieJar,
      timeoutMs: 30000,
    });
    const arr = parseQbArray(text, 'qBittorrent torrents/info');
    return arr.find((row) => normalizeHash(row?.hash) === wantedHash) || null;
  } catch {
    return null;
  }
}

async function qbDeleteAndConfirm({ ssh, port, cookieJar, hash, deleteFiles = false, confirmMs = 5000 } = {}) {
  const wantedHash = normalizeHash(hash);
  if (!wantedHash) throw new Error('Missing torrent hash.');
  await qbCurl(ssh, {
    port,
    path: '/api/v2/torrents/delete',
    method: 'POST',
    form: { hashes: wantedHash, deleteFiles: deleteFiles ? 'true' : 'false' },
    cookieJar,
    timeoutMs: 60000,
  });
  const deadline = Date.now() + Math.max(1000, Number(confirmMs) || 5000);
  while (Date.now() <= deadline) {
    const stillPresent = await fetchTorrentInfoByHash({ ssh, port, cookieJar, hash: wantedHash });
    if (!stillPresent) return true;
    await delay(750);
  }
  throw new Error('qBittorrent delete returned success but torrent is still present.');
}

async function cleanupManagedDownloadArtifacts({
  ssh,
  rec,
  torrentInfo = null,
  pathsForType = null,
} = {}) {
  const paths = pathsForType && typeof pathsForType === 'object' ? pathsForType : null;
  const finalRoot = normalizeDirPath(paths?.root || '');
  const allowedRoots = [
    paths?.downloadingDir,
    paths?.downloadedDir,
    paths?.processingDir,
    finalRoot,
  ]
    .map((value) => normalizeDirPath(value))
    .filter(Boolean);

  const candidatePaths = [];
  const addCandidate = (value) => {
    const target = normalizeDirPath(value);
    if (!target || candidatePaths.includes(target)) return;
    candidatePaths.push(target);
  };

  addCandidate(rec?.sourceCleanupPath);
  addCandidate(rec?.holdDir);
  addCandidate(rec?.finalDir);
  addCandidate(rec?.finalTargetDir);
  if (rec?.qbName && rec?.savePath) addCandidate(pathJoin(rec.savePath, rec.qbName));
  if (torrentInfo?.name && torrentInfo?.save_path) addCandidate(pathJoin(torrentInfo.save_path, torrentInfo.name));

  const removedPaths = [];
  const skippedPaths = [];
  let removedFromFinalLibrary = false;

  for (const targetPath of candidatePaths) {
    const result = await removeManagedPath({ ssh, targetPath, allowedRoots }).catch((e) => ({
      ok: false,
      removed: false,
      skipped: false,
      reason: 'error',
      path: targetPath,
      error: e?.message || 'remove failed',
    }));
    if (result?.removed) {
      removedPaths.push(result.path);
      if (finalRoot && isStrictChildPath(result.path, finalRoot)) removedFromFinalLibrary = true;
      continue;
    }
    skippedPaths.push({
      path: result?.path || targetPath,
      reason: result?.reason || 'skipped',
      error: result?.error || '',
    });
  }

  const processingDir = normalizeDirPath(paths?.processingDir || '');
  const holdParent = parentDirPath(rec?.holdDir || rec?.finalDir || '');
  if (processingDir && holdParent && isStrictChildPath(holdParent, processingDir)) {
    await pruneEmptyManagedDir({ ssh, dirPath: holdParent, allowedRoots: [processingDir] }).catch(() => null);
  }

  return {
    ok: true,
    removedPaths,
    skippedPaths,
    removedFromFinalLibrary,
  };
}

function isMagnetLink(value = '') {
  return /^magnet:\?/i.test(String(value || '').trim());
}

function isTrackerRichMagnet(value = '') {
  const link = String(value || '').trim();
  return isMagnetLink(link) && /[?&]tr=/i.test(link);
}

function buildSourceLinkCandidates(source = null, queuedUrl = '') {
  const sourceUrl = String(source?.sourceUrl || '').trim();
  const magnet = String(source?.magnet || '').trim();
  const out = [];
  const push = (value) => {
    const next = String(value || '').trim();
    if (!next || out.includes(next)) return;
    out.push(next);
  };

  if (isTrackerRichMagnet(magnet)) {
    push(magnet);
    push(sourceUrl);
  } else {
    push(sourceUrl);
    push(magnet);
  }

  push(queuedUrl);
  return out;
}

async function addTorrentAndFindMatch({
  ssh,
  port,
  qbSession,
  candidateLinks = [],
  savepath,
  category,
  selectedHash = '',
  title = '',
  strictHash = false,
  paused = false,
  probeCount = 15,
  probeDelayMs = 1000,
} = {}) {
  const links = Array.from(
    new Set((Array.isArray(candidateLinks) ? candidateLinks : []).map((value) => String(value || '').trim()).filter(Boolean))
  );
  if (!links.length) throw new Error('Torrent/magnet URL is required.');

  const triedKinds = [];
  for (const link of links) {
    triedKinds.push(isMagnetLink(link) ? 'magnet' : 'url');
    const addResp = await qbCurl(ssh, {
      port,
      path: '/api/v2/torrents/add',
      method: 'POST',
      form: {
        urls: link,
        savepath,
        category,
        paused: paused ? 'true' : 'false',
      },
      multipart: true,
      cookieJar: qbSession.cookieJar,
      timeoutMs: 45000,
    });
    ensureQbAddAccepted(addResp, 'add torrent');

    let top = null;
    for (let probe = 0; probe < probeCount && !top; probe += 1) {
      if (probe > 0) await new Promise((resolve) => setTimeout(resolve, probeDelayMs));
      const infoText = await qbCurl(ssh, {
        port,
        path: '/api/v2/torrents/info',
        method: 'GET',
        cookieJar: qbSession.cookieJar,
        timeoutMs: 45000,
      });
      const arr = parseQbArray(infoText, 'qBittorrent torrents/info');
      top = pickTorrentMatch({
        torrents: arr,
        selectedHash,
        preferredPath: savepath,
        title,
        strictHash,
      });
    }

    if (top?.hash) return { top, usedLink: link };
  }

  const triedText = Array.from(new Set(triedKinds)).join(', ') || 'unknown';
  throw new Error(`qBittorrent accepted add but torrent did not appear in torrents/info. Links tried: ${triedText}.`);
}

function qbCredentialsFromSettings(settings) {
  const dc = settings?.downloadClient || {};
  const username = dc?.usernameEnc ? decryptString(dc.usernameEnc) : String(dc?.username || '').trim();
  const password = dc?.passwordEnc ? decryptString(dc.passwordEnc) : String(dc?.password || '');
  return { username: String(username || '').trim(), password: String(password || '') };
}

async function createQbSession({ ssh, port, settings }) {
  const { username, password } = qbCredentialsFromSettings(settings);
  if (!username || !password) {
    throw new Error('qBittorrent WebUI credentials are missing. Save credentials in qBittorrent settings first.');
  }

  const cookieJar = `/tmp/3jtv_qb_cookie_${crypto.randomUUID().replace(/-/g, '')}.txt`;
  const loginResp = await qbCurl(ssh, {
    port,
    path: '/api/v2/auth/login',
    method: 'POST',
    form: { username, password },
    cookieOut: cookieJar,
    timeoutMs: 30000,
  });
  if (!/^ok\.?$/i.test(String(loginResp || '').trim())) {
    throw new Error('qBittorrent login failed. Check WebUI username/password in qBittorrent settings.');
  }
  return { cookieJar };
}

async function destroyQbSession(ssh, session) {
  const cookieJar = String(session?.cookieJar || '').trim();
  if (!cookieJar) return;
  await ssh
    .exec(`rm -f ${shQuote(cookieJar)} >/dev/null 2>&1 || true`, {
      sudo: false,
      timeoutMs: 10000,
    })
    .catch(() => null);
}

async function ensurePrereqs() {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const mount = await getMountSettings();
  if (!mount?.mountDir) throw new Error('Configure Storage & Mount first.');
  const settings = await getAutodownloadSettings();
  const dc = settings?.downloadClient || {};
  if ((dc.type || 'qbittorrent') !== 'qbittorrent') throw new Error('Only qBittorrent is supported right now.');
  const port = Number(dc.port || 8080) || 8080;
  const mountDir = String(mount.mountDir);
  const moviesPaths = buildLibraryPaths({ mountDir, type: 'movie', settings });
  const seriesPaths = buildLibraryPaths({ mountDir, type: 'series', settings });
  return { engineHost, mountDir, port, settings, moviesPaths, seriesPaths };
}

const DOWNLOAD_CONTROL_JOB_TTL_MS = 30 * 60 * 1000;
const DOWNLOAD_CONTROL_JOB_LIMIT = 40;

function getDownloadControlJobRegistry() {
  if (!globalThis.__threejTvDownloadControlJobs) {
    globalThis.__threejTvDownloadControlJobs = {
      activeByKey: new Map(),
      jobs: new Map(),
    };
  }
  return globalThis.__threejTvDownloadControlJobs;
}

function controlJobKey({ type = 'movie', id = '', action = '' } = {}) {
  return `${sanitizeType(type)}:${String(action || '').trim().toLowerCase()}:${String(id || '').trim()}`;
}

function serializeDownloadControlJob(job = null) {
  if (!job || typeof job !== 'object') return null;
  return {
    id: String(job.id || ''),
    type: sanitizeType(job.type),
    itemId: String(job.itemId || ''),
    action: String(job.action || '').trim().toLowerCase(),
    title: String(job.title || '').trim(),
    status: String(job.status || 'idle'),
    progress: Math.max(0, Math.min(100, Number(job.progress || 0) || 0)),
    phaseKey: String(job.phaseKey || '').trim(),
    phaseLabel: String(job.phaseLabel || '').trim(),
    summary: String(job.summary || '').trim(),
    error: String(job.error || '').trim(),
    startedAt: Number(job.startedAt || 0) || 0,
    updatedAt: Number(job.updatedAt || 0) || 0,
    finishedAt: Number(job.finishedAt || 0) || 0,
    result: job.result && typeof job.result === 'object' ? { ...job.result } : null,
  };
}

function pruneDownloadControlJobs(registry) {
  const entries = [...registry.jobs.values()].sort((a, b) => Number(b?.startedAt || 0) - Number(a?.startedAt || 0));
  const cutoff = now() - DOWNLOAD_CONTROL_JOB_TTL_MS;
  let kept = 0;
  for (const job of entries) {
    const isActive = registry.activeByKey.get(job.key) === job.id && job.status === 'running';
    const finishedAt = Number(job?.finishedAt || 0) || 0;
    if (isActive) {
      kept += 1;
      continue;
    }
    if (finishedAt && finishedAt < cutoff) {
      registry.jobs.delete(job.id);
      continue;
    }
    kept += 1;
    if (kept > DOWNLOAD_CONTROL_JOB_LIMIT) registry.jobs.delete(job.id);
  }
}

function updateDownloadControlJob(jobId = '', patch = {}) {
  const registry = getDownloadControlJobRegistry();
  const current = registry.jobs.get(String(jobId || '').trim()) || null;
  if (!current) return null;
  const sanitizedPatch = Object.fromEntries(
    Object.entries(patch && typeof patch === 'object' ? patch : {}).filter(([, value]) => value !== undefined)
  );
  const next = {
    ...current,
    ...sanitizedPatch,
    updatedAt: now(),
  };
  registry.jobs.set(current.id, next);
  return serializeDownloadControlJob(next);
}

export function getDownloadControlBackgroundStatus({ runId = '' } = {}) {
  const registry = getDownloadControlJobRegistry();
  const wantedId = String(runId || '').trim();
  if (wantedId) {
    const wanted = registry.jobs.get(wantedId) || null;
    return {
      active: Boolean(wanted && wanted.status === 'running'),
      run: serializeDownloadControlJob(wanted),
    };
  }

  const latest = [...registry.jobs.values()].sort((a, b) => Number(b?.startedAt || 0) - Number(a?.startedAt || 0))[0] || null;
  return {
    active: Boolean(latest && latest.status === 'running'),
    run: serializeDownloadControlJob(latest),
  };
}

function toYearOrNull(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  if (!Number.isFinite(y) || y < 1900 || y > 2100) return null;
  return y;
}

function sourceQueryFromRecord(rec) {
  const tmdb = rec?.tmdb && typeof rec.tmdb === 'object' ? rec.tmdb : {};
  const t = sanitizeType(rec?.type);
  const query =
    t === 'series' && tmdb?.imdbId
      ? String(tmdb.imdbId).trim()
      : String(tmdb?.title || rec?.title || '').trim();
  const year = toYearOrNull(tmdb?.year || rec?.year || '');
  return { query, year };
}

function toFiniteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bytesFromGb(gb) {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n * 1024 * 1024 * 1024);
}

function formatGbFromBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0.00';
  return (n / (1024 * 1024 * 1024)).toFixed(2);
}

function sourcePolicyForType(settings, type) {
  const t = sanitizeType(type);
  const sizeLimits = settings?.sizeLimits || {};
  const sourceFilters = settings?.sourceFilters || {};
  const minSeedersRaw = t === 'series' ? sourceFilters?.minSeriesSeeders : sourceFilters?.minMovieSeeders;
  const maxMovieRaw = sizeLimits?.maxMovieGb;
  const maxEpisodeRaw = sizeLimits?.maxEpisodeGb;
  const maxSeasonTotalRaw = sizeLimits?.maxSeasonTotalGb;

  const minSeeders = Math.max(0, Math.floor(toFiniteNumber(minSeedersRaw, 1) ?? 1));
  const maxMovieGb = toFiniteNumber(maxMovieRaw, null);
  const maxEpisodeGb = toFiniteNumber(maxEpisodeRaw, null);
  const maxSeasonTotalGb = toFiniteNumber(maxSeasonTotalRaw, null);
  const maxSizeGb = t === 'series' ? maxEpisodeGb : maxMovieGb;
  return {
    minSeeders,
    maxSizeGb: maxSizeGb !== null && maxSizeGb > 0 ? maxSizeGb : null,
    maxEpisodeGb: maxEpisodeGb !== null && maxEpisodeGb > 0 ? maxEpisodeGb : null,
    maxSeasonTotalGb: maxSeasonTotalGb !== null && maxSeasonTotalGb > 0 ? maxSeasonTotalGb : null,
  };
}

function sourceCandidateMatchesPolicy(source, policy) {
  const p = policy && typeof policy === 'object' ? policy : {};
  const minSeeders = Math.max(0, Math.floor(toFiniteNumber(p.minSeeders, 0) ?? 0));
  const maxSizeGb = toFiniteNumber(p.maxSizeGb, null);
  const src = source && typeof source === 'object' ? source : null;
  if (!src) return false;

  const seeders = Math.max(0, Math.floor(toFiniteNumber(src?.seeders, 0) ?? 0));
  if (seeders < minSeeders) return false;

  if (maxSizeGb !== null) {
    const rawSizeGb = src?.sizeGb;
    const sizeGb = rawSizeGb === null || rawSizeGb === undefined || String(rawSizeGb).trim() === '' ? NaN : Number(rawSizeGb);
    if (!Number.isFinite(sizeGb)) return false;
    if (sizeGb > maxSizeGb) return false;
  }

  return true;
}

function sourceRecordMatchesPolicy(rec, policy) {
  return sourceCandidateMatchesPolicy(rec?.source, policy);
}

function replaceBlockedReason(rec = {}, type = 'movie') {
  const mediaLabel = type === 'series' ? 'series title' : 'movie';
  if (String(rec?.releaseState || '').trim().toLowerCase() === 'released') {
    return `Replace is locked because this ${mediaLabel} is already deployed in XUI.`;
  }
  const remainingMs = msUntilRelease({
    releaseDate: rec?.releaseDate,
    timeZone: rec?.releaseTimezone || 'Asia/Manila',
  });
  if (remainingMs !== null && remainingMs <= 5 * 60 * 60 * 1000) {
    return 'Replace is locked because the scheduled release is already within 5 hours.';
  }
  return '';
}

function deleteBlockedReason(rec = {}, type = 'movie') {
  const mediaLabel = type === 'series' ? 'series title' : 'movie';
  if (String(rec?.releaseState || '').trim().toLowerCase() === 'released') {
    return `Delete is locked because this ${mediaLabel} is already deployed in XUI.`;
  }
  return '';
}

function tmdbIdFromSelectionLike(row) {
  const n = Number(row?.tmdbId || row?.tmdb?.id || row?.id || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function selectedBucketCounterKey(bucket = '') {
  const value = String(bucket || '').trim();
  if (value === 'recentAnimation') return 'recentAnimationSelected';
  if (value === 'recentLive') return 'recentLiveActionSelected';
  if (value === 'classicAnimation') return 'classicAnimationSelected';
  if (value === 'classicLive') return 'classicLiveActionSelected';
  return '';
}

async function reconcileSelectionLogReplacement({ logId, removedTmdbId, replacementItem = null } = {}) {
  const targetLogId = String(logId || '').trim();
  if (!targetLogId) return null;

  const db = await getAdminDb();
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  const idx = db.selectionLogs.findIndex((row) => String(row?.id || '').trim() === targetLogId);
  if (idx < 0) return null;

  const log = db.selectionLogs[idx] || {};
  const selectedItems = Array.isArray(log?.selectedItems) ? [...log.selectedItems] : [];
  const removeIdx = selectedItems.findIndex((row) => tmdbIdFromSelectionLike(row) === Number(removedTmdbId || 0));
  const removedRow = removeIdx >= 0 ? selectedItems.splice(removeIdx, 1)[0] : null;
  const replacementTmdbId = tmdbIdFromSelectionLike(replacementItem);
  const replacementExists =
    replacementItem && replacementTmdbId > 0 && selectedItems.some((row) => tmdbIdFromSelectionLike(row) === replacementTmdbId);
  const insertedReplacement = Boolean(replacementItem && replacementTmdbId > 0 && !replacementExists);
  if (insertedReplacement) {
    if (removeIdx >= 0) selectedItems.splice(removeIdx, 0, replacementItem);
    else selectedItems.push(replacementItem);
  }

  const nextLog = {
    ...log,
    selectedItems,
    updatedAt: now(),
  };
  if (removedRow) {
    nextLog.totalSelected = Math.max(0, Number(nextLog?.totalSelected || 0) - 1);
    const counterKey = selectedBucketCounterKey(removedRow?.bucket || '');
    if (counterKey) {
      nextLog[counterKey] = Math.max(0, Number(nextLog?.[counterKey] || 0) - 1);
    }
  }
  if (insertedReplacement) {
    nextLog.totalSelected = Math.max(0, Number(nextLog?.totalSelected || 0) + 1);
    const counterKey = selectedBucketCounterKey(replacementItem?.bucket || '');
    if (counterKey) {
      nextLog[counterKey] = Math.max(0, Number(nextLog?.[counterKey] || 0) + 1);
    }
  }

  db.selectionLogs[idx] = nextLog;
  await saveAdminDb(db);
  return nextLog;
}

async function enforceTorrentPlacement({
  ssh,
  port,
  cookieJar,
  qbHash,
  desiredLocation = '',
  currentLocation = '',
  desiredCategory = '',
  currentCategory = '',
}) {
  const hash = String(qbHash || '').trim();
  if (!hash) return { moved: false, categorized: false, error: '' };

  let moved = false;
  let categorized = false;
  let error = '';

  const desiredLoc = normalizeDirPath(desiredLocation);
  const currentLoc = normalizeDirPath(currentLocation);
  if (desiredLoc && currentLoc && desiredLoc !== currentLoc) {
    try {
      await qbCurl(ssh, {
        port,
        path: '/api/v2/torrents/setLocation',
        method: 'POST',
        form: { hashes: hash, location: desiredLoc },
        cookieJar,
        timeoutMs: 60000,
      });
      moved = true;
    } catch (e) {
      error = `Move to configured download path failed: ${e?.message || 'setLocation failed'}`;
    }
  }

  const desiredCat = String(desiredCategory || '').trim().toUpperCase();
  const currentCat = String(currentCategory || '').trim().toUpperCase();
  if (desiredCat && desiredCat !== currentCat) {
    try {
      await qbCurl(ssh, {
        port,
        path: '/api/v2/torrents/setCategory',
        method: 'POST',
        form: { hashes: hash, category: desiredCat },
        cookieJar,
        timeoutMs: 30000,
      });
      categorized = true;
    } catch (e) {
      error = error || `Set category failed: ${e?.message || 'setCategory failed'}`;
    }
  }

  return { moved, categorized, error };
}

function shouldAutoStartQueuedRecord(rec, at = now()) {
  const st = String(rec?.status || '').toLowerCase();
  if (['deleted', 'downloading', 'completed', 'processing', 'cleaned'].includes(st)) return false;
  if (String(rec?.qbHash || '').trim()) return false;
  if (!Number(rec?.tmdb?.id || 0)) return false;
  if (!String(rec?.selectionLogId || '').trim()) return false;
  const nextRetryAt = Number(rec?.nextSourceRetryAt || 0) || 0;
  if (nextRetryAt && nextRetryAt > at) return false;
  return st === 'queued' || st === 'failed' || st === '';
}

async function updateRecordById({ type, id, mutate }) {
  if (!id || typeof mutate !== 'function') return null;
  const t = sanitizeType(type);
  const key = dbKeyForType(t);
  const db = await getAdminDb();
  const list = Array.isArray(db[key]) ? db[key] : [];
  const idx = list.findIndex((x) => String(x?.id) === String(id));
  if (idx < 0) return null;
  const prev = list[idx];
  const next = mutate(prev);
  if (!next || typeof next !== 'object') return null;
  list[idx] = next;
  db[key] = list;
  await saveAdminDb(db);
  return next;
}

export async function listDownloads(type) {
  const t = sanitizeType(type);
  const db = await getAdminDb();
  const list = Array.isArray(db[dbKeyForType(t)]) ? db[dbKeyForType(t)] : [];
  return list;
}

export async function countDispatchableDownloads(type = 'all', at = now()) {
  const types = type === 'all' ? ['movie', 'series'] : [sanitizeType(type)];
  const db = await getAdminDb();
  const out = { movie: 0, series: 0 };
  for (const currentType of types) {
    const key = dbKeyForType(currentType);
    const list = Array.isArray(db[key]) ? db[key] : [];
    out[currentType] = list.filter((row) => shouldAutoStartQueuedRecord(row, at)).length;
  }
  return out;
}

async function mutateManagedTorrentPauseState({ action = 'pause', reason = MOUNT_OFFLINE_PAUSE_REASON } = {}) {
  const normalizedAction = String(action || '').trim().toLowerCase() === 'resume' ? 'resume' : 'pause';
  const { engineHost, port, settings } = await ensurePrereqs();
  const db = await getAdminDb();
  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  const out = { ok: true, action: normalizedAction, targeted: 0, changed: 0, failed: 0 };
  try {
    await ssh.connect({ timeoutMs: 15000 });
    qbSession = await createQbSession({ ssh, port, settings });
    for (const key of ['downloadsMovies', 'downloadsSeries']) {
      const list = Array.isArray(db[key]) ? db[key] : [];
      const nextList = [...list];
      const hashes = [];
      const indexes = [];
      for (let i = 0; i < list.length; i += 1) {
        const row = list[i];
        const qbHash = String(row?.qbHash || '').trim();
        if (!qbHash || isTerminalDownloadStatus(row?.status)) continue;
        const pauseReason = String(row?.systemPauseReason || '').trim().toLowerCase();
        if (normalizedAction === 'pause') {
          if (pauseReason === 'mount_offline') continue;
        } else if (pauseReason !== 'mount_offline') {
          continue;
        }
        hashes.push(qbHash);
        indexes.push(i);
      }
      out.targeted += indexes.length;
      if (!hashes.length) continue;

      try {
        await qbCurl(ssh, {
          port,
          path: normalizedAction === 'pause' ? '/api/v2/torrents/pause' : '/api/v2/torrents/resume',
          method: 'POST',
          form: { hashes: hashes.join('|') },
          cookieJar: qbSession.cookieJar,
          timeoutMs: 60000,
        });
      } catch {
        out.failed += indexes.length;
        continue;
      }

      const at = now();
      for (const index of indexes) {
        const row = list[index];
        const currentError = String(row?.error || '').trim();
        nextList[index] =
          normalizedAction === 'pause'
            ? {
                ...row,
                status: isTerminalDownloadStatus(row?.status) ? row.status : 'Queued',
                error: MOUNT_OFFLINE_PAUSE_REASON,
                systemPauseReason: 'mount_offline',
                systemPausedAt: at,
              }
            : {
                ...row,
                status: 'Downloading',
                error: currentError === MOUNT_OFFLINE_PAUSE_REASON ? '' : currentError,
                systemPauseReason: '',
                systemPausedAt: null,
                systemResumedAt: at,
              };
        out.changed += 1;
      }
      db[key] = nextList;
    }

    if (out.changed > 0) await saveAdminDb(db);
    return out;
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

export async function pauseManagedDownloadsForMountOffline() {
  return mutateManagedTorrentPauseState({ action: 'pause', reason: MOUNT_OFFLINE_PAUSE_REASON });
}

export async function resumeManagedDownloadsPausedForMount() {
  return mutateManagedTorrentPauseState({ action: 'resume' });
}

export async function addDownload({ type, url, title = '', plannedSizeBytes = null, paused = false } = {}) {
  const t = sanitizeType(type);
  const u = String(url || '').trim();
  if (!u) throw new Error('Torrent/magnet URL is required.');

  const { engineHost, port, mountDir, settings, moviesPaths, seriesPaths } = await ensurePrereqs();

  const savepath = t === 'series' ? seriesPaths.downloadingDir : moviesPaths.downloadingDir;
  const category = t === 'series' ? 'SERIES_AUTO' : 'MOVIE_AUTO';

  const record = {
    id: crypto.randomUUID(),
    type: t,
    title: String(title || '').trim() || '',
    url: u,
    qbHash: null,
    qbName: null,
    status: 'Queued',
    progress: 0,
    sizeBytes: plannedSizeBytes ? Number(plannedSizeBytes) : null,
    addedAt: now(),
    completedAt: null,
    cleanedAt: null,
    error: '',
    savePath: savepath,
    sourceCleanupPath: '',
    category,
  };

  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  try {
    // Storage guardrail (best-effort): require planned size for accurate check.
    const dfText = await ssh.exec(`df -B1 ${shQuote(mountDir)} 2>/dev/null | tail -n 1 || true`, {
      sudo: false,
      timeoutMs: 15000,
    });
    const dfLine = String(dfText.stdout || '').trim();
    if (dfLine) {
      const parts = dfLine.split(/\s+/);
      const total = Number(parts[1] || 0);
      const used = Number(parts[2] || 0);
      if (total > 0) {
        const policy = deriveStoragePolicy({ settings, totalBytes: total });
        const currentUsedGb = used / (1024 * 1024 * 1024);
        if (policy.limitUsedGb !== null && currentUsedGb >= policy.limitUsedGb) {
          throw new Error(storageLimitMessage({ usedGb: currentUsedGb, limitUsedGb: policy.limitUsedGb }));
        }
        if (record.sizeBytes && record.sizeBytes > 0 && policy.limitUsedGb !== null) {
          const projectedUsedGb = (used + record.sizeBytes) / (1024 * 1024 * 1024);
          if (projectedUsedGb > policy.limitUsedGb) {
            throw new Error(storageProjectionMessage({ projectedUsedGb, limitUsedGb: policy.limitUsedGb }));
          }
        }
      }
    }

    qbSession = await createQbSession({ ssh, port, settings });

    const { top, usedLink } = await addTorrentAndFindMatch({
      ssh,
      port,
      qbSession,
      candidateLinks: [u],
      savepath,
      category,
      title: record.title,
      paused,
    });
    record.url = usedLink;
    if (top?.hash) {
      record.qbHash = top.hash;
      record.qbName = top.name || null;
      record.progress = Number(top.progress || 0);
      record.sizeBytes = Number(top.size || record.sizeBytes || 0) || record.sizeBytes;
      record.status = statusFromTorrent(top);
      if (record.status === 'Completed') record.completedAt = now();
    }

    const db = await getAdminDb();
    const key = dbKeyForType(t);
    db[key] = Array.isArray(db[key]) ? db[key] : [];
    db[key].unshift(record);
    db[key] = db[key].slice(0, 5000);
    await saveAdminDb(db);

    return record;
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

export async function addQueueItemFromTmdb({
  type,
  tmdbId,
  mediaType = null,
  categoryOrGenre = '',
  preselectedSource = null,
  sourceAttemptsLog = [],
  sourceLastAttemptAt = null,
  selectionLogId = null,
  releaseDate = '',
  releaseTag = '',
  releaseTimezone = 'Asia/Manila',
  releaseDelayDays = 3,
  seriesMeta = null,
} = {}) {
  const t = sanitizeType(type);
  const id = Number(tmdbId || 0);
  if (!Number.isFinite(id) || id <= 0) throw new Error('TMDB id is required.');

  const imdbDigits = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = s.match(/\btt(\d{7,8})\b/i);
    if (m?.[1]) return m[1];
    const d = s.match(/\b(\d{7,8})\b/);
    return d?.[1] ? d[1] : '';
  };

  const mt = mediaType || (t === 'series' ? 'tv' : 'movie');
  const details = await getTmdbDetailsById({ mediaType: mt, id });
  if (!details?.ok) throw new Error('TMDB lookup failed.');

  const lang = String(details?.originalLanguage || '').trim().toLowerCase();
  const movieCategory = lang === 'en' ? 'English' : 'Asian';
  const firstGenre = Array.isArray(details?.genres) && details.genres.length ? String(details.genres[0] || '').trim() : '';

  const pickedSource =
    preselectedSource && typeof preselectedSource === 'object'
      ? {
          provider: String(preselectedSource?.provider || '').trim(),
          title: String(preselectedSource?.title || '').trim(),
          year: Number(preselectedSource?.year || 0) || null,
          name: String(preselectedSource?.name || '').trim(),
          seeders: Number(preselectedSource?.seeders || 0) || 0,
          quality: String(preselectedSource?.quality || '').trim(),
          sizeGb: preselectedSource?.sizeGb ?? null,
          hash: String(preselectedSource?.hash || '').trim(),
          sourceUrl: String(preselectedSource?.sourceUrl || '').trim(),
          magnet: String(preselectedSource?.magnet || '').trim(),
          domainUsed: String(preselectedSource?.domainUsed || '').trim(),
          imdbIdDigits: String(preselectedSource?.imdbIdDigits || '').trim(),
          fetchedAt: Number(preselectedSource?.fetchedAt || now()),
          attempts: Array.isArray(sourceAttemptsLog) ? sourceAttemptsLog : [],
        }
      : null;

  if (
    pickedSource &&
    // For series, EZTV results are scoped by IMDb id and filenames often don't contain the canonical TMDB title/year.
    // Validate via IMDb id if available; otherwise fall back to title/year matching.
    (t === 'series' && String(pickedSource?.provider || '').toLowerCase() === 'eztv'
      ? (() => {
          const wanted = imdbDigits(details?.imdbId);
          const got = imdbDigits(pickedSource?.imdbIdDigits);
          return Boolean(wanted && got && wanted === got);
        })()
      : sourceMatchesRequestedMedia(pickedSource, {
          title: details.title,
          year: details.year,
          type: t,
        })) === false
  ) {
    throw new Error('Selected source does not match the TMDB title/year.');
  }

  const initialUrl = buildSourceLinkCandidates(pickedSource)[0] || '';

  const record = {
    id: crypto.randomUUID(),
    type: t,
    title: details.title || '',
    year: details.year || '',
    tmdb: {
      id: details.id,
      mediaType: details.mediaType,
      title: details.title,
      year: details.year,
      imdbId: details.imdbId || '',
      originalLanguage: details.originalLanguage || '',
      genres: details.genres,
      rating: details.rating,
      runtime: details.runtime,
      overview: details.overview,
      numberOfSeasons: details?.numberOfSeasons ?? null,
      numberOfEpisodes: details?.numberOfEpisodes ?? null,
    },
    targetCategory: t === 'series' ? null : movieCategory,
    targetGenre: t === 'series' ? firstGenre || null : firstGenre || null,
    url: initialUrl || null,
    qbHash: null,
    qbName: null,
    status: 'Queued',
    progress: 0,
    sizeBytes: null,
    addedAt: now(),
    completedAt: null,
    cleanedAt: null,
    error: '',
    savePath: null,
    sourceCleanupPath: '',
    category: null,
    source: pickedSource,
    sourceAttempts: pickedSource ? 1 : 0,
    sourceLastAttemptAt: pickedSource ? Number(sourceLastAttemptAt || now()) : null,
    nextSourceRetryAt: null,
    seriesMeta: seriesMeta && typeof seriesMeta === 'object' ? { ...seriesMeta } : null,
    selectionLogId: selectionLogId ? String(selectionLogId) : null,
    releaseDate: String(releaseDate || '').trim(),
    releaseTag: String(releaseTag || '').trim(),
    releaseTimezone: String(releaseTimezone || 'Asia/Manila').trim() || 'Asia/Manila',
    releaseDelayDays: Math.max(0, Math.min(30, Math.floor(Number(releaseDelayDays || 3)))),
    releaseState: String(releaseDate || '').trim() ? 'waiting' : 'released',
    releasedAt: null,
    holdDir: null,
    finalTargetDir: null,
  };

  const db = await getAdminDb();
  const key = dbKeyForType(t);
  db[key] = Array.isArray(db[key]) ? db[key] : [];

  const dup = db[key].find((x) => Number(x?.tmdb?.id || 0) === details.id && String(x?.status || '').toLowerCase() !== 'deleted');
  if (dup) throw new Error('This TMDB item is already in the active queue.');

  const inventoryResult = await getOrRefreshLibraryInventory({ maxAgeMs: 6 * 60 * 60 * 1000, force: false }).catch(() => null);
  if (
    hasInventoryMatch({
      inventory: inventoryResult?.inventory || null,
      type: t,
      title: details.title,
      year: details.year,
    })
  ) {
    throw new Error('This title already exists in the library inventory.');
  }

  const xuiCatalog = await getXuiLibraryCatalog({ maxAgeMs: 5 * 60 * 1000, force: false }).catch(() => null);
  if (
    hasXuiCatalogMatch({
      catalog: xuiCatalog,
      type: t,
      title: details.title,
      year: details.year,
      tmdbId: details.id,
    })
  ) {
    throw new Error('This title already exists in XUI.');
  }

  db[key].unshift(record);
  db[key] = db[key].slice(0, 5000);
  await saveAdminDb(db);
  return record;
}

export async function clearDownloadsForType({ type = 'movie', purgeNas = false, purgeNasAuthorized = false } = {}) {
  const t = sanitizeType(type);
  if (purgeNas && t !== 'movie') {
    throw new Error('NAS purge is only supported for movie type.');
  }
  if (purgeNas && !purgeNasAuthorized) {
    throw new Error('Movie NAS purge blocked by safety lock. Explicit authorization is required.');
  }
  const { engineHost, port, settings, moviesPaths, seriesPaths } = await ensurePrereqs();

  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const rows = Array.isArray(db[key]) ? db[key] : [];
  const hashes = new Set();

  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  try {
    qbSession = await createQbSession({ ssh, port, settings });

    const desiredCategory = t === 'series' ? 'SERIES_AUTO' : 'MOVIE_AUTO';
    let torrents = [];
    let infoErr = '';
    try {
      const infoText = await qbCurl(ssh, {
        port,
        path: `/api/v2/torrents/info?filter=all&category=${encodeURIComponent(desiredCategory)}`,
        method: 'GET',
        cookieJar: qbSession.cookieJar,
        timeoutMs: 45000,
      });
      torrents = parseQbArray(infoText, 'qBittorrent torrents/info');
    } catch (e) {
      infoErr = e?.message || 'Failed to query qBittorrent torrents/info.';
      try {
        const fallbackInfoText = await qbCurl(ssh, {
          port,
          path: '/api/v2/torrents/info',
          method: 'GET',
          cookieJar: qbSession.cookieJar,
          timeoutMs: 45000,
        });
        torrents = parseQbArray(fallbackInfoText, 'qBittorrent torrents/info');
        infoErr = '';
      } catch (fallbackErr) {
        infoErr = fallbackErr?.message || infoErr;
      }
    }

    const stageRoot = normalizeDirPath(t === 'series' ? seriesPaths.stageRoot : moviesPaths.stageRoot);

    for (const tor of Array.isArray(torrents) ? torrents : []) {
      const hash = String(tor?.hash || '').trim();
      if (!hash) continue;
      const savePath = normalizeDirPath(tor?.save_path || '');
      const inStageRoot = Boolean(stageRoot && savePath.startsWith(stageRoot));
      if (inStageRoot) {
        hashes.add(hash);
      }
    }

    const allHashes = [...hashes];
    if (allHashes.length) {
      for (let i = 0; i < allHashes.length; i += 100) {
        const chunk = allHashes.slice(i, i + 100);
        await qbCurl(ssh, {
          port,
          path: '/api/v2/torrents/delete',
          method: 'POST',
          form: { hashes: chunk.join('|'), deleteFiles: 'true' },
          cookieJar: qbSession.cookieJar,
          timeoutMs: 90000,
        });
      }
    } else if (infoErr) {
      console.warn(`[autodownload] clearDownloadsForType(${t}): ${infoErr}`);
    }

    let nasPurged = false;
    if (purgeNas && t === 'movie') {
      const moviesRoot = normalizeDirPath(moviesPaths.root);
      const stageRoot = normalizeDirPath(moviesPaths.stageRoot);
      const script = [
        'set -euo pipefail',
        `MOVIES_ROOT=${shQuote(moviesRoot)}`,
        `STAGE_ROOT=${shQuote(stageRoot)}`,
        'purge_dir() {',
        '  local d="$1"',
        '  [ -n "$d" ] || return 0',
        '  [ "$d" != "/" ] || return 1',
        '  [ -d "$d" ] || return 0',
        '  local i=0',
        '  while [ "$i" -lt 12 ]; do',
        '    find "$d" -mindepth 1 -maxdepth 1 -exec sh -c \'',
        '      for p do',
        '        rm -rf -- "$p" 2>/dev/null || true',
        '        if [ -d "$p" ]; then',
        '          find "$p" -mindepth 1 -exec rm -rf -- {} + 2>/dev/null || true',
        '          rm -rf -- "$p" 2>/dev/null || true',
        '        fi',
        '      done',
        "    ' sh {} +",
        '    if ! find "$d" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then',
        '      return 0',
        '    fi',
        '    i=$((i+1))',
        '    sleep 1',
        '  done',
        '  echo "purge_dir_not_empty: $d" >&2',
        '  find "$d" -mindepth 1 -maxdepth 2 -print 2>/dev/null | head -n 20 >&2 || true',
        '  return 2',
        '}',
        'purge_dir "$MOVIES_ROOT"',
        'purge_dir "$STAGE_ROOT"',
      ].join('\n');

      let purgeRes = await ssh.exec(script, { timeoutMs: 240000 });
      if (Number(purgeRes?.code || 0) !== 0) {
        const msg = String(purgeRes?.stderr || purgeRes?.stdout || '').trim();
        const needsSudo = /permission denied/i.test(msg);
        if (needsSudo) {
          purgeRes = await ssh.exec(script, { timeoutMs: 240000, sudo: true });
        }
      }
      if (Number(purgeRes?.code || 0) !== 0) {
        const msg = String(purgeRes?.stderr || purgeRes?.stdout || '').trim();
        throw new Error(`Movie NAS purge failed${msg ? `: ${msg.slice(0, 240)}` : ''}`);
      }
      nasPurged = true;
    }

    db[key] = [];
    if (purgeNas && t === 'movie' && db.libraryInventory && typeof db.libraryInventory === 'object') {
      const inv = db.libraryInventory;
      inv.movies = [];
      inv.stats = inv.stats && typeof inv.stats === 'object' ? inv.stats : { movies: 0, series: 0, total: 0 };
      inv.stats.movies = 0;
      inv.stats.total = Number(inv.stats.series || 0);
      inv.updatedAt = now();
      inv.lastError = '';
    }
    await saveAdminDb(db);
    return {
      ok: true,
      type: t,
      deletedRows: rows.length,
      deletedTorrents: hashes.size,
      nasPurged,
    };
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

export async function startQueuedDownloads({ type = 'all', limitPerType = 1, limitByType = null, skipVpnGuard = false } = {}) {
  const { engineHost, port, settings, moviesPaths, seriesPaths } = await ensurePrereqs();
  const mountStatus = await fetchMountStatus().catch(() => null);
  if (!mountStatus?.ok) {
    return {
      ok: true,
      skipped: true,
      reason: 'mount_not_ready',
      started: 0,
      failed: 0,
      skippedCount: 0,
      results: [],
      error: mountStatus?.error || 'NAS not mounted/writable.',
    };
  }
  if (!skipVpnGuard) {
    const vpnGuard = await ensureQbittorrentVpnReadyForDispatch().catch((e) => ({
      ok: false,
      required: true,
      summary: e?.message || 'VPN guard failed.',
    }));
    if (!vpnGuard?.ok) {
      return {
        ok: false,
        started: 0,
        failed: 0,
        skipped: 0,
        results: [],
        error: vpnGuard?.summary || 'VPN is required but not ready.',
        vpn: vpnGuard,
      };
    }
  }
  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;

  const types = type === 'all' ? ['movie', 'series'] : [sanitizeType(type)];
  const defaultPerTypeLimit = Math.max(1, Math.min(50, Number(limitPerType || 1) || 1));
  const startedAt = now();
  const out = {
    ok: true,
    started: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  try {
    await ssh.connect({ timeoutMs: 15000 });
    qbSession = await createQbSession({ ssh, port, settings });
    const inventoryResult = await getOrRefreshLibraryInventory({ maxAgeMs: 6 * 60 * 60 * 1000, force: false }).catch(
      () => null
    );
    const inventory = inventoryResult?.inventory || null;
    const xuiCatalog = await getXuiLibraryCatalog({ maxAgeMs: 5 * 60 * 1000, force: false }).catch(() => null);

    for (const t of types) {
      const rawLimit = limitByType && typeof limitByType === 'object' ? Number(limitByType[t]) : NaN;
      const perTypeLimit = Number.isFinite(rawLimit)
        ? Math.max(0, Math.min(50, Math.floor(rawLimit)))
        : defaultPerTypeLimit;
      if (perTypeLimit <= 0) {
        out.results.push({ type: t, ok: true, skipped: true, reason: 'dispatch_limit_zero' });
        continue;
      }

      const sourcePolicy = sourcePolicyForType(settings, t);
      const key = dbKeyForType(t);
      const db = await getAdminDb();
      const list = Array.isArray(db[key]) ? db[key] : [];
      const validSelectionLogIds = new Set(
        (Array.isArray(db.selectionLogs) ? db.selectionLogs : [])
          .map((row) => String(row?.id || '').trim())
          .filter(Boolean)
      );
      const candidates = list.filter((rec) => shouldAutoStartQueuedRecord(rec, startedAt));
      let startedForType = 0;

      for (const rec of candidates) {
        if (startedForType >= perTypeLimit) break;
        const selectionLogId = String(rec?.selectionLogId || '').trim();
        if (!selectionLogId || !validSelectionLogIds.has(selectionLogId)) {
          await updateRecordById({
            type: t,
            id: rec.id,
            mutate: (cur) => ({
              ...cur,
              status: 'Deleted',
              cleanedAt: now(),
              error: 'Skipped: linked selection log was cleared.',
              deletedReason: 'Linked selection log was cleared before dispatch.',
              nextSourceRetryAt: null,
            }),
          });
          out.skipped++;
          out.results.push({ id: rec.id, type: t, ok: false, skipped: true, reason: 'selection_log_missing' });
          continue;
        }
        const seriesMode = String(rec?.seriesMeta?.mode || '').trim().toLowerCase();
        const effectiveMaxSizeGb =
          t === 'series' && seriesMode === 'season_pack' ? sourcePolicy.maxSeasonTotalGb : sourcePolicy.maxSizeGb;
        const effectivePolicy = { ...sourcePolicy, maxSizeGb: effectiveMaxSizeGb };

        const duplicateInLibrary = hasInventoryMatch({
          inventory,
          type: t,
          title: rec?.tmdb?.title || rec?.title || '',
          year: rec?.tmdb?.year || rec?.year || null,
        });
        if (duplicateInLibrary) {
          await updateRecordById({
            type: t,
            id: rec.id,
            mutate: (cur) => ({
              ...cur,
              status: 'Deleted',
              error: 'Skipped: already exists in library inventory.',
              nextSourceRetryAt: null,
            }),
          });
          out.skipped++;
          out.results.push({ id: rec.id, type: t, ok: false, skipped: true, reason: 'duplicate_inventory' });
          continue;
        }

        const targetTitle = rec?.tmdb?.title || rec?.title || '';
        const targetYear = rec?.tmdb?.year || rec?.year || null;
        const duplicateInXui = hasXuiCatalogMatch({
          catalog: xuiCatalog,
          type: t,
          title: targetTitle,
          year: targetYear,
          tmdbId: Number(rec?.tmdb?.id || 0) || null,
        });
        if (duplicateInXui) {
          await updateRecordById({
            type: t,
            id: rec.id,
            mutate: (cur) => ({
              ...cur,
              status: 'Deleted',
              error: 'Skipped: already exists in XUI library.',
              nextSourceRetryAt: null,
            }),
          });
          out.skipped++;
          out.results.push({ id: rec.id, type: t, ok: false, skipped: true, reason: 'duplicate_xui' });
          continue;
        }

        const correlationId = `queue-${t}-${rec.id}-${now()}`;
        const queuedUrl = String(rec?.url || '').trim();
        let sourceResult = null;
        let selected =
          sourceRecordMatchesPolicy(rec, effectivePolicy) &&
          sourceMatchesRequestedMedia(rec?.source, {
            title: targetTitle,
            year: targetYear,
            type: t,
            imdbId: rec?.tmdb?.imdbId || '',
          })
            ? rec.source
            : null;
        let sourceLinks = buildSourceLinkCandidates(selected, queuedUrl);
        let sourceLink = sourceLinks[0] || '';

        // Old YTS rows may contain trackerless magnets from earlier builds.
        // Force a fresh source lookup so we can switch to a .torrent URL (or enriched magnet).
        const isTrackerlessMagnet = /^magnet:\?/i.test(sourceLink) && !/[?&]tr=/i.test(sourceLink);
        if (isTrackerlessMagnet && String(rec?.source?.provider || '').trim().toLowerCase() === 'yts') {
          selected = null;
          sourceLinks = [];
          sourceLink = '';
        }

        if (sourceLink && !selected) {
          sourceLinks = [];
          sourceLink = '';
        }

        if (!sourceLink && selected) {
          sourceLinks = buildSourceLinkCandidates(selected);
          sourceLink = sourceLinks[0] || '';
        }

        if (!sourceLink) {
          const { query, year } = sourceQueryFromRecord(rec);
          if (!query) {
            out.skipped++;
            out.results.push({ id: rec.id, type: t, ok: false, skipped: true, reason: 'missing_query' });
            continue;
          }

          try {
            sourceResult = await searchBestDownloadSource({
              query,
              year,
              type: t,
              selectionLogId,
              correlationId,
              jobId: rec.id,
              stopOnFirstValid: true,
              minSeeders: sourcePolicy.minSeeders,
              maxSizeGb: effectivePolicy.maxSizeGb,
            });
          } catch (e) {
            sourceResult = { ok: false, error: e?.message || 'Source search failed.' };
          }

          selected = sourceResult?.selected || selected;
          if (selected && !sourceCandidateMatchesPolicy(selected, effectivePolicy)) {
            sourceResult = {
              ...(sourceResult || {}),
              ok: false,
              error: `Filtered by source policy (min seeders ${sourcePolicy.minSeeders}${
                effectivePolicy.maxSizeGb !== null ? `, max size ${effectivePolicy.maxSizeGb} GB` : ''
              }).`,
            };
            selected = null;
          }
          sourceLinks = buildSourceLinkCandidates(selected);
          sourceLink = sourceLinks[0] || '';
        } else if (!sourceResult) {
          sourceResult = { ok: true, attempts: [] };
        }

        if (!sourceLink) {
          const msg = String(sourceResult?.error || 'No valid source found.');
          const retryAt = now() + SOURCE_RETRY_MINUTES * 60 * 1000;
          await updateRecordById({
            type: t,
            id: rec.id,
            mutate: (cur) => ({
              ...cur,
              status: 'Queued',
              error: msg,
              sourceLastAttemptAt: now(),
              sourceAttempts: Number(cur?.sourceAttempts || 0) + 1,
              nextSourceRetryAt: retryAt,
            }),
          });
          out.failed++;
          out.results.push({ id: rec.id, type: t, ok: false, error: msg });
          continue;
        }

        const savepath = t === 'series' ? seriesPaths.downloadingDir : moviesPaths.downloadingDir;
        const category = t === 'series' ? 'SERIES_AUTO' : 'MOVIE_AUTO';

        try {
          const selectedHash = String(selected?.hash || '').trim().toUpperCase();
          const addResult = await addTorrentAndFindMatch({
            ssh,
            port,
            qbSession,
            candidateLinks: sourceLinks.length ? sourceLinks : [sourceLink],
            savepath,
            category,
            selectedHash,
            title: rec?.title || '',
            strictHash: Boolean(selectedHash),
          });
          const top = addResult.top;
          sourceLink = addResult.usedLink;

          const topSizeBytes = Number(top?.size || 0) || 0;
          const maxAllowedBytes = bytesFromGb(effectivePolicy.maxSizeGb);
          if (maxAllowedBytes !== null && topSizeBytes > maxAllowedBytes) {
            await qbCurl(ssh, {
              port,
              path: '/api/v2/torrents/delete',
              method: 'POST',
              form: { hashes: String(top.hash), deleteFiles: 'true' },
              cookieJar: qbSession.cookieJar,
              timeoutMs: 90000,
            });

            const retryAt = now() + SOURCE_RETRY_MINUTES * 60 * 1000;
            const msg = `Filtered by size limit (actual ${formatGbFromBytes(topSizeBytes)} GB > max ${Number(
              effectivePolicy.maxSizeGb || 0
            )} GB).`;
            await updateRecordById({
              type: t,
              id: rec.id,
              mutate: (cur) => ({
                ...cur,
                qbHash: null,
                qbName: top?.name || cur?.qbName || null,
                status: 'Queued',
                progress: 0,
                sizeBytes: topSizeBytes || cur?.sizeBytes || null,
                error: msg,
                sourceLastAttemptAt: now(),
                sourceAttempts: Number(cur?.sourceAttempts || 0) + 1,
                nextSourceRetryAt: retryAt,
              }),
            });
            out.failed++;
            out.results.push({ id: rec.id, type: t, ok: false, error: msg });
            continue;
          }

          await updateRecordById({
            type: t,
            id: rec.id,
            mutate: (cur) => ({
              ...cur,
              url: sourceLink,
              qbHash: top.hash,
              qbName: top?.name || cur?.qbName || null,
              sourceCleanupPath: buildManagedSourcePath(savepath, top?.name || cur?.qbName || ''),
              status: statusFromTorrent(top),
              progress: Number(top?.progress || 0) || 0,
              sizeBytes: Number(top?.size || cur?.sizeBytes || 0) || cur?.sizeBytes || null,
              addedAt: now(),
              completedAt: null,
              savePath: savepath,
              category,
              error: '',
              source: {
                provider: String(selected?.provider || '').trim(),
                name: String(selected?.name || '').trim(),
                seeders: Number(selected?.seeders || 0) || 0,
                quality: String(selected?.quality || '').trim(),
                sizeGb: selected?.sizeGb ?? null,
                hash: String(selected?.hash || '').trim(),
                sourceUrl: String(selected?.sourceUrl || '').trim(),
                magnet: String(selected?.magnet || '').trim(),
                domainUsed: String(selected?.domainUsed || '').trim(),
                imdbIdDigits: String(selected?.imdbIdDigits || '').trim(),
                fetchedAt: Number(selected?.fetchedAt || now()),
                attempts: Array.isArray(sourceResult?.attempts) ? sourceResult.attempts : [],
                correlationId,
              },
              sourceLastAttemptAt: now(),
              sourceAttempts: Number(cur?.sourceAttempts || 0) + 1,
              nextSourceRetryAt: null,
            }),
          });

          startedForType++;
          out.started++;
          out.results.push({
            id: rec.id,
            type: t,
            ok: true,
            provider: selected?.provider || '',
            qbHash: top?.hash || '',
          });
        } catch (e) {
          const msg = e?.message || 'Failed to add torrent to qBittorrent.';
          const retryAt = now() + SOURCE_RETRY_MINUTES * 60 * 1000;
          await updateRecordById({
            type: t,
            id: rec.id,
            mutate: (cur) => ({
              ...cur,
              status: 'Queued',
              error: msg,
              sourceLastAttemptAt: now(),
              sourceAttempts: Number(cur?.sourceAttempts || 0) + 1,
              nextSourceRetryAt: retryAt,
            }),
          });
          out.failed++;
          out.results.push({ id: rec.id, type: t, ok: false, error: msg });
        }
      }
    }

    return out;
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

export async function syncDownloadsFromClient({ type = 'all' } = {}) {
  const { engineHost, port, settings, moviesPaths, seriesPaths } = await ensurePrereqs();
  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  try {
    qbSession = await createQbSession({ ssh, port, settings });
    // Avoid pulling the entire qBittorrent torrent list into memory on every scheduler tick.
    // We primarily manage torrents in MOVIE_AUTO / SERIES_AUTO, so fetch those categories first.
    const types = type === 'all' ? ['movie', 'series'] : [sanitizeType(type)];
    const wantedCategories = [];
    if (types.includes('movie')) wantedCategories.push('MOVIE_AUTO');
    if (types.includes('series')) wantedCategories.push('SERIES_AUTO');

    const torrents = [];
    for (const category of wantedCategories) {
      try {
        const infoText = await qbCurl(ssh, {
          port,
          path: `/api/v2/torrents/info?filter=all&category=${encodeURIComponent(category)}`,
          method: 'GET',
          cookieJar: qbSession.cookieJar,
          timeoutMs: 60000,
        });
        const rows = parseQbArray(infoText, 'qBittorrent torrents/info');
        if (Array.isArray(rows) && rows.length) torrents.push(...rows);
      } catch {
        // If a category lookup fails, continue; per-hash lookups below prevent false "missing torrent" requeues.
      }
    }

    const byHash = new Map(
      (Array.isArray(torrents) ? torrents : [])
        .filter((t) => t?.hash)
        .map((t) => [normalizeHash(t.hash), t])
    );
    const db = await getAdminDb();
    const validSelectionLogIds = new Set(
      (Array.isArray(db.selectionLogs) ? db.selectionLogs : [])
        .map((row) => String(row?.id || '').trim())
        .filter(Boolean)
    );

    const staleCompletedByType = { movie: { deleted: 0, waiting: 0, failed: 0 }, series: { deleted: 0, waiting: 0, failed: 0 } };
    for (const t of types) {
      const sourcePolicy = sourcePolicyForType(settings, t);
      const key = dbKeyForType(t);
      const list = Array.isArray(db[key]) ? db[key] : [];
      const desiredDownloaded = t === 'series' ? seriesPaths.downloadedDir : moviesPaths.downloadedDir;
      const desiredDownloading = t === 'series' ? seriesPaths.downloadingDir : moviesPaths.downloadingDir;
      const desiredCategory = t === 'series' ? 'SERIES_AUTO' : 'MOVIE_AUTO';
      const autoDeleteCompletedTorrents = settings?.downloadClient?.autoDeleteCompletedTorrents !== false;
      const autoDeleteCompletedDelayMinutesRaw = Number(settings?.downloadClient?.autoDeleteCompletedDelayMinutes);
      const autoDeleteCompletedDelayMinutes = Number.isFinite(autoDeleteCompletedDelayMinutesRaw)
        ? Math.max(0, Math.min(4320, Math.floor(autoDeleteCompletedDelayMinutesRaw)))
        : 30;
      const autoDeleteCompletedDelayMs = autoDeleteCompletedDelayMinutes * 60 * 1000;
      const stageRoot = normalizeDirPath(t === 'series' ? seriesPaths.stageRoot : moviesPaths.stageRoot);
      const managedRoots = [normalizeDirPath(desiredDownloading), normalizeDirPath(desiredDownloaded), stageRoot].filter(Boolean);
      const pathsForType = t === 'series' ? seriesPaths : moviesPaths;
      const removeClearedSelectionRow = async (rec, torrentInfo = null, reason = 'Selection log cleared; orphaned auto-download entry removed.') => {
        const normalizedHash = normalizeHash(rec?.qbHash || torrentInfo?.hash || '');
        if (normalizedHash && qbSession?.cookieJar) {
          try {
            await qbDeleteAndConfirm({
              ssh,
              port,
              cookieJar: qbSession.cookieJar,
              hash: normalizedHash,
              deleteFiles: true,
              confirmMs: 7000,
            });
          } catch {}
        }

        const cleanup = await cleanupManagedDownloadArtifacts({
          ssh,
          rec,
          torrentInfo,
          pathsForType,
        }).catch(() => ({ removedPaths: [], skippedPaths: [], removedFromFinalLibrary: false }));

        if (cleanup?.removedFromFinalLibrary) {
          await updateXuiScanState({
            [t === 'series' ? 'seriesScanPending' : 'moviesScanPending']: true,
          }).catch(() => null);
          await getOrRefreshLibraryInventory({ maxAgeMs: 0, force: true }).catch(() => null);
        }

        return {
          ...rec,
          qbHash: null,
          progress: 0,
          status: 'Deleted',
          cleanedAt: now(),
          error: reason,
          deletedReason: reason,
          nextSourceRetryAt: null,
          deletedDetails: {
            ...(rec?.deletedDetails && typeof rec.deletedDetails === 'object' ? rec.deletedDetails : {}),
            action: 'selection_log_cleared',
            removedPaths: cleanup?.removedPaths || [],
            skippedPaths: cleanup?.skippedPaths || [],
          },
        };
      };

      const nextList = [];
      for (const rec of list) {
        const selectionLogId = String(rec?.selectionLogId || '').trim();
        const hasValidSelectionLog = selectionLogId && validSelectionLogIds.has(selectionLogId);
        const isManagedSelectionRow = Number(rec?.tmdb?.id || 0) > 0;
        if (!rec?.qbHash) {
          if (isManagedSelectionRow && !hasValidSelectionLog) {
            const statusLower = String(rec?.status || '').toLowerCase();
            const releaseStateLower = String(rec?.releaseState || '').toLowerCase();
            if (statusLower !== 'deleted' && releaseStateLower !== 'released') {
              nextList.push(await removeClearedSelectionRow(rec));
              continue;
            }
          }
          const recUrl = String(rec?.url || '').trim();
          if (recUrl) {
            const sourceHash = normalizeHash(rec?.source?.hash || '');
            const preferredPath = String(rec?.savePath || desiredDownloading).trim();
            const matched = pickTorrentMatch({
              torrents,
              selectedHash: sourceHash,
              preferredPath,
              title: rec?.title || '',
              strictHash: Boolean(sourceHash),
            });

            if (matched?.hash) {
              const st = statusFromTorrent(matched);
              const preserveStatus = ['processing', 'cleaned', 'deleted', 'released'].includes(
                String(rec?.status || '').toLowerCase()
              );
              const placement = await enforceTorrentPlacement({
                ssh,
                port,
                cookieJar: qbSession.cookieJar,
                qbHash: matched.hash,
                desiredLocation: desiredDownloading,
                currentLocation: matched?.save_path || '',
                desiredCategory,
                currentCategory: matched?.category || '',
              }).catch(() => ({ moved: false, categorized: false, error: '' }));
              nextList.push({
                ...rec,
                qbHash: matched.hash,
                qbName: matched.name || rec.qbName || null,
                sourceCleanupPath: buildManagedSourcePath(
                  placement.moved ? desiredDownloading : preferredPath || rec.savePath || '',
                  matched.name || rec.qbName || ''
                ),
                progress: Number(matched.progress || 0),
                sizeBytes: Number(matched.size || 0) || rec.sizeBytes,
                status: preserveStatus ? rec.status : st,
                completedAt:
                  rec.completedAt ||
                  (Number(matched.progress || 0) >= 1
                    ? Number(matched.completion_on || 0)
                      ? matched.completion_on * 1000
                      : now()
                    : null),
                error: st === 'Failed' ? String(matched?.state || 'error') : placement.error || '',
                savePath: placement.moved ? desiredDownloading : preferredPath || rec.savePath || null,
                category: desiredCategory,
              });
              continue;
            }
          }
          nextList.push(rec);
          continue;
        }
        let tor = byHash.get(normalizeHash(rec.qbHash));
        if (!tor) {
          // The torrent might exist but be in a different category; do a lightweight lookup by hash.
          tor = await fetchTorrentInfoByHash({
            ssh,
            port,
            cookieJar: qbSession.cookieJar,
            hash: String(rec.qbHash),
          }).catch(() => null);
          if (tor?.hash) byHash.set(normalizeHash(tor.hash), tor);
        }
        if (!tor) {
          const statusLower = String(rec?.status || '').toLowerCase();
          const releaseStateLower = String(rec?.releaseState || '').toLowerCase();
          if (isManagedSelectionRow && !hasValidSelectionLog && releaseStateLower !== 'released') {
            nextList.push(
              await removeClearedSelectionRow(
                {
                  ...rec,
                  qbHash: null,
                },
                null,
                'Torrent record was already gone after its selection log was cleared.'
              )
            );
            continue;
          }
          const isFinal = ['completed', 'processing', 'cleaned', 'deleted'].includes(statusLower);
          if (!isFinal) {
            const canRequeue = hasValidSelectionLog;
            nextList.push(
              canRequeue
                ? {
                    ...rec,
                    qbHash: null,
                    qbName: rec?.qbName || null,
                    progress: 0,
                    sizeBytes: rec.sizeBytes || null,
                    status: 'Queued',
                    error: 'Torrent missing in qBittorrent. Re-queued for retry.',
                    nextSourceRetryAt: null,
                    sourceCleanupPath: rec?.sourceCleanupPath || buildManagedSourcePath(rec?.savePath, rec?.qbName),
                  }
                : await removeClearedSelectionRow(
                    {
                      ...rec,
                      qbHash: null,
                    },
                    null,
                    'Torrent missing in qBittorrent after its selection log was cleared.'
                  )
            );
          } else {
            const missingFinal = { ...rec };
            if (rec?.qbHash && !rec?.qbDeletedAt) {
              missingFinal.qbDeletedAt = now();
              missingFinal.qbDeleteStatus = 'missing_in_client';
              missingFinal.qbDeleteError = '';
            }
            nextList.push(missingFinal);
          }
          continue;
        }
        const statusLower = String(rec?.status || '').toLowerCase();
        const releaseStateLower = String(rec?.releaseState || '').toLowerCase();
        if (isManagedSelectionRow && !hasValidSelectionLog && statusLower !== 'deleted' && releaseStateLower !== 'released') {
          nextList.push(await removeClearedSelectionRow(rec, tor));
          continue;
        }
        const torSizeBytes = Number(tor?.size || rec?.sizeBytes || 0) || 0;
        const effectiveMaxSizeGb =
          t === 'series' && String(rec?.seriesMeta?.mode || '').trim().toLowerCase() === 'season_pack'
            ? sourcePolicy.maxSeasonTotalGb
            : sourcePolicy.maxSizeGb;
        const maxAllowedBytes = bytesFromGb(effectiveMaxSizeGb);
        if (maxAllowedBytes !== null && torSizeBytes > maxAllowedBytes) {
          try {
            await qbCurl(ssh, {
              port,
              path: '/api/v2/torrents/delete',
              method: 'POST',
              form: { hashes: String(rec.qbHash || tor.hash || ''), deleteFiles: 'true' },
              cookieJar: qbSession.cookieJar,
              timeoutMs: 90000,
            });
          } catch {}
          const retryAt = now() + SOURCE_RETRY_MINUTES * 60 * 1000;
          nextList.push({
            ...rec,
            qbHash: null,
            progress: 0,
            sizeBytes: torSizeBytes || rec.sizeBytes || null,
            status: 'Queued',
            error: `Filtered by size limit (actual ${formatGbFromBytes(torSizeBytes)} GB > max ${Number(
              effectiveMaxSizeGb || 0
            )} GB).`,
            sourceLastAttemptAt: now(),
            sourceAttempts: Number(rec?.sourceAttempts || 0) + 1,
            nextSourceRetryAt: retryAt,
          });
          continue;
        }
        const st = statusFromTorrent(tor);
        const preserveStatus = ['processing', 'cleaned', 'deleted', 'released'].includes(
          String(rec?.status || '').toLowerCase()
        );
        let next = {
          ...rec,
          qbName: tor.name || rec.qbName || null,
          sourceCleanupPath: buildManagedSourcePath(tor?.save_path || tor?.savePath || rec?.savePath || '', tor.name || rec.qbName || ''),
          progress: Number(tor.progress || 0),
          sizeBytes: Number(tor.size || 0) || rec.sizeBytes,
          status: preserveStatus ? rec.status : st,
          completedAt:
            rec.completedAt ||
            (Number(tor.progress || 0) >= 1 ? (Number(tor.completion_on || 0) ? tor.completion_on * 1000 : now()) : null),
          error: st === 'Failed' ? String(tor?.state || 'error') : '',
        };
        if (hasStaleDeleteMarker(next)) {
          next = {
            ...next,
            qbDeletedAt: null,
            qbDeleteStatus: '',
            qbDeleteError: '',
          };
        }
        const curSave = String(tor?.save_path || tor?.savePath || next.savePath || '').trim();
        const completed = String(next.status || '').toLowerCase() === 'completed';
        const placement = await enforceTorrentPlacement({
          ssh,
          port,
          cookieJar: qbSession.cookieJar,
          qbHash: next.qbHash,
          desiredLocation: completed ? desiredDownloaded : desiredDownloading,
          currentLocation: curSave,
          desiredCategory,
          currentCategory: tor?.category || '',
        }).catch(() => ({ moved: false, categorized: false, error: '' }));
        if (placement.moved) {
          next = {
            ...next,
            savePath: completed ? desiredDownloaded : desiredDownloading,
          };
        }
        if (placement.categorized) {
          next = {
            ...next,
            category: desiredCategory,
          };
        }
        if (!next.error && placement.error) {
          next = {
            ...next,
            error: placement.error,
          };
        }
        // When a job completes, move Downloading -> Downloaded (qB aware) once.
        if (String(next.status || '').toLowerCase() === 'completed') {
          const curSaveNow = placement.moved ? desiredDownloaded : curSave;
          const already = String(next?.stage || next?.staged || '').toLowerCase() === 'downloaded' || Boolean(next?.downloadedAt);
          if (!already && desiredDownloaded && curSaveNow && curSaveNow !== desiredDownloaded) {
            try {
              await qbCurl(ssh, {
                port,
                path: '/api/v2/torrents/setLocation',
                method: 'POST',
                form: { hashes: next.qbHash, location: desiredDownloaded },
                cookieJar: qbSession.cookieJar,
                timeoutMs: 60000,
              });
              next = {
                ...next,
                savePath: desiredDownloaded,
                sourceCleanupPath: buildManagedSourcePath(desiredDownloaded, next.qbName || tor.name || ''),
                downloadedAt: now(),
                stage: 'Downloaded',
              };
            } catch (e) {
              next = {
                ...next,
                error: next.error || `Move to Downloaded failed: ${e?.message || 'setLocation failed'}`,
              };
            }
          }
        }
        const nextStatusLower = String(next.status || '').toLowerCase();
        if (autoDeleteCompletedTorrents && isAutoDeleteEligibleStatus(nextStatusLower) && next?.qbHash && !next?.qbDeletedAt) {
          const completedAtMs = resolveCompletedAtMs({ record: next, torrent: tor });
          const dueAt = completedAtMs + autoDeleteCompletedDelayMs;
          if (now() >= dueAt) {
            try {
              await qbDeleteAndConfirm({
                ssh,
                port,
                cookieJar: qbSession.cookieJar,
                hash: String(next.qbHash),
                deleteFiles: false,
              });
              next = {
                ...next,
                qbDeletedAt: now(),
                qbDeleteStatus: 'deleted_after_download',
                qbDeleteDueAt: dueAt,
                qbDeleteError: '',
              };
            } catch (e) {
              next = {
                ...next,
                qbDeleteStatus: 'error',
                qbDeleteDueAt: dueAt,
                qbDeleteError: e?.message || 'Failed to auto-delete completed torrent.',
              };
            }
          } else {
            next = {
              ...next,
              qbDeleteStatus: 'waiting_delay',
              qbDeleteDueAt: dueAt,
              qbDeleteError: '',
            };
          }
        }
        nextList.push(next);
      }

      if (autoDeleteCompletedTorrents) {
        const trackedHashes = new Set(
          nextList
            .map((row) => String(row?.qbHash || '').trim().toLowerCase())
            .filter(Boolean)
        );
        for (const tor of Array.isArray(torrents) ? torrents : []) {
          const hash = String(tor?.hash || '').trim();
          if (!hash) continue;
          if (trackedHashes.has(hash.toLowerCase())) continue;

          const torCategory = String(tor?.category || '').trim().toUpperCase();
          const torSavePath = normalizeDirPath(tor?.save_path || tor?.savePath || '');
          const inManagedRoot = managedRoots.some((root) => torSavePath && torSavePath.startsWith(root));
          const isManaged = torCategory === desiredCategory || inManagedRoot;
          if (!isManaged) continue;

          const torStatus = statusFromTorrent(tor);
          if (!isAutoDeleteEligibleStatus(torStatus)) continue;

          const completedAtMs = resolveCompletedAtMs({ torrent: tor });
          const dueAt = completedAtMs + autoDeleteCompletedDelayMs;
          if (now() < dueAt) {
            staleCompletedByType[t].waiting += 1;
            continue;
          }
          try {
            await qbDeleteAndConfirm({
              ssh,
              port,
              cookieJar: qbSession.cookieJar,
              hash,
              deleteFiles: false,
            });
            staleCompletedByType[t].deleted += 1;
          } catch {
            staleCompletedByType[t].failed += 1;
          }
        }
      }

      db[key] = nextList;
    }

    await saveAdminDb(db);
    return { ok: true, torrents: Array.isArray(torrents) ? torrents.length : 0, staleCompletedCleanup: staleCompletedByType };
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

function mediaLabelForType(type = 'movie') {
  return sanitizeType(type) === 'series' ? 'series title' : 'movie';
}

async function performAdminImmediateReplace({
  type,
  id,
  deleteArtifacts = true,
  emitProgress = null,
} = {}) {
  const t = sanitizeType(type);
  const mediaLabel = mediaLabelForType(t);
  const emit =
    typeof emitProgress === 'function'
      ? (patch = {}) => {
          emitProgress({
            progress: Number.isFinite(Number(patch?.progress)) ? Math.max(0, Math.min(100, Number(patch.progress))) : undefined,
            phaseKey: patch?.phaseKey || undefined,
            phaseLabel: patch?.phaseLabel || undefined,
            summary: patch?.summary || undefined,
          });
        }
      : () => {};

  emit({ progress: 4, phaseKey: 'validate', phaseLabel: `Validating ${mediaLabel} replacement` });
  const { engineHost, port, settings, moviesPaths, seriesPaths } = await ensurePrereqs();
  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const list = Array.isArray(db[key]) ? db[key] : [];
  const idx = list.findIndex((x) => String(x?.id) === String(id));
  if (idx < 0) throw new Error('Download not found.');
  const rec = list[idx];
  const blockedReason = replaceBlockedReason(rec, t);
  if (blockedReason) throw new Error(blockedReason);

  const selectionLogId = String(rec?.selectionLogId || '').trim();
  if (!selectionLogId) {
    throw new Error(`This ${mediaLabel} is not linked to a ${t === 'series' ? 'Series' : 'Movie'} Selection Log.`);
  }

  const pathsForType = t === 'series' ? seriesPaths : moviesPaths;
  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  let cleanup = { removedPaths: [], skippedPaths: [], removedFromFinalLibrary: false };
  try {
    emit({ progress: 12, phaseKey: 'client', phaseLabel: 'Connecting to qBittorrent' });
    qbSession = await createQbSession({ ssh, port, settings }).catch(() => null);

    const torrentInfo = rec?.qbHash
      ? await fetchTorrentInfoByHash({
          ssh,
          port,
          cookieJar: qbSession?.cookieJar || '',
          hash: rec.qbHash,
        }).catch(() => null)
      : null;

    if (rec?.qbHash) {
      if (!qbSession?.cookieJar) {
        throw new Error('Failed to connect to qBittorrent to delete the existing torrent.');
      }
      emit({ progress: 24, phaseKey: 'delete_torrent', phaseLabel: 'Deleting the existing torrent from qBittorrent' });
      await qbDeleteAndConfirm({
        ssh,
        port,
        cookieJar: qbSession.cookieJar,
        hash: rec.qbHash,
        deleteFiles: true,
        confirmMs: 7000,
      });
    }

    emit({ progress: 40, phaseKey: 'cleanup', phaseLabel: 'Cleaning managed download files' });
    cleanup = deleteArtifacts
      ? await cleanupManagedDownloadArtifacts({
          ssh,
          rec,
          torrentInfo,
          pathsForType,
        })
      : { removedPaths: [], skippedPaths: [], removedFromFinalLibrary: false };

    if (deleteArtifacts && cleanup?.removedFromFinalLibrary) {
      await updateXuiScanState({
        [t === 'series' ? 'seriesScanPending' : 'moviesScanPending']: true,
      }).catch(() => null);
      await getOrRefreshLibraryInventory({ maxAgeMs: 0, force: true }).catch(() => null);
    }

    emit({ progress: 62, phaseKey: 'select', phaseLabel: `Selecting a new random ${mediaLabel}` });
    const { runSelectionJobForType } = await import('./selectionService');
    let replacement = await runSelectionJobForType({
      type: t,
      force: true,
      preserveLastRun: true,
      targetTotal: 1,
      triggerReason: 'admin_replace',
      selectionLogId,
      releaseDate: String(rec?.releaseDate || '').trim(),
      releaseTag: String(rec?.releaseTag || '').trim(),
      releaseTimezone: String(rec?.releaseTimezone || '').trim(),
      releaseDelayDays: rec?.releaseDelayDays,
      maxPagesPerBucket: t === 'series' ? 2 : 4,
      maxCandidatesPerBucket: t === 'series' ? 18 : 30,
    });
    let replacementItem = Array.isArray(replacement?.selected) ? replacement.selected[0] || null : null;
    if (t === 'series' && (!replacementItem || replacement?.ok === false)) {
      emit({
        progress: 70,
        phaseKey: 'select_relaxed',
        phaseLabel: 'Retrying with a relaxed series seeder filter',
      });
      replacement = await runSelectionJobForType({
        type: t,
        force: true,
        preserveLastRun: true,
        targetTotal: 1,
        triggerReason: 'admin_replace_relaxed',
        selectionLogId,
        releaseDate: String(rec?.releaseDate || '').trim(),
        releaseTag: String(rec?.releaseTag || '').trim(),
        releaseTimezone: String(rec?.releaseTimezone || '').trim(),
        releaseDelayDays: rec?.releaseDelayDays,
        minSeedersOverride: 0,
        maxPagesPerBucket: 3,
        maxCandidatesPerBucket: 24,
      });
      replacementItem = Array.isArray(replacement?.selected) ? replacement.selected[0] || null : null;
    }

    emit({ progress: 78, phaseKey: 'reconcile', phaseLabel: 'Updating the selection log and queue state' });
    const deletedBase = {
      ...rec,
      status: 'Deleted',
      cleanedAt: now(),
      error: '',
      deletedAt: now(),
      qbHash: '',
      progress: 0,
      deletedDetails: {
        action: 'replace',
        replacementTmdbId: Number(replacementItem?.tmdbId || replacementItem?.id || 0) || null,
        replacementTitle: String(replacementItem?.title || '').trim(),
        removedPaths: cleanup?.removedPaths || [],
        skippedPaths: cleanup?.skippedPaths || [],
        replaceFailed: !replacementItem,
      },
    };

    if (!replacement?.ok || !replacementItem) {
      const log = await reconcileSelectionLogReplacement({
        logId: selectionLogId,
        removedTmdbId: Number(rec?.tmdb?.id || 0) || null,
        replacementItem: null,
      });
      const nextItem = {
        ...deletedBase,
        deletedReason: `Admin replace removed this ${mediaLabel}, but no replacement ${mediaLabel} could be found right now.`,
      };
      await updateRecordById({ type: t, id, mutate: () => nextItem });
      const error = new Error(`Existing ${mediaLabel} was removed from qBittorrent, but no replacement ${mediaLabel} could be found right now.`);
      error.partialResult = { item: nextItem, replacement: null, log };
      throw error;
    }

    const log = await reconcileSelectionLogReplacement({
      logId: selectionLogId,
      removedTmdbId: Number(rec?.tmdb?.id || 0) || null,
      replacementItem,
    });
    const nextItem = {
      ...deletedBase,
      deletedReason: `Replaced by admin with ${String(replacementItem?.title || `another ${mediaLabel}`).trim()}.`,
    };
    await updateRecordById({ type: t, id, mutate: () => nextItem });

    emit({ progress: 90, phaseKey: 'dispatch', phaseLabel: 'Adding the replacement torrent to qBittorrent' });
    await startQueuedDownloads({
      type: t,
      limitPerType: 1,
      limitByType: t === 'series' ? { movie: 0, series: 1 } : { movie: 1, series: 0 },
    }).catch(() => null);

    emit({ progress: 96, phaseKey: 'refresh', phaseLabel: 'Refreshing the replacement row' });
    const latestDb = await getAdminDb();
    const latestList = Array.isArray(latestDb[key]) ? latestDb[key] : [];
    const replacementTmdbId = Number(replacementItem?.tmdbId || replacementItem?.id || 0) || 0;
    const replacementRow =
      latestList.find(
        (row) =>
          String(row?.selectionLogId || '').trim() === selectionLogId &&
          Number(row?.tmdb?.id || 0) === replacementTmdbId &&
          String(row?.status || '').toLowerCase() !== 'deleted'
      ) || null;

    return { item: nextItem, replacement: replacementRow, log };
  } finally {
    if (qbSession) await destroyQbSession(ssh, qbSession);
    await ssh.close().catch(() => null);
  }
}

export function startDownloadControlInBackground({
  type,
  id,
  action,
  title = '',
  deleteArtifacts = true,
} = {}) {
  const t = sanitizeType(type);
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!id) throw new Error('id is required.');
  if (normalizedAction !== 'replace') {
    throw new Error('Background mode is only supported for Replace right now.');
  }

  const registry = getDownloadControlJobRegistry();
  const key = controlJobKey({ type: t, id, action: normalizedAction });
  const activeId = registry.activeByKey.get(key) || '';
  const activeJob = activeId ? registry.jobs.get(activeId) || null : null;
  if (activeJob && activeJob.status === 'running') {
    return {
      accepted: false,
      alreadyRunning: true,
      run: serializeDownloadControlJob(activeJob),
    };
  }

  const job = {
    id: crypto.randomUUID(),
    key,
    type: t,
    itemId: String(id || '').trim(),
    action: normalizedAction,
    title: String(title || '').trim(),
    status: 'running',
    progress: 1,
    phaseKey: 'queued',
    phaseLabel: `Queued ${mediaLabelForType(t)} replacement`,
    summary: '',
    error: '',
    result: null,
    startedAt: now(),
    updatedAt: now(),
    finishedAt: 0,
    promise: null,
  };

  registry.jobs.set(job.id, job);
  registry.activeByKey.set(key, job.id);

  job.promise = (async () => {
    try {
      const result = await performAdminImmediateReplace({
        type: t,
        id,
        deleteArtifacts,
        emitProgress: (patch) => updateDownloadControlJob(job.id, patch),
      });
      updateDownloadControlJob(job.id, {
        status: 'completed',
        progress: 100,
        phaseKey: 'completed',
        phaseLabel: 'Replacement completed',
        summary: `Replaced ${job.title || mediaLabelForType(t)} successfully.`,
        error: '',
        result,
        finishedAt: now(),
      });
      return result;
    } catch (e) {
      updateDownloadControlJob(job.id, {
        status: 'failed',
        progress: 100,
        phaseKey: 'failed',
        phaseLabel: 'Replacement failed',
        summary: '',
        error: e?.message || 'Replace failed.',
        result: e?.partialResult && typeof e.partialResult === 'object' ? e.partialResult : null,
        finishedAt: now(),
      });
      return null;
    } finally {
      if (registry.activeByKey.get(key) === job.id) registry.activeByKey.delete(key);
      const current = registry.jobs.get(job.id);
      if (current) current.promise = null;
      pruneDownloadControlJobs(registry);
    }
  })();

  return {
    accepted: true,
    alreadyRunning: false,
    run: serializeDownloadControlJob(job),
  };
}

export async function controlDownload({ type, id, action, deleteArtifacts = true, preserveSelectionLog = false } = {}) {
  const t = sanitizeType(type);
  const a = String(action || '').toLowerCase();
  if (!id) throw new Error('id is required.');

  const { engineHost, port, mountDir, settings, moviesPaths, seriesPaths } = await ensurePrereqs();
  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const list = Array.isArray(db[key]) ? db[key] : [];
  const idx = list.findIndex((x) => String(x?.id) === String(id));
  if (idx < 0) throw new Error('Download not found.');
  const rec = list[idx];
  const pathsForType = t === 'series' ? seriesPaths : moviesPaths;

  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  try {
    if (a === 'pause') {
      qbSession = await createQbSession({ ssh, port, settings });
      if (!rec?.qbHash) throw new Error('This item has not started downloading yet.');
      await qbCurl(ssh, {
        port,
        path: '/api/v2/torrents/pause',
        method: 'POST',
        form: { hashes: rec.qbHash },
        cookieJar: qbSession.cookieJar,
      });
      list[idx] = { ...rec, status: 'Queued' };
    } else if (a === 'resume') {
      qbSession = await createQbSession({ ssh, port, settings });
      if (!rec?.qbHash) throw new Error('This item has not started downloading yet.');
      await qbCurl(ssh, {
        port,
        path: '/api/v2/torrents/resume',
        method: 'POST',
        form: { hashes: rec.qbHash },
        cookieJar: qbSession.cookieJar,
      });
      list[idx] = { ...rec, status: 'Downloading' };
    } else if (a === 'delete') {
      const blockedReason = deleteBlockedReason(rec, t);
      if (blockedReason) throw new Error(blockedReason);
      qbSession = await createQbSession({ ssh, port, settings }).catch(() => null);
      const torrentInfo = rec?.qbHash
        ? await fetchTorrentInfoByHash({
            ssh,
            port,
            cookieJar: qbSession?.cookieJar || '',
            hash: rec.qbHash,
          }).catch(() => null)
        : null;
      if (rec?.qbHash && qbSession?.cookieJar) {
        try {
          await qbCurl(ssh, {
            port,
            path: '/api/v2/torrents/delete',
            method: 'POST',
            form: { hashes: rec.qbHash, deleteFiles: 'true' },
            cookieJar: qbSession.cookieJar,
            timeoutMs: 60000,
          });
        } catch {}
      }
      const cleanup = deleteArtifacts
        ? await cleanupManagedDownloadArtifacts({
            ssh,
            rec,
            torrentInfo,
            pathsForType,
          })
        : { removedPaths: [], skippedPaths: [], removedFromFinalLibrary: false };
      const log = preserveSelectionLog
        ? null
        : await reconcileSelectionLogReplacement({
            logId: rec?.selectionLogId,
            removedTmdbId: Number(rec?.tmdb?.id || 0) || null,
            replacementItem: null,
          });
      if (deleteArtifacts && cleanup?.removedFromFinalLibrary) {
        await updateXuiScanState({
          [t === 'series' ? 'seriesScanPending' : 'moviesScanPending']: true,
        }).catch(() => null);
        await getOrRefreshLibraryInventory({ maxAgeMs: 0, force: true }).catch(() => null);
      }
      const nextItem = {
        ...rec,
        status: 'Deleted',
        cleanedAt: now(),
        error: '',
        deletedAt: now(),
        deletedReason: deleteArtifacts ? 'Deleted by admin.' : 'Torrent removed after release workflow cleanup.',
        deletedDetails: {
          action: 'delete',
          removedPaths: cleanup?.removedPaths || [],
          skippedPaths: cleanup?.skippedPaths || [],
        },
      };
      const latestDb = await getAdminDb();
      const latestList = Array.isArray(latestDb[key]) ? latestDb[key] : [];
      const latestIdx = latestList.findIndex((x) => String(x?.id) === String(id));
      if (latestIdx >= 0) latestList[latestIdx] = nextItem;
      else latestList.push(nextItem);
      latestDb[key] = latestList;
      await saveAdminDb(latestDb);
      return { item: nextItem, log };
    } else if (a === 'replace') {
      const blockedReason = replaceBlockedReason(rec, t);
      if (blockedReason) throw new Error(blockedReason);
      const selectionLogId = String(rec?.selectionLogId || '').trim();
      if (!selectionLogId) {
        throw new Error(`This ${t === 'series' ? 'series title' : 'movie'} is not linked to a ${t === 'series' ? 'Series' : 'Movie'} Selection Log.`);
      }

      const { runSelectionJobForType } = await import('./selectionService');
      const replacement = await runSelectionJobForType({
        type: t,
        force: true,
        preserveLastRun: true,
        targetTotal: 1,
        triggerReason: 'admin_replace',
        selectionLogId,
        releaseDate: String(rec?.releaseDate || '').trim(),
        releaseTag: String(rec?.releaseTag || '').trim(),
        releaseTimezone: String(rec?.releaseTimezone || '').trim(),
        releaseDelayDays: rec?.releaseDelayDays,
      });
      const replacementItem = Array.isArray(replacement?.selected) ? replacement.selected[0] || null : null;
      if (!replacement?.ok || !replacementItem) {
        throw new Error(replacement?.error || `Unable to find a replacement ${mediaLabelForType(t)} right now.`);
      }

      qbSession = await createQbSession({ ssh, port, settings }).catch(() => null);
      const torrentInfo = rec?.qbHash
        ? await fetchTorrentInfoByHash({
            ssh,
            port,
            cookieJar: qbSession?.cookieJar || '',
            hash: rec.qbHash,
          }).catch(() => null)
        : null;
      if (rec?.qbHash && qbSession?.cookieJar) {
        try {
          await qbCurl(ssh, {
            port,
            path: '/api/v2/torrents/delete',
            method: 'POST',
            form: { hashes: rec.qbHash, deleteFiles: 'true' },
            cookieJar: qbSession.cookieJar,
            timeoutMs: 60000,
          });
        } catch {}
      }
      const cleanup = await cleanupManagedDownloadArtifacts({
        ssh,
        rec,
        torrentInfo,
        pathsForType,
      });
      const log = await reconcileSelectionLogReplacement({
        logId: selectionLogId,
        removedTmdbId: Number(rec?.tmdb?.id || 0) || null,
        replacementItem,
      });
      if (cleanup?.removedFromFinalLibrary) {
        await updateXuiScanState({
          [t === 'series' ? 'seriesScanPending' : 'moviesScanPending']: true,
        }).catch(() => null);
        await getOrRefreshLibraryInventory({ maxAgeMs: 0, force: true }).catch(() => null);
      }
      const nextItem = {
        ...rec,
        status: 'Deleted',
        cleanedAt: now(),
        error: '',
        deletedAt: now(),
        deletedReason: `Replaced by admin with ${String(replacementItem?.title || `another ${t === 'series' ? 'series title' : 'movie'}`).trim()}.`,
        deletedDetails: {
          action: 'replace',
          replacementTmdbId: Number(replacementItem?.tmdbId || replacementItem?.id || 0) || null,
          replacementTitle: String(replacementItem?.title || '').trim(),
          removedPaths: cleanup?.removedPaths || [],
          skippedPaths: cleanup?.skippedPaths || [],
        },
      };
      const latestDb = await getAdminDb();
      const latestList = Array.isArray(latestDb[key]) ? latestDb[key] : [];
      const latestIdx = latestList.findIndex((x) => String(x?.id) === String(id));
      if (latestIdx >= 0) latestList[latestIdx] = nextItem;
      else latestList.push(nextItem);
      latestDb[key] = latestList;
      await saveAdminDb(latestDb);
      await startQueuedDownloads({
        type: t,
        limitPerType: 1,
        limitByType: t === 'series' ? { movie: 0, series: 1 } : { movie: 1, series: 0 },
      }).catch(() => null);

      const latestDbAfterDispatch = await getAdminDb();
      const latestListAfterDispatch = Array.isArray(latestDbAfterDispatch[key]) ? latestDbAfterDispatch[key] : [];
      const replacementTmdbId = Number(replacementItem?.tmdbId || replacementItem?.id || 0) || 0;
      const replacementRow =
        latestListAfterDispatch.find(
          (row) =>
            String(row?.selectionLogId || '').trim() === selectionLogId &&
            Number(row?.tmdb?.id || 0) === replacementTmdbId &&
            String(row?.status || '').toLowerCase() !== 'deleted'
        ) || null;
      return { item: nextItem, replacement: replacementRow, log };
    } else if (a === 'retry') {
      qbSession = await createQbSession({ ssh, port, settings });
      // Reset the record to queued, optionally re-adding if a URL exists.
      const base = {
        ...rec,
        status: 'Queued',
        progress: 0,
        completedAt: null,
        cleanedAt: null,
        error: '',
      };

      if (!rec?.url) {
        list[idx] = base;
      } else {
        // Add torrent again (best-effort) and attach latest hash.
        const savepath =
          String(rec.savePath || '').trim() ||
          (t === 'series'
            ? buildLibraryPaths({ mountDir, type: 'series', settings }).downloadingDir
            : buildLibraryPaths({ mountDir, type: 'movie', settings }).downloadingDir);
        const category = String(rec.category || (t === 'series' ? 'Series' : 'Movies'));
        const fallbackCategory = t === 'series' ? 'SERIES_AUTO' : 'MOVIE_AUTO';
        const nextCategory = category === 'Series' || category === 'Movies' ? fallbackCategory : category;

        const addResult = await addTorrentAndFindMatch({
          ssh,
          port,
          qbSession,
          candidateLinks: buildSourceLinkCandidates(rec?.source, rec?.url),
          savepath,
          category: nextCategory,
          selectedHash: String(rec?.source?.hash || '').trim().toUpperCase(),
          title: rec?.title || '',
          strictHash: Boolean(String(rec?.source?.hash || '').trim()),
        });
        const top = addResult.top;

        list[idx] = {
          ...base,
          url: addResult.usedLink,
          savePath: savepath,
          sourceCleanupPath: buildManagedSourcePath(savepath, top?.name || rec.qbName || ''),
          category: nextCategory,
          qbHash: top?.hash || null,
          qbName: top?.name || rec.qbName || null,
          progress: Number(top?.progress || 0),
          sizeBytes: Number(top?.size || 0) || rec.sizeBytes || null,
          status: top?.hash ? statusFromTorrent(top) : 'Queued',
          addedAt: now(),
        };
      }
    } else {
      throw new Error('Unsupported action.');
    }

    db[key] = list;
    await saveAdminDb(db);
    return { item: list[idx] };
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

export async function runTimeoutChecker() {
  const { engineHost, port, settings } = await ensurePrereqs();
  const tc = settings?.timeoutChecker || {};
  if (tc.enabled === false) return { ok: true, skipped: true };
  const mountStatus = await fetchMountStatus().catch(() => null);
  if (!mountStatus?.ok) {
    return {
      ok: true,
      skipped: true,
      reason: 'mount_not_ready',
      deleted: 0,
      timedOut: [],
      error: mountStatus?.error || 'NAS not mounted/writable.',
    };
  }
  const maxWaitHours = Number(tc.maxWaitHours ?? 6) || 6;
  const cutoffMs = maxWaitHours * 60 * 60 * 1000;

  const db = await getAdminDb();
  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  try {
    qbSession = await createQbSession({ ssh, port, settings });
    const types = ['downloadsMovies', 'downloadsSeries'];
    let deleted = 0;
    const timedOut = [];
    for (const key of types) {
      const list = Array.isArray(db[key]) ? db[key] : [];
      const latestActiveIndexByHash = new Map();
      for (let i = 0; i < list.length; i++) {
        const row = list[i];
        const hash = String(row?.qbHash || '').trim();
        if (!hash) continue;
        const status = String(row?.status || '').toLowerCase();
        if (['completed', 'processing', 'cleaned', 'deleted'].includes(status)) continue;
        const existingIndex = latestActiveIndexByHash.get(hash);
        if (existingIndex === undefined) {
          latestActiveIndexByHash.set(hash, i);
          continue;
        }
        const existingAddedAt = Number(list[existingIndex]?.addedAt || 0);
        const currentAddedAt = Number(row?.addedAt || 0);
        if (currentAddedAt >= existingAddedAt) {
          latestActiveIndexByHash.set(hash, i);
        }
      }
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        const st = String(rec?.status || '').toLowerCase();
        const recHash = String(rec?.qbHash || '').trim();
        if (!recHash) continue;
        if (['completed', 'processing', 'cleaned', 'deleted'].includes(st)) continue;
        const latestIndex = latestActiveIndexByHash.get(recHash);
        if (latestIndex !== undefined && latestIndex !== i) {
          list[i] = {
            ...rec,
            status: 'Deleted',
            cleanedAt: now(),
            error: rec?.error || 'Superseded by newer queue item with the same torrent hash.',
            releaseState: rec?.releaseState === 'released' ? 'released' : 'superseded',
            supersededAt: now(),
          };
          continue;
        }
        const age = now() - Number(rec.addedAt || 0);
        if (age <= cutoffMs) continue;

        try {
          await qbCurl(ssh, {
            port,
            path: '/api/v2/torrents/delete',
            method: 'POST',
            form: { hashes: recHash, deleteFiles: 'true' },
            cookieJar: qbSession.cookieJar,
            timeoutMs: 60000,
          });
        } catch {}

        list[i] = {
          ...rec,
          status: 'Deleted',
          cleanedAt: now(),
          error: 'Timeout',
          releaseState: rec?.releaseState === 'released' ? 'released' : 'timed_out',
          timedOutAt: now(),
        };
        timedOut.push({
          id: String(rec?.id || ''),
          type: key === 'downloadsSeries' ? 'series' : 'movie',
          tmdbId: Number(rec?.tmdb?.id || 0) || null,
          title: String(rec?.title || rec?.tmdb?.title || '').trim(),
          selectionLogId: rec?.selectionLogId ? String(rec.selectionLogId) : null,
          releaseDate: String(rec?.releaseDate || '').trim(),
          releaseTag: String(rec?.releaseTag || '').trim(),
        });
        deleted++;
      }
      db[key] = list;
    }
    await saveAdminDb(db);
    return { ok: true, deleted, timedOut };
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

function isSubPath(pathValue, rootValue) {
  const p = normalizeDirPath(pathValue);
  const r = normalizeDirPath(rootValue);
  if (!p || !r) return false;
  return p === r || p.startsWith(`${r}/`);
}

export async function deleteSeriesPartialsForSelectionLog({
  selectionLogId,
  reason = 'Series replacement failed across all sources. Partial series data removed.',
} = {}) {
  const logId = String(selectionLogId || '').trim();
  if (!logId) return { ok: true, skipped: true, reason: 'missing_selection_log_id' };

  const { engineHost, port, settings, seriesPaths } = await ensurePrereqs();
  const db = await getAdminDb();
  const list = Array.isArray(db.downloadsSeries) ? db.downloadsSeries : [];
  const targetIndexes = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (String(row?.selectionLogId || '').trim() !== logId) continue;
    if (String(row?.releaseState || '').toLowerCase() === 'released') continue;
    if (String(row?.status || '').toLowerCase() === 'deleted') continue;
    targetIndexes.push(i);
  }
  if (!targetIndexes.length) return { ok: true, skipped: true, reason: 'no_partial_rows' };

  const stageRoot = normalizeDirPath(seriesPaths?.stageRoot || '');
  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  let removedTorrents = 0;
  let removedHoldDirs = 0;
  try {
    qbSession = await createQbSession({ ssh, port, settings }).catch(() => null);

    for (const idx of targetIndexes) {
      const row = list[idx];
      const qbHash = String(row?.qbHash || '').trim();
      if (qbHash && qbSession?.cookieJar) {
        try {
          await qbCurl(ssh, {
            port,
            path: '/api/v2/torrents/delete',
            method: 'POST',
            form: { hashes: qbHash, deleteFiles: 'true' },
            cookieJar: qbSession.cookieJar,
            timeoutMs: 60000,
          });
          removedTorrents += 1;
        } catch {}
      }

      const holdDir = String(row?.holdDir || row?.finalDir || '').trim();
      if (holdDir && stageRoot && isSubPath(holdDir, stageRoot)) {
        try {
          await ssh.exec(`rm -rf -- ${shQuote(holdDir)}`, { sudo: true, timeoutMs: 60000 });
          removedHoldDirs += 1;
        } catch {}
      }

      list[idx] = {
        ...row,
        status: 'Deleted',
        cleanedAt: now(),
        releaseState: row?.releaseState === 'released' ? 'released' : 'replacement_failed',
        replacementFailedAt: now(),
        error: reason,
      };
    }

    db.downloadsSeries = list;
    const logs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
    const logIdx = logs.findIndex((x) => String(x?.id || '').trim() === logId);
    if (logIdx >= 0) {
      logs[logIdx] = {
        ...logs[logIdx],
        replacementFailure: {
          ...(logs[logIdx]?.replacementFailure || {}),
          series: {
            selectionLogId: logId,
            reason,
            affectedItems: targetIndexes.length,
            at: now(),
          },
        },
      };
      db.selectionLogs = logs;
    }
    await saveAdminDb(db);
    return {
      ok: true,
      selectionLogId: logId,
      affectedItems: targetIndexes.length,
      removedTorrents,
      removedHoldDirs,
    };
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}
