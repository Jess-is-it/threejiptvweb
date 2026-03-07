// components/SessionProvider.jsx
'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const Ctx = createContext(null);

const LS_KEY = '3jtv_session';
const SS_KEY = '3jtv_session_tmp';

export default function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  // hydrate from storage
  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(LS_KEY) ?? sessionStorage.getItem(SS_KEY);
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

  /**
   * login() – dual mode:
   * 1) Credentials mode: await login({ username, password, remember })
   *    -> performs fetch and returns { ok, error }
   * 2) Legacy mode: login(sessionObject, { remember })
   *    -> stores session and returns { ok:true }
   */
  async function login(arg, opts = {}) {
    // Mode 1: credentials object
    if (arg && typeof arg === 'object' && 'username' in arg && 'password' in arg) {
      const { username, password, remember = true } = arg;
      try {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        let data = null;
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          data = await r.json().catch(() => ({}));
        } else {
          const txt = await r.text().catch(() => '');
          data = { ok: false, error: txt?.slice(0, 200) || '' };
        }

        if (!r.ok || !data?.ok) {
          const error =
            data?.error ||
            (r.status === 401 ? 'Invalid username or password.' : 'Login failed.');
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
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error. Please try again.' };
      }
    }

    // Mode 2: legacy set-session
    const remember = opts?.remember ?? true;
    setSession({ ...arg, remember });
    return { ok: true };
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    try {
      localStorage.removeItem(LS_KEY);
      sessionStorage.removeItem(SS_KEY);
    } catch {}
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

  const api = useMemo(
    () => ({ ready, session, login, logout, setServerOrigin }),
    [ready, session]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
