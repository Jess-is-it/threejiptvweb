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
const SERIES_CATALOG_TTL_MS = 60 * 1000;
const SERIES_BACKGROUND_ARTWORK_RESOLVED = 18;
const SERIES_BACKGROUND_ARTWORK_SEARCH = 3;

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
      `series:${String(streamBase || '').trim()}`,
      async () => {
        const { server, username, password } = parseStreamBase(streamBase);
        const series = await xtreamWithFallback({
          server, username, password, action: 'get_series'
        });

        const items = (Array.isArray(series) ? series : []).map((s) => {
          const id = s?.series_id ?? s?.id;
          const year =
            (s?.releaseDate && String(s.releaseDate).slice(0, 4)) ||
            s?.year ||
            null;
          const added = normalizeAddedMs(
            s?.added,
            s?.date_added,
            s?.last_modified,
            s?.releaseDate,
            s?.release_date
          );
          const rawImage = s?.cover || s?.stream_icon || '';
          const imageSources = buildXuioneCatalogAssetSources({
            source: rawImage,
            server,
            kind: 'poster',
          });

          return {
            id,
            title: s?.name || `Series #${id}`,
            tmdbId:
              parseTmdbId(s?.tmdb) ||
              parseTmdbId(s?.tmdb_id) ||
              parseTmdbId(s?.tmdbId) ||
              parseTmdbId(s?.info?.tmdb) ||
              parseTmdbId(s?.info?.tmdb_id) ||
              null,
            image: imageSources.image,
            imageFallback: imageSources.imageFallback,
            plot: s?.plot || s?.overview || '',
            year,
            genre: s?.genre || s?.category_name || '',
            category_id: String(s?.category_id ?? s?.categoryId ?? '').trim(),
            rating: s?.rating ?? null,
            added,
            kind: 'series',
            href: id ? `/series/${id}` : '#',
          };
        });
        const hydrated = applyCachedCatalogArtwork(items, { kind: 'series' });
        void (async () => {
          await warmCatalogArtwork(items, {
            kind: 'series',
            maxResolved: SERIES_BACKGROUND_ARTWORK_RESOLVED,
            maxSearch: SERIES_BACKGROUND_ARTWORK_SEARCH,
            concurrency: 3,
          }).catch(() => {});
          const warmed = applyCachedCatalogArtwork(items, { kind: 'series' });
          await warmCatalogImageCache(warmed, { posterCount: 18, backdropCount: 4, concurrency: 3 }).catch(() => {});
        })();
        return { ok: true, items: hydrated };
      },
      { ttlMs: SERIES_CATALOG_TTL_MS }
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
