import 'server-only';

import { getSecret } from '../secrets';

const OPEN_SUBTITLES_BASE = 'https://api.opensubtitles.com/api/v1';
const AUTH_CACHE_MS = 5 * 60 * 60 * 1000;
const SEARCH_CACHE_MS = 6 * 60 * 60 * 1000;
const FILE_CACHE_MS = 12 * 60 * 60 * 1000;
const searchCache = new Map();
const fileCache = new Map();

let authCache = {
  cacheKey: '',
  token: '',
  expiresAt: 0,
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

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\u2019'":,!?()[\]._\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(value = '') {
  return String(value || '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s*\[[^\]]+\]\s*$/, '')
    .trim();
}

function titleScore(targetTitle, candidateTitle) {
  const target = normalizeText(targetTitle);
  const candidate = normalizeText(candidateTitle);
  if (!target || !candidate) return 0;
  if (target === candidate) return 140;
  if (candidate.includes(target)) return 95;
  if (target.includes(candidate)) return 75;
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
  if (Math.abs(target - candidate) === 1) return 15;
  return -10;
}

function parseYear(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

function parseNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
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
    seasonNumber: 0,
    episodeNumber: 0,
  };
}

function mapLanguageCode(value) {
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

function languageLabel(code, fallback = '') {
  const normalized = mapLanguageCode(code);
  return LANGUAGE_LABELS[normalized] || String(fallback || normalized || 'Subtitle').trim() || 'Subtitle';
}

function parsePreferredLanguages(headerValue = '') {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const code = mapLanguageCode(value);
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push(code);
  };

  String(headerValue || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const code = part.split(';')[0]?.split('-')[0]?.trim();
      if (code) push(code);
    });

  push('en');
  push('tl');
  return out;
}

async function getConfig() {
  const apiKey = (await getSecret('opensubtitlesApiKey')) || process.env.OPENSUBTITLES_API_KEY || '';
  const username = (await getSecret('opensubtitlesUsername')) || process.env.OPENSUBTITLES_USERNAME || '';
  const password = (await getSecret('opensubtitlesPassword')) || process.env.OPENSUBTITLES_PASSWORD || '';
  const userAgent =
    (await getSecret('opensubtitlesUserAgent')) || process.env.OPENSUBTITLES_USER_AGENT || '3JTV v1.0';

  if (!String(apiKey).trim()) {
    throw new Error('Missing OpenSubtitles API key. Set OPENSUBTITLES_API_KEY or Admin Secrets: opensubtitlesApiKey.');
  }
  if (!String(username).trim() || !String(password).trim()) {
    throw new Error(
      'Missing OpenSubtitles username/password. Set OPENSUBTITLES_USERNAME and OPENSUBTITLES_PASSWORD or Admin Secrets.'
    );
  }
  if (!String(userAgent).trim()) {
    throw new Error(
      'Missing OpenSubtitles User-Agent. Set OPENSUBTITLES_USER_AGENT or Admin Secrets: opensubtitlesUserAgent.'
    );
  }

  return {
    apiKey: String(apiKey).trim(),
    username: String(username).trim(),
    password: String(password).trim(),
    userAgent: String(userAgent).trim(),
  };
}

async function parseOpenSubtitlesError(response) {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    return String(json?.message || json?.error || text || '').trim();
  } catch {
    return String(text || '').trim();
  }
}

async function login(force = false) {
  const cfg = await getConfig();
  const cacheKey = `${cfg.apiKey}::${cfg.username}::${cfg.userAgent}`;
  if (!force && authCache.token && authCache.cacheKey === cacheKey && authCache.expiresAt > now()) {
    return authCache.token;
  }

  const response = await fetch(`${OPEN_SUBTITLES_BASE}/login`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Api-Key': cfg.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': cfg.userAgent,
      Accept: 'application/json',
    },
    body: JSON.stringify({
      username: cfg.username,
      password: cfg.password,
    }),
  });

  if (!response.ok) {
    const message = await parseOpenSubtitlesError(response);
    throw new Error(message || `OpenSubtitles login failed (${response.status}).`);
  }

  const data = await response.json().catch(() => ({}));
  const token = String(data?.token || '').trim();
  if (!token) throw new Error('OpenSubtitles login succeeded but no token was returned.');

  authCache = {
    cacheKey,
    token,
    expiresAt: now() + AUTH_CACHE_MS,
  };
  return token;
}

