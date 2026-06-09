import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeBaseUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function configuredHotspotApiUrls() {
  const candidates = [
    process.env.THREEJ_HOTSPOT_API_URL,
    process.env.HOTSPOT_API_URL,
    'https://net.3jhotspot.com',
    process.env.THREEJ_HOTSPOT_API_FALLBACK_URL,
    'http://192.168.50.70:8080',
  ];
  const seen = new Set();
  return candidates
    .map(normalizeBaseUrl)
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function parseBodyFromText(raw = '') {
  try {
    const body = JSON.parse(raw || '{}');
    return { token: String(body?.token || '').trim() };
  } catch {
    const params = new URLSearchParams(raw || '');
    return { token: String(params.get('token') || '').trim() };
  }
}

async function checkThreejToken(token) {
  const integrationSecret = String(process.env.THREEJ_IPTV_INTEGRATION_SECRET || '').trim();
  if (!integrationSecret) {
    return { ok: false, status: 500, error: 'IPTV web integration secret is not configured on this TV server.' };
  }

  let lastError = 'Could not reach the hotspot API.';
  for (const baseUrl of configuredHotspotApiUrls()) {
    try {
      const response = await fetch(`${baseUrl}/api/iptv/session/status`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, integration_secret: integrationSecret }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        return { ok: true, data };
      }
      lastError = data?.detail || data?.error || `Hotspot API rejected the IPTV status check (${response.status}).`;
      if (response.status === 400 || response.status === 403) {
        return { ok: false, status: response.status, error: lastError };
      }
    } catch (error) {
      lastError = error?.message || lastError;
    }
  }

  return { ok: false, status: 502, error: lastError };
}

async function handle(req) {
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to read request body.' }, { status: 400 });
  }

  const { token } = parseBodyFromText(raw);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'IPTV login token is required.' }, { status: 400 });
  }

  const checked = await checkThreejToken(token);
  if (!checked.ok) {
    return NextResponse.json({ ok: false, error: checked.error }, { status: checked.status || 502 });
  }

  return NextResponse.json({
    ok: true,
    allowed: Boolean(checked.data?.allowed),
    status: checked.data?.status || (checked.data?.allowed ? 'ACTIVE' : 'RESTRICTED'),
    message: checked.data?.message || '',
    reasonCode: checked.data?.reason_code || null,
    remainingSeconds: Number(checked.data?.remaining_seconds || 0) || 0,
    warningSeconds: Number(checked.data?.warning_seconds || 0) || 0,
    warningMinutes: Number(checked.data?.warning_minutes || 0) || 0,
    stopSeconds: Number(checked.data?.stop_seconds || 0) || 0,
    warningActive: Boolean(checked.data?.warning_active),
    forceStop: Boolean(checked.data?.force_stop),
    portalUrl: checked.data?.portal_url || '',
    accessExpiresAt: checked.data?.access_expires_at || null,
    productName: checked.data?.product_name || '',
    data: checked.data,
  }, { status: 200 });
}

export async function POST(req) {
  return handle(req);
}

export async function GET() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
