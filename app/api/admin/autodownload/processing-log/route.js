import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getAdminDb, saveAdminDb } from '../../../../../lib/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200) || 200));
  const db = await getAdminDb();
  const logs = Array.isArray(db.processingLogs) ? db.processingLogs.slice(0, limit) : [];
  return NextResponse.json({ ok: true, logs }, { status: 200 });
}

export async function DELETE(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const db = await getAdminDb();
  const prev = Array.isArray(db.processingLogs) ? db.processingLogs : [];
  const deleted = prev.length;
  db.processingLogs = [];
  await saveAdminDb(db);

  return NextResponse.json({ ok: true, deleted, remaining: 0 }, { status: 200 });
}
