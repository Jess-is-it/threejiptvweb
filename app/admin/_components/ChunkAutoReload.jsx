'use client';

import { useEffect } from 'react';

function isChunkLoadError(reason) {
  const msg =
    typeof reason === 'string'
      ? reason
      : String(reason?.message || reason?.name || reason?.toString?.() || '');

  if (!msg) return false;
  return (
    msg.includes('ChunkLoadError') ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg)
  );
}

export default function ChunkAutoReload() {
  useEffect(() => {
    const key = '3jtv_chunk_reload_once';
    const alreadyReloaded = () => {
      try {
        return sessionStorage.getItem(key) === '1';
      } catch {
        return false;
      }
    };
    const markReloaded = () => {
      try {
        sessionStorage.setItem(key, '1');
      } catch {}
    };

    const reload = () => {
      if (alreadyReloaded()) return;
      markReloaded();
      window.location.reload();
    };

    const onRejection = (event) => {
      if (isChunkLoadError(event?.reason)) reload();
    };

    const onError = (event) => {
      if (isChunkLoadError(event?.error) || isChunkLoadError(event?.message)) reload();
    };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  return null;
}

