// app/api/tmdb/resolve-backdrop/route.js
import { NextResponse } from 'next/server';
import { getSecret } from '../../../../lib/server/secrets';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export const runtime = 'nodejs';

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

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const titleParam = url.searchParams.get('title') || '';
    const yearParam = url.searchParams.get('year') || '';
    const kindParam = (url.searchParams.get('kind') || 'movie').toLowerCase(); // "movie" | "series"
    const idParam = url.searchParams.get('id') || '';
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'TMDB_API_KEY missing' }, { status: 500 });
    }

    const type = kindParam === 'series' ? 'tv' : 'movie';
    let tmdbId = idParam || null;

    // 1) If no id, search using normalized title + year
    if (!tmdbId) {
      const title = cleanTitle(titleParam);
      const sp = new URLSearchParams({ query: title, include_adult: 'false', api_key: apiKey });
      if (yearParam) {
        if (type === 'movie') sp.set('year', yearParam);
        else sp.set('first_air_date_year', yearParam);
      }
      let sr = await j(`${TMDB_BASE}/search/${type}?${sp.toString()}`);
      let hit = Array.isArray(sr?.results) && sr.results.length ? sr.results[0] : null;

      // 2) If not found, try without year
      if (!hit) {
        const sp2 = new URLSearchParams({ query: title, include_adult: 'false', api_key: apiKey });
        sr = await j(`${TMDB_BASE}/search/${type}?${sp2.toString()}`);
        hit = Array.isArray(sr?.results) && sr.results.length ? sr.results[0] : null;
      }

      // 3) If still not found, try the raw (unsanitized) title
      if (!hit && titleParam && titleParam !== title) {
        const sp3 = new URLSearchParams({ query: titleParam, include_adult: 'false', api_key: apiKey });
        sr = await j(`${TMDB_BASE}/search/${type}?${sp3.toString()}`);
        hit = Array.isArray(sr?.results) && sr.results.length ? sr.results[0] : null;
      }

      tmdbId = hit?.id || null;
    }

    if (!tmdbId) {
      console.log('[tmdb] resolve-backdrop: not found', { title: titleParam, year: yearParam, type });
      return NextResponse.json({ ok: true, path: null, id: null }, { status: 200 });
    }

    const imgs = await j(
      `${TMDB_BASE}/${type}/${tmdbId}/images?include_image_language=null,en&api_key=${apiKey}`
    );
    const path = pickBestBackdrop(imgs?.backdrops);
    console.log('[tmdb] resolve-backdrop OK', { title: titleParam, id: tmdbId, path });
    return NextResponse.json({ ok: true, path, id: tmdbId }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
