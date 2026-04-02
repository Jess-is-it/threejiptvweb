import 'server-only';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { createUserNotification } from '../notifications';
import { getAutodownloadSettings, getEngineHost, getMountSettings, updateXuiScanState } from './autodownloadDb';
import { controlDownload } from './downloadService';
import { SSHService } from './sshService';
import { getTmdbDetailsById } from './tmdbService';
import { isReleaseDateDue, normalizeReleaseTimezone } from './releaseSchedule';

function now() {
  return Date.now();
}

const FALLBACK_POSTER = '/placeholders/poster-fallback.jpg';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const TMDB_VISUAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const tmdbVisualCache = new Map();
const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'sub', 'vtt'];
const DEFAULT_KEEP_SUB_LANGUAGES = ['en', 'tl'];
const DEFAULT_LANGUAGE_PATTERNS = {
  en: '(eng|english|en)',
  tl: '(tag|fil|filipino|tl|tagalog)',
};

function posterUrl(pathValue) {
  const p = String(pathValue || '').trim();
  return p ? `${TMDB_IMAGE_BASE}/w500${p}` : FALLBACK_POSTER;
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
      year: String(details?.year || '').trim(),
    };
    tmdbVisualCache.set(key, { at: now(), value });
    return value;
  } catch {
    tmdbVisualCache.set(key, { at: now(), value: null });
    return null;
  }
}

async function hydrateQueueVisuals(items = []) {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(
    list.map(async (row) => {
      let posterPath = String(row?.posterPath || '').trim();
      let backdropPath = String(row?.backdropPath || '').trim();
      let overview = String(row?.overview || '').trim();
      let rating = row?.rating ?? null;
      let genres = Array.isArray(row?.genres) ? row.genres : [];
      let title = String(row?.title || '').trim();
      let year = String(row?.year || '').trim();

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
        }
      }

      return {
        ...row,
        title,
        year,
        overview,
        rating,
        genres,
        posterPath,
        backdropPath,
        image: posterUrl(posterPath),
        backdropImage: backdropUrl(backdropPath),
      };
    })
  );
}

function normalizeType(type) {
  return String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
}

