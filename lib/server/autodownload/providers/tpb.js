import 'server-only';

import {
  categorizeHttpFailure,
  decodeHtmlEntities,
  ERROR_CATEGORY,
  extractBtih,
  fetchWithTimeout,
  hasBlockedSignature,
  normalizeDomain,
  parseSizeToGb,
  ProviderAdapter,
  ProviderError,
  sanitizeResponseSnippet,
} from './base';

function now() {
  return Date.now();
}

function normalizeDomains(rawList) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const d = normalizeDomain(raw);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  if (!out.length) out.push('https://thepiratebay.org');
  return out;
}

function normalizeConfig(provider) {
  const cfg = provider?.config && typeof provider.config === 'object' ? provider.config : {};
  const domains = normalizeDomains(cfg.domains);
  const searchPathTemplate = String(cfg.searchPathTemplate || '/search/{query}/1/99/201').trim() || '/search/{query}/1/99/201';
  const activeDomain = normalizeDomain(provider?.activeDomain || '') || domains[0];
  return { domains, activeDomain, searchPathTemplate };
}

function inferQuality(name) {
  const s = String(name || '').toLowerCase();
  if (s.includes('2160p') || s.includes('4k')) return '2160p';
  if (s.includes('1080p')) return '1080p';
  if (s.includes('720p')) return '720p';
  if (s.includes('480p')) return '480p';
  return 'unknown';
}

function buildSearchUrl(domain, searchPathTemplate, query) {
  const q = encodeURIComponent(String(query || '').trim());
  const tpl = String(searchPathTemplate || '/search/{query}/1/99/201').replace('{query}', q);
  const path = tpl.startsWith('/') ? tpl : `/${tpl}`;
  return `${domain}${path}`;
}

function parseSizeFromRow(rowText) {
  const s = String(rowText || '');
  const m = s.match(/size\s*([0-9]+(?:\.[0-9]+)?)\s*([kmgt]i?b|bytes?)/i);
  if (!m) return null;
  return parseSizeToGb(`${m[1]} ${m[2]}`);
}

function parseSeedLeech(rowHtml) {
  const all = [...String(rowHtml || '').matchAll(/<td[^>]*align=["']?right["']?[^>]*>\s*([0-9]+)\s*<\/td>/gi)].map((m) => Number(m[1] || 0));
  return {
    seeders: Number(all[0] || 0) || 0,
    leechers: Number(all[1] || 0) || 0,
  };
}

function parseResults(html, domainUsed) {
  const rows = [...String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const out = [];

  for (const row of rows) {
    const rowHtml = row[1] || '';
    if (!/magnet:/i.test(rowHtml)) continue;

    const titleMatch = rowHtml.match(/class=["']detLink["'][^>]*>([\s\S]*?)<\/a>/i);
    const magnetMatch = rowHtml.match(/href=["'](magnet:[^"']+)["']/i);
    if (!magnetMatch?.[1]) continue;

    const rawTitle = titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]) : 'Unknown title';
    const name = rawTitle.replace(/<[^>]+>/g, '').trim() || 'Unknown title';
    const magnet = decodeHtmlEntities(magnetMatch[1]);
    const hash = extractBtih(magnet);
    const { seeders } = parseSeedLeech(rowHtml);
    const sizeGb = parseSizeFromRow(decodeHtmlEntities(rowHtml));

    out.push({
      provider: 'tpb',
      name,
      seeders,
      sizeGb,
      quality: inferQuality(name),
      magnet,
      hash,
      domainUsed,
      fetchedAt: now(),
    });
  }

  return out;
}

export class TpbProviderAdapter extends ProviderAdapter {
  getConfig() {
    return normalizeConfig(this.provider);
  }

  getActiveDomain() {
    const cfg = this.getConfig();
    return cfg.activeDomain || cfg.domains[0];
  }

  async search({ query, timeoutMs = 20000, domain = '' } = {}) {
    const cfg = this.getConfig();
    const domainUsed = normalizeDomain(domain || cfg.activeDomain || cfg.domains[0]);
    const reqUrl = buildSearchUrl(domainUsed, cfg.searchPathTemplate, query);

    const res = await fetchWithTimeout(reqUrl, {
      timeoutMs,
      headers: { accept: 'text/html,application/xhtml+xml' },
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

    if (hasBlockedSignature(res.text)) {
      throw new ProviderError('Blocked/challenge response detected', {
        category: ERROR_CATEGORY.BLOCKED,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: snippet },
      });
    }

    const lower = String(res.text || '').toLowerCase();
    const hasExpectedMarkers =
      lower.includes('the pirate bay') &&
      (lower.includes('id="search"') || lower.includes("id='search'") || lower.includes('print_search') || lower.includes('detlink'));
    if (!hasExpectedMarkers) {
      throw new ProviderError('Unexpected TPB HTML structure (missing expected markers)', {
        category: ERROR_CATEGORY.PARSE,
        httpStatus: res.status,
        url: reqUrl,
        domainUsed,
        details: { responseSnippet: snippet },
      });
    }

    const results = parseResults(res.text, domainUsed);

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
