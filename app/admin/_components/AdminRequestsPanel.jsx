'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { readJsonSafe } from '../../../lib/readJsonSafe';

const STATUS_TABS = [
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'available_now', label: 'Available Now' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'archived', label: 'Archived' },
  { key: 'all', label: 'All' },
];

const STATUS_CHOICES = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'available_now', label: 'Available Now' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'archived', label: 'Archived' },
];

function fmtDate(ts) {
  const n = Number(ts || 0);
  if (!n) return '—';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '—';
  }
}

function tmdbImage(path, size = 'w154') {
  const p = String(path || '').trim();
  if (!p) return '/images/placeholder.png';
  if (p.startsWith('http')) return p;
  return `https://image.tmdb.org/t/p/${size}${p}`;
}

function mediaLabel(type) {
  return String(type || '').toLowerCase() === 'tv' ? 'Series' : 'Movie';
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200';
  if (s === 'approved') return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
  if (s === 'available_now') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (s === 'rejected') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (s === 'archived') return 'border-neutral-700 bg-neutral-800/40 text-neutral-300';
  return 'border-neutral-700 bg-neutral-800/40 text-neutral-200';
}

function statusLabel(tags, status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return String(tags?.pending || 'Pending');
  if (s === 'approved') return String(tags?.approved || 'Approved');
  if (s === 'available_now') return String(tags?.availableNow || 'Available Now');
  if (s === 'rejected') return String(tags?.rejected || 'Rejected');
  if (s === 'archived') return String(tags?.archived || 'Archived');
  return s || 'Unknown';
}

export default function AdminRequestsPanel() {
  const [tab, setTab] = useState('active');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({
    pending: 0,
    approved: 0,
    available_now: 0,
    rejected: 0,
    archived: 0,
    total: 0,
  });
  const [statusTags, setStatusTags] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams();
      qs.set('status', tab);
      if (tab === 'all' || tab === 'archived') qs.set('includeArchived', 'true');
      const r = await fetch(`/api/admin/requests?${qs.toString()}`, { cache: 'no-store' });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load requests.');
      setItems(Array.isArray(j?.items) ? j.items : []);
      setCounts(j?.counts || {});
      setStatusTags(j?.settings?.statusTags || {});
    } catch (e) {
      setErr(e?.message || 'Failed to load requests.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const topStats = useMemo(
    () => [
      { label: 'Pending', value: Number(counts?.pending || 0), key: 'pending' },
      { label: 'Approved', value: Number(counts?.approved || 0), key: 'approved' },
      { label: 'Available Now', value: Number(counts?.available_now || 0), key: 'available_now' },
      { label: 'Rejected', value: Number(counts?.rejected || 0), key: 'rejected' },
      { label: 'Archived', value: Number(counts?.archived || 0), key: 'archived' },
      { label: 'Total', value: Number(counts?.total || 0), key: 'total' },
    ],
    [counts]
  );

  const runStatusUpdate = async (id, nextStatus) => {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          id,
          status: nextStatus,
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to update status.');
      const notified = Number(j?.notified || 0);
      setOkMsg(
        notified > 0
          ? `Status updated. Notifications sent to ${notified} reminder subscriber${notified > 1 ? 's' : ''}.`
          : 'Status updated.'
      );
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to update status.');
    } finally {
      setBusy(false);
    }
  };

  const runArchiveDefaults = async () => {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'archive',
          statuses: ['available_now', 'rejected'],
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to archive requests.');
      setOkMsg(`Archived ${Number(j?.archived || 0)} request(s).`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to archive requests.');
    } finally {
      setBusy(false);
    }
  };

  const runArchiveOne = async (id) => {
    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'archive',
          ids: [id],
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to archive request.');
      setOkMsg(`Archived ${Number(j?.archived || 0)} request(s).`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to archive request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Requests Queue</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Manage requested titles, workflow statuses, and archive completed/rejected entries.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={loading || busy}
            onClick={load}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            disabled={loading || busy}
            onClick={runArchiveDefaults}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Archive Completed/Rejected
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {topStats.map((stat) => (
          <div key={stat.key} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">{stat.label}</div>
            <div className="text-lg font-semibold">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition ' +
              (tab === x.key
                ? 'border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text)]'
                : 'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-muted)] hover:bg-black/10')
            }
          >
            {x.label}
          </button>
        ))}
      </div>

      {err ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {okMsg ? <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div> : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="overflow-auto">
          <table className="min-w-[1120px] w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2">Demand</th>
                <th className="px-3 py-2">Reminders</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    Loading…
                  </td>
                </tr>
              ) : !items.length ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    No requests found for this filter.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="hover:bg-black/5">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <img
                          src={tmdbImage(row?.posterPath)}
                          alt={row?.title || ''}
                          className="h-12 w-8 shrink-0 rounded object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{row?.title || `TMDB #${row?.tmdbId || ''}`}</div>
                          <div className="truncate text-xs text-[var(--admin-muted)]">
                            TMDB {row?.tmdbId || '—'}
                            {row?.releaseDate ? ` · ${String(row.releaseDate).slice(0, 4)}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{mediaLabel(row?.mediaType)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                      <div>{fmtDate(row?.requestedAt)}</div>
                      <div>Updated: {fmtDate(row?.updatedAt)}</div>
                    </td>
                    <td className="px-3 py-2">{Number(row?.requestCount || 0)}</td>
                    <td className="px-3 py-2">{Array.isArray(row?.reminderSubscribers) ? row.reminderSubscribers.length : 0}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(row?.status)}`}>
                        {statusLabel(statusTags, row?.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        <select
                          disabled={busy}
                          value={String(row?.status || '').toLowerCase()}
                          onChange={(e) => runStatusUpdate(row.id, e.target.value)}
                          className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-[--brand]/30 disabled:opacity-60"
                        >
                          {STATUS_CHOICES.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {statusLabel(statusTags, opt.key)}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={busy || String(row?.status || '').toLowerCase() === 'archived'}
                          onClick={() => runArchiveOne(row.id)}
                          className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10 disabled:opacity-60"
                        >
                          Archive
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
