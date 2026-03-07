import { NextResponse } from 'next/server';

import { adminCookieName, deleteAdminSession } from '../../../../lib/server/adminAuth';

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

export async function POST(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  if (token) await deleteAdminSession(token);

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(adminCookieName(), '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
  return res;
}

export async function GET(req) {
  return POST(req);
}
