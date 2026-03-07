'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePublicSettings } from './PublicSettingsProvider';

const Ctx = createContext({
  ready: false,
  movieCardClickAction: 'play', // 'play' | 'preview'
  setMovieCardClickAction: () => {},
});

const LS_KEY = '3jtv.movieCardClickAction';

function normalizeAction(v) {
  const s = String(v || '').toLowerCase();
  return s === 'preview' ? 'preview' : 'play';
}

export default function UserPreferencesProvider({ children }) {
  const { settings, ready: settingsReady } = usePublicSettings();
  const [ready, setReady] = useState(false);
  const [movieCardClickAction, setAction] = useState('play');

  useEffect(() => {
    if (!settingsReady) return;
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        setAction(normalizeAction(saved));
        setReady(true);
        return;
      }
    } catch {}

    const def = normalizeAction(settings?.ui?.defaultMovieCardClickAction);
    setAction(def);
    setReady(true);
  }, [settingsReady, settings?.ui?.defaultMovieCardClickAction]);

  const setMovieCardClickAction = (next) => {
    const v = normalizeAction(next);
    setAction(v);
    try {
      localStorage.setItem(LS_KEY, v);
    } catch {}
  };

  const value = useMemo(
    () => ({ ready, movieCardClickAction, setMovieCardClickAction }),
    [ready, movieCardClickAction]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserPreferences() {
  return useContext(Ctx);
}

