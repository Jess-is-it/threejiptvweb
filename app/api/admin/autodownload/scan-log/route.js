import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../lib/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200) || 200));
  const db = await getAdminDb();
  const logs = Array.isArray(db.xuiScanLogs) ? db.xuiScanLogs.slice(0, limit) : [];
  return NextResponse.json(
    {
      ok: true,
      logs,
      state: db.xuiScanState || null,
      triggerSettings: db.autodownloadSettings?.watchfolderTrigger || null,
    },
    { status: 200 }
  );
}
