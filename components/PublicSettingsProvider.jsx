'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const Ctx = createContext({ ready: false, settings: null });

export default function PublicSettingsProvider({ children, initialSettings = null }) {
  const [settings, setSettings] = useState(initialSettings);
  const [ready, setReady] = useState(Boolean(initialSettings));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/public/settings', { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (j?.ok) setSettings(j.settings || null);
      } catch {}
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Set a global CSS var for the brand color to reduce hard-coded styling.
  useEffect(() => {
    const color = settings?.brand?.color;
    if (!color) return;
    try {
      document.documentElement.style.setProperty('--brand', color);
    } catch {}
  }, [settings?.brand?.color]);

  const value = useMemo(() => ({ ready, settings }), [ready, settings]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePublicSettings() {
  return useContext(Ctx);
}

