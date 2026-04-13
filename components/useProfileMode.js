'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'profile.mode';
const EVENT_NAME = '3jtv:profileModeChanged';

function normalizeProfileMode(value) {
  return value === 'kids' ? 'kids' : 'adult';
}

export function readProfileMode() {
  try {
    if (typeof window === 'undefined') return 'adult';
    return normalizeProfileMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'adult';
  }
}

export function writeProfileMode(nextMode) {
  const normalized = normalizeProfileMode(nextMode);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, normalized);
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { mode: normalized } }));
    }
  } catch {
    // ignore
  }
  return normalized;
}

export function useProfileMode() {
  const [mode, setMode] = useState(() => readProfileMode());

  useEffect(() => {
    const onStorage = (event) => {
      if (!event || event.key !== STORAGE_KEY) return;
      setMode(normalizeProfileMode(event.newValue));
    };
    const onCustom = (event) => {
      const next = normalizeProfileMode(event?.detail?.mode);
      setMode(next);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT_NAME, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT_NAME, onCustom);
    };
  }, []);

  const setProfileMode = useCallback((nextMode) => {
    const normalized = writeProfileMode(nextMode);
    setMode(normalized);
  }, []);

  return { mode, setMode: setProfileMode };
}

