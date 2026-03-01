import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../lib/server/adminApiAuth';
import { getRequestSettings, updateRequestSettings } from '../../../../lib/server/requestService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await getRequestSettings();
    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load request settings' }, { status: 500 });
  }
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const patch = body?.settings && typeof body.settings === 'object' ? body.settings : body;
    const settings = await updateRequestSettings(patch || {});
    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update request settings' }, { status: 400 });
  }
}
