import { NextResponse } from 'next/server';

import { getSecret } from '../../../../../lib/server/secrets';
import { parseStreamBase, xtreamWithFallback } from '../../../xuione/_shared';

const TMDB_API = 'https://api.themoviedb.org/3';
const XUI_TIMEOUT_MS = 18000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function withKey(url, apiKey, params = {}) {
  const u = new URL(url);
  u.searchParams.set('api_key', apiKey);
  u.searchParams.set('include_adult', 'false');
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

function parsePositiveInt(value, min = 1, max = 999) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < min || v > max) return null;
  return v;
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTitleSignatures(value) {
  const base = normalizeTitle(value);
  if (!base) return [];
  const out = new Set([base, base.replace(/\s+/g, '')]);
  const withoutTrailingYear = base.replace(/\s+\b(19|20)\d{2}\b$/, '').trim();
  if (withoutTrailingYear && withoutTrailingYear !== base) {
    out.add(withoutTrailingYear);
    out.add(withoutTrailingYear.replace(/\s+/g, ''));
  }
  return [...out].filter(Boolean);
}

function parseYear(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

function parseTmdbId(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  const s = String(value || '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const tagged = s.match(/tmdb[^0-9]{0,6}(\d{2,9})/i);
  if (tagged) return Number(tagged[1]);
  return 0;
}

function findXuiSeriesMatch(seriesRows, target) {
  const rows = Array.isArray(seriesRows) ? seriesRows : [];
  const tmdbId = parseTmdbId(target?.tmdbId);
  if (tmdbId > 0) {
    const byTmdb = rows.find((row) => parseTmdbId(row?.tmdb || row?.tmdb_id || row?.tmdbId) === tmdbId);
    if (byTmdb) return byTmdb;
  }

  const titleSignatures = new Set([
    ...buildTitleSignatures(target?.title),
    ...buildTitleSignatures(target?.originalTitle),
  ]);
  if (!titleSignatures.size) return null;

  const targetYear = parseYear(target?.releaseDate);
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const rowSigs = new Set([
      ...buildTitleSignatures(row?.name || row?.title),
      ...buildTitleSignatures(row?.o_name || row?.original_name),
    ]);
    if (!rowSigs.size) continue;
    let titleMatch = false;
    for (const sig of rowSigs) {
      if (!titleSignatures.has(sig)) continue;
      titleMatch = true;
      break;
    }
    if (!titleMatch) continue;

    const rowYear = parseYear(row?.year || row?.releaseDate || row?.release_date);
    const score = rowYear && targetYear && rowYear === targetYear ? 3 : 2;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}

function buildXuiAvailableEpisodeSet(seriesInfo) {
  const out = new Set();
  const episodes = seriesInfo?.episodes && typeof seriesInfo.episodes === 'object' ? seriesInfo.episodes : {};
  for (const [seasonKey, rows] of Object.entries(episodes)) {
    const seasonFromKey = parsePositiveInt(seasonKey, 1, 99);
    for (const ep of Array.isArray(rows) ? rows : []) {
      const season = seasonFromKey || parsePositiveInt(ep?.season || ep?.season_num, 1, 99);
      const episode = parsePositiveInt(
        ep?.episode_num ??
          ep?.episode ??
          ep?.num ??
          ep?.episode_number ??
          ep?.info?.episode_num ??
          ep?.info?.episode_number,
        1,
        999
      );
      if (!season || !episode) continue;
      out.add(`${season}:${episode}`);
    }
  }
  return out;
}

async function withTimeout(promise, ms) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('XUI request timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function loadXuiAvailableEpisodes({ streamBase, tmdbId, title, originalTitle, releaseDate }) {
  const sb = String(streamBase || '').trim();
  if (!sb) return { availableSet: new Set(), matchedSeriesId: null, hasXuiData: false };
  try {
    const { server, username, password } = parseStreamBase(sb);
    const seriesRows = await withTimeout(
      xtreamWithFallback({
        server,
        username,
        password,
        action: 'get_series',
      }),
      XUI_TIMEOUT_MS
    );
    const match = findXuiSeriesMatch(seriesRows, { tmdbId, title, originalTitle, releaseDate });
    const seriesId = Number(match?.series_id || match?.seriesId || 0);
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return { availableSet: new Set(), matchedSeriesId: null, hasXuiData: true };
    }

    const details = await withTimeout(
      xtreamWithFallback({
        server,
        username,
        password,
        action: 'get_series_info',
        extra: { series_id: String(seriesId) },
      }),
      XUI_TIMEOUT_MS
    );

    return {
      availableSet: buildXuiAvailableEpisodeSet(details),
      matchedSeriesId: seriesId,
      hasXuiData: true,
    };
  } catch {
    return { availableSet: new Set(), matchedSeriesId: null, hasXuiData: false };
  }
}

function normalizeTmdbSeasonRows(data) {
  return (Array.isArray(data?.seasons) ? data.seasons : [])
    .map((season) => ({
      seasonNumber: parsePositiveInt(season?.season_number, 1, 99),
      name: String(season?.name || '').trim(),
      episodeCount: Math.max(0, Number(season?.episode_count || 0)),
      airDate: String(season?.air_date || '').trim(),
      posterPath: String(season?.poster_path || '').trim(),
    }))
    .filter((season) => season.seasonNumber > 0 && season.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

function fallbackEpisodeRows(episodeCount, seasonNumber, availableSet) {
  const total = Math.max(0, Number(episodeCount || 0));
  return Array.from({ length: total }, (_, index) => {
    const episodeNumber = index + 1;
    return {
      episodeNumber,
      name: `Episode ${episodeNumber}`,
      stillPath: '',
      overview: '',
      airDate: '',
      runtime: null,
      availableNow: availableSet.has(`${seasonNumber}:${episodeNumber}`),
    };
  });
}

async function buildSeasonWithEpisodes({ tmdbId, apiKey, season, availableSet }) {
  try {
    const details = await tmdb(`/tv/${tmdbId}/season/${season.seasonNumber}`, apiKey, {
      language: 'en-US',
      include_adult: 'false',
    });
    const episodes = (Array.isArray(details?.episodes) ? details.episodes : [])
      .map((episode) => ({
        episodeNumber: parsePositiveInt(episode?.episode_number, 1, 999),
        name: String(episode?.name || '').trim() || `Episode ${Number(episode?.episode_number || 0)}`,
        stillPath: String(episode?.still_path || '').trim(),
        overview: String(episode?.overview || '').trim(),
        airDate: String(episode?.air_date || '').trim(),
        runtime: parsePositiveInt(episode?.runtime, 1, 500),
      }))
      .filter((episode) => Number(episode.episodeNumber) > 0)
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((episode) => ({
        ...episode,
        availableNow: availableSet.has(`${season.seasonNumber}:${episode.episodeNumber}`),
      }));

    return {
      ...season,
      episodeCount: episodes.length || season.episodeCount,
      episodes: episodes.length
        ? episodes
        : fallbackEpisodeRows(season.episodeCount, season.seasonNumber, availableSet),
    };
  } catch {
    return {
      ...season,
      episodes: fallbackEpisodeRows(season.episodeCount, season.seasonNumber, availableSet),
    };
  }
}

async function handleSeriesOptions(payload) {
  try {
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY || '';
    if (!apiKey) return NextResponse.json({ ok: false, error: 'TMDB_API_KEY missing' }, { status: 500 });

    const tmdbId = Number(payload?.tmdbId || 0);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid tmdbId' }, { status: 400 });
    }

    const streamBase = String(payload?.streamBase || '').trim();
    const titleInput = String(payload?.title || '').trim();
    const originalTitleInput = String(payload?.originalTitle || '').trim();
    const releaseDateInput = String(payload?.releaseDate || '').trim();

    const xuiAvailability = await loadXuiAvailableEpisodes({
      streamBase,
      tmdbId,
      title: titleInput,
      originalTitle: originalTitleInput,
      releaseDate: releaseDateInput,
    });

    const data = await tmdb(`/tv/${tmdbId}`, apiKey, {
      language: 'en-US',
      include_adult: 'false',
    });

    const baseSeasons = normalizeTmdbSeasonRows(data);
    const seasons = await Promise.all(
      baseSeasons.map((season) =>
        buildSeasonWithEpisodes({
          tmdbId,
          apiKey,
          season,
          availableSet: xuiAvailability.availableSet,
        })
      )
    );

    return NextResponse.json(
      {
        ok: true,
        tmdbId,
        title: String(data?.name || '').trim(),
        xuiMatchedSeriesId: xuiAvailability.matchedSeriesId,
        hasXuiAvailability: xuiAvailability.hasXuiData,
        seasons,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load series options' }, { status: 500 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handleSeriesOptions({
    tmdbId: searchParams.get('tmdbId'),
    title: searchParams.get('title') || '',
    originalTitle: searchParams.get('originalTitle') || '',
    releaseDate: searchParams.get('releaseDate') || '',
    streamBase: searchParams.get('streamBase') || '',
  });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return handleSeriesOptions(body);
}
