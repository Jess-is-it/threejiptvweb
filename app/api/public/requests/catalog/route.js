import { NextResponse } from 'next/server';

import { getSecret } from '../../../../../lib/server/secrets';

const TMDB_API = 'https://api.themoviedb.org/3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAGALOG_GENRE_IDS = [10749, 18, 35];
const ANIME_GENRE_ID = 16;
const GENRE_MAP = {
  action: 28,
  adventure: 12,
  comedy: 35,
  horror: 27,
  romance: 10749,
  drama: 18,
  scifi: 878,
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return Math.max(min, Math.min(max, v));
}

function normalizeType(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'movie') return 'movie';
  if (s === 'tv' || s === 'series') return 'tv';
  return 'all';
}

function normalizeFilter(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return 'popular';
  if (Object.prototype.hasOwnProperty.call(GENRE_MAP, s)) return s;
  if (s === 'tagalog') return 'tagalog';
  if (s === 'anime') return 'anime';
  return 'popular';
}

function withKey(url, apiKey, params = {}) {
  const u = new URL(url);
  u.searchParams.set('api_key', apiKey);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function tmdb(path, apiKey, params) {
  const r = await fetch(withKey(`${TMDB_API}${path}`, apiKey, params), { cache: 'no-store' });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

function toCard(item, mediaType) {
  const title = String(item?.title || item?.name || '').trim();
  const originalTitle = String(item?.original_title || item?.original_name || '').trim();
  const releaseDate = String(item?.release_date || item?.first_air_date || '').trim();
  return {
    tmdbId: Number(item?.id || 0) || null,
    mediaType,
    title,
    originalTitle,
    overview: String(item?.overview || '').trim(),
    posterPath: String(item?.poster_path || '').trim(),
    backdropPath: String(item?.backdrop_path || '').trim(),
    releaseDate,
    popularity: Number(item?.popularity || 0) || 0,
    voteAverage: Number(item?.vote_average || 0) || 0,
  };
}

function applyFilterParams(baseParams, filter) {
  if (filter === 'popular') return baseParams;
  if (filter === 'tagalog') {
    return {
      ...baseParams,
      with_original_language: 'tl',
      with_genres: TAGALOG_GENRE_IDS.join(','),
    };
  }
  if (filter === 'anime') {
    return {
      ...baseParams,
      with_genres: String(ANIME_GENRE_ID),
    };
  }
  const genreId = GENRE_MAP[filter];
  if (!genreId) return baseParams;
  return {
    ...baseParams,
    with_genres: String(genreId),
  };
}

async function discoverOne({ apiKey, mediaType, page, filter }) {
  const params = applyFilterParams(
    {
      language: 'en-US',
      include_adult: 'false',
      include_video: 'false',
      page,
      sort_by: 'popularity.desc',
    },
    filter
  );
  const data = await tmdb(`/discover/${mediaType}`, apiKey, params);
  const rows = Array.isArray(data?.results) ? data.results : [];
  return {
    mediaType,
    page: Number(data?.page || page) || page,
    totalPages: Number(data?.total_pages || 1) || 1,
    results: rows.map((x) => toCard(x, mediaType)),
  };
}

async function searchOne({ apiKey, mediaType, page, query }) {
  const data = await tmdb(`/search/${mediaType}`, apiKey, {
    language: 'en-US',
    include_adult: 'false',
    page,
    query: String(query || '').trim(),
  });
  const rows = Array.isArray(data?.results) ? data.results : [];
  return {
    mediaType,
    page: Number(data?.page || page) || page,
    totalPages: Number(data?.total_pages || 1) || 1,
    results: rows.map((x) => toCard(x, mediaType)),
  };
}

function mergeRows(parts) {
  const all = parts.flatMap((x) => x.results || []);
  all.sort((a, b) => Number(b?.popularity || 0) - Number(a?.popularity || 0));
  const out = [];
  const seen = new Set();
  for (const row of all) {
    const id = Number(row?.tmdbId || 0);
    if (!Number.isFinite(id) || id <= 0) continue;
    const key = `${row?.mediaType || 'movie'}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function GET(req) {
  try {
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'TMDB_API_KEY missing' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const query = String(searchParams.get('q') || '').trim();
    const type = normalizeType(searchParams.get('type'));
    const filter = normalizeFilter(searchParams.get('filter'));
    const page = clampInt(searchParams.get('page'), 1, 500, 1);

    const mediaTypes = type === 'all' ? ['movie', 'tv'] : [type];

    const parts = await Promise.all(
      mediaTypes.map((mediaType) =>
        query
          ? searchOne({ apiKey, mediaType, page, query })
          : discoverOne({ apiKey, mediaType, page, filter })
      )
    );

    const rows = mergeRows(parts);
    const totalPages = Math.max(...parts.map((x) => Number(x?.totalPages || 1)));

    return NextResponse.json(
      {
        ok: true,
        page,
        totalPages,
        type,
        filter,
        query,
        items: rows,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load request catalog' }, { status: 500 });
  }
}
