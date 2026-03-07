import 'server-only';

import { decryptString } from '../vault';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from './autodownloadDb';
import { SSHService } from './sshService';

const DEFAULT_VIDEO_EXTENSIONS = ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'];
const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'sub', 'vtt'];
const DEFAULT_KEEP_SUB_LANGUAGES = ['en', 'tl'];
const DEFAULT_LANGUAGE_PATTERNS = {
  en: '(eng|english|en)',
  tl: '(tag|fil|filipino|tl)',
};
const DEFAULT_CLEANING_TEMPLATES = {
  movieFolder: '{title} ({year})-{quality}',
  movieFile: '{title} ({year})-{quality}',
  movieSubtitle: '{title} ({year})-{quality}.{lang}',
  seriesFolder: '{title} ({year})',
  seriesSeasonFolder: 'Season {season}',
  seriesEpisode: '{title} - S{season}E{episode}',
  seriesSubtitle: '{title} - S{season}E{episode}.{lang}',
};

function now() {
  return Date.now();
}

function normalizeList(values, fallback = []) {
  const list = Array.isArray(values) ? values : fallback;
  return list
    .map((x) => String(x || '').trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
    .filter((x, index, arr) => arr.indexOf(x) === index);
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

function normalizeTemplateValue(value, fallback) {
  const next = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (next || fallback).slice(0, 200);
}

function getLibraryCleaningConfig(settings) {
  const fileRules = settings?.fileRules || {};
  const cleaning = settings?.cleaning || {};
  const templates = cleaning?.templates || {};
  return {
    createMovieFolderIfMissing: cleaning?.createMovieFolderIfMissing !== false,
    fileRules: {
      videoExtensions: normalizeList(fileRules?.videoExtensions, DEFAULT_VIDEO_EXTENSIONS),
      subtitleExtensions: normalizeList(fileRules?.subtitleExtensions, DEFAULT_SUBTITLE_EXTENSIONS),
      keepSubtitleLanguages: normalizeList(fileRules?.keepSubtitleLanguages, DEFAULT_KEEP_SUB_LANGUAGES),
      languagePatterns: normalizePatterns(fileRules?.languagePatterns, DEFAULT_LANGUAGE_PATTERNS),
      skipSample: fileRules?.skipSample !== false,
    },
    templates: {
      movieFolder: normalizeTemplateValue(templates?.movieFolder, DEFAULT_CLEANING_TEMPLATES.movieFolder),
      movieFile: normalizeTemplateValue(templates?.movieFile, DEFAULT_CLEANING_TEMPLATES.movieFile),
      movieSubtitle: normalizeTemplateValue(templates?.movieSubtitle, DEFAULT_CLEANING_TEMPLATES.movieSubtitle),
      seriesFolder: normalizeTemplateValue(templates?.seriesFolder, DEFAULT_CLEANING_TEMPLATES.seriesFolder),
      seriesSeasonFolder: normalizeTemplateValue(
        templates?.seriesSeasonFolder,
        DEFAULT_CLEANING_TEMPLATES.seriesSeasonFolder
      ),
      seriesEpisode: normalizeTemplateValue(templates?.seriesEpisode, DEFAULT_CLEANING_TEMPLATES.seriesEpisode),
      seriesSubtitle: normalizeTemplateValue(templates?.seriesSubtitle, DEFAULT_CLEANING_TEMPLATES.seriesSubtitle),
    },
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

function buildCleanerScript(payloadBase64) {
  return `
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y >/dev/null 2>&1 || true
    apt-get install -y python3 >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 >/dev/null 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3 >/dev/null 2>&1 || true
  fi
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo '{"ok":false,"error":"python3 is required on Engine Host for clean library"}'
  exit 2
fi

export PAYLOAD_B64='${payloadBase64}'
python3 - <<'PY'
import base64
import json
import os
import re
import shutil
import time

payload = json.loads(base64.b64decode(os.environ.get("PAYLOAD_B64", "")).decode("utf-8"))
dry_run = bool(payload.get("dryRun", True))
sample_limit = int(payload.get("sampleLimit", 50) or 50)
sample_limit = max(5, min(20000, sample_limit))
mount_dir = str(payload.get("mountDir", "")).strip().rstrip("/")
config = payload.get("config", {}) or {}
rules = config.get("fileRules", {}) or {}
templates = config.get("templates", {}) or {}
create_movie_folder_if_missing = bool(config.get("createMovieFolderIfMissing", True))

movies_root = os.path.join(mount_dir, "Movies")
series_root = os.path.join(mount_dir, "Series")

video_exts = set(str(x).strip().lower().replace(".", "") for x in (rules.get("videoExtensions") or []) if str(x).strip())
sub_exts = set(str(x).strip().lower().replace(".", "") for x in (rules.get("subtitleExtensions") or []) if str(x).strip())
keep_langs = set(str(x).strip().lower() for x in (rules.get("keepSubtitleLanguages") or []) if str(x).strip())
skip_sample = bool(rules.get("skipSample", True))
lang_patterns_raw = rules.get("languagePatterns") or {}

if not video_exts:
  video_exts = {"mkv", "mp4", "avi", "mov", "wmv", "m4v", "mpg", "mpeg", "ts", "webm"}
if not sub_exts:
  sub_exts = {"srt", "ass", "ssa", "sub", "vtt"}

default_lang_patterns = {
  "en": "(eng|english|en)",
  "tl": "(tag|fil|filipino|tl)",
}
lang_patterns_compiled = {}
for lang, expr in {**default_lang_patterns, **lang_patterns_raw}.items():
  key = str(lang).strip().lower()
  value = str(expr or "").strip()
  if not key or not value:
    continue
  try:
    lang_patterns_compiled.setdefault(key, []).append(re.compile(value, re.I))
  except re.error:
    pass

movie_folder_tpl = str(templates.get("movieFolder") or "{title} ({year})-{quality}").strip()
movie_file_tpl = str(templates.get("movieFile") or "{title} ({year})-{quality}").strip()
movie_sub_tpl = str(templates.get("movieSubtitle") or "{title} ({year})-{quality}.{lang}").strip()
series_folder_tpl = str(templates.get("seriesFolder") or "{title} ({year})").strip()
series_season_tpl = str(templates.get("seriesSeasonFolder") or "Season {season}").strip()
series_episode_tpl = str(templates.get("seriesEpisode") or "{title} - S{season}E{episode}").strip()
series_sub_tpl = str(templates.get("seriesSubtitle") or "{title} - S{season}E{episode}.{lang}").strip()

invalid_name_chars = re.compile(r'[<>:"/\\\\|?*\\x00-\\x1F]')
token_re = re.compile(r"\\{([a-z_]+)\\}", re.I)

summary = {
  "movieTitlesScanned": 0,
  "seriesTitlesScanned": 0,
  "titlesAffected": 0,
  "movieTitlesAffected": 0,
  "seriesTitlesAffected": 0,
  "filesMoved": 0,
  "filesRenamed": 0,
  "filesDeleted": 0,
  "deletedByExtension": {},
  "deletedByReason": {},
  "videosDeleted": 0,
  "subtitlesDeleted": 0,
  "foldersRenamed": 0,
  "foldersCreated": 0,
  "foldersDeleted": 0,
  "warnings": 0,
}
samples = {"changes": [], "deletes": [], "warnings": []}
planned_targets = set()
planned_created_dirs = set()

def add_sample(kind, value):
  arr = samples.get(kind)
  if arr is None:
    return
  if len(arr) < sample_limit:
    arr.append(value)

def warn(msg):
  summary["warnings"] += 1
  add_sample("warnings", str(msg))

def sanitize_name(value, fallback="Untitled"):
  s = str(value or "").strip()
  s = invalid_name_chars.sub("", s)
  s = re.sub(r"\\s+", " ", s).strip().rstrip(". ")
  return (s[:180] or fallback)

def render_template(template, tokens, fallback="Untitled", keep_unknown=False):
  tpl = str(template or "").strip() or fallback
  token_map = {str(k).lower(): str(v or "") for k, v in (tokens or {}).items()}
  def repl(match):
    key = str(match.group(1) or "").lower()
    if key in token_map:
      return token_map.get(key, "")
    return match.group(0) if keep_unknown else ""
  out = token_re.sub(repl, tpl)
  out = re.sub(r"\\s+", " ", out)
  out = re.sub(r"\\(\\s*\\)", "", out)
  out = re.sub(r"-+", "-", out)
  out = re.sub(r"\\.+", ".", out)
  out = out.strip(" ._-")
  return sanitize_name(out, fallback=fallback)

def within_root(path, root):
  p = os.path.realpath(path)
  r = os.path.realpath(root)
  return p == r or p.startswith(r + os.sep)

def allowed_path(path):
  return within_root(path, movies_root) or within_root(path, series_root)

def ext_of(path):
  base = os.path.basename(path)
  if "." not in base:
    return ""
  return base.rsplit(".", 1)[1].lower()

def is_video(path):
  return ext_of(path) in video_exts

def is_subtitle(path):
  return ext_of(path) in sub_exts

def looks_like_sample(path):
  return "sample" in os.path.basename(path).lower()

def unique_path(target):
  base, ext = os.path.splitext(target)
  candidate = target
  idx = 2
  while os.path.exists(candidate) or candidate in planned_targets:
    candidate = f"{base} ({idx}){ext}"
    idx += 1
    if idx > 999:
      break
  planned_targets.add(candidate)
  return candidate

def mark_affected(ctx, media_type):
  if ctx.get("affected"):
    return
  ctx["affected"] = True
  summary["titlesAffected"] += 1
  if media_type == "movie":
    summary["movieTitlesAffected"] += 1
  else:
    summary["seriesTitlesAffected"] += 1

def ensure_parent(path):
  parent = os.path.dirname(path)
  if not parent:
    return
  if not allowed_path(parent):
    warn(f"Skipped create outside allowed roots: {parent}")
    return
  if os.path.isdir(parent):
    return
  missing = []
  cur = parent
  while cur and not os.path.isdir(cur):
    if not allowed_path(cur):
      warn(f"Skipped create outside allowed roots: {cur}")
      return
    missing.append(cur)
    nxt = os.path.dirname(cur)
    if nxt == cur:
      break
    cur = nxt
  for d in reversed(missing):
    if d in planned_created_dirs:
      continue
    planned_created_dirs.add(d)
    summary["foldersCreated"] += 1
    add_sample("changes", {"action": "folder_create", "to": d})
  if dry_run:
    return
  os.makedirs(parent, exist_ok=True)

def move_path(src, dst, ctx, media_type, action_label):
  src = str(src or "")
  dst = str(dst or "")
  if not src or not dst:
    return dst
  if os.path.realpath(src) == os.path.realpath(dst):
    return src
  if not allowed_path(src) or not allowed_path(dst):
    warn(f"Skipped move outside allowed roots: {src} -> {dst}")
    return src
  target = unique_path(dst)
  same_parent = os.path.dirname(src) == os.path.dirname(target)
  mark_affected(ctx, media_type)
  if same_parent:
    summary["filesRenamed"] += 1
  else:
    summary["filesMoved"] += 1
  add_sample("changes", {"action": action_label, "from": src, "to": target})
  if dry_run:
    return target
  if not os.path.exists(src):
    return src
  ensure_parent(target)
  shutil.move(src, target)
  return target

def delete_path(path, ctx=None, media_type=None, reason="", kind="file"):
  p = str(path or "")
  if not p:
    return
  if not allowed_path(p):
    warn(f"Skipped delete outside allowed roots: {p}")
    return
  if not os.path.exists(p):
    return
  if ctx is not None and media_type:
    mark_affected(ctx, media_type)
  if kind == "folder":
    summary["foldersDeleted"] += 1
  else:
    summary["filesDeleted"] += 1
    ext = ext_of(p)
    ext_key = ext if ext else "unknown"
    summary["deletedByExtension"][ext_key] = int(summary["deletedByExtension"].get(ext_key, 0)) + 1
    reason_key = str(reason or "deleted").strip().lower() or "deleted"
    summary["deletedByReason"][reason_key] = int(summary["deletedByReason"].get(reason_key, 0)) + 1
  if "subtitle" in reason:
    summary["subtitlesDeleted"] += 1
  if "video" in reason:
    summary["videosDeleted"] += 1
  add_sample("deletes", {"path": p, "reason": reason or "deleted", "kind": kind})
  if dry_run:
    return
  try:
    if os.path.isdir(p) and not os.path.islink(p):
      shutil.rmtree(p, ignore_errors=True)
    else:
      os.remove(p)
  except FileNotFoundError:
    return
  except Exception as err:
    warn(f"Delete failed {p}: {err}")

def prune_empty_dirs(start_dir, stop_dir, ctx=None, media_type=None):
  s = str(start_dir or "").strip()
  stop = str(stop_dir or "").strip()
  if not s or not os.path.isdir(s):
    return
  for root, dirs, files in os.walk(s, topdown=False):
    if os.path.realpath(root) == os.path.realpath(stop):
      continue
    if dirs or files:
      continue
    if not allowed_path(root):
      continue
    delete_path(root, ctx=ctx, media_type=media_type, reason="empty folder", kind="folder")

def parse_title_year(value):
  raw = str(value or "").strip()
  if not raw:
    return ("Untitled", "")
  base = os.path.splitext(os.path.basename(raw))[0]
  base = base.replace(".", " ").replace("_", " ")
  base = re.sub(r"\\[[^\\]]+\\]", " ", base)
  base = re.sub(
    r"(?i)\\b(2160p|1080p|720p|480p|4k|uhd|hdr10\\+?|hdr|x264|x265|h264|h265|hevc|av1|web[- ]?dl|web[- ]?rip|webrip|bluray|brrip|bdrip|hdrip|remux|yts(?:\\.?mx)?)\\b",
    " ",
    base,
  )
  base = re.sub(r"\\(\\s*\\)", " ", base)
  year_match = re.search(r"(19\\d{2}|20\\d{2})", base)
  year = year_match.group(1) if year_match else ""
  title = base
  if year:
    title = title.replace(year, " ")
  title = re.sub(r"\\s+", " ", title).strip(" -_.")
  return (sanitize_name(title or base), year)

def strip_quality_tokens(title, quality="", resolution=""):
  s = str(title or "").strip()
  if not s:
    return ""
  markers = {"2160p", "1080p", "720p", "480p", "4k"}
  if quality:
    markers.add(str(quality).strip().lower())
  if resolution:
    markers.add(str(resolution).strip().lower())
  for marker in list(markers):
    if not marker:
      continue
    s = re.sub(rf"(?i)(^|[\\s._-]){re.escape(marker)}(?=$|[\\s._-])", " ", s)
  s = re.sub(r"\\(\\s*\\)", " ", s)
  s = re.sub(r"\\s+", " ", s).strip(" -_.")
  return sanitize_name(s) if s else ""

def detect_resolution(value):
  m = re.search(r"\\b(2160p|1080p|720p|480p|4k)\\b", str(value or "").lower())
  if not m:
    return ""
  r = str(m.group(1) or "").lower()
  return "2160p" if r == "4k" else r

def detect_lang(path):
  name = os.path.basename(path).lower()
  for lang, exprs in lang_patterns_compiled.items():
    for expr in exprs:
      if expr.search(name):
        return lang
  if re.search(r"(^|[._ -])(en|eng|english)([._ -]|$)", name):
    return "en"
  if re.search(r"(^|[._ -])(tl|tag|fil|filipino|tagalog)([._ -]|$)", name):
    return "tl"
  return ""

def parse_season_episode(path):
  name = os.path.splitext(os.path.basename(path))[0]
  checks = [name]
  parent = os.path.dirname(path)
  while parent and parent != "/" and parent not in checks:
    checks.append(os.path.basename(parent))
    parent = os.path.dirname(parent)
  for text in checks:
    m = re.search(r"[sS](\\d{1,2})[eE](\\d{1,3})", text)
    if m:
      return (int(m.group(1)), int(m.group(2)))
    m = re.search(r"(\\d{1,2})x(\\d{1,3})", text, re.I)
    if m:
      return (int(m.group(1)), int(m.group(2)))
  return (None, None)

def safe_size(path):
  try:
    return os.path.getsize(path)
  except Exception:
    return 0

def process_movie_unit(unit_path, genre_dir):
  ctx = {"affected": False}
  files = []
  if os.path.isdir(unit_path):
    for root, _, names in os.walk(unit_path):
      for name in names:
        files.append(os.path.join(root, name))
  elif os.path.isfile(unit_path):
    files.append(unit_path)
    stem = os.path.splitext(os.path.basename(unit_path))[0].lower()
    try:
      for name in os.listdir(genre_dir):
        sib = os.path.join(genre_dir, name)
        if sib == unit_path or not os.path.isfile(sib):
          continue
        if os.path.splitext(name)[0].lower() == stem:
          files.append(sib)
    except Exception:
      pass

  files = sorted(set(files))
  if not files:
    return ctx

  video_files = []
  subtitle_files = []
  other_files = []
  for path in files:
    if is_video(path):
      if skip_sample and looks_like_sample(path):
        other_files.append(path)
      else:
        video_files.append(path)
      continue
    if is_subtitle(path):
      subtitle_files.append(path)
      continue
    other_files.append(path)

  if not video_files:
    for f in files:
      reason = "subtitle without video" if is_subtitle(f) else "unsupported file"
      delete_path(f, ctx=ctx, media_type="movie", reason=reason, kind="file")
    if os.path.isdir(unit_path):
      prune_empty_dirs(unit_path, genre_dir, ctx=ctx, media_type="movie")
    return ctx

  primary_video = sorted(video_files, key=lambda x: safe_size(x), reverse=True)[0]
  title_hint, year_hint = parse_title_year(primary_video if os.path.isfile(primary_video) else unit_path)
  if title_hint == "Untitled" and os.path.isdir(unit_path):
    title_hint, year_hint = parse_title_year(os.path.basename(unit_path))
  resolution = detect_resolution(primary_video) or detect_resolution(os.path.basename(unit_path))
  quality = resolution or "HD"
  normalized_title = strip_quality_tokens(title_hint, quality=quality, resolution=resolution)
  if normalized_title:
    title_hint = normalized_title
  tokens = {
    "title": title_hint,
    "year": year_hint or "",
    "quality": quality,
    "resolution": resolution or quality,
  }

  ext = ext_of(primary_video)
  movie_base = render_template(movie_file_tpl, tokens, fallback=f"{title_hint} ({year_hint})-{quality}" if year_hint else f"{title_hint}-{quality}")
  movie_folder_name = render_template(movie_folder_tpl, tokens, fallback=movie_base)
  movie_target_root = genre_dir
  unit_is_dir = os.path.isdir(unit_path)
  if create_movie_folder_if_missing:
    desired_movie_dir = os.path.join(genre_dir, movie_folder_name)
    if unit_is_dir:
      if os.path.realpath(desired_movie_dir) != os.path.realpath(unit_path):
        desired_movie_dir = unique_path(desired_movie_dir)
        summary["foldersRenamed"] += 1
        mark_affected(ctx, "movie")
        add_sample("changes", {"action": "movie_folder", "from": unit_path, "to": desired_movie_dir})
    elif not os.path.exists(desired_movie_dir) and desired_movie_dir not in planned_targets:
      summary["foldersCreated"] += 1
      mark_affected(ctx, "movie")
      add_sample("changes", {"action": "movie_folder_create", "from": unit_path, "to": desired_movie_dir})
    movie_target_root = desired_movie_dir
  video_target = os.path.join(movie_target_root, f"{movie_base}.{ext}")
  final_video = move_path(primary_video, video_target, ctx=ctx, media_type="movie", action_label="movie_video")

  for dup in video_files:
    if dup == primary_video:
      continue
    delete_path(dup, ctx=ctx, media_type="movie", reason="duplicate video", kind="file")

  for sub in subtitle_files:
    lang = detect_lang(sub)
    if keep_langs and (not lang or lang not in keep_langs):
      delete_path(sub, ctx=ctx, media_type="movie", reason="subtitle language filtered", kind="file")
      continue
    sub_ext = ext_of(sub)
    final_video_base = os.path.splitext(os.path.basename(final_video))[0]
    if lang:
      sub_base = render_template(movie_sub_tpl, {**tokens, "lang": lang}, fallback=f"{final_video_base}.{lang}")
    else:
      sub_base = final_video_base
    sub_target = os.path.join(movie_target_root, f"{sub_base}.{sub_ext}")
    move_path(sub, sub_target, ctx=ctx, media_type="movie", action_label="movie_subtitle")

  for junk in other_files:
    reason = "sample video removed" if is_video(junk) else "unsupported file"
    delete_path(junk, ctx=ctx, media_type="movie", reason=reason, kind="file")

  if os.path.isdir(unit_path):
    prune_empty_dirs(unit_path, genre_dir, ctx=ctx, media_type="movie")
  return ctx

def process_series_folder(series_dir, genre_dir):
  ctx = {"affected": False}
  files = []
  for root, _, names in os.walk(series_dir):
    for name in names:
      files.append(os.path.join(root, name))
  files = sorted(set(files))

  series_name, series_year = parse_title_year(os.path.basename(series_dir))
  folder_tokens = {"title": series_name, "year": series_year}
  desired_series_name = render_template(series_folder_tpl, folder_tokens, fallback=os.path.basename(series_dir))
  desired_series_dir = os.path.join(genre_dir, desired_series_name)
  if os.path.realpath(desired_series_dir) != os.path.realpath(series_dir):
    desired_series_dir = unique_path(desired_series_dir)
    summary["foldersRenamed"] += 1
    mark_affected(ctx, "series")
    add_sample("changes", {"action": "series_folder", "from": series_dir, "to": desired_series_dir})

  kept_videos = 0
  for path in files:
    if not os.path.isfile(path):
      continue
    if is_video(path):
      if skip_sample and looks_like_sample(path):
        delete_path(path, ctx=ctx, media_type="series", reason="sample video removed", kind="file")
        continue
      season, episode = parse_season_episode(path)
      if season is None or episode is None:
        delete_path(path, ctx=ctx, media_type="series", reason="video missing season/episode", kind="file")
        continue
      kept_videos += 1
      season_token = f"{int(season):02d}"
      episode_token = f"{int(episode):02d}"
      res = detect_resolution(path)
      q = res or "HD"
      tokens = {
        "title": series_name,
        "year": series_year,
        "quality": q,
        "resolution": res or q,
        "season": season_token,
        "episode": episode_token,
      }
      season_folder_name = render_template(series_season_tpl, tokens, fallback=f"Season {season_token}")
      episode_base = render_template(
        series_episode_tpl,
        tokens,
        fallback=f"{series_name} - S{season_token}E{episode_token}",
      )
      target = os.path.join(desired_series_dir, season_folder_name, f"{episode_base}.{ext_of(path)}")
      move_path(path, target, ctx=ctx, media_type="series", action_label="series_episode")
      continue

    if is_subtitle(path):
      season, episode = parse_season_episode(path)
      if season is None or episode is None:
        delete_path(path, ctx=ctx, media_type="series", reason="subtitle missing season/episode", kind="file")
        continue
      lang = detect_lang(path)
      if keep_langs and (not lang or lang not in keep_langs):
        delete_path(path, ctx=ctx, media_type="series", reason="subtitle language filtered", kind="file")
        continue
      season_token = f"{int(season):02d}"
      episode_token = f"{int(episode):02d}"
      tokens = {
        "title": series_name,
        "year": series_year,
        "season": season_token,
        "episode": episode_token,
        "lang": lang or "sub",
      }
      season_folder_name = render_template(series_season_tpl, tokens, fallback=f"Season {season_token}")
      sub_base = render_template(
        series_sub_tpl,
        tokens,
        fallback=f"{series_name} - S{season_token}E{episode_token}.{lang or 'sub'}",
      )
      target = os.path.join(desired_series_dir, season_folder_name, f"{sub_base}.{ext_of(path)}")
      move_path(path, target, ctx=ctx, media_type="series", action_label="series_subtitle")
      continue

    delete_path(path, ctx=ctx, media_type="series", reason="unsupported file", kind="file")

  prune_empty_dirs(series_dir, genre_dir, ctx=ctx, media_type="series")
  if os.path.realpath(desired_series_dir) != os.path.realpath(series_dir):
    prune_empty_dirs(desired_series_dir, genre_dir, ctx=ctx, media_type="series")
  if kept_videos == 0 and os.path.isdir(series_dir):
    prune_empty_dirs(series_dir, genre_dir, ctx=ctx, media_type="series")
  return ctx

def scan_movies():
  if not os.path.isdir(movies_root):
    return
  for category in sorted(os.listdir(movies_root)):
    category_path = os.path.join(movies_root, category)
    if not os.path.isdir(category_path):
      continue
    for genre in sorted(os.listdir(category_path)):
      genre_path = os.path.join(category_path, genre)
      if not os.path.isdir(genre_path):
        continue
      try:
        top_entries = sorted(os.listdir(genre_path))
      except Exception as err:
        warn(f"Failed to list movie genre folder {genre_path}: {err}")
        continue
      processed = set()
      for name in top_entries:
        path = os.path.join(genre_path, name)
        if path in processed:
          continue
        if os.path.isdir(path):
          summary["movieTitlesScanned"] += 1
          process_movie_unit(path, genre_path)
          processed.add(path)
          continue
        if os.path.isfile(path) and is_video(path):
          summary["movieTitlesScanned"] += 1
          process_movie_unit(path, genre_path)
          processed.add(path)
          stem = os.path.splitext(os.path.basename(path))[0].lower()
          for sib in top_entries:
            sib_path = os.path.join(genre_path, sib)
            if os.path.splitext(sib)[0].lower() == stem:
              processed.add(sib_path)
          continue
        if os.path.isfile(path):
          reason = "orphan subtitle" if is_subtitle(path) else "unsupported file"
          delete_path(path, reason=reason, kind="file")
          processed.add(path)

def scan_series():
  if not os.path.isdir(series_root):
    return
  for genre in sorted(os.listdir(series_root)):
    genre_path = os.path.join(series_root, genre)
    if not os.path.isdir(genre_path):
      continue
    for series_name in sorted(os.listdir(genre_path)):
      series_path = os.path.join(genre_path, series_name)
      if not os.path.isdir(series_path):
        if os.path.isfile(series_path):
          reason = "unsupported file"
          delete_path(series_path, reason=reason, kind="file")
        continue
      summary["seriesTitlesScanned"] += 1
      process_series_folder(series_path, genre_path)

started_at = int(time.time() * 1000)
error = ""
try:
  if not mount_dir:
    raise RuntimeError("Storage & Mount is not configured.")
  scan_movies()
  scan_series()
except Exception as exc:
  error = str(exc)

result = {
  "ok": error == "",
  "dryRun": dry_run,
  "mountDir": mount_dir,
  "roots": {
    "movies": movies_root,
    "series": series_root,
  },
  "summary": summary,
  "samples": samples,
  "startedAt": started_at,
  "finishedAt": int(time.time() * 1000),
}
if error:
  result["error"] = error
print(json.dumps(result))
PY
`;
}

async function runLibraryCleaner({ dryRun = true, sampleLimit = 5000 } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost?.host) throw new Error('No Engine Host configured.');
  const mount = await getMountSettings();
  const mountDir = String(mount?.mountDir || '').trim();
  if (!mountDir) throw new Error('Storage & Mount is not configured.');
  const settings = await getAutodownloadSettings();
  const config = getLibraryCleaningConfig(settings);
  const payload = {
    dryRun: Boolean(dryRun),
    sampleLimit: Math.max(5, Math.min(20000, Number(sampleLimit || 5000) || 5000)),
    mountDir,
    config,
    startedAt: now(),
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    const script = buildCleanerScript(payloadBase64);
    const out = await ssh.execScript(script, { sudo: true, timeoutMs: 2 * 60 * 60 * 1000 });
    if (Number(out?.code || 0) !== 0) {
      throw new Error(String(out?.stderr || out?.stdout || 'Clean library command failed.').trim());
    }
    const stdout = String(out?.stdout || '').trim();
    const lines = stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    let parsed = null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        parsed = JSON.parse(lines[i]);
        break;
      } catch {}
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid cleaner response payload.');
    }
    return parsed;
  } finally {
    await ssh.close();
  }
}

export async function previewLibraryCleaning({ sampleLimit = 5000 } = {}) {
  return runLibraryCleaner({ dryRun: true, sampleLimit });
}

export async function cleanLibrary({ sampleLimit = 5000 } = {}) {
  return runLibraryCleaner({ dryRun: false, sampleLimit });
}
