import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getQbittorrentVpnSettingsSafe, updateQbittorrentVpnSettingsFromAdminInput } from '../../../../../../lib/server/autodownload/vpnService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const vpn = await getQbittorrentVpnSettingsSafe();
    return NextResponse.json({ ok: true, vpn }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load VPN settings.' }, { status: 400 });
  }
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const vpn = await updateQbittorrentVpnSettingsFromAdminInput(body || {});
    return NextResponse.json({ ok: true, vpn }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update VPN settings.' }, { status: 400 });
  }
}