function rowKey(tmdbId, mediaType) {
  const t = String(mediaType || '').toLowerCase() === 'tv' || String(mediaType || '').toLowerCase() === 'series' ? 'tv' : 'movie';
  return `${t}:${Number(tmdbId || 0)}`;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function toMediaType(type) {
  return normalizeType(type) === 'series' ? 'tv' : 'movie';
}

function toRowKind(mediaType) {
  return String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
}

function toQueueKey(type) {
  return normalizeType(type) === 'series' ? 'downloadsSeries' : 'downloadsMovies';
}

function shQuote(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
}

function parentDir(pathValue) {
  const value = String(pathValue || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  const idx = value.lastIndexOf('/');
  if (idx <= 0) return '';
  return value.slice(0, idx);
}

function baseName(pathValue) {
  const value = String(pathValue || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  const idx = value.lastIndexOf('/');
  if (idx < 0) return value;
  return value.slice(idx + 1);
}

function releaseTagDirFromHold({ holdDir, releaseTag } = {}) {
  const parent = parentDir(holdDir);
  if (!parent) return '';
  const tag = String(releaseTag || '').trim();
  if (!tag) return parent;
  return baseName(parent) === tag ? parent : '';
}

function resolveReleaseTargetDir({ rec, type } = {}) {
  const target = String(rec?.finalTargetDir || '').trim().replace(/\/+$/, '');
  if (!target) return '';
  if (normalizeType(type) !== 'movie') return target;
  const holdBase = baseName(rec?.holdDir);
  if (!holdBase) return target;
  const targetBase = baseName(target);
  if (String(targetBase || '').toLowerCase() === String(holdBase || '').toLowerCase()) return target;
  return `${target}/${holdBase}`;
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

async function moveHoldAssets({ ssh, fromDir, toDir } = {}) {
  const from = String(fromDir || '').trim();
  const to = String(toDir || '').trim();
  if (!from || !to) return { ok: false, error: 'Missing hold/final dir' };
  const cmd = [
    'set -euo pipefail',
    `FROM=${shQuote(from)}`,
    `TO=${shQuote(to)}`,
    'if [ ! -d "$FROM" ]; then',
    '  echo "__MISSING_FROM__"',
    '  exit 0',
    'fi',
    'mkdir -p "$TO"',
    'moved=0',
    'while IFS= read -r p; do',
    '  [ -n "$p" ] || continue',
    '  mv -f "$p" "$TO"/',
    '  moved=$((moved+1))',
    'done < <(find "$FROM" -mindepth 1 -maxdepth 1 -print)',
    'rmdir "$FROM" >/dev/null 2>&1 || true',
    'echo "__MOVED__:$moved"',
  ].join('\n');

  const r = await ssh.exec(cmd, { sudo: true, timeoutMs: 120000 });
  const out = String(r?.stdout || '').trim();
  if (out.includes('__MISSING_FROM__')) return { ok: false, missing: true, moved: 0 };
  const m = out.match(/__MOVED__:(\d+)/);
  const moved = m ? Number(m[1]) : 0;
  return { ok: true, moved };
}

async function removeDirIfEmpty({ ssh, dir, pruneChildren = false } = {}) {
  const target = String(dir || '').trim();
  if (!target) return { ok: false, skipped: true, reason: 'missing_dir' };

  const cmd = [
    'set -euo pipefail',
    `DIR=${shQuote(target)}`,
    'if [ ! -d "$DIR" ]; then',
    '  echo "__MISSING__"',
    '  exit 0',
    'fi',
    pruneChildren
      ? 'find "$DIR" -mindepth 1 -depth -type d -empty -delete >/dev/null 2>&1 || true'
      : 'true',
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

  const r = await ssh.exec(cmd, { sudo: true, timeoutMs: 60000 });
  const out = String(r?.stdout || '');
  return {
    ok: true,
    removed: out.includes('__REMOVED__'),
    missing: out.includes('__MISSING__'),
    notEmpty: out.includes('__NOT_EMPTY__'),
    failed: out.includes('__FAILED__'),
  };
}

function normalizeMountDir(value) {
  return String(value || '').trim().replace(/\/+$/, '');
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

function subtitleFilterConfig(settings) {
  const fileRules = settings?.fileRules || {};
  return {
    subtitleExtensions: normalizeList(fileRules?.subtitleExtensions, DEFAULT_SUBTITLE_EXTENSIONS),
    keepSubtitleLanguages: normalizeList(fileRules?.keepSubtitleLanguages, DEFAULT_KEEP_SUB_LANGUAGES),
    languagePatterns: normalizePatterns(fileRules?.languagePatterns, DEFAULT_LANGUAGE_PATTERNS),
  };
}

async function filterHoldSubtitles({ ssh, holdDir, settings } = {}) {
  const dir = String(holdDir || '').trim();
  if (!ssh || !dir) return { ok: false, skipped: true, reason: 'missing_input', deleted: 0 };

  const { subtitleExtensions, keepSubtitleLanguages, languagePatterns } = subtitleFilterConfig(settings);
  const exts = subtitleExtensions.length ? subtitleExtensions : DEFAULT_SUBTITLE_EXTENSIONS;
  const keepLangs = keepSubtitleLanguages;
  if (!keepLangs.length) return { ok: true, skipped: true, reason: 'no_language_filter', deleted: 0 };

  const lines = [
    'set -euo pipefail',
    `DIR=${shQuote(dir)}`,
    `KEEP_SUB_LANGS=${shQuote(keepLangs.join(' '))}`,
    `sub_exts="${exts.join(' ')}"`,
    'if [ ! -d "$DIR" ]; then',
    '  echo "__MISSING__"',
    '  exit 0',
    'fi',
    'is_sub() {',
    '  local f="$1"',
    '  local ext="${f##*.}"',
    '  ext="$(echo "$ext" | tr \'[:upper:]\' \'[:lower:]\')"',
    '  for e in $sub_exts; do [ "$ext" = "$e" ] && return 0; done',
    '  return 1',
    '}',
    'sub_lang() {',
    '  local f="$1"',
    '  local lc="$(echo "$f" | tr \'[:upper:]\' \'[:lower:]\')"',
    ...keepLangs.flatMap((lang) => {
      const expr = String(languagePatterns?.[lang] || '').trim();
      if (!expr) return [];
      return [`  if echo "$lc" | grep -Eq ${shQuote(expr)}; then echo ${shQuote(lang)}; return 0; fi`];
    }),
    '  if echo "$lc" | grep -Eq \'(^|[._ -])(en|eng|english)([._ -]|$)\'; then echo "en"; return 0; fi',
    '  if echo "$lc" | grep -Eq \'(^|[._ -])(tl|tag|fil|filipino|tagalog)([._ -]|$)\'; then echo "tl"; return 0; fi',
    '  echo ""',
    '  return 0',
    '}',
    'is_allowed_sub_lang() {',
    '  local lang="$1"',
    '  if [ -z "$KEEP_SUB_LANGS" ]; then return 0; fi',
    '  if [ -z "$lang" ]; then return 1; fi',
    '  for allowed in $KEEP_SUB_LANGS; do',
    '    if [ "$allowed" = "$lang" ]; then return 0; fi',
    '  done',
    '  return 1',
    '}',
    'deleted=0',
    'while IFS= read -r -d \'\' s; do',
    '  [ -n "$s" ] || continue',
    '  is_sub "$s" || continue',
    '  lang="$(sub_lang "$s")"',
    '  if is_allowed_sub_lang "$lang"; then',
    '    continue',
    '  fi',
    '  rm -f "$s" || true',
    '  deleted=$((deleted+1))',
    `done < <(find "$DIR" -type f '(' ${exts.map((ext) => `-iname "*.${ext}"`).join(' -o ')} ')' -print0)`,
    'find "$DIR" -type d -empty -delete >/dev/null 2>&1 || true',
    'echo "__DELETED__:$deleted"',
  ];

  const r = await ssh.exec(lines.join('\n'), { sudo: true, timeoutMs: 120000 });
  const out = String(r?.stdout || '').trim();
  if (out.includes('__MISSING__')) return { ok: false, missing: true, deleted: 0 };
  const match = out.match(/__DELETED__:(\d+)/);
  return { ok: true, deleted: match ? Number(match[1] || 0) : 0 };
}

function processingRootsFromSettings({ mountDir, settings } = {}) {
  const root = normalizeMountDir(mountDir);
  if (!root) return [];
  const moviesProcessing = String(settings?.libraryFolders?.movies?.processing || 'Cleaned and Ready').trim() || 'Cleaned and Ready';
  const seriesProcessing = String(settings?.libraryFolders?.series?.processing || 'Cleaned and Ready').trim() || 'Cleaned and Ready';
  return [
    `${root}/qBittorrent/Movies/${moviesProcessing}`.replace(/\/+$/, ''),
    `${root}/qBittorrent/Series/${seriesProcessing}`.replace(/\/+$/, ''),
  ];
}

async function cleanupEmptyReleaseTagDirs({ ssh, mountDir, settings } = {}) {
  if (!ssh) return { ok: false, removed: 0, reason: 'missing_ssh' };
  const roots = processingRootsFromSettings({ mountDir, settings }).filter(Boolean);
  if (!roots.length) return { ok: false, removed: 0, reason: 'missing_roots' };

  let removed = 0;
  for (const root of roots) {
    const cmd = [
      'set -euo pipefail',
      `ROOT=${shQuote(root)}`,
      'if [ ! -d "$ROOT" ]; then',
      '  echo "__SKIP__"',
      '  exit 0',
      'fi',
      'removed=0',
      'while IFS= read -r tag; do',
      '  [ -n "$tag" ] || continue',
      '  find "$tag" -mindepth 1 -depth -type d -empty -delete >/dev/null 2>&1 || true',
      '  if find "$tag" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then',
      '    continue',
      '  fi',
      '  rmdir "$tag" >/dev/null 2>&1 || true',
      '  if [ ! -d "$tag" ]; then',
      '    removed=$((removed+1))',
      '  fi',
      'done < <(find "$ROOT" -mindepth 1 -maxdepth 1 -type d -name "Reldate*" -print 2>/dev/null || true)',
      'echo "__REMOVED__:$removed"',
    ].join('\n');
    const r = await ssh.exec(cmd, { sudo: true, timeoutMs: 120000 });
    const out = String(r?.stdout || '');
    const m = out.match(/__REMOVED__:(\d+)/);
    if (m) removed += Number(m[1] || 0);
  }
  return { ok: true, removed };
}

function reminderSubscribersFor(db, tmdbId, mediaType) {
  const rows = Array.isArray(db?.upcomingReminders) ? db.upcomingReminders : [];
  const key = rowKey(tmdbId, mediaType);
  const row = rows.find((x) => rowKey(x?.tmdbId, x?.mediaType) === key);
  if (!row) return [];
  return (Array.isArray(row?.subscribers) ? row.subscribers : [])
    .map((x) => normalizeUsername(x?.username))
    .filter(Boolean);
}

export async function subscribeUpcomingReminder({
  username,
  tmdbId,
  mediaType = 'movie',
  title = '',
  releaseDate = '',
} = {}) {
  const u = normalizeUsername(username);
  if (!u) throw new Error('Missing username');
  const id = Number(tmdbId || 0);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Missing tmdbId');
  const mt = String(mediaType || '').toLowerCase() === 'tv' || String(mediaType || '').toLowerCase() === 'series' ? 'tv' : 'movie';

  const db = await getAdminDb();
  db.upcomingReminders = Array.isArray(db.upcomingReminders) ? db.upcomingReminders : [];
  const key = rowKey(id, mt);
  let row = db.upcomingReminders.find((x) => rowKey(x?.tmdbId, x?.mediaType) === key);
  if (!row) {
    row = {
      id: key,
      tmdbId: id,
      mediaType: mt,
      title: String(title || '').trim(),
      releaseDate: String(releaseDate || '').trim(),
      createdAt: now(),
      updatedAt: now(),
      subscribers: [],
      notifiedAt: null,
    };
    db.upcomingReminders.unshift(row);
  }
  row.subscribers = Array.isArray(row.subscribers) ? row.subscribers : [];
  const exists = row.subscribers.some((x) => normalizeUsername(x?.username) === u);
  if (!exists) {
    row.subscribers.push({ username: u, subscribedAt: now() });
    row.updatedAt = now();
    await saveAdminDb(db);
  }
  return {
    ok: true,
    subscribed: !exists,
    subscriberCount: row.subscribers.length,
    tmdbId: id,
    mediaType: mt,
  };
}

export async function listUpcomingItems({ username = '', limit = 40 } = {}) {
  const u = normalizeUsername(username);
  const db = await getAdminDb();
  const max = Math.max(1, Math.min(200, Number(limit || 40) || 40));
  const settings = await getAutodownloadSettings().catch(() => null);
  const defaultReleaseTimezone = normalizeReleaseTimezone(
    settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila'
  );
  const reminders = Array.isArray(db?.upcomingReminders) ? db.upcomingReminders : [];
  const reminderMap = new Map(
    reminders.map((row) => [rowKey(row?.tmdbId, row?.mediaType), row])
  );

  const collect = (items, type) =>
    (Array.isArray(items) ? items : [])
      .filter((row) => String(row?.releaseState || '').toLowerCase() === 'waiting')
      .filter((row) => String(row?.status || '').toLowerCase() === 'cleaned')
      .filter(
        (row) =>
          !isReleaseDateDue({
            releaseDate: row?.releaseDate,
            nowTs: now(),
            timeZone: String(row?.releaseTimezone || '').trim() || defaultReleaseTimezone,
          })
      )
      .map((row) => {
        const mediaType = toMediaType(type);
        const key = rowKey(row?.tmdb?.id, mediaType);
        const rem = reminderMap.get(key);
        const subscribed = u
          ? (Array.isArray(rem?.subscribers) ? rem.subscribers : []).some(
              (x) => normalizeUsername(x?.username) === u
            )
          : false;
        const title = String(row?.tmdb?.title || row?.title || '').trim();
        const year = String(row?.tmdb?.year || row?.year || '').trim();
        const poster = String(row?.tmdb?.posterPath || row?.tmdb?.poster_path || '').trim();
        const backdrop = String(row?.tmdb?.backdropPath || row?.tmdb?.backdrop_path || '').trim();
        return {
          id: key,
          queueId: String(row?.id || ''),
          tmdbId: Number(row?.tmdb?.id || 0),
          mediaType,
          kind: toRowKind(mediaType),
          title,
          year,
          releaseDate: String(row?.releaseDate || '').trim(),
          releaseTimezone: String(row?.releaseTimezone || '').trim(),
          releaseTag: String(row?.releaseTag || '').trim(),
          releaseState: String(row?.releaseState || 'waiting').trim().toLowerCase(),
          rating: row?.tmdb?.rating ?? null,
          genres: Array.isArray(row?.tmdb?.genres) ? row.tmdb.genres : [],
          overview: String(row?.tmdb?.overview || row?.overview || '').trim(),
          posterPath: poster,
          backdropPath: backdrop,
          image: posterUrl(poster),
          backdropImage: backdropUrl(backdrop),
          href:
            mediaType === 'tv'
              ? `/series/${Number(row?.tmdb?.id || 0)}?upcoming=1&type=tv`
              : `/movies/${Number(row?.tmdb?.id || 0)}?upcoming=1&type=movie`,
          reminded: subscribed,
        };
      });

  const merged = [...collect(db.downloadsMovies, 'movie'), ...collect(db.downloadsSeries, 'series')];
  const uniq = [];
  const seen = new Set();
  for (const row of merged) {
    const key = rowKey(row?.tmdbId, row?.mediaType);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(row);
  }
  uniq.sort((a, b) => {
    const rd = String(a?.releaseDate || '').localeCompare(String(b?.releaseDate || ''));
    if (rd !== 0) return rd;
    return String(a?.title || '').localeCompare(String(b?.title || ''));
  });
  const sliced = uniq.slice(0, max);
  return hydrateQueueVisuals(sliced);
}

export async function listReleasedItems({ limit = 40 } = {}) {
  const db = await getAdminDb();
  const max = Math.max(1, Math.min(200, Number(limit || 40) || 40));

  const collect = (items, type) =>
    (Array.isArray(items) ? items : [])
      .filter((row) => String(row?.releaseState || '').toLowerCase() === 'released')
      .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'deleted')
      .filter((row) => Number(row?.releasedAt || 0) > 0)
      .map((row) => {
        const mediaType = toMediaType(type);
        const title = String(row?.tmdb?.title || row?.title || '').trim();
        const year = String(row?.tmdb?.year || row?.year || '').trim();
        const poster = String(row?.tmdb?.posterPath || row?.tmdb?.poster_path || '').trim();
        const backdrop = String(row?.tmdb?.backdropPath || row?.tmdb?.backdrop_path || '').trim();
        return {
          id: rowKey(row?.tmdb?.id, mediaType),
          queueId: String(row?.id || ''),
          tmdbId: Number(row?.tmdb?.id || 0),
          mediaType,
          kind: toRowKind(mediaType),
          title,
          year,
          releasedAt: Number(row?.releasedAt || 0) || 0,
          releaseDate: String(row?.releaseDate || '').trim(),
          rating: row?.tmdb?.rating ?? null,
          genres: Array.isArray(row?.tmdb?.genres) ? row.tmdb.genres : [],
          overview: String(row?.tmdb?.overview || row?.overview || '').trim(),
          posterPath: poster,
          backdropPath: backdrop,
          image: posterUrl(poster),
          backdropImage: backdropUrl(backdrop),
          href:
            mediaType === 'tv'
              ? `/series/${Number(row?.tmdb?.id || 0)}`
              : `/movies/${Number(row?.tmdb?.id || 0)}`,
        };
      });

  const merged = [...collect(db.downloadsMovies, 'movie'), ...collect(db.downloadsSeries, 'series')];
  const uniq = [];
  const seen = new Set();
  for (const row of merged) {
    const key = rowKey(row?.tmdbId, row?.mediaType);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(row);
  }
  uniq.sort((a, b) => Number(b?.releasedAt || 0) - Number(a?.releasedAt || 0));
  const sliced = uniq.slice(0, max);
  return hydrateQueueVisuals(sliced);
}

export async function releaseDueSelections({ type = 'all' } = {}) {
  const scope = String(type || 'all').trim().toLowerCase();
  const runMovies = scope === 'all' || scope === 'movie';
  const runSeries = scope === 'all' || scope === 'series';
  if (!runMovies && !runSeries) return { ok: true, skipped: true, reason: 'scope' };

  const settings = await getAutodownloadSettings();
  const tz = normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const db = await getAdminDb();
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  db.downloadsMovies = Array.isArray(db.downloadsMovies) ? db.downloadsMovies : [];
  db.downloadsSeries = Array.isArray(db.downloadsSeries) ? db.downloadsSeries : [];

  const dueLogs = db.selectionLogs.filter((log) => {
    const st = normalizeType(log?.selectionType || 'movie');
    if (st === 'movie' && !runMovies) return false;
    if (st === 'series' && !runSeries) return false;
    if (Number(log?.releasedAt || 0) > 0) return false;
    return isReleaseDateDue({ releaseDate: log?.releaseDate, nowTs: now(), timeZone: tz });
  });
  const mount = await getMountSettings();
  const mountDir = normalizeMountDir(mount?.mountDir || '');

  const engineHost = await getEngineHost();
  const shouldUseSsh = Boolean(engineHost?.host);
  const ssh = shouldUseSsh ? sshFromEngineHost(engineHost) : null;
  const startedAt = now();
  const out = {
    ok: true,
    processedLogs: 0,
    releasedItems: 0,
    droppedItems: 0,
    failedItems: 0,
    releaseDirsPruned: 0,
    logs: [],
  };
  const pendingScan = { moviesScanPending: false, seriesScanPending: false };
  const itemsNeedingTorrentDelete = [];
  const notifications = [];
  const releaseDirsToCleanup = new Set();

  try {
    if (ssh) await ssh.connect({ timeoutMs: 20000 });

    for (const log of dueLogs) {
      const logId = String(log?.id || '').trim();
      const typeNorm = normalizeType(log?.selectionType || 'movie');
      const queueKey = toQueueKey(typeNorm);
      const rows = db[queueKey];

      let released = 0;
      let dropped = 0;
      let failed = 0;

      for (let i = 0; i < rows.length; i += 1) {
        const rec = rows[i];
        if (String(rec?.selectionLogId || '').trim() !== logId) continue;
        if (String(rec?.releaseState || '').toLowerCase() === 'released') continue;

        const status = String(rec?.status || '').toLowerCase();
        const targetDir = resolveReleaseTargetDir({ rec, type: typeNorm });
        if (status === 'cleaned' && rec?.holdDir && targetDir) {
          if (!ssh) {
            failed += 1;
            rows[i] = {
              ...rec,
              releaseState: 'failed_release',
              error: 'Release move skipped: Engine host SSH unavailable.',
            };
            continue;
          }
          const filteredSubs = await filterHoldSubtitles({
            ssh,
            holdDir: rec.holdDir,
            settings,
          }).catch((e) => ({ ok: false, error: e?.message || 'subtitle cleanup failed' }));
          if (filteredSubs?.ok === false && !filteredSubs?.missing) {
            failed += 1;
            rows[i] = {
              ...rec,
              releaseState: 'failed_release',
              error: filteredSubs?.error || 'Release subtitle cleanup failed.',
            };
            continue;
          }
          const mv = await moveHoldAssets({
            ssh,
            fromDir: rec.holdDir,
            toDir: targetDir,
          }).catch((e) => ({ ok: false, error: e?.message || 'move failed' }));

          if (mv?.ok) {
            const releaseTagDir = releaseTagDirFromHold({
              holdDir: rec?.holdDir,
              releaseTag: rec?.releaseTag,
            });
            if (releaseTagDir) releaseDirsToCleanup.add(releaseTagDir);

            rows[i] = {
              ...rec,
              releaseState: 'released',
              releasedAt: now(),
              finalTargetDir: targetDir,
              finalDir: targetDir,
              error: '',
            };
            released += 1;
            pendingScan[typeNorm === 'series' ? 'seriesScanPending' : 'moviesScanPending'] = true;
            notifications.push({
              tmdbId: Number(rec?.tmdb?.id || 0),
              mediaType: toMediaType(typeNorm),
              title: String(rec?.tmdb?.title || rec?.title || '').trim(),
            });
            continue;
          }
          failed += 1;
          rows[i] = {
            ...rec,
            status: 'Deleted',
            releaseState: 'failed_release',
            releasedAt: now(),
            cleanedAt: rec?.cleanedAt || now(),
            error: mv?.error || 'Release move failed',
          };
          dropped += 1;
          continue;
        }

        if (status !== 'deleted') {
          rows[i] = {
            ...rec,
            status: 'Deleted',
            releaseState: 'expired',
            releasedAt: now(),
            cleanedAt: rec?.cleanedAt || now(),
            error: 'Release date reached before item became ready.',
          };
          dropped += 1;
          if (rec?.qbHash) {
            itemsNeedingTorrentDelete.push({ id: String(rec.id), type: typeNorm });
          }
        }
      }

      const logIdx = db.selectionLogs.findIndex((x) => String(x?.id || '') === logId);
      if (logIdx >= 0) {
        const markReleased = failed === 0 || released > 0 || dropped > 0;
        db.selectionLogs[logIdx] = {
          ...db.selectionLogs[logIdx],
          releasedAt: markReleased ? now() : db.selectionLogs[logIdx]?.releasedAt || null,
          releaseSummary: {
            released,
            dropped,
            failed,
            processedAt: now(),
          },
          updatedAt: now(),
        };
      }

      out.logs.push({
        id: logId,
        type: typeNorm,
        releaseDate: String(log?.releaseDate || ''),
        releaseTag: String(log?.releaseTag || ''),
        released,
        dropped,
        failed,
      });
      out.processedLogs += 1;
      out.releasedItems += released;
      out.droppedItems += dropped;
      out.failedItems += failed;
    }

    if (ssh && releaseDirsToCleanup.size) {
      for (const dir of releaseDirsToCleanup) {
        await removeDirIfEmpty({ ssh, dir, pruneChildren: true }).catch(() => null);
      }
    }

    if (ssh && mountDir) {
      const pruned = await cleanupEmptyReleaseTagDirs({ ssh, mountDir, settings }).catch(() => null);
      out.releaseDirsPruned = Number(pruned?.removed || 0);
    }

    if (dueLogs.length) {
      await saveAdminDb(db);
    }
  } finally {
    if (ssh) await ssh.close();
  }

  if (!dueLogs.length) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_due_release',
      releaseDirsPruned: out.releaseDirsPruned,
      startedAt,
      finishedAt: now(),
    };
  }

  if (itemsNeedingTorrentDelete.length) {
    for (const row of itemsNeedingTorrentDelete) {
      try {
        await controlDownload({
          type: row.type,
          id: row.id,
          action: 'delete',
          deleteArtifacts: false,
          preserveSelectionLog: true,
        });
      } catch {}
    }
  }

  if (pendingScan.moviesScanPending || pendingScan.seriesScanPending) {
    await updateXuiScanState(pendingScan).catch(() => null);
  }

  if (notifications.length) {
    const dbNow = await getAdminDb();
    const uniq = [];
    const seen = new Set();
    for (const row of notifications) {
      const key = rowKey(row?.tmdbId, row?.mediaType);
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(row);
    }
    for (const row of uniq) {
      const users = reminderSubscribersFor(dbNow, row.tmdbId, row.mediaType);
      for (const username of users) {
        await createUserNotification({
          username,
          type: 'upcoming_release',
          title: 'Now available',
          message: `${row.title || 'A title'} is now available in the library.`,
          meta: {
            tmdbId: row.tmdbId,
            mediaType: row.mediaType,
          },
        }).catch(() => null);
      }
    }
  }

  return {
    ...out,
    finishedAt: now(),
    startedAt,
  };
}
