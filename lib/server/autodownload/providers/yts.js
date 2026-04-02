import 'server-only';

import {
  categorizeHttpFailure,
  decodeHtmlEntities,
  ERROR_CATEGORY,
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

function normalizeConfig(provider) {
  const cfg = provider?.config && typeof provider.config === 'object' ? provider.config : {};
  const domains = Array.isArray(cfg?.domains) ? cfg.domains.map((x) => normalizeDomain(x)).filter(Boolean) : [];
  const apiBasePath = String(cfg.apiBasePath || '/api/v2/').trim() || '/api/v2/';
  const endpoint = String(cfg.endpoint || 'list_movies.json').trim().replace(/^\/+/, '') || 'list_movies.json';
  const activeDomain = normalizeDomain(provider?.activeDomain || '') || domains[0] || 'https://yts.mx';

  const basePath = apiBasePath.startsWith('/') ? apiBasePath : `/${apiBasePath}`;
  const basePathWithTrailingSlash = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return {
    domains,
    activeDomain,
    apiBasePath: basePathWithTrailingSlash,
    endpoint,
  };
}

function qualityFromTorrent(t) {
  const q = String(t?.quality || '').trim();
  return q || 'unknown';
}

function inferName(movie, torrent) {
  const base = String(movie?.title_long || movie?.title || '').trim();
  const quality = qualityFromTorrent(torrent);
  return decodeHtmlEntities(`${base} ${quality}`.trim());
}

const DEFAULT_TRACKERS = [
  'udp://open.stealth.si:80/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
];

function hashToMagnet(hash, name) {
  const h = String(hash || '').trim();
  if (!h) return '';
  const dn = encodeURIComponent(String(name || '').trim() || h);
  const tr = DEFAULT_TRACKERS.map((x) => `tr=${encodeURIComponent(x)}`).join('&');
  return `magnet:?xt=urn:btih:${h}&dn=${dn}${tr ? `&${tr}` : ''}`;
}

function normalizeTorrentUrl(raw, domainUsed) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    return new URL(s, `${String(domainUsed || '').replace(/\/+$/, '')}/`).toString();
  } catch {
    return '';
  }
}

export class YtsProviderAdapter extends ProviderAdapter {
  async search({ query, year = null, timeoutMs = 20000, domain = '' } = {}) {
    const cfg = normalizeConfig(this.provider);
    const domainUsed = normalizeDomain(domain || cfg.activeDomain || cfg.domains[0] || 'https://yts.mx');
    const base = new URL(`${cfg.apiBasePath}${cfg.endpoint}`, `${domainUsed}/`);
    const q = String(query || '').trim();
    const y = Number(year || 0);
    const safeYear = Number.isFinite(y) && y >= 1900 && y <= 2100 ? String(Math.floor(y)) : '';
    const queryTerm = safeYear && q && !new RegExp(`\\b${safeYear}\\b`).test(q) ? `${q} ${safeYear}` : q;

    base.searchParams.set('query_term', queryTerm);
    base.searchParams.set('limit', '50');
    base.searchParams.set('sort_by', 'seeds');
    base.searchParams.set('order_by', 'desc');

    const reqUrl = base.toString();
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
      throw new ProviderError('Invalid JSON from YTS', {
        category: ERROR_CATEGORY.PARSE,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: sanitizeResponseSnippet(res.text) },
      });
    }

    if (!json || typeof json !== 'object' || !Object.prototype.hasOwnProperty.call(json, 'status') || !Object.prototype.hasOwnProperty.call(json, 'data')) {
      throw new ProviderError('Missing expected YTS schema keys (status/data)', {
        category: ERROR_CATEGORY.PARSE,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: sanitizeResponseSnippet(res.text) },
      });
    }

    const movies = Array.isArray(json?.data?.movies) ? json.data.movies : [];
    const out = [];

    for (const movie of movies) {
      const torrents = Array.isArray(movie?.torrents) ? movie.torrents : [];
      for (const tor of torrents) {
        const hash = String(tor?.hash || '').trim().toUpperCase();
        const name = inferName(movie, tor);
        const magnet = hashToMagnet(hash, name);
        const sourceUrl = normalizeTorrentUrl(tor?.url || '', domainUsed);

        out.push({
          provider: 'yts',
          title: decodeHtmlEntities(String(movie?.title || '').trim()),
          year: Number(movie?.year || 0) || null,
          name,
          seeders: Number(tor?.seeds || 0) || 0,
          sizeGb: parseSizeToGb(tor?.size_bytes || tor?.size || null),
          quality: qualityFromTorrent(tor),
          magnet,
          sourceUrl,
          hash,
          domainUsed,
          fetchedAt: now(),
        });
      }
    }

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
