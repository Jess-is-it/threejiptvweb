'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '../_components/ThemeToggle';
import ChunkAutoReload from '../_components/ChunkAutoReload';

export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [fpOpen, setFpOpen] = useState(false);
  const [fpUsername, setFpUsername] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpErr, setFpErr] = useState('');
  const [fpOk, setFpOk] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/admin/me', { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (j?.ok) router.replace('/admin');
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Login failed.');
      router.replace('/admin');
    } catch (e) {
      setErr(e?.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  const onForgot = async (e) => {
    e?.preventDefault?.();
    setFpErr('');
    setFpOk('');
    setFpLoading(true);
    try {
      const r = await fetch('/api/admin/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: fpUsername }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to send email.');
      setFpOk('If the username exists, we sent a password reset email.');
    } catch (e) {
      setFpErr(e?.message || 'Failed to send email.');
    } finally {
      setFpLoading(false);
    }
  };

  return (
    <div data-admin-ui="1" className="relative min-h-dvh bg-[var(--admin-bg)] text-[var(--admin-text)]">
      <ChunkAutoReload />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Admin login</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">Sign in to manage 3J TV settings.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-[var(--admin-muted)]">Username</label>
            <input
              id="admin-username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 outline-none ring-2 ring-transparent focus:ring-[--ring]"
              placeholder="admin"
              style={{ ['--ring']: 'var(--brand)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-[var(--admin-muted)]">Password</label>
            <input
              id="admin-password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              type="password"
              autoComplete="current-password"
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 outline-none ring-2 ring-transparent focus:ring-[--ring]"
              placeholder="••••••••"
              style={{ ['--ring']: 'var(--brand)' }}
            />
          </div>

          {err ? (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg px-4 py-3 font-medium text-white transition disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--admin-muted)]">
          First time setup?{' '}
          <Link href="/admin/setup" className="font-medium underline" style={{ color: 'var(--brand)' }}>
            Create the first admin
          </Link>
        </p>

        <div className="mt-4 text-center">
          <button
            type="button"
            className="text-sm font-medium text-[var(--brand)] hover:underline"
            onClick={() => {
              setFpErr('');
              setFpOk('');
              setFpUsername(username || fpUsername);
              setFpOpen(true);
            }}
          >
            Forgot password?
          </button>
        </div>
      </div>
      </div>

      {/* Forgot password modal */}
      {fpOpen ? (
        <div className="fixed inset-0 z-[120]">
          <button
            aria-label="Close forgot password"
            className="absolute inset-0 bg-black/70"
            onClick={() => setFpOpen(false)}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-2xl">
            <div className="text-lg font-semibold">Forgot password</div>
            <p className="mt-1 text-sm text-[var(--admin-muted)]">
              Enter your username. We’ll send a new password to the email on file.
            </p>

            <form onSubmit={onForgot} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--admin-muted)]">Username</label>
                <input
                  value={fpUsername}
                  onChange={(e) => setFpUsername(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                  placeholder="admin"
                />
              </div>

              {fpErr ? (
                <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{fpErr}</div>
              ) : null}
              {fpOk ? (
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{fpOk}</div>
              ) : null}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={fpLoading}
                  onClick={() => setFpOpen(false)}
                  className="flex-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={fpLoading}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {fpLoading ? 'Sending…' : 'Send password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
