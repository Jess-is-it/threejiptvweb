import { NextResponse } from 'next/server';

import {
  getRequestSettings,
  getRequestStatesForItems,
  getUserRequestQuota,
  listRequestQueue,
  submitRequests,
  subscribeToRequestReminder,
} from '../../../../lib/server/requestService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicSettingsShape(settings) {
  return {
    dailyLimitDefault: Number(settings?.dailyLimitDefault || 3),
    defaultLandingCategory: String(settings?.defaultLandingCategory || 'popular'),
    statusTags: settings?.statusTags || {},
  };
}

function compactActiveStates(items) {
  const out = {};
  for (const row of Array.isArray(items) ? items : []) {
    const tmdbId = Number(row?.tmdbId || 0);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    const mediaType = String(row?.mediaType || 'movie').toLowerCase() === 'tv' ? 'tv' : 'movie';
    const key = `${mediaType}:${tmdbId}`;
    out[key] = {
      requestId: row?.id || '',
      status: row?.status || 'pending',
      requestCount: Number(row?.requestCount || 0),
    };
  }
  return out;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const username = String(searchParams.get('username') || '').trim();
    if (!username) return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });

    const [queue, quota, settings] = await Promise.all([
      listRequestQueue({ status: 'active', includeArchived: false }),
      getUserRequestQuota(username),
      getRequestSettings(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        quota,
        settings: publicSettingsShape(settings),
        activeStates: compactActiveStates(queue.items),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load request data' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim().toLowerCase();

    if (action === 'submit') {
      const result = await submitRequests({
        username: body?.username,
        items: Array.isArray(body?.items) ? body.items : [],
      });
      return NextResponse.json({ ok: true, ...result }, { status: 200 });
    }

    if (action === 'state') {
      const result = await getRequestStatesForItems({
        username: body?.username,
        items: Array.isArray(body?.items) ? body.items : [],
      });
      return NextResponse.json({ ok: true, ...result }, { status: 200 });
    }

    if (action === 'remind') {
      const result = await subscribeToRequestReminder({
        username: body?.username,
        tmdbId: body?.tmdbId,
        mediaType: body?.mediaType,
      });
      return NextResponse.json({ ok: true, ...result }, { status: 200 });
    }

    return NextResponse.json(
      { ok: false, error: 'Invalid action. Use submit, state, or remind.' },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Request action failed' }, { status: 400 });
  }
}