async function openSubtitlesJson(path, { method = 'GET', params, body, auth = false, retry = true } = {}) {
  const cfg = await getConfig();
  const url = new URL(String(path || '').replace(/^\//, ''), `${OPEN_SUBTITLES_BASE}/`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const headers = {
    'Api-Key': cfg.apiKey,
    'User-Agent': cfg.userAgent,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${await login(false)}`;

  const response = await fetch(url.toString(), {
    method,
    cache: 'no-store',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if ((response.status === 401 || response.status === 403) && auth && retry) {
    await login(true);
    return openSubtitlesJson(path, { method, params, body, auth, retry: false });
  }

  if (!response.ok) {
    const message = await parseOpenSubtitlesError(response);
    throw new Error(message || `OpenSubtitles ${response.status}`);
  }

  return response.json().catch(() => ({}));
}

function buildTrackUrl({ fileId, lang, label }) {
  const u = new URL('/api/subtitles/opensubtitles', 'http://localhost');
  u.searchParams.set('fileId', String(fileId));
  if (lang) u.searchParams.set('lang', String(lang));
  if (label) u.searchParams.set('label', String(label));
  return `${u.pathname}${u.search}`;
}

function parseSearchCandidates(items, { title, year }) {
  const targetTitle = cleanTitle(title);
  const targetYear = Number(year || 0);
  const out = [];

  for (const item of Array.isArray(items) ? items : []) {
    const attrs = item?.attributes && typeof item.attributes === 'object' ? item.attributes : item || {};
    const feature = attrs?.feature_details && typeof attrs.feature_details === 'object' ? attrs.feature_details : {};
    const files = Array.isArray(attrs?.files) ? attrs.files : [];
    const langCode = mapLanguageCode(attrs?.language || attrs?.language_code || attrs?.lang || '');
    if (!langCode || !files.length) continue;

    const candidateTitle =
      feature?.movie_name || feature?.title || attrs?.release || attrs?.feature_details?.title || '';
    const candidateYear = Number(feature?.year || parseYear(attrs?.release || candidateTitle) || 0);
    const baseScore =
      titleScore(targetTitle, candidateTitle) +
      yearScore(targetYear, candidateYear) +
      Math.min(Number(attrs?.download_count || 0), 5000) / 100 +
      Math.min(Number(attrs?.points || 0), 50);

    const suffix = attrs?.hearing_impaired ? ' CC' : '';
    const label = `${languageLabel(langCode, attrs?.language)}${suffix} (OpenSubtitles)`;

    files.forEach((file, index) => {
      const fileId = Number(file?.file_id || file?.id || 0);
      if (!Number.isFinite(fileId) || fileId <= 0) return;
      out.push({
        fileId,
        langCode,
        label,
        fileName: String(file?.file_name || '').trim(),
        score: baseScore - index,
      });
    });
  }

  return out;
}

function parseSeriesSearchCandidates(items, { title, year, seasonNumber, episodeNumber }) {
  const targetTitle = cleanTitle(title);
  const targetYear = Number(year || 0);
  const targetSeason = parseNumber(seasonNumber);
  const targetEpisode = parseNumber(episodeNumber);
  const out = [];

  for (const item of Array.isArray(items) ? items : []) {
    const attrs = item?.attributes && typeof item.attributes === 'object' ? item.attributes : item || {};
    const feature = attrs?.feature_details && typeof attrs.feature_details === 'object' ? attrs.feature_details : {};
    const files = Array.isArray(attrs?.files) ? attrs.files : [];
    const langCode = mapLanguageCode(attrs?.language || attrs?.language_code || attrs?.lang || '');
    if (!langCode || !files.length) continue;

    const parsedRelease = parseSeasonEpisode(attrs?.release || '');
    const candidateSeason =
      parseNumber(feature?.season_number || feature?.season || attrs?.season_number || attrs?.season) ||
      parsedRelease.seasonNumber;
    const candidateEpisode =
      parseNumber(feature?.episode_number || feature?.episode || attrs?.episode_number || attrs?.episode) ||
      parsedRelease.episodeNumber;
    if (targetSeason && candidateSeason && targetSeason !== candidateSeason) continue;
    if (targetEpisode && candidateEpisode && targetEpisode !== candidateEpisode) continue;

    const candidateSeriesTitle =
      feature?.parent_title ||
      feature?.series_name ||
      feature?.movie_name ||
      attrs?.feature_details?.parent_title ||
      attrs?.release ||
      '';
    const candidateYear = Number(feature?.year || parseYear(attrs?.release || candidateSeriesTitle) || 0);
    const baseScore =
      titleScore(targetTitle, candidateSeriesTitle) +
      yearScore(targetYear, candidateYear) +
      (candidateSeason === targetSeason ? 80 : 0) +
      (candidateEpisode === targetEpisode ? 80 : 0) +
      Math.min(Number(attrs?.download_count || 0), 5000) / 100 +
      Math.min(Number(attrs?.points || 0), 50);

    const suffix = attrs?.hearing_impaired ? ' CC' : '';
    const label = `${languageLabel(langCode, attrs?.language)}${suffix} (OpenSubtitles)`;

    files.forEach((file, index) => {
      const fileId = Number(file?.file_id || file?.id || 0);
      if (!Number.isFinite(fileId) || fileId <= 0) return;
      out.push({
        fileId,
        langCode,
        label,
        fileName: String(file?.file_name || '').trim(),
        score: baseScore - index,
      });
    });
  }

  return out;
}

export async function searchMovieSubtitles({ title, year, acceptLanguage = '' } = {}) {
  const rawTitle = cleanTitle(title);
  if (!rawTitle) return [];

  cleanCache(searchCache);
  const languages = parsePreferredLanguages(acceptLanguage);
  const cacheKey = JSON.stringify({ title: rawTitle, year: String(year || ''), languages });
  const cached = searchCache.get(cacheKey);
  if (cached?.expiresAt > now()) return cached.value;

  const data = await openSubtitlesJson('/subtitles', {
    params: {
      query: rawTitle,
      type: 'movie',
      order_by: 'download_count',
      order_direction: 'desc',
      languages: languages.join(','),
      ...(year ? { year: String(year) } : {}),
    },
  });

  const candidates = parseSearchCandidates(data?.data, { title: rawTitle, year });
  const selected = [];
  const seen = new Set();

  languages.forEach((langCode) => {
    const best = candidates
      .filter((candidate) => candidate.langCode === langCode)
      .sort((a, b) => b.score - a.score)[0];
    if (!best || seen.has(best.fileId)) return;
    seen.add(best.fileId);
    selected.push({
      source: 'opensubtitles',
      lang: best.label,
      srclang: best.langCode,
      label: best.label,
      url: buildTrackUrl({ fileId: best.fileId, lang: best.langCode, label: best.label }),
    });
  });

  if (!selected.length) {
    candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .forEach((candidate) => {
        if (seen.has(candidate.fileId)) return;
        seen.add(candidate.fileId);
        selected.push({
          source: 'opensubtitles',
          lang: candidate.label,
          srclang: candidate.langCode,
          label: candidate.label,
          url: buildTrackUrl({ fileId: candidate.fileId, lang: candidate.langCode, label: candidate.label }),
        });
      });
  }

  searchCache.set(cacheKey, {
    expiresAt: now() + SEARCH_CACHE_MS,
    value: selected,
  });
  return selected;
}

export async function searchSeriesEpisodeSubtitles({
  title,
  year,
  seasonNumber,
  episodeNumber,
  acceptLanguage = '',
} = {}) {
  const rawTitle = cleanTitle(title);
  const targetSeason = parseNumber(seasonNumber);
  const targetEpisode = parseNumber(episodeNumber);
  if (!rawTitle || !targetSeason || !targetEpisode) return [];

  cleanCache(searchCache);
  const languages = parsePreferredLanguages(acceptLanguage);
  const cacheKey = JSON.stringify({
    kind: 'series-episode',
    title: rawTitle,
    year: String(year || ''),
    seasonNumber: targetSeason,
    episodeNumber: targetEpisode,
    languages,
  });
  const cached = searchCache.get(cacheKey);
  if (cached?.expiresAt > now()) return cached.value;

  const data = await openSubtitlesJson('/subtitles', {
    params: {
      query: rawTitle,
      type: 'episode',
      order_by: 'download_count',
      order_direction: 'desc',
      languages: languages.join(','),
      season_number: String(targetSeason),
      episode_number: String(targetEpisode),
      ...(year ? { year: String(year) } : {}),
    },
  });

  const candidates = parseSeriesSearchCandidates(data?.data, {
    title: rawTitle,
    year,
    seasonNumber: targetSeason,
    episodeNumber: targetEpisode,
  });
  const selected = [];
  const seen = new Set();

  languages.forEach((langCode) => {
    const best = candidates
      .filter((candidate) => candidate.langCode === langCode)
      .sort((a, b) => b.score - a.score)[0];
    if (!best || seen.has(best.fileId)) return;
    seen.add(best.fileId);
    selected.push({
      source: 'opensubtitles',
      lang: best.label,
      srclang: best.langCode,
      label: best.label,
      url: buildTrackUrl({ fileId: best.fileId, lang: best.langCode, label: best.label }),
    });
  });

  if (!selected.length) {
    candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .forEach((candidate) => {
        if (seen.has(candidate.fileId)) return;
        seen.add(candidate.fileId);
        selected.push({
          source: 'opensubtitles',
          lang: candidate.label,
          srclang: candidate.langCode,
          label: candidate.label,
          url: buildTrackUrl({ fileId: candidate.fileId, lang: candidate.langCode, label: candidate.label }),
        });
      });
  }

  searchCache.set(cacheKey, {
    expiresAt: now() + SEARCH_CACHE_MS,
    value: selected,
  });
  return selected;
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

export async function getSubtitleFileAsVtt({ fileId } = {}) {
  const numericFileId = Number(fileId || 0);
  if (!Number.isFinite(numericFileId) || numericFileId <= 0) throw new Error('Invalid subtitle file id.');

  cleanCache(fileCache);
  const cached = fileCache.get(String(numericFileId));
  if (cached?.expiresAt > now()) return cached.value;

  const data = await openSubtitlesJson('/download', {
    method: 'POST',
    auth: true,
    body: {
      file_id: numericFileId,
      sub_format: 'srt',
    },
  });

  const link = String(data?.link || data?.url || '').trim();
  if (!link) throw new Error('OpenSubtitles download link was not returned.');

  const response = await fetch(link, {
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Subtitle download failed (${response.status}).`);
  }

  const text = await response.text();
  const vtt = toVtt(text);
  fileCache.set(String(numericFileId), {
    expiresAt: now() + FILE_CACHE_MS,
    value: vtt,
  });
  return vtt;
}
