import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../adminDb';
import {
  ERROR_CATEGORY,
  normalizeDomain,
  sanitizeResponseSnippet,
  toProviderError,
} from './providers/base';
import { runProviderSearch, runProviderTest, pickBestSource } from './sourceEngine';

const PROVIDER_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  DISABLED: 'disabled',
  UNKNOWN: 'unknown',
};

const DOMAIN_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
};

const LOG_ACTION = {
  TEST: 'test',
  TEST_ACTIVE: 'test_active',
  VALIDATE_DOMAIN: 'validate_domain',
  SEARCH: 'search',
  FETCH: 'fetch',
  PARSE: 'parse',
  ROTATE: 'rotate',
  BACKOFF: 'backoff',
};

const MAX_LOGS = 10000;
const DEFAULT_TEST_QUERY = 'The Matrix 1999';
const DEFAULT_YTS_API_BASE_PATH = '/api/v2/';
const DEFAULT_YTS_ENDPOINT = 'list_movies.json';
const DEFAULT_YTS_DOMAINS = ['https://yts.mx', 'https://movies-api.accel.li'];
const DEFAULT_TPB_DOMAINS = ['https://thepiratebay.org'];
const DEFAULT_TPB_SEARCH_PATH = '/search/{query}/1/99/201';
const DEFAULT_EZTV_DOMAINS = ['https://eztvx.to'];
const DEFAULT_EZTV_ENDPOINT = '/api/get-torrents';

function now() {
  return Date.now();
}

function normalizeTitleForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSeriesReleaseMarkers(value) {
  return String(value || '')
    .replace(/\bS\d{1,2}(?:E\d{1,2})+(?:[- ]?E\d{1,2})*\b/gi, ' ')
    .replace(/\bS\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,2}\b/gi, ' ')
    .replace(/\b(?:season|series)\s*\d+\b/gi, ' ')
    .replace(/\b(?:episode|ep|part)\s*\d+\b/gi, ' ')
    .replace(/\bcomplete(?:\s+series|\s+season)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRequestedTitleForType(value, type = 'movie') {
  const mediaType = String(type || 'movie').trim().toLowerCase();
  return normalizeTitleForMatch(mediaType === 'series' ? stripSeriesReleaseMarkers(value) : value);
}

function parseSourceTitleYearFromName(name, type = 'movie') {
  let raw = String(name || '').trim();
  if (!raw) return { title: '', year: null };
  raw = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^)]*(?:2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web[- ]?dl|hdrip|dvdrip|x264|x265|hevc|h264|aac|yts)[^)]*)\)/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  let titlePart = yearMatch && yearMatch.index !== undefined ? raw.slice(0, yearMatch.index).trim() : raw;
  titlePart = titlePart
    .replace(/\b(2160p|1080p|720p|480p|4k|bluray|brrip|webrip|web[- ]?dl|hdrip|dvdrip|x264|x265|hevc|h264|aac|yts|proper|repack|extended|remastered|imax|nf|amzn|ddp|atmos)\b.*$/i, '')
    .trim();
  return {
    title: normalizeRequestedTitleForType(titlePart, type),
    year,
  };
}

function providerSupportsRequestedType(providerKey = '', type = 'movie') {
  const key = String(providerKey || '').trim().toLowerCase();
  const mediaType = String(type || 'movie').trim().toLowerCase();
  if (mediaType === 'series' && (key === 'yts' || key === 'tpb')) return false;
  if (mediaType === 'movie' && key === 'eztv') return false;
  return true;
}

function normalizeMediaType(type) {
  return String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
}

function sourceTitleYearForMatch(source, type = 'movie') {
  const explicitTitle = normalizeRequestedTitleForType(source?.title || source?.mediaTitle || source?.movieTitle || '', type);
  const explicitYear = Number(source?.year || source?.mediaYear || 0) || null;
  if (explicitTitle) return { title: explicitTitle, year: explicitYear };
  return parseSourceTitleYearFromName(source?.name || '', type);
}

export function sourceMatchesRequestedMedia(source, { title, year = null, type = 'movie' } = {}) {
  const mediaType = String(type || 'movie').trim().toLowerCase();
  if (!providerSupportsRequestedType(source?.provider || '', mediaType)) return false;
  const targetTitle = normalizeRequestedTitleForType(title, mediaType);
  if (!targetTitle || !source || typeof source !== 'object') return false;
  const targetYear = Number(year || 0) || null;
  const candidate = sourceTitleYearForMatch(source, mediaType);
  if (!candidate.title || candidate.title !== targetTitle) return false;
  if (mediaType !== 'series' && targetYear && candidate.year && candidate.year !== targetYear) return false;
  return true;
}

function filterSourcesForRequestedMedia(results, { title, year = null, type = 'movie' } = {}) {
  const mediaType = String(type || 'movie').trim().toLowerCase();
  const rawTitle = String(title || '').trim();

  // Some series providers (EZTV) are best queried by IMDb id. In that case, the provider already scoped
  // results to the requested show, so title parsing/matching is unreliable and should be skipped.
  if (
    mediaType === 'series' &&
    (/\btt\d{7,8}\b/i.test(rawTitle) || /\b\d{7,8}\b/.test(rawTitle))
  ) {
    return Array.isArray(results) ? results : [];
  }

  return (Array.isArray(results) ? results : []).filter((source) => sourceMatchesRequestedMedia(source, { title, year, type }));
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, { min = null, max = null, fallback = 0 } = {}) {
  let n = toNumber(v, fallback);
  if (min !== null && n < min) n = min;
  if (max !== null && n > max) n = max;
  return n;
}

function normalizeDomains(input) {
  const out = [];
  const seen = new Set();

  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/\r?\n/)
        .map((x) => x.trim());

  for (const raw of arr) {
    const d = normalizeDomain(raw);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }

  return out;
}

function normalizeApiBasePath(input) {
  let path = String(input || DEFAULT_YTS_API_BASE_PATH).trim();
  if (!path) path = DEFAULT_YTS_API_BASE_PATH;
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.endsWith('/')) path = `${path}/`;
  return path;
}

function normalizeYtsEndpoint(input) {
  return String(input || DEFAULT_YTS_ENDPOINT).trim().replace(/^\/+/, '') || DEFAULT_YTS_ENDPOINT;
}

function normalizeTpbSearchPathTemplate(input) {
  const raw = String(input || DEFAULT_TPB_SEARCH_PATH).trim() || DEFAULT_TPB_SEARCH_PATH;
  if (raw.includes('{query}')) return raw;
  return `${raw.replace(/\/+$/, '')}/{query}`;
}

function normalizeEztvEndpoint(input) {
  const raw = String(input || DEFAULT_EZTV_ENDPOINT).trim() || DEFAULT_EZTV_ENDPOINT;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path;
}

function extractDomainFromUrlLike(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    u.pathname = '';
    u.search = '';
    u.hash = '';
    return normalizeDomain(u.toString());
  } catch {
    return '';
  }
}

function normalizeDomainErrorCategory(input, httpStatus = null) {
  const raw = String(input || '').trim().toUpperCase();
  if (raw === 'DNS') return 'DNS';
  if (raw === 'BLOCKED' || Number(httpStatus) === 403 || Number(httpStatus) === 429) return 'BLOCKED';
  if (raw === 'PARSE') return 'PARSE';
  if (raw === 'HTTP') return 'HTTP';
  if (raw === 'TIMEOUT') return 'NETWORK';
  if (raw === 'AUTH') return 'HTTP';
  if (raw === 'NETWORK') return 'NETWORK';
  return 'NETWORK';
}

function nowPlusMinutes(mins) {
  return now() + clamp(mins, { min: 1, max: 1440, fallback: 30 }) * 60 * 1000;
}

