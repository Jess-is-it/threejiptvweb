import { NextResponse } from 'next/server';

import { getSecret } from '../../../../../../lib/server/secrets';
import { listReleasedItems, listUpcomingItems } from '../../../../../../lib/server/autodownload/releaseService';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withKey(url, apiKey, params = {}) {
  const u = new URL(url);
  if (apiKey) u.searchParams.set('api_key', apiKey);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function tmdb(path, apiKey, params = {}) {
  const r = await fetch(withKey(`${TMDB_BASE}${path}`, apiKey, params), { cache: 'no-store' });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

function pickTrailer(videos) {
  const rows = Array.isArray(videos) ? videos : [];
  const byYouTube = rows.filter((x) => String(x?.site || '').toLowerCase() === 'youtube');
  const order = byYouTube.length ? byYouTube : rows;
  const scored = order
    .map((x) => {
      const type = String(x?.type || '').toLowerCase();
      const official = Boolean(x?.official);
      let score = 0;
      if (type === 'trailer') score += 100;
      if (type === 'teaser') score += 40;
      if (official) score += 20;
      score += Number(x?.size || 0) / 100;
      return { x, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.x || null;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const username = String(searchParams.get('username') || '').trim();
    const tmdbId = Number(searchParams.get('tmdbId') || 0);
    const mediaTypeRaw = String(searchParams.get('mediaType') || searchParams.get('type') || 'movie').trim().toLowerCase();
    const mediaType = mediaTypeRaw === 'tv' || mediaTypeRaw === 'series' ? 'tv' : 'movie';
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid tmdbId' }, { status: 400 });
    }

    const items = await listUpcomingItems({ username, limit: 200 });
    const releasedItems = await listReleasedItems({ limit: 200 });
    const upcoming =
      items.find(
        (x) => Number(x?.tmdbId || 0) === tmdbId && String(x?.mediaType || '').toLowerCase() === mediaType
      ) ||
      releasedItems.find(
      (x) => Number(x?.tmdbId || 0) === tmdbId && String(x?.mediaType || '').toLowerCase() === mediaType
    );
    if (!upcoming) {
      return NextResponse.json({ ok: false, error: 'Upcoming title not found' }, { status: 404 });
    }

    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'Missing TMDB API key' }, { status: 500 });
    }

    const details = await tmdb(`/${mediaType}/${tmdbId}`, apiKey, {
      append_to_response: 'credits,videos',
      include_adult: 'false',
      language: 'en-US',
    });
    const trailer = pickTrailer(details?.videos?.results);

    return NextResponse.json(
      {
        ok: true,
        upcoming,
        details: {
          tmdbId,
          mediaType,
          title: details?.title || details?.name || upcoming?.title || '',
          originalTitle: details?.original_title || details?.original_name || '',
          overview: details?.overview || upcoming?.overview || '',
          releaseDate: details?.release_date || details?.first_air_date || upcoming?.releaseDate || '',
          rating: details?.vote_average ?? upcoming?.rating ?? null,
          runtime:
            mediaType === 'movie'
              ? details?.runtime ?? null
              : Array.isArray(details?.episode_run_time)
                ? details.episode_run_time[0] ?? null
                : null,
          genres: Array.isArray(details?.genres) ? details.genres.map((x) => String(x?.name || '').trim()).filter(Boolean) : [],
          cast: Array.isArray(details?.credits?.cast)
            ? details.credits.cast.slice(0, 12).map((x) => ({
                id: Number(x?.id || 0),
                name: String(x?.name || '').trim(),
                character: String(x?.character || '').trim(),
                profilePath: String(x?.profile_path || '').trim(),
              }))
            : [],
          posterPath: String(details?.poster_path || upcoming?.posterPath || '').trim(),
          backdropPath: String(details?.backdrop_path || upcoming?.backdropPath || '').trim(),
          trailer: trailer
            ? {
                key: String(trailer?.key || '').trim(),
                name: String(trailer?.name || '').trim(),
                site: String(trailer?.site || '').trim(),
                type: String(trailer?.type || '').trim(),
              }
            : null,
        },
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load upcoming details' }, { status: 500 });
  }
}
