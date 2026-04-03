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

const DEFAULT_EZTV_DOMAINS = ['https://eztvx.to'];
const DEFAULT_EZTV_ENDPOINT = '/api/get-torrents';

function normalizeConfig(provider) {
  const cfg = provider?.config && typeof provider.config === 'object' ? provider.config : {};
  const domains = Array.isArray(cfg?.domains) ? cfg.domains.map((x) => normalizeDomain(x)).filter(Boolean) : [];
  const endpointRaw = String(cfg.endpoint || DEFAULT_EZTV_ENDPOINT).trim() || DEFAULT_EZTV_ENDPOINT;
  const endpoint = endpointRaw.startsWith('/') ? endpointRaw : `/${endpointRaw}`;
  const activeDomain = normalizeDomain(provider?.activeDomain || '') || domains[0] || DEFAULT_EZTV_DOMAINS[0];
  return { domains: domains.length ? domains : [...DEFAULT_EZTV_DOMAINS], activeDomain, endpoint };
}

function inferQuality(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('2160p') || s.includes('4k')) return '2160p';
  if (s.includes('1080p')) return '1080p';
  if (s.includes('720p')) return '720p';
  if (s.includes('480p')) return '480p';
  return 'unknown';
}

function extractImdbIdDigits(query) {
  const q = String(query || '').trim();
  if (!q) return '';

  // Accept: tt0944947, imdb:tt0944947, imdb_id=0944947, 0944947
  const tt = q.match(/\btt(\d{7,8})\b/i);
  if (tt?.[1]) return tt[1];

  const digits = q.match(/\b(\d{7,8})\b/);
  if (digits?.[1]) return digits[1];

  return '';
}

export class EztvProviderAdapter extends ProviderAdapter {
  async search({ query, timeoutMs = 20000, domain = '' } = {}) {
    const cfg = normalizeConfig(this.provider);
    const domainUsed = normalizeDomain(domain || cfg.activeDomain || cfg.domains[0] || DEFAULT_EZTV_DOMAINS[0]);
    const imdbDigits = extractImdbIdDigits(query);
    if (!imdbDigits) {
      throw new ProviderError('EZTV requires an IMDb id for search (use tt1234567 or 1234567).', {
        category: ERROR_CATEGORY.PARSE,
        url: `${domainUsed}${cfg.endpoint}`,
        domainUsed,
      });
    }

    const u = new URL(cfg.endpoint, `${domainUsed}/`);
    u.searchParams.set('imdb_id', imdbDigits);
    u.searchParams.set('limit', '50');
    u.searchParams.set('page', '1');

    const reqUrl = u.toString();
    const res = await fetchWithTimeout(reqUrl, {
      timeoutMs,
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      throw new ProviderError(`HTTP ${res.status}`, {
        category: categorizeHttpFailure({ status: res.status, bodySnippet: res.text }),
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: sanitizeResponseSnippet(res.text) },
      });
    }

    let json;
    try {
      json = JSON.parse(String(res.text || '{}'));
    } catch {
      throw new ProviderError('Invalid JSON from EZTV', {
        category: ERROR_CATEGORY.PARSE,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: sanitizeResponseSnippet(res.text) },
      });
    }

    const torrents = Array.isArray(json?.torrents) ? json.torrents : [];
    const out = torrents.map((t) => {
      const name = String(t?.filename || '').trim();
      const magnet = String(t?.magnet_url || '').trim();
      const hash = String(t?.hash || extractBtih(magnet) || '').trim().toUpperCase();
      return {
        provider: 'eztv',
        title: name,
        year: null,
        name,
        seeders: Number(t?.seeds || 0) || 0,
        sizeGb: parseSizeToGb(t?.size_bytes || t?.size_bytes_raw || null),
        quality: inferQuality(name),
        magnet,
        sourceUrl: '',
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
      results: out,
      rawSnippet: sanitizeResponseSnippet(res.text),
    };
  }

  async test({ query, timeoutMs = 20000, domain = '' } = {}) {
    return this.search({ query, timeoutMs, domain });
  }
}

