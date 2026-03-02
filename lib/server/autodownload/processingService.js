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

function sanitizeFsName(name) {
  const s = String(name || '').trim();
  const cleaned = s
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned.slice(0, 150) || 'Untitled';
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
  seriesName,
  mountDir,
  categoryBase,
  genreBase,
  videoExts,
  holdMode = false,
}) {
  const extsVideo = ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'];
  const extsSub = ['srt', 'ass', 'ssa', 'sub', 'vtt'];
  const vext = Array.isArray(videoExts) && videoExts.length ? videoExts : extsVideo;

  const lines = [
    'set -euo pipefail',
    '',
    `TYPE=${shQuote(type)}`,
    `DOWNLOAD_PATH=${shQuote(downloadPath)}`,
    `STAGE_DIR=${shQuote(stageDir)}`,
    `FINAL_DIR=${shQuote(finalDir)}`,
    `BASE_NAME=${shQuote(baseName)}`,
    `SERIES_NAME=${shQuote(seriesName || '')}`,
    `MOUNT_DIR=${shQuote(mountDir || '')}`,
    `CATEGORY_BASE=${shQuote(categoryBase || '')}`,
    `GENRE_BASE=${shQuote(genreBase || '')}`,
    `HOLD_MODE=${holdMode ? '1' : '0'}`,
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
    '  if [ -d "$DOWNLOAD_PATH" ]; then',
    '    mv "$DOWNLOAD_PATH" "$src/" || true',
    '    first="$(find "$src" -mindepth 1 -maxdepth 1 -type d -print -quit || true)"',
    '    if [ -n "$first" ]; then work="$first"; else work="$src"; fi',
    '  else',
    '    mv "$DOWNLOAD_PATH" "$src/" || true',
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
    "  if echo \"$lc\" | grep -Eq '(^|[._ -])(en|eng|english)([._ -]|$)'; then echo \"en\"; return 0; fi",
    "  if echo \"$lc\" | grep -Eq '(^|[._ -])(tl|tag|fil|filipino|tagalog)([._ -]|$)'; then echo \"tl\"; return 0; fi",
    '  echo ""',
    '  return 0',
    '}',
    '',
    '# Cleanup pass',
    'while IFS= read -r -d \'\' f; do',
    '  if is_video "$f"; then continue; fi',
    '  if is_sub "$f"; then',
    '    lang="$(sub_lang "$f")"',
    '    if [ -z "$lang" ]; then log_delete "$f"; rm -f "$f" || true; fi',
    '    continue',
    '  fi',
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
    '  if [ -d "$parent/$base" ]; then echo "$parent/$base"; return 0; fi',
    '  shopt -s nullglob',
    '  local best=""',
    '  for d in "$parent"/"$base"*; do',
    '    [ -d "$d" ] || continue',
    '    bn="$(basename "$d")"',
    '    if echo "$bn" | grep -Eq "^${base}(\\([0-9]+\\))?$"; then',
    '      best="$d"',
    '      break',
    '    fi',
    '  done',
    '  shopt -u nullglob',
    '  if [ -n "$best" ]; then echo "$best"; return 0; fi',
    '  mkdir -p "$parent/$base" >/dev/null 2>&1 || return 1',
    '  echo "$parent/$base"',
    '}',
    '',
    'count_videos() {',
    '  local dir="$1"',
    '  local expr=""',
    '  for e in $video_exts; do',
    '    if [ -z "$expr" ]; then expr="-iname *.$e"; else expr="$expr -o -iname *.$e"; fi',
    '  done',
    '  # shellcheck disable=SC2086',
    '  find "$dir" -type f \\( $expr \\) 2>/dev/null | wc -l | tr -d " "',
    '}',
    '',
    'rename_with_count() {',
    '  local dir="$1"',
    '  local base="$2"',
    '  local parent',
    '  parent="$(dirname "$dir")"',
    '  local n',
    '  n="$(count_videos "$dir" || echo 0)"',
    '  local want="${base}(${n})"',
    '  local cur',
    '  cur="$(basename "$dir")"',
    '  if [ "$cur" = "$want" ]; then echo "$dir"; return 0; fi',
    '  local dest="$parent/$want"',
    '  if [ -d "$dest" ]; then echo "$dir"; return 0; fi',
    '  mv "$dir" "$dest" >/dev/null 2>&1 || { echo "$dir"; return 0; }',
    '  echo "$dest"',
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
    '    [ -z "$lang" ] && continue',
    '    ext="${s##*.}"',
    '    dest="$FINAL_DIR/$BASE_NAME.$lang.$ext"',
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
    '    if [ -n "$season" ] && [ -n "$episode" ]; then',
    '      ss="$(printf \'%02d\' "$season")"',
    '      ee="$(printf \'%02d\' "$episode")"',
    '      new="${SERIES_NAME} - S${ss}E${ee}.${ext}"',
    '    else',
    '      new="${bn}"',
    '    fi',
    '    dest="$FINAL_DIR/$new"',
    '    mv "$f" "$dest"',
    '    log_move "$f" "$dest"',
    `  done < <(find "$work" -type f '(' ${extsVideo.map((e) => `-iname "*.${e}"`).join(' -o ')} ')' -print0)`,
    '',
    '  while IFS= read -r -d \'\' s; do',
    '    lang="$(sub_lang "$s")"',
    '    [ -z "$lang" ] && continue',
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
    '      base="${SERIES_NAME} - S${ss}E${ee}"',
    '    else',
    '      base="${name}"',
    '    fi',
    '    dest="$FINAL_DIR/${base}.${lang}.${ext}"',
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
    '# Update folder names with counts (Movies: Category+Genre, Series: Genre)',
    'if [ "$HOLD_MODE" != "1" ]; then',
    '  if [ "$TYPE" = "movie" ]; then',
    '    # Resolve actual dirs, then rename based on video counts',
    '    MOVIES_ROOT="$MOUNT_DIR/Movies"',
    '    catDir="$(dirname "$FINAL_DIR")"',
    '    catBase="$CATEGORY_BASE"',
    '    # If FINAL_DIR includes category/count, normalize base from CATEGORY_BASE anyway',
    '    catDir2="$(rename_with_count "$catDir" "$CATEGORY_BASE" || echo "$catDir")"',
    '    # genre is inside category; after category rename, path changes',
    '    genDir="$(resolve_dir "$catDir2" "$GENRE_BASE" || true)"',
    '    [ -n "$genDir" ] || genDir="$(dirname "$FINAL_DIR")"',
    '    genDir2="$(rename_with_count "$genDir" "$GENRE_BASE" || echo "$genDir")"',
    '    FINAL_DIR="$genDir2"',
    '    # refresh final video path',
    '    final_video="$(ls -1 "$FINAL_DIR/$BASE_NAME."* 2>/dev/null | head -n 1 || true)"',
    '  else',
    '    SERIES_ROOT="$MOUNT_DIR/Series"',
    '    seriesFolder="$(basename "$FINAL_DIR")"',
    '    genDir="$(dirname "$FINAL_DIR")"',
    '    genDir2="$(rename_with_count "$genDir" "$GENRE_BASE" || echo "$genDir")"',
    '    FINAL_DIR="$genDir2/$seriesFolder"',
    '  fi',
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
    'rm -rf "$STAGE_DIR" >/dev/null 2>&1 || true',
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
  if (!rec?.qbHash) throw new Error('Missing qBittorrent hash.');
  if (String(rec.status || '').toLowerCase() !== 'completed') throw new Error('Only Completed items can be processed.');

  list[idx] = { ...rec, status: 'Processing', processingStartedAt: now(), error: '' };
  db[key] = list;
  await saveAdminDb(db);

  const ssh = sshFromEngineHost(engineHost);
  try {
    const props = await qbGetProperties(ssh, { port, hash: rec.qbHash });
    let downloadPath = props?.content_path || '';
    if (!downloadPath) {
      const sp = String(props?.save_path || '').trim();
      const name = String(rec.qbName || '').trim();
      if (sp && name) downloadPath = `${sp.replace(/\/+$/, '')}/${name}`;
      else downloadPath = sp;
    }
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
    const holdDir = `${names.processingDir}/${releaseTag}/${rec.id}`;
    const baseName = sanitizeFsName(`${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}`);
    const seriesName = sanitizeFsName(tmdb.title);
    const videoExts =
      Array.isArray(settings?.fileRules?.videoExtensions) && settings.fileRules.videoExtensions.length
        ? settings.fileRules.videoExtensions
        : ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'];

    const script = processingScript({
      type: t,
      downloadPath,
      stageDir,
      finalDir: holdDir,
      baseName,
      seriesName,
      mountDir: mount.mountDir,
      categoryBase: names.categoryBase,
      genreBase: names.genreBase,
      videoExts,
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
      },
      releaseDate,
      releaseTag,
      releaseTimezone,
      releaseDelayDays,
      releaseState: 'waiting',
      releasedAt: null,
      holdDir: summary?.finalDir || holdDir,
      finalTargetDir: names.finalDir,
      finalDir: summary?.finalDir || holdDir,
      finalVideo: summary?.finalVideo || null,
      error: '',
    };

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
      finalTargetDir: names.finalDir,
      releaseDate,
      releaseTag,
      summary,
      status: 'ok',
    });

    // Remove torrent from qBittorrent but keep files (we moved them to hold folder).
    try {
      await qbDeleteTorrent(ssh, { port, hash: rec.qbHash, deleteFiles: false });
    } catch {}

    return { ok: true, item: next };
  } catch (e) {
    const msg = e?.message || 'Processing failed.';
    const db3 = await getAdminDb();
    const list3 = Array.isArray(db3[key]) ? db3[key] : [];
    const idx3 = list3.findIndex((x) => String(x?.id) === String(id));
    if (idx3 >= 0) {
      list3[idx3] = { ...list3[idx3], status: 'Failed', error: msg };
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

export async function processNextCompleted({ type = 'all' } = {}) {
  const db = await getAdminDb();
  const types = type === 'all' ? ['movie', 'series'] : [sanitizeType(type)];

  for (const t of types) {
    const key = dbKeyForType(t);
    const list = Array.isArray(db[key]) ? db[key] : [];
    const rec = list.find((x) => String(x?.status || '').toLowerCase() === 'completed');
    if (rec) return processOneCompleted({ type: t, id: rec.id });
  }

  return { ok: true, skipped: true };
}
