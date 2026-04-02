import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import {
  getDownloadSourcesState,
  updateDownloadSourceProvider,
} from '../../../../../lib/server/autodownload/sourceProvidersService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const type = String(searchParams.get('type') || 'movie').toLowerCase() === 'series' ? 'series' : 'movie';
    const state = await getDownloadSourcesState({ type });
    return NextResponse.json({ ok: true, ...state }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load download sources.' }, { status: 400 });
  }
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const type = String(body?.type || 'movie').toLowerCase() === 'series' ? 'series' : 'movie';
    const state = await updateDownloadSourceProvider({
      providerId: body?.providerId || body?.id || '',
      patch: body?.patch && typeof body.patch === 'object' ? body.patch : null,
      order: Array.isArray(body?.order) ? body.order : null,
      type,
    });
    return NextResponse.json({ ok: true, ...state }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update provider.' }, { status: 400 });
  }
}
