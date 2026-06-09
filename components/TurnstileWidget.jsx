'use client';

import { useEffect, useRef, useState } from 'react';

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser is not available.'));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (window.__threejtvTurnstilePromise) return window.__threejtvTurnstilePromise;

  window.__threejtvTurnstilePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TURNSTILE_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.turnstile));
      existing.addEventListener('error', () => reject(new Error('Failed to load security challenge.')));
      return;
    }

    const script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('Failed to load security challenge.'));
    document.head.appendChild(script);
  });

  return window.__threejtvTurnstilePromise;
}

export default function TurnstileWidget({
  siteKey,
  action = 'login',
  theme = 'auto',
  resetKey = 0,
  onVerify,
  onExpire,
  className = '',
}) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const [error, setError] = useState('');

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
  }, [onExpire, onVerify]);

  useEffect(() => {
    let cancelled = false;
    setError('');

    async function renderWidget() {
      if (!siteKey || !containerRef.current) return;
      try {
        const turnstile = await loadTurnstileScript();
        if (cancelled || !turnstile || !containerRef.current) return;
        if (widgetRef.current) {
          try {
            turnstile.remove(widgetRef.current);
          } catch {}
          widgetRef.current = null;
        }
        containerRef.current.innerHTML = '';
        widgetRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme,
          callback: (token) => onVerifyRef.current?.(token || ''),
          'expired-callback': () => {
            onExpireRef.current?.();
          },
          'error-callback': () => {
            onExpireRef.current?.();
            setError('Security challenge failed to load. Refresh and try again.');
          },
        });
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Security challenge failed to load.');
      }
    }

    renderWidget();

    return () => {
      cancelled = true;
      if (widgetRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetRef.current);
        } catch {}
      }
      widgetRef.current = null;
    };
  }, [action, resetKey, siteKey, theme]);

  if (!siteKey) return null;

  return (
    <div className={className}>
      <div ref={containerRef} />
      {error ? <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}
    </div>
  );
}
