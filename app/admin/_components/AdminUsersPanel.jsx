'use client';

import { useEffect, useState } from 'react';

export default function AdminUsersPanel() {
  const [admins, setAdmins] = useState([]);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const refresh = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/users', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load admins.');
      setAdmins(j.admins || []);
    } catch (e) {
      setErr(e?.message || 'Failed to load admins.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onCreate = async (e) => {
    e.preventDefault();
    setErr('');
    setOkMsg('');
    setSaving(true);
    try {
      const r = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to create admin.');
      setAdmins(j.admins || []);
      setUsername('');
      setEmail('');
      setPassword('');
      setOkMsg(`Created admin: ${j.created?.username || j.created?.email || ''}`);
    } catch (e) {
      setErr(e?.message || 'Failed to create admin.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">Admins</h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">Manage admin accounts for the portal.</p>

        {loading ? (
          <div className="mt-4 text-sm text-[var(--admin-muted)]">Loading…</div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-[var(--admin-text)]">
                <tr>
                  <th className="px-3 py-2">Username</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Last login</th>
                </tr>
              </thead>
              <tbody>
                {(admins || []).map((a) => (
                  <tr key={a.id} className="border-t border-[var(--admin-border)]">
                    <td className="px-3 py-2">{a.username || '—'}</td>
                    <td className="px-3 py-2">{a.email}</td>
                    <td className="px-3 py-2 text-[var(--admin-muted)]">
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-[var(--admin-muted)]">
                      {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
                {admins?.length ? null : (
                  <tr>
                    <td className="px-3 py-3 text-[var(--admin-muted)]" colSpan={4}>
                      No admins found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {err ? (
          <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
        ) : null}
        {okMsg ? (
          <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div>
        ) : null}

        <button
          onClick={refresh}
          className="mt-4 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h3 className="text-base font-semibold">Create admin</h3>
        <form onSubmit={onCreate} className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="admin"
              autoComplete="username"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="admin@example.com"
              autoComplete="email"
            />
          </div>
          <div className="sm:col-span-1">
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              type="password"
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="Min 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
