import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../lib/server/adminApiAuth';
import { getA2pMessagingSettings, updateA2pMessagingSettings } from '../../../../lib/server/a2pMessaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const settings = await getA2pMessagingSettings();
  return NextResponse.json({ ok: true, settings }, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const settings = await updateA2pMessagingSettings(body);
    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to update A2P messaging settings.' }, { status: 400 });
  }
}
