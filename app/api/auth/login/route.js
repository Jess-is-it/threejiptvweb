// app/api/auth/login/route.js
import { NextResponse } from 'next/server';
import { getPublicSettings } from '../../../../lib/server/settings';
import { xtreamWithFallback } from '../../xuione/_shared';
import { getXuioneServersForRequest } from '../../../../lib/server/xuiServerRouting';
import {
  checkAuthLock,
  checkRateLimit,
  clearAuthFailures,
  recordAuthFailure,
  tooManyRequestsPayload,
} from '../../../../lib/server/botProtection';
import { turnstileErrorResponse, verifyTurnstile } from '../../../../lib/server/turnstile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pickServer(servers) {
  if (!servers?.length) return null;
  const idx = Math.floor(Date.now() / 1000) % servers.length; // simple round-robin
  return servers[idx];
}

function normalizeOrigin(s) {
  try {
    return new URL(s).origin;
  } catch {
    return '';
  }
}

function pickConfiguredServer(servers) {
  const list = (servers || []).map((s) => ({ origin: s.origin || normalizeOrigin(s) })).filter((s) => s.origin);
  if (!list.length) return null;

  // Optional pinning / disable balancing
  const pinned = String(process.env.PINNED_SERVER || '').trim();
  if (pinned) {
    const po = normalizeOrigin(pinned);
    const found = list.find((s) => s.origin === po);
    if (found) return found;
    return { origin: po };
  }

  const lbEnabled = String(process.env.LOAD_BALANCING_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!lbEnabled) return list[0];

  return pickServer(list) || list[0];
}

function buildStreamBase(serverOrigin, username, password) {
  const origin = serverOrigin.endsWith('/') ? serverOrigin : serverOrigin + '/';
  return `${origin}live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/`;
}

async function fetchXtreamLogin(serverOrigin, username, password) {
  // Use the shared Xuione helper so we also inherit mirror fallback + self-signed cert handling.
  const timeoutMs = Number(process.env.XUI_LOGIN_TIMEOUT_MS || 8000);
  const data = await xtreamWithFallback({ server: serverOrigin, username, password, timeoutMs });
  return data || {};
}

function parseBodyFromText(raw = '') {
  let username = '', password = '';

  // Try JSON first
  try {
    const b = JSON.parse(raw || '{}');
      username = String(b?.username || '').trim();
      password = String(b?.password || '').trim();
      return { username, password, turnstileToken: String(b?.turnstileToken || '').trim() };
  } catch {
    // Fallback: application/x-www-form-urlencoded
    const p = new URLSearchParams(raw || '');
    username = String(p.get('username') || '').trim();
    password = String(p.get('password') || '').trim();
    return { username, password, turnstileToken: String(p.get('turnstileToken') || '').trim() };
  }
  return { username, password, turnstileToken: '' };
}

function publicLoginFailureResponse(req, username) {
  const failure = recordAuthFailure(req, {
    scope: 'public-login-failure',
    identifier: username,
    maxFailures: 5,
    windowMs: 15 * 60_000,
    lockMs: 15 * 60_000,
  });
  if (failure.locked) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many failed login attempts. Try again in ${failure.retryAfter} seconds.`,
        retryAfterSeconds: failure.retryAfter,
      },
      { status: 429, headers: { 'Retry-After': String(failure.retryAfter), 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(
    { ok: false, error: 'Invalid username or password.' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } }
  );
}

function isInvalidUpstreamLogin(error) {
  const message = String(error?.message || '');
  return /\b(401|403|404)\b|not found|unauthorized|forbidden/i.test(message);
}

async function handle(req) {
  try {
    const ipLimit = checkRateLimit(req, {
      scope: 'public-login-post',
      limit: 8,
      windowMs: 60_000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(tooManyRequestsPayload(ipLimit), {
        status: 429,
        headers: { 'Retry-After': String(ipLimit.retryAfter), 'Cache-Control': 'no-store' },
      });
    }

    // READ BODY ONCE AS TEXT (avoids "body already been read")
    let raw = '';
    try {
      raw = await req.text();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Unable to read request body.' },
        { status: 400 }
      );
    }
    const { username, password, turnstileToken } = parseBodyFromText(raw);

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: 'Username and password are required.' },
        { status: 400 }
      );
    }

    const authLock = checkAuthLock(req, { scope: 'public-login-failure', identifier: username });
    if (authLock.locked) {
      return NextResponse.json(
        {
          ok: false,
          error: `Too many failed login attempts. Try again in ${authLock.retryAfter} seconds.`,
          retryAfterSeconds: authLock.retryAfter,
        },
        { status: 429, headers: { 'Retry-After': String(authLock.retryAfter), 'Cache-Control': 'no-store' } }
      );
    }

    const settings = await getPublicSettings();
    const turnstile = await verifyTurnstile({
      req,
      area: 'public_login',
      token: turnstileToken,
      settings,
    });
    if (!turnstile.ok) {
      return NextResponse.json(turnstileErrorResponse(turnstile), {
        status: turnstile.status || 403,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const servers = await getXuioneServersForRequest({ req, settings });
    if (!servers.length) {
      return NextResponse.json(
        { ok: false, error: 'No Xuione servers configured.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const chosen = pickConfiguredServer(servers);
    const serverOrigin = chosen?.origin || servers[0].origin || servers[0];

    // Validate with Xuione/Xtream
    let data = {};
    try {
      data = await fetchXtreamLogin(serverOrigin, username, password);
    } catch (e) {
      if (isInvalidUpstreamLogin(e)) {
        return publicLoginFailureResponse(req, username);
      }
      return NextResponse.json(
        {
          ok: false,
          error: 'Login service is temporarily unavailable. Please try again shortly.',
          upstreamUnavailable: true,
        },
        { status: 502, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const ui = data?.user_info || {};
    const auth =
      ui?.auth === 1 || ui?.auth === '1' || (ui?.status || '').toLowerCase() === 'active';

    if (!auth) {
      return publicLoginFailureResponse(req, username);
    }

    clearAuthFailures(req, { scope: 'public-login-failure', identifier: username });

    return NextResponse.json(
      {
        ok: true,
        server: serverOrigin.endsWith('/') ? serverOrigin : serverOrigin + '/',
        streamBase: buildStreamBase(serverOrigin, username, password),
        user: {
          username,
          status: ui?.status || 'Active',
          is_trial: ui?.is_trial ?? 0,
          exp_date: ui?.exp_date ?? '',
        },
      },
      { status: 200 }
    );
  } catch (e) {
    console.error('[3JTV][AUTH_LOGIN] unexpected error', e);
    return NextResponse.json(
      { ok: false, error: 'Login failed.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(req) { return handle(req); }
export async function GET() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
