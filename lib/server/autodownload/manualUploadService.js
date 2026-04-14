import 'server-only';

import crypto from 'node:crypto';
import { Readable } from 'node:stream';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from './autodownloadDb';
import { buildManualUploadPaths, getManualUploadFolderConfig } from './libraryFolders';
import { buildReleaseTagFromDateKey, computeReleaseMeta, dateKeyInTimezone, normalizeReleaseDelayDays, normalizeReleaseTimezone } from './releaseSchedule';
import { SSHService } from './sshService';
import { getTmdbDetailsById, resolveTmdbTitle } from './tmdbService';
import { processOneCompleted } from './processingService';
import { releaseDueSelections } from './releaseService';

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
  const destRoot = String(paths?.incomingDir || '').trim();
  if (!destRoot) throw new Error('Manual Upload Incoming folder is not configured.');

  const folderSafe = sanitizeFsName(folderLabel || `Manual Upload ${uploadId}`);
  const destDir = `${destRoot}/${folderSafe}-${String(uploadId).slice(0, 8)}`;

  const tmpRoot = `/tmp/3j-tv-manual-upload/${sanitizeFsName(uploadId)}`;
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
  await ssh.exec(`mv -f -- ${shQuote(tmpRoot)}/* ${shQuote(destDir)}/ 2>/dev/null || true`, { timeoutMs: 120000, sudo: true });
  await ssh.exec(`rm -rf -- ${shQuote(tmpRoot)} 2>/dev/null || true`, { timeoutMs: 30000, sudo: true });

  return { ok: true, destDir, uploaded };
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

function buildManualDownloadRecord({ type, tmdb, selectionLogId, releaseMeta, uploadDir, actor = '' } = {}) {
  const t = sanitizeType(type);
  const ts = now();
  const cleanTitle = String(tmdb?.title || '').trim();
  const cleanYear = String(tmdb?.year || '').trim();
  const recordId = crypto.randomUUID();
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
    status: 'Completed',
    progress: 1,
    sizeBytes: null,
    addedAt: ts,
    completedAt: ts,
    cleanedAt: null,
    error: '',
    savePath: null,
    downloadPath: String(uploadDir || '').trim(),
    sourceCleanupPath: String(uploadDir || '').trim(),
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
    releaseState: 'waiting',
    releasedAt: null,
    holdDir: null,
    finalTargetDir: null,
    manualUpload: true,
    manualUploadedAt: ts,
    manualUploadedBy: String(actor || '').trim() || null,
  };
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

export async function listManualUploads({ type = 'movie', limit = 50 } = {}) {
  const t = sanitizeType(type);
  const max = Math.max(1, Math.min(200, Math.floor(Number(limit || 50) || 50)));
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

  const items = rows
    .filter((row) => row?.manualUpload === true && String(row?.status || '').toLowerCase() !== 'deleted')
    .slice(0, max)
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
  return { ok: true, items };
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
  seriesProcessing = 'Processing',
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
    },
    series: {
      ...(current.series && typeof current.series === 'object' ? current.series : {}),
      processing: normalizeFolderName(seriesProcessing, 'Processing'),
    },
  };

  db.autodownloadSettings.manualUploadFolders = next;
  await saveAdminDb(db);
  return { ok: true, manualUploadFolders: next };
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
    tmdb = await getTmdbDetailsById({
      mediaType: tmdbPickedType === 'tv' || tmdbPickedType === 'series' ? 'tv' : 'movie',
      id: tmdbPickedId,
    });
  } else {
    tmdb = await resolveTmdbTitle({ kind: t, title: cleanTitle, year: cleanYear });
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

  const selectionLog = buildSelectionLog({ selectionType: t, releaseMeta, tmdb, actor });
  const uploadId = crypto.randomUUID();
  const folderLabel = `${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}`;

  const ssh = sshFromEngineHost(engineHost);
  try {
    const uploaded = await uploadFilesToEngine({
      ssh,
      type: t,
      mountDir: mount.mountDir,
      settings,
      uploadId,
      folderLabel,
      files: fileList,
      filePaths,
    });

    const record = buildManualDownloadRecord({
      type: t,
      tmdb,
      selectionLogId: selectionLog.id,
      releaseMeta,
      uploadDir: uploaded.destDir,
      actor,
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

    let processed = null;
    if (processNow) {
      processed = await processOneCompleted({ type: t, id: record.id });
    }

    const dbAfter = await getAdminDb();
    const processingLogs = Array.isArray(dbAfter.processingLogs) ? dbAfter.processingLogs : [];
    const latestProcessingLog =
      processingLogs
        .filter((log) => String(log?.downloadId || '').trim() === String(record.id))
        .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0))[0] || null;

    let released = null;
    if (releaseNow) {
      released = await manualReleaseNow({ type: t, id: record.id, actor });
    }

    return {
      ok: true,
      item: record,
      uploaded,
      processed,
      processingLog: latestProcessingLog
        ? {
            id: String(latestProcessingLog?.id || ''),
            createdAt: Number(latestProcessingLog?.createdAt || 0) || null,
            status: String(latestProcessingLog?.status || '').trim(),
            error: String(latestProcessingLog?.error || '').trim() || null,
            summary: latestProcessingLog?.summary && typeof latestProcessingLog.summary === 'object' ? latestProcessingLog.summary : null,
          }
        : null,
      released,
    };
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
