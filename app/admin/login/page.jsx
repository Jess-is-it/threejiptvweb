'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '../_components/ThemeToggle';
import ChunkAutoReload from '../_components/ChunkAutoReload';
import TurnstileWidget from '../../../components/TurnstileWidget';
import { turnstileApplies } from '../../../lib/turnstileClient';

export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpErr, setFpErr] = useState('');
  const [fpOk, setFpOk] = useState('');
  const [fpCooldown, setFpCooldown] = useState(0);
  const [publicSettings, setPublicSettings] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [forgotTurnstileToken, setForgotTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [forgotTurnstileResetKey, setForgotTurnstileResetKey] = useState(0);

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch('/api/public/settings', { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (alive && json?.ok) setPublicSettings(json.settings || null);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (fpCooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setFpCooldown((current) => Math.max(0, Number(current || 0) - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [fpCooldown]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (adminTurnstileRequired && !turnstileToken) {
      setErr('Complete the security challenge first.');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, turnstileToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Login failed.');
      router.replace('/admin');
    } catch (e) {
      setErr(e?.message || 'Login failed.');
      if (adminTurnstileRequired) {
        setTurnstileToken('');
        setTurnstileResetKey((value) => value + 1);
      }
    } finally {
      setLoading(false);
    }
  };

  const onForgot = async (e) => {
    e?.preventDefault?.();
    if (fpCooldown > 0) return;
    setFpErr('');
    setFpOk('');
    if (forgotTurnstileRequired && !forgotTurnstileToken) {
      setFpErr('Complete the security challenge first.');
      return;
    }
    setFpLoading(true);
    try {
      const r = await fetch('/api/admin/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: fpEmail, turnstileToken: forgotTurnstileToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) {
        const retryAfter = Math.max(1, Math.min(60, Number(j?.retryAfterSeconds || 60) || 60));
        setFpCooldown(retryAfter);
        throw new Error(j?.error || `Please wait ${retryAfter} seconds before trying again.`);
      }
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to send email.');
      setFpCooldown(Math.max(1, Math.min(60, Number(j?.cooldownSeconds || 60) || 60)));
      setFpOk(`Password email sent${j?.sentTo ? ` to ${j.sentTo}` : ''}. Check Inbox and Spam.`);
    } catch (e) {
      setFpErr(e?.message || 'Failed to send email.');
      if (forgotTurnstileRequired) {
        setForgotTurnstileToken('');
        setForgotTurnstileResetKey((value) => value + 1);
      }
    } finally {
      setFpLoading(false);
    }
  };

  const adminTurnstileRequired = turnstileApplies(publicSettings, 'protectAdminLogin');
  const forgotTurnstileRequired = turnstileApplies(publicSettings, 'protectAdminForgotPassword');
  const turnstileSiteKey = publicSettings?.security?.turnstile?.siteKey || '';

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

          {adminTurnstileRequired ? (
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              action="admin_login"
              resetKey={turnstileResetKey}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken('')}
            />
          ) : null}

          <button
            type="submit"
            disabled={loading || (adminTurnstileRequired && !turnstileToken)}
            className="flex w-full items-center justify-center rounded-lg px-4 py-3 font-medium text-white transition disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            className="text-sm font-medium text-[var(--brand)] hover:underline"
            onClick={() => {
              setFpErr('');
              setFpOk('');
              setFpEmail(username.includes('@') ? username : fpEmail);
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
              Enter your admin email address. We’ll send a new password to that email if it matches an admin account.
            </p>

            <form onSubmit={onForgot} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--admin-muted)]">Email</label>
                <input
                  value={fpEmail}
                  onChange={(e) => setFpEmail(e.target.value)}
                  required
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                  placeholder="admin@example.com"
                />
              </div>

              {fpErr ? (
                <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{fpErr}</div>
              ) : null}
              {fpOk ? (
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{fpOk}</div>
              ) : null}

              {forgotTurnstileRequired ? (
                <TurnstileWidget
                  siteKey={turnstileSiteKey}
                  action="admin_forgot_password"
                  resetKey={forgotTurnstileResetKey}
                  onVerify={setForgotTurnstileToken}
                  onExpire={() => setForgotTurnstileToken('')}
                />
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
                  disabled={fpLoading || fpCooldown > 0 || (forgotTurnstileRequired && !forgotTurnstileToken)}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {fpLoading ? 'Sending…' : fpCooldown > 0 ? `Send password (${fpCooldown}s)` : 'Send password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
