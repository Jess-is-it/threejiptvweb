import { NextResponse } from 'next/server';
import { Agent } from 'undici';
import dns from 'node:dns/promises';
import net from 'node:net';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

const defaultDispatcher = new Agent({
  // Large VOD files can stream for many minutes; avoid undici body timeout cutting playback.
  bodyTimeout: 0,
});

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
  // Same as above, but for private/self-signed upstreams where TLS verification is relaxed.
  bodyTimeout: 0,
});

const PLAYLIST_CACHE_FRESH_MS = 5000;
const PLAYLIST_CACHE_STALE_MS = 30_000;

function getPlaylistCache() {
  if (!globalThis.__threejTvPlaylistCache) {
    globalThis.__threejTvPlaylistCache = new Map();
  }
  return globalThis.__threejTvPlaylistCache;
}

function playlistCacheKey(url = '', forcePlaylist = false) {
  return `${forcePlaylist ? 'playlist:' : 'hls:'}${String(url || '')}`;
}

function prunePlaylistCache(cache) {
  const cutoff = Date.now() - PLAYLIST_CACHE_STALE_MS;
  for (const [key, entry] of cache.entries()) {
    const ts = Number(entry?.ts || 0) || 0;
    if (!ts || ts < cutoff) cache.delete(key);
  }
}

function readPlaylistCache(cache, key, ttlMs) {
  const entry = cache?.get?.(key);
  const ts = Number(entry?.ts || 0) || 0;
  if (!entry || !ts) return null;
  if (Date.now() - ts > ttlMs) return null;
  return entry;
}

function playlistResponseFromCache(entry, { method = 'GET', cacheStatus = 'HIT' } = {}) {
  const headers = withCors({
    ...(entry?.headers || {}),
    'x-3jtv-playlist-cache': cacheStatus,
  });
  return new Response(method === 'HEAD' ? null : new Uint8Array(entry?.body || []), {
    status: Number(entry?.status || 200) || 200,
    headers,
  });
}

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

function redirectStatus(status = 0) {
  return [301, 302, 303, 307, 308].includes(Number(status || 0));
}

async function cancelBody(res) {
  try {
    await res?.body?.cancel?.();
  } catch {}
}

async function hostResolvesPrivate(hostname = '') {
  const host = String(hostname || '').trim();
  if (!host) return false;
  if (isPrivateIp(host)) return true;
  try {
    const a4 = await dns.lookup(host, { family: 4 }).catch(() => null);
    if (a4?.address && isPrivateIp(a4.address)) return true;
    const a6 = await dns.lookup(host, { family: 6 }).catch(() => null);
    if (a6?.address && isPrivateIp(a6.address)) return true;
  } catch {}
  return false;
}

async function rewriteRedirectLocation(location = '', fromUrl, preferPrivate = false) {
  const next = normalizeUpstreamUrl(new URL(String(location || ''), fromUrl));
  if (!preferPrivate) return next;
  try {
    if (await hostResolvesPrivate(next.hostname)) {
      const a4 = await dns.lookup(next.hostname, { family: 4 }).catch(() => null);
      if (a4?.address && isPrivateIp(a4.address)) {
        next.protocol = 'http:';
        next.hostname = a4.address;
        if (!next.port) next.port = fromUrl.port || '';
        return next;
      }
      const a6 = await dns.lookup(next.hostname, { family: 6 }).catch(() => null);
      if (a6?.address && isPrivateIp(a6.address)) {
        const port = next.port ? `:${next.port}` : '';
        return normalizeUpstreamUrl(new URL(`http://[${a6.address}]${port}${next.pathname}${next.search}${next.hash}`));
      }
    }
  } catch {}
  return next;
}

async function fetchWithRedirects(url, opts, { preferPrivateRedirect = false, maxHops = 5 } = {}) {
  let current = normalizeUpstreamUrl(new URL(url));
  let lastResponse = null;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const insecureTls = await allowInsecureTlsFor(current);
    const response = await fetch(current.toString(), {
      ...opts,
      redirect: 'manual',
      dispatcher: insecureTls ? insecureDispatcher : defaultDispatcher,
    });
    lastResponse = response;
    if (!redirectStatus(response.status)) {
      return { response, finalUrl: current.toString() };
    }
    const location = response.headers.get('location') || '';
    if (!location) return { response, finalUrl: current.toString() };
    // We won't use this redirect response body; avoid holding resources open.
    await cancelBody(response);
    current = await rewriteRedirectLocation(location, current, preferPrivateRedirect);
  }
  return { response: lastResponse, finalUrl: current.toString() };
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
    'cache-control': 'no-store, no-transform',
  };
}

function sameOriginRedirect(url, status = 307) {
  const target = url instanceof URL ? url : new URL(String(url || ''), 'http://localhost');
  return new Response(null, {
    status,
    headers: withCors({
      location: `${target.pathname}${target.search}`,
    }),
  });
}

function sanitizeAcceptRanges(value = '', { hasContentRange = false } = {}) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'bytes') return 'bytes';
  if (hasContentRange) return 'bytes';
  return '';
}

