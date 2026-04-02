import { NextResponse } from 'next/server';
import {
  resolveXuioneAssetUrl,
} from '../_shared';
import { ensureArtworkCached } from '../../../../lib/server/artworkCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fallbackResponse(req) {
  return NextResponse.redirect(new URL('/placeholders/poster-fallback.jpg', req.url), { status: 307 });
}

function buildResponse({ buffer, meta, cacheState = 'miss' } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;

  const headers = new Headers();
  if (meta?.contentType) headers.set('Content-Type', String(meta.contentType));
  if (meta?.contentLength) headers.set('Content-Length', String(meta.contentLength));
  if (meta?.etag) headers.set('ETag', String(meta.etag));
  if (meta?.lastModified) headers.set('Last-Modified', String(meta.lastModified));
  headers.set('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=31536000');
  headers.set('X-3J-Artwork-Cache', String(cacheState || 'miss'));

  return new NextResponse(buffer, {
    status: 200,
    headers,
  });
}

export async function GET(req) {
  const url = new URL(req.url);
  const rawSrc = url.searchParams.get('src') || '';
  const server = url.searchParams.get('server') || '';
  const src = resolveXuioneAssetUrl(rawSrc, server);
  if (!src) return fallbackResponse(req);

  try {
    const cached = await ensureArtworkCached({
      source: rawSrc || src,
      server,
    });
    const response = buildResponse(cached);
    if (response) return response;
    return fallbackResponse(req);
  } catch {
    return fallbackResponse(req);
  }
}
