import { NextResponse } from 'next/server';

const RATE_LIMITS = [
  { name: 'public-login-api', test: (path) => path === '/api/auth/login', limit: 10, windowMs: 60_000 },
  { name: 'admin-login-api', test: (path) => path === '/api/admin/login', limit: 6, windowMs: 60_000 },
  { name: 'admin-forgot-api', test: (path) => path === '/api/admin/forgot-password', limit: 4, windowMs: 60_000 },
  { name: 'admin-api', test: (path) => path.startsWith('/api/admin/'), limit: 240, windowMs: 60_000 },
  { name: 'public-login-page', test: (path) => path === '/login', limit: 80, windowMs: 60_000 },
  { name: 'admin-page', test: (path) => path === '/admin' || path.startsWith('/admin/'), limit: 80, windowMs: 60_000 },
];

const SECURITY_HEADERS = {
  'X-DNS-Prefetch-Control': 'on',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function applySecurityHeaders(response) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function clientIp(req) {
  const cf = String(req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const real = String(req.headers.get('x-real-ip') || '').trim();
  if (real) return real;
  const forwarded = String(req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim();
  return forwarded || 'unknown';
}

function buckets() {
  if (!globalThis.__threejtvMiddlewareBuckets) globalThis.__threejtvMiddlewareBuckets = new Map();
  return globalThis.__threejtvMiddlewareBuckets;
}

function consume({ key, limit, windowMs }) {
  const now = Date.now();
  const store = buckets();
  const current = store.get(key);
  if (!current || Number(current.resetAt || 0) <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }

  current.count = Number(current.count || 0) + 1;
  store.set(key, current);

  if (current.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((Number(current.resetAt || now) - now) / 1000)),
    };
  }

  if (store.size > 20_000) {
    for (const [rowKey, value] of store.entries()) {
      if (Number(value?.resetAt || 0) <= now) store.delete(rowKey);
    }
  }

  return { allowed: true, remaining: Math.max(0, limit - current.count), retryAfter: 0 };
}

function rateLimitedResponse(req, result) {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  const headers = {
    'Retry-After': String(result.retryAfter),
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (isApi) {
    return applySecurityHeaders(NextResponse.json(
      { ok: false, error: `Too many requests. Try again in ${result.retryAfter} seconds.`, retryAfterSeconds: result.retryAfter },
      { status: 429, headers }
    ));
  }
  return applySecurityHeaders(new NextResponse(`Too many requests. Try again in ${result.retryAfter} seconds.`, {
    status: 429,
    headers: {
      ...headers,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  }));
}

export function middleware(req) {
  const path = req.nextUrl.pathname;
  const rule = RATE_LIMITS.find((item) => item.test(path));
  if (!rule) return applySecurityHeaders(NextResponse.next());

  const result = consume({
    key: `${rule.name}:${clientIp(req)}`,
    limit: rule.limit,
    windowMs: rule.windowMs,
  });

  if (!result.allowed) return rateLimitedResponse(req, result);

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(rule.limit));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  return applySecurityHeaders(response);
}

export const config = {
  matcher: ['/login', '/admin/:path*', '/api/auth/login', '/api/admin/:path*'],
};
