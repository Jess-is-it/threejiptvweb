import 'server-only';

export function getClientIp(req) {
  const cf = String(req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const real = String(req.headers.get('x-real-ip') || '').trim();
  if (real) return real;
  const forwarded = String(req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim();
  return forwarded || 'unknown';
}

function state() {
  if (!globalThis.__threejtvBotProtection) {
    globalThis.__threejtvBotProtection = {
      buckets: new Map(),
      failures: new Map(),
    };
  }
  return globalThis.__threejtvBotProtection;
}

function pruneMap(map, now = Date.now()) {
  if (map.size <= 20_000) return;
  for (const [key, value] of map.entries()) {
    const expiresAt = Number(value?.resetAt || value?.expiresAt || value?.lockedUntil || 0);
    if (expiresAt <= now) map.delete(key);
  }
}

export function checkRateLimit(req, { scope, limit = 10, windowMs = 60_000 }) {
  const now = Date.now();
  const key = `${scope}:${getClientIp(req)}`;
  const buckets = state().buckets;
  const current = buckets.get(key);
  if (!current || Number(current.resetAt || 0) <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0, remaining: Math.max(0, limit - 1) };
  }

  current.count = Number(current.count || 0) + 1;
  buckets.set(key, current);
  pruneMap(buckets, now);

  if (current.count > limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((Number(current.resetAt || now) - now) / 1000)),
      remaining: 0,
    };
  }

  return { allowed: true, retryAfter: 0, remaining: Math.max(0, limit - current.count) };
}

function normalizeIdentifier(identifier) {
  return String(identifier || '').trim().toLowerCase().slice(0, 120) || 'unknown';
}

function failureKey(req, scope, identifier) {
  return `${scope}:${getClientIp(req)}:${normalizeIdentifier(identifier)}`;
}

export function checkAuthLock(req, { scope, identifier }) {
  const now = Date.now();
  const row = state().failures.get(failureKey(req, scope, identifier));
  if (!row) return { locked: false, retryAfter: 0 };
  const lockedUntil = Number(row.lockedUntil || 0);
  if (lockedUntil > now) {
    return { locked: true, retryAfter: Math.max(1, Math.ceil((lockedUntil - now) / 1000)) };
  }
  return { locked: false, retryAfter: 0 };
}

export function recordAuthFailure(req, { scope, identifier, maxFailures = 5, windowMs = 15 * 60_000, lockMs = 15 * 60_000 }) {
  const now = Date.now();
  const failures = state().failures;
  const key = failureKey(req, scope, identifier);
  const current = failures.get(key);
  const next =
    !current || Number(current.expiresAt || 0) <= now
      ? { count: 1, expiresAt: now + windowMs, lockedUntil: 0 }
      : { ...current, count: Number(current.count || 0) + 1 };

  if (next.count >= maxFailures) {
    next.lockedUntil = now + lockMs;
    next.expiresAt = Math.max(next.expiresAt, next.lockedUntil);
  }

  failures.set(key, next);
  pruneMap(failures, now);

  return {
    locked: Number(next.lockedUntil || 0) > now,
    retryAfter: Number(next.lockedUntil || 0) > now ? Math.max(1, Math.ceil((next.lockedUntil - now) / 1000)) : 0,
    failures: next.count,
  };
}

export function clearAuthFailures(req, { scope, identifier }) {
  state().failures.delete(failureKey(req, scope, identifier));
}

export function tooManyRequestsPayload(result) {
  return {
    ok: false,
    error: `Too many requests. Try again in ${result.retryAfter} seconds.`,
    retryAfterSeconds: result.retryAfter,
  };
}