function defaultProviders() {
  const t = now();
  return [
    {
      id: 'yts',
      key: 'yts',
      displayName: 'YTS',
      enabled: true,
      priority: 1,
      stopOnFirstValid: true,
      maxAttemptsPerTitle: 2,
      backoffMinutesOnError: 30,
      failureThresholdBlocked: 3,
      testQuery: DEFAULT_TEST_QUERY,
      status: PROVIDER_STATUS.UNKNOWN,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastErrorCategory: null,
      lastErrorMessage: '',
      failureStreak: 0,
      backoffUntil: null,
      backoffReasonCategory: null,
      backoffReasonMessage: '',
      activeDomain: DEFAULT_YTS_DOMAINS[0],
      config: {
        apiBasePath: DEFAULT_YTS_API_BASE_PATH,
        endpoint: DEFAULT_YTS_ENDPOINT,
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'tpb',
      key: 'tpb',
      displayName: 'TPB',
      enabled: true,
      priority: 2,
      stopOnFirstValid: true,
      maxAttemptsPerTitle: 2,
      backoffMinutesOnError: 30,
      failureThresholdBlocked: 3,
      testQuery: DEFAULT_TEST_QUERY,
      status: PROVIDER_STATUS.UNKNOWN,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastErrorCategory: null,
      lastErrorMessage: '',
      failureStreak: 0,
      backoffUntil: null,
      backoffReasonCategory: null,
      backoffReasonMessage: '',
      activeDomain: DEFAULT_TPB_DOMAINS[0],
      config: {
        searchPathTemplate: DEFAULT_TPB_SEARCH_PATH,
      },
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'eztv',
      key: 'eztv',
      displayName: 'EZTV',
      enabled: false,
      priority: 3,
      stopOnFirstValid: true,
      maxAttemptsPerTitle: 2,
      backoffMinutesOnError: 30,
      failureThresholdBlocked: 3,
      testQuery: 'tt0944947',
      status: PROVIDER_STATUS.UNKNOWN,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastErrorCategory: null,
      lastErrorMessage: '',
      failureStreak: 0,
      backoffUntil: null,
      backoffReasonCategory: null,
      backoffReasonMessage: '',
      activeDomain: DEFAULT_EZTV_DOMAINS[0],
      config: {
        endpoint: DEFAULT_EZTV_ENDPOINT,
      },
      createdAt: t,
      updatedAt: t,
      enabledFor: { movie: false, series: false },
      priorityByType: { movie: 3, series: 1 },
    },
  ];
}

function normalizeProvider(raw, defaults) {
  const t = now();
  const base = {
    ...defaults,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  const key = String(base.key || defaults.key || '').trim().toLowerCase();

  const enabledForRaw = base.enabledFor && typeof base.enabledFor === 'object' ? base.enabledFor : {};
  const priorityByTypeRaw = base.priorityByType && typeof base.priorityByType === 'object' ? base.priorityByType : {};
  const enabledMovie = enabledForRaw.movie !== undefined ? Boolean(enabledForRaw.movie) : base.enabled !== false;
  const enabledSeries =
    enabledForRaw.series !== undefined
      ? Boolean(enabledForRaw.series)
      : providerSupportsRequestedType(key, 'series')
        ? enabledMovie
        : false;

  const common = {
    id: String(base.id || key || defaults.id),
    key,
    displayName: String(base.displayName || defaults.displayName || key.toUpperCase()),
    // Back-compat: `.enabled` and `.priority` remain the movie config.
    enabled: enabledMovie,
    priority: clamp(base.priority, { min: 1, max: 9999, fallback: defaults.priority || 1 }),
    stopOnFirstValid: base.stopOnFirstValid !== false,
    maxAttemptsPerTitle: clamp(base.maxAttemptsPerTitle, { min: 1, max: 5, fallback: defaults.maxAttemptsPerTitle || 2 }),
    backoffMinutesOnError: clamp(base.backoffMinutesOnError, { min: 1, max: 1440, fallback: defaults.backoffMinutesOnError || 30 }),
    failureThresholdBlocked: clamp(base.failureThresholdBlocked, { min: 1, max: 20, fallback: defaults.failureThresholdBlocked || 3 }),
    testQuery: String(base.testQuery || defaults.testQuery || DEFAULT_TEST_QUERY).trim() || DEFAULT_TEST_QUERY,
    status: String(base.status || PROVIDER_STATUS.UNKNOWN).toLowerCase(),
    lastCheckedAt: Number(base.lastCheckedAt || 0) || null,
    lastSuccessAt: Number(base.lastSuccessAt || 0) || null,
    lastErrorCategory: base.lastErrorCategory ? String(base.lastErrorCategory).toUpperCase() : null,
    lastErrorMessage: String(base.lastErrorMessage || '').slice(0, 240),
    failureStreak: clamp(base.failureStreak, { min: 0, max: 9999, fallback: 0 }),
    backoffUntil: Number(base.backoffUntil || 0) || null,
    backoffReasonCategory: base.backoffReasonCategory ? String(base.backoffReasonCategory).toUpperCase() : null,
    backoffReasonMessage: String(base.backoffReasonMessage || '').slice(0, 240),
    activeDomain: normalizeDomain(base.activeDomain || defaults.activeDomain || ''),
    createdAt: Number(base.createdAt || t) || t,
    updatedAt: Number(base.updatedAt || t) || t,
    enabledFor: {
      movie: enabledMovie,
      series: enabledSeries,
    },
    priorityByType: {
      movie: clamp(priorityByTypeRaw.movie ?? base.priority, { min: 1, max: 9999, fallback: defaults.priority || 1 }),
      series: clamp(priorityByTypeRaw.series ?? base.priority, { min: 1, max: 9999, fallback: defaults.priority || 1 }),
    },
  };

  if (key === 'yts') {
    const cfgRaw = base.config && typeof base.config === 'object' ? base.config : {};
    const legacyDomain = extractDomainFromUrlLike(cfgRaw.apiBaseUrl || '');
    const domainsRaw = normalizeDomains(cfgRaw.domains);
    const domains = domainsRaw.length ? domainsRaw : legacyDomain ? [legacyDomain] : [...DEFAULT_YTS_DOMAINS];
    common.config = {
      apiBasePath: normalizeApiBasePath(cfgRaw.apiBasePath || defaults.config.apiBasePath || DEFAULT_YTS_API_BASE_PATH),
      endpoint: normalizeYtsEndpoint(cfgRaw.endpoint || defaults.config.endpoint || DEFAULT_YTS_ENDPOINT),
      // Back-compat list; authoritative list is in sourceProviderDomains.
      domains,
    };
    if (!common.activeDomain) {
      common.activeDomain = common.config.domains[0] || DEFAULT_YTS_DOMAINS[0];
    }
  } else if (key === 'tpb') {
    const cfgRaw = base.config && typeof base.config === 'object' ? base.config : {};
    const domains = normalizeDomains(cfgRaw.domains || DEFAULT_TPB_DOMAINS);
    common.config = {
      domains: domains.length ? domains : DEFAULT_TPB_DOMAINS,
      searchPathTemplate: normalizeTpbSearchPathTemplate(cfgRaw.searchPathTemplate || defaults.config.searchPathTemplate || DEFAULT_TPB_SEARCH_PATH),
    };
    if (!common.activeDomain) {
      common.activeDomain = common.config.domains[0] || DEFAULT_TPB_DOMAINS[0];
    }
  } else if (key === 'eztv') {
    const cfgRaw = base.config && typeof base.config === 'object' ? base.config : {};
    const domains = normalizeDomains(cfgRaw.domains || DEFAULT_EZTV_DOMAINS);
    common.config = {
      domains: domains.length ? domains : DEFAULT_EZTV_DOMAINS,
      endpoint: normalizeEztvEndpoint(cfgRaw.endpoint || defaults.config.endpoint || DEFAULT_EZTV_ENDPOINT),
    };
    if (!common.activeDomain) {
      common.activeDomain = common.config.domains[0] || DEFAULT_EZTV_DOMAINS[0];
    }
  } else {
    common.config = base.config && typeof base.config === 'object' ? base.config : {};
  }

  return common;
}

function normalizePriorities(providers) {
  const sorted = [...providers].sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].priority = i + 1;
    sorted[i].priorityByType =
      sorted[i].priorityByType && typeof sorted[i].priorityByType === 'object'
        ? sorted[i].priorityByType
        : { movie: sorted[i].priority, series: sorted[i].priority };
    sorted[i].priorityByType.movie = sorted[i].priority;
  }
  return sorted;
}

function normalizePrioritiesForType(providers, type) {
  const t = normalizeMediaType(type);
  const sorted = [...providers].sort(
    (a, b) => Number(a?.priorityByType?.[t] ?? a?.priority ?? 0) - Number(b?.priorityByType?.[t] ?? b?.priority ?? 0)
  );
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    p.priorityByType = p.priorityByType && typeof p.priorityByType === 'object' ? p.priorityByType : { movie: p.priority || i + 1, series: p.priority || i + 1 };
    p.priorityByType[t] = i + 1;
    if (t === 'movie') p.priority = i + 1;
  }
  return sorted;
}

function providerEnabledForType(provider, type) {
  const t = normalizeMediaType(type);
  const enabledFor = provider?.enabledFor && typeof provider.enabledFor === 'object' ? provider.enabledFor : null;
  if (enabledFor) return enabledFor[t] !== false;
  return provider?.enabled !== false;
}

function providerPriorityForType(provider, type) {
  const t = normalizeMediaType(type);
  const pr = provider?.priorityByType && typeof provider.priorityByType === 'object' ? provider.priorityByType : null;
  return Number(pr?.[t] ?? provider?.priority ?? 0) || 0;
}

function isKnownStatus(v) {
  return [PROVIDER_STATUS.HEALTHY, PROVIDER_STATUS.DEGRADED, PROVIDER_STATUS.BLOCKED, PROVIDER_STATUS.DISABLED, PROVIDER_STATUS.UNKNOWN].includes(
    String(v || '').toLowerCase()
  );
}

function isKnownDomainStatus(v) {
  return [DOMAIN_STATUS.HEALTHY, DOMAIN_STATUS.DEGRADED, DOMAIN_STATUS.BLOCKED, DOMAIN_STATUS.UNKNOWN].includes(String(v || '').toLowerCase());
}

function normalizeDomainRecord(raw, defaults = {}) {
  const t = now();
  const domain = normalizeDomain(raw?.domain || defaults.domain || '');
  const providerKey = String(raw?.providerKey || raw?.providerId || defaults.providerKey || '').toLowerCase();

  return {
    id: String(raw?.id || crypto.randomUUID()),
    providerKey,
    domain,
    sortOrder: clamp(raw?.sortOrder ?? defaults.sortOrder ?? 1, { min: 1, max: 9999, fallback: 1 }),
    status: isKnownDomainStatus(raw?.status) ? String(raw?.status).toLowerCase() : DOMAIN_STATUS.UNKNOWN,
    lastCheckedAt: Number(raw?.lastCheckedAt || raw?.lastErrorAt || 0) || null,
    lastSuccessAt: Number(raw?.lastSuccessAt || 0) || null,
    failureStreak: clamp(raw?.failureStreak ?? raw?.failureCount ?? 0, { min: 0, max: 9999, fallback: 0 }),
    backoffUntil: Number(raw?.backoffUntil || 0) || null,
    lastErrorCategory: raw?.lastErrorCategory ? String(raw.lastErrorCategory).toUpperCase() : null,
    lastErrorMessage: String(raw?.lastErrorMessage || raw?.message || '').slice(0, 240),
    lastDurationMs: Number.isFinite(Number(raw?.lastDurationMs)) ? Number(raw.lastDurationMs) : null,
    zeroResultsStreak: clamp(raw?.zeroResultsStreak ?? 0, { min: 0, max: 9999, fallback: 0 }),
    createdAt: Number(raw?.createdAt || t) || t,
    updatedAt: Number(raw?.updatedAt || t) || t,
  };
}

