'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import EditModal, { EditIconButton } from './EditModal';
import HelpTooltip from './HelpTooltip';
import NotesButton from './NotesButton';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function Field({ label, hint, note, children }) {
  const infoText = [hint, note].map((item) => String(item || '').trim()).filter(Boolean).join(' • ');
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-sm font-medium text-[var(--admin-text)]">{label}</label>
        {infoText ? <HelpTooltip text={infoText} /> : null}
      </div>
      {children}
    </div>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30',
        props.className
      )}
    />
  );
}

function Pill({ ok, label }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium',
        ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      )}
    >
      {label}
    </span>
  );
}

function fmtBytes(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtGb(n) {
  const value = Number(n || 0);
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${value.toFixed(1)} GB`;
}

function roundOneDecimal(n, fallback = 0) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.round(value * 10) / 10;
}

export default function AdminAutoDeleteSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [activeSizeSlider, setActiveSizeSlider] = useState('');

  const [mountStatus, setMountStatus] = useState(null);
  const [storageDevices, setStorageDevices] = useState(null);
  const [vodVolumeStats, setVodVolumeStats] = useState(null);
  const [deletionState, setDeletionState] = useState(null);

  const [storageLimitGb, setStorageLimitGb] = useState(0);
  const [deletionEnabled, setDeletionEnabled] = useState(false);
  const [deletionTriggerUsedGb, setDeletionTriggerUsedGb] = useState(0);
  const [deleteBatchTargetGb, setDeleteBatchTargetGb] = useState(50);
  const [deleteDelayDays, setDeleteDelayDays] = useState(3);
  const [deleteExecutionTime, setDeleteExecutionTime] = useState('00:00');
  const [previewRefreshTime, setPreviewRefreshTime] = useState('00:00');
  const [protectRecentReleaseDays, setProtectRecentReleaseDays] = useState(60);
  const [protectRecentWatchDays, setProtectRecentWatchDays] = useState(7);
  const [seriesEligibleThreshold, setSeriesEligibleThreshold] = useState(10);
  const [maxSeriesPerBatch, setMaxSeriesPerBatch] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const storagePromise = fetch('/api/admin/autodownload/mount/storage-devices', { cache: 'no-store' })
        .then(async (response) => ({
          ok: response.ok,
          json: await response.json().catch(() => ({})),
        }))
        .catch(() => null);

      const [settingsResponse, deletionResponse] = await Promise.all([
        fetch('/api/admin/autodownload/settings', { cache: 'no-store' }),
        fetch('/api/admin/autodownload/deletion-log?type=movie&limit=1', { cache: 'no-store' }),
      ]);

      const settingsJson = await settingsResponse.json().catch(() => ({}));
      if (!settingsResponse.ok || !settingsJson?.ok) {
        throw new Error(settingsJson?.error || 'Failed to load AutoDelete settings.');
      }

      const deletionJson = await deletionResponse.json().catch(() => ({}));
      const settings = settingsJson.settings || {};
      const storagePolicyVolume = settingsJson?.storagePolicyVolume || {};
      const fallbackVodTotalBytes =
        Number(storagePolicyVolume?.totalBytes || 0) ||
        Number(deletionJson?.state?.vodState?.totalBytes || 0) ||
        Number(settingsJson?.mountStatus?.space?.total || 0) ||
        0;
      const fallbackVodUsedBytes =
        Number(storagePolicyVolume?.usedBytes || 0) ||
        Number(deletionJson?.state?.vodState?.usedBytes || 0) ||
        Number(settingsJson?.mountStatus?.space?.used || 0) ||
        0;
      const fallbackVodAvailBytes = Number(storagePolicyVolume?.availBytes || 0) || Math.max(0, fallbackVodTotalBytes - fallbackVodUsedBytes);
      const totalGb = fallbackVodTotalBytes > 0 ? fallbackVodTotalBytes / (1024 * 1024 * 1024) : 0;
      const usedGb = fallbackVodUsedBytes > 0 ? fallbackVodUsedBytes / (1024 * 1024 * 1024) : 0;
      const legacyLimitPercent = Number(settings?.storage?.limitPercent ?? 95) || 95;
      const resolvedLimitGb = Number(settings?.storage?.limitGb ?? (totalGb > 0 ? (legacyLimitPercent / 100) * totalGb : usedGb)) || 0;
      const resolvedTriggerGb =
        Number(settings?.deletion?.triggerUsedGb ?? (resolvedLimitGb > 0 ? Math.max(usedGb, resolvedLimitGb - 50) : usedGb)) || 0;

      setStorageLimitGb(roundOneDecimal(resolvedLimitGb, 0));
      setDeletionEnabled(settings?.deletion?.enabled === true);
      setDeletionTriggerUsedGb(roundOneDecimal(resolvedTriggerGb, 0));
      setDeleteBatchTargetGb(roundOneDecimal(settings?.deletion?.deleteBatchTargetGb ?? 50, 50));
      setDeleteDelayDays(Number(settings?.deletion?.deleteDelayDays ?? 3) || 3);
      setDeleteExecutionTime(String(settings?.deletion?.deleteExecutionTime || '00:00').trim() || '00:00');
      setPreviewRefreshTime(String(settings?.deletion?.previewRefreshTime || '00:00').trim() || '00:00');
      setProtectRecentReleaseDays(Number(settings?.deletion?.protectRecentReleaseDays ?? 60) || 60);
      setProtectRecentWatchDays(Number(settings?.deletion?.protectRecentWatchDays ?? 7) || 7);
      setSeriesEligibleThreshold(Number(settings?.deletion?.seriesEligibleThreshold ?? 10) || 10);
      setMaxSeriesPerBatch(Number(settings?.deletion?.maxSeriesPerBatch ?? 1) || 1);
      setMountStatus(settingsJson.mountStatus || null);
      setVodVolumeStats({
        totalBytes: fallbackVodTotalBytes,
        usedBytes: fallbackVodUsedBytes,
        availBytes: fallbackVodAvailBytes,
        resolvedPath:
          storagePolicyVolume?.resolvedPath ||
          deletionJson?.state?.vodState?.resolvedPath ||
          '',
      });
      setDeletionState(deletionJson?.state || null);
      storagePromise
        .then((storageResult) => {
          const storageDevicesPayload = storageResult?.ok && storageResult?.json?.ok ? storageResult.json.storageDevices || null : null;
          if (!storageDevicesPayload) return;
          setStorageDevices(storageDevicesPayload);
          setVodVolumeStats((prev) => ({
            totalBytes: Number(storageDevicesPayload?.logical?.size || 0) || prev?.totalBytes || 0,
            usedBytes: Number(storageDevicesPayload?.logical?.used || 0) || prev?.usedBytes || 0,
            availBytes:
              Number(storageDevicesPayload?.logical?.avail || 0) ||
              Math.max(
                0,
                (Number(storageDevicesPayload?.logical?.size || 0) || prev?.totalBytes || 0) -
                  (Number(storageDevicesPayload?.logical?.used || 0) || prev?.usedBytes || 0)
              ),
            resolvedPath:
              storageDevicesPayload?.resolvedPath ||
              storageDevicesPayload?.preferredPath ||
              prev?.resolvedPath ||
              '',
          }));
        })
        .catch(() => null);
    } catch (error) {
      setErr(error?.message || 'Failed to load AutoDelete settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const response = await fetch('/api/admin/autodownload/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storage: {
            limitGb: roundOneDecimal(storageLimitGb, 0),
          },
          deletion: {
            enabled: deletionEnabled,
            triggerUsedGb: roundOneDecimal(deletionTriggerUsedGb, 0),
            deleteBatchTargetGb: roundOneDecimal(deleteBatchTargetGb, 50),
            deleteDelayDays: Math.max(0, Math.min(30, Math.floor(Number(deleteDelayDays) || 3))),
            deleteExecutionTime: String(deleteExecutionTime || '00:00').trim() || '00:00',
            previewRefreshTime: String(previewRefreshTime || '00:00').trim() || '00:00',
            protectRecentReleaseDays: Math.max(0, Math.floor(Number(protectRecentReleaseDays) || 0)),
            protectRecentWatchDays: Math.max(0, Math.floor(Number(protectRecentWatchDays) || 0)),
            seriesEligibleThreshold: Math.max(0, Math.floor(Number(seriesEligibleThreshold) || 0)),
            maxSeriesPerBatch: Math.max(0, Math.floor(Number(maxSeriesPerBatch) || 0)),
            pauseSelectionWhileActive: true,
          },
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        const list = Array.isArray(json?.errors) ? json.errors.join(' ') : '';
        throw new Error(json?.error ? `${json.error}${list ? ` ${list}` : ''}` : 'Failed to save AutoDelete settings.');
      }
      setOk('Saved.');
      setMountStatus(json.mountStatus || null);
      await load();
      return true;
    } catch (error) {
      setErr(error?.message || 'Failed to save AutoDelete settings.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const vodTotal = Number(storageDevices?.logical?.size || vodVolumeStats?.totalBytes || 0);
  const vodUsed = Number(storageDevices?.logical?.used || vodVolumeStats?.usedBytes || 0);
  const vodAvailable = Number(storageDevices?.logical?.avail || vodVolumeStats?.availBytes || 0);
  const vodTotalGb = vodTotal > 0 ? vodTotal / (1024 * 1024 * 1024) : 0;
  const vodAvailableGb = vodAvailable > 0 ? Math.round((vodAvailable / (1024 * 1024 * 1024)) * 1000) / 1000 : 0;
  const vodUsedPct = vodTotal > 0 ? Math.round((vodUsed / vodTotal) * 100) : null;
  const freeBeforeLimitGb = Number(storageLimitGb) > 0 ? Math.max(0, Math.round((vodTotalGb - Number(storageLimitGb)) * 1000) / 1000) : 0;
  const freeBeforeTriggerGb = Number(deletionTriggerUsedGb) > 0 ? Math.max(0, Math.round((vodTotalGb - Number(deletionTriggerUsedGb)) * 1000) / 1000) : 0;
  const currentVodUsedGb = vodTotal > 0 ? Math.round((vodUsed / (1024 * 1024 * 1024)) * 1000) / 1000 : 0;
  const vodUsedRatio = vodTotalGb > 0 ? Math.max(0, Math.min(100, (currentVodUsedGb / vodTotalGb) * 100)) : 0;
  const triggerRatio = vodTotalGb > 0 && Number(deletionTriggerUsedGb) > 0 ? Math.max(0, Math.min(100, (Number(deletionTriggerUsedGb) / vodTotalGb) * 100)) : 0;
  const limitRatio = vodTotalGb > 0 && Number(storageLimitGb) > 0 ? Math.max(0, Math.min(100, (Number(storageLimitGb) / vodTotalGb) * 100)) : 0;
  const isAtOrPastTrigger = Number(deletionTriggerUsedGb) > 0 && currentVodUsedGb >= Number(deletionTriggerUsedGb);
  const remainingBeforeTriggerGb = Math.max(0, Number(deletionTriggerUsedGb || 0) - currentVodUsedGb);

  const nasTotal = Number(mountStatus?.space?.total || 0);
  const nasUsed = Number(mountStatus?.space?.used || 0);
  const nasAvailable = Number(mountStatus?.space?.avail || 0);
  const nasTotalGb = nasTotal > 0 ? nasTotal / (1024 * 1024 * 1024) : 0;
  const nasAvailableGb = nasAvailable > 0 ? Math.round((nasAvailable / (1024 * 1024 * 1024)) * 1000) / 1000 : 0;
  const nasUsedPct = nasTotal > 0 ? Math.round((nasUsed / nasTotal) * 100) : null;
  const nasUsedRatio = nasTotalGb > 0 ? Math.max(0, Math.min(100, (nasUsed / nasTotal) * 100)) : 0;
  const maxVodStorageGb = roundOneDecimal(vodTotalGb, 0);
  const isVodDetected = maxVodStorageGb > 0;
  const minSliderGb = maxVodStorageGb > 0 ? 0.1 : 0;
  const minStorageLimitGb = currentVodUsedGb > 0 ? roundOneDecimal(currentVodUsedGb, 0) : minSliderGb;
  const storageLimitSliderMax = maxVodStorageGb > 0 ? maxVodStorageGb : Math.max(0.1, roundOneDecimal(storageLimitGb || 0, 0));
  const deletionTriggerSliderMax = Math.max(minSliderGb || 0.1, roundOneDecimal(storageLimitGb || storageLimitSliderMax, storageLimitSliderMax));

  const validationErrors = useMemo(() => {
    if (loading) return [];
    const errors = [];
    const storageLimit = Number(storageLimitGb);
    const triggerUsed = Number(deletionTriggerUsedGb);
    const batchTarget = Number(deleteBatchTargetGb);

    if (!isVodDetected) {
      errors.push('VOD storage is not detected. Check Storage & Mount > XUI VOD Path and Engine Host first.');
      return errors;
    }
    if (!Number.isFinite(storageLimit) || storageLimit <= 0) errors.push('Storage limit must be greater than 0 GB.');
    if (Number.isFinite(storageLimit) && currentVodUsedGb > 0 && storageLimit < currentVodUsedGb) {
      errors.push(`Storage limit cannot be lower than current VOD usage (${fmtGb(currentVodUsedGb)}).`);
    }
    if (!Number.isFinite(triggerUsed) || triggerUsed <= 0) errors.push('Deletion trigger must be greater than 0 GB.');
    if (Number.isFinite(storageLimit) && Number.isFinite(triggerUsed) && triggerUsed > storageLimit) {
      errors.push('Deletion trigger GB must be less than or equal to storage limit GB.');
    }
    if (!Number.isFinite(batchTarget) || batchTarget <= 0) errors.push('Delete batch target must be greater than 0 GB.');
    if (!Number.isFinite(Number(deleteDelayDays)) || Number(deleteDelayDays) < 0 || Number(deleteDelayDays) > 30) {
      errors.push('Delete delay days must be 0–30.');
    }
    if (!/^\d{2}:\d{2}$/.test(String(deleteExecutionTime || '').trim())) {
      errors.push('Deletion execution time must use HH:MM.');
    }
    if (!/^\d{2}:\d{2}$/.test(String(previewRefreshTime || '').trim())) {
      errors.push('Preview refresh time must use HH:MM.');
    }
    if (!Number.isFinite(Number(protectRecentReleaseDays)) || Number(protectRecentReleaseDays) < 0) {
      errors.push('Protect newly added titles (days) must be 0 or greater.');
    }
    if (!Number.isFinite(Number(protectRecentWatchDays)) || Number(protectRecentWatchDays) < 0) {
      errors.push('Protect recently watched titles (days) must be 0 or greater.');
    }
    if (!Number.isFinite(Number(seriesEligibleThreshold)) || Number(seriesEligibleThreshold) < 0) {
      errors.push('Series minimum library count must be 0 or greater.');
    }
    if (!Number.isFinite(Number(maxSeriesPerBatch)) || Number(maxSeriesPerBatch) < 0) {
      errors.push('Max series per deletion batch must be 0 or greater.');
    }
    return errors;
  }, [
    currentVodUsedGb,
    deleteBatchTargetGb,
    deleteDelayDays,
    deleteExecutionTime,
    deletionTriggerUsedGb,
    maxSeriesPerBatch,
    previewRefreshTime,
    protectRecentReleaseDays,
    protectRecentWatchDays,
    seriesEligibleThreshold,
    storageLimitGb,
    isVodDetected,
    loading,
  ]);

  const notes = [
    {
      title: 'Purpose',
      items: [
        'AutoDelete schedules Leaving Soon titles before permanent deletion from XUI and NAS.',
        'Selection and download dispatch are paused while auto deletion is active.',
        'Deletion scheduling and execution are paused whenever the NAS mount is offline or not writable.',
      ],
    },
    {
      title: 'Trigger model',
      items: [
        'Storage limit stays in AutoDownload Settings.',
        'Deletion trigger must be lower than or equal to that storage limit and starts scheduling before the hard limit is reached.',
        'Due deletions execute at the configured deletion time after the delay window has elapsed.',
        'Preview candidates refresh once per day at the configured preview time.',
      ],
    },
    {
      title: 'Protections',
      items: [
        'Oldest deployed titles are prioritized first.',
        'Recent watch protection can still be bypassed when storage pressure requires deletion.',
        'Series enter the candidate pool only after the configured series-count threshold is exceeded.',
      ],
    },
  ];

  return (
    <>
      {loading ? (
        <div className="pointer-events-none fixed left-1/2 top-4 z-[70] -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-2 shadow-lg">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--admin-border)] border-t-[--brand]" />
            <span className="text-sm font-medium text-[var(--admin-text)]">Loading AutoDelete storage…</span>
          </div>
        </div>
      ) : null}
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">AutoDelete Settings</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Storage-pressure deletion rules, Leaving Soon delay, and protection windows.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotesButton title="AutoDelete Settings — Notes" sections={notes} />
          <button
            onClick={load}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
          <EditIconButton onClick={() => setEditOpen(true)} title="Edit AutoDelete settings" disabled={loading} />
        </div>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}

      {!loading && validationErrors.length ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-black data-[theme=dark]:text-red-200">
          <div className="font-semibold">Fix these before saving:</div>
          <ul className="mt-2 list-disc pl-5">
            {validationErrors.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">AutoDelete</div>
          <div className="mt-1 text-sm font-semibold">{deletionEnabled ? 'Enabled' : 'Disabled'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Delete delay: {deleteDelayDays} day(s) • Delete time: {deleteExecutionTime} • Preview refresh: {previewRefreshTime}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Trigger</div>
          <div className="mt-1 text-sm font-semibold">{deletionTriggerUsedGb ? `${deletionTriggerUsedGb} GB used` : '—'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Delete target: {deleteBatchTargetGb} GB</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Protections</div>
          <div className="mt-1 text-sm font-semibold">{protectRecentReleaseDays}d release • {protectRecentWatchDays}d watch</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Series threshold: {seriesEligibleThreshold} • Max per batch: {maxSeriesPerBatch}</div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-[var(--admin-muted)]">Deletion Mode</div>
            <Pill ok={deletionState?.active === true} label={deletionState?.active ? 'Active' : 'Idle'} />
          </div>
          <div className="mt-1 text-sm font-semibold">{deletionState?.triggerVolume || 'No active trigger'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">{deletionState?.reason || 'No pending deletion work.'}</div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr,1fr]">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Storage Snapshot</div>
          <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">XUI VOD Storage Thresholds</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  Monitors the active VOD volume only. Trigger and limit are applied against this storage.
                </div>
                <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                  Path: {storageDevices?.resolvedPath || storageDevices?.preferredPath || vodVolumeStats?.resolvedPath || 'Not detected'}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--admin-muted)]">
                <div>{isAtOrPastTrigger ? 'Trigger already reached' : `${fmtGb(remainingBeforeTriggerGb)} left before trigger`}</div>
                <div className="mt-1">Current used: {fmtGb(currentVodUsedGb)}</div>
              </div>
            </div>

            <div className="mt-5">
              <div className="relative h-4 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-sky-500/70"
                  style={{ width: `${vodUsedRatio}%` }}
                />
                <div
                  className="absolute inset-y-0 w-[2px] bg-amber-500"
                  style={{ left: `calc(${triggerRatio}% - 1px)` }}
                  title={`Deletion trigger: ${fmtGb(deletionTriggerUsedGb)}`}
                />
                <div
                  className="absolute inset-y-0 w-[2px] bg-red-500"
                  style={{ left: `calc(${limitRatio}% - 1px)` }}
                  title={`Storage limit: ${fmtGb(storageLimitGb)}`}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--admin-muted)]">
                <div>0</div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <div className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-sky-500/70" />
                    <span>Current {fmtGb(currentVodUsedGb)}</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-[2px] rounded-full bg-amber-500" />
                    <span>Trigger {fmtGb(deletionTriggerUsedGb)}</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-[2px] rounded-full bg-red-500" />
                    <span>Limit {fmtGb(storageLimitGb)}</span>
                  </div>
                </div>
                <div>{fmtGb(vodTotalGb)}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Current used</div>
                <div className="mt-1 text-sm font-semibold">{fmtGb(currentVodUsedGb)}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">{vodUsedPct === null ? '—' : `${vodUsedPct}% of total`}</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Deletion trigger</div>
                <div className="mt-1 text-sm font-semibold">{fmtGb(deletionTriggerUsedGb)}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  {isAtOrPastTrigger ? 'Deletion scheduling may start now.' : `${fmtGb(remainingBeforeTriggerGb)} remaining`}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Storage limit</div>
                <div className="mt-1 text-sm font-semibold">{fmtGb(storageLimitGb)}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">{fmtGb(freeBeforeLimitGb)} free remains before the hard limit.</div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">NAS Capacity</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  NAS usage is displayed for reference only. No trigger or deletion limit is applied here.
                </div>
                <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                  Path: {mountStatus?.mountDir || 'Not detected'}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--admin-muted)]">
                <div>Remaining: {nasAvailableGb ? `${nasAvailableGb.toFixed(1)} GB` : '—'}</div>
                <div className="mt-1">Current used: {fmtBytes(nasUsed)}</div>
              </div>
            </div>

            <div className="mt-5">
              <div className="relative h-4 overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-violet-500/70"
                  style={{ width: `${nasUsedRatio}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--admin-muted)]">
                <div>0</div>
                <div className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-violet-500/70" />
                  <span>Current {fmtBytes(nasUsed)}</span>
                </div>
                <div>{fmtGb(nasTotalGb)}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Used</div>
                <div className="mt-1 text-sm font-semibold">{fmtBytes(nasUsed)}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">{nasUsedPct === null ? '—' : `${nasUsedPct}% of total`}</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Available</div>
                <div className="mt-1 text-sm font-semibold">{nasAvailableGb ? `${nasAvailableGb.toFixed(1)} GB` : '—'}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">Total: {fmtBytes(nasTotal)}</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">Status</div>
                <div className="mt-1 text-sm font-semibold">{mountStatus?.ok ? 'Ready' : 'Not ready'}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">{mountStatus?.error || 'Mounted and writable.'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Deletion Workflow</div>
          <div className="mt-3 space-y-3 text-sm text-[var(--admin-muted)]">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              1. Trigger hits when the XUI VOD volume reaches the configured used-GB threshold.
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              2. Titles are scheduled into Leaving Soon first. Deletion happens only after the delay expires.
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              3. Selection/download stays paused until deletion mode has cleared enough space.
            </div>
          </div>
        </div>
      </div>

      <EditModal
        open={editOpen}
        title="Edit AutoDelete Settings"
        description="Configure when deletion scheduling starts and how much space should be reclaimed."
        error={err}
        success={ok}
        onCancel={async () => {
          setEditOpen(false);
          await load();
        }}
        onSave={async () => {
          const saved = await save();
          if (saved) setEditOpen(false);
        }}
        saveDisabled={loading || busy || validationErrors.length > 0 || !isVodDetected}
        saving={busy}
      >
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Thresholds</div>
          <div className="mt-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]">
            Current maximum VOD storage: <span className="font-semibold">{fmtGb(maxVodStorageGb)}</span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Enable AutoDelete" hint="Selection/download pauses while deletion mode is active">
              <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                <input type="checkbox" checked={deletionEnabled} onChange={(event) => setDeletionEnabled(event.target.checked)} />
                <span>{deletionEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </Field>
            <Field label="Storage limit (GB used)" hint="Shared storage guardrail. It cannot be set below the current VOD used size.">
              <Input
                type="number"
                min={isVodDetected ? minStorageLimitGb || 0.1 : undefined}
                max={isVodDetected ? storageLimitSliderMax || undefined : undefined}
                step="0.1"
                value={storageLimitGb ? storageLimitGb.toFixed(1) : ''}
                disabled={!isVodDetected}
                onFocus={() => setActiveSizeSlider('storageLimit')}
                onClick={() => setActiveSizeSlider('storageLimit')}
                onChange={(event) => {
                  const next = Math.max(minStorageLimitGb || 0, roundOneDecimal(event.target.value || 0, 0));
                  setStorageLimitGb(next);
                  if (deletionTriggerUsedGb > next) setDeletionTriggerUsedGb(next);
                }}
              />
              {activeSizeSlider === 'storageLimit' && isVodDetected && storageLimitSliderMax > 0 ? (
                <div className="mt-3">
                  <input
                    type="range"
                    min={minStorageLimitGb}
                    max={storageLimitSliderMax}
                    step="0.1"
                    value={Math.max(minStorageLimitGb, Math.min(storageLimitSliderMax, roundOneDecimal(storageLimitGb, minStorageLimitGb)))}
                    onChange={(event) => {
                      const next = roundOneDecimal(event.target.value || minStorageLimitGb, minStorageLimitGb);
                      setStorageLimitGb(next);
                      if (deletionTriggerUsedGb > next) setDeletionTriggerUsedGb(next);
                    }}
                    className="w-full accent-[--brand]"
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--admin-muted)]">
                    <span>Used {fmtGb(minStorageLimitGb)}</span>
                    <span>Current {fmtGb(storageLimitGb)}</span>
                    <span>{fmtGb(storageLimitSliderMax)}</span>
                  </div>
                </div>
              ) : null}
            </Field>
            <Field label="Deletion trigger (GB used)" hint="Start scheduling deletions at this used size">
              <Input
                type="number"
                min={isVodDetected ? minSliderGb || 0.1 : undefined}
                max={isVodDetected ? deletionTriggerSliderMax || undefined : undefined}
                step="0.1"
                value={deletionTriggerUsedGb ? deletionTriggerUsedGb.toFixed(1) : ''}
                disabled={!isVodDetected}
                onFocus={() => setActiveSizeSlider('deletionTrigger')}
                onClick={() => setActiveSizeSlider('deletionTrigger')}
                onChange={(event) => setDeletionTriggerUsedGb(roundOneDecimal(event.target.value || 0, 0))}
              />
              {activeSizeSlider === 'deletionTrigger' && isVodDetected && deletionTriggerSliderMax > 0 ? (
                <div className="mt-3">
                  <input
                    type="range"
                    min={minSliderGb}
                    max={deletionTriggerSliderMax}
                    step="0.1"
                    value={Math.max(minSliderGb, Math.min(deletionTriggerSliderMax, roundOneDecimal(deletionTriggerUsedGb, minSliderGb)))}
                    onChange={(event) => setDeletionTriggerUsedGb(roundOneDecimal(event.target.value || minSliderGb, minSliderGb))}
                    className="w-full accent-[--brand]"
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--admin-muted)]">
                    <span>{fmtGb(minSliderGb)}</span>
                    <span>Current {fmtGb(deletionTriggerUsedGb)}</span>
                    <span>{fmtGb(deletionTriggerSliderMax)}</span>
                  </div>
                </div>
              ) : null}
            </Field>
            <Field label="Delete batch target (GB)" hint="Approximate amount of space to free per cycle">
              <Input type="number" min={0.1} step="0.1" value={deleteBatchTargetGb ? deleteBatchTargetGb.toFixed(1) : ''} onChange={(event) => setDeleteBatchTargetGb(roundOneDecimal(event.target.value || 50, 50))} />
            </Field>
            <Field label="Delete delay (days)" hint="Time spent in Leaving Soon before deletion">
              <Input type="number" min={0} max={30} value={deleteDelayDays} onChange={(event) => setDeleteDelayDays(Number(event.target.value || 3))} />
            </Field>
            <Field label="Deletion execution time" hint="Time of day when due deletion logs are allowed to execute">
              <Input type="time" value={deleteExecutionTime} onChange={(event) => setDeleteExecutionTime(String(event.target.value || '00:00').trim() || '00:00')} />
            </Field>
            <Field label="Preview refresh time" hint="Daily time when the deletion preview candidate set is rebuilt">
              <Input type="time" value={previewRefreshTime} onChange={(event) => setPreviewRefreshTime(String(event.target.value || '00:00').trim() || '00:00')} />
            </Field>
          </div>
          <div className="mt-3 text-xs text-[var(--admin-muted)]">
            Free before storage limit: {freeBeforeLimitGb.toFixed(1)} GB • Free before deletion trigger: {freeBeforeTriggerGb.toFixed(1)} GB
          </div>
          {!isVodDetected ? (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              VOD storage is not detected yet. Check `Storage & Mount` and confirm the `XUI VOD Path`.
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Protection Windows</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Protect newly added titles (days)" hint="Oldest-first is preferred before this protection is relaxed">
              <Input type="number" min={0} value={protectRecentReleaseDays} onChange={(event) => setProtectRecentReleaseDays(Number(event.target.value || 60))} />
            </Field>
            <Field label="Protect recently watched titles (days)" hint="Bypassed automatically when storage pressure requires deletion">
              <Input type="number" min={0} value={protectRecentWatchDays} onChange={(event) => setProtectRecentWatchDays(Number(event.target.value || 7))} />
            </Field>
            <Field label="Series minimum library count" hint="Series become eligible only when the deployed series count is above this number">
              <Input type="number" min={0} value={seriesEligibleThreshold} onChange={(event) => setSeriesEligibleThreshold(Number(event.target.value || 10))} />
            </Field>
            <Field label="Max series per deletion batch" hint="Whole-series titles allowed per triggered deletion run">
              <Input type="number" min={0} value={maxSeriesPerBatch} onChange={(event) => setMaxSeriesPerBatch(Number(event.target.value || 1))} />
            </Field>
          </div>
        </div>
      </EditModal>
      </div>
    </>
  );
}
