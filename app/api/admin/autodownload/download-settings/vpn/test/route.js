import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../../lib/server/adminApiAuth';
import { testQbittorrentVpnRuntime } from '../../../../../../../lib/server/autodownload/vpnService';

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
    const includePublicIp = body?.includePublicIp !== false;
    const validateCredentials = body?.validateCredentials === true;
    const result = await testQbittorrentVpnRuntime({ includePublicIp, validateCredentials });
    return NextResponse.json({ ok: Boolean(result?.ok), result }, { status: result?.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'VPN test failed.' }, { status: 400 });
  }
}