function defaultDomainsForProvider(providerKey) {
  const key = String(providerKey || '').toLowerCase();
  if (key === 'yts') return [...DEFAULT_YTS_DOMAINS];
  if (key === 'tpb') return [...DEFAULT_TPB_DOMAINS];
  if (key === 'eztv') return [...DEFAULT_EZTV_DOMAINS];
  return [];
}

function normalizeProviderDomainsList(provider, inputDomains = null) {
  const key = String(provider?.key || '').toLowerCase();
  const cfg = provider?.config && typeof provider.config === 'object' ? provider.config : {};

  const direct = normalizeDomains(inputDomains !== null ? inputDomains : cfg.domains);
  if (direct.length) return direct;

  if (key === 'yts') {
    const legacy = extractDomainFromUrlLike(cfg.apiBaseUrl || '');
    if (legacy) return normalizeDomains([legacy, ...DEFAULT_YTS_DOMAINS]);
  }

  return defaultDomainsForProvider(key);
}

function getProviderDomains(db, providerKey) {
  const key = String(providerKey || '').trim().toLowerCase();
  return (Array.isArray(db.sourceProviderDomains) ? db.sourceProviderDomains : [])
    .filter((x) => String(x?.providerKey || x?.providerId || '').toLowerCase() === key)
    .sort((a, b) => Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0));
}

function findProviderDomain(db, providerKey, domain) {
  const key = String(providerKey || '').trim().toLowerCase();
  const d = normalizeDomain(domain);
  if (!key || !d) return null;
  return (Array.isArray(db.sourceProviderDomains) ? db.sourceProviderDomains : []).find(
    (x) => String(x?.providerKey || x?.providerId || '').toLowerCase() === key && normalizeDomain(x?.domain || '') === d
  );
}

function isDomainBackoffActive(domainRow, at = now()) {
  const until = Number(domainRow?.backoffUntil || 0) || 0;
  return until > at;
}

function syncProviderDomains(db, provider, domainsInput = null, opts = {}) {
  const strict = Boolean(opts.strict);
  const key = String(provider?.key || '').toLowerCase();
  const desired = normalizeProviderDomainsList(provider, domainsInput);
  const baseDesired = desired.length ? desired : defaultDomainsForProvider(key);

  const allRows = Array.isArray(db.sourceProviderDomains) ? db.sourceProviderDomains : [];
  const existing = allRows.filter((x) => String(x?.providerKey || x?.providerId || '').toLowerCase() === key);
  const existingMap = new Map(existing.map((x) => [normalizeDomain(x?.domain || ''), x]));

  const ordered = [...baseDesired];
  if (!strict) {
    for (const row of existing) {
      const d = normalizeDomain(row?.domain || '');
      if (!d || ordered.includes(d)) continue;
      ordered.push(d);
    }
  }

  const nextRows = [];
  for (let i = 0; i < ordered.length; i++) {
    const domain = ordered[i];
    const cur = existingMap.get(domain) || null;
    nextRows.push(
      normalizeDomainRecord(cur, {
        providerKey: key,
        domain,
        sortOrder: i + 1,
      })
    );
  }

  const others = allRows.filter((x) => String(x?.providerKey || x?.providerId || '').toLowerCase() !== key);
  db.sourceProviderDomains = [...others, ...nextRows];

  provider.config = provider.config && typeof provider.config === 'object' ? provider.config : {};
  provider.config.domains = ordered;
  if (key === 'yts') {
    provider.config.apiBasePath = normalizeApiBasePath(provider.config.apiBasePath || DEFAULT_YTS_API_BASE_PATH);
    provider.config.endpoint = normalizeYtsEndpoint(provider.config.endpoint || DEFAULT_YTS_ENDPOINT);
  }
  if (key === 'tpb') {
    provider.config.searchPathTemplate = normalizeTpbSearchPathTemplate(provider.config.searchPathTemplate || DEFAULT_TPB_SEARCH_PATH);
  }
  if (key === 'eztv') {
    provider.config.endpoint = normalizeEztvEndpoint(provider.config.endpoint || DEFAULT_EZTV_ENDPOINT);
  }

  const active = normalizeDomain(provider.activeDomain || '');
  provider.activeDomain = ordered.includes(active) ? active : ordered[0] || '';
}

function ensureStore(db) {
  let changed = false;

  const defaults = defaultProviders();
  const byKeyDefaults = new Map(defaults.map((p) => [p.key, p]));

  const current = Array.isArray(db.sourceProviders) ? db.sourceProviders : [];
  if (!Array.isArray(db.sourceProviders)) {
    db.sourceProviders = [];
    changed = true;
  }

  const byKeyCurrent = new Map();
  for (const p of current) {
    const key = String(p?.key || '').trim().toLowerCase();
    if (!key) continue;
    byKeyCurrent.set(key, p);
  }

  const merged = [];
  for (const d of defaults) {
    const existing = byKeyCurrent.get(d.key);
    const n = normalizeProvider(existing, d);
    merged.push(n);
    if (!existing) changed = true;
  }

  // Keep unknown custom providers (future extensibility).
  for (const [key, raw] of byKeyCurrent.entries()) {
    if (byKeyDefaults.has(key)) continue;
    const n = normalizeProvider(raw, {
      id: key,
      key,
      displayName: key.toUpperCase(),
      enabled: false,
      priority: merged.length + 1,
      stopOnFirstValid: true,
      maxAttemptsPerTitle: 2,
      backoffMinutesOnError: 30,
      failureThresholdBlocked: 3,
      testQuery: DEFAULT_TEST_QUERY,
      status: PROVIDER_STATUS.UNKNOWN,
      lastCheckedAt: null,
      lastSuccessAt: null,
      failureStreak: 0,
      backoffUntil: null,
      activeDomain: '',
      config: {},
    });
    merged.push(n);
  }

  db.sourceProviders = normalizePriorities(merged);

  if (!Array.isArray(db.sourceProviderLogs)) {
    db.sourceProviderLogs = [];
    changed = true;
  }

  if (!Array.isArray(db.sourceProviderDomains)) {
    // Migration path from legacy sourceProviderDomainHealth.
    const migrated = [];
    if (Array.isArray(db.sourceProviderDomainHealth) && db.sourceProviderDomainHealth.length) {
      for (const old of db.sourceProviderDomainHealth) {
        const row = normalizeDomainRecord(old, {
          providerKey: String(old?.providerId || '').toLowerCase(),
          domain: old?.domain || '',
          sortOrder: 9999,
        });
        if (row.providerKey && row.domain) migrated.push(row);
      }
    }
    db.sourceProviderDomains = migrated;
    changed = true;
  }

  if (!Array.isArray(db.sourceProviderDomainHealth)) {
    db.sourceProviderDomainHealth = [];
    changed = true;
  }

  for (const p of db.sourceProviders) {
    const beforeActive = String(p.activeDomain || '');
    const beforeConfig = JSON.stringify(p.config || {});
    const beforeDomains = JSON.stringify(getProviderDomains(db, p.key));
    syncProviderDomains(db, p, null, { strict: false });
    const afterDomains = JSON.stringify(getProviderDomains(db, p.key));
    if (beforeActive !== String(p.activeDomain || '') || beforeConfig !== JSON.stringify(p.config || {}) || beforeDomains !== afterDomains) changed = true;

    const fixedStatus = isKnownStatus(p.status) ? String(p.status).toLowerCase() : PROVIDER_STATUS.UNKNOWN;
    if (fixedStatus !== p.status) {
      p.status = fixedStatus;
      changed = true;
    }
  }

  if (db.sourceProviderLogs.length > MAX_LOGS) {
    db.sourceProviderLogs = db.sourceProviderLogs.slice(0, MAX_LOGS);
    changed = true;
  }

  return changed;
}

function getProviderLogs(db, providerId) {
  const id = String(providerId || '').trim().toLowerCase();
  return (Array.isArray(db.sourceProviderLogs) ? db.sourceProviderLogs : []).filter((x) => String(x?.providerId || '').toLowerCase() === id);
}

function isBackoffActive(provider, at = now()) {
  const until = Number(provider?.backoffUntil || 0) || 0;
  return until > at;
}

function computeFailRate(logs, sinceMs) {
  const rows = (Array.isArray(logs) ? logs : []).filter((x) => Number(x?.timestamp || 0) >= sinceMs);
  if (!rows.length) return { fail: 0, total: 0, rate: 0 };
  const fail = rows.filter((x) => x?.success === false).length;
  const total = rows.length;
  return { fail, total, rate: total ? fail / total : 0 };
}

