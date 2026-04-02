import { NextResponse } from 'next/server';
import {
  allowInsecureTlsFor,
  insecureDispatcher,
  resolveXuioneAssetUrl,
} from '../_shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fallbackResponse(req) {
  return NextResponse.redirect(new URL('/placeholders/poster-fallback.jpg', req.url), { status: 307 });
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

export async function GET(req) {
  const url = new URL(req.url);
  const rawSrc = url.searchParams.get('src') || '';
  const server = url.searchParams.get('server') || '';
  const src = resolveXuioneAssetUrl(rawSrc, server);
  if (!src) return fallbackResponse(req);

  try {
    const insecureTls = await allowInsecureTlsFor(src);
    const upstream = await fetch(src, {
      cache: 'force-cache',
      redirect: 'follow',
      ...(insecureTls ? { dispatcher: insecureDispatcher } : {}),
      headers: buildUpstreamHeaders(server),
    });

    if (!upstream.ok || !upstream.body) return fallbackResponse(req);

    const contentType = String(upstream.headers.get('content-type') || '').trim();
    if (contentType && !/^image\//i.test(contentType)) return fallbackResponse(req);

    const headers = new Headers();
    if (contentType) headers.set('Content-Type', contentType);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);
    const etag = upstream.headers.get('etag');
    if (etag) headers.set('ETag', etag);
    const lastModified = upstream.headers.get('last-modified');
    if (lastModified) headers.set('Last-Modified', lastModified);
    headers.set('Cache-Control', 'public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400');

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch {
    return fallbackResponse(req);
  }
}
