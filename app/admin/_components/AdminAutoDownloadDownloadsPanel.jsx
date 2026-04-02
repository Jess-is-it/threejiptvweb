'use client';

import { useEffect, useMemo, useState } from 'react';

import AdminAutoDownloadSelectionSettingsButton from './AdminAutoDownloadSelectionSettingsButton';
import HelpTooltip from './HelpTooltip';
import NotesButton from './NotesButton';

function fmtBytes(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtPct(p) {
  const v = Number(p || 0);
  if (!Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function StatusPill({ status }) {
  const s = String(status || '').toLowerCase();
  const cls =
    s === 'downloading'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
      : s === 'completed'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
        : s === 'processing'
          ? 'border-violet-500/30 bg-violet-500/10 text-violet-200'
          : s === 'cleaned'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            : s === 'failed'
              ? 'border-red-500/30 bg-red-500/10 text-red-200'
              : s === 'deleted'
                ? 'border-neutral-600 bg-neutral-800/40 text-neutral-200'
                : 'border-neutral-600 bg-neutral-800/40 text-neutral-200';
  return (
    <span className={cx('inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium', cls)}>
      {status || 'Queued'}
    </span>
  );
}

function Button({ kind = 'default', ...props }) {
  const base = 'rounded-lg px-3 py-2 text-sm transition disabled:opacity-60';
  const cls =
    kind === 'primary'
      ? `${base} text-white`
      : kind === 'danger'
        ? `${base} border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/15`
        : `${base} border border-[var(--admin-border)] bg-[var(--admin-surface-2)] hover:bg-black/10`;
  return (
    <button
      {...props}
      className={cls + (props.className ? ` ${props.className}` : '')}
      style={kind === 'primary' ? { backgroundColor: 'var(--brand)' } : undefined}
    />
  );
}

export default function AdminAutoDownloadDownloadsPanel({ type = 'movie' }) {
  const t = type === 'series' ? 'series' : 'movie';
  const titleLabel = t === 'series' ? 'Series' : 'Movies';

  const notes = useMemo(() => {
    const rules =
      t === 'series'
        ? 'Series can be multi-video packs; the processor will normalize episodes when metadata is available.'
        : 'Movies must resolve to a single main video file; multiple main videos are treated as an error.';
    return [
      {
        title: 'Purpose',
        items: [
          `${titleLabel} is a dashboard of managed jobs and queue items.`,
          'Items are queued automatically from the selection strategy. Manual queue add is disabled.',
        ],
      },
      {
        title: 'Statuses & actions',
        items: [
          'Sync refreshes progress/status from the Engine Host.',
          'Process runs cleanup/rename/move for Completed jobs (use when auto worker is not running).',
          'Delete removes the job and deletes files (confirmation required).',
        ],
      },
      { title: 'Rules', items: [rules] },
    ];
  }, [t, titleLabel]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerProgress, setTriggerProgress] = useState(0);

  const [items, setItems] = useState([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!isTriggering) return;
    const id = setInterval(() => {
      setTriggerProgress((prev) => {
        if (prev >= 92) return prev;
        if (prev < 50) return Math.min(92, prev + 8);
        return Math.min(92, prev + 3);
      });
    }, 300);
    return () => clearInterval(id);
  }, [isTriggering]);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/admin/autodownload/downloads?type=${encodeURIComponent(t)}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load.');
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setErr(e?.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const st = status.trim().toLowerCase();
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;
    return (items || []).filter((x) => {
      if (st !== 'all' && String(x?.status || '').toLowerCase() !== st) return false;
      const addedAt = Number(x?.addedAt || 0) || 0;
      if (fromMs && addedAt && addedAt < fromMs) return false;
      if (toMs && addedAt && addedAt > toMs) return false;
      if (!qq) return true;
      const hay = `${x?.title || ''} ${x?.year || ''} ${x?.qbName || ''} ${x?.id || ''} ${x?.finalDir || ''}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [items, q, status, fromDate, toDate]);

  const sync = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/downloads/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: t }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Sync failed.');
      setOk('Synced.');
      await load();
    } catch (e) {
      setErr(e?.message || 'Sync failed.');
    } finally {
      setBusy(false);
    }
  };

  const testAutoDownload = async () => {
    setBusy(true);
    setIsTriggering(true);
    setTriggerProgress(8);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/scheduler/tick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true, type: t }),
      });
      setTriggerProgress(55);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Test run failed.');

      const selected = Number(j?.result?.selection?.movies?.log?.totalSelected || j?.result?.selection?.movies?.selected?.length || 0);
      const started = Number(j?.result?.dispatch?.started || 0);
      const failed = Number(j?.result?.dispatch?.failed || 0);
      setOk(`Test run triggered. Selected: ${selected} · Started: ${started} · Failed: ${failed}`);
      setTriggerProgress(82);
      await load();
      setTriggerProgress(100);
    } catch (e) {
      setErr(e?.message || 'Test run failed.');
      setTriggerProgress(100);
    } finally {
      setBusy(false);
      setTimeout(() => {
        setIsTriggering(false);
        setTriggerProgress(0);
      }, 500);
    }
  };

  const deleteAll = async () => {
    if (!confirm(`Delete ALL ${titleLabel.toLowerCase()} jobs and remove their files from qBittorrent?`)) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/downloads/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: t, action: 'delete_all' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Delete all failed.');
      setOk(`Deleted ${Number(j?.result?.deletedRows || 0)} rows and ${Number(j?.result?.deletedTorrents || 0)} qB torrents.`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Delete all failed.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id, action) => {
    const label = action === 'delete' ? 'Delete this item (and files)?' : null;
    if (label && !confirm(label)) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/downloads/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: t, id, action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Action failed.');
      setOk('Updated.');
      await load();
    } catch (e) {
      setErr(e?.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const processOne = async (id) => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/processing/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: t, id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Processing failed.');
      setOk('Processed.');
      await load();
    } catch (e) {
      setErr(e?.message || 'Processing failed.');
    } finally {
      setBusy(false);
    }
  };

  // Optional polling
  useEffect(() => {
    if (!autoRefresh) return;
    let canceled = false;
    const tick = async () => {
      try {
        await fetch('/api/admin/autodownload/downloads/sync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: t }),
        });
        await load();
      } catch {}
      if (!canceled) setTimeout(tick, 20000);
    };
    const id = setTimeout(tick, 20000);
    return () => {
      canceled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, t]);

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">{titleLabel}</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Managed jobs (qBittorrent). Use Sync to refresh progress from the Engine Host.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotesButton title={`${titleLabel} — Notes`} sections={notes} />
          {t === 'series' ? <AdminAutoDownloadSelectionSettingsButton type="series" /> : null}
          {t === 'movie' ? (
            <Button
              kind="primary"
              onClick={testAutoDownload}
              disabled={loading || busy}
              title="Manually trigger one AutoDownload cycle."
            >
              Trigger AutoDownload Once
            </Button>
          ) : null}
          {t === 'movie' ? (
            <Button kind="danger" onClick={deleteAll} disabled={loading || busy}>
              Delete All
            </Button>
          ) : null}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--admin-muted)]">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto refresh
          </label>
          <Button onClick={sync} disabled={loading || busy}>
            Sync
          </Button>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}
      {t === 'movie' && isTriggering ? (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-[var(--admin-muted)]">
            <span>Triggering AutoDownload manually…</span>
            <span>{triggerProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${triggerProgress}%`, backgroundColor: 'var(--brand)' }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-64 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
            <HelpTooltip text="Search by title, year, TMDB ID, job ID, qBittorrent name, or final folder path." />
          </div>
          <div className="inline-flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
            <option value="all">All statuses</option>
            <option value="queued">Queued</option>
            <option value="downloading">Downloading</option>
            <option value="completed">Completed</option>
            <option value="processing">Processing</option>
            <option value="cleaned">Cleaned</option>
            <option value="failed">Failed</option>
            <option value="deleted">Deleted</option>
            </select>
            <HelpTooltip text="Filter jobs by pipeline status." />
          </div>
          <div className="inline-flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              title="From"
            />
            <HelpTooltip text="Filter by Added date (from)." />
          </div>
          <div className="inline-flex items-center gap-2">
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              title="To"
            />
            <HelpTooltip text="Filter by Added date (to)." />
          </div>
        </div>

        <div className="text-xs text-[var(--admin-muted)]">
          {loading ? 'Loading…' : `${filtered.length} item${filtered.length === 1 ? '' : 's'}`}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Progress</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Added</th>
              <th className="px-3 py-2">Completed</th>
              <th className="px-3 py-2">Cleaned</th>
              <th className="px-3 py-2">Final</th>
              <th className="px-3 py-2">Error</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((x) => (
              <tr key={x.id} className="border-t border-[var(--admin-border)]">
                <td className="px-3 py-2">
                  <div className="font-medium">{x.title || x.qbName || 'Untitled'}</div>
                  <div className="mt-1 line-clamp-1 text-xs text-[var(--admin-muted)]">
                    {x.year ? `${x.year} · ` : ''}
                    {x.qbName || ''}
                    {x.tmdb?.id ? ` · TMDB:${x.tmdb.id}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={x.status} />
                </td>
                <td className="px-3 py-2">{fmtPct(x.progress)}</td>
                <td className="px-3 py-2">{fmtBytes(x.sizeBytes)}</td>
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.addedAt ? new Date(x.addedAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.completedAt ? new Date(x.completedAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.cleanedAt ? new Date(x.cleanedAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{x.finalDir || '—'}</td>
                <td className="px-3 py-2 text-xs text-red-200">{x.error || ''}</td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex items-center gap-2">
                    {String(x.status || '').toLowerCase() === 'completed' ? (
                      <Button
                        kind="primary"
                        onClick={() => processOne(x.id)}
                        disabled={busy || loading}
                        className="px-2 py-1"
                      >
                        Process
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => act(x.id, 'pause')}
                      disabled={busy || loading || x.status === 'Deleted' || !x.qbHash}
                      className="px-2 py-1"
                    >
                      Pause
                    </Button>
                    <Button
                      onClick={() => act(x.id, 'resume')}
                      disabled={busy || loading || x.status === 'Deleted' || !x.qbHash}
                      className="px-2 py-1"
                    >
                      Resume
                    </Button>
                    <Button
                      onClick={() => act(x.id, 'retry')}
                      disabled={busy || loading || x.status === 'Deleted'}
                      className="px-2 py-1"
                    >
                      Retry
                    </Button>
                    <Button onClick={() => setSelected(x)} disabled={busy || loading} className="px-2 py-1">
                      Details
                    </Button>
                    <Button
                      kind="danger"
                      onClick={() => act(x.id, 'delete')}
                      disabled={busy || loading || x.status === 'Deleted'}
                      className="px-2 py-1"
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                  No items.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelected(null)}>
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{selected.title || 'Details'}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  {selected.id} · {selected.status || 'Queued'}
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
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
