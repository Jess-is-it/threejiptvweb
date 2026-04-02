import { NextResponse } from 'next/server';
import { buildXuioneCatalogAssetSources, parseStreamBase, xtreamWithFallback } from '../_shared';
import {
  applyCachedCatalogArtwork,
  parseTmdbId,
  warmCatalogArtwork,
  warmCatalogImageCache,
} from '../../../../lib/server/publicCatalogArtwork';
import { loadPublicCatalogData } from '../../../../lib/server/publicCatalogDataCache';

export const dynamic = 'force-dynamic';
const MOVIE_CATALOG_TTL_MS = 60 * 1000;
const MOVIE_BACKGROUND_ARTWORK_RESOLVED = 24;
const MOVIE_BACKGROUND_ARTWORK_SEARCH = 4;

function parseMovieProperties(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    return JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
}

function normalizeAddedMs(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const raw = String(value).trim();
    if (!raw) continue;

    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      if (n >= 1e12) return Math.floor(n);
      if (n >= 1e9) return Math.floor(n * 1000);
    }

    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const streamBase = searchParams.get('streamBase') || '';
  try {
    const payload = await loadPublicCatalogData(
      `movies:${String(streamBase || '').trim()}`,
      async () => {
        const { server, username, password } = parseStreamBase(streamBase);
        const vod = await xtreamWithFallback({
          server, username, password, action: 'get_vod_streams'
        });

        const items = (Array.isArray(vod) ? vod : []).map((v) => {
          const props = parseMovieProperties(v?.movie_properties);
          const id = v?.stream_id ?? v?.id;
          const added = normalizeAddedMs(
            v?.added,
            v?.date_added,
            v?.last_modified,
            v?.releaseDate,
            v?.release_date
          );
          const rawImage = props?.cover_big || props?.movie_image || v?.stream_icon || v?.cover || '';
          const imageSources = buildXuioneCatalogAssetSources({
            source: rawImage,
            server,
            kind: 'poster',
          });
          return {
            id,
            title: v?.name || `Movie #${id}`,
            tmdbId:
              parseTmdbId(props?.tmdb_id) ||
              parseTmdbId(v?.tmdb) ||
              parseTmdbId(v?.tmdb_id) ||
              parseTmdbId(v?.tmdbId) ||
              parseTmdbId(v?.info?.tmdb) ||
              parseTmdbId(v?.info?.tmdb_id) ||
              null,
            image: imageSources.image,
            imageFallback: imageSources.imageFallback,
            plot: v?.plot || v?.overview || '',
            year: v?.year || String(props?.release_date || '').trim().slice(0, 4) || null,
            genre: v?.genre || v?.category_name || '',
            category_id: String(v?.category_id ?? v?.categoryId ?? '').trim(),
            rating: v?.rating ?? null,
            duration: v?.duration || v?.duration_secs || null,
            ext: v?.container_extension || v?.containerExtension || null,
            added,
            kind: 'movie',
            href: id ? `/movies/${id}` : '#',
          };
        });
        const hydrated = applyCachedCatalogArtwork(items, { kind: 'movie' });
        void (async () => {
          await warmCatalogArtwork(items, {
            kind: 'movie',
            maxResolved: MOVIE_BACKGROUND_ARTWORK_RESOLVED,
            maxSearch: MOVIE_BACKGROUND_ARTWORK_SEARCH,
            concurrency: 3,
          }).catch(() => {});
          const warmed = applyCachedCatalogArtwork(items, { kind: 'movie' });
          await warmCatalogImageCache(warmed, { posterCount: 24, backdropCount: 6, concurrency: 3 }).catch(() => {});
        })();
        return { ok: true, items: hydrated };
      },
      { ttlMs: MOVIE_CATALOG_TTL_MS }
    );

    return NextResponse.json(
      payload,
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
      }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
