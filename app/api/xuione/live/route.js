import { NextResponse } from 'next/server';
import { allowInsecureTlsFor, insecureDispatcher, parseStreamBase, xtreamWithFallback } from '../_shared';
import { xuiApiCall } from '../../../../lib/server/autodownload/xuiService';
import { getSecret, secretKeys } from '../../../../lib/server/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Keep probes very fresh so stopped streams disappear quickly from the Live page.
// This TTL is intentionally short; the route also limits concurrency.
const PROBE_TIMEOUT_MS = 1200;
const PROBE_TTL_MS = 12 * 1000;
const PROBE_CONCURRENCY = 6;
const LIVE_CATALOG_CACHE_MS = 30_000;

function getLiveCatalogCache() {
  if (!globalThis.__threejTvLiveCatalogCache) {
    globalThis.__threejTvLiveCatalogCache = { ts: 0, value: null };
  }
  return globalThis.__threejTvLiveCatalogCache;
}

function readLiveCatalogCache() {
  const cache = getLiveCatalogCache();
  const ts = Number(cache?.ts || 0) || 0;
  if (!cache?.value || !ts) return null;
  if (Date.now() - ts > LIVE_CATALOG_CACHE_MS) return null;
  return cache.value;
}

function writeLiveCatalogCache(value) {
  globalThis.__threejTvLiveCatalogCache = {
    ts: Date.now(),
    value,
  };
}

function sanitizeLogoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Browsers will refuse `file://` (and it spams the console).
  if (raw.toLowerCase().startsWith('file://')) return '';
  // Windows paths like `S:\images\...` occasionally leak via XUI icons.
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return '';
  // XUI sometimes leaks pseudo-paths like `s:1:/images/...`; Windows browsers coerce these into
  // `file:///S:/...` requests that fail noisily in the console.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(raw) && !/^(https?:|data:image\/)/i.test(raw)) return '';
  return raw;
}

function normalizeSourceList(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        return entry.url || entry.source || entry.stream_source || entry.direct_source || '';
      }
      return '';
    })
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function parseStreamStatus(value) {
  if (value === null || value === undefined || value === '') return { statusNum: null, isUp: null };
  const n = Number(value);
  if (Number.isFinite(n)) {
    // Xtream/XtreamCodes live status is usually 1=up, 0=down (when present).
    // We may override with XUI Admin statuses later, if configured.
    return { statusNum: n, isUp: n === 1 };
  }
  const s = String(value).trim().toLowerCase();
  if (!s) return { statusNum: null, isUp: null };
  if (['up', 'online', 'running', 'live', 'ok', 'active', 'on'].includes(s)) return { statusNum: 1, isUp: true };
  if (['down', 'offline', 'stopped', 'stop', 'dead', 'fail', 'error', 'off'].includes(s)) return { statusNum: 0, isUp: false };
  return { statusNum: null, isUp: null };
}

function parseCategoryIds(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map((x) => String(x ?? '').trim()).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
  } catch {}
  // Fallback: "[1,2]" or "1,2"
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^\"|\"$/g, ''))
    .filter(Boolean);
}

async function readXuiAdminStreamStatusMap() {
  // Optional: if XUI Admin API integration is configured, use it to decide UP/DOWN.
  // On this deployment, XUI Admin reports `stream_status=0` for playable streams and `1` for DOWN.
  try {
    const payload = await xuiApiCall({ action: 'get_streams' });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const map = new Map();
    for (const r of rows) {
      const id = String(r?.id ?? r?.stream_id ?? '').trim();
      if (!id) continue;
      const n = Number(r?.stream_status);
      if (!Number.isFinite(n)) continue;
      map.set(id, n);
    }
    return map;
  } catch {
    return null;
  }
}

