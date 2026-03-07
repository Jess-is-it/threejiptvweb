import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { provisionQbittorrentNox } from '../../../../../../lib/server/autodownload/qbittorrentService';

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
    const r = await provisionQbittorrentNox({
      port: body?.port,
      username: body?.username,
      password: body?.password,
      connectionMode: body?.connectionMode,
      lanBind: body?.lanBind,
    });
    return NextResponse.json({ ok: true, result: r }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Provisioning failed.' }, { status: 400 });
  }
}
