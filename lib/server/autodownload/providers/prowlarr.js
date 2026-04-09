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

const DEFAULT_PROWLARR_DOMAINS = ['http://127.0.0.1:9696'];
const DEFAULT_PROWLARR_ENDPOINT = '/api/v1/search';

function normalizeDomains(rawList) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const d = normalizeDomain(raw);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.length ? out : [...DEFAULT_PROWLARR_DOMAINS];
}

function normalizeEndpoint(raw) {
  let endpoint = String(raw || DEFAULT_PROWLARR_ENDPOINT).trim() || DEFAULT_PROWLARR_ENDPOINT;
  if (!endpoint.startsWith('/')) endpoint = `/${endpoint}`;
  return endpoint;
}

function normalizeConfig(provider) {
  const cfg = provider?.config && typeof provider.config === 'object' ? provider.config : {};
  const domains = normalizeDomains(cfg.domains);
  const endpoint = normalizeEndpoint(cfg.endpoint || DEFAULT_PROWLARR_ENDPOINT);
  const activeDomain = normalizeDomain(provider?.activeDomain || '') || domains[0] || DEFAULT_PROWLARR_DOMAINS[0];
  const apiKey = String(cfg.apiKey || '').trim();
  return {
    domains,
    endpoint,
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

export class ProwlarrProviderAdapter extends ProviderAdapter {
  async search({ query, timeoutMs = 20000, domain = '' } = {}) {
    const cfg = normalizeConfig(this.provider);
    if (!cfg.apiKey) {
      throw new ProviderError('Prowlarr API key is missing.', {
        category: ERROR_CATEGORY.AUTH,
        domainUsed: cfg.activeDomain,
      });
    }

    const domainUsed = normalizeDomain(domain || cfg.activeDomain || cfg.domains[0] || DEFAULT_PROWLARR_DOMAINS[0]);
    const req = new URL(cfg.endpoint, `${domainUsed}/`);
    const q = String(query || '').trim();
    if (!q) {
      throw new ProviderError('Prowlarr search query is required.', {
        category: ERROR_CATEGORY.PARSE,
        url: req.toString(),
        domainUsed,
      });
    }

    req.searchParams.set('query', q);
    req.searchParams.set('type', 'search');
    req.searchParams.set('limit', '100');
    req.searchParams.set('offset', '0');

    const reqUrl = req.toString();
    const res = await fetchWithTimeout(reqUrl, {
      timeoutMs,
      headers: {
        accept: 'application/json',
        'x-api-key': cfg.apiKey,
      },
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

    let json;
    try {
      json = JSON.parse(String(res.text || '[]'));
    } catch {
      throw new ProviderError('Invalid JSON from Prowlarr', {
        category: ERROR_CATEGORY.PARSE,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: snippet },
      });
    }

    const rows = Array.isArray(json) ? json : [];
    const results = rows.map((row) => {
      const name = String(row?.title || '').trim();
      const magnetCandidate = String(row?.magnetUrl || '').trim();
      const guidCandidate = String(row?.guid || '').trim();
      const magnet = /^magnet:\?/i.test(magnetCandidate)
        ? magnetCandidate
        : /^magnet:\?/i.test(guidCandidate)
          ? guidCandidate
          : '';
      const sourceUrl = normalizeLink(row?.downloadUrl || row?.magnetUrl || '', domainUsed);
      const hash = String(row?.infoHash || extractBtih(magnet) || '').trim().toUpperCase();
      return {
        provider: 'prowlarr',
        imdbIdDigits: normalizeImdbDigits(row?.imdbId),
        title: name,
        year: Number(row?.year || 0) || null,
        name,
        seeders: Number(row?.seeders || 0) || 0,
        sizeGb: parseSizeToGb(row?.size ?? null),
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
