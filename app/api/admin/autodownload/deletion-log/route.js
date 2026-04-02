import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getDeletionLogs, runDeletionCycle } from '../../../../../lib/server/autodownload/deletionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const type = String(searchParams.get('type') || 'all').trim().toLowerCase();
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 200) || 200));
    const result = await getDeletionLogs({ type, limit });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load deletion logs.' }, { status: 500 });
  }
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await runDeletionCycle();
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to run deletion cycle.' }, { status: 500 });
  }
}
