// app/api/xuione/_shared.js

// --- Utils --------------------------------------------------------------

import { Agent } from 'undici';
import dns from 'node:dns/promises';
import net from 'node:net';

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

function isPrivateIp(ip) {
  if (!ip) return false;
  const fam = net.isIP(ip);
  if (!fam) return false;
  if (fam === 4) {
    const [a, b] = ip.split('.').map((x) => Number(x));
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 127) return true;
    return false;
  }
  const s = String(ip).toLowerCase();
  return s === '::1' || s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd');
}

async function allowInsecureTlsFor(upstreamUrl) {
  if (String(process.env.ALLOW_INSECURE_UPSTREAM_TLS || '').toLowerCase() === 'true') return true;
  try {
    const u = new URL(upstreamUrl);
    if (u.protocol !== 'https:') return false;

    // Allow insecure TLS only if the hostname resolves to a private IP (LAN/self-signed certs).
    const a4 = await dns.lookup(u.hostname, { family: 4 }).catch(() => null);
    if (a4?.address && isPrivateIp(a4.address)) return true;
    const a6 = await dns.lookup(u.hostname, { family: 6 }).catch(() => null);
    if (a6?.address && isPrivateIp(a6.address)) return true;
  } catch {}
  return false;
}

export function parseStreamBase(streamBase = '') {
  try {
    const u = new URL(streamBase);
    const parts = u.pathname.split('/').filter(Boolean); // e.g. ["live","user","pass"]
    const i = parts.indexOf('live');
    const username = parts[i + 1] || '';
    const password = parts[i + 2] || '';
    const server = `${u.origin}/`;
    if (!username || !password) throw new Error('Invalid streamBase');
    return { server, username, password };
  } catch {
    throw new Error('Invalid streamBase');
  }
}

/**
 * Generate mirror candidates, e.g. https://tv2.3jxentro.net/ -> tv2, tv1..tv6
 * Original first, then other tvN hosts.
 */
function mirrorServers(originalOrigin) {
  const u = new URL(originalOrigin);
  const m = u.hostname.match(/^tv(\d+)\.(.+)$/i);
  if (!m) return [originalOrigin]; // unknown pattern: just use original

  const current = Number(m[1]);
  const domain = m[2];
  const build = (n) => `${u.protocol}//tv${n}.${domain}/`;

  const list = [build(current)];
  for (let n = 1; n <= 6; n++) if (n !== current) list.push(build(n));
  return list;
}

/**
 * Fetch Xtream endpoint and force JSON. If panel returns HTML/garbage, throw.
 */
async function xtreamOnce({ server, username, password, action, extra = {} }) {
  const url = new URL('player_api.php', server);
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  if (action) url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(extra || {})) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }

  const insecureTls = await allowInsecureTlsFor(url.toString());
  const r = await fetch(url.toString(), {
    cache: 'no-store',
    redirect: 'follow',
    ...(insecureTls ? { dispatcher: insecureDispatcher } : {}),
    headers: {
      // be more “browser-y” – some panels behave differently
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.7',
    },
  });

  const ct = r.headers.get('content-type') || '';
  const text = await r.text().catch(() => '');

  if (!r.ok) {
    const brief = (text || '').slice(0, 200);
    throw new Error(`Xuione ${r.status} ${r.statusText}${brief ? ` — ${brief}` : ''}`);
  }

  // Some panels incorrectly set content-type; try JSON parse anyway
  try {
    return JSON.parse(text);
  } catch {
    const brief = (text || '').slice(0, 200);
    throw new Error(
      `Xuione returned non-JSON (${ct || 'unknown'}). First bytes: ${brief}`
    );
  }
}

/**
 * Try original host first, then tv1..tv6 mirrors until one returns JSON.
 */
export async function xtreamWithFallback({ server, username, password, action, extra = {} }) {
  const candidates = mirrorServers(server);
  let lastErr;

  for (const base of candidates) {
    try {
      return await xtreamOnce({ server: base, username, password, action, extra });
    } catch (e) {
      lastErr = e;
      // try next mirror
    }
  }

  throw lastErr || new Error('All Xuione mirrors failed');
}
