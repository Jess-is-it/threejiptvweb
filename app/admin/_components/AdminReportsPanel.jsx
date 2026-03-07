'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Square, Flag, Ban, RefreshCw, X } from 'lucide-react';
import { readJsonSafe } from '../../../lib/readJsonSafe';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function fmt(ts) {
  const n = Number(ts || 0);
  if (!n) return '';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '';
  }
}

const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'ignored', label: 'Ignored' },
  { key: 'all', label: 'All' },
];

export default function AdminReportsPanel() {
  const [tab, setTab] = useState('open');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveMsg, setResolveMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const qs = tab === 'all' ? '' : `?status=${encodeURIComponent(tab)}`;
      const r = await fetch(`/api/admin/reports${qs}`, { cache: 'no-store' });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load reports');
      setItems(Array.isArray(j.items) ? j.items : []);
      setSelected(new Set());
    } catch (e) {
      setErr(e?.message || 'Failed to load reports');
      setItems([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const ids = useMemo(() => items.map((r) => String(r.id)), [items]);
  const allSelected = useMemo(() => ids.length > 0 && ids.every((id) => selected.has(id)), [ids, selected]);
  const selectedCount = selected.size;

  const toggleAll = () => {
    setSelected((s) => {
      const next = new Set(s);
      if (allSelected) return new Set();
      ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleOne = (id) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runAction = async ({ action, ids, message = '' }) => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/reports', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ids, message }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Update failed');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openResolveFor = (ids) => {
    setResolveMsg('');
    setResolveOpen(true);
    setSelected(new Set(ids.map(String)));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Reports</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Review user reports from the player and respond with a resolution message.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            disabled={loading}
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                tab === t.key
                  ? 'border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text)]'
                  : 'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-muted)] hover:bg-black/10'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {selectedCount ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs text-[var(--admin-muted)]">{selectedCount} selected</div>
            <button
              disabled={busy}
              onClick={() => openResolveFor(Array.from(selected))}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              <Flag size={16} /> Resolve
            </button>
            <button
              disabled={busy}
              onClick={() => runAction({ action: 'ignore', ids: Array.from(selected) })}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              <Ban size={16} /> Ignore
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{err}</div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="overflow-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="w-12 px-4 py-3 text-left">
                  <button onClick={toggleAll} aria-label="Select all">
                    {allSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Issue</th>
                <th className="px-4 py-3 text-left">Content</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[var(--admin-muted)]">
                    Loading…
                  </td>
                </tr>
              ) : !items.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[var(--admin-muted)]">
                    No reports.
                  </td>
                </tr>
              ) : (
                items.map((r) => {
                  const id = String(r.id);
                  const isSel = selected.has(id);
                  return (
                    <tr key={id} className="hover:bg-black/5">
                      <td className="px-4 py-3">
                        <button onClick={() => toggleOne(id)} aria-label="Select report">
                          {isSel ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[var(--admin-muted)]">{fmt(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{r?.user?.username || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[var(--admin-text)]">{r.choiceTitle || r.choice || '—'}</div>
                        {r.message ? <div className="mt-1 line-clamp-2 text-xs text-[var(--admin-muted)]">{r.message}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{r?.meta?.title || '—'}</div>
                        {r?.meta?.type ? (
                          <div className="mt-1 text-xs text-[var(--admin-muted)]">
                            {r.meta.type} · {r.meta.id || '—'}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cx(
                            'inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold',
                            r.status === 'open'
                              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
                              : r.status === 'resolved'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                : 'border-neutral-700 bg-neutral-800/40 text-neutral-300'
                          )}
                        >
                          {r.status || 'open'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            disabled={busy}
                            onClick={() => openResolveFor([id])}
                            className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                            style={{ backgroundColor: 'var(--brand)' }}
                          >
                            Resolve
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => runAction({ action: 'ignore', ids: [id] })}
                            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-1.5 text-xs text-[var(--admin-text)] hover:bg-black/10 disabled:opacity-60"
                          >
                            Ignore
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

      {resolveOpen ? (
        <div className="fixed inset-0 z-[90]">
          <button
            className="absolute inset-0 bg-black/60"
            aria-label="Close"
            onClick={() => setResolveOpen(false)}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Resolve report(s)</div>
                <div className="mt-1 text-sm text-[var(--admin-muted)]">
                  A resolution message is required. Users will receive it as a notification.
                </div>
              </div>
              <button
                className="rounded-lg p-2 text-[var(--admin-muted)] hover:bg-black/10"
                onClick={() => setResolveOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm text-[var(--admin-muted)]">Message</label>
              <textarea
                value={resolveMsg}
                onChange={(e) => setResolveMsg(e.target.value)}
                rows={5}
                className="w-full rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                placeholder="Explain what was fixed or what the user should do…"
              />
              <div className="mt-2 text-xs text-[var(--admin-muted)]">
                Selected: {selectedCount}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                disabled={busy}
                className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                onClick={() => setResolveOpen(false)}
              >
                Cancel
              </button>
              <button
                disabled={busy || !resolveMsg.trim()}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--brand)' }}
                onClick={async () => {
                  const ids = Array.from(selected);
                  await runAction({ action: 'resolve', ids, message: resolveMsg.trim() });
                  setResolveOpen(false);
                }}
              >
                {busy ? 'Saving…' : 'Resolve'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
