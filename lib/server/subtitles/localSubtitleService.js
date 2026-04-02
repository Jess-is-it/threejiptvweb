import 'server-only';

import path from 'node:path';

import { decryptString } from '../vault';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from '../autodownload/autodownloadDb';
import { getOrRefreshLibraryInventory } from '../autodownload/libraryInventoryService';
import { SSHService } from '../autodownload/sshService';

const SEARCH_CACHE_MS = 60 * 60 * 1000;
const FILE_CACHE_MS = 12 * 60 * 60 * 1000;
const searchCache = new Map();
const fileCache = new Map();
const PLAYABLE_EXTENSIONS = new Set(['srt', 'vtt']);
const DEFAULT_SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'sub', 'vtt'];
const DEFAULT_LANGUAGE_PATTERNS = {
  en: '(eng|english|en)',
  tl: '(tag|fil|filipino|tl)',
};
const LANGUAGE_LABELS = {
  en: 'English',
  tl: 'Tagalog',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
};

function now() {
  return Date.now();
}

function cleanCache(map) {
  const ts = now();
  for (const [key, value] of map.entries()) {
    if (!value?.expiresAt || value.expiresAt <= ts) map.delete(key);
  }
}

function shQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\u2019'":,!?()[\]._\-]/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hd|webrip|web dl|webdl|bluray|brrip|dvdrip|x264|x265|hevc|hdr|proper|repack)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(value = '') {
  return String(value || '')
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/\s*\[[^\]]+\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYear(value = '') {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

function titleScore(targetTitle, candidateTitle) {
  const target = normalizeText(cleanTitle(targetTitle));
  const candidate = normalizeText(cleanTitle(candidateTitle));
  if (!target || !candidate) return 0;
  if (target === candidate) return 140;
  if (candidate.includes(target)) return 105;
  if (target.includes(candidate)) return 85;
  const targetWords = new Set(target.split(' ').filter(Boolean));
  const candidateWords = candidate.split(' ').filter(Boolean);
  let overlap = 0;
  candidateWords.forEach((word) => {
    if (targetWords.has(word)) overlap += 1;
  });
  return overlap * 8;
}

function yearScore(targetYear, candidateYear) {
  const target = Number(targetYear || 0);
  const candidate = Number(candidateYear || 0);
  if (!target || !candidate) return 0;
  if (target === candidate) return 50;
  if (Math.abs(target - candidate) === 1) return 10;
  return -15;
}

function mapLanguageCode(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (raw.includes('tagalog') || raw.includes('filipino')) return 'tl';
  if (raw.includes('english')) return 'en';
  if (raw.includes('spanish')) return 'es';
  if (raw.includes('french')) return 'fr';
  if (raw.includes('german')) return 'de';
  if (raw.includes('japanese')) return 'ja';
  if (raw.includes('korean')) return 'ko';
  if (raw.includes('chinese')) return 'zh';
  if (raw === 'fil') return 'tl';
  if (raw === 'eng') return 'en';
  if (raw === 'tgl') return 'tl';
  if (raw === 'spa') return 'es';
  return raw.slice(0, 2);
}

function languageLabel(code = '', fallback = '') {
  const normalized = mapLanguageCode(code);
  return LANGUAGE_LABELS[normalized] || String(fallback || normalized || 'Subtitle').trim() || 'Subtitle';
}

function normalizeList(list, fallback = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const value = String(raw || '')
      .trim()
      .replace(/^\./, '')
      .toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length ? out : fallback;
}

function compileLanguagePatterns(fileRules = {}) {
  const merged = {
    ...DEFAULT_LANGUAGE_PATTERNS,
    ...(fileRules?.languagePatterns && typeof fileRules.languagePatterns === 'object' ? fileRules.languagePatterns : {}),
  };
  const compiled = [];
  for (const [lang, expr] of Object.entries(merged)) {
    const source = String(expr || '').trim();
    if (!source) continue;
    try {
      compiled.push({ lang: mapLanguageCode(lang), regex: new RegExp(source, 'i') });
    } catch {}
  }
  return compiled.filter((row) => row.lang && row.regex);
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

function pickBestMovieRow(rows, { title, year }) {
  const targetYear = Number(year || 0);
  let best = null;
  let bestScore = -Infinity;
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidateYear = Number(row?.year || parseYear(row?.title || '') || parseYear(row?.fileName || '') || 0);
    const score = titleScore(title, row?.title || '') + yearScore(targetYear, candidateYear);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  if (!best || bestScore < 60) return null;
  return best;
}

function pickBestSeriesRow(rows, { title, year }) {
  const targetYear = Number(year || 0);
  let best = null;
  let bestScore = -Infinity;
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidateYear = Number(row?.year || parseYear(row?.title || '') || 0);
    const score = titleScore(title, row?.title || '') + yearScore(targetYear, candidateYear);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  if (!best || bestScore < 60) return null;
  return best;
}

function buildFindSubtitleCommand(dir, extensions, maxDepth = 1) {
  const patterns = extensions
    .filter((ext) => PLAYABLE_EXTENSIONS.has(ext))
    .map((ext) => `-iname ${shQuote(`*.${ext}`)}`)
    .join(' -o ');
  return [
    `DIR=${shQuote(dir)}`,
    'if [ ! -d "$DIR" ]; then exit 0; fi',
    `find "$DIR" -maxdepth ${Math.max(1, Number(maxDepth || 1))} -type f \\( ${patterns} \\) -print 2>/dev/null || true`,
  ].join('\n');
}

function parseSeasonEpisode(value = '') {
  const raw = String(value || '');
  const compact = raw.match(/[._\-\s]s(\d{1,2})[._\-\s]?e(\d{1,2})/i) || raw.match(/\bs(\d{1,2})e(\d{1,2})\b/i);
  if (compact) {
    return {
      seasonNumber: Number(compact[1]),
      episodeNumber: Number(compact[2]),
    };
  }
  const alt = raw.match(/\b(\d{1,2})x(\d{1,2})\b/i);
  if (alt) {
    return {
      seasonNumber: Number(alt[1]),
      episodeNumber: Number(alt[2]),
    };
  }
  return {
    seasonNumber: null,
    episodeNumber: null,
  };
}

function inferLanguageFromFileName(fileName, compiledPatterns) {
  const base = path.basename(String(fileName || ''));
  for (const row of compiledPatterns) {
    if (row.regex.test(base)) return row.lang;
  }

  const parts = base.toLowerCase().split('.');
  for (const part of parts) {
    const code = mapLanguageCode(part);
    if (code) return code;
  }
  return '';
}

function encodeSubtitlePath(filePath) {
  return Buffer.from(String(filePath || ''), 'utf8').toString('base64url');
}

export function decodeSubtitlePath(encodedPath = '') {
  const raw = String(encodedPath || '').trim();
  if (!raw) return '';
  try {
    return Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function buildTrackUrl(filePath, { label, lang, ext }) {
  const u = new URL('/api/subtitles/local', 'http://localhost');
  u.searchParams.set('path', encodeSubtitlePath(filePath));
  if (label) u.searchParams.set('label', label);
  if (lang) u.searchParams.set('lang', lang);
  if (ext) u.searchParams.set('ext', ext);
  return `${u.pathname}${u.search}`;
}

async function getSubtitleConfig() {
  const settings = (await getAutodownloadSettings()) || {};
  const fileRules = settings?.fileRules || {};
  return {
    subtitleExtensions: normalizeList(fileRules?.subtitleExtensions, DEFAULT_SUBTITLE_EXTENSIONS),
    languagePatterns: compileLanguagePatterns(fileRules),
  };
}

export async function findLocalMovieSubtitles({ title, year } = {}) {
  const rawTitle = String(title || '').trim();
  if (!rawTitle) return [];

  cleanCache(searchCache);
  const cacheKey = JSON.stringify({ title: rawTitle, year: String(year || '') });
  const cached = searchCache.get(cacheKey);
  if (cached?.expiresAt > now()) return cached.value;

  const inventoryResult = await getOrRefreshLibraryInventory();
  const inventory = inventoryResult?.inventory || null;
  const movieRows = Array.isArray(inventory?.movies) ? inventory.movies : [];
  if (!movieRows.length) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const matchedRow = pickBestMovieRow(movieRows, { title: rawTitle, year });
  if (!matchedRow?.path) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const mount = await getMountSettings();
  const mountDir = String(mount?.mountDir || '').trim();
  const engineHost = await getEngineHost();
  if (!mountDir || !engineHost?.host) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const dir = path.posix.dirname(String(matchedRow.path || ''));
  const normalizedMount = mountDir.replace(/\/+$/, '');
  if (!dir.startsWith(`${normalizedMount}/`)) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const cfg = await getSubtitleConfig();
  const ssh = sshFromEngineHost(engineHost);
  try {
    const response = await ssh.exec(buildFindSubtitleCommand(dir, cfg.subtitleExtensions), { timeoutMs: 30000 });
    const files = String(response?.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const tracks = [];
    const seenLang = new Set();

    for (const filePath of files) {
      const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
      if (!PLAYABLE_EXTENSIONS.has(ext)) continue;
      const lang = inferLanguageFromFileName(filePath, cfg.languagePatterns);
      const label = lang ? `${languageLabel(lang)} (Local)` : `${path.basename(filePath)} (Local)`;
      if (lang && seenLang.has(lang)) continue;
      if (lang) seenLang.add(lang);
      tracks.push({
        source: 'local',
        lang: label,
        label,
        srclang: lang,
        ext,
        path: filePath,
        url: buildTrackUrl(filePath, { label, lang, ext }),
      });
    }

    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: tracks });
    return tracks;
  } finally {
    await ssh.close().catch(() => {});
  }
}

export async function findLocalSeriesEpisodeSubtitles({ title, year, seasonNumber, episodeNumber } = {}) {
  const rawTitle = String(title || '').trim();
  const targetSeason = Number(seasonNumber || 0);
  const targetEpisode = Number(episodeNumber || 0);
  if (!rawTitle || targetSeason <= 0 || targetEpisode <= 0) return [];

  cleanCache(searchCache);
  const cacheKey = JSON.stringify({
    kind: 'series-episode',
    title: rawTitle,
    year: String(year || ''),
    seasonNumber: targetSeason,
    episodeNumber: targetEpisode,
  });
  const cached = searchCache.get(cacheKey);
  if (cached?.expiresAt > now()) return cached.value;

  const inventoryResult = await getOrRefreshLibraryInventory();
  const inventory = inventoryResult?.inventory || null;
  const seriesRows = Array.isArray(inventory?.series) ? inventory.series : [];
  if (!seriesRows.length) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const matchedRow = pickBestSeriesRow(seriesRows, { title: rawTitle, year });
  if (!matchedRow?.path) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const mount = await getMountSettings();
  const mountDir = String(mount?.mountDir || '').trim();
  const engineHost = await getEngineHost();
  if (!mountDir || !engineHost?.host) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const seriesDir = String(matchedRow.path || '').trim();
  const normalizedMount = mountDir.replace(/\/+$/, '');
  if (!seriesDir.startsWith(`${normalizedMount}/`)) {
    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: [] });
    return [];
  }

  const cfg = await getSubtitleConfig();
  const ssh = sshFromEngineHost(engineHost);
  try {
    const response = await ssh.exec(buildFindSubtitleCommand(seriesDir, cfg.subtitleExtensions, 3), {
      timeoutMs: 30000,
    });
    const files = String(response?.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const tracks = [];
    const seenLang = new Set();

    for (const filePath of files) {
      const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
      if (!PLAYABLE_EXTENSIONS.has(ext)) continue;
      const parsed = parseSeasonEpisode(filePath);
      if (parsed.seasonNumber !== targetSeason || parsed.episodeNumber !== targetEpisode) continue;
      const lang = inferLanguageFromFileName(filePath, cfg.languagePatterns);
      const label = lang ? `${languageLabel(lang)} (Local)` : `${path.basename(filePath)} (Local)`;
      if (lang && seenLang.has(lang)) continue;
      if (lang) seenLang.add(lang);
      tracks.push({
        source: 'local',
        lang: label,
        label,
        srclang: lang,
        ext,
        path: filePath,
        url: buildTrackUrl(filePath, { label, lang, ext }),
      });
    }

    searchCache.set(cacheKey, { expiresAt: now() + SEARCH_CACHE_MS, value: tracks });
    return tracks;
  } finally {
    await ssh.close().catch(() => {});
  }
}

function toVtt(rawText = '') {
  const text = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.trim()) return 'WEBVTT\n\n';
  if (/^\s*WEBVTT/i.test(text)) return text;
  const body = text.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${body}`;
}

export async function getLocalSubtitleAsVtt({ encodedPath = '', ext = '' } = {}) {
  const filePath = decodeSubtitlePath(encodedPath);
  const mount = await getMountSettings();
  const mountDir = String(mount?.mountDir || '').trim().replace(/\/+$/, '');
  if (!filePath || !mountDir) throw new Error('Invalid local subtitle path.');
  if (!filePath.startsWith(`${mountDir}/`)) throw new Error('Subtitle path is outside the media library.');

  const extension = String(ext || path.extname(filePath).replace(/^\./, '')).toLowerCase();
  if (!PLAYABLE_EXTENSIONS.has(extension)) throw new Error(`Unsupported local subtitle extension: ${extension || 'unknown'}.`);

  cleanCache(fileCache);
  const cacheKey = `${filePath}::${extension}`;
  const cached = fileCache.get(cacheKey);
  if (cached?.expiresAt > now()) return cached.value;

  const engineHost = await getEngineHost();
  if (!engineHost?.host) throw new Error('Engine Host is not configured.');

  const ssh = sshFromEngineHost(engineHost);
  try {
    const command = [
      `FILE=${shQuote(filePath)}`,
      'if [ ! -f "$FILE" ]; then echo "__NOT_FOUND__"; exit 0; fi',
      'cat "$FILE"',
    ].join('\n');
    const response = await ssh.exec(command, { timeoutMs: 30000 });
    const body = String(response?.stdout || '');
    if (body.startsWith('__NOT_FOUND__')) throw new Error('Local subtitle file was not found.');
    const vtt = extension === 'vtt' ? body : toVtt(body);
    fileCache.set(cacheKey, { expiresAt: now() + FILE_CACHE_MS, value: vtt });
    return vtt;
  } finally {
    await ssh.close().catch(() => {});
  }
}
