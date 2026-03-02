import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { getEngineHost, getMountSettings, getAutodownloadSettings } from './autodownloadDb';
import { SSHService } from './sshService';
import { getTmdbDetailsById } from './tmdbService';
import { buildLibraryPaths } from './libraryFolders';
import { searchBestDownloadSource } from './sourceProvidersService';
import { getOrRefreshLibraryInventory, hasInventoryMatch } from './libraryInventoryService';

function now() {
  return Date.now();
}

const SOURCE_RETRY_MINUTES = 10;

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

function normalizeHash(value) {
  return String(value || '').trim().toUpperCase();
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
  const storageLimitPercent = Number(settings?.storage?.limitPercent ?? settings?.storageLimitPercent ?? 95) || 95;
  const mountDir = String(mount.mountDir);
  const moviesPaths = buildLibraryPaths({ mountDir, type: 'movie', settings });
  const seriesPaths = buildLibraryPaths({ mountDir, type: 'series', settings });
  return { engineHost, mountDir, port, storageLimitPercent, settings, moviesPaths, seriesPaths };
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
  const query = String(tmdb?.title || rec?.title || '').trim();
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
  const maxSizeRaw = t === 'series' ? sizeLimits?.maxEpisodeGb : sizeLimits?.maxMovieGb;

  const minSeeders = Math.max(0, Math.floor(toFiniteNumber(minSeedersRaw, 1) ?? 1));
  const maxSizeGb = toFiniteNumber(maxSizeRaw, null);
  return {
    minSeeders,
    maxSizeGb: maxSizeGb !== null && maxSizeGb > 0 ? maxSizeGb : null,
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

export async function addDownload({ type, url, title = '', plannedSizeBytes = null, paused = false } = {}) {
  const t = sanitizeType(type);
  const u = String(url || '').trim();
  if (!u) throw new Error('Torrent/magnet URL is required.');

  const { engineHost, port, mountDir, storageLimitPercent, settings, moviesPaths, seriesPaths } = await ensurePrereqs();

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
        const currentPct = (used / total) * 100;
        if (currentPct >= storageLimitPercent) {
          throw new Error(`Storage limit reached (${Math.round(currentPct)}% used).`);
        }
        if (record.sizeBytes && record.sizeBytes > 0) {
          const futurePct = ((used + record.sizeBytes) / total) * 100;
          if (futurePct > storageLimitPercent) {
            throw new Error(
              `Storage guardrail: would exceed ${storageLimitPercent}% (projected ${Math.round(futurePct)}%).`
            );
          }
        }
      }
    }

    qbSession = await createQbSession({ ssh, port, settings });

    // Add torrent (paused optional)
    const addResp = await qbCurl(ssh, {
      port,
      path: '/api/v2/torrents/add',
      method: 'POST',
      form: {
        urls: u,
        savepath,
        category,
        paused: paused ? 'true' : 'false',
      },
      multipart: true,
      cookieJar: qbSession.cookieJar,
      timeoutMs: 45000,
    });
    ensureQbAddAccepted(addResp, 'add torrent');

    // Best-effort: find the torrent hash by listing recent items and matching name/url.
    const infoText = await qbCurl(ssh, {
      port,
      path: '/api/v2/torrents/info',
      method: 'GET',
      cookieJar: qbSession.cookieJar,
      timeoutMs: 45000,
    });
    const arr = parseQbArray(infoText, 'qBittorrent torrents/info');

    // Try match by save_path + newest added.
    const top = pickTorrentMatch({ torrents: arr, preferredPath: savepath, title: record.title });
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
} = {}) {
  const t = sanitizeType(type);
  const id = Number(tmdbId || 0);
  if (!Number.isFinite(id) || id <= 0) throw new Error('TMDB id is required.');

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
          name: String(preselectedSource?.name || '').trim(),
          seeders: Number(preselectedSource?.seeders || 0) || 0,
          quality: String(preselectedSource?.quality || '').trim(),
          sizeGb: preselectedSource?.sizeGb ?? null,
          hash: String(preselectedSource?.hash || '').trim(),
          sourceUrl: String(preselectedSource?.sourceUrl || '').trim(),
          magnet: String(preselectedSource?.magnet || '').trim(),
          domainUsed: String(preselectedSource?.domainUsed || '').trim(),
          fetchedAt: Number(preselectedSource?.fetchedAt || now()),
          attempts: Array.isArray(sourceAttemptsLog) ? sourceAttemptsLog : [],
        }
      : null;

  const initialUrl = String(pickedSource?.sourceUrl || pickedSource?.magnet || '').trim();

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
      originalLanguage: details.originalLanguage || '',
      genres: details.genres,
      rating: details.rating,
      runtime: details.runtime,
      overview: details.overview,
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
    category: null,
    source: pickedSource,
    sourceAttempts: pickedSource ? 1 : 0,
    sourceLastAttemptAt: pickedSource ? Number(sourceLastAttemptAt || now()) : null,
    nextSourceRetryAt: null,
  };

  const db = await getAdminDb();
  const key = dbKeyForType(t);
  db[key] = Array.isArray(db[key]) ? db[key] : [];

  const dup = db[key].find((x) => Number(x?.tmdb?.id || 0) === details.id && String(x?.status || '').toLowerCase() !== 'deleted');
  if (dup) throw new Error('This TMDB item is already in the active queue.');

  db[key].unshift(record);
  db[key] = db[key].slice(0, 5000);
  await saveAdminDb(db);
  return record;
}

