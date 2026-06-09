'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, PlayCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import { useSession } from '../../components/SessionProvider';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import { prefetchMovieCatalog, prefetchSeriesCatalog } from '../../lib/publicCatalogCache';

const PORTAL_RETURN_URL = 'https://net.3jhotspot.com/portal';
const WATCH_LOGIN_TIMEOUT_MS = 15000;
const WATCH_PORTAL_COUNTDOWN_SECONDS = 10;
const WATCH_TIMEOUT_MESSAGE = 'The IPTV server could not be reached in time. The issue was logged for admin review. You will be returned to the 3J WiFi Portal.';

function statusCopy(status) {
  if (status === 'success') return 'Opening 3J TV...';
  if (status === 'failed') return 'IPTV access could not be opened.';
  return 'Checking your IPTV access...';
}

function normalizeFailureMessage(err) {
  if (err?.name === 'AbortError') return WATCH_TIMEOUT_MESSAGE;
  const raw = String(err?.message || '').trim();
  if (!raw || /failed to fetch|networkerror|load failed/i.test(raw)) return WATCH_TIMEOUT_MESSAGE;
  return raw;
}

export default function WatchPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useSession();
  const { settings } = usePublicSettings();
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [returnCountdown, setReturnCountdown] = useState(WATCH_PORTAL_COUNTDOWN_SECONDS);
  const startedRef = useRef(false);
  const brandColor = settings?.brand?.color || '#FA5252';

  const token = useMemo(() => String(params.get('threej_token') || params.get('token') || '').trim(), [params]);

  useEffect(() => {
    if (status !== 'failed') return undefined;
    setReturnCountdown(WATCH_PORTAL_COUNTDOWN_SECONDS);
    const startedAt = Date.now();
    const ticker = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const next = Math.max(WATCH_PORTAL_COUNTDOWN_SECONDS - elapsed, 0);
      setReturnCountdown(next);
      if (next <= 0) {
        window.clearInterval(ticker);
        window.location.replace(PORTAL_RETURN_URL);
      }
    }, 250);
    return () => window.clearInterval(ticker);
  }, [status]);

  useEffect(() => {
    let alive = true;
    async function openIptv() {
      if (startedRef.current) return;
      startedRef.current = true;
      if (!token) {
        setStatus('failed');
        setError('IPTV login token is missing. Open IPTV from My WiFi Bag again.');
        return;
      }
      setStatus('loading');
      setError('');
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), WATCH_LOGIN_TIMEOUT_MS);
      try {
        const response = await fetch('/api/auth/threej-token', {
          method: 'POST',
          cache: 'no-store',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, remember: true }),
        });
        window.clearTimeout(timeout);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok || !data?.session) {
          throw new Error(data?.error || 'IPTV login failed.');
        }
        const result = await login(data.session, { remember: true });
        if (!result?.ok) {
          throw new Error(result?.error || 'Could not save IPTV session.');
        }
        if (data.streamBase) {
          void prefetchMovieCatalog(data.streamBase).catch(() => {});
          void prefetchSeriesCatalog(data.streamBase).catch(() => {});
        }
        if (!alive) return;
        setStatus('success');
        window.history.replaceState(null, '', '/watch');
        setTimeout(() => {
          if (alive) router.replace('/');
        }, 350);
      } catch (err) {
        window.clearTimeout(timeout);
        if (!alive) return;
        setStatus('failed');
        setError(normalizeFailureMessage(err));
      }
    }
    openIptv();
    return () => {
      alive = false;
    };
  }, [login, router, token]);

  const failed = status === 'failed';
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function () {
  if (window.__threejIptvInlineStarted) return;
  window.__threejIptvInlineStarted = true;
  var PORTAL_RETURN_URL = '${PORTAL_RETURN_URL}';
  var WATCH_LOGIN_TIMEOUT_MS = ${WATCH_LOGIN_TIMEOUT_MS};
  var WATCH_PORTAL_COUNTDOWN_SECONDS = ${WATCH_PORTAL_COUNTDOWN_SECONDS};
  var WATCH_TIMEOUT_MESSAGE = '${WATCH_TIMEOUT_MESSAGE.replace(/'/g, "\\'")}';
  function showFailure(message) {
    window.__threejIptvInlineError = message || WATCH_TIMEOUT_MESSAGE;
    var heading = document.querySelector('[data-threej-watch-title]');
    var body = document.querySelector('[data-threej-watch-message]');
    var countdown = document.querySelector('[data-threej-watch-countdown]');
    if (heading) heading.textContent = 'IPTV access could not be opened.';
    if (body) body.textContent = window.__threejIptvInlineError;
    if (countdown) countdown.textContent = 'Returning to the portal in ' + WATCH_PORTAL_COUNTDOWN_SECONDS + 's.';
    var remaining = WATCH_PORTAL_COUNTDOWN_SECONDS;
    var ticker = window.setInterval(function () {
      remaining -= 1;
      if (countdown) countdown.textContent = 'Returning to the portal in ' + Math.max(remaining, 0) + 's.';
      if (remaining <= 0) {
        window.clearInterval(ticker);
        window.location.replace(PORTAL_RETURN_URL);
      }
    }, 1000);
  }
  function normalizeFailure(error) {
    var message = error && error.message ? String(error.message) : '';
    if (!message || /abort|failed to fetch|networkerror|load failed/i.test(message)) return WATCH_TIMEOUT_MESSAGE;
    return message;
  }
  try {
    var params = new URLSearchParams(window.location.search || '');
    var token = String(params.get('threej_token') || params.get('token') || '').trim();
    if (!token) return;
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, WATCH_LOGIN_TIMEOUT_MS);
    fetch('/api/auth/threej-token', {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, remember: true })
    })
      .then(function (response) {
        window.clearTimeout(timeout);
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || !data || !data.ok || !data.session) {
            throw new Error(data && data.error ? data.error : 'IPTV login failed.');
          }
          return data;
        });
      })
      .then(function (data) {
        try {
          var session = Object.assign({}, data.session, { remember: true });
          window.localStorage.setItem('3jtv_session', JSON.stringify(session));
          window.sessionStorage.removeItem('3jtv_session_tmp');
        } catch (storageError) {
          throw new Error('Could not save IPTV session on this browser.');
        }
        try { window.history.replaceState(null, '', '/watch'); } catch (_) {}
        window.location.replace('/');
      })
      .catch(function (error) {
        window.clearTimeout(timeout);
        showFailure(normalizeFailure(error));
      });
  } catch (error) {
    showFailure(normalizeFailure(error));
  }
})();`,
        }}
      />
      <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-neutral-950 px-4 text-neutral-100">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(250,82,82,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_45%)]" />
        <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-950/85 p-6 text-center shadow-2xl backdrop-blur">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg"
            style={{ backgroundColor: failed ? '#ef4444' : brandColor }}
          >
            {failed ? <TriangleAlert size={30} /> : status === 'success' ? <PlayCircle size={32} /> : <Loader2 className="animate-spin" size={30} />}
          </div>
          <h1 data-threej-watch-title className="mt-5 text-2xl font-bold">{statusCopy(status)}</h1>
          <p data-threej-watch-message className="mt-2 text-sm text-neutral-400">
            {failed
              ? error
              : 'Please keep this page open. Your TV session is being prepared securely.'}
          </p>
          {failed ? (
            <p data-threej-watch-countdown className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Returning to the portal in {returnCountdown}s.
            </p>
          ) : null}
          {failed ? (
            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="rounded-xl px-4 py-3 font-semibold text-white"
                style={{ backgroundColor: brandColor }}
                onClick={() => window.location.replace(PORTAL_RETURN_URL)}
              >
                Return to 3J WiFi Portal
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-white/10 px-4 py-3 font-semibold text-neutral-200 hover:bg-white/5"
                onClick={() => window.location.reload()}
              >
                <RotateCcw size={16} className="mr-2" />
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
