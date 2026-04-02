import { NextResponse } from 'next/server';
import { getSecret } from '../../../../lib/server/secrets';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export const runtime = 'nodejs';

const DETAILS_TTL_MS = 12 * 60 * 60 * 1000;
const detailsCache = new Map(); // key -> { expiresAt, payload }
const inflight = new Map(); // key -> Promise<payload>

function getCached(key) {
  const hit = detailsCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    detailsCache.delete(key);
    return null;
  }
  return hit.payload;
}

function setCached(key, payload) {
  detailsCache.set(key, { expiresAt: Date.now() + DETAILS_TTL_MS, payload });
  // Simple cap so we don't grow forever.
  if (detailsCache.size > 1500) {
    const oldestKey = detailsCache.keys().next().value;
    if (oldestKey) detailsCache.delete(oldestKey);
  }
}

function withKey(url, apiKey, params = {}) {
  const u = new URL(url);
  if (apiKey) u.searchParams.set('api_key', apiKey);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  return u.toString();
}
async function tmdb(path, apiKey, params) {
  const r = await fetch(withKey(`${TMDB_BASE}${path}`, apiKey, params), { cache: 'no-store' });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}
const norm = (s = '') =>
  s.toLowerCase().replace(/[\u2019'":,!?()[\].\-]/g, '').replace(/\s+/g, ' ').trim();
const cleanTitle = (s = '') => s.replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s*\[[^\]]+\]\s*$/, '').trim();

export async function GET(req) {
  try {
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ ok:false, error:'Missing TMDB_API_KEY' }, { status:500 });

    const sp = new URL(req.url).searchParams;
    const rawTitle = sp.get('title') || '';
    const year = (sp.get('year') || '').trim();
    const hint = (sp.get('kind') || '').toLowerCase();   // 'movie' | 'series'
    const id = Number(sp.get('id') || 0);
    const mediaHint = (sp.get('mediaType') || hint || '').toLowerCase();
    const directMediaType = mediaHint === 'tv' || mediaHint === 'series' ? 'tv' : 'movie';

    const cacheKey =
      Number.isFinite(id) && id > 0
        ? `id:${directMediaType}:${id}`
        : `q:${hint || 'movie'}:${cleanTitle(rawTitle || '')}:${year || ''}`;

    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
      });
    }

    if (inflight.has(cacheKey)) {
      const payload = await inflight.get(cacheKey);
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
      });
    }

    const compute = (async () => {
      let pick = null,
        mediaType = null;
      if (Number.isFinite(id) && id > 0) {
        pick = { id };
        mediaType = directMediaType;
      } else {
        if (!rawTitle) return { ok: false, error: 'Missing title' };

        const title = cleanTitle(rawTitle);
        const order = hint === 'series' || hint === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];

        for (const type of order) {
          const res = await tmdb(type === 'tv' ? '/search/tv' : '/search/movie', apiKey, {
            query: title,
            include_adult: 'false',
            ...(year ? (type === 'tv' ? { first_air_date_year: year } : { year }) : {}),
          });
          const list = Array.isArray(res?.results) ? res.results : [];
          if (!list.length) continue;

          const target = norm(title);
          const best = list
            .map((x) => {
              const t = norm(x?.name || x?.title || '');
              const date = x?.first_air_date || x?.release_date || '';
              const yOk = year ? date.startsWith(year) : false;
              const same = t === target;
              const score = (x?.popularity || 0) + (same ? 100 : 0) + (yOk ? 50 : 0);
              return { x, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.x;

          if (best) {
            pick = best;
            mediaType = type;
            break;
          }
        }
      }

      if (!pick || !mediaType) return { ok: false, notFound: true };

      const details = await tmdb(`/${mediaType}/${pick.id}`, apiKey, { append_to_response: 'credits' });
      const genres = Array.isArray(details?.genres) ? details.genres.map((g) => g.name) : [];
      const runtime =
        mediaType === 'movie'
          ? details?.runtime ?? null
          : Array.isArray(details?.episode_run_time)
            ? details.episode_run_time[0] ?? null
            : null;
      const cast = Array.isArray(details?.credits?.cast)
        ? details.credits.cast
            .map((c) => String(c?.name || '').trim())
            .filter(Boolean)
            .slice(0, 12)
        : [];

      return {
        ok: true,
        id: pick.id,
        tmdbId: pick.id,
        media_type: mediaType,
        title: details?.title || details?.name || '',
        overview: details?.overview || '',
        rating: details?.vote_average ?? null,
        voteCount: details?.vote_count ?? null,
        popularity: details?.popularity ?? null,
        genres,
        runtime,
        cast,
        posterPath: String(details?.poster_path || pick?.poster_path || '').trim(),
        backdropPath: String(details?.backdrop_path || pick?.backdrop_path || '').trim(),
        releaseDate:
          mediaType === 'movie'
            ? String(details?.release_date || '').trim()
            : String(details?.first_air_date || '').trim(),
      };
    })();

    inflight.set(cacheKey, compute);
    let payload;
    try {
      payload = await compute;
    } finally {
      inflight.delete(cacheKey);
    }

    if (payload?.ok) setCached(cacheKey, payload);

    if (payload?.ok === false && payload?.error === 'Missing title') {
      return NextResponse.json(payload, { status: 400 });
    }
    if (payload?.ok === false && payload?.notFound) {
      return NextResponse.json(payload, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message || 'TMDB error' }, { status:500 });
  }
}
