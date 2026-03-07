import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { fetchMountStatus } from '../../../../../../lib/server/autodownload/mountService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const status = await fetchMountStatus();
    return NextResponse.json({ ok: true, status }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to read mount status.' }, { status: 400 });
  }
}

