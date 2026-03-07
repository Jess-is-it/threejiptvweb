import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { upsertMountSettingsFromAdminInput } from '../../../../../../lib/server/autodownload/mountService';
import { mountNow } from '../../../../../../lib/server/autodownload/mountService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    let body = {};
    try {
      body = await req.json();
    } catch {}

    const hasCredentials = Boolean(String(body?.username || '').trim() && String(body?.password || ''));
    if (hasCredentials) {
      await upsertMountSettingsFromAdminInput(body);
    }

    const r = await mountNow();
    return NextResponse.json({ ok: true, result: r }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Mount failed.' }, { status: 400 });
  }
}
