import { NextResponse } from 'next/server';

import { listLeavingSoonItems } from '../../../../../lib/server/autodownload/deletionService';
import { warmCatalogImageCache } from '../../../../../lib/server/publicCatalogArtwork';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const mediaType = String(searchParams.get('mediaType') || searchParams.get('type') || 'all').trim().toLowerCase();
    const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : mediaType === 'movie' ? 'movie' : 'all';
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 40) || 40));
    const items = await listLeavingSoonItems({ type, limit });
    void warmCatalogImageCache(items, { posterCount: 6, backdropCount: 2, concurrency: 2 }).catch(() => {});
    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load leaving soon titles.' }, { status: 500 });
  }
}