async function readXuiAdminLiveCatalog() {
  // First preference: plaintext Admin Secrets (portable and not tied to AutoDownload encrypted vault).
  try {
    const keys = secretKeys();
    const baseUrl = String(await getSecret(keys.xuiAdminBaseUrl)).trim();
    const accessCode = String(await getSecret(keys.xuiAdminAccessCode)).trim();
    const apiKey = String(await getSecret(keys.xuiAdminApiKey)).trim();
    if (baseUrl && accessCode && apiKey) {
      const origin = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).origin;
      const url = new URL(`${origin.replace(/\/+$/, '')}/${encodeURIComponent(accessCode)}/`);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('action', 'get_streams');
      const insecureTls = await allowInsecureTlsFor(url.toString());
      const r = await fetch(url.toString(), {
        cache: 'no-store',
        redirect: 'follow',
        ...(insecureTls ? { dispatcher: insecureDispatcher } : {}),
      });
      const text = await r.text().catch(() => '');
      if (!r.ok) throw new Error(`XUI Admin ${r.status}: ${text.slice(0, 200)}`);
      const payload = JSON.parse(text);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      if (!rows.length) return null;

      const catSet = new Set();
      const channels = rows
        .map((r2) => {
          const id = String(r2?.id ?? r2?.stream_id ?? '').trim();
          if (!id) return null;
          const name = String(r2?.stream_display_name || r2?.name || `CH ${id}`).trim();
          const icon = sanitizeLogoUrl(r2?.stream_icon);
          const sources = normalizeSourceList(r2?.stream_source || r2?.streamSource || r2?.sources);
          const cats = parseCategoryIds(r2?.category_id ?? r2?.categoryId);
          for (const c of cats) catSet.add(String(c));
          const rawStatus = r2?.stream_status ?? r2?.streamStatus ?? r2?.status ?? null;
          const statusNum = Number(rawStatus);
          const xuiStreamStatus = Number.isFinite(statusNum) ? statusNum : null;
          // XUI `stream_status` is not reliable enough (some stopped streams still show status=0).
          // `pid` is the best signal we have:
          // - running streams: pid is a positive number
          // - stopped/broken streams: pid is null/empty or -1
          const pidNum = Number(r2?.pid);
          const isUp = Number.isFinite(pidNum) && pidNum > 0;

          return {
            id,
            name,
            logo: icon,
            number: r2?.num ?? r2?.order ?? null,
            category_id: cats[0] || '',
            ext: 'm3u8',
            streamType: 'live',
            directSource: '',
            streamSources: sources,
            streamStatus: null,
            isUp,
            xuiStreamStatus,
            xuiPid: Number.isFinite(pidNum) ? pidNum : null,
          };
        })
        .filter(Boolean)
        .filter((ch) => ch.isUp === true);

      const categories = Array.from(catSet).map((id) => ({ id: String(id), name: `Category ${id}` }));
      return { categories, channels };
    }
  } catch {
    // fall through
  }

  try {
    const payload = await xuiApiCall({ action: 'get_streams' });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) return null;

    const catSet = new Set();
    const channels = rows
      .map((r) => {
        const id = String(r?.id ?? r?.stream_id ?? '').trim();
        if (!id) return null;
        const name = String(r?.stream_display_name || r?.name || `CH ${id}`).trim();
        const icon = sanitizeLogoUrl(r?.stream_icon);
        const sources = normalizeSourceList(r?.stream_source || r?.streamSource || r?.sources);
        const cats = parseCategoryIds(r?.category_id ?? r?.categoryId);
        for (const c of cats) catSet.add(String(c));
        const rawStatus = r?.stream_status ?? r?.streamStatus ?? r?.status ?? null;
        const statusNum = Number(rawStatus);
        const xuiStreamStatus = Number.isFinite(statusNum) ? statusNum : null;
        const pidNum = Number(r?.pid);
        const isUp = Number.isFinite(pidNum) && pidNum > 0;

        return {
          id,
          name,
          logo: icon,
          number: r?.num ?? r?.order ?? null,
          category_id: cats[0] || '',
          ext: 'm3u8',
          streamType: 'live',
          directSource: '',
          streamSources: sources,
          streamStatus: null,
          isUp,
          xuiStreamStatus,
          xuiPid: Number.isFinite(pidNum) ? pidNum : null,
        };
      })
      .filter(Boolean)
      // Filter out DOWN streams immediately (status=1).
      .filter((ch) => ch.isUp === true);

    const categories = Array.from(catSet).map((id) => ({ id: String(id), name: `Category ${id}` }));
    return { categories, channels };
  } catch {
    return null;
  }
}

async function hasXuiAdminConfigured() {
  const keys = secretKeys();
  const baseUrl = String(await getSecret(keys.xuiAdminBaseUrl)).trim();
  const accessCode = String(await getSecret(keys.xuiAdminAccessCode)).trim();
  const apiKey = String(await getSecret(keys.xuiAdminApiKey)).trim();
  return Boolean(baseUrl && accessCode && apiKey);
}

async function readSharedXtreamCatalogCreds() {
  const keys = secretKeys();
  const server = String(await getSecret(keys.xtreamLiveServer)).trim();
  const username = String(await getSecret(keys.xtreamLiveUsername)).trim();
  const password = String(await getSecret(keys.xtreamLivePassword)).trim();
  if (!server || !username || !password) return null;
  try {
    const origin = `${new URL(server).origin}/`;
    return { server: origin, username, password };
  } catch {
    return null;
  }
}

function getProbeCache() {
  if (!globalThis.__threejTvLiveProbeCache) globalThis.__threejTvLiveProbeCache = new Map();
  return globalThis.__threejTvLiveProbeCache;
}

function pruneProbeCache(cache) {
  const cutoff = Date.now() - PROBE_TTL_MS;
  for (const [k, v] of cache.entries()) {
    const ts = Number(v?.ts || 0) || 0;
    if (!ts || ts < cutoff) cache.delete(k);
  }
}

