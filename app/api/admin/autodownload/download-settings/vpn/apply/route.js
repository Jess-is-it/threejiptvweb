import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../../lib/server/adminApiAuth';
import { applyQbittorrentVpnConfiguration, disableQbittorrentVpnConfiguration } from '../../../../../../../lib/server/autodownload/vpnService';

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
    const action = String(body?.action || '').trim().toLowerCase();
    const result =
      action === 'disable' ? await disableQbittorrentVpnConfiguration() : await applyQbittorrentVpnConfiguration();
    return NextResponse.json({ ok: Boolean(result?.ok), result }, { status: result?.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to apply VPN settings.' }, { status: 400 });
  }
}
