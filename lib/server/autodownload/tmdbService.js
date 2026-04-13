import 'server-only';

import { getSecret } from '../secrets';
import { computeKidsSafe, pickUsMovieCertification, pickUsTvContentRating } from '../tmdbKids';

const TMDB_BASE = 'https://api.themoviedb.org/3';

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
  String(s || '')
    .toLowerCase()
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const cleanTitle = (s = '') =>
  String(s || '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s*\[[^\]]+\]\s*$/, '')
    .trim();

function parseYearFromDate(dateStr) {
  const s = String(dateStr || '').trim();
  const m = s.match(/^(\d{4})-/);
  return m ? m[1] : '';
}

function pickOriginalLanguage(details) {
  const lang = String(details?.original_language || '').trim().toLowerCase();
  return lang || '';
}

export async function resolveTmdbTitle({ kind = 'movie', title, year = '' } = {}) {
  const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
  if (!apiKey) throw new Error('Missing TMDB API key. Set TMDB_API_KEY or Admin Secrets: tmdbApiKey.');

  const rawTitle = String(title || '').trim();
  if (!rawTitle) throw new Error('Missing title.');

  const y = String(year || '').trim();
  const hint = String(kind || '').toLowerCase();
  const qTitle = cleanTitle(rawTitle);

  const order = hint === 'series' || hint === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];

  let pick = null;
  let mediaType = null;

  for (const type of order) {
    const res = await tmdb(type === 'tv' ? '/search/tv' : '/search/movie', apiKey, {
      query: qTitle,
      include_adult: 'false',
      ...(y ? (type === 'tv' ? { first_air_date_year: y } : { year: y }) : {}),
    });
    const list = Array.isArray(res?.results) ? res.results : [];
    if (!list.length) continue;

    const target = norm(qTitle);
    const best = list
      .map((x) => {
        const t = norm(x?.name || x?.title || '');
        const date = x?.first_air_date || x?.release_date || '';
        const yOk = y ? String(date).startsWith(y) : false;
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

  if (!pick || !mediaType) return { ok: false, notFound: true };

  const appendToResponse = mediaType === 'movie' ? 'release_dates' : 'content_ratings';
  const details = await tmdb(`/${mediaType}/${pick.id}`, apiKey, {
    append_to_response: appendToResponse,
    language: 'en-US',
  });
  const genresDetailed = Array.isArray(details?.genres)
    ? details.genres
        .map((g) => ({ id: Number(g?.id || 0), name: String(g?.name || '').trim() }))
        .filter((g) => Number.isFinite(g.id) && g.id > 0 && g.name)
    : [];
  const genres = genresDetailed.map((g) => g.name);

  const canonicalTitle = details?.title || details?.name || pick?.title || pick?.name || qTitle;
  const canonicalDate = mediaType === 'movie' ? details?.release_date : details?.first_air_date;
  const canonicalYear = parseYearFromDate(canonicalDate) || y || '';
  const originalLanguage = pickOriginalLanguage(details);

  const runtime =
    mediaType === 'movie'
      ? details?.runtime ?? null
      : Array.isArray(details?.episode_run_time)
        ? details.episode_run_time[0] ?? null
        : null;
  const certification = mediaType === 'movie' ? pickUsMovieCertification(details) : '';
  const contentRating = mediaType === 'tv' ? pickUsTvContentRating(details) : '';
  const kids = computeKidsSafe({ mediaType, certification, contentRating, genres });

  return {
    ok: true,
    id: pick.id,
    mediaType,
    title: canonicalTitle,
    releaseDate: String(canonicalDate || '').trim(),
    year: canonicalYear,
    originalLanguage,
    genres,
    genresDetailed,
    certification,
    contentRating,
    kidsSafe: kids.kidsSafe,
    kidsReason: kids.reason,
    rating: details?.vote_average ?? null,
    runtime,
    overview: details?.overview || '',
    posterPath: String(details?.poster_path || pick?.poster_path || '').trim(),
    backdropPath: String(details?.backdrop_path || pick?.backdrop_path || '').trim(),
  };
}

export async function getTmdbDetailsById({ mediaType = 'movie', id } = {}) {
  const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
  if (!apiKey) throw new Error('Missing TMDB API key. Set TMDB_API_KEY or Admin Secrets: tmdbApiKey.');

  const mt = String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(id || 0);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) throw new Error('Invalid TMDB id.');

  // Include external_ids so we can access IMDb ids without an extra request (needed for providers like EZTV).
  const appendToResponse = mt === 'movie' ? 'external_ids,release_dates' : 'external_ids,content_ratings';
  const details = await tmdb(`/${mt}/${tmdbId}`, apiKey, {
    append_to_response: appendToResponse,
    language: 'en-US',
  });
  const genresDetailed = Array.isArray(details?.genres)
    ? details.genres
        .map((g) => ({ id: Number(g?.id || 0), name: String(g?.name || '').trim() }))
        .filter((g) => Number.isFinite(g.id) && g.id > 0 && g.name)
    : [];
  const genres = genresDetailed.map((g) => g.name);

  const canonicalTitle = details?.title || details?.name || '';
  const canonicalDate = mt === 'movie' ? details?.release_date : details?.first_air_date;
  const canonicalYear = parseYearFromDate(canonicalDate) || '';
  const originalLanguage = pickOriginalLanguage(details);

  const runtime =
    mt === 'movie'
      ? details?.runtime ?? null
      : Array.isArray(details?.episode_run_time)
        ? details.episode_run_time[0] ?? null
        : null;
  const certification = mt === 'movie' ? pickUsMovieCertification(details) : '';
  const contentRating = mt === 'tv' ? pickUsTvContentRating(details) : '';
  const kids = computeKidsSafe({ mediaType: mt, certification, contentRating, genres });

  const imdbId = String(details?.external_ids?.imdb_id || details?.imdb_id || '').trim();
  const numberOfSeasons = mt === 'tv' ? Number(details?.number_of_seasons || 0) || 0 : null;
  const numberOfEpisodes = mt === 'tv' ? Number(details?.number_of_episodes || 0) || 0 : null;

  return {
    ok: true,
    id: tmdbId,
    mediaType: mt,
    title: canonicalTitle,
    releaseDate: String(canonicalDate || '').trim(),
    year: canonicalYear,
    imdbId,
    numberOfSeasons,
    numberOfEpisodes,
    originalLanguage,
    genres,
    genresDetailed,
    certification,
    contentRating,
    kidsSafe: kids.kidsSafe,
    kidsReason: kids.reason,
    rating: details?.vote_average ?? null,
    runtime,
    overview: details?.overview || '',
    posterPath: String(details?.poster_path || '').trim(),
    backdropPath: String(details?.backdrop_path || '').trim(),
  };
}

export async function getTmdbTvSeason({ id, seasonNumber = 1 } = {}) {
  const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
  if (!apiKey) throw new Error('Missing TMDB API key. Set TMDB_API_KEY or Admin Secrets: tmdbApiKey.');

  const tmdbId = Number(id || 0);
  const season = Number(seasonNumber || 0);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) throw new Error('Invalid TMDB id.');
  if (!Number.isFinite(season) || season <= 0) throw new Error('Invalid season number.');

  const data = await tmdb(`/tv/${tmdbId}/season/${season}`, apiKey);
  const episodesRaw = Array.isArray(data?.episodes) ? data.episodes : [];
  const episodes = episodesRaw
    .map((e) => ({
      episodeNumber: Number(e?.episode_number || 0) || 0,
      name: String(e?.name || '').trim(),
      airDate: String(e?.air_date || '').trim(),
    }))
    .filter((e) => Number.isFinite(e.episodeNumber) && e.episodeNumber > 0);
  return {
    ok: true,
    id: tmdbId,
    seasonNumber: season,
    episodeCount: episodes.length,
    episodes,
  };
}

export async function discoverMovies({ params = {} } = {}) {
  const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
  if (!apiKey) throw new Error('Missing TMDB API key. Set TMDB_API_KEY or Admin Secrets: tmdbApiKey.');
  const data = await tmdb('/discover/movie', apiKey, {
    include_adult: 'false',
    sort_by: 'popularity.desc',
    ...params,
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  return { ok: true, page: data?.page || 1, totalPages: data?.total_pages || 1, results };
}

export async function discoverSeries({ params = {} } = {}) {
  const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
  if (!apiKey) throw new Error('Missing TMDB API key. Set TMDB_API_KEY or Admin Secrets: tmdbApiKey.');
  const data = await tmdb('/discover/tv', apiKey, {
    include_adult: 'false',
    sort_by: 'popularity.desc',
    ...params,
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  return { ok: true, page: data?.page || 1, totalPages: data?.total_pages || 1, results };
}

let genreCache = {
  movie: { at: 0, list: [] },
  tv: { at: 0, list: [] },
};

export async function getTmdbGenres({ mediaType = 'movie' } = {}) {
  const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
  if (!apiKey) throw new Error('Missing TMDB API key. Set TMDB_API_KEY or Admin Secrets: tmdbApiKey.');

  const mt = String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  const now = Date.now();
  const cached = genreCache?.[mt] || null;
  if (cached && cached.at && now - cached.at < 60 * 60 * 1000 && Array.isArray(cached.list) && cached.list.length) {
    return { ok: true, genres: cached.list };
  }

  const data = await tmdb(`/genre/${mt}/list`, apiKey, {});
  const list = Array.isArray(data?.genres) ? data.genres : [];
  const genres = list
    .map((g) => ({ id: Number(g?.id || 0), name: String(g?.name || '').trim() }))
    .filter((g) => Number.isFinite(g.id) && g.id > 0 && g.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  genreCache = {
    ...genreCache,
    [mt]: { at: now, list: genres },
  };
  return { ok: true, genres };
}
