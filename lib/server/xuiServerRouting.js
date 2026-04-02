import 'server-only';

import dns from 'node:dns/promises';
import net from 'node:net';

function normalizeOrigin(raw = '') {
  try {
    const url = new URL(String(raw || '').trim());
    return `${url.origin}/`;
  } catch {
    return '';
  }
}

function uniqOrigins(list = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const origin = normalizeOrigin(raw?.origin || raw);
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
    if (isPrivateIp(host)) {
      upstream.protocol = 'http:';
      return `${upstream.origin}/`;
    }

    const ipv4 = await dns.lookup(host, { family: 4 }).catch(() => null);
    if (ipv4?.address && isPrivateIp(ipv4.address)) {
      const port = upstream.port ? `:${upstream.port}` : '';
      return `http://${ipv4.address}${port}/`;
    }

    const ipv6 = await dns.lookup(host, { family: 6 }).catch(() => null);
    if (ipv6?.address && isPrivateIp(ipv6.address)) {
      const port = upstream.port ? `:${upstream.port}` : '';
      return `http://[${ipv6.address}]${port}/`;
    }
  } catch {}
  return '';
}

export async function getXuioneServersForRequest({ req, settings } = {}) {
  const configured = uniqOrigins(settings?.xuione?.servers || []);
  if (!configured.length) return [];
  if (!requestLooksLocal(req)) return configured;

  const mapped = [];
  for (const row of configured) {
    const privateOrigin = await resolvePrivateOrigin(row.origin);
    if (privateOrigin) mapped.push({ origin: privateOrigin });
  }

  return uniqOrigins(mapped.length ? mapped : configured);
}
