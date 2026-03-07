import { NextResponse } from 'next/server';

import {
  adminCookieName,
  createAdminSession,
  verifyAdminPassword,
  hasAnyAdmin,
} from '../../../../lib/server/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isSecureRequest(req) {
  const xfProto = String(req.headers.get('x-forwarded-proto') || '').toLowerCase();
  if (xfProto) return xfProto === 'https';
  try {
    return req.nextUrl?.protocol === 'https:';
  } catch {
    return false;
  }
}

function setAdminCookie(req, res, token, maxAgeSeconds) {
  res.cookies.set(adminCookieName(), token, {
    httpOnly: true,
    sameSite: 'strict',
    // If we set `secure: true` while running on plain http (common on LAN),
    // the browser will refuse to store the cookie and the user can never stay logged in.
    secure: isSecureRequest(req),
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export async function POST(req) {
  if (!(await hasAnyAdmin())) {
    return NextResponse.json(
      { ok: false, error: 'No admin exists yet. Visit /admin/setup first.' },
      { status: 403 }
    );
  }

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const username = String(body?.username || body?.email || '').trim();
  const password = String(body?.password || '');

  const admin = await verifyAdminPassword({ username, password });
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'Invalid username or password.' }, { status: 401 });
  }

  const ttlSeconds = 60 * 60 * 24 * 7; // 7 days
  const sess = await createAdminSession(admin.id, { ttlMs: ttlSeconds * 1000 });

  const res = NextResponse.json({ ok: true, admin }, { status: 200 });
  setAdminCookie(req, res, sess.token, ttlSeconds);
  return res;
}