function normalizeLiveExt(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^\./, '');
}

function isHlsLikeSource(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/\.m3u8($|\?)/i.test(raw)) return true;
  try {
    const url = new URL(raw);
    const ext = normalizeLiveExt(
      url.searchParams.get('extension') || url.searchParams.get('format') || url.searchParams.get('type')
    );
    return ext === 'm3u8';
  } catch {
    return /(?:extension|format|type)=m3u8/i.test(raw);
  }
}

function sourceExtension(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const extFromQuery = normalizeLiveExt(
      url.searchParams.get('extension') || url.searchParams.get('format') || url.searchParams.get('type')
    );
    if (extFromQuery) return extFromQuery;
    const match = url.pathname.match(/\.([a-z0-9]+)$/i);
    return normalizeLiveExt(match?.[1] || '');
  } catch {
    const match = raw.match(/\.([a-z0-9]+)(?:$|\?)/i);
    return normalizeLiveExt(match?.[1] || '');
  }
}

function pickDirectSource(channel) {
  const candidates = [
    channel?.directSource,
    ...(Array.isArray(channel?.streamSources) ? channel.streamSources : []),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return candidates[0] || '';
}

function rebaseSourceOrigin(source = '', origin = '') {
  const rawSource = String(source || '').trim();
  const rawOrigin = String(origin || '').trim();
  if (!rawSource || !rawOrigin) return rawSource;
  try {
    const url = new URL(rawSource);
    return `${rawOrigin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawSource;
  }
}

async function probeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    // For HLS: verify EXT header quickly.
    if (isHlsLikeSource(raw)) {
      const r = await fetch(raw, {
        cache: 'no-store',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
          accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain;q=0.9,*/*;q=0.8',
        },
      });
      if (!r.ok) {
        try { r.body?.cancel?.(); } catch {}
        return false;
      }
      const text = await r.text();
      const playlist = String(text || '');
      if (!playlist.trimStart().startsWith('#EXTM3U')) return false;

      const lines = playlist.split('\n').map((l) => String(l || '').trim()).filter(Boolean);
      const baseUrl = (() => {
        try {
          return new URL(raw);
        } catch {
          return null;
        }
      })();

      const resolveRel = (u) => {
        const s = String(u || '').trim();
        if (!s) return '';
        if (/^https?:\/\//i.test(s)) return s;
        if (!baseUrl) return s;
        try {
          return new URL(s, baseUrl).toString();
        } catch {
          return s;
        }
      };

      const isMaster = lines.some((l) => /^#EXT-X-STREAM-INF/i.test(l));
      const isMedia = lines.some((l) => /^#EXTINF:/i.test(l));

      // If master playlist, fetch first variant and ensure it has media segments.
      if (isMaster) {
        // Find the first non-comment line after an EXT-X-STREAM-INF.
        for (let i = 0; i < lines.length - 1; i++) {
          if (!/^#EXT-X-STREAM-INF/i.test(lines[i])) continue;
          const candidate = lines[i + 1];
          if (!candidate || candidate.startsWith('#')) continue;
          const variantUrl = resolveRel(candidate);
          if (!variantUrl) break;
          const vr = await fetch(variantUrl, {
            cache: 'no-store',
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain;q=0.9,*/*;q=0.8' },
          });
          if (!vr.ok) {
            try { vr.body?.cancel?.(); } catch {}
            return false;
          }
          const vtext = await vr.text();
          const vlines = String(vtext || '').split('\n').map((l) => String(l || '').trim()).filter(Boolean);
          if (!vlines.join('\n').trimStart().startsWith('#EXTM3U')) return false;
          if (vlines.some((l) => /^#EXTINF:/i.test(l))) return true;
          // As a last resort, require at least one non-comment URI (segment)
          return vlines.some((l) => l && !l.startsWith('#'));
        }
        return false;
      }

      // If media playlist, HEAD the first segment.
      if (isMedia) {
        const seg = lines.find((l) => l && !l.startsWith('#'));
        if (!seg) return false;
        const segUrl = resolveRel(seg);
        if (!segUrl) return false;
        const sr = await fetch(segUrl, { method: 'HEAD', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
        if (!sr.ok) {
          try { sr.body?.cancel?.(); } catch {}
          return false;
        }
        try { sr.body?.cancel?.(); } catch {}
        return true;
      }

      // Otherwise treat as invalid/broken.
      return false;
    }
    // For non-HLS: a HEAD is usually enough.
    const r = await fetch(raw, { method: 'HEAD', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
    if (!r.ok) {
      try { r.body?.cancel?.(); } catch {}
      return false;
    }
    try { r.body?.cancel?.(); } catch {}
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeChannel({ serverOrigin, username, password, channel }) {
  const id = channel?.id ?? '';
  const key = `${String(serverOrigin || '').trim()}|${String(id || '').trim()}`;
  const cache = getProbeCache();
  pruneProbeCache(cache);
  const hit = cache.get(key);
  if (hit && Date.now() - Number(hit.ts || 0) < PROBE_TTL_MS) return Boolean(hit.isUp);

  const directSource = rebaseSourceOrigin(pickDirectSource(channel), serverOrigin);
  const ext = normalizeLiveExt(channel?.ext || sourceExtension(directSource) || '');
  const defaultHls = `${serverOrigin}live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.m3u8`;
  const fallbackExt = ext && ext !== 'm3u8' ? ext : 'ts';
  const defaultDirect = `${serverOrigin}live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${fallbackExt}`;

  // Prefer probing the default HLS URL first. Some XUI "stream_source" URLs can return
  // a 200 response even when the actual channel is down/stopped, which keeps it "up" incorrectly.
  const candidates = directSource
    ? [defaultHls, directSource, defaultDirect]
    : [defaultHls, defaultDirect];

  let ok = false;
  for (const u of candidates) {
    if (!u) continue;
    ok = await probeUrl(u);
    if (ok) break;
  }
  cache.set(key, { ts: Date.now(), isUp: ok });
  return ok;
}

async function readStreamBase(req) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('streamBase');
  const probeQuery = String(url.searchParams.get('probe') || '').trim();
  const probeFromQuery = probeQuery === '1' || probeQuery.toLowerCase() === 'true';
  if (fromQuery) return { streamBase: String(fromQuery || ''), probe: probeFromQuery };

  // Allow POST body: { streamBase }
  if (req.method === 'POST') {
    const ct = req.headers.get('content-type') || '';
    try {
      if (ct.includes('application/json')) {
        const b = await req.json().catch(() => ({}));
        return { streamBase: String(b?.streamBase || ''), probe: Boolean(b?.probe) || probeFromQuery };
      }
      const raw = await req.text().catch(() => '');
      try {
        const b = JSON.parse(raw || '{}');
        return { streamBase: String(b?.streamBase || ''), probe: Boolean(b?.probe) || probeFromQuery };
      } catch {
        const p = new URLSearchParams(raw || '');
        const probeRaw = String(p.get('probe') || '').trim();
        const probe = probeFromQuery || probeRaw === '1' || probeRaw.toLowerCase() === 'true';
        return { streamBase: String(p.get('streamBase') || ''), probe };
      }
    } catch {
      return { streamBase: '', probe: probeFromQuery };
    }
  }

  return { streamBase: '', probe: probeFromQuery };
}

async function handle(req) {
  const { streamBase, probe } = await readStreamBase(req);
  // Live channel listing should never depend on customer credentials.
  // We always use XUI Admin `get_streams` (status=0 only), and only use streamBase for optional probing.
  if (!streamBase && probe) {
    return NextResponse.json({ ok: false, error: 'Missing streamBase (required for probe)' }, { status: 400 });
  }

  try {
    const sessionParsed = streamBase ? parseStreamBase(streamBase) : { server: '', username: '', password: '' };
    // Always use XUI Admin live catalog.
    const cachedCatalog = !probe ? readLiveCatalogCache() : null;
    const xuiCatalog = cachedCatalog || (await readXuiAdminLiveCatalog());
    if (!xuiCatalog) {
      return NextResponse.json(
        { ok: false, error: 'XUI Admin `get_streams` is required for Live, but it could not be loaded. Check XUI Integration / Secrets.' },
        { status: 502 }
      );
    }
    if (!probe && !cachedCatalog) writeLiveCatalogCache(xuiCatalog);

    let channels = xuiCatalog.channels || [];
    if (probe) {
      const serverOrigin = String(sessionParsed?.server || '').trim();
      const probeUser = String(sessionParsed?.username || '').trim();
      const probePass = String(sessionParsed?.password || '').trim();
      const work = channels.map((channel) => async () => {
        const explicit = channel?.isUp;
        // If something is explicitly DOWN, skip probing and keep it filtered out.
        if (explicit === false) return { ...channel, isUp: false };
        // Otherwise always probe the actual stream URL. `stream_status` is not reliable enough.
        const ok = await probeChannel({ serverOrigin, username: probeUser, password: probePass, channel });
        return { ...channel, isUp: ok };
      });

      const out = [];
      let idx = 0;
      const runWorker = async () => {
        while (idx < work.length) {
          const my = idx;
          idx += 1;
          out[my] = await work[my]();
        }
      };
      await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, work.length) }, () => runWorker()));
      channels = out.filter((ch) => ch && ch.isUp === true);
    }

    return NextResponse.json({ ok: true, categories: xuiCatalog.categories || [], channels }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to load live channels' },
      { status: 502 }
    );
  }
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}
