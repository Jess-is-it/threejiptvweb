import { NextResponse } from 'next/server';

import {
  listUpcomingItems,
  listReleasedItems,
  subscribeUpcomingReminder,
} from '../../../../../lib/server/autodownload/releaseService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const username = String(searchParams.get('username') || '').trim();
    const state = String(searchParams.get('state') || 'upcoming').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(searchParams.get('limit') || 40) || 40));
    const items =
      state === 'released'
        ? await listReleasedItems({ limit })
        : await listUpcomingItems({ username, limit });
    return NextResponse.json({ ok: true, items }, { status: 200 });
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
