'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

function fmtBytes(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = v;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function fmtDate(ts) {
  const n = Number(ts || 0);
  return n > 0 ? new Date(n).toLocaleString() : '—';
}

function fmtCountdown(ts) {
  const target = Number(ts || 0);
  if (!(target > 0)) return '—';
  const diff = target - Date.now();
  if (diff <= 0) return 'Due now';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function toneStyle(tone = 'neutral') {
  const t = String(tone || 'neutral').trim().toLowerCase();
  return {
    borderColor: `var(--admin-pill-${t}-border)`,
    backgroundColor: `var(--admin-pill-${t}-bg)`,
    color: `var(--admin-pill-${t}-text)`,
  };
}

function StatusPill({ status = '' }) {
  const normalized = String(status || '').trim().toLowerCase();
  const tone =
    normalized === 'deleted'
      ? 'neutral'
      : normalized === 'failed'
        ? 'danger'
        : normalized === 'deleting'
          ? 'processing'
          : normalized === 'scheduled'
            ? 'warning'
            : 'info';
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium" style={toneStyle(tone)}>
      {status || 'Scheduled'}
    </span>
  );
}

function CheckPill({ value = '' }) {
  const normalized = String(value || '').trim().toLowerCase();
  const tone =
    normalized === 'deleted'
      ? 'success'
      : normalized === 'failed'
        ? 'danger'
        : normalized === 'pending'
          ? 'warning'
          : 'neutral';
  const label =
    normalized === 'deleted'
      ? 'Deleted'
      : normalized === 'failed'
        ? 'Failed'
        : normalized === 'pending'
          ? 'Pending'
          : normalized === 'missing' || normalized === 'missing_in_xui'
            ? 'Missing'
            : value || '—';
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium" style={toneStyle(tone)}>
      {label}
    </span>
  );
}

