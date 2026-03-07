import { NextResponse } from 'next/server';

import { adminCookieName, getAdminFromSessionToken } from '../../../../lib/server/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return NextResponse.json({ ok: false, admin: null }, { status: 200 });
  return NextResponse.json({ ok: true, admin }, { status: 200 });
}
