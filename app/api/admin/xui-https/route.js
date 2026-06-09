import { NextResponse } from 'next/server';

import { adminCookieName, getAdminFromSessionToken } from '../../../../lib/server/adminAuth';
import {
  getXuiHttpsStatus,
  installXuiHttpsConnector,
  restartXuiHttpsConnector,
  saveXuiHttpsSettings,
  startXuiHttpsConnector,
  stopXuiHttpsConnector,
  testXuiHttpsSsh,
} from '../../../../lib/server/xuiHttps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireAdmin(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return null;
  return admin;
}

function jsonError(error, status = 400) {
  return NextResponse.json({ ok: false, error: error?.message || 'XUI HTTPS action failed.' }, { status });
}

export async function GET(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await getXuiHttpsStatus(), { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await saveXuiHttpsSettings(body || {}), { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim().toLowerCase();
    if (action === 'test-ssh') return NextResponse.json(await testXuiHttpsSsh(), { status: 200 });
    if (action === 'install' || action === 'install_update') return NextResponse.json(await installXuiHttpsConnector(), { status: 200 });
    if (action === 'start') return NextResponse.json(await startXuiHttpsConnector(), { status: 200 });
    if (action === 'stop') return NextResponse.json(await stopXuiHttpsConnector(), { status: 200 });
    if (action === 'restart') return NextResponse.json(await restartXuiHttpsConnector(), { status: 200 });
    if (action === 'check' || action === 'status') return NextResponse.json(await getXuiHttpsStatus({ refreshRemote: true }), { status: 200 });
    return NextResponse.json({ ok: false, error: 'Unsupported XUI HTTPS action.' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
