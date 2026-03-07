// app/api/auth/login/route.js
import { NextResponse } from 'next/server';
import { getPublicSettings } from '../../../../lib/server/settings';
import { xtreamWithFallback } from '../../xuione/_shared';

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
  const data = await xtreamWithFallback({ server: serverOrigin, username, password });
  return data || {};
}

function parseBodyFromText(raw = '') {
  let username = '', password = '';

  // Try JSON first
  try {
    const b = JSON.parse(raw || '{}');
    username = String(b?.username || '').trim();
    password = String(b?.password || '').trim();
  } catch {
    // Fallback: application/x-www-form-urlencoded
    const p = new URLSearchParams(raw || '');
    username = String(p.get('username') || '').trim();
    password = String(p.get('password') || '').trim();
  }
  return { username, password };
}

async function handle(req) {
  try {
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
    const { username, password } = parseBodyFromText(raw);

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: 'Username and password are required.' },
        { status: 400 }
      );
    }

    const settings = await getPublicSettings();
    const servers = (settings?.xuione?.servers || [])
      .map((u) => {
        try {
          return { origin: new URL(u).origin };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (!servers.length) {
      return NextResponse.json(
        { ok: false, error: 'No Xuione servers configured.' },
        { status: 500 }
      );
    }
    const chosen = pickConfiguredServer(servers);
    const serverOrigin = chosen?.origin || servers[0].origin || servers[0];

    // Validate with Xuione/Xtream
    const data = await fetchXtreamLogin(serverOrigin, username, password);
    const ui = data?.user_info || {};
    const auth =
      ui?.auth === 1 || ui?.auth === '1' || (ui?.status || '').toLowerCase() === 'active';

    if (!auth) {
      return NextResponse.json(
        { ok: false, error: 'Invalid username or password.' },
        { status: 401 }
      );
    }

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
    return NextResponse.json(
      { ok: false, error: e?.message || 'Login failed.' },
      { status: 500 }
    );
  }
}

export async function POST(req) { return handle(req); }
export async function GET() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
