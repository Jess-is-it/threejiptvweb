import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { resolveTmdbTitle } from './tmdbService';
import { appendProcessingLog } from './autodownloadDb';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from './autodownloadDb';
import { SSHService } from './sshService';
import { buildLibraryPaths } from './libraryFolders';
import { buildReleaseTagFromDateKey, computeReleaseMeta, normalizeReleaseDelayDays, normalizeReleaseTimezone } from './releaseSchedule';
import { sourceMatchesRequestedMedia } from './sourceProvidersService';

function now() {
  return Date.now();
}

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

function normalizeHash(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeYear(value) {
  return String(value || '')
    .trim()
    .slice(0, 4);
}

function sameMediaIdentity(a, b) {
  const aHash = normalizeHash(a?.qbHash);
  const bHash = normalizeHash(b?.qbHash);
  if (aHash && bHash && aHash === bHash) return true;

  const aSourceHash = normalizeHash(a?.source?.hash);
  const bSourceHash = normalizeHash(b?.source?.hash);
  if (aSourceHash && bSourceHash && aSourceHash === bSourceHash) return true;

  const aTmdb = Number(a?.tmdb?.id || a?.tmdbId || 0);
  const bTmdb = Number(b?.tmdb?.id || b?.tmdbId || 0);
  if (aTmdb > 0 && bTmdb > 0 && aTmdb === bTmdb) return true;

  const aTitle = normalizeMatchText(a?.title || a?.qbName || '');
  const bTitle = normalizeMatchText(b?.title || b?.qbName || '');
  const aYear = normalizeYear(a?.year || a?.tmdb?.year || '');
  const bYear = normalizeYear(b?.year || b?.tmdb?.year || '');
  return Boolean(aTitle && bTitle && aYear && bYear && aTitle === bTitle && aYear === bYear);
}

function findSupersedingItem(list, rec) {
  const rows = Array.isArray(list) ? list : [];
  for (const row of rows) {
    if (!row || String(row?.id || '') === String(rec?.id || '')) continue;
    const statusLower = String(row?.status || '').toLowerCase();
    if (statusLower !== 'cleaned' && statusLower !== 'released') continue;
    if (sameMediaIdentity(row, rec)) return row;
  }
  return null;
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

const DEFAULT_CLEANING_TEMPLATES = {
  movieFolder: '{title} ({year})-{quality}',
  movieFile: '{title} ({year})-{quality}',
  movieSubtitle: '{title} ({year})-{quality}.{lang}',
  seriesFolder: '{title} ({year})',
  seriesSeasonFolder: 'Season {season}',
  seriesEpisode: '{title} - S{season}E{episode}',
  seriesSubtitle: '{title} - S{season}E{episode}.{lang}',
};
const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'sub', 'vtt'];
const DEFAULT_KEEP_SUB_LANGUAGES = ['en', 'tl'];
const DEFAULT_LANGUAGE_PATTERNS = {
  en: '(eng|english|en)',
  tl: '(tag|fil|filipino|tl|tagalog)',
};

function normalizeTemplateValue(value, fallback) {
  const s = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (s || fallback).slice(0, 180);
}

function normalizeList(values, fallback = []) {
  const list = Array.isArray(values) ? values : fallback;
  return list
    .map((value) => String(value || '').trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);
}

function normalizePatterns(raw, fallback = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [lang, expr] of Object.entries({ ...fallback, ...src })) {
    const key = String(lang || '').trim().toLowerCase();
    const value = String(expr || '').trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function getCleaningTemplates(settings) {
  const t = settings?.cleaning?.templates || {};
  return {
    movieFolder: normalizeTemplateValue(t?.movieFolder, DEFAULT_CLEANING_TEMPLATES.movieFolder),
    movieFile: normalizeTemplateValue(t?.movieFile, DEFAULT_CLEANING_TEMPLATES.movieFile),
    movieSubtitle: normalizeTemplateValue(t?.movieSubtitle, DEFAULT_CLEANING_TEMPLATES.movieSubtitle),
    seriesFolder: normalizeTemplateValue(t?.seriesFolder, DEFAULT_CLEANING_TEMPLATES.seriesFolder),
    seriesSeasonFolder: normalizeTemplateValue(t?.seriesSeasonFolder, DEFAULT_CLEANING_TEMPLATES.seriesSeasonFolder),
    seriesEpisode: normalizeTemplateValue(t?.seriesEpisode, DEFAULT_CLEANING_TEMPLATES.seriesEpisode),
    seriesSubtitle: normalizeTemplateValue(t?.seriesSubtitle, DEFAULT_CLEANING_TEMPLATES.seriesSubtitle),
  };
}

function getProcessingFileRules(settings) {
  const fileRules = settings?.fileRules || {};
  return {
    videoExtensions: normalizeList(fileRules?.videoExtensions, ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm']),
    subtitleExtensions: normalizeList(fileRules?.subtitleExtensions, DEFAULT_SUBTITLE_EXTENSIONS),
    keepSubtitleLanguages: normalizeList(fileRules?.keepSubtitleLanguages, DEFAULT_KEEP_SUB_LANGUAGES),
    languagePatterns: normalizePatterns(fileRules?.languagePatterns, DEFAULT_LANGUAGE_PATTERNS),
  };
}

function normalizeTemplateTokenValue(value, { preserveBraces = false } = {}) {
  const cleaned = preserveBraces ? String(value ?? '').trim() : String(value ?? '').replace(/[{}]/g, '').trim();
  return sanitizeFsName(cleaned);
}

function applyNameTemplate(template, tokens = {}, { fallback = 'Untitled', keepUnknown = false, preservePlaceholders = false } = {}) {
  const tokenMap = Object.entries(tokens || {}).reduce((acc, [key, value]) => {
    acc[String(key || '').toLowerCase()] = String(value ?? '');
    return acc;
  }, {});

  const rawTemplate = normalizeTemplateValue(template, fallback);
  const rendered = rawTemplate.replace(/\{([a-z_]+)\}/gi, (m, tokenKey) => {
    const key = String(tokenKey || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(tokenMap, key)) return tokenMap[key];
    return keepUnknown ? m : '';
  });

  const collapsed = String(rendered || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/-+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .trim();

  const safe = normalizeTemplateTokenValue(collapsed, { preserveBraces: preservePlaceholders });
  return safe || normalizeTemplateTokenValue(fallback, { preserveBraces: preservePlaceholders });
}

function extractResolution(text) {
  const s = String(text || '').toLowerCase();
  const m = s.match(/\b(2160p|1080p|720p|480p|4k)\b/i);
  if (!m) return '';
  const v = String(m[1] || '').toLowerCase();
  return v === '4k' ? '2160p' : v;
}

function detectQualityMeta(rec) {
  const sourceQuality = String(rec?.source?.quality || '').trim();
  const candidates = [sourceQuality, rec?.qbName || '', rec?.title || ''];
  let resolution = '';
  for (const c of candidates) {
    const r = extractResolution(c);
    if (r) {
      resolution = r;
      break;
    }
  }
  const qualityRaw = sourceQuality || resolution || 'HD';
  const quality = normalizeTemplateTokenValue(qualityRaw.replace(/\s+/g, ' '));
  return {
    quality: quality || 'HD',
    resolution: normalizeTemplateTokenValue(resolution || quality || 'HD'),
  };
}

function dedupeFolderLabel(baseLabel, { list = [], releaseTag = '', recId = '' } = {}) {
  const fallbackBase = normalizeTemplateTokenValue(baseLabel || 'Untitled');
  const used = new Set();
  for (const row of Array.isArray(list) ? list : []) {
    if (!row || String(row?.id || '') === String(recId || '')) continue;
    const holdDir = String(row?.holdDir || '').trim();
    if (!holdDir) continue;
    const parts = holdDir.split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const tag = String(parts[parts.length - 2] || '');
    const label = String(parts[parts.length - 1] || '');
    if (!label) continue;
    if (releaseTag && tag && tag !== releaseTag) continue;
    used.add(label.toLowerCase());
  }

  if (!used.has(fallbackBase.toLowerCase())) return fallbackBase;
  let i = 2;
  while (i <= 999) {
    const candidate = `${fallbackBase} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
    i += 1;
  }
  return `${fallbackBase} (${String(recId || '').slice(0, 6) || 'copy'})`;
}

function guessTitleYear(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/\.[a-z0-9]{2,4}$/i, ''); // drop extension
  s = s.replace(/[._]/g, ' ');
  // strip bracketed tags
  s = s.replace(/\[[^\]]+\]/g, ' ').replace(/\([^\)]+\)/g, ' ');
  // common quality tags
  s = s.replace(/\b(480p|720p|1080p|2160p|4k|x264|x265|h264|h265|hevc|bluray|web[- ]?dl|webrip|hdr|dv)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  const m = s.match(/\b(19\d{2}|20\d{2})\b/);
  const year = m ? m[1] : '';
  const title = year ? s.replace(m[0], '').replace(/\s+/g, ' ').trim() : s;
  return { title: title || s, year };
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function qbGetProperties(ssh, { port, hash }) {
  const url = `http://127.0.0.1:${Number(port || 8080) || 8080}/api/v2/torrents/properties?hash=${encodeURIComponent(hash)}`;
  const cmd = `curl -fsS ${shQuote(url)}`;
  const r = await ssh.exec(cmd, { timeoutMs: 30000 });
  return JSON.parse(r.stdout || '{}');
}

async function qbDeleteTorrent(ssh, { port, hash, deleteFiles = false }) {
  const url = `http://127.0.0.1:${Number(port || 8080) || 8080}/api/v2/torrents/delete`;
  const cmd =
    `curl -fsS -X POST ` +
    `--data-urlencode ${shQuote(`hashes=${hash}`)} ` +
    `--data-urlencode ${shQuote(`deleteFiles=${deleteFiles ? 'true' : 'false'}`)} ` +
    `${shQuote(url)}`;
  await ssh.exec(cmd, { timeoutMs: 60000 });
  return true;
}

async function qbDeleteTorrentAndConfirm(ssh, { port, hash, deleteFiles = false, confirmMs = 5000 } = {}) {
  await qbDeleteTorrent(ssh, { port, hash, deleteFiles });
  const deadline = Date.now() + Math.max(1000, Number(confirmMs) || 5000);
  while (Date.now() <= deadline) {
    const stillPresent = await qbGetProperties(ssh, { port, hash })
      .then(() => true)
      .catch(() => false);
    if (!stillPresent) return true;
    await delay(750);
  }
  throw new Error('qBittorrent delete returned success but torrent is still present.');
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function pathJoin(base, name) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const n = String(name || '').trim().replace(/^\/+/, '');
  if (!b) return n;
  if (!n) return b;
  return `${b}/${n}`;
}

function basenamePath(pathValue) {
  const p = String(pathValue || '').trim().replace(/\/+$/, '');
  if (!p) return '';
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

function normalizeDirPath(pathValue) {
  return String(pathValue || '')
    .trim()
    .replace(/\/+$/, '');
}

function isStrictChildPath(pathValue, rootValue) {
  const p = normalizeDirPath(pathValue);
  const r = normalizeDirPath(rootValue);
  if (!p || !r) return false;
  if (p === r) return false;
  return p.startsWith(`${r}/`);
}

function canRemoveProcessedSourcePath(sourcePath, allowedRoots = []) {
  const target = normalizeDirPath(sourcePath);
  if (!target || target === '/' || target === '.' || target === '..') return false;
  const normalizedSegments = `/${target.replace(/^\/+/, '')}/`;
  if (normalizedSegments.includes('/../') || normalizedSegments.includes('/./')) return false;
  const leaf = basenamePath(target).toLowerCase();
  if (!leaf || leaf === '.' || leaf === '..') return false;
  const roots = Array.isArray(allowedRoots) ? allowedRoots : [];
  return roots.some((root) => isStrictChildPath(target, root));
}

function uniquePaths(values) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const v = String(raw || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function remotePathExists(ssh, targetPath) {
  const p = String(targetPath || '').trim();
  if (!p) return false;
  const cmd = `[ -e ${shQuote(p)} ] && echo 1 || echo 0`;
  const direct = await ssh.exec(cmd, { timeoutMs: 15000 }).catch(() => null);
  if (String(direct?.stdout || '').trim() === '1') return true;
  const elevated = await ssh.exec(cmd, { timeoutMs: 15000, sudo: true }).catch(() => null);
  return String(elevated?.stdout || '').trim() === '1';
}

async function cleanupProcessedSourcePath({ ssh, sourcePath, allowedRoots = [] } = {}) {
  const target = normalizeDirPath(sourcePath);
  if (!canRemoveProcessedSourcePath(target, allowedRoots)) {
    return { ok: false, removed: false, skipped: true, reason: 'unsafe_path', path: target };
  }
  if (!(await remotePathExists(ssh, target))) {
    return { ok: true, removed: false, skipped: true, reason: 'not_found', path: target };
  }
  await ssh.exec(`rm -rf -- ${shQuote(target)}`, { timeoutMs: 2 * 60 * 1000, sudo: true });
  return { ok: true, removed: true, skipped: false, path: target };
}

async function listDirectChildrenNewestFirst(ssh, dirPath) {
  const dir = String(dirPath || '').trim();
  if (!dir) return [];
  const script = [
    'set -o pipefail',
    `d=${shQuote(dir)}`,
    '[ -d "$d" ] || exit 0',
    'find "$d" -mindepth 1 -maxdepth 1 -printf "%T@\\t%p\\n" 2>/dev/null | sort -nr | cut -f2-',
  ].join('\n');
  const parseRows = (stdout) =>
    String(stdout || '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);

  const direct = await ssh.exec(script, { timeoutMs: 30000 }).catch(() => null);
  const directRows = parseRows(direct?.stdout);
  if (directRows.length) return directRows;

  const elevated = await ssh.exec(script, { timeoutMs: 30000, sudo: true }).catch(() => null);
  return parseRows(elevated?.stdout);
}

async function dirHasDirectVideoFile(ssh, dirPath, videoExts = []) {
  const dir = String(dirPath || '').trim();
  if (!dir) return false;
  const exts = (Array.isArray(videoExts) ? videoExts : [])
    .map((x) => String(x || '').trim().replace(/^\./, '').toLowerCase())
    .filter((x) => /^[a-z0-9]+$/.test(x));
  if (!exts.length) return false;
  const expr = exts.map((ext) => `-iname "*.${ext}"`).join(' -o ');
  const script = [
    `d=${shQuote(dir)}`,
    '[ -d "$d" ] || exit 0',
    `find "$d" -maxdepth 1 -type f \\( ${expr} \\) -print -quit`,
  ].join('\n');
  const direct = await ssh.exec(script, { timeoutMs: 30000 }).catch(() => null);
  if (Boolean(String(direct?.stdout || '').trim())) return true;
  const elevated = await ssh.exec(script, { timeoutMs: 30000, sudo: true }).catch(() => null);
  return Boolean(String(elevated?.stdout || '').trim());
}

async function resolveDownloadPath({
  ssh,
  rec,
  props = {},
  videoExts = [],
  fallbackDirs = [],
} = {}) {
  const qbName = String(rec?.qbName || props?.name || '').trim();
  const recSave = String(rec?.savePath || '').trim();
  const propsSave = String(props?.save_path || '').trim();
  const directCandidates = uniquePaths([
    props?.content_path,
    pathJoin(propsSave, qbName),
    pathJoin(recSave, qbName),
    rec?.downloadPath,
  ]);

  for (const candidate of directCandidates) {
    if (await remotePathExists(ssh, candidate)) {
      return { path: candidate, source: 'direct_candidate' };
    }
  }

  const title = String(rec?.title || rec?.qbName || '').trim();
  const titleNorm = normalizeMatchText(title);
  const titleTokens = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);

  const baseDirs = uniquePaths([recSave, propsSave, ...(Array.isArray(fallbackDirs) ? fallbackDirs : [])]);
  for (const baseDir of baseDirs) {
    const children = await listDirectChildrenNewestFirst(ssh, baseDir);
    if (children.length) {
      if (qbName) {
        const exact = children.find((x) => basenamePath(x).toLowerCase() === qbName.toLowerCase());
        if (exact) return { path: exact, source: 'base_exact_qbname' };
      }

      if (titleNorm) {
        const direct = children.find((x) => normalizeMatchText(basenamePath(x)).includes(titleNorm));
        if (direct) return { path: direct, source: 'base_title_match' };
      }

      if (titleTokens.length) {
        const scored = children
          .map((x) => {
            const bn = basenamePath(x).toLowerCase();
            const score = titleTokens.reduce((sum, token) => (bn.includes(token) ? sum + 1 : sum), 0);
            return { path: x, score };
          })
          .sort((a, b) => b.score - a.score);
        if (scored[0]?.score >= Math.min(2, titleTokens.length)) {
          return { path: scored[0].path, source: 'base_token_score' };
        }
      }

      if (children.length === 1) {
        return { path: children[0], source: 'base_single_child' };
      }
    }

    const hasDirectVideo = await dirHasDirectVideoFile(ssh, baseDir, videoExts);
    if (hasDirectVideo) return { path: baseDir, source: 'base_direct_video' };
  }

  return { path: '', source: 'none' };
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function removeRemoteDir(ssh, targetPath) {
  const p = String(targetPath || '').trim();
  if (!p) return false;
  await ssh.exec(`rm -rf -- ${shQuote(p)}`, { timeoutMs: 45000, sudo: true });
  return true;
}

async function cleanupOrphanStageDirsForType({ ssh, mountDir, settings, type, list = [] } = {}) {
  const t = sanitizeType(type);
  const paths = buildLibraryPaths({ mountDir, type: t, settings });
  const stageRoot = String(paths?.processingDir || '').trim();
  if (!stageRoot) return { type: t, scanned: 0, removed: 0, failed: 0 };

  const idMap = new Map();
  for (const row of Array.isArray(list) ? list : []) {
    idMap.set(String(row?.id || ''), row);
  }

  const children = await listDirectChildrenNewestFirst(ssh, stageRoot);
  let removed = 0;
  let failed = 0;
  for (const fullPath of children) {
    const name = basenamePath(fullPath);
    if (!isUuidLike(name)) continue;
    const row = idMap.get(name);
    const status = String(row?.status || '').toLowerCase();
    if (status === 'processing') continue;
    try {
      await removeRemoteDir(ssh, fullPath);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { type: t, scanned: children.length, removed, failed };
}

function staleSourceCandidatesForRow(row) {
  const directPath = normalizeDirPath(row?.downloadPath || '');
  const savePath = normalizeDirPath(row?.savePath || '');
  const qbName = String(row?.qbName || '').trim();
  const byQbName = savePath && qbName ? pathJoin(savePath, qbName) : '';
  return uniquePaths([directPath, byQbName]);
}

async function cleanupStaleSourcePathsForType({ ssh, mountDir, settings, type, list = [] } = {}) {
  const t = sanitizeType(type);
  const paths = buildLibraryPaths({ mountDir, type: t, settings });
  const allowedRoots = uniquePaths([paths.downloadingDir, paths.downloadedDir]);
  const rows = Array.isArray(list) ? list : [];
  const nextRows = [...rows];
  const result = {
    type: t,
    scanned: 0,
    attempted: 0,
    removed: 0,
    notFound: 0,
    unsafe: 0,
    failed: 0,
    changed: 0,
    list: rows,
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const status = String(row?.status || '').toLowerCase();
    if (!['cleaned', 'released', 'deleted'].includes(status)) continue;
    result.scanned += 1;

    const priorStatus = String(row?.sourceCleanupStatus || '')
      .trim()
      .toLowerCase();
    if (row?.sourceCleanupCheckedAt && ['removed', 'not_found', 'unsafe_path'].includes(priorStatus)) continue;

    const candidates = staleSourceCandidatesForRow(row);
    if (!candidates.length) {
      const nextRow = {
        ...row,
        sourceCleanupStatus: 'no_candidate',
        sourceCleanupCheckedAt: now(),
        sourceCleanupPath: '',
        sourceCleanupError: '',
      };
      if (
        row?.sourceCleanupStatus !== nextRow.sourceCleanupStatus ||
        Number(row?.sourceCleanupCheckedAt || 0) !== Number(nextRow.sourceCleanupCheckedAt)
      ) {
        nextRows[index] = nextRow;
        result.changed += 1;
      }
      continue;
    }

    result.attempted += 1;
    let finalCleanup = null;
    for (const candidate of candidates) {
      try {
        const cleanup = await cleanupProcessedSourcePath({
          ssh,
          sourcePath: candidate,
          allowedRoots,
        });
        finalCleanup = cleanup;
        if (cleanup?.removed) break;
        if (cleanup?.reason === 'unsafe_path') break;
      } catch (e) {
        finalCleanup = {
          ok: false,
          removed: false,
          skipped: false,
          reason: 'error',
          path: normalizeDirPath(candidate),
          error: e?.message || 'Failed to clean stale source path.',
        };
        break;
      }
    }
    if (!finalCleanup) {
      finalCleanup = {
        ok: true,
        removed: false,
        skipped: true,
        reason: 'not_found',
        path: normalizeDirPath(candidates[0] || ''),
      };
    }

    const nextStatus = finalCleanup?.removed ? 'removed' : String(finalCleanup?.reason || 'checked');
    if (nextStatus === 'removed') result.removed += 1;
    else if (nextStatus === 'not_found') result.notFound += 1;
    else if (nextStatus === 'unsafe_path') result.unsafe += 1;
    else if (nextStatus === 'error') result.failed += 1;

    const nextRow = {
      ...row,
      sourceCleanupStatus: nextStatus,
      sourceCleanupCheckedAt: now(),
      sourceCleanupPath: String(finalCleanup?.path || '').trim(),
      sourceCleanupError: String(finalCleanup?.error || '').trim(),
    };
    if (finalCleanup?.removed) nextRow.sourceCleanupAt = now();
    const changed =
      String(row?.sourceCleanupStatus || '') !== String(nextRow.sourceCleanupStatus || '') ||
      String(row?.sourceCleanupPath || '') !== String(nextRow.sourceCleanupPath || '') ||
      String(row?.sourceCleanupError || '') !== String(nextRow.sourceCleanupError || '') ||
      Number(row?.sourceCleanupAt || 0) !== Number(nextRow.sourceCleanupAt || 0) ||
      Number(row?.sourceCleanupCheckedAt || 0) !== Number(nextRow.sourceCleanupCheckedAt || 0);
    if (changed) {
      nextRows[index] = nextRow;
      result.changed += 1;
    }
  }

  result.list = nextRows;
  return result;
}

function buildFinalPaths({ type, mountDir, tmdb, rec, settings }) {
  const t = String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
  const baseRoot = String(mountDir || '').replace(/\/+$/, '');
  const paths = buildLibraryPaths({ mountDir: baseRoot, type: t, settings });
  if (t === 'series') {
    const genre = sanitizeFsName(String(rec?.targetGenre || '').trim() || (tmdb?.genres || [])[0] || 'Uncategorized');
    const seriesFolder = sanitizeFsName(`${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}`);
    return {
      processingDir: paths.processingDir,
      finalDir: `${baseRoot}/Series/${genre}/${seriesFolder}`,
      categoryBase: null,
      genreBase: genre,
    };
  }
  const lang = String(tmdb?.originalLanguage || rec?.tmdb?.originalLanguage || '').trim().toLowerCase();
  const category = sanitizeFsName(lang === 'en' ? 'English' : 'Asian');
  const genre = sanitizeFsName((tmdb?.genres || [])[0] || 'Uncategorized');
  return {
    processingDir: paths.processingDir,
    finalDir: `${baseRoot}/Movies/${category}/${genre}`,
    categoryBase: category,
    genreBase: genre,
  };
}

function processingScript({
  type,
  downloadPath,
  stageDir,
  finalDir,
  baseName,
  movieSubtitleTemplate,
  seriesName,
  seriesSeasonFolderTemplate,
  seriesEpisodeTemplate,
  seriesSubtitleTemplate,
  mountDir,
  categoryBase,
  genreBase,
  videoExts,
  subtitleExts,
  keepSubtitleLanguages,
  languagePatterns,
  holdMode = false,
}) {
  const extsVideo = ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'];
  const extsSub = Array.isArray(subtitleExts) && subtitleExts.length ? subtitleExts : DEFAULT_SUBTITLE_EXTENSIONS;
  const vext = Array.isArray(videoExts) && videoExts.length ? videoExts : extsVideo;
  const keepLangs = Array.isArray(keepSubtitleLanguages) ? keepSubtitleLanguages.filter(Boolean) : DEFAULT_KEEP_SUB_LANGUAGES;
  const patterns = languagePatterns && typeof languagePatterns === 'object' ? languagePatterns : DEFAULT_LANGUAGE_PATTERNS;

  const lines = [
    'set -euo pipefail',
    '',
    `TYPE=${shQuote(type)}`,
    `DOWNLOAD_PATH=${shQuote(downloadPath)}`,
    `STAGE_DIR=${shQuote(stageDir)}`,
    `FINAL_DIR=${shQuote(finalDir)}`,
    `BASE_NAME=${shQuote(baseName)}`,
    `MOVIE_SUBTITLE_TEMPLATE=${shQuote(movieSubtitleTemplate || `${baseName}.{lang}`)}`,
    `SERIES_NAME=${shQuote(seriesName || '')}`,
    `SERIES_SEASON_FOLDER_TEMPLATE=${shQuote(seriesSeasonFolderTemplate || 'Season {season}')}`,
    `SERIES_EPISODE_TEMPLATE=${shQuote(seriesEpisodeTemplate || '{title} - S{season}E{episode}')}`,
    `SERIES_SUBTITLE_TEMPLATE=${shQuote(seriesSubtitleTemplate || '{title} - S{season}E{episode}.{lang}')}`,
    `MOUNT_DIR=${shQuote(mountDir || '')}`,
    `CATEGORY_BASE=${shQuote(categoryBase || '')}`,
    `GENRE_BASE=${shQuote(genreBase || '')}`,
    `HOLD_MODE=${holdMode ? '1' : '0'}`,
    `KEEP_SUB_LANGS=${shQuote(keepLangs.join(' '))}`,
    '',
    'cleanup_stage() {',
    '  rm -rf "$STAGE_DIR" >/dev/null 2>&1 || true',
    '}',
    'trap cleanup_stage EXIT',
    '',
    'if ! command -v python3 >/dev/null 2>&1; then',
    '  if command -v apt-get >/dev/null 2>&1; then',
    '    apt-get update -y && apt-get install -y python3',
    '  elif command -v dnf >/dev/null 2>&1; then',
    '    dnf install -y python3',
    '  elif command -v yum >/dev/null 2>&1; then',
    '    yum install -y python3',
    '  else',
    '    echo "python3 is required for JSON logging" >&2',
    '    exit 2',
    '  fi',
    'fi',
    '',
    'mkdir -p "$STAGE_DIR"',
    'src="$STAGE_DIR/src"',
    'mkdir -p "$src"',
    '',
    'move_in() {',
    '  local bn=""',
    '  local moved=""',
    '  if [ -d "$DOWNLOAD_PATH" ]; then',
    '    bn="$(basename "$DOWNLOAD_PATH")"',
    '    moved="$src/$bn"',
    '    if ! mv "$DOWNLOAD_PATH" "$src/" >/dev/null 2>&1; then',
    '      mkdir -p "$moved"',
    '      cp -a "$DOWNLOAD_PATH"/. "$moved"/',
    '    fi',
    '    work="$moved"',
    '  else',
    '    bn="$(basename "$DOWNLOAD_PATH")"',
    '    if ! mv "$DOWNLOAD_PATH" "$src/" >/dev/null 2>&1; then',
    '      cp -a "$DOWNLOAD_PATH" "$src/"',
    '    fi',
    '    work="$src"',
    '  fi',
    '  echo "$work"',
    '}',
    '',
    'work="$(move_in)"',
    '',
    'LOG_DIR="$STAGE_DIR/log"',
    'DELETED_LOG="$LOG_DIR/deleted.txt"',
    'MOVED_LOG="$LOG_DIR/moved.tsv"',
    'mkdir -p "$LOG_DIR"',
    ': > "$DELETED_LOG"',
    ': > "$MOVED_LOG"',
    '',
    'log_delete() {',
    '  local f="$1"',
    '  echo "$f" >> "$DELETED_LOG" || true',
    '}',
    '',
    'log_move() {',
    '  local from="$1"',
    '  local to="$2"',
    '  printf "%s\\t%s\\n" "$from" "$to" >> "$MOVED_LOG" || true',
    '}',
    '',
    `video_exts="${vext.join(' ')}"`,
    `sub_exts="${extsSub.join(' ')}"`,
    '',
    'is_video() {',
    '  local f="$1"',
    '  local ext="${f##*.}"',
    '  ext="$(echo "$ext" | tr \'[:upper:]\' \'[:lower:]\')"',
    '  for e in $video_exts; do [ "$ext" = "$e" ] && return 0; done',
    '  return 1',
    '}',
    '',
    'is_sub() {',
    '  local f="$1"',
    '  local ext="${f##*.}"',
    '  ext="$(echo "$ext" | tr \'[:upper:]\' \'[:lower:]\')"',
    '  for e in $sub_exts; do [ "$ext" = "$e" ] && return 0; done',
    '  return 1',
    '}',
    '',
    'sub_lang() {',
    '  local f="$1"',
    '  local lc="$(echo "$f" | tr \'[:upper:]\' \'[:lower:]\')"',
    ...keepLangs.flatMap((lang) => {
      const expr = String(patterns?.[lang] || '').trim();
      if (!expr) return [];
      return [`  if echo "$lc" | grep -Eq ${shQuote(expr)}; then echo ${shQuote(lang)}; return 0; fi`];
    }),
    '  if echo "$lc" | grep -Eq \'(^|[._ -])(en|eng|english)([._ -]|$)\'; then echo "en"; return 0; fi',
    '  if echo "$lc" | grep -Eq \'(^|[._ -])(tl|tag|fil|filipino|tagalog)([._ -]|$)\'; then echo "tl"; return 0; fi',
    '  echo ""',
    '  return 0',
    '}',
    '',
    'is_allowed_sub_lang() {',
    '  local lang="$1"',
    '  if [ -z "$KEEP_SUB_LANGS" ]; then return 0; fi',
    '  if [ -z "$lang" ]; then return 1; fi',
    '  for allowed in $KEEP_SUB_LANGS; do',
    '    if [ "$allowed" = "$lang" ]; then return 0; fi',
    '  done',
    '  return 1',
    '}',
    '',
    '# Cleanup pass',
    'while IFS= read -r -d \'\' f; do',
    '  if is_video "$f"; then continue; fi',
    '  if is_sub "$f"; then continue; fi',
    '  log_delete "$f"',
    '  rm -f "$f" || true',
    'done < <(find "$work" -type f -print0)',
    '',
    'find "$work" -type d -empty -delete || true',
    '',
    `mapfile -d '' -t videos < <(find "$work" -type f '(' ${extsVideo
      .map((e) => `-iname "*.${e}"`)
      .join(' -o ')} ')' -print0)`,
    '',
    'if [ "$TYPE" = "movie" ]; then',
    '  if [ "${#videos[@]}" -ne 1 ]; then',
    '    echo "Expected exactly 1 video file for movie, found ${#videos[@]}" >&2',
    '    exit 10',
    '  fi',
    'fi',
    '',
    'resolve_dir() {',
    '  local parent="$1"',
    '  local base="$2"',
    '  if [ -z "$base" ]; then echo "$parent"; return 0; fi',
    '  mkdir -p "$parent/$base" >/dev/null 2>&1 || return 1',
    '  echo "$parent/$base"',
    '}',
    '',
    'render_template_name() {',
    '  local tpl="$1"',
    '  local lang="$2"',
    '  local season="$3"',
    '  local episode="$4"',
    '  local fallback="$5"',
    '  local out="$tpl"',
    '  out="${out//\\{lang\\}/$lang}"',
    '  out="${out//\\{season\\}/$season}"',
    '  out="${out//\\{episode\\}/$episode}"',
    "  out=\"$(echo \"$out\" | sed -E 's/\\{[a-z_]+\\}//g; s/[[:space:]]+/ /g; s/^[[:space:]]+|[[:space:]]+$//g; s/\\.{2,}/./g; s/^[._-]+|[._-]+$//g')\"",
    '  out="${out//\\// }"',
    "  out=\"${out//\\\\/ }\"",
    '  if [ -z "$out" ]; then out="$fallback"; fi',
    '  echo "$out"',
    '}',
    '',
    'mkdir -p "$FINAL_DIR"',
    '',
    '# Resolve final directory using base names (avoid creating duplicate base folders when counted folders already exist)',
    'if [ "$HOLD_MODE" = "1" ]; then',
    '  mkdir -p "$FINAL_DIR"',
    'elif [ "$TYPE" = "movie" ]; then',
    '  MOVIES_ROOT="$MOUNT_DIR/Movies"',
    '  catDir="$(resolve_dir "$MOVIES_ROOT" "$CATEGORY_BASE" || true)"',
    '  [ -n "$catDir" ] || catDir="$(dirname "$(dirname "$FINAL_DIR")")"',
    '  genDir="$(resolve_dir "$catDir" "$GENRE_BASE" || true)"',
    '  [ -n "$genDir" ] || genDir="$FINAL_DIR"',
    '  FINAL_DIR="$genDir"',
    '  mkdir -p "$FINAL_DIR"',
    'else',
    '  SERIES_ROOT="$MOUNT_DIR/Series"',
    '  genDir="$(resolve_dir "$SERIES_ROOT" "$GENRE_BASE" || true)"',
    '  [ -n "$genDir" ] || genDir="$(dirname "$FINAL_DIR")"',
    '  seriesFolder="$(basename "$FINAL_DIR")"',
    '  FINAL_DIR="$genDir/$seriesFolder"',
    '  mkdir -p "$FINAL_DIR"',
    'fi',
    '',
    'move_video_movie() {',
    '  local f="$1"',
    '  local ext="${f##*.}"',
    '  local dest="$FINAL_DIR/$BASE_NAME.$ext"',
    '  mv "$f" "$dest"',
    '  log_move "$f" "$dest"',
    '  echo "$dest"',
    '}',
    '',
    'move_subs_movie() {',
    '  while IFS= read -r -d \'\' s; do',
    '    lang="$(sub_lang "$s")"',
    '    bn="$(basename "$s")"',
    '    name="${bn%.*}"',
    '    ext="${s##*.}"',
    '    if ! is_allowed_sub_lang "$lang"; then',
    '      log_delete "$s"',
    '      rm -f "$s" || true',
    '      continue',
    '    fi',
    '    if [ -n "$lang" ]; then',
    '      subbase="$(render_template_name "$MOVIE_SUBTITLE_TEMPLATE" "$lang" "" "" "$BASE_NAME.$lang")"',
    '    else',
    '      subbase="$(render_template_name "$name" "" "" "" "$name")"',
    '    fi',
    '    dest="$FINAL_DIR/$subbase.$ext"',
    '    if mv -f "$s" "$dest"; then',
    '      log_move "$s" "$dest"',
    '    fi',
    `  done < <(find "$work" -type f '(' ${extsSub.map((e) => `-iname "*.${e}"`).join(' -o ')} ')' -print0)`,
    '}',
    '',
    'move_series_pack() {',
    '  mkdir -p "$FINAL_DIR"',
    `  while IFS= read -r -d '' f; do`,
    '    bn="$(basename "$f")"',
    '    name="${bn%.*}"',
    '    ext="${bn##*.}"',
    '    season=""',
    '    episode=""',
    "    if echo \"$name\" | grep -Eqi 's[0-9]{1,2}e[0-9]{1,2}'; then",
    "      season=\"$(echo \"$name\" | sed -E 's/.*[sS]([0-9]{1,2})[eE]([0-9]{1,2}).*/\\\\1/')\"",
    "      episode=\"$(echo \"$name\" | sed -E 's/.*[sS]([0-9]{1,2})[eE]([0-9]{1,2}).*/\\\\2/')\"",
    "    elif echo \"$name\" | grep -Eqi '[0-9]{1,2}x[0-9]{2}'; then",
    "      season=\"$(echo \"$name\" | sed -E 's/.*([0-9]{1,2})x([0-9]{2}).*/\\\\1/')\"",
    "      episode=\"$(echo \"$name\" | sed -E 's/.*([0-9]{1,2})x([0-9]{2}).*/\\\\2/')\"",
    '    fi',
    '    if ! is_allowed_sub_lang "$lang"; then',
    '      log_delete "$s"',
    '      rm -f "$s" || true',
    '      continue',
    '    fi',
    '    if [ -n "$season" ] && [ -n "$episode" ]; then',
    '      ss="$(printf \'%02d\' "$season")"',
    '      ee="$(printf \'%02d\' "$episode")"',
    '      base="$(render_template_name "$SERIES_EPISODE_TEMPLATE" "" "$ss" "$ee" "$SERIES_NAME - S${ss}E${ee}")"',
    '      new="${base}.${ext}"',
    '      seasonFolder="$(render_template_name "$SERIES_SEASON_FOLDER_TEMPLATE" "" "$ss" "" "Season $ss")"',
    '      targetDir="$FINAL_DIR/$seasonFolder"',
    '      mkdir -p "$targetDir"',
    '    else',
    '      new="${bn}"',
    '      targetDir="$FINAL_DIR"',
    '    fi',
    '    dest="$targetDir/$new"',
    '    mv "$f" "$dest"',
    '    log_move "$f" "$dest"',
    `  done < <(find "$work" -type f '(' ${extsVideo.map((e) => `-iname "*.${e}"`).join(' -o ')} ')' -print0)`,
    '',
    '  while IFS= read -r -d \'\' s; do',
    '    lang="$(sub_lang "$s")"',
    '    bn="$(basename "$s")"',
    '    name="${bn%.*}"',
    '    ext="${bn##*.}"',
    '    season=""',
    '    episode=""',
    "    if echo \"$name\" | grep -Eqi 's[0-9]{1,2}e[0-9]{1,2}'; then",
    "      season=\"$(echo \"$name\" | sed -E 's/.*[sS]([0-9]{1,2})[eE]([0-9]{1,2}).*/\\\\1/')\"",
    "      episode=\"$(echo \"$name\" | sed -E 's/.*[sS]([0-9]{1,2})[eE]([0-9]{1,2}).*/\\\\2/')\"",
    "    elif echo \"$name\" | grep -Eqi '[0-9]{1,2}x[0-9]{2}'; then",
    "      season=\"$(echo \"$name\" | sed -E 's/.*([0-9]{1,2})x([0-9]{2}).*/\\\\1/')\"",
    "      episode=\"$(echo \"$name\" | sed -E 's/.*([0-9]{1,2})x([0-9]{2}).*/\\\\2/')\"",
    '    fi',
    '    if [ -n "$season" ] && [ -n "$episode" ]; then',
    '      ss="$(printf "%02d" "$season")"',
    '      ee="$(printf "%02d" "$episode")"',
    '      if [ -n "$lang" ]; then',
    '        base="$(render_template_name "$SERIES_SUBTITLE_TEMPLATE" "$lang" "$ss" "$ee" "$SERIES_NAME - S${ss}E${ee}.${lang}")"',
    '      else',
    '        base="$(render_template_name "$SERIES_EPISODE_TEMPLATE" "" "$ss" "$ee" "$SERIES_NAME - S${ss}E${ee}")"',
    '      fi',
    '      seasonFolder="$(render_template_name "$SERIES_SEASON_FOLDER_TEMPLATE" "" "$ss" "" "Season $ss")"',
    '      targetDir="$FINAL_DIR/$seasonFolder"',
    '      mkdir -p "$targetDir"',
    '    else',
    '      if [ -n "$lang" ]; then base="${name}.${lang}"; else base="${name}"; fi',
    '      base="$(render_template_name "$base" "$lang" "" "" "$name")"',
    '      targetDir="$FINAL_DIR"',
    '    fi',
    '    dest="$targetDir/${base}.${ext}"',
    '    if mv -f "$s" "$dest"; then',
    '      log_move "$s" "$dest"',
    '    fi',
    `  done < <(find "$work" -type f '(' ${extsSub.map((e) => `-iname "*.${e}"`).join(' -o ')} ')' -print0)`,
    '}',
    '',
    'final_video=""',
    'if [ "$TYPE" = "movie" ]; then',
    '  final_video="$(move_video_movie "${videos[0]}")"',
    '  move_subs_movie',
    'else',
    '  move_series_pack',
    'fi',
    '',
    'export FINAL_VIDEO="$final_video"',
    'export TYPE FINAL_DIR',
    'export DELETED_LOG MOVED_LOG',
    'python3 - <<PY',
    'import json, os, time',
    '',
    'def read_lines(path, limit=500):',
    '  out = []',
    '  total = 0',
    '  if not path:',
    '    return out, total',
    '  try:',
    '    with open(path, \"r\", encoding=\"utf-8\", errors=\"replace\") as f:',
    '      for line in f:',
    '        total += 1',
    '        if len(out) < limit:',
    '          out.append(line.rstrip(\"\\n\"))',
    '  except FileNotFoundError:',
    '    pass',
    '  return out, total',
    '',
    'def read_moves(path, limit=500):',
    '  out = []',
    '  total = 0',
    '  if not path:',
    '    return out, total',
    '  try:',
    '    with open(path, \"r\", encoding=\"utf-8\", errors=\"replace\") as f:',
    '      for line in f:',
    '        total += 1',
    '        if len(out) >= limit:',
    '          continue',
    '        line = line.rstrip(\"\\n\")',
    '        if not line:',
    '          continue',
    '        parts = line.split(\"\\t\", 1)',
    '        out.append({\"from\": parts[0], \"to\": parts[1] if len(parts) > 1 else \"\"})',
    '  except FileNotFoundError:',
    '    pass',
    '  return out, total',
    '',
    'deleted, deleted_total = read_lines(os.environ.get(\"DELETED_LOG\", \"\"))',
    'moved, moved_total = read_moves(os.environ.get(\"MOVED_LOG\", \"\"))',
    '',
    'print(json.dumps({',
    '  \"ok\": True,',
    '  \"type\": os.environ.get(\"TYPE\", \"\"),',
    '  \"finalDir\": os.environ.get(\"FINAL_DIR\", \"\"),',
    '  \"finalVideo\": os.environ.get(\"FINAL_VIDEO\", \"\"),',
    '  \"finishedAt\": int(time.time()*1000),',
    '  \"moved\": moved,',
    '  \"movedTotal\": moved_total,',
    '  \"deleted\": deleted,',
    '  \"deletedTotal\": deleted_total,',
    '  \"limit\": 500,',
    '  \"truncated\": {',
    '    \"moved\": moved_total > len(moved),',
    '    \"deleted\": deleted_total > len(deleted),',
    '  }',
    '}))',
    'PY',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

export async function processOneCompleted({ type, id }) {
  const t = sanitizeType(type);
  if (!id) throw new Error('id is required.');

  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const mount = await getMountSettings();
  if (!mount?.mountDir) throw new Error('Configure Storage & Mount first.');
  const settings = await getAutodownloadSettings();
  const port = Number(settings?.downloadClient?.port || 8080) || 8080;

  const db = await getAdminDb();
  const key = dbKeyForType(t);
  const list = Array.isArray(db[key]) ? db[key] : [];
  const idx = list.findIndex((x) => String(x?.id) === String(id));
  if (idx < 0) throw new Error('Download not found.');
  const rec = list[idx];
  const statusLower = String(rec.status || '').toLowerCase();
  const recoverableFailed = statusLower === 'failed' && /unable to determine download path/i.test(String(rec?.error || ''));
  if (!rec?.qbHash && !recoverableFailed) throw new Error('Missing qBittorrent hash.');
  if (statusLower !== 'completed' && !recoverableFailed) throw new Error('Only Completed items can be processed.');
  const sourceMismatchMessage =
    rec?.source &&
    rec?.tmdb?.title &&
    !sourceMatchesRequestedMedia(rec.source, {
      title: rec.tmdb.title,
      year: rec?.tmdb?.year || rec?.year || null,
      type: t,
    })
      ? `Source/title mismatch: ${String(rec?.source?.name || rec?.qbName || 'selected torrent').trim()} does not match ${String(
          rec?.tmdb?.title || rec?.title || 'target title'
        ).trim()}${rec?.tmdb?.year ? ` (${rec.tmdb.year})` : ''}.`
      : '';

  list[idx] = { ...rec, status: 'Processing', processingStartedAt: now(), error: '' };
  db[key] = list;
  await saveAdminDb(db);

  const ssh = sshFromEngineHost(engineHost);
  try {
    if (sourceMismatchMessage) throw new Error(sourceMismatchMessage);

    const fileRules = getProcessingFileRules(settings);
    const videoExts = fileRules.videoExtensions.length ? fileRules.videoExtensions : ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'];
    const pathsForType = buildLibraryPaths({ mountDir: mount.mountDir, type: t, settings });

    let props = {};
    if (rec?.qbHash) {
      try {
        props = await qbGetProperties(ssh, { port, hash: rec.qbHash });
      } catch {
        props = {};
      }
    }
    const pathResult = await resolveDownloadPath({
      ssh,
      rec,
      props,
      videoExts,
      fallbackDirs: [pathsForType.downloadedDir],
    });
    const downloadPath = String(pathResult?.path || '').trim();
    if (!downloadPath) throw new Error('Unable to determine download path.');

    const seed = rec.title || rec.qbName || props?.name || '';
    const guess = guessTitleYear(seed);
    const tmdb = await resolveTmdbTitle({ kind: t, title: guess.title, year: guess.year });
    if (!tmdb.ok) throw new Error('TMDB match not found. Provide a better title/year.');

    const releaseTimezone = normalizeReleaseTimezone(
      rec?.releaseTimezone || settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila'
    );
    const releaseDelayDays = normalizeReleaseDelayDays(rec?.releaseDelayDays ?? settings?.release?.delayDays ?? 3);
    const releaseFallback = computeReleaseMeta({
      startedAt: rec?.addedAt || now(),
      delayDays: releaseDelayDays,
      timeZone: releaseTimezone,
    });
    const releaseDate = String(rec?.releaseDate || releaseFallback.releaseDate).trim() || releaseFallback.releaseDate;
    const releaseTag =
      String(rec?.releaseTag || '').trim() || buildReleaseTagFromDateKey(releaseDate) || releaseFallback.releaseTag;

    const names = buildFinalPaths({ type: t, mountDir: mount.mountDir, tmdb, rec, settings });
    const stageDir = `${names.processingDir}/${rec.id}`;
    const cleaningTemplates = getCleaningTemplates(settings);
    const qualityMeta = detectQualityMeta(rec);
    const staticTemplateTokens = {
      title: normalizeTemplateTokenValue(tmdb.title),
      year: normalizeTemplateTokenValue(tmdb.year || ''),
      quality: normalizeTemplateTokenValue(qualityMeta.quality || 'HD'),
      resolution: normalizeTemplateTokenValue(qualityMeta.resolution || qualityMeta.quality || 'HD'),
      type: t,
    };
    const folderTemplate = t === 'series' ? cleaningTemplates.seriesFolder : cleaningTemplates.movieFolder;
    const folderFallback =
      t === 'series'
        ? `${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}`
        : `${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}-${qualityMeta.quality || 'HD'}`;
    const folderLabel = dedupeFolderLabel(applyNameTemplate(folderTemplate, staticTemplateTokens, { fallback: folderFallback }), {
      list,
      releaseTag,
      recId: rec.id,
    });
    const holdDir = `${names.processingDir}/${releaseTag}/${folderLabel}`;
    const finalTargetDir = t === 'movie' ? `${names.finalDir}/${folderLabel}` : names.finalDir;
    const movieBaseName = applyNameTemplate(cleaningTemplates.movieFile, staticTemplateTokens, {
      fallback: `${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}-${qualityMeta.quality || 'HD'}`,
    });
    const movieSubtitleTemplate = applyNameTemplate(
      cleaningTemplates.movieSubtitle,
      { ...staticTemplateTokens, lang: '{lang}' },
      { fallback: `${movieBaseName}.{lang}`, keepUnknown: true, preservePlaceholders: true }
    );
    const seriesName = normalizeTemplateTokenValue(tmdb.title);
    const seriesSeasonFolderTemplate = applyNameTemplate(
      cleaningTemplates.seriesSeasonFolder,
      { ...staticTemplateTokens, season: '{season}' },
      { fallback: 'Season {season}', keepUnknown: true, preservePlaceholders: true }
    );
    const seriesEpisodeTemplate = applyNameTemplate(
      cleaningTemplates.seriesEpisode,
      { ...staticTemplateTokens, season: '{season}', episode: '{episode}' },
      { fallback: `${seriesName} - S{season}E{episode}`, keepUnknown: true, preservePlaceholders: true }
    );
    const seriesSubtitleTemplate = applyNameTemplate(
      cleaningTemplates.seriesSubtitle,
      { ...staticTemplateTokens, season: '{season}', episode: '{episode}', lang: '{lang}' },
      { fallback: `${seriesName} - S{season}E{episode}.{lang}`, keepUnknown: true, preservePlaceholders: true }
    );
    const baseName = t === 'series' ? seriesName : movieBaseName;
    const script = processingScript({
      type: t,
      downloadPath,
      stageDir,
      finalDir: holdDir,
      baseName,
      movieSubtitleTemplate,
      seriesName,
      seriesSeasonFolderTemplate,
      seriesEpisodeTemplate,
      seriesSubtitleTemplate,
      mountDir: mount.mountDir,
      categoryBase: names.categoryBase,
      genreBase: names.genreBase,
      videoExts,
      subtitleExts: fileRules.subtitleExtensions,
      keepSubtitleLanguages: fileRules.keepSubtitleLanguages,
      languagePatterns: fileRules.languagePatterns,
      holdMode: true,
    });

    const out = await ssh.execScript(script, { sudo: true, timeoutMs: 20 * 60 * 1000 });
    if (out.code !== 0) throw new Error(out.stderr || out.stdout || 'Processing failed.');

    let summary = null;
    try {
      summary = JSON.parse(String(out.stdout || '').trim().split('\n').slice(-1)[0]);
    } catch {
      summary = { ok: true };
    }

    // Update record
    const next = {
      ...rec,
      status: 'Cleaned',
      cleanedAt: now(),
      tmdb: {
        id: tmdb.id,
        mediaType: tmdb.mediaType,
        title: tmdb.title,
        year: tmdb.year,
        genres: tmdb.genres,
        rating: tmdb.rating,
        overview: tmdb.overview || '',
        posterPath: tmdb.posterPath || '',
        backdropPath: tmdb.backdropPath || '',
      },
      releaseDate,
      releaseTag,
      releaseTimezone,
      releaseDelayDays,
      releaseState: 'waiting',
      releasedAt: null,
      holdDir: summary?.finalDir || holdDir,
      finalTargetDir,
      finalDir: summary?.finalDir || holdDir,
      finalVideo: summary?.finalVideo || null,
      error: '',
    };

    // Remove torrent from qBittorrent but keep files (we moved them to hold folder).
    // Confirm removal before marking the record deleted; otherwise stale seeders get stuck forever.
    let qbDeleteResult = { ok: true, attempted: false, skipped: true, reason: 'not_required', error: '' };
    try {
      if (rec?.qbHash && !rec?.qbDeletedAt) {
        qbDeleteResult = { ok: true, attempted: true, skipped: false, reason: 'deleted', error: '' };
        await qbDeleteTorrentAndConfirm(ssh, { port, hash: rec.qbHash, deleteFiles: false });
      } else if (rec?.qbHash && rec?.qbDeletedAt) {
        qbDeleteResult = { ok: true, attempted: false, skipped: true, reason: 'already_deleted', error: '' };
      }
    } catch (e) {
      qbDeleteResult = {
        ok: false,
        attempted: true,
        skipped: false,
        reason: 'error',
        error: e?.message || 'Failed to delete torrent from qBittorrent.',
      };
    }

    const sourceCleanupRoots = uniquePaths([pathsForType.downloadingDir, pathsForType.downloadedDir]);
    let sourceCleanup = {
      ok: false,
      removed: false,
      skipped: true,
      reason: 'not_run',
      path: normalizeDirPath(downloadPath),
      error: '',
    };
    try {
      sourceCleanup = await cleanupProcessedSourcePath({
        ssh,
        sourcePath: downloadPath,
        allowedRoots: sourceCleanupRoots,
      });
      if (!sourceCleanup.ok && !sourceCleanup.skipped) {
        sourceCleanup = { ...sourceCleanup, error: sourceCleanup.error || 'Failed to remove source path.' };
      }
    } catch (e) {
      sourceCleanup = {
        ...sourceCleanup,
        skipped: false,
        reason: 'error',
        error: e?.message || 'Failed to remove source path.',
      };
    }

    if (qbDeleteResult?.ok && qbDeleteResult?.attempted) {
      next.qbDeletedAt = now();
      next.qbDeleteStatus = 'deleted';
      next.qbDeleteError = '';
    } else if (!qbDeleteResult?.ok && qbDeleteResult?.error) {
      next.qbDeleteStatus = 'error';
      next.qbDeleteError = qbDeleteResult.error;
    } else if (qbDeleteResult?.reason) {
      next.qbDeleteStatus = String(qbDeleteResult.reason);
      if (!next.qbDeleteError) next.qbDeleteError = '';
    }

    next.sourceCleanupStatus = sourceCleanup?.removed ? 'removed' : String(sourceCleanup?.reason || 'checked');
    next.sourceCleanupPath = String(sourceCleanup?.path || '').trim();
    next.sourceCleanupError = String(sourceCleanup?.error || '').trim();
    next.sourceCleanupCheckedAt = now();
    if (sourceCleanup?.removed) next.sourceCleanupAt = now();

    const db2 = await getAdminDb();
    const list2 = Array.isArray(db2[key]) ? db2[key] : [];
    const idx2 = list2.findIndex((x) => String(x?.id) === String(id));
    if (idx2 >= 0) {
      list2[idx2] = next;
      db2[key] = list2;
      await saveAdminDb(db2);
    }

    await appendProcessingLog({
      id: crypto.randomUUID(),
      createdAt: now(),
      type: t,
      downloadId: rec.id,
      tmdbId: tmdb.id,
      title: tmdb.title,
      year: tmdb.year,
      finalDir: summary?.finalDir || holdDir,
      finalTargetDir,
      releaseDate,
      releaseTag,
      summary: {
        ...(summary && typeof summary === 'object' ? summary : {}),
        sourceCleanup,
        qbDelete: qbDeleteResult,
      },
      status: 'ok',
    });

    return { ok: true, item: next };
  } catch (e) {
    let msg = e?.message || 'Processing failed.';
    const isSourceMismatch = /source\/title mismatch:/i.test(msg);
    if (isSourceMismatch && String(rec?.selectionLogId || '').trim()) {
      try {
        const { controlDownload } = await import('./downloadService');
        const replaced = await controlDownload({ type: t, id, action: 'replace' });
        await appendProcessingLog({
          id: crypto.randomUUID(),
          createdAt: now(),
          type: t,
          downloadId: rec.id,
          tmdbId: rec?.tmdb?.id || null,
          title: rec.title || rec.qbName || '',
          status: 'warning',
          error: msg,
          summary: {
            action: 'auto_replace_after_source_mismatch',
            replacementId: replaced?.replacement?.id || null,
            replacementTitle: replaced?.replacement?.title || replaced?.replacement?.tmdb?.title || '',
          },
        });
        return {
          ok: true,
          replaced: true,
          item: replaced?.replacement || replaced?.item || null,
          replacement: replaced?.replacement || null,
          removedItem: replaced?.item || null,
        };
      } catch (replaceError) {
        msg = `${msg} Replacement failed: ${replaceError?.message || 'unknown error'}`;
      }
    }

    const db3 = await getAdminDb();
    const list3 = Array.isArray(db3[key]) ? db3[key] : [];
    const idx3 = list3.findIndex((x) => String(x?.id) === String(id));
    if (idx3 >= 0) {
      const current = list3[idx3];
      const superseding = /unable to determine download path/i.test(msg) ? findSupersedingItem(list3, current) : null;
      if (superseding) {
        list3[idx3] = {
          ...current,
          status: 'Deleted',
          deletedAt: now(),
          error: `Superseded by cleaned item ${superseding.id}.`,
        };
      } else {
        list3[idx3] = { ...current, status: 'Failed', error: msg };
      }
      db3[key] = list3;
      await saveAdminDb(db3);
    }
    await appendProcessingLog({
      id: crypto.randomUUID(),
      createdAt: now(),
      type: t,
      downloadId: rec.id,
      tmdbId: rec?.tmdb?.id || null,
      title: rec.title || rec.qbName || '',
      status: 'error',
      error: msg,
    });
    throw new Error(msg);
  } finally {
    await ssh.close();
  }
}

export async function processNextCompleted({ type = 'all', limit = 1, all = false } = {}) {
  const db = await getAdminDb();
  const types = type === 'all' ? ['movie', 'series'] : [sanitizeType(type)];
  const maxItems = all ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(50, Math.floor(Number(limit || 1)) || 1));
  const queue = [];
  const stageCleanup = {
    ok: true,
    removed: 0,
    failed: 0,
    types: [],
  };
  const staleSourceCleanup = {
    ok: true,
    scanned: 0,
    attempted: 0,
    removed: 0,
    notFound: 0,
    unsafe: 0,
    failed: 0,
    changed: 0,
    types: [],
  };

  try {
    const engineHost = await getEngineHost();
    const mount = await getMountSettings();
    const settings = await getAutodownloadSettings();
    if (engineHost && mount?.mountDir) {
      const ssh = sshFromEngineHost(engineHost);
      let dbChanged = false;
      try {
        for (const t of types) {
          const key = dbKeyForType(t);
          const list = Array.isArray(db[key]) ? db[key] : [];
          const res = await cleanupOrphanStageDirsForType({
            ssh,
            mountDir: mount.mountDir,
            settings,
            type: t,
            list,
          });
          stageCleanup.types.push(res);
          stageCleanup.removed += Number(res?.removed || 0);
          stageCleanup.failed += Number(res?.failed || 0);

          const staleRes = await cleanupStaleSourcePathsForType({
            ssh,
            mountDir: mount.mountDir,
            settings,
            type: t,
            list,
          });
          staleSourceCleanup.types.push({
            type: t,
            scanned: Number(staleRes?.scanned || 0),
            attempted: Number(staleRes?.attempted || 0),
            removed: Number(staleRes?.removed || 0),
            notFound: Number(staleRes?.notFound || 0),
            unsafe: Number(staleRes?.unsafe || 0),
            failed: Number(staleRes?.failed || 0),
            changed: Number(staleRes?.changed || 0),
          });
          staleSourceCleanup.scanned += Number(staleRes?.scanned || 0);
          staleSourceCleanup.attempted += Number(staleRes?.attempted || 0);
          staleSourceCleanup.removed += Number(staleRes?.removed || 0);
          staleSourceCleanup.notFound += Number(staleRes?.notFound || 0);
          staleSourceCleanup.unsafe += Number(staleRes?.unsafe || 0);
          staleSourceCleanup.failed += Number(staleRes?.failed || 0);
          staleSourceCleanup.changed += Number(staleRes?.changed || 0);
          if (Number(staleRes?.changed || 0) > 0) {
            db[key] = Array.isArray(staleRes?.list) ? staleRes.list : list;
            dbChanged = true;
          }
        }
        if (dbChanged) await saveAdminDb(db);
      } finally {
        await ssh.close();
      }
    } else {
      stageCleanup.skipped = true;
      stageCleanup.reason = 'missing_engine_or_mount';
      staleSourceCleanup.skipped = true;
      staleSourceCleanup.reason = 'missing_engine_or_mount';
    }
  } catch (e) {
    stageCleanup.ok = false;
    stageCleanup.error = e?.message || 'Stage cleanup failed.';
    staleSourceCleanup.ok = false;
    staleSourceCleanup.error = e?.message || 'Stale source cleanup failed.';
  }

  for (const t of types) {
    const key = dbKeyForType(t);
    const list = Array.isArray(db[key]) ? db[key] : [];
    for (const rec of list) {
      const st = String(rec?.status || '').toLowerCase();
      const recoverableFailed = st === 'failed' && /unable to determine download path/i.test(String(rec?.error || ''));
      if (st !== 'completed' && !recoverableFailed) continue;
      queue.push({ type: t, id: rec.id });
      if (queue.length >= maxItems) break;
    }
    if (queue.length >= maxItems) break;
  }

  if (!queue.length) return { ok: true, skipped: true, stageCleanup, staleSourceCleanup };
  if (queue.length === 1) {
    const one = await processOneCompleted({ type: queue[0].type, id: queue[0].id });
    return { ...one, stageCleanup, staleSourceCleanup };
  }

  const items = [];
  const errors = [];
  for (const row of queue) {
    try {
      const result = await processOneCompleted({ type: row.type, id: row.id });
      items.push(result?.item || result);
    } catch (e) {
      errors.push({
        type: row.type,
        id: row.id,
        error: e?.message || 'Processing failed.',
      });
    }
  }

  return {
    ok: errors.length === 0,
    requested: maxItems,
    processed: queue.length,
    succeeded: items.length,
    failed: errors.length,
    items,
    errors,
    stageCleanup,
    staleSourceCleanup,
  };
}
