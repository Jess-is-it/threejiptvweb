import { NextResponse } from 'next/server';

import { adminCookieName, getAdminFromSessionToken } from '../../../../lib/server/adminAuth';
import { getPublicSettings, updatePublicSettings } from '../../../../lib/server/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireAdmin(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return null;
  return admin;
}

function envStatus() {
  const mask = (v) => (v ? `${String(v).slice(0, 2)}…${String(v).slice(-2)}` : '');
  const tmdb = process.env.TMDB_API_KEY || '';
  const xuione = process.env.XUIONE_URLS || process.env.XUI_SERVERS || '';

  return {
    tmdbApiKey: tmdb ? { set: true, masked: mask(tmdb) } : { set: false, masked: '' },
    xuioneUrls: xuione ? { set: true, masked: mask(xuione) } : { set: false, masked: '' },
  };
}

export async function GET(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const settings = await getPublicSettings();
  return NextResponse.json({ ok: true, settings, env: envStatus() }, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    await updatePublicSettings(body?.settings || body || {});
    const settings = await getPublicSettings();
    return NextResponse.json({ ok: true, settings, env: envStatus() }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update settings.' }, { status: 400 });
  }
}
