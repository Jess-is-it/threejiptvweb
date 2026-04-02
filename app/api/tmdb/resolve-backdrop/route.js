// app/api/tmdb/resolve-backdrop/route.js
import { NextResponse } from 'next/server';
import { getSecret } from '../../../../lib/server/secrets';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;

export const runtime = 'nodejs';

const responseCache = globalThis.__threejResolveBackdropCache || new Map();
if (!globalThis.__threejResolveBackdropCache) {
  globalThis.__threejResolveBackdropCache = responseCache;
}

const inflight = globalThis.__threejResolveBackdropInflight || new Map();
if (!globalThis.__threejResolveBackdropInflight) {
  globalThis.__threejResolveBackdropInflight = inflight;
}

function cleanTitle(raw = '') {
  // remove trailing (YYYY) and trim
  return (raw || '').replace(/\s*\(\d{4}\)\s*$/i, '').trim();
}

function pickBestBackdrop(backdrops = []) {
  if (!Array.isArray(backdrops) || backdrops.length === 0) return null;
  // Prefer landscape; sort by area desc
  const candidates = backdrops
    .filter((b) => (b?.width || 0) >= (b?.height || 0))
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  return candidates[0]?.file_path || null;
}

async function j(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

function cacheKey({ title = '', year = '', kind = '', id = '' } = {}) {
  return JSON.stringify({
    title: cleanTitle(title),
    year: String(year || '').trim(),
    kind: String(kind || 'movie').trim().toLowerCase(),
    id: String(id || '').trim(),
  });
}

function trimCache(cache) {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function readFresh(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - Number(entry.at || 0) >= CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.value ?? null;
}

function writeFresh(key, value) {
  responseCache.set(key, { at: Date.now(), value });
  trimCache(responseCache);
  return value;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const titleParam = url.searchParams.get('title') || '';
    const yearParam = url.searchParams.get('year') || '';
    const kindParam = (url.searchParams.get('kind') || 'movie').toLowerCase(); // "movie" | "series"
    const idParam = url.searchParams.get('id') || '';
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY;
    const key = cacheKey({ title: titleParam, year: yearParam, kind: kindParam, id: idParam });

    const cached = readFresh(key);
    if (cached) return NextResponse.json(cached, { status: 200 });

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'TMDB_API_KEY missing' }, { status: 500 });
    }

    const loader = inflight.get(key) || (async () => {
      try {
        const type = kindParam === 'series' ? 'tv' : 'movie';
        let tmdbId = idParam || null;

        if (!tmdbId) {
          const title = cleanTitle(titleParam);
          const sp = new URLSearchParams({ query: title, include_adult: 'false', api_key: apiKey });
          if (yearParam) {
            if (type === 'movie') sp.set('year', yearParam);
            else sp.set('first_air_date_year', yearParam);
          }
          let sr = await j(`${TMDB_BASE}/search/${type}?${sp.toString()}`);
          let hit = Array.isArray(sr?.results) && sr.results.length ? sr.results[0] : null;

          if (!hit) {
            const sp2 = new URLSearchParams({ query: title, include_adult: 'false', api_key: apiKey });
            sr = await j(`${TMDB_BASE}/search/${type}?${sp2.toString()}`);
            hit = Array.isArray(sr?.results) && sr.results.length ? sr.results[0] : null;
          }

          if (!hit && titleParam && titleParam !== title) {
            const sp3 = new URLSearchParams({ query: titleParam, include_adult: 'false', api_key: apiKey });
            sr = await j(`${TMDB_BASE}/search/${type}?${sp3.toString()}`);
            hit = Array.isArray(sr?.results) && sr.results.length ? sr.results[0] : null;
          }

          tmdbId = hit?.id || null;
        }

        if (!tmdbId) {
          return writeFresh(key, { ok: true, path: null, id: null });
        }

        const imgs = await j(
          `${TMDB_BASE}/${type}/${tmdbId}/images?include_image_language=null,en&api_key=${apiKey}`
        );
        const path = pickBestBackdrop(imgs?.backdrops);
        return writeFresh(key, { ok: true, path, id: tmdbId });
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, loader);
    const payload = await loader;
    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