export async function clearDownloadsForType({ type = 'movie', purgeNas = false } = {}) {
  const t = sanitizeType(type);
  const { engineHost, port, settings, moviesPaths, seriesPaths } = await ensurePrereqs();

  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const rows = Array.isArray(db[key]) ? db[key] : [];
  const titleNeedles = rows
    .map((x) => String(x?.title || x?.qbName || '').trim().toLowerCase())
    .filter(Boolean);
  const hashes = new Set(rows.map((x) => String(x?.qbHash || '').trim()).filter(Boolean));

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

    const desiredRoots =
      t === 'series'
        ? [normalizeDirPath(seriesPaths.downloadingDir), normalizeDirPath(seriesPaths.downloadedDir)]
        : [normalizeDirPath(moviesPaths.downloadingDir), normalizeDirPath(moviesPaths.downloadedDir)];

    for (const tor of Array.isArray(torrents) ? torrents : []) {
      const hash = String(tor?.hash || '').trim();
      if (!hash) continue;
      const cat = String(tor?.category || '').trim().toUpperCase();
      const savePath = normalizeDirPath(tor?.save_path || '');
      const name = String(tor?.name || '').toLowerCase();
      const inDesiredRoot = desiredRoots.some((root) => root && savePath.startsWith(root));
      const nameLooksManaged = titleNeedles.some((needle) => needle && name.includes(needle));
      if (cat === desiredCategory || inDesiredRoot || nameLooksManaged) {
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

export async function startQueuedDownloads({ type = 'all', limitPerType = 1, limitByType = null } = {}) {
  const { engineHost, port, settings, moviesPaths, seriesPaths } = await ensurePrereqs();
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
      const candidates = list.filter((rec) => shouldAutoStartQueuedRecord(rec, startedAt));
      let startedForType = 0;

      for (const rec of candidates) {
        if (startedForType >= perTypeLimit) break;

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

        const correlationId = `queue-${t}-${rec.id}-${now()}`;
        const queuedUrl = String(rec?.url || '').trim();
        let sourceResult = null;
        let selected = sourceRecordMatchesPolicy(rec, sourcePolicy) ? rec.source : null;
        let sourceLink = queuedUrl;

        // Old YTS rows may contain trackerless magnets from earlier builds.
        // Force a fresh source lookup so we can switch to a .torrent URL (or enriched magnet).
        const isTrackerlessMagnet = /^magnet:\?/i.test(sourceLink) && !/[?&]tr=/i.test(sourceLink);
        if (isTrackerlessMagnet && String(rec?.source?.provider || '').trim().toLowerCase() === 'yts') {
          selected = null;
          sourceLink = '';
        }

        if (sourceLink && !selected) {
          sourceLink = '';
        }

        if (!sourceLink && selected) {
          sourceLink = String(selected?.sourceUrl || selected?.magnet || '').trim();
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
              correlationId,
              jobId: rec.id,
              stopOnFirstValid: true,
              minSeeders: sourcePolicy.minSeeders,
              maxSizeGb: sourcePolicy.maxSizeGb,
            });
          } catch (e) {
            sourceResult = { ok: false, error: e?.message || 'Source search failed.' };
          }

          selected = sourceResult?.selected || selected;
          if (selected && !sourceCandidateMatchesPolicy(selected, sourcePolicy)) {
            sourceResult = {
              ...(sourceResult || {}),
              ok: false,
              error: `Filtered by source policy (min seeders ${sourcePolicy.minSeeders}${
                sourcePolicy.maxSizeGb !== null ? `, max size ${sourcePolicy.maxSizeGb} GB` : ''
              }).`,
            };
            selected = null;
          }
          sourceLink = String(selected?.sourceUrl || selected?.magnet || '').trim();
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
          const addResp = await qbCurl(ssh, {
            port,
            path: '/api/v2/torrents/add',
            method: 'POST',
            form: {
              urls: sourceLink,
              savepath,
              category,
              paused: 'false',
            },
            multipart: true,
            cookieJar: qbSession.cookieJar,
            timeoutMs: 45000,
          });
          ensureQbAddAccepted(addResp, 'add torrent');

          const selectedHash = String(selected?.hash || '').trim().toUpperCase();
          let top = null;
          for (let probe = 0; probe < 8 && !top; probe++) {
            if (probe > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
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
              title: rec?.title || '',
              strictHash: Boolean(selectedHash),
            });
          }

          if (!top?.hash) {
            throw new Error('qBittorrent accepted add but torrent did not appear in torrents/info.');
          }

          const topSizeBytes = Number(top?.size || 0) || 0;
          const maxAllowedBytes = bytesFromGb(sourcePolicy.maxSizeGb);
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
              sourcePolicy.maxSizeGb || 0
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
              status: statusFromTorrent(top),
              progress: Number(top?.progress || 0) || 0,
              sizeBytes: Number(top?.size || cur?.sizeBytes || 0) || cur?.sizeBytes || null,
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
    const infoText = await qbCurl(ssh, {
      port,
      path: '/api/v2/torrents/info',
      method: 'GET',
      cookieJar: qbSession.cookieJar,
      timeoutMs: 60000,
    });
    const torrents = parseQbArray(infoText, 'qBittorrent torrents/info');

    const byHash = new Map((Array.isArray(torrents) ? torrents : []).filter((t) => t?.hash).map((t) => [t.hash, t]));
    const db = await getAdminDb();

    const types = type === 'all' ? ['movie', 'series'] : [sanitizeType(type)];
    for (const t of types) {
      const sourcePolicy = sourcePolicyForType(settings, t);
      const maxAllowedBytes = bytesFromGb(sourcePolicy.maxSizeGb);
      const key = dbKeyForType(t);
      const list = Array.isArray(db[key]) ? db[key] : [];
      const desiredDownloaded = t === 'series' ? seriesPaths.downloadedDir : moviesPaths.downloadedDir;
      const desiredDownloading = t === 'series' ? seriesPaths.downloadingDir : moviesPaths.downloadingDir;
      const desiredCategory = t === 'series' ? 'SERIES_AUTO' : 'MOVIE_AUTO';

      const nextList = [];
      for (const rec of list) {
        if (!rec?.qbHash) {
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
                progress: Number(matched.progress || 0),
                sizeBytes: Number(matched.size || 0) || rec.sizeBytes,
                status: rec.status === 'Processing' || rec.status === 'Cleaned' ? rec.status : st,
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
        const tor = byHash.get(rec.qbHash);
        if (!tor) {
          nextList.push(rec);
          continue;
        }
        const torSizeBytes = Number(tor?.size || rec?.sizeBytes || 0) || 0;
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
              sourcePolicy.maxSizeGb || 0
            )} GB).`,
            sourceLastAttemptAt: now(),
            sourceAttempts: Number(rec?.sourceAttempts || 0) + 1,
            nextSourceRetryAt: retryAt,
          });
          continue;
        }
        const st = statusFromTorrent(tor);
        let next = {
          ...rec,
          qbName: tor.name || rec.qbName || null,
          progress: Number(tor.progress || 0),
          sizeBytes: Number(tor.size || 0) || rec.sizeBytes,
          status: rec.status === 'Processing' || rec.status === 'Cleaned' ? rec.status : st,
          completedAt:
            rec.completedAt ||
            (Number(tor.progress || 0) >= 1 ? (Number(tor.completion_on || 0) ? tor.completion_on * 1000 : now()) : null),
          error: st === 'Failed' ? String(tor?.state || 'error') : '',
        };
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
        nextList.push(next);
      }
      db[key] = nextList;
    }

    await saveAdminDb(db);
    return { ok: true, torrents: Array.isArray(torrents) ? torrents.length : 0 };
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

export async function controlDownload({ type, id, action }) {
  const t = sanitizeType(type);
  const a = String(action || '').toLowerCase();
  if (!id) throw new Error('id is required.');

  const { engineHost, port, mountDir, settings } = await ensurePrereqs();
  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const list = Array.isArray(db[key]) ? db[key] : [];
  const idx = list.findIndex((x) => String(x?.id) === String(id));
  if (idx < 0) throw new Error('Download not found.');
  const rec = list[idx];

  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  try {
    qbSession = await createQbSession({ ssh, port, settings });

    if (a === 'pause') {
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
      if (rec?.qbHash) {
        await qbCurl(ssh, {
          port,
          path: '/api/v2/torrents/delete',
          method: 'POST',
          form: { hashes: rec.qbHash, deleteFiles: 'true' },
          cookieJar: qbSession.cookieJar,
          timeoutMs: 60000,
        });
      }
      list[idx] = { ...rec, status: 'Deleted', cleanedAt: now(), error: '' };
    } else if (a === 'retry') {
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

        const addResp = await qbCurl(ssh, {
          port,
          path: '/api/v2/torrents/add',
          method: 'POST',
          form: {
            urls: String(rec.url),
            savepath,
            category: nextCategory,
            paused: 'false',
          },
          multipart: true,
          cookieJar: qbSession.cookieJar,
          timeoutMs: 45000,
        });
        ensureQbAddAccepted(addResp, 'retry add torrent');

        const infoText = await qbCurl(ssh, {
          port,
          path: '/api/v2/torrents/info',
          method: 'GET',
          cookieJar: qbSession.cookieJar,
          timeoutMs: 45000,
        });
        const arr = parseQbArray(infoText, 'qBittorrent torrents/info');
        const top = pickTorrentMatch({ torrents: arr, preferredPath: savepath, title: rec?.title || '' });

        list[idx] = {
          ...base,
          savePath: savepath,
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
    return list[idx];
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}

export async function runTimeoutChecker() {
  const { engineHost, port, settings } = await ensurePrereqs();
  const tc = settings?.timeoutChecker || {};
  if (tc.enabled === false) return { ok: true, skipped: true };
  const maxWaitHours = Number(tc.maxWaitHours ?? 6) || 6;
  const cutoffMs = maxWaitHours * 60 * 60 * 1000;

  const db = await getAdminDb();
  const ssh = sshFromEngineHost(engineHost);
  let qbSession = null;
  try {
    qbSession = await createQbSession({ ssh, port, settings });
    const types = ['downloadsMovies', 'downloadsSeries'];
    let deleted = 0;
    for (const key of types) {
      const list = Array.isArray(db[key]) ? db[key] : [];
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        const st = String(rec?.status || '').toLowerCase();
        if (!rec?.qbHash) continue;
        if (['completed', 'processing', 'cleaned', 'deleted'].includes(st)) continue;
        const age = now() - Number(rec.addedAt || 0);
        if (age <= cutoffMs) continue;

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

        list[i] = {
          ...rec,
          status: 'Deleted',
          cleanedAt: now(),
          error: 'Timeout',
        };
        deleted++;
      }
      db[key] = list;
    }
    await saveAdminDb(db);
    return { ok: true, deleted };
  } finally {
    await destroyQbSession(ssh, qbSession);
    await ssh.close();
  }
}
