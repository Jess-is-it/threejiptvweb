import 'server-only';

import { applySourceFilters } from './filters';
import { dedupeSourcesByHash, rankSources } from './ranking';
import { ProviderError } from './providers/base';
import { EztvProviderAdapter } from './providers/eztv';
import { JackettProviderAdapter } from './providers/jackett';
import { ProwlarrProviderAdapter } from './providers/prowlarr';
import { TpbProviderAdapter } from './providers/tpb';
import { YtsProviderAdapter } from './providers/yts';

function createAdapter(provider) {
  const key = String(provider?.key || '').trim().toLowerCase();
  if (key === 'yts') return new YtsProviderAdapter(provider);
  if (key === 'tpb') return new TpbProviderAdapter(provider);
  if (key === 'jackett') return new JackettProviderAdapter(provider);
  if (key === 'prowlarr') return new ProwlarrProviderAdapter(provider);
  if (key === 'eztv') return new EztvProviderAdapter(provider);
  throw new ProviderError(`Unsupported provider adapter: ${key || 'unknown'}`);
}

function normalizeResults(results, provider) {
  const key = String(provider?.key || '').trim().toLowerCase();
  return (Array.isArray(results) ? results : []).map((x) => ({
    provider: key,
    title: String(x?.title || '').trim(),
    year: Number(x?.year || 0) || null,
    name: String(x?.name || '').trim(),
    seeders: Number(x?.seeders || 0) || 0,
    sizeGb: x?.sizeGb === null || x?.sizeGb === undefined ? null : Number(x.sizeGb),
    quality: String(x?.quality || '').trim(),
    magnet: String(x?.magnet || '').trim(),
    sourceUrl: String(x?.sourceUrl || '').trim(),
    hash: String(x?.hash || '').trim().toUpperCase(),
    domainUsed: String(x?.domainUsed || '').trim(),
    imdbIdDigits: x?.imdbIdDigits ? String(x.imdbIdDigits).trim() : '',
    fetchedAt: Number(x?.fetchedAt || Date.now()),
  }));
}

export async function runProviderSearch(provider, opts = {}) {
  const adapter = createAdapter(provider);
  const res = await adapter.search({
    query: opts.query,
    year: opts.year,
    type: opts.type,
    timeoutMs: opts.timeoutMs || 20000,
    domain: opts.domain || '',
  });

  const normalized = normalizeResults(res?.results || [], provider);
  const filtered = applySourceFilters(normalized, {
    minSeeders: opts.minSeeders ?? provider?.minSeeders ?? 0,
    minSizeGb: opts.minSizeGb ?? null,
    maxSizeGb: opts.maxSizeGb ?? null,
    excludePatterns: opts.excludePatterns ?? [],
  });

  const ranked = rankSources(dedupeSourcesByHash(filtered));
  const maxResults = Math.max(1, Number(opts.maxResults || 40) || 40);

  return {
    ...res,
    results: ranked.slice(0, maxResults),
  };
}

export async function runProviderTest(provider, opts = {}) {
  const adapter = createAdapter(provider);
  const res = await adapter.test({
    query: opts.query,
    year: opts.year,
    type: opts.type,
    timeoutMs: opts.timeoutMs || 20000,
    domain: opts.domain || '',
  });

  const normalized = normalizeResults(res?.results || [], provider);
  const ranked = rankSources(dedupeSourcesByHash(normalized));
  const maxResults = Math.max(1, Number(opts.maxResults || 20) || 20);

  return {
    ...res,
    results: ranked.slice(0, maxResults),
  };
}

export function pickBestSource(results) {
  const ranked = rankSources(dedupeSourcesByHash(Array.isArray(results) ? results : []));
  return ranked[0] || null;
}