function deriveStatus(provider, logs, domainRows = []) {
  const at = now();
  if (provider?.enabled === false) return PROVIDER_STATUS.DISABLED;

  const domains = Array.isArray(domainRows) ? domainRows : [];
  if (!provider?.lastCheckedAt && !(Array.isArray(logs) && logs.length) && !domains.length) {
    return PROVIDER_STATUS.UNKNOWN;
  }

  if (isBackoffActive(provider, at)) return PROVIDER_STATUS.BLOCKED;

  const threshold = clamp(provider?.failureThresholdBlocked, { min: 1, max: 20, fallback: 3 });
  if (Number(provider?.failureStreak || 0) >= threshold) return PROVIDER_STATUS.BLOCKED;

  const availableDomains = domains.filter((x) => x?.status !== DOMAIN_STATUS.BLOCKED && !isDomainBackoffActive(x, at));
  if (domains.length && !availableDomains.length) return PROVIDER_STATUS.BLOCKED;

  const blockedWindow = (Array.isArray(logs) ? logs : []).filter(
    (x) => x?.success === false && x?.errorCategory === ERROR_CATEGORY.BLOCKED && Number(x?.timestamp || 0) >= at - 2 * 60 * 60 * 1000
  );
  if (blockedWindow.length >= 2) {
    const latestBlockedTs = Math.max(...blockedWindow.map((x) => Number(x?.timestamp || 0)));
    const lastSuccessTs = Number(provider?.lastSuccessAt || 0) || 0;
    if (!lastSuccessTs || latestBlockedTs >= lastSuccessTs) return PROVIDER_STATUS.BLOCKED;
  }

  const hourStats = computeFailRate(logs, at - 60 * 60 * 1000);
  if (hourStats.total >= 3 && hourStats.rate > 0.2) return PROVIDER_STATUS.DEGRADED;

  if (domains.some((x) => x?.status === DOMAIN_STATUS.DEGRADED)) return PROVIDER_STATUS.DEGRADED;

  const recentSuccess = (Array.isArray(logs) ? logs : []).filter(
    (x) => x?.success === true && Number(x?.timestamp || 0) >= at - 60 * 60 * 1000
  );
  if (recentSuccess.length >= 3) {
    const zeroCount = recentSuccess.filter((x) => Number(x?.resultsCount || 0) === 0).length;
    if (zeroCount === recentSuccess.length) return PROVIDER_STATUS.DEGRADED;
  }

  const newest = Array.isArray(logs) && logs.length ? logs[0] : null;
  if (newest && newest.success === false) return PROVIDER_STATUS.DEGRADED;

  if (provider?.lastSuccessAt) return PROVIDER_STATUS.HEALTHY;
  return PROVIDER_STATUS.UNKNOWN;
}

function applyDomainSuccess(domainRow, { resultsCount = null, durationMs = null } = {}) {
  if (!domainRow) return;
  const t = now();
  const count = Number.isFinite(Number(resultsCount)) ? Number(resultsCount) : null;

  domainRow.lastCheckedAt = t;
  domainRow.lastSuccessAt = t;
  domainRow.failureStreak = 0;
  domainRow.backoffUntil = null;
  domainRow.lastDurationMs = Number.isFinite(Number(durationMs)) ? Number(durationMs) : domainRow.lastDurationMs || null;
  domainRow.lastErrorCategory = null;
  domainRow.lastErrorMessage = '';
  domainRow.zeroResultsStreak = count === 0 ? clamp(Number(domainRow.zeroResultsStreak || 0) + 1, { min: 0, max: 9999, fallback: 1 }) : 0;
  domainRow.status = domainRow.zeroResultsStreak >= 3 ? DOMAIN_STATUS.DEGRADED : DOMAIN_STATUS.HEALTHY;
  domainRow.updatedAt = t;
}

function applyDomainFailure(provider, domainRow, { errorCategory, message = '', durationMs = null, httpStatus = null } = {}) {
  if (!domainRow) return;
  const t = now();
  const threshold = clamp(provider?.failureThresholdBlocked, { min: 1, max: 20, fallback: 3 });
  const category = normalizeDomainErrorCategory(errorCategory, httpStatus);

  domainRow.lastCheckedAt = t;
  domainRow.failureStreak = clamp(Number(domainRow.failureStreak || 0) + 1, { min: 0, max: 9999, fallback: 1 });
  domainRow.lastDurationMs = Number.isFinite(Number(durationMs)) ? Number(durationMs) : domainRow.lastDurationMs || null;
  domainRow.lastErrorCategory = category;
  domainRow.lastErrorMessage = String(message || '').slice(0, 240);
  domainRow.zeroResultsStreak = 0;

  const shouldBlock = category === 'BLOCKED' || domainRow.failureStreak >= threshold;
  if (shouldBlock) {
    domainRow.status = DOMAIN_STATUS.BLOCKED;
    domainRow.backoffUntil = nowPlusMinutes(provider?.backoffMinutesOnError);
  } else {
    domainRow.status = DOMAIN_STATUS.DEGRADED;
  }

  domainRow.updatedAt = t;
}

function domainPublicView(domainRow) {
  return {
    ...(domainRow || {}),
    backoffRemainingMs: Math.max(0, Number(domainRow?.backoffUntil || 0) - now()),
  };
}

function orderedAttemptDomains(provider, domainRows, opts = {}) {
  const rows = Array.isArray(domainRows) ? [...domainRows] : [];
  if (!rows.length) return [];

  const force = Boolean(opts.force);
  const includeBlocked = Boolean(opts.includeBlocked);
  const onlyDomain = normalizeDomain(opts.onlyDomain || '');
  const active = normalizeDomain(provider?.activeDomain || rows[0]?.domain || '');

  if (onlyDomain) {
    const target = rows.find((x) => normalizeDomain(x?.domain || '') === onlyDomain);
    if (!target) return [];
    return [target];
  }

  const ordered = [];
  const used = new Set();
  const activeRow = rows.find((x) => normalizeDomain(x?.domain || '') === active);
  if (activeRow) {
    ordered.push(activeRow);
    used.add(normalizeDomain(activeRow?.domain || ''));
  }

  for (const row of rows) {
    const d = normalizeDomain(row?.domain || '');
    if (!d || used.has(d)) continue;
    ordered.push(row);
    used.add(d);
  }

  if (force || includeBlocked) return ordered;
  return ordered.filter((x) => x?.status !== DOMAIN_STATUS.BLOCKED && !isDomainBackoffActive(x));
}

function appendLog(db, entry) {
  db.sourceProviderLogs = Array.isArray(db.sourceProviderLogs) ? db.sourceProviderLogs : [];

  const row = {
    id: crypto.randomUUID(),
    providerId: String(entry?.providerId || '').toLowerCase(),
    providerKey: String(entry?.providerKey || entry?.providerId || '').toLowerCase(),
    mediaType: normalizeMediaType(entry?.mediaType || entry?.type || 'movie'),
    timestamp: Number(entry?.timestamp || now()),
    action: String(entry?.action || LOG_ACTION.TEST),
    success: Boolean(entry?.success),
    httpStatus: Number.isFinite(Number(entry?.httpStatus)) ? Number(entry.httpStatus) : null,
    errorCategory: entry?.errorCategory ? String(entry.errorCategory) : null,
    message: String(entry?.message || '').slice(0, 500),
    durationMs: Number.isFinite(Number(entry?.durationMs)) ? Number(entry.durationMs) : null,
    resultsCount: Number.isFinite(Number(entry?.resultsCount)) ? Number(entry.resultsCount) : null,
    domainUsed: entry?.domainUsed ? normalizeDomain(entry.domainUsed) || String(entry.domainUsed) : '',
    correlationId: entry?.correlationId ? String(entry.correlationId) : '',
    jobId: entry?.jobId ? String(entry.jobId) : '',
    detailsJson: entry?.detailsJson && typeof entry.detailsJson === 'object' ? entry.detailsJson : null,
  };

  db.sourceProviderLogs.unshift(row);
  if (db.sourceProviderLogs.length > MAX_LOGS) db.sourceProviderLogs = db.sourceProviderLogs.slice(0, MAX_LOGS);

  return row;
}

function applySuccess(provider) {
  const t = now();
  provider.lastCheckedAt = t;
  provider.lastSuccessAt = t;
  provider.lastErrorCategory = null;
  provider.lastErrorMessage = '';
  provider.failureStreak = 0;
  provider.backoffUntil = null;
  provider.backoffReasonCategory = null;
  provider.backoffReasonMessage = '';
  provider.updatedAt = t;
}

function applyFailure(provider, errorCategory, opts = {}) {
  const t = now();
  provider.lastCheckedAt = t;
  provider.lastErrorCategory = errorCategory ? String(errorCategory).toUpperCase() : ERROR_CATEGORY.UNKNOWN;
  provider.lastErrorMessage = String(opts.message || '').slice(0, 240);
  provider.failureStreak = Number(provider.failureStreak || 0) + 1;

  const threshold = clamp(provider.failureThresholdBlocked, { min: 1, max: 20, fallback: 3 });
  const backoffMinutes = clamp(provider.backoffMinutesOnError, { min: 1, max: 1440, fallback: 30 });
  const shouldBlock =
    opts.forceBlock === true ||
    errorCategory === ERROR_CATEGORY.BLOCKED ||
    Number(provider.failureStreak || 0) >= threshold;

  if (shouldBlock) {
    provider.backoffUntil = t + backoffMinutes * 60 * 1000;
    provider.status = PROVIDER_STATUS.BLOCKED;
    provider.backoffReasonCategory = provider.lastErrorCategory;
    provider.backoffReasonMessage = provider.lastErrorMessage;
  } else {
    provider.status = PROVIDER_STATUS.DEGRADED;
  }

  provider.updatedAt = t;
}

