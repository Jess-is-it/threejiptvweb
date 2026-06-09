import 'server-only';

import { getPublicSettings } from './settings';
import { getSecret, secretKeys } from './secrets';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function requestHost(req) {
  const forwarded = String(req.headers.get('x-forwarded-host') || '').split(',')[0]?.trim();
  return normalizeHost(forwarded || req.headers.get('host') || '');
}

function publicHost(settings) {
  const fromHostname = normalizeHost(settings?.publicHttps?.publicHostname);
  if (fromHostname) return fromHostname;
  try {
    return normalizeHost(new URL(settings?.publicHttps?.publicUrl || '').host);
  } catch {
    return '';
  }
}

function clientIp(req) {
  const cf = String(req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const real = String(req.headers.get('x-real-ip') || '').trim();
  if (real) return real;
  return String(req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || '';
}

export function normalizeTurnstileSettings(settings = {}) {
  const src = settings?.security?.turnstile && typeof settings.security.turnstile === 'object'
    ? settings.security.turnstile
    : {};
  return {
    enabled: src.enabled === true,
    siteKey: String(src.siteKey || '').trim(),
    protectPublicLogin: src.protectPublicLogin !== false,
    protectAdminLogin: src.protectAdminLogin !== false,
    protectAdminForgotPassword: src.protectAdminForgotPassword !== false,
    enforcePublicHostOnly: src.enforcePublicHostOnly !== false,
  };
}

export function turnstileAreaEnabled(config, area) {
  if (!config?.enabled) return false;
  if (area === 'public_login') return config.protectPublicLogin !== false;
  if (area === 'admin_login') return config.protectAdminLogin !== false;
  if (area === 'admin_forgot_password') return config.protectAdminForgotPassword !== false;
  return false;
}

export function shouldRequireTurnstile({ settings, req, area }) {
  const config = normalizeTurnstileSettings(settings);
  if (!turnstileAreaEnabled(config, area)) return false;

  if (config.enforcePublicHostOnly) {
    const expectedHost = publicHost(settings);
    if (expectedHost && requestHost(req) !== expectedHost) return false;
  }

  return true;
}

export async function getTurnstileSecret() {
  const key = secretKeys().cloudflareTurnstileSecret;
  return String((await getSecret(key)) || process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '').trim();
}

export async function getTurnstileAdminMeta() {
  const secret = await getTurnstileSecret();
  return {
    secretConfigured: Boolean(secret),
    envConfigured: Boolean(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY),
  };
}

export async function verifyTurnstile({ req, area, token, settings = null }) {
  const resolvedSettings = settings || (await getPublicSettings());
  if (!shouldRequireTurnstile({ settings: resolvedSettings, req, area })) {
    return { ok: true, required: false };
  }

  const config = normalizeTurnstileSettings(resolvedSettings);
  const secret = await getTurnstileSecret();
  if (!config.siteKey || !secret) {
    return {
      ok: false,
      required: true,
      error: 'Security challenge is not fully configured. Contact the administrator.',
      status: 503,
    };
  }

  const responseToken = String(token || '').trim();
  if (!responseToken) {
    return {
      ok: false,
      required: true,
      error: 'Security challenge is required.',
      status: 403,
    };
  }

  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', responseToken);
    const ip = clientIp(req);
    if (ip) body.set('remoteip', ip);

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.success !== true) {
      return {
        ok: false,
        required: true,
        error: 'Security challenge failed. Refresh and try again.',
        status: 403,
        codes: Array.isArray(json?.['error-codes']) ? json['error-codes'] : [],
      };
    }
    return { ok: true, required: true };
  } catch {
    return {
      ok: false,
      required: true,
      error: 'Security challenge could not be verified. Try again.',
      status: 502,
    };
  }
}

export function turnstileErrorResponse(result) {
  return {
    ok: false,
    error: result?.error || 'Security challenge failed.',
    turnstileRequired: result?.required === true,
  };
}
