import { NextResponse } from 'next/server';
import { Agent } from 'undici';
import dns from 'node:dns/promises';
import net from 'node:net';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const defaultDispatcher = new Agent({
  // Large VOD files can stream for many minutes; avoid undici body timeout cutting playback.
  bodyTimeout: 0,
});

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
  // Same as above, but for private/self-signed upstreams where TLS verification is relaxed.
  bodyTimeout: 0,
});

function normalizeUpstreamUrl(u) {
  try {
    if (!u || !(u instanceof URL)) return u;
    // Some panels emit absolute `http://tvN...` URLs inside playlists even though the host only serves HTTPS.
    // Fetching those over plain HTTP can yield 404/HTML and eventually break long-running live playback.
    if (u.protocol === 'http:' && u.hostname.toLowerCase().endsWith('.3jxentro.net')) {
      u.protocol = 'https:';
      u.port = '';
    }
  } catch {}
  return u;
}

function mirrorCandidates(urlStr) {
  try {
    const u = normalizeUpstreamUrl(new URL(urlStr));
    const m = u.hostname.match(/^tv(\d+)\.(.+)$/i);
    if (!m) return [u];
    const current = Number(m[1]);
    const domain = m[2];
    const list = [];
    const build = (n) => {
      const x = new URL(u.toString());
      x.hostname = `tv${n}.${domain}`;
      return x;
    };
    list.push(build(current));
    for (let n = 1; n <= 6; n++) if (n !== current) list.push(build(n));
    return list;
  } catch {
    return [];
  }
}

function withCors(headers = {}) {
  return {
    ...headers,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,HEAD,OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': '*',
    'cache-control': 'no-store',
  };
}

function rewritePlaylist(text, upstreamUrl) {
  const base = normalizeUpstreamUrl(new URL(upstreamUrl));
  const lines = String(text || '').split(/\r?\n/);

  const out = lines.map((line) => {
    const s = String(line || '');
    if (!s.trim()) return s;

    // Rewrite URI="..." attributes (KEY, MAP, MEDIA, etc.)
    if (s.startsWith('#') && /URI=\"/i.test(s)) {
      return s.replace(/URI=\"([^\"]+)\"/gi, (_m, uri) => {
        try {
          const abs = normalizeUpstreamUrl(new URL(uri, base)).toString();
          const prox = `/api/proxy/hls?url=${encodeURIComponent(abs)}`;
          return `URI="${prox}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
    }

    // Non-comment resource line (segment or variant)
    if (!s.startsWith('#')) {
      try {
        const abs = normalizeUpstreamUrl(new URL(s.trim(), base)).toString();
        return `/api/proxy/hls?url=${encodeURIComponent(abs)}`;
      } catch {
        return s;
      }
    }

    return s;
  });

  return out.join('\n');
}

function isPrivateIp(ip) {
  if (!ip) return false;
  const fam = net.isIP(ip);
  if (!fam) return false;
  // IPv4 private ranges
  if (fam === 4) {
    const [a, b] = ip.split('.').map((x) => Number(x));
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 127) return true;
    return false;
  }
  // IPv6 loopback/link-local/ULA
  const s = String(ip).toLowerCase();
  return s === '::1' || s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd');
}

async function allowInsecureTlsFor(upstream) {
  if (String(process.env.ALLOW_INSECURE_UPSTREAM_TLS || '').toLowerCase() === 'true') return true;
  // Only allow automatically when the hostname resolves to a private IP (LAN/self-signed certs).
  if (upstream.protocol !== 'https:') return false;
  try {
    const a4 = await dns.lookup(upstream.hostname, { family: 4 }).catch(() => null);
    if (a4?.address && isPrivateIp(a4.address)) return true;
    const a6 = await dns.lookup(upstream.hostname, { family: 6 }).catch(() => null);
    if (a6?.address && isPrivateIp(a6.address)) return true;
  } catch {}
  return false;
}

async function proxy(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url') || '';

  let upstream;
  try {
    upstream = normalizeUpstreamUrl(new URL(url));
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid url' }, { status: 400 });
  }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    return NextResponse.json({ ok: false, error: 'Invalid protocol' }, { status: 400 });
  }

  const range = req.headers.get('range') || '';
  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
  const insecureTls = await allowInsecureTlsFor(upstream);
  let r;
  try {
    const candidates = mirrorCandidates(upstream.toString());
    const dispatcher = insecureTls ? insecureDispatcher : defaultDispatcher;
    const opts = {
      method,
      dispatcher,
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        ...(range ? { range } : {}),
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.7',
        referer: upstream.origin + '/',
      },
    };

    let last;
    for (const c of candidates.length ? candidates : [upstream]) {
      try {
        const resp = await fetch(c.toString(), opts);
        last = resp;
        // Retry other mirrors only on 5xx (panel hiccups) or upstream timeouts (caught below)
        if (resp.status >= 500) continue;
        r = resp;
        break;
      } catch (e) {
        last = e;
      }
    }

    if (!r) {
      if (last instanceof Response) r = last;
      else throw last;
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || 'Upstream fetch failed',
        upstream: upstream.toString(),
        insecureTls,
      },
      { status: 502, headers: withCors({}) }
    );
  }

  // m3u8 needs rewriting so segments also go through the proxy
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const isM3u8 = upstream.pathname.toLowerCase().endsWith('.m3u8') || ct.includes('mpegurl');

  if (isM3u8) {
    const text = await r.text().catch(() => '');
    const rewritten = rewritePlaylist(text, r.url || upstream.toString());
    return new Response(method === 'HEAD' ? null : rewritten, {
      status: r.status,
      headers: withCors({
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
      }),
    });
  }

  // Binary passthrough (segments, keys, etc.)
  const headers = withCors({
    'content-type': r.headers.get('content-type') || 'application/octet-stream',
  });
  const cl = r.headers.get('content-length');
  if (cl) headers['content-length'] = cl;
  const cr = r.headers.get('content-range');
  if (cr) headers['content-range'] = cr;
  const ar = r.headers.get('accept-ranges');
  if (ar) headers['accept-ranges'] = ar;

  return new Response(method === 'HEAD' ? null : r.body, { status: r.status, headers });
}

export async function GET(req) {
  return proxy(req);
}

export async function HEAD(req) {
  return proxy(req);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: withCors() });
}
