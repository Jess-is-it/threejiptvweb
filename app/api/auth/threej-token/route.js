import { NextResponse } from 'next/server';
import { getPublicSettings } from '../../../../lib/server/settings';
import { getXuioneServersForRequest } from '../../../../lib/server/xuiServerRouting';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOTSPOT_RESOLVE_TIMEOUT_MS = 7000;
const HOTSPOT_REPORT_TIMEOUT_MS = 4000;

function normalizeOrigin(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    return `${url.origin}/`;
  } catch {
    return '';
  }
}

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

function buildStreamBase(serverOrigin, username, password) {
  const origin = serverOrigin.endsWith('/') ? serverOrigin : `${serverOrigin}/`;
  return `${origin}live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/`;
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

async function reportIptvLoginFailure({ token, integrationSecret, stage, reasonCode, message, sourceUrl = '', checkedUrls = [], metadata = {} }) {
  if (!integrationSecret) return false;
  for (const baseUrl of configuredHotspotApiUrls()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOTSPOT_REPORT_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/api/iptv/session/login-failure`, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          integration_secret: integrationSecret,
          stage,
          reason_code: reasonCode,
          message,
          source_url: sourceUrl,
          checked_urls: checkedUrls,
          metadata,
        }),
      });
      if (response.ok) return true;
    } catch (_error) {
      // Try the next configured hotspot API URL. Reporting must never block login fallback UX.
    } finally {
      clearTimeout(timeout);
    }
  }
  return false;
}

function pickServer(servers) {
  if (!servers?.length) return null;
  const idx = Math.floor(Date.now() / 1000) % servers.length;
  return servers[idx];
}

function pickConfiguredServer(servers) {
  const list = (servers || [])
    .map((server) => ({ origin: server.origin || normalizeOrigin(server) }))
    .filter((server) => server.origin);
  if (!list.length) return null;

  const pinned = String(process.env.PINNED_SERVER || '').trim();
  if (pinned) {
    const pinnedOrigin = normalizeOrigin(pinned);
    const found = list.find((server) => server.origin === pinnedOrigin);
    if (found) return found;
    return { origin: pinnedOrigin };
  }

  const lbEnabled = String(process.env.LOAD_BALANCING_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!lbEnabled) return list[0];
  return pickServer(list) || list[0];
}

async function resolveThreejToken(token) {
  const integrationSecret = String(process.env.THREEJ_IPTV_INTEGRATION_SECRET || '').trim();
  if (!integrationSecret) {
    return {
      ok: false,
      status: 500,
      error: 'IPTV web integration secret is not configured on this TV server.',
    };
  }

  let lastError = 'Could not reach the hotspot API.';
  for (const baseUrl of configuredHotspotApiUrls()) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HOTSPOT_RESOLVE_TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/api/iptv/session/resolve`, {
          method: 'POST',
          cache: 'no-store',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, integration_secret: integrationSecret }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.status === 'SUCCESS') {
          return { ok: true, data };
        }
        lastError = data?.detail || data?.error || `Hotspot API rejected the IPTV token (${response.status}).`;
        if (response.status === 400 || response.status === 403 || response.status === 404) {
          await reportIptvLoginFailure({
            token,
            integrationSecret,
            stage: 'IPTV_WEB_TOKEN_RESOLVE',
            reasonCode: `HOTSPOT_${response.status}`,
            message: lastError,
            sourceUrl: baseUrl,
            checkedUrls: configuredHotspotApiUrls(),
            metadata: { http_status: response.status },
          });
          return { ok: false, status: response.status, error: lastError };
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        lastError = `Timed out reaching the hotspot API at ${baseUrl}.`;
      } else {
        lastError = error?.message || lastError;
      }
    }
  }

  const checkedUrls = configuredHotspotApiUrls();
  console.error('[3J IPTV token handoff failed]', {
    reason: lastError,
    checkedUrls,
    timestamp: new Date().toISOString(),
  });
  await reportIptvLoginFailure({
    token,
    integrationSecret,
    stage: 'IPTV_WEB_TOKEN_HANDOFF',
    reasonCode: 'HOTSPOT_API_UNREACHABLE',
    message: lastError,
    checkedUrls,
  });
  return { ok: false, status: 502, error: lastError };
}

function parseBodyFromText(raw = '') {
  try {
    const body = JSON.parse(raw || '{}');
    return { token: String(body?.token || '').trim(), remember: body?.remember !== false };
  } catch {
    const params = new URLSearchParams(raw || '');
    return { token: String(params.get('token') || '').trim(), remember: params.get('remember') !== 'false' };
  }
}

async function handle(req) {
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ ok: false, error: 'Unable to read request body.' }, { status: 400 });
  }

  const { token, remember } = parseBodyFromText(raw);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'IPTV login token is required.' }, { status: 400 });
  }

  const resolved = await resolveThreejToken(token);
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status || 400 });
  }

  const username = String(resolved.data?.username || '').trim();
  const password = String(resolved.data?.password || '').trim();
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'Resolved IPTV credentials were incomplete.' }, { status: 502 });
  }

  const settings = await getPublicSettings();
  const servers = await getXuioneServersForRequest({ req, settings, resolved: resolved.data });
  const chosen = pickConfiguredServer(servers);
  const serverOrigin = chosen?.origin || normalizeOrigin(resolved.data?.xui_base_url || resolved.data?.xui_server_host || '');
  if (!serverOrigin) {
    return NextResponse.json({ ok: false, error: 'No IPTV stream server is configured.' }, { status: 500 });
  }

  // The 3J hotspot API has already verified that this token belongs to an active,
  // provisioned IPTV line. Do not block the customer handoff on an extra XUI
  // precheck here; upstream playback/catalog calls will surface XUI outages.
  const userInfo = { status: 'Active' };

  const streamBase = buildStreamBase(serverOrigin, username, password);
  const session = {
    user: {
      username,
      status: userInfo?.status || 'Active',
      displayName: resolved.data?.customer?.display_name || '',
      productName: resolved.data?.product_name || '',
    },
    streamBase,
    server: serverOrigin.endsWith('/') ? serverOrigin : `${serverOrigin}/`,
    remember,
    source: 'threej_hotspot_token',
    threejToken: token,
    accessExpiresAt: resolved.data?.access_expires_at || resolved.data?.expires_at || null,
    accountExpiresAt: resolved.data?.account_expires_at || null,
    productKind: resolved.data?.product_kind || 'IPTV',
  };

  return NextResponse.json({ ok: true, streamBase, session, xuiValidationWarning: null }, { status: 200 });
}

export async function POST(req) {
  return handle(req);
}

export async function GET() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
