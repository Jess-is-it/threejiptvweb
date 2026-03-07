import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getXuiIntegrationSafe, updateXuiIntegrationFromAdminInput } from '../../../../../lib/server/autodownload/xuiService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const xui = await getXuiIntegrationSafe();
  return NextResponse.json({ ok: true, xui }, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const xui = await updateXuiIntegrationFromAdminInput(body);
    return NextResponse.json({ ok: true, xui }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update XUI config.' }, { status: 400 });
  }
}

