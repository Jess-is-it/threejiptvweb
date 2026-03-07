import { NextResponse } from 'next/server';

import crypto from 'node:crypto';

import { hasAnyAdmin, findAdminByUsernameOrEmail, setAdminPassword } from '../../../../lib/server/adminAuth';
import { sendMail } from '../../../../lib/server/mailer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function genTempPassword() {
  // 12 chars, url-safe (letters/numbers/_-)
  return crypto.randomBytes(18).toString('base64url').slice(0, 12);
}

export async function POST(req) {
  if (!(await hasAnyAdmin())) {
    return NextResponse.json({ ok: false, error: 'No admin exists yet. Visit /admin/setup first.' }, { status: 403 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const username = String(body?.username || body?.email || '').trim();
  if (!username) return NextResponse.json({ ok: false, error: 'Username is required.' }, { status: 400 });

  try {
    const admin = await findAdminByUsernameOrEmail(username);
    // Do not leak whether the account exists. Always return ok.
    if (!admin) return NextResponse.json({ ok: true }, { status: 200 });

    // Reset password (hash stored; original cannot be recovered).
    const tempPassword = genTempPassword();
    await setAdminPassword(admin.id, tempPassword);

    const subject = '3J TV Admin Password Reset';
    const text = `Hi ${admin.username || 'admin'},\n\nYour admin password has been reset.\n\nNew password: ${tempPassword}\n\nYou can sign in at /admin/login.\n\nIf you did not request this, please contact your system administrator.\n`;

    await sendMail({ to: admin.email, subject, text });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to reset password.' }, { status: 500 });
  }
}
