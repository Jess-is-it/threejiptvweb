import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { triggerXuiScanNow } from '../../../../../../lib/server/autodownload/xuiService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const result = await triggerXuiScanNow({
      type: body?.type || 'movie',
      force: Boolean(body?.force),
      reason: body?.reason || (body?.force ? 'force' : 'manual'),
    });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Scan failed.' }, { status: 400 });
  }
}