function recordProviderLastError(provider, errorCategory, message = '') {
  const t = now();
  provider.lastCheckedAt = t;
  provider.lastErrorCategory = errorCategory ? String(errorCategory).toUpperCase() : ERROR_CATEGORY.UNKNOWN;
  provider.lastErrorMessage = String(message || '').slice(0, 240);
  provider.updatedAt = t;
}

function providerPublicView(db, provider) {
  const logs = getProviderLogs(db, provider.id).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  const domainRows = getProviderDomains(db, provider.key);
  const domains = domainRows.map((x) => domainPublicView(x));
  const status = deriveStatus(provider, logs, domainRows);
  const failureCount24h = logs.filter((x) => x.success === false && Number(x.timestamp || 0) >= now() - 24 * 60 * 60 * 1000).length;
  const failRate1h = computeFailRate(logs, now() - 60 * 60 * 1000).rate;
  const backoffRemainingMs = Math.max(0, Number(provider?.backoffUntil || 0) - now());
  const primaryDomain = domains[0]?.domain || '';
  const activeDomain = normalizeDomain(provider?.activeDomain || '') || primaryDomain;
  const primaryDomainRecord = domains.find((x) => normalizeDomain(x?.domain || '') === primaryDomain) || domains[0] || null;
  const activeDomainRecord = domains.find((x) => normalizeDomain(x?.domain || '') === activeDomain) || domains[0] || null;
  const primaryDomainBackoffRemainingMs = Math.max(0, Number(primaryDomainRecord?.backoffUntil || 0) - now());
  const activeDomainBackoffRemainingMs = Math.max(0, Number(activeDomainRecord?.backoffUntil || 0) - now());
  const primaryUnavailable = Boolean(
    primaryDomainRecord &&
      (primaryDomainRecord.status === DOMAIN_STATUS.BLOCKED ||
        primaryDomainBackoffRemainingMs > 0 ||
        Number(primaryDomainRecord.failureStreak || 0) > 0)
  );

  return {
    ...provider,
    status,
    failureCount24h,
    failRate1h,
    backoffRemainingMs,
    activeDomain,
    activeBase: activeDomain,
    activeDomainStatus: activeDomainRecord?.status || DOMAIN_STATUS.UNKNOWN,
    activeDomainBackoffRemainingMs,
    primaryDomain,
    primaryUnreachableRotated: Boolean(primaryDomain && activeDomain && primaryDomain !== activeDomain && primaryUnavailable),
    domainHealth: domains,
  };
}

async function loadMutableDb() {
  const db = await getAdminDb();
  const changed = ensureStore(db);
  return { db, changed };
}

async function persistIfNeeded(db, changed) {
  if (changed) await saveAdminDb(db);
}

function findProvider(db, providerId) {
  const id = String(providerId || '').trim().toLowerCase();
  if (!id) return null;
  return (Array.isArray(db.sourceProviders) ? db.sourceProviders : []).find(
    (x) => String(x?.id || '').toLowerCase() === id || String(x?.key || '').toLowerCase() === id
  );
}

function sortProvidersForRun(db, type = 'movie') {
  const t = normalizeMediaType(type);
  return [...(Array.isArray(db.sourceProviders) ? db.sourceProviders : [])].sort(
    (a, b) => providerPriorityForType(a, t) - providerPriorityForType(b, t)
  );
}

export async function getDownloadSourcesState({ type = 'movie' } = {}) {
  const t = normalizeMediaType(type);
  const { db, changed } = await loadMutableDb();

  for (const p of db.sourceProviders) {
    p.status = deriveStatus(p, getProviderLogs(db, p.id), getProviderDomains(db, p.key));
  }

  await persistIfNeeded(db, changed);

  let providers = sortProvidersForRun(db, t).map((p) => {
    const view = providerPublicView(db, p);
    const enabledFor = view?.enabledFor && typeof view.enabledFor === 'object' ? view.enabledFor : {};
    const priorityByType = view?.priorityByType && typeof view.priorityByType === 'object' ? view.priorityByType : {};
    return {
      ...view,
      enabled: enabledFor[t] !== false,
      priority: Number(priorityByType[t] ?? view.priority ?? 0) || 0,
      supportedForType: providerSupportsRequestedType(view.key, t),
    };
  });
  providers = providers.filter((p) => p.supportedForType);

  const summary = {
    healthy: providers.filter((p) => p.status === PROVIDER_STATUS.HEALTHY).length,
    degraded: providers.filter((p) => p.status === PROVIDER_STATUS.DEGRADED).length,
    blocked: providers.filter((p) => p.status === PROVIDER_STATUS.BLOCKED).length,
    disabled: providers.filter((p) => p.status === PROVIDER_STATUS.DISABLED).length,
    unknown: providers.filter((p) => p.status === PROVIDER_STATUS.UNKNOWN).length,
  };

  return { providers, summary };
}

export async function updateDownloadSourceProvider({ providerId, patch = null, order = null, type = 'movie' } = {}) {
  const t = normalizeMediaType(type);
  const { db, changed: initialChanged } = await loadMutableDb();
  let changed = initialChanged;

  if (Array.isArray(order) && order.length) {
    const normalizedOrder = order.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
    const orderMap = new Map(normalizedOrder.map((id, idx) => [id, idx + 1]));
    for (const p of db.sourceProviders) {
      const key = String(p.id || p.key || '').toLowerCase();
      if (orderMap.has(key)) {
        p.priorityByType = p.priorityByType && typeof p.priorityByType === 'object' ? p.priorityByType : { movie: p.priority || 1, series: p.priority || 1 };
        p.priorityByType[t] = orderMap.get(key);
        if (t === 'movie') p.priority = orderMap.get(key);
        p.updatedAt = now();
        changed = true;
      }
    }
    db.sourceProviders = normalizePrioritiesForType(db.sourceProviders, t);
  }

  if (providerId && patch && typeof patch === 'object') {
    const p = findProvider(db, providerId);
    if (!p) throw new Error('Provider not found.');

    p.enabledFor = p.enabledFor && typeof p.enabledFor === 'object' ? p.enabledFor : { movie: p.enabled !== false, series: providerSupportsRequestedType(p.key, 'series') ? p.enabled !== false : false };
    p.priorityByType = p.priorityByType && typeof p.priorityByType === 'object' ? p.priorityByType : { movie: p.priority || 1, series: p.priority || 1 };

    if (patch.enabled !== undefined) {
      p.enabledFor[t] = Boolean(patch.enabled);
      if (t === 'movie') p.enabled = Boolean(patch.enabled);
    }
    if (patch.priority !== undefined) {
      p.priorityByType[t] = clamp(patch.priority, { min: 1, max: 9999, fallback: p.priorityByType[t] || p.priority || 1 });
      if (t === 'movie') p.priority = p.priorityByType[t];
    }
    if (patch.stopOnFirstValid !== undefined) p.stopOnFirstValid = Boolean(patch.stopOnFirstValid);
    if (patch.maxAttemptsPerTitle !== undefined)
      p.maxAttemptsPerTitle = clamp(patch.maxAttemptsPerTitle, { min: 1, max: 5, fallback: p.maxAttemptsPerTitle || 2 });
    if (patch.backoffMinutesOnError !== undefined)
      p.backoffMinutesOnError = clamp(patch.backoffMinutesOnError, { min: 1, max: 1440, fallback: p.backoffMinutesOnError || 30 });
    if (patch.failureThresholdBlocked !== undefined)
      p.failureThresholdBlocked = clamp(patch.failureThresholdBlocked, { min: 1, max: 20, fallback: p.failureThresholdBlocked || 3 });
    if (patch.testQuery !== undefined) p.testQuery = String(patch.testQuery || '').trim() || DEFAULT_TEST_QUERY;

    if (patch.resetBackoff) {
      p.backoffUntil = null;
      p.failureStreak = 0;
    }

    const cfg = p.config && typeof p.config === 'object' ? p.config : {};
    p.config = cfg;

    if (p.key === 'yts') {
      if (patch.config && typeof patch.config === 'object') {
        if (patch.config.apiBaseUrl !== undefined) {
          const raw = String(patch.config.apiBaseUrl || '').trim();
          const domain = extractDomainFromUrlLike(raw);
          if (!domain) throw new Error('YTS API base URL must start with http:// or https://');
          syncProviderDomains(db, p, [domain, ...normalizeProviderDomainsList(p)], { strict: false });
          try {
            const u = new URL(raw);
            if (u.pathname && u.pathname !== '/') cfg.apiBasePath = normalizeApiBasePath(u.pathname);
          } catch {}
          changed = true;
        }
        if (patch.config.apiBasePath !== undefined) {
          cfg.apiBasePath = normalizeApiBasePath(patch.config.apiBasePath);
        }
        if (patch.config.endpoint !== undefined) {
          cfg.endpoint = normalizeYtsEndpoint(patch.config.endpoint);
        }
        if (patch.config.domains !== undefined) {
          const domains = normalizeDomains(patch.config.domains);
          if (!domains.length) throw new Error('YTS domains list cannot be empty.');
          syncProviderDomains(db, p, domains, { strict: true });
          changed = true;
        }
      }
    }

    if (p.key === 'tpb') {
      if (patch.config && typeof patch.config === 'object') {
        if (patch.config.domains !== undefined) {
          const domains = normalizeDomains(patch.config.domains);
          if (!domains.length) throw new Error('TPB domains list cannot be empty.');
          syncProviderDomains(db, p, domains, { strict: true });
          changed = true;
        }
        if (patch.config.searchPathTemplate !== undefined) {
          cfg.searchPathTemplate = normalizeTpbSearchPathTemplate(patch.config.searchPathTemplate);
        }
      }
    }

    if (p.key === 'eztv') {
      if (patch.config && typeof patch.config === 'object') {
        if (patch.config.domains !== undefined) {
          const domains = normalizeDomains(patch.config.domains);
          if (!domains.length) throw new Error('EZTV domains list cannot be empty.');
          syncProviderDomains(db, p, domains, { strict: true });
          changed = true;
        }
        if (patch.config.endpoint !== undefined) {
          cfg.endpoint = normalizeEztvEndpoint(patch.config.endpoint);
        }
      }
    }

    if (patch.removeDomain !== undefined) {
      const removeDomain = normalizeDomain(patch.removeDomain);
      const current = getProviderDomains(db, p.key);
      const keep = current.map((x) => normalizeDomain(x.domain)).filter((x) => x && x !== removeDomain);
      if (!keep.length) throw new Error('At least one domain is required.');
      syncProviderDomains(db, p, keep, { strict: true });
      changed = true;
    }

    if (patch.activeDomain !== undefined) {
      const activeDomain = normalizeDomain(patch.activeDomain);
      const row = findProviderDomain(db, p.key, activeDomain);
      if (!row) throw new Error('Active domain must exist in provider domains list.');
      p.activeDomain = activeDomain;
    }

    // Keep domain records and config domain list in sync after config updates.
    syncProviderDomains(db, p, null, { strict: false });

    p.updatedAt = now();
    p.status = deriveStatus(p, getProviderLogs(db, p.id), getProviderDomains(db, p.key));
    changed = true;
  }

  db.sourceProviders = normalizePrioritiesForType(db.sourceProviders, t);
  for (const p of db.sourceProviders) {
    p.status = deriveStatus(p, getProviderLogs(db, p.id), getProviderDomains(db, p.key));
  }

  await persistIfNeeded(db, changed);
  return getDownloadSourcesState({ type: t });
}

