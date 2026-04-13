import { NextResponse } from 'next/server';

import { listLeavingSoonItems } from '../../../../../lib/server/autodownload/deletionService';
import { warmCatalogImageCache } from '../../../../../lib/server/publicCatalogArtwork';
import { loadPublicCatalogData } from '../../../../../lib/server/publicCatalogDataCache';
import { ensureKidsCatalogTagsMixed } from '../../../../../lib/server/kidsCatalogService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LEAVING_SOON_TTL_MS = 60 * 1000;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const mediaType = String(searchParams.get('mediaType') || searchParams.get('type') || 'all').trim().toLowerCase();
    const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : mediaType === 'movie' ? 'movie' : 'all';
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 40) || 40));
    const payload = await loadPublicCatalogData(
      `public-leaving:${type}:${limit}`,
      async () => {
        const items = await listLeavingSoonItems({ type, limit });
        const taggedItems = await ensureKidsCatalogTagsMixed(items);
        void warmCatalogImageCache(taggedItems, { posterCount: 10, backdropCount: 2, concurrency: 2 }).catch(() => {});
        return { ok: true, items: taggedItems };
      },
      { ttlMs: LEAVING_SOON_TTL_MS }
    );
    return NextResponse.json(payload, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load leaving soon titles.' }, { status: 500 });
  }
}
