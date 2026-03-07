// app/shell.jsx
'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Header from '../components/header';
import Footer from '../components/footer';
import RouteLoadingOverlay from '../components/RouteLoadingOverlay';

export default function ClientShell({ children }) {
  const pathname = usePathname() || '/';
  const hideChrome =
    pathname.startsWith('/login') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/watch');

  // Disable the browser context menu (right-click / long-press) to avoid mobile "hold" triggering
  // the native menu while we use press-and-hold for previews.
  useEffect(() => {
    const allow = (t) => {
      const el = t && t.nodeType === 1 ? t : null;
      if (!el) return false;
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onCtx = (e) => {
      if (allow(e.target)) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onCtx, true);
    return () => window.removeEventListener('contextmenu', onCtx, true);
  }, []);

  // Auto-recover when a stale client tries to load old hashed chunks after deploy/restart.
  // We reload once (throttled) so users don't get stuck on ChunkLoadError screens.
  useEffect(() => {
    const retryKey = '__3jtv_chunk_reload_at';
    const retryWindowMs = 30_000;

    const shouldReload = () => {
      try {
        const last = Number(window.sessionStorage.getItem(retryKey) || 0);
        return !Number.isFinite(last) || Date.now() - last > retryWindowMs;
      } catch {
        return true;
      }
    };

    const reloadNow = () => {
      if (!shouldReload()) return;
      try {
        window.sessionStorage.setItem(retryKey, String(Date.now()));
      } catch {}
      window.location.reload();
    };

    const isChunkErrorText = (txt) =>
      /ChunkLoadError|Loading chunk [0-9]+ failed|Failed to fetch dynamically imported module/i.test(String(txt || ''));

    const onError = (event) => {
      const msg = String(event?.message || event?.error?.message || '');
      const stack = String(event?.error?.stack || '');
      const src = String(event?.target?.src || '');
      if (src.includes('/_next/static/chunks/')) {
        reloadNow();
        return;
      }
      if (isChunkErrorText(`${msg} ${stack}`)) reloadNow();
    };

    const onUnhandledRejection = (event) => {
      const reason = event?.reason;
      const name = String(reason?.name || '');
      const msg = typeof reason === 'string' ? reason : String(reason?.message || '');
      if (name === 'ChunkLoadError' || isChunkErrorText(msg)) reloadNow();
    };

    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return (
    <>
      <RouteLoadingOverlay />
      {!hideChrome && <Header />}
      {/* Fixed header is 64px (h-16). For hero sections that need to tuck under the header,
         add className="hero-pull" on their container instead of relying on this padding. */}
      <main id="app-main" className={hideChrome ? '' : 'pt-16'}>
        {children}
      </main>
      {!hideChrome && <Footer />}
    </>
  );
}
