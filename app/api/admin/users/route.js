import { NextResponse } from 'next/server';

import {
  adminCookieName,
  createAdmin,
  getAdminFromSessionToken,
  listAdminsSafe,
} from '../../../../lib/server/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireAdmin(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return null;
  return admin;
}

export async function GET(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const admins = await listAdminsSafe();
  return NextResponse.json({ ok: true, admins }, { status: 200 });
}

export async function POST(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const created = await createAdmin({
      username: body?.username,
      email: body?.email,
      password: body?.password,
    });
    const admins = await listAdminsSafe();
    return NextResponse.json({ ok: true, created, admins }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to create admin.' }, { status: 400 });
  }
}