function isM3u8Url(upstream) {
  try {
    const u = upstream instanceof URL ? upstream : new URL(String(upstream || ''));
    const path = String(u.pathname || '').toLowerCase();
    if (path.endsWith('.m3u8')) return true;
    const hintedExt = String(
      u.searchParams.get('extension') || u.searchParams.get('format') || u.searchParams.get('type') || ''
    )
      .trim()
      .toLowerCase();
    if (hintedExt === 'm3u8') return true;
    // Some panels embed `.m3u8` before query-string in non-standard URLs.
    if (/\.m3u8($|\?)/i.test(u.toString())) return true;
  } catch {}
  return false;
}

function isPlaylistContentType(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return false;
  return (
    raw.includes('application/vnd.apple.mpegurl') ||
    raw.includes('application/x-mpegurl') ||
    raw.includes('audio/mpegurl') ||
    raw.includes('audio/x-mpegurl')
  );
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

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function streamFromReader(reader, { firstChunk = null, firstDone = false } = {}) {
  return new ReadableStream({
    start(controller) {
      if (firstChunk?.byteLength) controller.enqueue(firstChunk);
      if (firstDone) {
        controller.close();
        return;
      }
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      };
      pump();
    },
    cancel() {
      try {
        reader.cancel();
      } catch {}
    },
  });
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
  const forcePlaylist = searchParams.get('playlist') === '1';
  const stabilized = searchParams.get('stabilized') === '1';
  const rootUrl = searchParams.get('root') || '';

  let upstream;
  try {
    upstream = normalizeUpstreamUrl(new URL(url));
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid url' }, { status: 400 });
  }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    return NextResponse.json({ ok: false, error: 'Invalid protocol' }, { status: 400 });
  }

  const playlistHint = forcePlaylist || isM3u8Url(upstream);
  const playlistCache = playlistHint ? getPlaylistCache() : null;
  const playlistKey = playlistHint ? playlistCacheKey(upstream.toString(), forcePlaylist) : '';
  const getStalePlaylistResponse = (cacheStatus) => {
    if (!playlistCache || !playlistKey) return null;
    prunePlaylistCache(playlistCache);
    const cached = readPlaylistCache(playlistCache, playlistKey, PLAYLIST_CACHE_STALE_MS);
    return cached ? playlistResponseFromCache(cached, { method: req.method, cacheStatus }) : null;
  };

  if (playlistCache && playlistKey) {
    prunePlaylistCache(playlistCache);
    const cached = readPlaylistCache(playlistCache, playlistKey, PLAYLIST_CACHE_FRESH_MS);
    if (cached) return playlistResponseFromCache(cached, { method: req.method, cacheStatus: 'HIT' });
  }

  const range = req.headers.get('range') || '';
  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
  const preferPrivateRedirect = await hostResolvesPrivate(upstream.hostname);
  let r;
  let finalUrl = upstream.toString();
  const candidates = mirrorCandidates(upstream.toString());
  const opts = {
    method,
    cache: 'no-store',
    headers: {
      ...(range ? { range } : {}),
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      accept: '*/*',
      'accept-encoding': 'identity',
      'accept-language': 'en-US,en;q=0.7',
      referer: upstream.origin + '/',
    },
  };

  try {
    let last;
    for (const c of candidates.length ? candidates : [upstream]) {
      try {
        const result = await fetchWithRedirects(c.toString(), opts, { preferPrivateRedirect });
        const resp = result.response;
        last = result;
        // Retry other mirrors only on 5xx (panel hiccups) or upstream timeouts (caught below)
        if (resp.status >= 500) {
          await cancelBody(resp);
          continue;
        }
        r = resp;
        finalUrl = result.finalUrl || c.toString();
        break;
      } catch (e) {
        last = e;
      }
    }

    if (!r) {
      if (last?.response instanceof Response) {
        r = last.response;
        finalUrl = last.finalUrl || finalUrl;
      }
      else throw last;
    }
  } catch (e) {
    const stale = getStalePlaylistResponse('STALE_FETCH');
    if (stale) return stale;
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || 'Upstream fetch failed',
        upstream: upstream.toString(),
        finalUrl,
        preferPrivateRedirect,
      },
      { status: 502, headers: withCors({}) }
    );
  }

  // m3u8 needs rewriting so segments also go through the proxy
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  // IMPORTANT: Do not classify as m3u8 purely by content-type and immediately call `r.text()`.
  // Some upstreams mislabel binary data. We only use the content-type to decide whether it is worth
  // sniffing the first chunk for `#EXTM3U`.
  const isM3u8 = forcePlaylist || isM3u8Url(upstream) || isPlaylistContentType(ct);

  // If an old stabilized tokenized playlist expires, jump back to the root manifest so we can acquire a fresh token.
  if (
    method !== 'HEAD' &&
    stabilized &&
    rootUrl &&
    forcePlaylist &&
    (r.status === 404 || ct.includes('text/html'))
  ) {
    const stale = getStalePlaylistResponse('STALE_EXPIRED');
    if (stale) return stale;
    await cancelBody(r);
    const next = new URL(req.url);
    next.searchParams.set('url', rootUrl);
    next.searchParams.delete('playlist');
    next.searchParams.delete('stabilized');
    next.searchParams.delete('root');
    return sameOriginRedirect(next, 307);
  }

  if (isM3u8) {
    // SAFETY: some upstreams serve an endless binary stream at a `.m3u8` URL (or return HTML on errors).
    // Never read the whole body as text unless we positively detect a real playlist header.
    if (method === 'HEAD') {
      return new Response(null, {
        status: r.status,
        headers: withCors({
          'content-type': r.headers.get('content-type') || 'application/vnd.apple.mpegurl',
        }),
      });
    }

    const body = r.body;
    if (!body) {
      return new Response('', {
        status: r.status,
        headers: withCors({ 'content-type': 'application/vnd.apple.mpegurl; charset=utf-8' }),
      });
    }

    const reader = body.getReader();
    const first = await reader.read();
    const firstChunk = first?.value instanceof Uint8Array ? first.value : new Uint8Array();

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const firstText = decoder.decode(firstChunk);
    const startsPlaylist = String(firstText || '').trimStart().startsWith('#EXTM3U');
    const looksHtml =
      ct.includes('text/html') || /^\s*</.test(String(firstText || '')) || /<html/i.test(String(firstText || ''));

    // If this is not actually a playlist, stream bytes through as binary (prevents OOM).
    if (!startsPlaylist || looksHtml) {
      if (looksHtml) {
        let extra = '';
        try {
          const next = await reader.read();
          extra = decoder.decode(next?.value || new Uint8Array());
        } catch {}
        try {
          await reader.cancel();
        } catch {}
        const stale = getStalePlaylistResponse('STALE_HTML');
        if (stale) return stale;
        return NextResponse.json(
          {
            ok: false,
            error: 'Upstream HLS manifest resolved to HTML instead of a playlist.',
            upstream: upstream.toString(),
            finalUrl,
            status: r.status,
            snippet: (firstText + extra).slice(0, 200),
          },
          { status: r.status >= 400 ? r.status : 502, headers: withCors({}) }
        );
      }

      const passthrough = streamFromReader(reader, {
        firstChunk,
        firstDone: Boolean(first?.done),
      });

      const headers = withCors({
        'content-type': r.headers.get('content-type') || 'application/octet-stream',
      });
      const cr = r.headers.get('content-range');
      if (cr) headers['content-range'] = cr;
      const ar = sanitizeAcceptRanges(r.headers.get('accept-ranges') || '', { hasContentRange: Boolean(cr) });
      if (ar) headers['accept-ranges'] = ar;
      return new Response(passthrough, { status: r.status, headers });
    }

    // It's a real playlist; read up to a sane limit and rewrite.
    const chunks = [firstChunk];
    let total = firstChunk.byteLength;
    const MAX_PLAYLIST_BYTES = 1024 * 1024; // 1 MiB cap; playlists should be tiny.
    while (!first?.done) {
      const next = await reader.read();
      if (next?.value) {
        chunks.push(next.value);
        total += next.value.byteLength;
        if (total > MAX_PLAYLIST_BYTES) {
          try {
            await reader.cancel();
          } catch {}
          const stale = getStalePlaylistResponse('STALE_LARGE');
          if (stale) return stale;
          return NextResponse.json(
            {
              ok: false,
              error: 'Upstream playlist is unexpectedly large; refusing to buffer it in memory.',
              upstream: upstream.toString(),
              finalUrl,
              status: r.status,
            },
            { status: 502, headers: withCors({}) }
          );
        }
      }
      if (next?.done) break;
    }
    const playlistText = decoder.decode(concatChunks(chunks, total));
    const rewritten = rewritePlaylist(playlistText, finalUrl || r.url || upstream.toString());
    const encoded = new TextEncoder().encode(rewritten);
    const cachedEntry = {
      status: r.status,
      ts: Date.now(),
      body: encoded,
      headers: {
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'content-length': String(encoded.byteLength),
      },
    };
    if (playlistCache && playlistKey && r.ok) {
      playlistCache.set(playlistKey, cachedEntry);
    }
    return playlistResponseFromCache(cachedEntry, { method, cacheStatus: 'MISS' });
  }

  // Binary passthrough (segments, keys, etc.)
  const headers = withCors({
    'content-type': r.headers.get('content-type') || 'application/octet-stream',
  });
  const cr = r.headers.get('content-range');
  if (cr) headers['content-range'] = cr;
  const ar = sanitizeAcceptRanges(r.headers.get('accept-ranges') || '', { hasContentRange: Boolean(cr) });
  if (ar) headers['accept-ranges'] = ar;
  const cl = r.headers.get('content-length');
  if (cl) headers['content-length'] = cl;
  if (method === 'HEAD') {
    await cancelBody(r);
    return new Response(null, { status: r.status, headers });
  }
  if (!r.body) return new Response(null, { status: r.status, headers });
  const reader = r.body.getReader();
  const body = streamFromReader(reader);
  return new Response(body, { status: r.status, headers });
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
