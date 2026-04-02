import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getActivitySummary } from '../../../../../lib/server/autodownload/activityService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(5000, Number(searchParams.get('limit') || 2000) || 2000));
    const recentLimit = Math.max(1, Math.min(1000, Number(searchParams.get('recentLimit') || 200) || 200));
    const summary = await getActivitySummary({ limit, recentLimit });
    return NextResponse.json({ ok: true, ...summary }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load activity logs.' }, { status: 500 });
  }
}
