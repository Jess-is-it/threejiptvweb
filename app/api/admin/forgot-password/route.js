import { NextResponse } from 'next/server';

import crypto from 'node:crypto';

import { hasAnyAdmin, findAdminByUsernameOrEmail, setAdminPassword } from '../../../../lib/server/adminAuth';
import { checkRateLimit, getClientIp, tooManyRequestsPayload } from '../../../../lib/server/botProtection';
import { sendMail } from '../../../../lib/server/mailer';
import { turnstileErrorResponse, verifyTurnstile } from '../../../../lib/server/turnstile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COOLDOWN_SECONDS = 60;
const attempts = new Map();

function genTempPassword() {
  // 12 chars, url-safe (letters/numbers/_-)
  return crypto.randomBytes(18).toString('base64url').slice(0, 12);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function maskEmail(email) {
  const [local, domain] = String(email || '').trim().split('@');
  if (!local || !domain) return '';
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}${local.length > 2 ? '***' : '*'}@${domain}`;
}

function requestIp(req) {
  return getClientIp(req);
}

function cooldownKey(req, email) {
  return `${requestIp(req)}:${normalizeEmail(email)}`;
}

function retryAfterSeconds(key) {
  const last = Number(attempts.get(key) || 0) || 0;
  if (!last) return 0;
  const remainingMs = last + COOLDOWN_SECONDS * 1000 - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function markAttempt(key) {
  attempts.set(key, Date.now());
  if (attempts.size > 1000) {
    const cutoff = Date.now() - COOLDOWN_SECONDS * 1000 * 5;
    for (const [rowKey, timestamp] of attempts.entries()) {
      if (Number(timestamp || 0) < cutoff) attempts.delete(rowKey);
    }
  }
}

export async function POST(req) {
  const ipLimit = checkRateLimit(req, {
    scope: 'admin-forgot-password-post',
    limit: 4,
    windowMs: 60_000,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(tooManyRequestsPayload(ipLimit), {
      status: 429,
      headers: { 'Retry-After': String(ipLimit.retryAfter), 'Cache-Control': 'no-store' },
    });
  }

  if (!(await hasAnyAdmin())) {
    return NextResponse.json({ ok: false, error: 'No admin exists yet. Visit /admin/setup first.' }, { status: 403 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ ok: false, error: 'Email is required.' }, { status: 400 });
  if (!isEmail(email)) return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 });

  const turnstile = await verifyTurnstile({
    req,
    area: 'admin_forgot_password',
    token: body?.turnstileToken,
  });
  if (!turnstile.ok) {
    return NextResponse.json(turnstileErrorResponse(turnstile), {
      status: turnstile.status || 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const key = cooldownKey(req, email);
  const retryAfter = retryAfterSeconds(key);
  if (retryAfter > 0) {
    return NextResponse.json(
      { ok: false, error: `Please wait ${retryAfter} seconds before sending another password email.`, retryAfterSeconds: retryAfter },
      { status: 429 }
    );
  }
  markAttempt(key);

  try {
    const admin = await findAdminByUsernameOrEmail(email);
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: 'No admin account uses that email address.', cooldownSeconds: COOLDOWN_SECONDS },
        { status: 404 }
      );
    }

    const tempPassword = genTempPassword();

    const subject = '3J TV Admin Password Reset';
    const text = `Hi ${admin.username || 'admin'},\n\nYour admin password has been reset.\n\nNew password: ${tempPassword}\n\nYou can sign in at /admin/login.\n\nIf you did not request this, please contact your system administrator.\n`;

    await sendMail({ to: admin.email, subject, text });
    // Reset only after SMTP succeeds so a mail failure cannot lock the admin out.
    await setAdminPassword(admin.id, tempPassword);
    return NextResponse.json({ ok: true, sentTo: maskEmail(admin.email), cooldownSeconds: COOLDOWN_SECONDS }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to reset password.' }, { status: 500 });
  }
}
