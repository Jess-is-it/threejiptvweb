import { NextResponse } from 'next/server';

import { adminCookieName, getAdminFromSessionToken } from '../../../../lib/server/adminAuth';
import {
  getPublicHttpsStatus,
  restartCloudflaredConnector,
  savePublicHttpsSettings,
  startCloudflaredConnector,
  stopCloudflaredConnector,
} from '../../../../lib/server/publicHttps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireAdmin(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return null;
  return admin;
}

function jsonError(error, status = 400) {
  return NextResponse.json({ ok: false, error: error?.message || 'Public HTTPS action failed.' }, { status });
}

export async function GET(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await getPublicHttpsStatus(), { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
export async function PUT(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await savePublicHttpsSettings(body || {}), { status: 200 });
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
    if (action === 'start') return NextResponse.json(await startCloudflaredConnector(), { status: 200 });
    if (action === 'stop') return NextResponse.json(await stopCloudflaredConnector(), { status: 200 });
    if (action === 'restart') return NextResponse.json(await restartCloudflaredConnector(), { status: 200 });
    if (action === 'check' || action === 'status') return NextResponse.json(await getPublicHttpsStatus(), { status: 200 });
    return NextResponse.json({ ok: false, error: 'Unsupported Public HTTPS action.' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
