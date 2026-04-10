import 'server-only';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  allowInsecureTlsFor,
  insecureDispatcher,
  resolveXuioneAssetUrl,
} from '../../app/api/xuione/_shared';

const CACHE_DIR = path.join(process.cwd(), 'data', '.image-cache', 'originals-v1');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const inflight = globalThis.__threejArtworkCacheInflight || new Map();
if (!globalThis.__threejArtworkCacheInflight) {
  globalThis.__threejArtworkCacheInflight = inflight;
}

function asText(value = '') {
  return String(value || '').trim();
}

function isKnownLocalAssetPath(value = '') {
  const raw = asText(value);
  return (
    raw.startsWith('/api/') ||
    raw.startsWith('/placeholders/') ||
    raw.startsWith('/images/') ||
    raw.startsWith('/brand/')
  );
}

function cacheKey(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function inferContentType(src = '', headerValue = '') {
  const header = asText(headerValue).toLowerCase();
  if (header.startsWith('image/')) return header.split(';')[0];

  const pathname = (() => {
    try {
      return new URL(src).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (pathname.endsWith('.avif')) return 'image/avif';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

function buildUpstreamHeaders(server = '') {
  const headers = {
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.8',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  };

  try {
    const origin = server ? new URL(server).origin : '';
    if (origin) {
      headers.referer = origin;
      headers.origin = origin;
    }
  } catch {}

  return headers;
}

function cachePaths(src = '') {
  const key = cacheKey(src);
  return {
    key,
    bodyPath: path.join(CACHE_DIR, `${key}.bin`),
    metaPath: path.join(CACHE_DIR, `${key}.json`),
  };
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function readCacheEntry(src = '') {
  const { bodyPath, metaPath } = cachePaths(src);
  try {
    const [rawMeta, buffer] = await Promise.all([fs.readFile(metaPath, 'utf8'), fs.readFile(bodyPath)]);
    const meta = JSON.parse(rawMeta);
    const cachedAt = Number(meta?.cachedAt || 0);
    if (!cachedAt || Date.now() - cachedAt >= CACHE_TTL_MS) {
      await Promise.allSettled([fs.unlink(bodyPath), fs.unlink(metaPath)]);
      return null;
    }
    return { buffer, meta };
  } catch {
    return null;
  }
}

async function writeCacheEntry(src = '', { buffer, contentType, lastModified = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;

  await ensureCacheDir();

  const { bodyPath, metaPath } = cachePaths(src);
  const unique = `${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const tmpBody = `${bodyPath}.${unique}.tmp`;
  const tmpMeta = `${metaPath}.${unique}.tmp`;
  const meta = {
    cachedAt: Date.now(),
    contentType: inferContentType(src, contentType),
    contentLength: buffer.length,
    etag: `W/"${crypto.createHash('sha1').update(buffer).digest('hex')}"`,
    lastModified: asText(lastModified),
  };

  await Promise.all([
    fs.writeFile(tmpBody, buffer),
    fs.writeFile(tmpMeta, `${JSON.stringify(meta)}\n`, 'utf8'),
  ]);
  await Promise.all([
    fs.rename(tmpBody, bodyPath),
    fs.rename(tmpMeta, metaPath),
  ]);
  return { buffer, meta };
}

export function normalizeArtworkCacheSource({ source = '', server = '' } = {}) {
  const raw = asText(source);
  const normalizedServer = asText(server);
  const isRelativeXuioneAsset = Boolean(normalizedServer) && /^\/?images\//i.test(raw);
  if (!raw || (!isRelativeXuioneAsset && isKnownLocalAssetPath(raw))) return { src: '', server: '' };

  if (raw.startsWith('/api/xuione/image?')) {
    try {
      const query = raw.split('?')[1] || '';
      const params = new URLSearchParams(query);
      return normalizeArtworkCacheSource({
        source: params.get('src') || '',
        server: params.get('server') || '',
      });
    } catch {
      return { src: '', server: '' };
    }
  }

  const resolved = resolveXuioneAssetUrl(raw, normalizedServer);
  return {
    src: resolved,
    server: normalizedServer,
  };
}

export async function ensureArtworkCached({ source = '', server = '' } = {}) {
  const normalized = normalizeArtworkCacheSource({ source, server });
  if (!normalized.src) return null;

  const cached = await readCacheEntry(normalized.src);
  if (cached) return { ...cached, src: normalized.src, server: normalized.server, cacheState: 'hit' };

  const { key } = cachePaths(normalized.src);
  if (inflight.has(key)) return inflight.get(key);

  const loader = (async () => {
    try {
      const recheck = await readCacheEntry(normalized.src);
      if (recheck) return { ...recheck, src: normalized.src, server: normalized.server, cacheState: 'hit' };

      const insecureTls = await allowInsecureTlsFor(normalized.src);
      const upstream = await fetch(normalized.src, {
        cache: 'no-store',
        redirect: 'follow',
        ...(insecureTls ? { dispatcher: insecureDispatcher } : {}),
        headers: buildUpstreamHeaders(normalized.server),
      });

      if (!upstream.ok || !upstream.body) return null;

      const contentType = inferContentType(normalized.src, upstream.headers.get('content-type') || '');
      if (!/^image\//i.test(contentType)) return null;

      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (!buffer.length) return null;

      const lastModified = upstream.headers.get('last-modified') || '';
      if (buffer.length > MAX_IMAGE_BYTES) {
        return {
          buffer,
          meta: {
            cachedAt: Date.now(),
            contentType,
            contentLength: buffer.length,
            etag: `W/"${crypto.createHash('sha1').update(buffer).digest('hex')}"`,
            lastModified: asText(lastModified),
          },
          src: normalized.src,
          server: normalized.server,
          cacheState: 'bypass',
        };
      }

      const stored = await writeCacheEntry(normalized.src, {
        buffer,
        contentType,
        lastModified,
      });
      if (!stored) return null;
      return { ...stored, src: normalized.src, server: normalized.server, cacheState: 'miss' };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, loader);
  return loader;
}
