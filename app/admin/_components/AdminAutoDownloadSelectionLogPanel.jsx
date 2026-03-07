'use client';

import { useEffect, useMemo, useState } from 'react';

import NotesButton from './NotesButton';

function Num({ v }) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '—';
  return String(n);
}

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

function toneStyle(tone = 'neutral') {
  const t = String(tone || 'neutral').trim().toLowerCase();
  return {
    borderColor: `var(--admin-pill-${t}-border)`,
    backgroundColor: `var(--admin-pill-${t}-bg)`,
    color: `var(--admin-pill-${t}-text)`,
  };
}

function isSizeLimitRejected(item) {
  return /filtered by size limit/i.test(String(item?.error || ''));
}

function tmdbIdFromJob(item) {
  const n = Number(item?.tmdb?.id || item?.tmdbId || item?.id || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function prefersQueueRow(next, current, { runId = '' } = {}) {
  if (!current) return true;
  if (!next) return false;

  const rid = String(runId || '').trim();
  const nextSameRun = rid && String(next?.selectionLogId || '').trim() === rid;
  const curSameRun = rid && String(current?.selectionLogId || '').trim() === rid;
  if (nextSameRun !== curSameRun) return nextSameRun;

  const nextDeleted = String(next?.status || '').trim().toLowerCase() === 'deleted';
  const curDeleted = String(current?.status || '').trim().toLowerCase() === 'deleted';
  if (nextDeleted !== curDeleted) return !nextDeleted;

  const nextAddedAt = Number(next?.addedAt || 0) || 0;
  const curAddedAt = Number(current?.addedAt || 0) || 0;
  if (nextAddedAt !== curAddedAt) return nextAddedAt > curAddedAt;

  const nextUpdatedAt = Number(next?.updatedAt || next?.cleanedAt || next?.completedAt || 0) || 0;
  const curUpdatedAt = Number(current?.updatedAt || current?.cleanedAt || current?.completedAt || 0) || 0;
  return nextUpdatedAt > curUpdatedAt;
}

function getDisplayStatus(item = {}) {
  const status = String(item?.status || '').trim();
  const s = status.toLowerCase();
  const releaseState = String(item?.releaseState || '').trim().toLowerCase();

  if (releaseState === 'released') {
    return { value: 'deployed_in_xui', label: 'Deployed in XUI' };
  }
  if (s === 'cleaned' && (releaseState === '' || releaseState === 'waiting')) {
    return { value: 'waiting_to_release', label: 'Waiting to be released' };
  }
  return { value: s || 'queued', label: status || 'Queued' };
}

function StatusPill({ item }) {
  const statusInfo = getDisplayStatus(item);
  const s = String(statusInfo?.value || '').toLowerCase();
  const tone =
    s === 'downloading'
      ? 'info'
      : s === 'completed'
        ? 'success'
        : s === 'processing'
          ? 'processing'
          : s === 'cleaned'
            ? 'success'
            : s === 'waiting_to_release'
              ? 'warning'
              : s === 'deployed_in_xui'
                ? 'accent'
                : s === 'failed'
                  ? 'danger'
                  : s === 'deleted'
                    ? 'neutral'
                    : 'neutral';
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium" style={toneStyle(tone)}>
      {statusInfo?.label || 'Queued'}
    </span>
  );
}

export default function AdminAutoDownloadSelectionLogPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerProgress, setTriggerProgress] = useState(0);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [logs, setLogs] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsErr, setJobsErr] = useState('');
  const [jobs, setJobs] = useState([]);
  const [jobsQ, setJobsQ] = useState('');
  const [jobsStatus, setJobsStatus] = useState('all');
  const [selectedJob, setSelectedJob] = useState(null);
  const [releaseEditOpen, setReleaseEditOpen] = useState(false);
  const [releaseDateDraft, setReleaseDateDraft] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseErr, setReleaseErr] = useState('');

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/autodownload/selection-log?limit=200', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load selection log.');
      setLogs(Array.isArray(j.logs) ? j.logs : []);
    } catch (e) {
      setErr(e?.message || 'Failed to load selection log.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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

  const openRun = async (run) => {
    setSelectedRun(run);
    setSelectedJob(null);
    setJobsErr('');
    setJobsLoading(true);
    setJobs([]);
    setReleaseEditOpen(false);
    setReleaseDateDraft(String(run?.releaseDate || '').trim());
    setReleaseErr('');
    try {
      const r = await fetch('/api/admin/autodownload/downloads?type=movie&seed=0&dispatch=0', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load movie jobs.');
      const allJobs = Array.isArray(j.items) ? j.items : [];
      const runRows = Array.isArray(run?.selectedItems) ? run.selectedItems : [];
      const runTmdbIds = new Set(runRows.map((x) => tmdbIdFromJob(x)).filter((x) => x > 0));
      const queueByTmdb = new Map();
      for (const job of allJobs) {
        const tmdbId = tmdbIdFromJob(job);
        if (!tmdbId) continue;
        const prev = queueByTmdb.get(tmdbId);
        if (prefersQueueRow(job, prev, { runId: run?.id })) {
          queueByTmdb.set(tmdbId, job);
        }
      }

      if (!runRows.length) {
        setJobs([]);
        return;
      }

      const merged = runRows.map((x, idx) => {
        const tmdbId = tmdbIdFromJob(x);
        const matched = tmdbId > 0 ? queueByTmdb.get(tmdbId) : null;
        if (matched) {
          return {
            ...matched,
            _selectionBucket: x?.bucket || '',
            _selectionProvider: x?.provider || '',
          };
        }
        return {
          id: `${String(run?.id || 'run')}:${tmdbId || idx}`,
          title: x?.title || 'Untitled',
          year: x?.year || '',
          tmdb: tmdbId > 0 ? { id: tmdbId } : null,
          status: 'Not in queue',
          progress: null,
          sizeBytes: null,
          addedAt: null,
          error: '',
          _selectionBucket: x?.bucket || '',
          _selectionProvider: x?.provider || '',
        };
      });

      setJobs(merged.filter((x) => (runTmdbIds.size ? runTmdbIds.has(tmdbIdFromJob(x)) : true)));
    } catch (e) {
      setJobsErr(e?.message || 'Failed to load movie jobs.');
    } finally {
      setJobsLoading(false);
    }
  };

  const filteredJobs = useMemo(() => {
    const needle = String(jobsQ || '').trim().toLowerCase();
    const st = String(jobsStatus || 'all').trim().toLowerCase();
    return (Array.isArray(jobs) ? jobs : []).filter((x) => {
      const displayStatus = getDisplayStatus(x);
      if (st === 'size_rejected') {
        if (!isSizeLimitRejected(x)) return false;
      } else if (st !== 'all' && String(displayStatus?.value || '').toLowerCase() !== st) {
        return false;
      }
      if (!needle) return true;
      const hay =
        `${x?.title || ''} ${x?.year || ''} ${x?.qbName || ''} ${x?.tmdb?.id || ''} ${x?._selectionBucket || ''} ${x?._selectionProvider || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [jobs, jobsQ, jobsStatus]);

  const canEditSelectedRunReleaseDate = useMemo(() => {
    if (!selectedRun) return false;
    if (Number(selectedRun?.releasedAt || 0) > 0) return false;
    const hasReleasedRows = (Array.isArray(jobs) ? jobs : []).some(
      (x) => String(x?.releaseState || '').toLowerCase() === 'released'
    );
    return !hasReleasedRows;
  }, [selectedRun, jobs]);

  const saveSelectedRunReleaseDate = async () => {
    if (!selectedRun?.id) return;
    const nextDate = String(releaseDateDraft || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      setReleaseErr('Invalid date format. Use YYYY-MM-DD.');
      return;
    }

    setReleaseBusy(true);
    setReleaseErr('');
    setErr('');
    try {
      const r = await fetch('/api/admin/autodownload/selection-log', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'set_release_date',
          logId: selectedRun.id,
          releaseDate: nextDate,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to update release date.');

      const nextLog = j?.log || null;
      if (nextLog) {
        setSelectedRun((prev) => (prev ? { ...prev, ...nextLog } : prev));
        setLogs((prev) =>
          (Array.isArray(prev) ? prev : []).map((x) =>
            String(x?.id || '') === String(nextLog?.id || '') ? { ...x, ...nextLog } : x
          )
        );
      }
      setJobs((prev) =>
        (Array.isArray(prev) ? prev : []).map((x) =>
          String(x?.selectionLogId || '').trim() === String(selectedRun?.id || '').trim() &&
          String(x?.releaseState || '').toLowerCase() !== 'released'
            ? {
                ...x,
                releaseDate: nextDate,
                releaseTag: String(nextLog?.releaseTag || x?.releaseTag || '').trim(),
              }
            : x
        )
      );
      setOk(`Release date updated to ${nextDate}.`);
      setReleaseEditOpen(false);
    } catch (e) {
      setReleaseErr(e?.message || 'Failed to update release date.');
    } finally {
      setReleaseBusy(false);
    }
  };

  const runNow = async () => {
    if (!confirm('Run the Movie Selection Strategy now?')) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/selection-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Selection job failed.');
      if (j?.result?.skipped) setOk(`Skipped: ${j?.result?.reason || 'not due'}`);
      else setOk(`Selected ${j?.result?.log?.totalSelected ?? 0} movie(s).`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Selection job failed.');
    } finally {
      setBusy(false);
    }
  };

  const triggerAutoDownloadOnce = async () => {
    setBusy(true);
    setIsTriggering(true);
    setTriggerProgress(8);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/scheduler/tick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true, type: 'movie' }),
      });
      setTriggerProgress(55);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Trigger failed.');

      const selected = Number(j?.result?.selection?.movies?.log?.totalSelected || j?.result?.selection?.movies?.selected?.length || 0);
      const started = Number(j?.result?.dispatch?.started || 0);
      const failed = Number(j?.result?.dispatch?.failed || 0);
      setOk(`Triggered once. Selected: ${selected} · Started: ${started} · Failed: ${failed}`);
      setTriggerProgress(85);
      await load();
      setTriggerProgress(100);
    } catch (e) {
      setErr(e?.message || 'Trigger failed.');
      setTriggerProgress(100);
    } finally {
      setBusy(false);
      setTimeout(() => {
        setIsTriggering(false);
        setTriggerProgress(0);
      }, 500);
    }
  };

  const deleteAllMovies = async () => {
    if (
      !confirm(
        'Delete ALL movie jobs + torrents from qBittorrent? (This does NOT purge NAS Movies library folders.)'
      )
    ) {
      return;
    }

    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/downloads/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'movie', action: 'delete_all' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Delete all failed.');
      setOk(
        `Deleted ${Number(j?.result?.deletedRows || 0)} rows, ${Number(j?.result?.deletedTorrents || 0)} qB torrents, and ${Number(
          j?.result?.deletedSelectionLogs || 0
        )} Movie Selection Log entr${Number(j?.result?.deletedSelectionLogs || 0) === 1 ? 'y' : 'ies'}.`
      );
      await load();
    } catch (e) {
      setErr(e?.message || 'Delete all failed.');
    } finally {
      setBusy(false);
    }
  };

  const clearMovieSelectionLog = async () => {
    if (!confirm('Clear all Movie Selection Log entries?')) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/selection-log?type=movie', { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to clear Movie Selection Log.');
      setOk(`Cleared ${Number(j?.deleted || 0)} movie selection log entr${Number(j?.deleted || 0) === 1 ? 'y' : 'ies'}.`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Failed to clear Movie Selection Log.');
    } finally {
      setBusy(false);
    }
  };

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Shows runs of the Movie Selection Strategy (Recent/Classic × Animation/Live Action).',
        'Click a row to open the Movies jobs table in a modal.',
      ],
    },
    {
      title: 'Run Now',
      items: ['Runs the selection immediately (admin debug). It still respects safety checks like mount health and storage limit.'],
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Movie Selection Log</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Daily/interval selection runs for Movie strategy. Click any row to open the Movies jobs table.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="Movie Selection Log — Notes" sections={notes} />
          <button
            onClick={triggerAutoDownloadOnce}
            disabled={loading || busy}
            title="Manually trigger one AutoDownload cycle."
            className="rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            Trigger AutoDownload Once
          </button>
          <button
            onClick={deleteAllMovies}
            disabled={loading || busy}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
            style={{
              ...toneStyle('danger'),
            }}
          >
            Delete All
          </button>
          <button
            onClick={runNow}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {busy ? 'Running…' : 'Run Now'}
          </button>
          <button
            onClick={clearMovieSelectionLog}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Clear Log
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-lg border px-3 py-2 text-sm" style={toneStyle('danger')}>
          {err}
        </div>
      ) : null}
      {ok ? (
        <div className="mt-4 rounded-lg border px-3 py-2 text-sm" style={toneStyle('success')}>
          {ok}
        </div>
      ) : null}
      {isTriggering ? (
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

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Run time</th>
              <th className="px-3 py-2">Release date</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Recent Anim</th>
              <th className="px-3 py-2">Recent Live</th>
              <th className="px-3 py-2">Classic Anim</th>
              <th className="px-3 py-2">Classic Live</th>
              <th className="px-3 py-2">Skipped dup</th>
              <th className="px-3 py-2">Skipped no source</th>
              <th className="px-3 py-2">Skipped storage</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((x) => (
              <tr
                key={x.id}
                onClick={() => openRun(x)}
                className="cursor-pointer border-t border-[var(--admin-border)] transition-colors hover:bg-[var(--admin-hover-bg)]"
              >
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.runAt ? new Date(x.runAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.releaseDate || '—'}
                </td>
                <td className="px-3 py-2">
                  <Num v={x.totalSelected} />
                </td>
                <td className="px-3 py-2">
                  <Num v={x.recentAnimationSelected} />
                </td>
                <td className="px-3 py-2">
                  <Num v={x.recentLiveActionSelected} />
                </td>
                <td className="px-3 py-2">
                  <Num v={x.classicAnimationSelected} />
                </td>
                <td className="px-3 py-2">
                  <Num v={x.classicLiveActionSelected} />
                </td>
                <td className="px-3 py-2">
                  <Num v={x.skippedDuplicatesCount} />
                </td>
                <td className="px-3 py-2">
                  <Num v={x.skippedNoSourceCount} />
                </td>
                <td className="px-3 py-2">
                  <Num v={x.skippedStorageLimitCount} />
                </td>
                <td className="px-3 py-2 text-xs" style={{ color: 'var(--admin-pill-danger-text)' }}>
                  {x.errorMessage || ''}
                </td>
              </tr>
            ))}
            {!loading && logs.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                  No selection runs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedRun ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" onClick={() => setSelectedRun(null)}>
          <div
            className="max-h-[88vh] w-full max-w-7xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Movies Jobs</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  Run: {selectedRun?.runAt ? new Date(selectedRun.runAt).toLocaleString() : '—'} · Selected:{' '}
                  <Num v={selectedRun?.totalSelected} /> · Release: {selectedRun?.releaseDate || '—'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canEditSelectedRunReleaseDate ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReleaseDateDraft(String(selectedRun?.releaseDate || '').trim());
                      setReleaseEditOpen((v) => !v);
                      setReleaseErr('');
                    }}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
                  >
                    {releaseEditOpen ? 'Cancel edit' : 'Edit release date'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedRun(null)}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
                >
                  Close
                </button>
              </div>
            </div>

            {releaseEditOpen && canEditSelectedRunReleaseDate ? (
              <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs text-[var(--admin-muted)]">
                    Release date
                    <input
                      type="date"
                      value={releaseDateDraft}
                      onChange={(e) => setReleaseDateDraft(e.target.value)}
                      className="mt-1 block rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={saveSelectedRunReleaseDate}
                    disabled={releaseBusy || !releaseDateDraft}
                    className="rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
                    style={{ backgroundColor: 'var(--brand)' }}
                  >
                    {releaseBusy ? 'Saving…' : 'Save release date'}
                  </button>
                </div>
                {releaseErr ? (
                  <div className="mt-2 rounded-lg border px-2 py-1 text-xs" style={toneStyle('danger')}>
                    {releaseErr}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={jobsQ}
                  onChange={(e) => setJobsQ(e.target.value)}
                  placeholder="Search jobs…"
                  className="w-64 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
                <select
                  value={jobsStatus}
                  onChange={(e) => setJobsStatus(e.target.value)}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                >
                  <option value="all">All statuses</option>
                  <option value="queued">Queued</option>
                  <option value="downloading">Downloading</option>
                  <option value="completed">Completed</option>
                  <option value="processing">Processing</option>
                  <option value="cleaned">Cleaned</option>
                  <option value="waiting_to_release">Waiting to be released</option>
                  <option value="deployed_in_xui">Deployed in XUI</option>
                  <option value="failed">Failed</option>
                  <option value="deleted">Deleted</option>
                  <option value="size_rejected">Rejected by size limit</option>
                </select>
              </div>
              <div className="text-xs text-[var(--admin-muted)]">
                {jobsLoading ? 'Loading…' : `${filteredJobs.length} item${filteredJobs.length === 1 ? '' : 's'}`}
              </div>
            </div>

            {jobsErr ? (
              <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={toneStyle('danger')}>
                {jobsErr}
              </div>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Progress</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Added</th>
                    <th className="px-3 py-2">Error</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((x) => (
                    <tr key={x.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-3 py-2">
                        <div className="font-medium">{x.title || x.qbName || 'Untitled'}</div>
                        <div className="mt-1 line-clamp-1 text-xs text-[var(--admin-muted)]">
                          {x.year ? `${x.year} · ` : ''}
                          {x.tmdb?.id ? `TMDB:${x.tmdb.id}` : ''}
                        </div>
                        {x?._selectionBucket || x?._selectionProvider ? (
                          <div className="mt-1 text-xs text-[var(--admin-muted)]">
                            {x?._selectionBucket ? `Bucket: ${x._selectionBucket}` : ''}
                            {x?._selectionProvider ? `${x?._selectionBucket ? ' · ' : ''}Provider: ${String(x._selectionProvider).toUpperCase()}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill item={x} />
                          {isSizeLimitRejected(x) ? (
                            <span className="inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium" style={toneStyle('warning')}>
                              Size Rejected
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">{fmtPct(x.progress)}</td>
                      <td className="px-3 py-2">{fmtBytes(x.sizeBytes)}</td>
                      <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                        {x.addedAt ? new Date(x.addedAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--admin-pill-danger-text)' }}>
                        {x.error || ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedJob(x)}
                          className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!jobsLoading && filteredJobs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                        No movie jobs found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {selectedJob ? (
              <pre className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                {JSON.stringify(selectedJob, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
