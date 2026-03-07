import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getMountSettings } from '../../../../../../lib/server/autodownload/autodownloadDb';
import { testSmbAccess } from '../../../../../../lib/server/autodownload/mountService';
import { decryptString } from '../../../../../../lib/server/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    let body = {};
    try {
      body = await req.json();
    } catch {}

    const stored = await getMountSettings();
    const hasStoredCreds = Boolean(stored?.usernameEnc && stored?.passwordEnc);

    const hasAnyInput = body && typeof body === 'object' && (body.windowsHost || body.shareName || body.mountDir || body.username);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    if (!hasAnyInput) {
      const r = await testSmbAccess();
      return NextResponse.json({ ok: true, result: r }, { status: 200 });
    }

    if (!stored) {
      // No stored settings yet; require full credentials for a first-time test.
      const override = {
        windowsHost: body.windowsHost,
        shareName: body.shareName,
        mountDir: body.mountDir,
        username: body.username,
        password: body.password,
        domain: body.domain,
        smbVersion: body.smbVersion,
        uid: body.uid,
        gid: body.gid,
      };
      const r = await testSmbAccess({ settingsOverride: override });
      return NextResponse.json({ ok: true, result: r }, { status: 200 });
    }

    if (username && !password && hasStoredCreds) {
      const storedUsername = decryptString(stored.usernameEnc);
      if (storedUsername && username !== storedUsername) {
        return NextResponse.json(
          {
            ok: false,
            error: 'To change SMB Username, also enter SMB Password (or leave both blank to use saved credentials).',
          },
          { status: 400 }
        );
      }
    }

    const merged = {
      ...stored,
      windowsHost: body.windowsHost || stored.windowsHost,
      shareName: body.shareName || stored.shareName,
      mountDir: body.mountDir || stored.mountDir,
      domain: body.domain ?? stored.domain,
      smbVersion: body.smbVersion ?? stored.smbVersion,
      uid: body.uid ?? stored.uid,
      gid: body.gid ?? stored.gid,
      ...(password ? { username: username || undefined, password } : {}),
    };

    const r = await testSmbAccess({ settingsOverride: merged });
    return NextResponse.json({ ok: true, result: r }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'SMB test failed.' }, { status: 400 });
  }
}
