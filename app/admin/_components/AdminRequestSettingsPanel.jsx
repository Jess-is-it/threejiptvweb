'use client';

import { useEffect, useMemo, useState } from 'react';

const LANDING_OPTIONS = [
  { id: 'popular', label: 'Popular' },
  { id: 'tagalog', label: 'Tagalog' },
  { id: 'anime', label: 'Anime' },
  { id: 'action', label: 'Action' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'horror', label: 'Horror' },
  { id: 'romance', label: 'Romance' },
  { id: 'drama', label: 'Drama' },
  { id: 'scifi', label: 'Sci-fi' },
];

function clampLimit(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return Math.max(1, Math.min(20, v));
}

function clampSeriesEpisodeLimit(value, fallback = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return Math.max(1, Math.min(200, v));
}

function normalizeUser(value) {
  return String(value || '').trim().toLowerCase();
}

function sortLimitRows(mapObj) {
  return Object.entries(mapObj || {})
    .map(([username, limit]) => ({
      username: normalizeUser(username),
      limit: clampLimit(limit, 3),
    }))
    .filter((x) => x.username)
    .sort((a, b) => a.username.localeCompare(b.username));
}

export default function AdminRequestSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [dailyLimitDefault, setDailyLimitDefault] = useState(3);
  const [seriesEpisodeLimitDefault, setSeriesEpisodeLimitDefault] = useState(8);
  const [defaultLandingCategory, setDefaultLandingCategory] = useState('popular');
  const [statusTagPending, setStatusTagPending] = useState('Pending');
  const [statusTagApproved, setStatusTagApproved] = useState('Approved');
  const [statusTagAvailable, setStatusTagAvailable] = useState('Available Now');
  const [statusTagRejected, setStatusTagRejected] = useState('Rejected');
  const [statusTagArchived, setStatusTagArchived] = useState('Archived');

  const [limitRows, setLimitRows] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newLimit, setNewLimit] = useState(3);

  const load = async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/request-settings', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load request settings.');

      const settings = j.settings || {};
      setDailyLimitDefault(clampLimit(settings?.dailyLimitDefault, 3));
      setSeriesEpisodeLimitDefault(clampSeriesEpisodeLimit(settings?.seriesEpisodeLimitDefault, 8));
      setDefaultLandingCategory(String(settings?.defaultLandingCategory || 'popular').trim() || 'popular');

      setStatusTagPending(String(settings?.statusTags?.pending || 'Pending'));
      setStatusTagApproved(String(settings?.statusTags?.approved || 'Approved'));
      setStatusTagAvailable(String(settings?.statusTags?.availableNow || 'Available Now'));
      setStatusTagRejected(String(settings?.statusTags?.rejected || 'Rejected'));
      setStatusTagArchived(String(settings?.statusTags?.archived || 'Archived'));

      setLimitRows(sortLimitRows(settings?.dailyLimitsByUsername || {}));
    } catch (e) {
      setErr(e?.message || 'Failed to load request settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const mapForSave = useMemo(() => {
    const out = {};
    for (const row of limitRows) {
      const username = normalizeUser(row?.username);
      if (!username) continue;
      out[username] = clampLimit(row?.limit, dailyLimitDefault);
    }
    return out;
  }, [limitRows, dailyLimitDefault]);

  const save = async () => {
    setSaving(true);
    setErr('');
    setOkMsg('');
    try {
      const payload = {
        settings: {
          dailyLimitDefault: clampLimit(dailyLimitDefault, 3),
          seriesEpisodeLimitDefault: clampSeriesEpisodeLimit(seriesEpisodeLimitDefault, 8),
          dailyLimitsByUsername: mapForSave,
          defaultLandingCategory,
          statusTags: {
            pending: String(statusTagPending || 'Pending').trim() || 'Pending',
            approved: String(statusTagApproved || 'Approved').trim() || 'Approved',
            availableNow: String(statusTagAvailable || 'Available Now').trim() || 'Available Now',
            rejected: String(statusTagRejected || 'Rejected').trim() || 'Rejected',
            archived: String(statusTagArchived || 'Archived').trim() || 'Archived',
          },
        },
      };

      const r = await fetch('/api/admin/request-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save request settings.');
      setOkMsg('Saved request settings.');
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to save request settings.');
    } finally {
      setSaving(false);
    }
  };

  const addOrUpdateUserLimit = () => {
    const username = normalizeUser(newUsername);
    if (!username) return;
    const limit = clampLimit(newLimit, dailyLimitDefault);
    setLimitRows((prev) => {
      const idx = prev.findIndex((x) => normalizeUser(x.username) === username);
      if (idx < 0) return sortLimitRows({ ...Object.fromEntries(prev.map((x) => [x.username, x.limit])), [username]: limit });
      const copy = [...prev];
      copy[idx] = { username, limit };
      return sortLimitRows(Object.fromEntries(copy.map((x) => [x.username, x.limit])));
    });
    setNewUsername('');
    setNewLimit(dailyLimitDefault);
  };

  const removeUserLimit = (username) => {
    const u = normalizeUser(username);
    setLimitRows((prev) => prev.filter((x) => normalizeUser(x.username) !== u));
  };

  const updateLimitValue = (username, nextLimit) => {
    const u = normalizeUser(username);
    setLimitRows((prev) =>
      prev.map((x) => (normalizeUser(x.username) === u ? { ...x, limit: clampLimit(nextLimit, dailyLimitDefault) } : x))
    );
  };

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">Request Settings</h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Configure daily title/series limits, default request-page landing category, and request status labels.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Daily Request Limit (default)</label>
            <input
              type="number"
              min={1}
              max={20}
              value={dailyLimitDefault}
              onChange={(e) => setDailyLimitDefault(clampLimit(e.target.value, 3))}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">
              Daily Series Episode Limit (default)
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={seriesEpisodeLimitDefault}
              onChange={(e) => setSeriesEpisodeLimitDefault(clampSeriesEpisodeLimit(e.target.value, 8))}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Default Landing Category</label>
            <select
              value={defaultLandingCategory}
              onChange={(e) => setDefaultLandingCategory(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
              {LANDING_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-sm font-semibold">Custom Status Tags</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-[var(--admin-muted)]">
              Pending
              <input
                value={statusTagPending}
                onChange={(e) => setStatusTagPending(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
              />
            </label>
            <label className="text-xs text-[var(--admin-muted)]">
              Approved
              <input
                value={statusTagApproved}
                onChange={(e) => setStatusTagApproved(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
              />
            </label>
            <label className="text-xs text-[var(--admin-muted)]">
              Available Now
              <input
                value={statusTagAvailable}
                onChange={(e) => setStatusTagAvailable(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
              />
            </label>
            <label className="text-xs text-[var(--admin-muted)]">
              Rejected
              <input
                value={statusTagRejected}
                onChange={(e) => setStatusTagRejected(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
              />
            </label>
            <label className="text-xs text-[var(--admin-muted)]">
              Archived
              <input
                value={statusTagArchived}
                onChange={(e) => setStatusTagArchived(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
              />
            </label>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-sm font-semibold">Per-User Daily Limits</div>
          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="username"
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              />
              <input
                type="number"
                min={1}
                max={20}
                value={newLimit}
                onChange={(e) => setNewLimit(clampLimit(e.target.value, dailyLimitDefault))}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              />
              <button
                type="button"
                onClick={addOrUpdateUserLimit}
                className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white"
              >
                Add / Update
              </button>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--admin-surface)] text-left text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-3 py-2">Username</th>
                    <th className="px-3 py-2">Limit</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)] bg-[var(--admin-surface)]">
                  {limitRows.length ? (
                    limitRows.map((row) => (
                      <tr key={row.username}>
                        <td className="px-3 py-2 font-medium">{row.username}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={row.limit}
                            onChange={(e) => updateLimitValue(row.username, e.target.value)}
                            className="w-20 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => removeUserLimit(row.username)}
                            className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-3 text-[var(--admin-muted)]" colSpan={3}>
                        No user-specific overrides. All users use default limit.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
        {okMsg ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div> : null}

        <div className="mt-5 flex gap-3">
          <button
            disabled={saving}
            onClick={save}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            disabled={saving}
            onClick={load}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
