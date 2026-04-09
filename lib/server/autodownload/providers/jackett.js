import 'server-only';

import {
  categorizeHttpFailure,
  ERROR_CATEGORY,
  extractBtih,
  fetchWithTimeout,
  normalizeDomain,
  parseSizeToGb,
  ProviderAdapter,
  ProviderError,
  sanitizeResponseSnippet,
} from './base';

function now() {
  return Date.now();
}

const DEFAULT_JACKETT_DOMAINS = ['http://127.0.0.1:9117'];
const DEFAULT_JACKETT_ENDPOINT = '/api/v2.0/indexers/all/results/torznab/api';

function normalizeDomains(rawList) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const d = normalizeDomain(raw);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.length ? out : [...DEFAULT_JACKETT_DOMAINS];
}

function normalizeEndpoint(raw) {
  let endpoint = String(raw || DEFAULT_JACKETT_ENDPOINT).trim() || DEFAULT_JACKETT_ENDPOINT;
  if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`;
  return endpoint;
}

function toResultsEndpoint(endpoint) {
  const normalized = normalizeEndpoint(endpoint).replace(/\/+$/, '');
  if (/\/torznab\/api$/i.test(normalized)) return normalized.replace(/\/torznab\/api$/i, '');
  return normalized;
}

function normalizeConfig(provider) {
  const cfg = provider?.config && typeof provider.config === 'object' ? provider.config : {};
  const domains = normalizeDomains(cfg.domains);
  const endpoint = normalizeEndpoint(cfg.endpoint || DEFAULT_JACKETT_ENDPOINT);
  const activeDomain = normalizeDomain(provider?.activeDomain || '') || domains[0] || DEFAULT_JACKETT_DOMAINS[0];
  const apiKey = String(cfg.apiKey || '').trim();
  return {
    domains,
    endpoint,
    resultsEndpoint: toResultsEndpoint(endpoint),
    activeDomain,
    apiKey,
  };
}

function inferQuality(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('2160p') || s.includes('4k')) return '2160p';
  if (s.includes('1080p')) return '1080p';
  if (s.includes('720p')) return '720p';
  if (s.includes('480p')) return '480p';
  return 'unknown';
}

function imdbDigits(query) {
  const q = String(query || '').trim();
  const tt = q.match(/\btt(\d{7,8})\b/i);
  if (tt?.[1]) return tt[1];
  const digits = q.match(/\b(\d{7,8})\b/);
  return digits?.[1] || '';
}

function normalizeImdbDigits(value) {
  const digits = String(value ?? '').match(/\b(\d{6,9})\b/);
  return digits?.[1] || '';
}

function normalizeLink(raw, base) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    return new URL(s, `${String(base || '').replace(/\/+$/, '')}/`).toString();
  } catch {
    return s;
  }
}

export class JackettProviderAdapter extends ProviderAdapter {
  async search({ query, timeoutMs = 20000, domain = '' } = {}) {
    const cfg = normalizeConfig(this.provider);
    if (!cfg.apiKey) {
      throw new ProviderError('Jackett API key is missing.', {
        category: ERROR_CATEGORY.AUTH,
        domainUsed: cfg.activeDomain,
      });
    }

    const domainUsed = normalizeDomain(domain || cfg.activeDomain || cfg.domains[0] || DEFAULT_JACKETT_DOMAINS[0]);
    const req = new URL(cfg.resultsEndpoint, `${domainUsed}/`);
    const q = String(query || '').trim();
    if (!q) {
      throw new ProviderError('Jackett search query is required.', {
        category: ERROR_CATEGORY.PARSE,
        url: req.toString(),
        domainUsed,
      });
    }

    req.searchParams.set('apikey', cfg.apiKey);
    req.searchParams.set('Query', q);

    const imdb = imdbDigits(q);
    if (imdb) req.searchParams.set('imdbid', imdb);

    const reqUrl = req.toString();
    const res = await fetchWithTimeout(reqUrl, {
      timeoutMs,
      headers: { accept: 'application/json' },
    });

    const snippet = sanitizeResponseSnippet(res.text);

    if (!res.ok) {
      throw new ProviderError(`HTTP ${res.status}`, {
        category: categorizeHttpFailure({ status: res.status, bodySnippet: snippet }),
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: snippet },
      });
    }

    if (/\/ui\/login/i.test(String(res.url || ''))) {
      throw new ProviderError('Jackett authentication failed.', {
        category: ERROR_CATEGORY.AUTH,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: snippet },
      });
    }

    let json;
    try {
      json = JSON.parse(String(res.text || '{}'));
    } catch {
      throw new ProviderError('Invalid JSON from Jackett', {
        category: ERROR_CATEGORY.PARSE,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: snippet },
      });
    }

    const rows = Array.isArray(json?.Results) ? json.Results : Array.isArray(json?.results) ? json.results : [];
    if (!Array.isArray(rows)) {
      throw new ProviderError('Missing expected Jackett results schema.', {
        category: ERROR_CATEGORY.PARSE,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: snippet },
      });
    }

    const results = rows.map((row) => {
      const name = String(row?.Title || '').trim();
      const magnet = String(row?.MagnetUri || '').trim();
      const sourceUrl = normalizeLink(row?.Link || '', domainUsed);
      const hash = String(row?.InfoHash || extractBtih(magnet) || '').trim().toUpperCase();
      return {
        provider: 'jackett',
        imdbIdDigits: normalizeImdbDigits(row?.Imdb),
        title: name,
        year: Number(row?.Year || 0) || null,
        name,
        seeders: Number(row?.Seeders || 0) || 0,
        sizeGb: parseSizeToGb(row?.Size ?? null),
        quality: inferQuality(name),
        magnet,
        sourceUrl,
        hash,
        domainUsed,
        fetchedAt: now(),
      };
    });

    return {
      ok: true,
      requestUrl: reqUrl,
      responseStatus: res.status,
      durationMs: res.durationMs,
      domainUsed,
      results,
      rawSnippet: snippet,
    };
  }

  async test({ query, timeoutMs = 20000, domain = '' } = {}) {
    return this.search({ query, timeoutMs, domain });
  }
}
