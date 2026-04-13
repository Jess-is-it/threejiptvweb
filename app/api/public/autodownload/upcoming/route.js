import { NextResponse } from 'next/server';

import {
  listUpcomingItems,
  listReleasedItems,
  subscribeUpcomingReminder,
} from '../../../../../lib/server/autodownload/releaseService';
import { warmCatalogImageCache } from '../../../../../lib/server/publicCatalogArtwork';
import { loadPublicCatalogData } from '../../../../../lib/server/publicCatalogDataCache';
import { ensureKidsCatalogTagsMixed } from '../../../../../lib/server/kidsCatalogService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UPCOMING_TTL_MS = 60 * 1000;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const username = String(searchParams.get('username') || '').trim();
    const state = String(searchParams.get('state') || 'upcoming').trim().toLowerCase();
    const mediaType = String(searchParams.get('mediaType') || searchParams.get('type') || 'all').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 40) || 40));
    const payload = await loadPublicCatalogData(
      `public-upcoming:${state}:${mediaType}:${limit}:${username}`,
      async () => {
        const items =
          state === 'released'
            ? await listReleasedItems({ limit, mediaType })
            : await listUpcomingItems({ username, limit, mediaType });
        const taggedItems = await ensureKidsCatalogTagsMixed(items);
        void warmCatalogImageCache(taggedItems, { posterCount: 12, backdropCount: 3, concurrency: 2 }).catch(() => {});
        return { ok: true, items: taggedItems };
      },
      { ttlMs: UPCOMING_TTL_MS }
    );
    return NextResponse.json(payload, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load upcoming titles' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim().toLowerCase();
    if (action !== 'remind') {
      return NextResponse.json({ ok: false, error: 'Invalid action. Use remind.' }, { status: 400 });
    }

    const username = String(body?.username || '').trim();
    const tmdbId = Number(body?.tmdbId || 0);
    const mediaType = String(body?.mediaType || 'movie').trim().toLowerCase();
    const title = String(body?.title || '').trim();
    const releaseDate = String(body?.releaseDate || '').trim();
    if (!username) return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) return NextResponse.json({ ok: false, error: 'Invalid tmdbId' }, { status: 400 });

    const result = await subscribeUpcomingReminder({
      username,
      tmdbId,
      mediaType,
      title,
      releaseDate,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to subscribe reminder' }, { status: 500 });
  }
}
