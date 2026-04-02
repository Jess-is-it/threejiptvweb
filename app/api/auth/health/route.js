// app/api/auth/health/route.js
import { NextResponse } from 'next/server';

import { getPublicSettings } from '../../../../lib/server/settings';
import { getXuioneServersForRequest } from '../../../../lib/server/xuiServerRouting';

export async function GET(req) {
  try {
    const settings = await getPublicSettings();
    const servers = (await getXuioneServersForRequest({ req, settings })).map((row) => row.origin);
    if (!servers.length) throw new Error('No Xuione servers configured.');
    return NextResponse.json({ ok: true, servers }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
export const runtime = 'nodejs';
