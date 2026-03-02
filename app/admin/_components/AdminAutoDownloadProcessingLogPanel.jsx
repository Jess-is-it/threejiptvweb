'use client';

import { useEffect, useMemo, useState } from 'react';

import HelpTooltip from './HelpTooltip';
import NotesButton from './NotesButton';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function StatusPill({ status }) {
  const s = String(status || '').toLowerCase();
  const cls =
    s === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : 'border-red-500/30 bg-red-500/10 text-red-200';
  return (
    <span className={cx('inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium', cls)}>
      {status || '—'}
    </span>
  );
}

export default function AdminAutoDownloadProcessingLogPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [logs, setLogs] = useState([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Shows cleanup/rename/move operations performed by the Processing worker.',
        'Use this when something fails (missing files, subtitle cleanup, multiple video files, permission issues).',
      ],
    },
    {
      title: 'Details',
      items: ['Click View to see the full JSON summary (moved/kept/deleted files, old/new names, and errors).'],
    },
  ];

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/autodownload/processing-log?limit=200', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load logs.');
      setLogs(Array.isArray(j.logs) ? j.logs : []);
    } catch (e) {
      setErr(e?.message || 'Failed to load logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const clearLogs = async () => {
    if (!confirm('Clear all Processing Log entries? This cannot be undone.')) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/processing-log', { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to clear logs.');
      const deleted = Number(j?.deleted || 0);
      setSelected(null);
      setOk(`Cleared ${deleted} processing log entr${deleted === 1 ? 'y' : 'ies'}.`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to clear logs.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return logs;
    return (logs || []).filter((x) => {
      const hay = `${x?.title || ''} ${x?.type || ''} ${x?.status || ''} ${x?.error || ''}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [logs, q]);

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Processing Log</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">Tracks cleanup/rename actions and errors.</div>
        </div>
        <div className="flex items-center gap-2">
          <NotesButton title="Processing Log — Notes" sections={notes} />
          <div className="inline-flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-64 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
            <HelpTooltip text="Search by title, type, status, or error message." />
          </div>
          <button
            onClick={load}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            onClick={clearLogs}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Clear Log
          </button>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Final Dir</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((x) => (
              <tr key={x.id} className="border-t border-[var(--admin-border)]">
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.createdAt ? new Date(x.createdAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2">{x.type || '—'}</td>
                <td className="px-3 py-2 font-medium">{x.title || '—'}</td>
                <td className="px-3 py-2">
                  <StatusPill status={x.status} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{x.finalDir || '—'}</td>
                <td className="px-3 py-2 text-xs text-red-200">{x.error || ''}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelected(x)}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                  No logs.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{selected.title || 'Details'}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  {selected.type || '—'} · {selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Renames / Moves</div>
                <div className="mt-1 text-sm font-semibold">
                  {Number(selected?.summary?.movedTotal ?? selected?.summary?.moved?.length ?? 0) || 0}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Deleted Files</div>
                <div className="mt-1 text-sm font-semibold">
                  {Number(selected?.summary?.deletedTotal ?? selected?.summary?.deleted?.length ?? 0) || 0}
                </div>
              </div>
            </div>

            <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
              {JSON.stringify(selected?.summary || selected, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
