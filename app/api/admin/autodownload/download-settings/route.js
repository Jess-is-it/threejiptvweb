import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getQbittorrentSettingsSafe, updateQbittorrentSettingsFromAdminInput } from '../../../../../lib/server/autodownload/qbittorrentService';
import { updateAutodownloadSettings } from '../../../../../lib/server/autodownload/autodownloadDb';
import { getQbittorrentVpnSettingsSafe } from '../../../../../lib/server/autodownload/vpnService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const qb = await getQbittorrentSettingsSafe({ syncRuntime: true });
  const vpn = await getQbittorrentVpnSettingsSafe().catch(() => null);
  if (vpn) qb.vpn = vpn;
  return NextResponse.json({ ok: true, qb }, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const qb = await updateQbittorrentSettingsFromAdminInput(body);
    // Enable autodownload if user wants (defaults to false).
    if (body?.enabled !== undefined) {
      await updateAutodownloadSettings({ enabled: Boolean(body.enabled) });
    }
    return NextResponse.json({ ok: true, qb }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update qBittorrent settings.' }, { status: 400 });
  }
}