async function runProviderActionWithRotation(db, provider, opts = {}) {
  const mode = String(opts.mode || 'test').toLowerCase(); // test | search
  const providerId = String(provider.id || provider.key || '').toLowerCase();
  const force = Boolean(opts.force);
  const onlyDomain = normalizeDomain(opts.onlyDomain || '');
  const includeBlocked = Boolean(opts.includeBlocked);
  const correlationId = String(opts.correlationId || `${mode}-${providerId}-${now()}`);
  const jobId = opts.jobId ? String(opts.jobId) : '';
  const query = String(opts.query || provider.testQuery || DEFAULT_TEST_QUERY).trim() || DEFAULT_TEST_QUERY;
  const mediaType = normalizeMediaType(opts.type || 'movie');
  const minSeeders = Math.max(0, Number(opts.minSeeders ?? provider?.minSeeders ?? 0) || 0);
  const minSizeGb = opts.minSizeGb === null || opts.minSizeGb === undefined ? null : Math.max(0, Number(opts.minSizeGb) || 0);
  const maxSizeGb = opts.maxSizeGb === null || opts.maxSizeGb === undefined ? null : Math.max(0, Number(opts.maxSizeGb) || 0);
  const excludePatterns = Array.isArray(opts.excludePatterns) ? opts.excludePatterns : [];
  const actionName = mode === 'search' ? LOG_ACTION.SEARCH : onlyDomain ? LOG_ACTION.TEST_ACTIVE : LOG_ACTION.TEST;

  if (!force && !includeBlocked && isBackoffActive(provider)) {
    const reasonCategory = provider.backoffReasonCategory || provider.lastErrorCategory || ERROR_CATEGORY.BLOCKED;
    const logRow = appendLog(db, {
      providerId,
      providerKey: provider.key,
      mediaType,
      action: LOG_ACTION.BACKOFF,
      success: false,
      errorCategory: reasonCategory,
      message: 'Skipped due to active provider backoff.',
      durationMs: 0,
      resultsCount: 0,
      domainUsed: provider.activeDomain || '',
      correlationId,
      jobId,
      detailsJson: { backoffUntil: provider.backoffUntil, reasonCategory },
    });
    return {
      ok: false,
      skipped: true,
      reason: 'provider_backoff',
      providerId,
      log: logRow,
      backoffUntil: provider.backoffUntil,
      attempts: [],
    };
  }

  const domainRows = getProviderDomains(db, provider.key);
  const candidates = orderedAttemptDomains(provider, domainRows, {
    force,
    includeBlocked,
    onlyDomain,
  });

  if (!candidates.length) {
    applyFailure(provider, ERROR_CATEGORY.BLOCKED, { forceBlock: true, message: 'No available domains (all blocked/backoff).' });
    const unavailableDomains = domainRows.map((row) => ({
      domain: normalizeDomain(row?.domain || ''),
      status: row?.status || DOMAIN_STATUS.UNKNOWN,
      backoff_until: row?.backoffUntil || null,
    }));
    const attemptedDomains = unavailableDomains.map((x) => x.domain).filter(Boolean);
    const logRow = appendLog(db, {
      providerId,
      providerKey: provider.key,
      mediaType,
      action: LOG_ACTION.BACKOFF,
      success: false,
      errorCategory: ERROR_CATEGORY.BLOCKED,
      message: 'No available domains (all blocked/backoff); provider entered backoff.',
      durationMs: 0,
      resultsCount: 0,
      domainUsed: provider.activeDomain || '',
      correlationId,
      jobId,
      detailsJson: {
        attempted_domains: attemptedDomains,
        per_attempt_outcomes: unavailableDomains.map((x) => ({
          domain: x.domain,
          success: false,
          error_category: x.status === DOMAIN_STATUS.BLOCKED ? 'BLOCKED' : 'NETWORK',
          error_code: x.status === DOMAIN_STATUS.BLOCKED ? 'DOMAIN_BLOCKED' : 'DOMAIN_BACKOFF',
          duration_ms: null,
          http_status: null,
        })),
        selected_domain: '',
        unavailable_domains: unavailableDomains,
        backoffUntil: provider.backoffUntil || null,
      },
    });
    return {
      ok: false,
      skipped: true,
      reason: 'no_available_domains',
      providerId,
      log: logRow,
      attempts: [],
      backoffUntil: provider.backoffUntil || null,
    };
  }

  const attemptedDomains = [];
  const attemptOutcomes = [];
  let selected = null;
  let selectedRes = null;
  let lastErr = null;

  for (const domainRow of candidates) {
    const domain = normalizeDomain(domainRow?.domain || '');
    if (!domain) continue;
    attemptedDomains.push(domain);

    const started = now();
    try {
      const res =
        mode === 'search'
          ? await runProviderSearch(provider, {
              query,
              year: opts.year,
              type: mediaType,
              timeoutMs: 20000,
              maxResults: opts.maxResults || 50,
              domain,
              minSeeders,
              minSizeGb,
              maxSizeGb,
              excludePatterns,
            })
          : await runProviderTest(provider, {
              query,
              timeoutMs: 20000,
              maxResults: opts.maxResults || 30,
              domain,
            });

      const durationMs = Number(res?.durationMs || Math.max(1, now() - started)) || null;
      const resultsCount = Array.isArray(res?.results) ? res.results.length : 0;

      applyDomainSuccess(domainRow, { resultsCount, durationMs });
      applySuccess(provider);

      const previousActive = normalizeDomain(provider.activeDomain || '');
      provider.activeDomain = domain;
      if (previousActive && previousActive !== domain) {
        appendLog(db, {
          providerId,
          providerKey: provider.key,
          mediaType,
          action: LOG_ACTION.ROTATE,
          success: true,
          message: `Rotated active domain from ${previousActive} to ${domain}.`,
          durationMs: 0,
          resultsCount: 0,
          domainUsed: domain,
          correlationId,
          jobId,
          detailsJson: {
            from: previousActive,
            to: domain,
          },
        });
      }

      const outcome = {
        domain,
        success: true,
        error_category: null,
        error_code: '',
        duration_ms: durationMs,
        http_status: res?.responseStatus || null,
      };
      attemptOutcomes.push(outcome);

      selected = domain;
      selectedRes = res;
      break;
    } catch (e) {
      const err = toProviderError(e, { category: ERROR_CATEGORY.UNKNOWN });
      const durationMs = Math.max(1, now() - started);
      applyDomainFailure(provider, domainRow, {
        errorCategory: err.category,
        message: err.message || 'Provider request failed',
        durationMs,
        httpStatus: err.httpStatus,
      });
      recordProviderLastError(provider, err.category, err.message || 'Provider request failed');
      lastErr = err;

      attemptOutcomes.push({
        domain,
        success: false,
        error_category: normalizeDomainErrorCategory(err.category, err.httpStatus),
        error_code: err?.details?.causeCode || '',
        duration_ms: durationMs,
        http_status: err.httpStatus || null,
      });
    }
  }

  if (selected && selectedRes) {
    const resultsCount = Array.isArray(selectedRes?.results) ? selectedRes.results.length : 0;
    const logRow = appendLog(db, {
      providerId,
      providerKey: provider.key,
      mediaType,
      action: actionName,
      success: true,
      httpStatus: selectedRes?.responseStatus || null,
      message: `Parsed ${resultsCount} result(s).`,
      durationMs: Number(selectedRes?.durationMs || 0) || null,
      resultsCount,
      domainUsed: selected,
      correlationId,
      jobId,
      detailsJson: {
        requestUrl: selectedRes?.requestUrl || '',
        responseSnippet: sanitizeResponseSnippet(selectedRes?.rawSnippet || '', 500),
        attempted_domains: attemptedDomains,
        per_attempt_outcomes: attemptOutcomes,
        selected_domain: selected,
      },
    });

    provider.status = deriveStatus(provider, getProviderLogs(db, providerId), getProviderDomains(db, provider.key));

    return {
      ok: true,
      providerId,
      log: logRow,
      resultsCount,
      durationMs: Number(selectedRes?.durationMs || 0) || null,
      requestUrl: selectedRes?.requestUrl || '',
      selectedDomain: selected,
      attempts: attemptOutcomes,
      response: selectedRes,
    };
  }

  const finalErrCategory = lastErr?.category || ERROR_CATEGORY.BLOCKED;
  applyFailure(provider, finalErrCategory, { forceBlock: true, message: lastErr?.message || 'All domains failed' });
  appendLog(db, {
    providerId,
    providerKey: provider.key,
    mediaType,
    action: LOG_ACTION.BACKOFF,
    success: false,
    errorCategory: finalErrCategory,
    message: 'All domains failed; provider entered backoff.',
    durationMs: 0,
    resultsCount: 0,
    domainUsed: provider.activeDomain || '',
    correlationId,
    jobId,
    detailsJson: {
        backoffUntil: provider.backoffUntil || null,
        attempted_domains: attemptedDomains,
        per_attempt_outcomes: attemptOutcomes,
        selected_domain: '',
      },
    });
  const logRow = appendLog(db, {
    providerId,
    providerKey: provider.key,
    mediaType,
    action: actionName,
    success: false,
    httpStatus: lastErr?.httpStatus || null,
    errorCategory: finalErrCategory,
    message: `All domains failed (${attemptedDomains.length} attempted).`,
    durationMs: null,
    resultsCount: 0,
    domainUsed: selected || provider.activeDomain || '',
    correlationId,
    jobId,
      detailsJson: {
        requestUrl: lastErr?.url || '',
        responseSnippet: sanitizeResponseSnippet(lastErr?.details?.responseSnippet || '', 500),
        attempted_domains: attemptedDomains,
        per_attempt_outcomes: attemptOutcomes,
        selected_domain: '',
        stack: String(lastErr?.stack || ''),
      },
    });

  provider.status = deriveStatus(provider, getProviderLogs(db, providerId), getProviderDomains(db, provider.key));

  return {
    ok: false,
    providerId,
    error: String(lastErr?.message || 'All domains failed'),
    errorCategory: lastErr?.category || ERROR_CATEGORY.BLOCKED,
    log: logRow,
    backoffUntil: provider.backoffUntil || null,
    attempts: attemptOutcomes,
  };
}

