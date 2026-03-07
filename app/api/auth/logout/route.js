// app/api/auth/logout/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function clearCookie(res, name) {
  // Clears cookie even if it doesn't exist (safe no-op).
  res.cookies.set(name, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    expires: new Date(0),
  });
}

export async function POST() {
  const res = NextResponse.json({ ok: true });

  // Clear likely cookie names (adjust if you actually use a specific one)
  clearCookie(res, 'session');
  clearCookie(res, 'auth');
  clearCookie(res, '3jtv_session');

  return res;
}

// Optional: allow GET /api/auth/logout during testing so it doesn’t 405
export async function GET() {
  return POST();
}
