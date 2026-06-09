// components/SessionProvider.jsx
'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const Ctx = createContext(null);

const LS_KEY = '3jtv_session';
const SS_KEY = '3jtv_session_tmp';
const DEFAULT_PORTAL_URL = 'https://net.3jhotspot.com/portal';
const WARNING_SEEN_PREFIX = '3jtv_expiry_warning_seen:';

function tokenFingerprint(value = '') {
  const raw = String(value || '');
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function warningSeenStorageKey(token, accessExpiresAt, warningSeconds) {
  return `${WARNING_SEEN_PREFIX}${tokenFingerprint(token)}:${String(accessExpiresAt || 'no-expiry')}:${Number(warningSeconds || 0)}`;
}

function warningAlreadySeen(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markWarningSeen(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {}
}

function clearStoredSession() {
  try {
    localStorage.removeItem(LS_KEY);
    sessionStorage.removeItem(SS_KEY);
  } catch {}
}

function isHtmlLikeResponse(value = '') {
  const text = String(value || '').trim();
  return /^</.test(text) || /<!doctype|<html|cloudflare|bad gateway/i.test(text);
}

function normalizeLoginError(status, payload = {}) {
  const error = String(payload?.error || '').trim();
  if (status === 401) return 'Invalid username or password.';
  if (status === 403) return error || 'Security challenge could not be verified. Refresh and try again.';
  if (status === 429) return error || 'Too many login attempts. Please wait and try again.';
  if (status >= 500 || payload?.upstreamUnavailable) {
    return 'Login service is temporarily unavailable. Please try again shortly.';
  }
  if (!error || isHtmlLikeResponse(error)) return 'Login failed. Please try again.';
  return error;
}

function normalizePortalUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_PORTAL_URL;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, '')}`;
}

function formatRemaining(seconds = 0) {
  const total = Math.max(0, Math.ceil(Number(seconds || 0)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function stopAllMediaPlayback() {
  try {
    document.querySelectorAll('video, audio').forEach((media) => {
      try {
        media.pause();
        media.removeAttribute('src');
        media.load?.();
      } catch {}
    });
  } catch {}
}

function accessRestrictionMessage(status) {
  const msg = String(status?.message || '').trim();
  if (msg) return msg;
  if (status?.reasonCode === 'ACCESS_EXPIRED' || status?.reasonCode === 'EXPIRY_STOP_WINDOW') {
    return 'Your IPTV time has expired. Playback was stopped so your IPTV line can be safely closed.';
  }
  if (status?.reasonCode === 'LINE_REVOKED') return 'This IPTV line was removed by the operator.';
  return 'This IPTV access is no longer available.';
}

function IptvExpiryToast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast || !onDismiss) return undefined;
    const timer = window.setTimeout(onDismiss, 15000);
    return () => window.clearTimeout(timer);
  }, [toast?.key, onDismiss]);

  if (!toast) return null;
  const mountTarget = (() => {
    const fullscreen = typeof document !== 'undefined' ? document.fullscreenElement : null;
    if (fullscreen && fullscreen.tagName !== 'VIDEO' && fullscreen.tagName !== 'AUDIO') return fullscreen;
    return document.body;
  })();

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[2147483647] flex justify-center px-4 sm:justify-end sm:pr-5" role="status" aria-live="polite">
      <div className="pointer-events-auto max-w-md overflow-hidden rounded-2xl border border-amber-300/70 bg-neutral-950/95 text-white shadow-2xl backdrop-blur-md ring-1 ring-white/10">
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-lg font-black text-neutral-950">!</div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{toast.title || 'IPTV time running low'}</div>
            <div className="mt-1 text-sm leading-relaxed text-neutral-200">{toast.message}</div>
          </div>
          <button type="button" className="rounded-full p-1 text-neutral-300 transition hover:bg-white/10 hover:text-white" aria-label="Close" onClick={onDismiss}>x</button>
        </div>
      </div>
    </div>,
    mountTarget
  );
}

function AccessRestrictedModal({ restriction, onClose }) {
  useEffect(() => {
    if (!restriction) return undefined;
    const timer = window.setTimeout(() => onClose?.(), 12000);
    return () => window.clearTimeout(timer);
  }, [restriction?.reasonCode, restriction?.portalUrl]);

  if (!restriction) return null;
  const title = restriction?.reasonCode === 'EXPIRY_STOP_WINDOW' || restriction?.reasonCode === 'ACCESS_EXPIRED'
    ? 'IPTV Time Expired'
    : 'IPTV Access Restricted';
  return createPortal(
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/75 px-4 text-neutral-100 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-red-400/30 bg-neutral-950 shadow-2xl">
        <div className="bg-gradient-to-br from-red-500/30 via-red-500/10 to-transparent px-6 pt-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-300/40 bg-red-500/20 text-3xl font-black text-red-100 shadow-lg">!</div>
          <h2 className="mt-5 text-2xl font-bold">{title}</h2>
          <p className="mt-2 pb-6 text-sm leading-relaxed text-red-50/80">{accessRestrictionMessage(restriction)}</p>
        </div>
        <div className="space-y-3 px-6 pb-6 pt-5 text-sm text-neutral-300">
          <p>To continue watching, return to the 3J WiFi portal and buy or activate another IPTV item. This page will return to the portal automatically.</p>
          {restriction?.productName ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-neutral-500">IPTV pass</div>
              <div className="mt-1 font-semibold text-neutral-100">{restriction.productName}</div>
            </div>
          ) : null}
          <button type="button" className="mt-2 w-full rounded-2xl bg-red-500 px-4 py-3 font-semibold text-white transition hover:bg-red-400" onClick={onClose}>
            Back to 3J WiFi Portal
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [restriction, setRestriction] = useState(null);
  const [expiryToast, setExpiryToast] = useState(null);
  const warningSentRef = useRef('');
  const forceStopSentRef = useRef('');
  const warningSecondsRef = useRef(600);
  const stopSecondsRef = useRef(10);

  // hydrate from storage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY) ?? sessionStorage.getItem(SS_KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  // persist
  useEffect(() => {
    if (!ready) return;
    try {
      if (session?.remember) {
        localStorage.setItem(LS_KEY, JSON.stringify(session));
        sessionStorage.removeItem(SS_KEY);
      } else if (session) {
        sessionStorage.setItem(SS_KEY, JSON.stringify(session));
        localStorage.removeItem(LS_KEY);
      } else {
        localStorage.removeItem(LS_KEY);
        sessionStorage.removeItem(SS_KEY);
      }
    } catch {}
  }, [session, ready]);

  // 3J-issued IPTV sessions are disposable. Keep polling 3J so admin deletion or time expiry
  // immediately stops an already-open player page instead of leaving stale XUI credentials active.
  useEffect(() => {
    if (!ready) return undefined;
    const token = String(session?.threejToken || '').trim();
    const isThreejSession = session?.source === 'threej_hotspot_token';
    if (!isThreejSession || !token) return undefined;

    let alive = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch('/api/auth/threej-status', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await response.json().catch(() => ({}));
        if (!alive) return;
        if (response.ok && data?.ok) {
          const remainingSeconds = Math.max(0, Number(data.remainingSeconds || 0) || 0);
          const warningSeconds = Math.max(1, Number(data.warningSeconds || data?.data?.warning_seconds || 600) || 600);
          const stopSeconds = Math.max(1, Number(data.stopSeconds || data?.data?.stop_seconds || 10) || 10);
          warningSecondsRef.current = warningSeconds;
          stopSecondsRef.current = stopSeconds;
          const productName = data.productName || session?.user?.productName || 'Your IPTV pass';
          const portalUrl = normalizePortalUrl(data.portalUrl || data?.data?.portal_url);
          const expiryKey = `${token}:${data.accessExpiresAt || session?.accessExpiresAt || 'no-expiry'}`;

          if (data.allowed !== false && (data.forceStop || remainingSeconds <= stopSeconds)) {
            const stopKey = `${expiryKey}:stop`;
            if (forceStopSentRef.current !== stopKey) {
              forceStopSentRef.current = stopKey;
              stopAllMediaPlayback();
              try {
                if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
              } catch {}
              setExpiryToast(null);
              setRestriction({
                message: 'Your IPTV time has expired. Playback was stopped so your IPTV line can be safely closed. Please buy another IPTV item to continue watching.',
                reasonCode: 'EXPIRY_STOP_WINDOW',
                productName,
                portalUrl,
              });
            }
            return;
          }

          if (data.allowed === false) {
            stopAllMediaPlayback();
            try {
              if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
            } catch {}
            setRestriction({
              message: data.message,
              reasonCode: data.reasonCode,
              productName,
              portalUrl,
            });
            return;
          }

          if ((data.warningActive || remainingSeconds <= warningSeconds) && remainingSeconds > stopSeconds) {
            const warningKey = `${expiryKey}:warning:${warningSeconds}`;
            const warningStorageKey = warningSeenStorageKey(token, data.accessExpiresAt || session?.accessExpiresAt, warningSeconds);
            if (warningSentRef.current !== warningKey && !warningAlreadySeen(warningStorageKey)) {
              warningSentRef.current = warningKey;
              markWarningSeen(warningStorageKey);
              setExpiryToast({
                key: warningKey,
                title: 'IPTV time running low',
                message: `${productName} has ${formatRemaining(remainingSeconds)} remaining. Buy or activate another IPTV item soon so watching does not stop.`,
              });
            }
          }
        }
      } catch {
        // Do not interrupt playback on a transient status-check network failure.
      } finally {
        checking = false;
      }
    };

    const firstTimer = window.setTimeout(check, 1500);
    const interval = window.setInterval(check, 3000);
    const onFocus = () => check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, session?.threejToken, session?.source, session?.accessExpiresAt, session?.user?.productName]);

  useEffect(() => {
    if (!ready || restriction) return undefined;
    const token = String(session?.threejToken || '').trim();
    const isThreejSession = session?.source === 'threej_hotspot_token';
    if (!isThreejSession || !token || !session?.accessExpiresAt) return undefined;

    const tick = () => {
      const expiryTime = new Date(session.accessExpiresAt || '').getTime();
      if (!Number.isFinite(expiryTime)) return;
      const remainingSeconds = Math.max(0, Math.ceil((expiryTime - Date.now()) / 1000));
      const warningSeconds = Math.max(1, Number(warningSecondsRef.current || 600) || 600);
      const stopSeconds = Math.max(1, Number(stopSecondsRef.current || 10) || 10);
      if (remainingSeconds <= warningSeconds && remainingSeconds > stopSeconds) {
        const expiryKey = `${token}:${session.accessExpiresAt || 'no-expiry'}`;
        const warningKey = `${expiryKey}:warning:${warningSeconds}`;
        const warningStorageKey = warningSeenStorageKey(token, session.accessExpiresAt, warningSeconds);
        if (warningSentRef.current !== warningKey && !warningAlreadySeen(warningStorageKey)) {
          warningSentRef.current = warningKey;
          markWarningSeen(warningStorageKey);
          const productName = session?.user?.productName || 'Your IPTV pass';
          setExpiryToast({
            key: warningKey,
            title: 'IPTV time running low',
            message: `${productName} has ${formatRemaining(remainingSeconds)} remaining. Buy or activate another IPTV item soon so watching does not stop.`,
          });
        }
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [ready, restriction, session?.threejToken, session?.source, session?.accessExpiresAt, session?.user?.productName]);

  /**
   * login() – dual mode:
   * 1) Credentials mode: await login({ username, password, remember })
   *    -> performs fetch and returns { ok, error }
   * 2) Legacy mode: login(sessionObject, { remember })
   *    -> stores session and returns { ok:true }
   */
  async function login(arg, opts = {}) {
    setRestriction(null);
    setExpiryToast(null);
    // Mode 1: credentials object
    if (arg && typeof arg === 'object' && 'username' in arg && 'password' in arg) {
      const { username, password, remember = true, turnstileToken = '' } = arg;
      try {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password, turnstileToken }),
        });

        let data = null;
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          data = await r.json().catch(() => ({}));
        } else {
          const txt = await r.text().catch(() => '');
          data = {
            ok: false,
            error: isHtmlLikeResponse(txt) || r.status >= 500
              ? 'Login service is temporarily unavailable. Please try again shortly.'
              : txt?.slice(0, 200) || '',
          };
        }

        if (!r.ok || !data?.ok) {
          const error = normalizeLoginError(r.status, data);
          return { ok: false, error };
        }

        const sess = {
          user: {
            username: data.user?.username || username,
            status: data.user?.status || 'Active',
          },
          streamBase: data.streamBase,
          server: data.server,
          remember,
        };
        setSession(sess);
        return { ok: true, streamBase: data.streamBase, session: sess };
      } catch {
        return { ok: false, error: 'Network error. Please try again.' };
      }
    }

    // Mode 2: legacy set-session
    const remember = opts?.remember ?? true;
    setSession({ ...arg, remember });
    return { ok: true, session: { ...arg, remember } };
  }

  async function logout() {
    setRestriction(null);
    setExpiryToast(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    clearStoredSession();
    setSession(null);
    if (typeof window !== 'undefined') window.location.replace('/login');
  }

  function setServerOrigin(origin) {
    if (!origin) return;
    setSession((s) => {
      if (!s?.streamBase) return s;
      try {
        const u = new URL(s.streamBase);
        const parts = u.pathname.split('/').filter(Boolean);
        const i = parts.indexOf('live');
        const username = parts[i + 1] || '';
        const password = parts[i + 2] || '';
        if (!username || !password) return s;
        const base = origin.endsWith('/') ? origin : `${origin}/`;
        return {
          ...s,
          server: base,
          streamBase: `${base}live/${username}/${password}/`,
        };
      } catch {
        return s;
      }
    });
  }

  const api = useMemo(() => ({ ready, session, login, logout, setServerOrigin }), [ready, session]);

  const closeRestriction = () => {
    const target = normalizePortalUrl(restriction?.portalUrl);
    clearStoredSession();
    if (typeof window !== 'undefined') window.location.replace(target);
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <IptvExpiryToast toast={expiryToast} onDismiss={() => setExpiryToast(null)} />
      <AccessRestrictedModal restriction={restriction} onClose={closeRestriction} />
    </Ctx.Provider>
  );
}

export function useSession() {
  return useContext(Ctx);
}