async function runSingleProviderTest(db, provider, opts = {}) {
  const providerId = String(provider.id || provider.key || '').toLowerCase();
  const correlationId = String(opts.correlationId || `manual-test-${providerId}-${now()}`);
  const jobId = opts.jobId ? String(opts.jobId) : '';

  return runProviderActionWithRotation(db, provider, {
    mode: 'test',
    query: opts.query,
    type: opts.type || 'movie',
    force: Boolean(opts.force),
    onlyDomain: opts.onlyDomain || '',
    correlationId,
    jobId,
    maxResults: 30,
  });
}

export async function testDownloadSourceProvider({ providerId, query = '', type = 'movie', force = false, onlyDomain = '', correlationId = '', jobId = '' } = {}) {
  const { db, changed: initialChanged } = await loadMutableDb();
  let changed = initialChanged;

  const provider = findProvider(db, providerId);
  if (!provider) throw new Error('Provider not found.');

  const result = await runSingleProviderTest(db, provider, {
    query,
    type,
    force,
    onlyDomain,
    correlationId,
    jobId,
  });

  changed = true;
  await persistIfNeeded(db, changed);

  return {
    ...result,
    provider: providerPublicView(db, provider),
  };
}

export async function testAllDownloadSources({ force = false, type = 'movie' } = {}) {
  const { db, changed: initialChanged } = await loadMutableDb();
  let changed = initialChanged;

  const results = [];
  const mediaType = normalizeMediaType(type);
  for (const provider of sortProvidersForRun(db, mediaType).filter(
    (p) => providerEnabledForType(p, mediaType) && providerSupportsRequestedType(p.key, mediaType)
  )) {
    const r = await runSingleProviderTest(db, provider, {
      force,
      correlationId: `test-all-${provider.key}-${now()}`,
    });
    results.push(r);
  }

  changed = true;
  await persistIfNeeded(db, changed);

  return {
    ok: true,
    results,
    providers: sortProvidersForRun(db, mediaType).map((p) => providerPublicView(db, p)),
  };
}

export async function validateDownloadSourceProviderDomains({
  providerId,
  domain = '',
  type = 'movie',
  query = '',
  correlationId = '',
  jobId = '',
} = {}) {
  const { db, changed: initialChanged } = await loadMutableDb();
  let changed = initialChanged;

  const provider = findProvider(db, providerId);
  if (!provider) throw new Error('Provider not found.');

  const providerKey = String(provider.key || provider.id || '').toLowerCase();
  const cid = String(correlationId || `validate-${providerKey}-${now()}`);
  const jid = jobId ? String(jobId) : '';
  const testQuery = String(query || provider.testQuery || DEFAULT_TEST_QUERY).trim() || DEFAULT_TEST_QUERY;
  const mediaType = normalizeMediaType(type);

  const domainRows = getProviderDomains(db, provider.key);
  const candidates = orderedAttemptDomains(provider, domainRows, {
    includeBlocked: true,
    force: true,
    onlyDomain: domain || '',
  });
  if (!candidates.length) throw new Error('No domains configured for provider.');

  const results = [];
  for (const domainRow of candidates) {
    const target = normalizeDomain(domainRow?.domain || '');
    const started = now();
    try {
      const res = await runProviderTest(provider, {
        query: testQuery,
        timeoutMs: 20000,
        maxResults: 30,
        domain: target,
      });
      const durationMs = Number(res?.durationMs || Math.max(1, now() - started)) || null;
      const resultsCount = Array.isArray(res?.results) ? res.results.length : 0;
      applyDomainSuccess(domainRow, { resultsCount, durationMs });

      const row = appendLog(db, {
        providerId: providerKey,
        providerKey,
        mediaType,
        action: LOG_ACTION.VALIDATE_DOMAIN,
        success: true,
        httpStatus: res?.responseStatus || null,
        message: `Domain validation passed (${resultsCount} result(s)).`,
        durationMs,
        resultsCount,
        domainUsed: target,
        correlationId: cid,
        jobId: jid,
        detailsJson: {
          requestUrl: res?.requestUrl || '',
          responseSnippet: sanitizeResponseSnippet(res?.rawSnippet || '', 500),
          attempted_domains: [target],
          per_attempt_outcomes: [
            {
              domain: target,
              success: true,
              error_category: null,
              error_code: '',
              duration_ms: durationMs,
              http_status: res?.responseStatus || null,
            },
          ],
          selected_domain: target,
        },
      });

      results.push({
        ok: true,
        domain: target,
        httpStatus: res?.responseStatus || null,
        resultsCount,
        durationMs,
        requestUrl: res?.requestUrl || '',
        logId: row.id,
      });
    } catch (e) {
      const err = toProviderError(e, { category: ERROR_CATEGORY.UNKNOWN });
      const durationMs = Math.max(1, now() - started);
      applyDomainFailure(provider, domainRow, {
        errorCategory: err.category,
        message: err.message || 'Domain validation failed',
        durationMs,
        httpStatus: err.httpStatus,
      });

      const row = appendLog(db, {
        providerId: providerKey,
        providerKey,
        mediaType,
        action: LOG_ACTION.VALIDATE_DOMAIN,
        success: false,
        httpStatus: err.httpStatus || null,
        errorCategory: normalizeDomainErrorCategory(err.category, err.httpStatus),
        message: String(err.message || 'Domain validation failed'),
        durationMs,
        resultsCount: 0,
        domainUsed: target,
        correlationId: cid,
        jobId: jid,
        detailsJson: {
          requestUrl: err.url || '',
          responseSnippet: sanitizeResponseSnippet(err?.details?.responseSnippet || '', 500),
          attempted_domains: [target],
          per_attempt_outcomes: [
            {
              domain: target,
              success: false,
              error_category: normalizeDomainErrorCategory(err.category, err.httpStatus),
              error_code: err?.details?.causeCode || '',
              duration_ms: durationMs,
              http_status: err.httpStatus || null,
            },
          ],
          selected_domain: '',
          stack: String(e?.stack || ''),
        },
      });

      results.push({
        ok: false,
        domain: target,
        error: String(err.message || 'Domain validation failed'),
        errorCategory: normalizeDomainErrorCategory(err.category, err.httpStatus),
        httpStatus: err.httpStatus || null,
        durationMs,
        logId: row.id,
      });
    }
  }

  provider.status = deriveStatus(provider, getProviderLogs(db, provider.id), getProviderDomains(db, provider.key));
  provider.updatedAt = now();
  changed = true;
  await persistIfNeeded(db, changed);

  return {
    ok: results.every((x) => x.ok),
    results,
    provider: providerPublicView(db, provider),
  };
}

