import { NextResponse } from 'next/server';

import { createAdmin, hasAnyAdmin } from '../../../../lib/server/adminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  if (await hasAnyAdmin()) {
    return NextResponse.json({ ok: false, error: 'Admin already exists.' }, { status: 409 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const created = await createAdmin({ username: body?.username, email: body?.email, password: body?.password });
    return NextResponse.json({ ok: true, created }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to create admin.' }, { status: 400 });
  }
}
