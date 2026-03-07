import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getEngineHostSafe, upsertEngineHostFromAdminInput } from '../../../../../lib/server/autodownload/engineHostService';
import { clearEngineHost } from '../../../../../lib/server/autodownload/autodownloadDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const host = await getEngineHostSafe();
  return NextResponse.json({ ok: true, engineHost: host }, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    await upsertEngineHostFromAdminInput(body);
    const host = await getEngineHostSafe();
    return NextResponse.json({ ok: true, engineHost: host }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to save Engine Host.' }, { status: 400 });
  }
}

export async function DELETE(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  await clearEngineHost();
  return NextResponse.json({ ok: true }, { status: 200 });
}