export async function queryDownloadSourceLogs({
  provider = 'all',
  type = 'movie',
  domain = 'all',
  range = '24h',
  status = 'all',
  errorCategory = 'all',
  view = 'recent',
  limit = 300,
} = {}) {
  const { db, changed } = await loadMutableDb();
  await persistIfNeeded(db, changed);

  const mediaType = normalizeMediaType(type);
  const maxRows = clamp(limit, { min: 1, max: 2000, fallback: 300 });
  const providerId = String(provider || 'all').trim().toLowerCase();
  const domainRaw = String(domain || 'all').trim().toLowerCase();
  const domainFilter = domainRaw === 'all' ? '' : normalizeDomain(domainRaw);
  const statusFilter = String(status || 'all').trim().toLowerCase();
  const errFilter = String(errorCategory || 'all').trim().toUpperCase();
  const tab = String(view || 'recent').trim().toLowerCase();

  const rangeMap = {
    '24h': 24,
    '7d': 24 * 7,
  };
  const hours = rangeMap[String(range || '24h').toLowerCase()] || 24;
  const since = now() - hours * 60 * 60 * 1000;

  let rows = Array.isArray(db.sourceProviderLogs) ? [...db.sourceProviderLogs] : [];
  rows = rows.filter((x) => Number(x?.timestamp || 0) >= since);
  rows = rows.filter((x) => {
    const rowType = normalizeMediaType(x?.mediaType || 'movie');
    if (mediaType === 'series') return rowType === 'series';
    return rowType === 'movie';
  });

  if (providerId !== 'all') {
    rows = rows.filter((x) => String(x?.providerId || '').toLowerCase() === providerId);
  }
  if (domainFilter) {
    rows = rows.filter((x) => normalizeDomain(x?.domainUsed || '') === domainFilter);
  }

  if (statusFilter === 'success') rows = rows.filter((x) => x?.success === true);
  else if (statusFilter === 'fail') rows = rows.filter((x) => x?.success === false);

  if (errFilter !== 'ALL') rows = rows.filter((x) => String(x?.errorCategory || '').toUpperCase() === errFilter);

  if (tab === 'errors') {
    rows = rows.filter((x) => x?.success === false);
  } else if (tab === 'backoff') {
    rows = rows.filter((x) => String(x?.action || '').toLowerCase() === LOG_ACTION.BACKOFF);
  }

  rows.sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
  rows = rows.slice(0, maxRows);

  return {
    logs: rows,
    providers: sortProvidersForRun(db, mediaType).map((p) => providerPublicView(db, p)),
  };
}

export async function clearDownloadSourceLogs({ provider = 'all', type = 'movie' } = {}) {
  const { db, changed: initialChanged } = await loadMutableDb();
  let changed = initialChanged;

  const mediaType = normalizeMediaType(type);
  const providerId = String(provider || 'all').trim().toLowerCase();

  const beforeLogs = Array.isArray(db.sourceProviderLogs) ? db.sourceProviderLogs : [];
  const keepIfTypeDoesNotMatch = (row) => {
    const rowType = normalizeMediaType(row?.mediaType || 'movie');
    if (mediaType === 'series') return rowType !== 'series';
    return rowType !== 'movie';
  };

  const nextLogs = beforeLogs.filter((x) => {
    const rowProvider = String(x?.providerId || '').toLowerCase();
    const providerMatches = providerId === 'all' ? true : rowProvider === providerId;
    if (!providerMatches) return true;
    return keepIfTypeDoesNotMatch(x);
  });
  const deletedCount = Math.max(0, beforeLogs.length - nextLogs.length);
  if (deletedCount > 0) {
    db.sourceProviderLogs = nextLogs;
    changed = true;
  }

  let deletedDomainHealthCount = 0;
  for (const row of Array.isArray(db.sourceProviderDomains) ? db.sourceProviderDomains : []) {
    const rowKey = String(row?.providerKey || row?.providerId || '').toLowerCase();
    if (providerId !== 'all' && rowKey !== providerId) continue;
    deletedDomainHealthCount += 1;
    row.status = DOMAIN_STATUS.UNKNOWN;
    row.lastCheckedAt = null;
    row.lastSuccessAt = null;
    row.failureStreak = 0;
    row.backoffUntil = null;
    row.lastErrorCategory = null;
    row.lastErrorMessage = '';
    row.lastDurationMs = null;
    row.zeroResultsStreak = 0;
    row.updatedAt = now();
    changed = true;
  }

  const beforeLegacyDomainHealth = Array.isArray(db.sourceProviderDomainHealth) ? db.sourceProviderDomainHealth : [];
  const nextLegacyDomainHealth =
    providerId === 'all'
      ? []
      : beforeLegacyDomainHealth.filter((x) => String(x?.providerId || '').toLowerCase() !== providerId);
  if (nextLegacyDomainHealth.length !== beforeLegacyDomainHealth.length) {
    db.sourceProviderDomainHealth = nextLegacyDomainHealth;
    changed = true;
  }

  for (const p of Array.isArray(db.sourceProviders) ? db.sourceProviders : []) {
    const nextStatus = deriveStatus(p, getProviderLogs(db, p.id), getProviderDomains(db, p.key));
    if (String(p.status || '') !== String(nextStatus || '')) {
      p.status = nextStatus;
      p.updatedAt = now();
      changed = true;
    }
  }

  await persistIfNeeded(db, changed);

  const providers = sortProvidersForRun(db, mediaType).map((p) => providerPublicView(db, p));
  const summary = {
    healthy: providers.filter((p) => p.status === PROVIDER_STATUS.HEALTHY).length,
    degraded: providers.filter((p) => p.status === PROVIDER_STATUS.DEGRADED).length,
    blocked: providers.filter((p) => p.status === PROVIDER_STATUS.BLOCKED).length,
    disabled: providers.filter((p) => p.status === PROVIDER_STATUS.DISABLED).length,
    unknown: providers.filter((p) => p.status === PROVIDER_STATUS.UNKNOWN).length,
  };

  return {
    deletedCount,
    deletedDomainHealthCount,
    providers,
    summary,
  };
}

export async function searchBestDownloadSource({
  query,
  year = null,
  type = 'movie',
  correlationId = '',
  jobId = '',
  stopOnFirstValid = true,
  minSeeders = 0,
  minSizeGb = null,
  maxSizeGb = null,
  excludePatterns = [],
} = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required for source search.');

  const { db, changed: initialChanged } = await loadMutableDb();
  let changed = initialChanged;

  const mediaType = normalizeMediaType(type);
  const providers = sortProvidersForRun(db, mediaType).filter(
    (p) => providerEnabledForType(p, mediaType) && providerSupportsRequestedType(p.key, mediaType)
  );
  const attempts = [];
  const collected = [];

  for (const provider of providers) {
    const providerId = String(provider.id || provider.key || '').toLowerCase();
    const maxAttempts = clamp(provider.maxAttemptsPerTitle, { min: 1, max: 5, fallback: 2 });

    for (let i = 0; i < maxAttempts; i++) {
      const r = await runProviderActionWithRotation(db, provider, {
        mode: 'search',
        query: q,
        year,
        type,
        minSeeders,
        minSizeGb,
        maxSizeGb,
        excludePatterns,
        force: false,
        correlationId,
        jobId,
        maxResults: 50,
      });

      if (r.skipped) {
        attempts.push({
          providerId,
          success: false,
          skipped: true,
          reason: r.reason || 'skipped',
          logId: r?.log?.id || '',
        });
        changed = true;
        break;
      }

      if (r.ok) {
        const ranked = Array.isArray(r?.response?.results) ? r.response.results : [];
        const matchedRanked = filterSourcesForRequestedMedia(ranked, { title: q, year, type });
        for (const item of matchedRanked) collected.push(item);

        attempts.push({
          providerId,
          success: true,
          resultsCount: ranked.length,
          matchedCount: matchedRanked.length,
          logId: r?.log?.id || '',
          domainUsed: r.selectedDomain || '',
          perAttemptOutcomes: Array.isArray(r.attempts) ? r.attempts : [],
        });
        changed = true;

        const candidate = pickBestSource(matchedRanked);
        if (candidate && (stopOnFirstValid || provider.stopOnFirstValid !== false)) {
          const selected = pickBestSource(collected);
          provider.status = deriveStatus(provider, getProviderLogs(db, providerId), getProviderDomains(db, provider.key));
          await persistIfNeeded(db, true);
          return {
            ok: true,
            selected,
            attempts,
            providers: sortProvidersForRun(db, mediaType).map((p) => providerPublicView(db, p)),
          };
        }

        break;
      }

      attempts.push({
        providerId,
        success: false,
        error: String(r.error || 'Source search failed'),
        errorCategory: r.errorCategory || ERROR_CATEGORY.UNKNOWN,
        logId: r?.log?.id || '',
        domainUsed: r?.log?.domainUsed || '',
        perAttemptOutcomes: Array.isArray(r.attempts) ? r.attempts : [],
      });
      changed = true;
    }
  }

  for (const p of db.sourceProviders) {
    p.status = deriveStatus(p, getProviderLogs(db, p.id), getProviderDomains(db, p.key));
  }

  await persistIfNeeded(db, true);

  return {
    ok: false,
    selected: pickBestSource(collected),
    attempts,
    providers: sortProvidersForRun(db, mediaType).map((p) => providerPublicView(db, p)),
  };
}
