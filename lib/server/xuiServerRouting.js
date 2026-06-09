import 'server-only';

import dns from 'node:dns/promises';
import net from 'node:net';

import { getXuiIntegrationSafe } from './autodownload/xuiService';

const DEFAULT_PUBLIC_XUI_ORIGIN = 'https://xui.3jhotspot.com/';
const RETIRED_XUI_HOST_RE = /^tv\d+\.3jxentro\.net$/i;

function normalizeOrigin(raw = '') {
  try {
    const url = new URL(String(raw || '').trim());
    return `${url.origin}/`;
  } catch {
    return '';
  }
}

function publicXuiOrigin() {
  return (
    normalizeOrigin(process.env.XUI_PUBLIC_URL) ||
    normalizeOrigin(process.env.XUI_PUBLIC_BASE_URL) ||
    normalizeOrigin(process.env.NEXT_PUBLIC_XUI_PUBLIC_URL) ||
    DEFAULT_PUBLIC_XUI_ORIGIN
  );
}

function normalizeRetiredXuiOrigin(origin = '') {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (RETIRED_XUI_HOST_RE.test(url.hostname)) return publicXuiOrigin();
  } catch {}
  return normalized;
}

function uniqOrigins(list = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const origin = normalizeRetiredXuiOrigin(raw?.origin || raw);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    out.push({ origin });
  }
  return out;
}

function isPrivateIp(ip = '') {
  if (!ip) return false;
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 4) {
    const [a, b] = String(ip).split('.').map((part) => Number(part));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  const value = String(ip).toLowerCase();
  return value === '::1' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd');
}

function parseForwardedFor(value = '') {
  return String(value || '')
    .split(',')
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => part.replace(/^\[|\]$/g, '').split(':')[0]);
}

function parseForwardedHeader(value = '') {
  const out = [];
  const rows = String(value || '').split(',');
  for (const row of rows) {
    const match = row.match(/for="?([^;"]+)"?/i);
    if (!match) continue;
    out.push(String(match[1] || '').replace(/^\[|\]$/g, '').split(':')[0]);
  }
  return out;
}

function hostLooksLocal(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return false;
  const host = raw.replace(/^\[|\]$/g, '').split(':')[0];
  return host === 'localhost' || host.endsWith('.local') || isPrivateIp(host);
}

function originUsesPrivateHost(origin = '') {
  try {
    const url = new URL(normalizeOrigin(origin));
    return isPrivateIp(url.hostname);
  } catch {
    return false;
  }
}

function canConnect(host, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    let settled = false;
    function done(value) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    }
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function requestLooksLocal(req) {
  const headers = req?.headers;
  const candidates = [
    ...parseForwardedFor(headers?.get?.('x-forwarded-for') || ''),
    ...parseForwardedHeader(headers?.get?.('forwarded') || ''),
    String(headers?.get?.('x-real-ip') || '').trim(),
    String(headers?.get?.('cf-connecting-ip') || '').trim(),
  ].filter(Boolean);
  if (candidates.some((ip) => isPrivateIp(ip))) return true;
  return hostLooksLocal(headers?.get?.('host') || '');
}

async function resolvePrivateOrigin(origin = '') {
  try {
    const upstream = new URL(normalizeOrigin(origin));
    const host = String(upstream.hostname || '').trim();
    if (!host) return '';
    const upstreamPort = Number(upstream.port || (upstream.protocol === 'https:' ? 443 : 80));

    if (isPrivateIp(host)) {
      const reachable = await canConnect(host, upstreamPort);
      if (!reachable && upstreamPort !== 80) return '';
      if (!reachable && !(await canConnect(host, 80))) return '';
      upstream.protocol = 'http:';
      return `${upstream.origin}/`;
    }

    const ipv4 = await dns.lookup(host, { family: 4 }).catch(() => null);
    if (ipv4?.address && isPrivateIp(ipv4.address)) {
      const mappedPort = upstream.port ? Number(upstream.port) : (upstream.protocol === 'https:' ? 443 : 80);
      const reachable = await canConnect(ipv4.address, mappedPort);
      if (!reachable) return '';
      return `${upstream.origin}/`;
    }

    const ipv6 = await dns.lookup(host, { family: 6 }).catch(() => null);
    if (ipv6?.address && isPrivateIp(ipv6.address)) {
      const mappedPort = upstream.port ? Number(upstream.port) : (upstream.protocol === 'https:' ? 443 : 80);
      const reachable = await canConnect(ipv6.address, mappedPort);
      if (!reachable) return '';
      return `${upstream.origin}/`;
    }
  } catch {}
  return '';
}

export async function getXuioneServersForRequest({ req, settings, resolved } = {}) {
  const localRequest = requestLooksLocal(req);
  const integration = await getXuiIntegrationSafe().catch(() => null);
  const resolvedPublic = normalizeOrigin(resolved?.xui_public_url || resolved?.xuiPublicUrl || '');
  const resolvedPrivate = normalizeOrigin(resolved?.xui_base_url || resolved?.xuiBaseUrl || resolved?.xui_server_host || resolved?.xuiServerHost || '');
  const integrationPublic = normalizeOrigin(integration?.publicBaseUrl || '');
  const integrationPrivate = normalizeOrigin(integration?.baseUrl || '');

  const candidates = [];
  if (localRequest) {
    candidates.push(resolvedPublic, integrationPublic, resolvedPrivate, integrationPrivate);
  } else {
    // Outside customer browsers cannot reach private 10.x/192.168.x XUI origins.
    // Keep outside playback on the configured Cloudflare XUI tunnel only.
    candidates.push(resolvedPublic, integrationPublic);
  }
  candidates.push(...(Array.isArray(settings?.xuione?.servers) ? settings.xuione.servers : []));

  const configured = uniqOrigins(candidates);
  if (!configured.length) return [];
  if (!localRequest) return configured;

  const publicConfigured = configured.filter((row) => !originUsesPrivateHost(row.origin));
  if (publicConfigured.length) return publicConfigured;

  const mapped = [];
  for (const row of configured) {
    const privateOrigin = await resolvePrivateOrigin(row.origin);
    if (privateOrigin) mapped.push({ origin: privateOrigin });
  }

  // Preserve configured hostnames first. Split-horizon DNS keeps those hostnames local
  // without breaking XUI virtual-host/TLS expectations; raw private-IP rewrites are only fallback.
  return uniqOrigins([...configured, ...mapped]);
}