function PreviewPanel({ type = 'movie', preview = null }) {
  const normalizedType = String(type || 'movie').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const group = normalizedType === 'series' ? preview?.series : preview?.movie;
  const items = Array.isArray(group?.items) ? group.items : [];
  const title = normalizedType === 'series' ? 'Series picked for next deletion schedule' : 'Movies picked for next deletion schedule';
  const seriesEligible = preview?.seriesEligible !== false;
  const seriesCandidateCount = Number(preview?.seriesCandidateCount || 0) || 0;
  const diagnostics = preview?.diagnostics || {};
  const previewMode = String(preview?.protectionMode || 'strict').trim().toLowerCase();

  return (
    <div className="mt-6 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            This preview refreshes daily at {preview?.refreshTime || '00:00'} ({preview?.timeZone || 'Asia/Manila'}) and is used the next time the VOD trigger is reached.
          </div>
          <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
            Generated: {fmtDate(preview?.generatedAt)} • Next cycle date: {preview?.nextRefreshDate || '—'}
          </div>
          {previewMode === 'bypass_oldest_release' ? (
            <div className="mt-1 text-[11px] text-[var(--admin-warning-text)]">
              No strictly eligible titles were available, so this preview bypasses protection windows and prioritizes the oldest TMDB release dates first.
            </div>
          ) : null}
        </div>
        <div className="text-right text-xs text-[var(--admin-muted)]">
          <div>Delete target: {fmtBytes(preview?.targetBytes)}</div>
          <div className="mt-1">Selected: {items.length}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Titles</div>
          <div className="mt-1 text-sm font-semibold">{items.length}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Total VOD size</div>
          <div className="mt-1 text-sm font-semibold">{fmtBytes(group?.totalVodBytes)}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Total NAS size</div>
          <div className="mt-1 text-sm font-semibold">{fmtBytes(group?.totalNasBytes)}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Series rule</div>
          <div className="mt-1 text-sm font-semibold">
            {normalizedType === 'series' ? (seriesEligible ? 'Eligible' : 'Protected') : 'Movie batch'}
          </div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            {normalizedType === 'series'
              ? `Detected series titles: ${seriesCandidateCount}`
              : `Preview total: ${fmtBytes(group?.totalEstimatedBytes)}`}
          </div>
        </div>
      </div>

      {!items.length ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-6 text-sm text-[var(--admin-muted)]">
          {normalizedType === 'series' && !seriesEligible
            ? `Series preview is empty because deployed series count (${seriesCandidateCount}) has not exceeded the configured threshold yet.`
            : diagnostics?.strictEligible === 0 && (Number(diagnostics?.protectedByAge || 0) > 0 || Number(diagnostics?.protectedByWatch || 0) > 0)
              ? `No preview titles match the current protection rules. Protected by age: ${Number(diagnostics?.protectedByAge || 0)} • Protected by watch: ${Number(diagnostics?.protectedByWatch || 0)} • Missing targets skipped: ${Number(diagnostics?.missingTargets || 0)}`
              : 'No preview titles are currently selected for the next deletion schedule.'}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
          <div className="max-h-[44rem] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-[1] bg-[var(--admin-surface)] text-xs text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2" title="Movie or series chosen for the next deletion schedule.">Title</th>
                <th className="px-3 py-2" title="Detected VOD size that would be freed by this deletion.">VOD size</th>
                <th className="px-3 py-2" title="Detected NAS size for the matching library folder, if currently reachable.">NAS size</th>
                <th className="px-3 py-2" title="Whether the title is currently detected in XUI VOD and/or the NAS library.">Detected</th>
                <th className="px-3 py-2" title="Protection-window state used when building the preview.">Protections</th>
                <th className="px-3 py-2" title="Most recent watch activity considered by the preview logic.">Last watched</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={`${item.type}:${item.tmdbId}:${item.xuiId}:${item.queueId}`}
                  className="border-t border-[var(--admin-border)]"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-3">
                      <div className="h-16 w-28 overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
                        {item?.backdropImage || item?.image ? (
                          <img
                            src={item?.backdropImage || item?.image}
                            alt={item?.title || 'Preview'}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-[var(--admin-muted)]">No image</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium">{item?.title || 'Untitled'}</div>
                        <div className="mt-1 text-xs text-[var(--admin-muted)]">
                          {item?.year || '—'} • {normalizedType === 'series' ? 'Series' : 'Movie'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{fmtBytes(item?.vodSizeBytes)}</td>
                  <td className="px-3 py-3">{fmtBytes(item?.nasSizeBytes)}</td>
                  <td className="px-3 py-3">
                    <div className="text-xs text-[var(--admin-muted)]">
                      <div>{item?.vodExists ? 'VOD detected' : 'VOD missing'}</div>
                      <div className="mt-1">{item?.libraryExists ? 'NAS detected' : 'NAS missing / offline'}</div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {item?.protectedByAge ? (
                        <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium" style={toneStyle('warning')}>
                          Recent release
                        </span>
                      ) : null}
                      {item?.protectedByWatch ? (
                        <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium" style={toneStyle('info')}>
                          Recently watched
                        </span>
                      ) : null}
                      {!item?.protectedByAge && !item?.protectedByWatch ? (
                        <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium" style={toneStyle('success')}>
                          Eligible
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                    {item?.lastWatchedAt ? fmtDate(item.lastWatchedAt) : 'No recent watch'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminAutoDownloadDeletionLogPanel({ type = 'movie' }) {
  const normalizedType = String(type || 'movie').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const title = normalizedType === 'series' ? 'Series Deletion Log' : 'Movies Deletion Log';

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const response = await fetch(`/api/admin/autodownload/deletion-log?type=${encodeURIComponent(normalizedType)}&limit=200`, {
        cache: 'no-store',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load deletion logs.');
      const nextLogs = Array.isArray(json.logs) ? json.logs : [];
      setLogs(nextLogs);
      setState(json.state || null);
      setPreview(json.preview || null);
      setSelectedLog((current) => {
        if (!current) return current;
        return nextLogs.find((entry) => String(entry?.id || '') === String(current?.id || '')) || null;
      });
    } catch (error) {
      setErr(error?.message || 'Failed to load deletion logs.');
    } finally {
      setLoading(false);
    }
  }, [normalizedType]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const runDeletionCycle = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const response = await fetch('/api/admin/autodownload/deletion-log', { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to run deletion cycle.');
      const scheduled = Number(json?.result?.scheduled?.scheduled || 0) || 0;
      const executed = Number(json?.result?.executed?.processedLogs || 0) || 0;
      setOk(`Deletion cycle finished. Scheduled: ${scheduled} • Executed logs: ${executed}`);
      await load();
    } catch (error) {
      setErr(error?.message || 'Failed to run deletion cycle.');
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    const rows = Array.isArray(logs) ? logs : [];
    return {
      scheduled: rows.filter((entry) => String(entry?.status || '').toLowerCase() === 'scheduled').length,
      deleted: rows.filter((entry) => String(entry?.status || '').toLowerCase() === 'deleted').length,
      failed: rows.filter((entry) => String(entry?.status || '').toLowerCase() === 'failed').length,
      totalVodBytes: rows.reduce((sum, entry) => sum + (Number(entry?.totalVodBytes || 0) || 0), 0),
    };
  }, [logs]);

  const selectedItems = Array.isArray(selectedLog?.items) ? selectedLog.items : [];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">{title}</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            When the VOD trigger is reached, these logs schedule Leaving Soon titles first, then delete them after the configured delay.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            onClick={runDeletionCycle}
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            Run Deletion Check
          </button>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}
      {loading ? (
        <div className="mt-4 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-xs text-[var(--admin-muted)]">
            <Loader2 size={14} className="animate-spin" />
            Loading deletion preview…
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Deletion Mode</div>
          <div className="mt-1 text-sm font-semibold">{state?.active ? 'Active' : 'Idle'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">{state?.reason || 'No pending deletion work.'}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Scheduled Logs</div>
          <div className="mt-1 text-sm font-semibold">{summary.scheduled}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Deleted Logs</div>
          <div className="mt-1 text-sm font-semibold">{summary.deleted}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Scheduled VOD total</div>
          <div className="mt-1 text-sm font-semibold">{fmtBytes(summary.totalVodBytes)}</div>
        </div>
      </div>

      <PreviewPanel type={normalizedType} preview={preview} />

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--admin-border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2" title="Selection timestamp when this deletion run was created.">Run</th>
              <th className="px-3 py-2" title="Delete date and remaining countdown until actual removal.">Delete schedule</th>
              <th className="px-3 py-2" title="How many titles were scheduled in this deletion run.">Titles</th>
              <th className="px-3 py-2" title="Total VOD and NAS size represented by the scheduled titles.">Sizes</th>
              <th className="px-3 py-2" title="Storage trigger source that created this deletion run.">Trigger</th>
              <th className="px-3 py-2" title="Current status of this deletion run.">Status</th>
              <th className="px-3 py-2" title="Most recent error for this deletion run, if any.">Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.id}
                onClick={() => setSelectedLog(log)}
                className="cursor-pointer border-t border-[var(--admin-border)] transition-colors hover:bg-[var(--admin-hover-bg)]"
              >
                <td className="px-3 py-3">
                  <div className="font-medium">{fmtDate(log?.scheduledAt)}</div>
                  <div className="mt-1 text-xs text-[var(--admin-muted)]">
                    Preview cycle: {String(log?.previewCycleKey || '').trim() || '—'}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium">{log?.deleteDate || '—'}</div>
                  <div className="mt-1 text-xs text-[var(--admin-muted)]">{fmtCountdown(log?.deleteAt)}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium">{Array.isArray(log?.items) ? log.items.length : 0}</div>
                  <div className="mt-1 text-xs text-[var(--admin-muted)]">{normalizedType === 'series' ? 'Whole series' : 'Movies'}</div>
                </td>
                <td className="px-3 py-3">
                  <div>VOD {fmtBytes(log?.totalVodBytes)}</div>
                  <div className="mt-1 text-xs text-[var(--admin-muted)]">NAS {fmtBytes(log?.totalNasBytes)}</div>
                </td>
                <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">{log?.triggerVolume || '—'}</td>
                <td className="px-3 py-3">
                  <StatusPill status={log?.status || 'scheduled'} />
                </td>
                <td className="px-3 py-3 text-xs" style={{ color: 'var(--admin-pill-danger-text)' }}>
                  {log?.error || ''}
                </td>
              </tr>
            ))}
            {!loading && logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                  No deletion logs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedLog ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={() => setSelectedLog(null)}>
          <div
            className="max-h-[90vh] w-full max-w-7xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--admin-border)] pb-4">
              <div>
                <div className="text-lg font-semibold">{title}</div>
                <div className="mt-1 text-sm text-[var(--admin-muted)]">
                  Run: {fmtDate(selectedLog?.scheduledAt)} · Delete: {selectedLog?.deleteDate || '—'} ({fmtCountdown(selectedLog?.deleteAt)}) ·
                  Titles: {selectedItems.length}
                </div>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
              >
                Close
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-3 py-2" title="Scheduled title queued for deletion.">Title</th>
                    <th className="px-3 py-2" title="Final delete date and countdown.">Delete schedule</th>
                    <th className="px-3 py-2" title="Detected VOD and NAS sizes used for this deletion item.">Sizes</th>
                    <th className="px-3 py-2" title="Most recent detected watch activity.">Last watched</th>
                    <th className="px-3 py-2" title="Deletion state for this title.">Status</th>
                    <th className="px-3 py-2" title="Whether VOD/XUI and NAS were deleted, or only one side was affected.">Checks</th>
                    <th className="px-3 py-2" title="Error for this title, if any.">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedItems.map((item) => (
                    <tr key={item.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-3">
                          <div className="h-16 w-28 overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)]">
                            {item?.backdropImage || item?.image ? (
                              <img
                                src={item?.backdropImage || item?.image}
                                alt={item?.title || 'Backdrop'}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium">{item?.title || 'Untitled'}</div>
                            <div className="mt-1 line-clamp-1 text-xs text-[var(--admin-muted)]">
                              {item?.year || '—'} • TMDB {item?.tmdbId || '—'} • XUI {item?.xuiId || '—'}
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                              {item?.libraryExists ? 'NAS detected' : 'NAS missing'} • {item?.vodExists ? 'VOD detected' : 'VOD missing'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{item?.deleteDate || selectedLog?.deleteDate || '—'}</div>
                        <div className="mt-1 text-xs text-[var(--admin-muted)]">{fmtCountdown(item?.deleteAt || selectedLog?.deleteAt)}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                        <div>VOD: {fmtBytes(item?.vodSizeBytes)}</div>
                        <div className="mt-1">NAS: {fmtBytes(item?.nasSizeBytes)}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                        {item?.lastWatchedAt ? fmtDate(item.lastWatchedAt) : 'No recent watch'}
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill status={item?.status || 'scheduled'} />
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>VOD/XUI</span>
                          <CheckPill value={item?.vodDeleteStatus || item?.xuiDeleteStatus || 'pending'} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span>NAS</span>
                          <CheckPill value={item?.nasDeleteStatus || 'pending'} />
                        </div>
                        {item?.deletedTargets ? (
                          <div className="mt-2 text-[11px] text-[var(--admin-muted)]">
                            Result: {String(item.deletedTargets || '').replace(/_/g, ' ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-xs" style={{ color: 'var(--admin-pill-danger-text)' }}>
                        {item?.error || ''}
                      </td>
                    </tr>
                  ))}
                  {!selectedItems.length ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                        No scheduled items in this deletion log.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
