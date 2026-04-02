'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function RouteLoadingOverlay({ minMs = 450 }) {
  const pathname = usePathname() || '/';
  const [show, setShow] = useState(false);
  const lastKeyRef = useRef('');
  const hideTimerRef = useRef(null);
  const failSafeTimerRef = useRef(null);

  const clearTimers = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (failSafeTimerRef.current) {
      clearTimeout(failSafeTimerRef.current);
      failSafeTimerRef.current = null;
    }
  };

  useEffect(() => {
    const key = String(pathname || '/');
    if (!lastKeyRef.current) {
      lastKeyRef.current = key;
      return;
    }
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    clearTimers();
    setShow(true);
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setShow(false);
    }, Math.max(150, Number(minMs) || 450));

    return () => {
      clearTimers();
    };
  }, [pathname, minMs]);

  useEffect(() => {
    const onRouteStart = (event) => {
      const href = String(event?.detail?.href || '').trim();
      const nextPathname = href ? href.split('?')[0].split('#')[0] : '';
      const currentPathname = String(pathname || '/');
      if (!nextPathname || nextPathname === currentPathname) return;

      clearTimers();
      setShow(true);
      failSafeTimerRef.current = setTimeout(() => {
        failSafeTimerRef.current = null;
        setShow(false);
      }, 10_000);
    };

    window.addEventListener('3jtv:route-start', onRouteStart);
    return () => {
      window.removeEventListener('3jtv:route-start', onRouteStart);
      clearTimers();
    };
  }, [pathname]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[80] pointer-events-none">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" />
      <div className="absolute left-1/2 top-24 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950/80 px-4 py-2 shadow-lg">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-transparent" />
          <div className="text-xs text-neutral-200">Loading…</div>
        </div>
      </div>
    </div>
  );
}
