'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { readJsonSafe } from '../../../lib/readJsonSafe';

const STATUS_TABS = [
  { key: 'active', kind: 'system' },
  { key: 'pending', kind: 'status' },
  { key: 'approved', kind: 'status' },
  { key: 'available_now', kind: 'status' },
  { key: 'rejected', kind: 'status' },
  { key: 'archived', kind: 'status' },
  { key: 'all', kind: 'system' },
];

const STATUS_CHOICES = [
  { key: 'pending' },
  { key: 'approved' },
  { key: 'available_now' },
  { key: 'rejected' },
  { key: 'archived' },
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

function requestTargetLabel(row) {
  if (String(row?.mediaType || '').toLowerCase() !== 'tv') return '';
  const label = String(row?.requestDetailLabel || '').trim();
  if (label) return label;
  const scope = String(row?.requestScope || '').toLowerCase();
  if (scope === 'season' && Number(row?.seasonNumber || 0) > 0) {
    return `Season ${Number(row.seasonNumber)}`;
  }
  if (scope === 'episode' && Number(row?.seasonNumber || 0) > 0 && Number(row?.episodeNumber || 0) > 0) {
    return `Season ${Number(row.seasonNumber)} · Episode ${Number(row.episodeNumber)}`;
  }
  return 'Whole Series';
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

function tabLabel(tags, tabDef) {
  if (tabDef.kind === 'status') return statusLabel(tags, tabDef.key);
  if (tabDef.key === 'active') return 'Active';
  if (tabDef.key === 'all') return 'All';
  return tabDef.key;
}

function normalizeId(id) {
  return String(id || '').trim();
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
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('approved');

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
      setSelectedIds([]);
    } catch (e) {
      setErr(e?.message || 'Failed to load requests.');
      setItems([]);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const topStats = useMemo(
    () => [
      { label: statusLabel(statusTags, 'pending'), value: Number(counts?.pending || 0), key: 'pending' },
      { label: statusLabel(statusTags, 'approved'), value: Number(counts?.approved || 0), key: 'approved' },
      { label: statusLabel(statusTags, 'available_now'), value: Number(counts?.available_now || 0), key: 'available_now' },
      { label: statusLabel(statusTags, 'rejected'), value: Number(counts?.rejected || 0), key: 'rejected' },
      { label: statusLabel(statusTags, 'archived'), value: Number(counts?.archived || 0), key: 'archived' },
      { label: 'Total', value: Number(counts?.total || 0), key: 'total' },
    ],
    [counts, statusTags]
  );

  const visibleIds = useMemo(
    () =>
      items
        .map((x) => normalizeId(x?.id))
        .filter(Boolean),
    [items]
  );

  const selectedCount = selectedIds.length;
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggleSelectOne = (id) => {
    const rid = normalizeId(id);
    if (!rid) return;
    setSelectedIds((prev) => {
      if (prev.includes(rid)) return prev.filter((x) => x !== rid);
      return [...prev, rid];
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) return prev.filter((x) => !visibleIds.includes(x));
      const out = new Set([...prev, ...visibleIds]);
      return [...out];
    });
  };

  const runStatusUpdate = async (idsInput, nextStatus) => {
    const ids = (Array.isArray(idsInput) ? idsInput : [idsInput])
      .map((x) => normalizeId(x))
      .filter(Boolean);
    if (!ids.length) return;

    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          ids,
          status: nextStatus,
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to update status.');
      const updated = Number(j?.updated || ids.length);
      const notified = Number(j?.notified || 0);
      setOkMsg(
        notified > 0
          ? `Updated ${updated} request(s). Notifications sent to ${notified} reminder subscriber${notified > 1 ? 's' : ''}.`
          : `Updated ${updated} request(s).`
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

  const runArchiveSelected = async (idsInput) => {
    const ids = (Array.isArray(idsInput) ? idsInput : [idsInput])
      .map((x) => normalizeId(x))
      .filter(Boolean);
    if (!ids.length) return;

    setBusy(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/requests', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'archive',
          ids,
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to archive request(s).');
      setOkMsg(`Archived ${Number(j?.archived || 0)} request(s).`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to archive request(s).');
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
          <button
            key={stat.key}
            type="button"
            onClick={() => {
              if (stat.key === 'total') setTab('all');
              else setTab(stat.key);
            }}
            className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-left transition hover:bg-black/10"
            title={stat.key === 'total' ? 'Show all requests' : `Filter by ${stat.label}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">{stat.label}</div>
            <div className="text-lg font-semibold">{stat.value}</div>
          </button>
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
            {tabLabel(statusTags, x)}
          </button>
        ))}
      </div>

      {selectedCount ? (
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm text-[var(--admin-muted)]">{selectedCount} selected</div>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              disabled={busy}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[--brand]/30 disabled:opacity-60"
            >
              {STATUS_CHOICES.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {statusLabel(statusTags, opt.key)}
                </option>
              ))}
            </select>
            <button
              disabled={busy}
              onClick={() => runStatusUpdate(selectedIds, bulkStatus)}
              className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Apply to Selected
            </button>
            <button
              disabled={busy}
              onClick={() => runArchiveSelected(selectedIds)}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs hover:bg-black/10 disabled:opacity-60"
            >
              Archive Selected
            </button>
            <button
              disabled={busy}
              onClick={() => setSelectedIds([])}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs hover:bg-black/10 disabled:opacity-60"
            >
              Clear Selection
            </button>
          </div>
        </div>
      ) : null}

      {err ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {okMsg ? <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div> : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="overflow-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="w-12 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={!visibleIds.length}
                    aria-label="Select all visible requests"
                    className="h-4 w-4 rounded border-[var(--admin-border)] bg-[var(--admin-surface-solid)]"
                  />
                </th>
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
                  <td colSpan={8} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    Loading…
                  </td>
                </tr>
              ) : !items.length ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    No requests found for this filter.
                  </td>
                </tr>
              ) : (
                items.map((row) => {
                  const rowId = normalizeId(row?.id);
                  const rowSelected = selectedIds.includes(rowId);
                  const rowStatus = String(row?.status || '').toLowerCase();
                  return (
                    <tr key={rowId} className={rowSelected ? 'bg-white/[0.03]' : 'hover:bg-black/5'}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={rowSelected}
                          onChange={() => toggleSelectOne(rowId)}
                          aria-label={`Select ${row?.title || rowId}`}
                          className="h-4 w-4 rounded border-[var(--admin-border)] bg-[var(--admin-surface-solid)]"
                        />
                      </td>
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
                              {requestTargetLabel(row) ? `${requestTargetLabel(row)} · ` : ''}
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
                        <button
                          type="button"
                          onClick={() => setTab(rowStatus)}
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(rowStatus)}`}
                          title="Filter queue by this status"
                        >
                          {statusLabel(statusTags, rowStatus)}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-2">
                          <select
                            disabled={busy}
                            value={rowStatus}
                            onChange={(e) => runStatusUpdate([rowId], e.target.value)}
                            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-[--brand]/30 disabled:opacity-60"
                          >
                            {STATUS_CHOICES.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {statusLabel(statusTags, opt.key)}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={busy || rowStatus === 'archived'}
                            onClick={() => runArchiveSelected([rowId])}
                            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10 disabled:opacity-60"
                          >
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
