'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '../_components/ThemeToggle';

export const dynamic = 'force-dynamic';

export default function AdminSetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

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
    setOkMsg('');
    setLoading(true);
    try {
      const r = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Setup failed.');
      setOkMsg('Admin created. You can now sign in.');
    } catch (e) {
      setErr(e?.message || 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-admin-ui="1" className="relative min-h-dvh bg-[var(--admin-bg)] text-[var(--admin-text)]">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="mx-auto flex min-h-dvh w-full max-w-3xl items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 shadow-2xl">
        <h1 className="text-2xl font-bold">Admin setup</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">Create the first admin account.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-[var(--admin-muted)]">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 outline-none ring-2 ring-transparent focus:ring-[--ring]"
              placeholder="admin"
              style={{ ['--ring']: 'var(--brand)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-[var(--admin-muted)]">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 outline-none ring-2 ring-transparent focus:ring-[--ring]"
              placeholder="admin@example.com"
              style={{ ['--ring']: 'var(--brand)' }}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-[var(--admin-muted)]">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              type="password"
              autoComplete="new-password"
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 outline-none ring-2 ring-transparent focus:ring-[--ring]"
              placeholder="Min 8 characters"
              style={{ ['--ring']: 'var(--brand)' }}
            />
          </div>

          {err ? (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
          ) : null}
          {okMsg ? (
            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg px-4 py-3 font-medium text-white transition disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {loading ? 'Creating…' : 'Create admin'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-[var(--admin-muted)]">
          Already have an admin?{' '}
          <Link href="/admin/login" className="font-medium underline" style={{ color: 'var(--brand)' }}>
            Sign in
          </Link>
        </p>
      </div>
      </div>
    </div>
  );
}
