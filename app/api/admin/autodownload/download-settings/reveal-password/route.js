import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { verifyAdminPassword } from '../../../../../../lib/server/adminAuth';
import { revealQbittorrentWebUiPassword } from '../../../../../../lib/server/autodownload/qbittorrentService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const adminPassword = String(body?.adminPassword || '');
  if (!adminPassword) {
    return NextResponse.json({ ok: false, error: 'Admin password is required.' }, { status: 400 });
  }

  let verified = await verifyAdminPassword({ username: admin?.username || '', password: adminPassword });
  if (!verified && admin?.email) {
    verified = await verifyAdminPassword({ username: admin.email, password: adminPassword });
  }
  if (!verified || String(verified.id || '') !== String(admin.id || '')) {
    return NextResponse.json({ ok: false, error: 'Invalid admin password.' }, { status: 401 });
  }

  try {
    const password = await revealQbittorrentWebUiPassword();
    return NextResponse.json({ ok: true, password }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to reveal qBittorrent password.' }, { status: 400 });
  }
}

