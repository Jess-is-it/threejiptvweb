import { NextResponse } from 'next/server';

import { getSecret } from '../../../../../lib/server/secrets';

const TMDB_API = 'https://api.themoviedb.org/3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withKey(url, apiKey, params = {}) {
  const u = new URL(url);
  u.searchParams.set('api_key', apiKey);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function tmdb(path, apiKey, params = {}) {
  const r = await fetch(withKey(`${TMDB_API}${path}`, apiKey, params), { cache: 'no-store' });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

export async function GET(req) {
  try {
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'TMDB_API_KEY missing' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const tmdbId = Number(searchParams.get('tmdbId') || 0);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid tmdbId' }, { status: 400 });
    }

    const data = await tmdb(`/tv/${tmdbId}`, apiKey, {
      language: 'en-US',
      include_adult: 'false',
    });

    const seasons = (Array.isArray(data?.seasons) ? data.seasons : [])
      .map((season) => ({
        seasonNumber: Number(season?.season_number || 0),
        name: String(season?.name || '').trim(),
        episodeCount: Math.max(0, Number(season?.episode_count || 0)),
        airDate: String(season?.air_date || '').trim(),
      }))
      .filter((season) => season.seasonNumber > 0 && season.episodeCount > 0)
      .sort((a, b) => a.seasonNumber - b.seasonNumber);

    return NextResponse.json(
      {
        ok: true,
        tmdbId,
        title: String(data?.name || '').trim(),
        seasons,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load series options' }, { status: 500 });
  }
}
