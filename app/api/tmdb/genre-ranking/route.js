import { NextResponse } from 'next/server';
import {
  discoverMovies,
  discoverSeries,
  getTmdbGenres,
} from '../../../../lib/server/autodownload/tmdbService';

export const runtime = 'nodejs';

const CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PAGES = 5;
const MAX_PAGES = 8;

const rankingCache = new Map();

const GENRE_ALIASES = {
  scifi: 'sciencefiction',
  'sci fi': 'sciencefiction',
  'sci-fi': 'sciencefiction',
  scifiandfantasy: 'sciencefictionfantasy',
  'sci fi and fantasy': 'sciencefictionfantasy',
  'sci-fi and fantasy': 'sciencefictionfantasy',
};

function normalizeGenreName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function getGenreLookupKey(value) {
  const normalized = normalizeGenreName(value);
  return GENRE_ALIASES[normalized] || normalized;
}

function normalizeTitleKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYear(value) {
  const match = String(value || '').match(/^(\d{4})/);
  return match ? match[1] : '';
}

function findGenreId(genres, targetName) {
  const wanted = getGenreLookupKey(targetName);
  if (!wanted) return 0;
  return Number(
    genres.find((genre) => getGenreLookupKey(genre?.name) === wanted)?.id || 0
  );
}

function toRankingEntry(item) {
  const title = String(item?.title || item?.name || '').trim();
  const year = parseYear(item?.release_date || item?.first_air_date || '');
  const titleKey = normalizeTitleKey(title);
  return {
    id: Number(item?.id || 0) || 0,
    title,
    year,
    titleKey,
    key: `${titleKey}|${year}`,
    popularity: Number(item?.popularity || 0) || 0,
  };
}

async function collectDiscoverPages(discoverFn, genreId, pages) {
  if (!genreId) return [];
  const out = [];
  for (let page = 1; page <= pages; page += 1) {
    const result = await discoverFn({
      params: {
        with_genres: String(genreId),
        page: String(page),
      },
    });
    const items = Array.isArray(result?.results) ? result.results : [];
    out.push(...items.map(toRankingEntry).filter((entry) => entry.titleKey));
    const totalPages = Number(result?.totalPages || 1) || 1;
    if (page >= totalPages) break;
  }
  return out;
}

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const genre = String(sp.get('genre') || '').trim();
    if (!genre) {
      return NextResponse.json({ ok: false, error: 'Missing genre' }, { status: 400 });
    }

    const pagesRaw = Number(sp.get('pages') || DEFAULT_PAGES);
    const pages = Math.max(1, Math.min(MAX_PAGES, Number.isFinite(pagesRaw) ? Math.floor(pagesRaw) : DEFAULT_PAGES));
    const cacheKey = `${getGenreLookupKey(genre)}|${pages}`;
    const cached = rankingCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ ok: true, ...cached.payload });
    }

    const [movieGenres, seriesGenres] = await Promise.all([
      getTmdbGenres({ mediaType: 'movie' }),
      getTmdbGenres({ mediaType: 'tv' }),
    ]);

    const movieGenreId = findGenreId(movieGenres?.genres || [], genre);
    const seriesGenreId = findGenreId(seriesGenres?.genres || [], genre);

    const [movieRankings, seriesRankings] = await Promise.all([
      collectDiscoverPages(discoverMovies, movieGenreId, pages),
      collectDiscoverPages(discoverSeries, seriesGenreId, pages),
    ]);

    const payload = {
      genre,
      pages,
      movieGenreId,
      seriesGenreId,
      movieRankings,
      seriesRankings,
    };

    rankingCache.set(cacheKey, { at: Date.now(), payload });
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load TMDB genre ranking.' },
      { status: 500 }
    );
  }
}
