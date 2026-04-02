import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getMountSettings } from '../../../../../lib/server/autodownload/autodownloadDb';
import { updateMountSettingsFromAdminInput } from '../../../../../lib/server/autodownload/mountService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeMountSettings(s) {
  if (!s) return null;
  return {
    id: s.id,
    windowsHost: s.windowsHost,
    shareName: s.shareName,
    mountDir: s.mountDir,
    xuiVodPath: s.xuiVodPath || '/home/xui/content/vod',
    domain: s.domain || '',
    smbVersion: s.smbVersion || '',
    uid: s.uid || 'xui',
    gid: s.gid || 'xui',
    hasCredentials: Boolean(s.usernameEnc && s.passwordEnc),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const s = await getMountSettings();
  return NextResponse.json({ ok: true, mount: safeMountSettings(s) }, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const saved = await updateMountSettingsFromAdminInput(body);
    return NextResponse.json({ ok: true, mount: safeMountSettings(saved) }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to save mount settings.' }, { status: 400 });
  }
}
