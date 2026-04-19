'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { msUntilRelease } from '../../../lib/releaseTime';
import AdminAutoDownloadSelectionSettingsButton from './AdminAutoDownloadSelectionSettingsButton';
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

function getDisplayStatus(item = {}) {
  const status = String(item?.status || '').trim();
  const s = status.toLowerCase();
  const releaseState = String(item?.releaseState || '').trim().toLowerCase();

  if (s === 'deleted') {
    return { value: 'deleted', label: 'Deleted' };
  }
  if (s === 'failed') {
    return { value: 'failed', label: status || 'Failed' };
  }
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

const SERIES_PIPELINE_META = {
  newSeries: {
    label: 'New S1 Pack',
    shortLabel: 'S1 Pack',
    modeLabel: 'Season 1 pack',
    tone: 'info',
  },
  newSeriesEpisode: {
    label: 'New Episode',
    shortLabel: 'New Ep',
    modeLabel: 'First episode',
    tone: 'accent',
  },
  existingSeries: {
    label: 'Existing Series',
    shortLabel: 'Existing',
    modeLabel: 'Next episode',
    tone: 'success',
  },
  deferredRetry: {
    label: 'Retry',
    shortLabel: 'Retry',
    modeLabel: 'Replacement retry',
    tone: 'warning',
  },
  legacy: {
    label: 'Legacy',
    shortLabel: 'Legacy',
    modeLabel: 'Pre-pipeline',
    tone: 'neutral',
  },
};

function normalizeSeriesPipelineKey(value = '') {
  const key = String(value || '').trim();
  if (key === 'newSeries' || key === 'newSeriesEpisode' || key === 'existingSeries' || key === 'deferredRetry') return key;
  return '';
}

function normalizeAcquisitionMode(value = '') {
  return String(value || '').trim().toLowerCase();
}

function seriesPipelineKeyFromRow(row = {}) {
  const explicit = normalizeSeriesPipelineKey(row?.pipelineKey || row?._selectionPipelineKey || row?.seriesMeta?.pipelineKey);
  if (explicit) return explicit;
  const mode = normalizeAcquisitionMode(row?.acquisitionMode || row?._selectionAcquisitionMode || row?.seriesMeta?.acquisitionMode || row?.seriesMeta?.mode);
  if (mode === 'first_episode' || mode === 'new_episode') return 'newSeriesEpisode';
  if (mode === 'next_episode' || mode === 'episode') return 'existingSeries';
  if (mode === 'replacement_retry') return 'deferredRetry';
  if (mode === 'season_pack') return 'newSeries';
  return 'legacy';
}

function acquisitionModeLabel(value = '') {
  const mode = normalizeAcquisitionMode(value);
  if (mode === 'season_pack') return 'Season 1 pack';
  if (mode === 'first_episode' || mode === 'new_episode') return 'First episode';
  if (mode === 'next_episode' || mode === 'episode') return 'Next episode';
  if (mode === 'replacement_retry') return 'Replacement retry';
  return '';
}

function getSeriesPipelineMeta(key = '') {
  return SERIES_PIPELINE_META[normalizeSeriesPipelineKey(key) || key] || SERIES_PIPELINE_META.legacy;
}

function SeriesPipelinePill({ pipelineKey = '', acquisitionMode = '', compact = false }) {
  const key = normalizeSeriesPipelineKey(pipelineKey) || 'legacy';
  const meta = getSeriesPipelineMeta(key);
  const modeLabel = acquisitionModeLabel(acquisitionMode) || meta.modeLabel;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium"
      style={toneStyle(meta.tone)}
      title={`${meta.label}${modeLabel ? ` · ${modeLabel}` : ''}`}
    >
      {compact ? meta.shortLabel : meta.label}
    </span>
  );
}

function seriesPipelineCounts(log = {}) {
  const counts = {
    newSeries: 0,
    newSeriesEpisode: 0,
    existingSeries: 0,
    deferredRetry: 0,
    legacy: 0,
  };
  for (const row of Array.isArray(log?.selectedItems) ? log.selectedItems : []) {
    const key = seriesPipelineKeyFromRow(row);
    counts[key] = Math.max(0, Number(counts[key] || 0) || 0) + 1;
  }
  return counts;
}

function SeriesPipelineCounts({ log }) {
  const counts = seriesPipelineCounts(log);
  const rows = ['newSeries', 'newSeriesEpisode', 'existingSeries', 'deferredRetry', 'legacy'].filter((key) => Number(counts[key] || 0) > 0);
  if (!rows.length) return <span className="text-xs text-[var(--admin-muted)]">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {rows.map((key) => {
        const meta = getSeriesPipelineMeta(key);
        return (
          <span
            key={key}
            className="inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium"
            style={toneStyle(meta.tone)}
            title={meta.label}
          >
            {meta.shortLabel}: {counts[key]}
          </span>
        );
      })}
    </div>
  );
}

function BucketCountsSummary({ log }) {
  return (
    <div className="whitespace-nowrap text-xs text-[var(--admin-muted)]">
      RA <Num v={log?.recentAnimationSelected} /> · RL <Num v={log?.recentLiveActionSelected} /> · CA{' '}
      <Num v={log?.classicAnimationSelected} /> · CL <Num v={log?.classicLiveActionSelected} />
    </div>
  );
}

const tmdbPosterCache = new Map();

function tmdbPosterUrl(path, size = 'w342') {
  const p = String(path || '').trim();
  return p ? `https://image.tmdb.org/t/p/${size}${p}` : '';
}

function MoviePoster({ tmdbId = 0, title = '', mediaType = 'movie' }) {
  const safeTmdbId = Number(tmdbId || 0);
  const normalizedMediaType = mediaType === 'series' ? 'tv' : 'movie';
  const [poster, setPoster] = useState(() =>
    safeTmdbId > 0 ? tmdbPosterCache.get(`${normalizedMediaType}:${String(safeTmdbId)}`) || '' : ''
  );

  useEffect(() => {
    if (!(safeTmdbId > 0)) return;
    const cacheKey = `${normalizedMediaType}:${String(safeTmdbId)}`;
    if (tmdbPosterCache.has(cacheKey)) {
      setPoster(tmdbPosterCache.get(cacheKey) || '');
      return;
    }
    let active = true;
    fetch(`/api/tmdb/images?type=${encodeURIComponent(normalizedMediaType)}&id=${encodeURIComponent(safeTmdbId)}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!active) return;
        const filePath = String(j?.posters?.[0]?.file_path || '').trim();
        const nextPoster = tmdbPosterUrl(filePath);
        tmdbPosterCache.set(cacheKey, nextPoster);
        setPoster(nextPoster);
      })
      .catch(() => {
        if (!active) return;
        tmdbPosterCache.set(cacheKey, '');
        setPoster('');
      });
    return () => {
      active = false;
    };
  }, [normalizedMediaType, safeTmdbId]);

  if (poster) {
    return <img src={poster} alt={title || 'Poster'} className="h-20 w-14 rounded-lg object-cover shadow-sm" loading="lazy" />;
  }

  return (
    <div className="flex h-20 w-14 items-center justify-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-center text-[10px] font-semibold text-[var(--admin-muted)]">
      {String(title || '?')
        .trim()
        .slice(0, 1)
        .toUpperCase() || '?'}
    </div>
  );
}

function isPlaceholderJob(item = {}) {
  return item?._placeholder === true;
}

function describeQbDeleteStatus(item = {}) {
  const value = String(item?.qbDeleteStatus || '').trim().toLowerCase();
  if (!value) return '';
  if (value === 'waiting_delay') {
    const dueAt = Number(item?.qbDeleteDueAt || 0);
    return dueAt > 0
      ? `Waiting for Delete Delay to finish before qB torrent removal (${new Date(dueAt).toLocaleString()}).`
      : 'Waiting for Delete Delay to finish before qB torrent removal.';
  }
  if (value === 'deleted_after_download') return 'qB torrent was auto-deleted after completion delay.';
  if (value === 'missing_in_client') return 'qB torrent was already missing from qBittorrent when sync checked it.';
  if (value === 'deleted') return 'qB torrent entry was removed successfully.';
  if (value === 'already_deleted') return 'qB torrent was already gone when auto-delete ran.';
  if (value === 'error') return String(item?.qbDeleteError || '').trim() || 'qB torrent auto-delete failed.';
  return value.replace(/_/g, ' ');
}

function jobStatusHelp(item = {}, type = 'movie') {
  const statusInfo = getDisplayStatus(item);
  const statusValue = String(statusInfo?.value || '').toLowerCase();
  const mediaLabel = type === 'series' ? 'series title' : 'movie';
  if (statusValue === 'queued') {
    if (isPlaceholderJob(item)) return 'Selected in the run log, but no active queue row exists for this title right now.';
    return `Queued for AutoDownload. qBittorrent has not started this ${mediaLabel} yet.`;
  }
  if (statusValue === 'downloading') return `qBittorrent is actively downloading this ${mediaLabel} into the Downloading stage.`;
  if (statusValue === 'completed') return 'Download finished in qBittorrent and is waiting for cleaning/processing.';
  if (statusValue === 'processing') return 'Cleaner is normalizing the folder, files, and subtitles.';
  if (statusValue === 'cleaned') return `Cleaning finished. This ${mediaLabel} is staged under Cleaned and Ready.`;
  if (statusValue === 'waiting_to_release') {
    return `Cleaning is finished. This ${mediaLabel} is waiting for release date ${String(item?.releaseDate || '').trim() || '—'}.`;
  }
  if (statusValue === 'deployed_in_xui') return 'Released from Cleaned and Ready into the final library and deployed to XUI.';
  if (statusValue === 'failed') return String(item?.error || '').trim() || 'This job failed.';
  if (statusValue === 'deleted') {
    if (String(item?.releaseState || '').trim().toLowerCase() === 'timed_out') {
      return 'This earlier attempt hit the timeout window and was replaced or retried later in the same selection log.';
    }
    return (
      String(item?.deletedReason || '').trim() ||
      String(item?.error || '').trim() ||
      describeQbDeleteStatus(item) ||
      'This job was deleted and will not continue through the pipeline.'
    );
  }
  return String(item?.error || '').trim() || `Current status: ${statusInfo?.label || 'Queued'}.`;
}

const REPLACE_LOCK_WINDOW_MS = 5 * 60 * 60 * 1000;

function replaceDisabledReason(item = {}, type = 'movie') {
  const mediaLabel = type === 'series' ? 'series title' : 'movie';
  if (isPlaceholderJob(item)) return 'This title has no queue row to replace.';
  if (String(item?.releaseState || '').trim().toLowerCase() === 'released') {
    return `Replace is locked because this ${mediaLabel} is already deployed in XUI.`;
  }
  const remainingMs = msUntilRelease({
    releaseDate: item?.releaseDate,
    timeZone: item?.releaseTimezone || 'Asia/Manila',
  });
  if (remainingMs !== null && remainingMs <= REPLACE_LOCK_WINDOW_MS) {
    return 'Replace is locked because the scheduled release is already within 5 hours.';
  }
  return '';
}

function deleteDisabledReason(item = {}, type = 'movie') {
  const mediaLabel = type === 'series' ? 'series title' : 'movie';
  if (isPlaceholderJob(item)) return 'This title has no queue row to delete.';
  if (String(item?.releaseState || '').trim().toLowerCase() === 'released') {
    return `Delete is locked because this ${mediaLabel} is already deployed in XUI.`;
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeSchedulerRun(run = {}, selectionType = 'movie') {
  const summary = run?.summary && typeof run.summary === 'object' ? run.summary : {};
  const selected =
    selectionType === 'series'
      ? Number((summary?.seriesSelected ?? summary?.selected) || 0)
      : Number((summary?.movieSelected ?? summary?.selected) || 0);
  return {
    selected: Math.max(0, Number.isFinite(selected) ? selected : 0),
    started: Math.max(0, Number(summary?.started || 0) || 0),
    failed: Math.max(0, Number(summary?.failed || 0) || 0),
    skipped: Boolean(summary?.skipped),
    reason: String(summary?.reason || '').trim(),
  };
}

async function waitForSchedulerRun(runId) {
  const wantedRunId = String(runId || '').trim();
  if (!wantedRunId) throw new Error('Trigger did not return a background run id.');

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const sp = new URLSearchParams();
    sp.set('status', '1');
    sp.set('runId', wantedRunId);
    const response = await fetch(`/api/admin/autodownload/scheduler/tick?${sp.toString()}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Failed to read AutoDownload status.');
    }

    const run = payload?.run || null;
    if (run && String(run?.status || '').trim().toLowerCase() !== 'running') {
      return run;
    }

    await sleep(1500);
  }

  throw new Error('AutoDownload is still running. Refresh the page to inspect the latest queue state.');
}

async function waitForDownloadControlRun(runId, onUpdate = null) {
  const wantedRunId = String(runId || '').trim();
  if (!wantedRunId) throw new Error('Replace did not return a background run id.');
  let missingRunCount = 0;

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const sp = new URLSearchParams();
    sp.set('status', '1');
    sp.set('runId', wantedRunId);
    const response = await fetch(`/api/admin/autodownload/downloads/control?${sp.toString()}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error('Admin session expired while polling Replace status. Refresh and sign in again.');
    }
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Failed to read replace status.');
    }

    const run = payload?.run || null;
    if (!run) {
      missingRunCount += 1;
      if (missingRunCount >= 4) {
        throw new Error('Replace status was lost. Refresh the page to inspect the latest queue state.');
      }
      await sleep(1500);
      continue;
    }
    missingRunCount = 0;
    if (run && typeof onUpdate === 'function') onUpdate(run);
    if (run && String(run?.status || '').trim().toLowerCase() !== 'running') {
      return run;
    }

    await sleep(1500);
  }

  throw new Error('Replace is still running. Refresh the page to inspect the latest queue state.');
}

export default function AdminAutoDownloadSelectionLogPanel({ type = 'movie' }) {
  const selectionType = type === 'series' ? 'series' : 'movie';
  const isMovie = selectionType === 'movie';
  const selectionLabel = isMovie ? 'Movie' : 'Series';
  const selectionStrategyLabel = `${selectionLabel} Selection Strategy`;
  const jobsLabel = isMovie ? 'Movies Jobs' : 'Series Jobs';
  const selectionLogTitle = `${selectionLabel} Selection Log`;
  const itemLabel = isMovie ? 'movie' : 'series title';
  // Selection Log row actions are shared across movies and series.
  // Delete All remains movie-only.
  const showDeleteAll = isMovie;
  const showRowReplaceDelete = true;

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
  const [jobsPipeline, setJobsPipeline] = useState('all');
  const [selectedJob, setSelectedJob] = useState(null);
  const [releaseEditOpen, setReleaseEditOpen] = useState(false);
  const [releaseDateDraft, setReleaseDateDraft] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseErr, setReleaseErr] = useState('');
  const [jobActionKey, setJobActionKey] = useState('');
  const [jobActionRun, setJobActionRun] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`/api/admin/autodownload/selection-log?type=${encodeURIComponent(selectionType)}&limit=200`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load selection log.');
      const nextLogs = Array.isArray(j.logs) ? j.logs : [];
      setLogs(nextLogs);
      return nextLogs;
    } catch (e) {
      setErr(e?.message || 'Failed to load selection log.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [selectionType]);

  useEffect(() => {
    load();
  }, [load]);

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
    setJobsPipeline('all');
    setReleaseEditOpen(false);
    setReleaseDateDraft(String(run?.releaseDate || '').trim());
    setReleaseErr('');
    try {
      const r = await fetch(`/api/admin/autodownload/downloads?type=${encodeURIComponent(selectionType)}&seed=0&dispatch=0`, {
        cache: 'no-store',
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Failed to load ${selectionType} jobs.`);
      const allJobs = Array.isArray(j.items) ? j.items : [];
      const runRows = Array.isArray(run?.selectedItems) ? run.selectedItems : [];
      const runId = String(run?.id || '').trim();
      const selectionMetaByTmdb = new Map();
      const selectionOrderByTmdb = new Map();
      for (let idx = 0; idx < runRows.length; idx += 1) {
        const row = runRows[idx];
        const tmdbId = tmdbIdFromJob(row);
        if (!(tmdbId > 0)) continue;
        if (!selectionMetaByTmdb.has(tmdbId)) selectionMetaByTmdb.set(tmdbId, row);
        if (!selectionOrderByTmdb.has(tmdbId)) selectionOrderByTmdb.set(tmdbId, idx);
      }

      const queueRows = allJobs
        .filter((job) => String(job?.selectionLogId || '').trim() === runId)
        .map((job, idx) => {
          const tmdbId = tmdbIdFromJob(job);
          const meta = tmdbId > 0 ? selectionMetaByTmdb.get(tmdbId) : null;
          return {
            ...job,
            _selectionBucket: meta?.bucket || '',
            _selectionProvider: meta?.provider || String(job?.source?.provider || '').trim(),
            _selectionPipelineKey: meta?.pipelineKey || job?.seriesMeta?.pipelineKey || '',
            _selectionAcquisitionMode: meta?.acquisitionMode || job?.seriesMeta?.acquisitionMode || job?.seriesMeta?.mode || '',
            _sortOrder: selectionOrderByTmdb.has(tmdbId) ? selectionOrderByTmdb.get(tmdbId) : runRows.length + idx,
          };
        });

      const queuedTmdbIds = new Set(queueRows.map((row) => tmdbIdFromJob(row)).filter((value) => value > 0));
      const placeholders = runRows
        .filter((row) => {
          const tmdbId = tmdbIdFromJob(row);
          return tmdbId > 0 && !queuedTmdbIds.has(tmdbId);
        })
        .map((row, idx) => {
          const tmdbId = tmdbIdFromJob(row);
          return {
            id: `${runId || 'run'}:placeholder:${tmdbId || idx}`,
            title: row?.title || 'Untitled',
            year: row?.year || '',
            tmdb: tmdbId > 0 ? { id: tmdbId } : null,
            status: 'Queued',
            progress: null,
            sizeBytes: null,
            addedAt: null,
            error: '',
            _selectionBucket: row?.bucket || '',
            _selectionProvider: row?.provider || '',
            _selectionPipelineKey: row?.pipelineKey || '',
            _selectionAcquisitionMode: row?.acquisitionMode || '',
            _placeholder: true,
            _sortOrder: selectionOrderByTmdb.has(tmdbId) ? selectionOrderByTmdb.get(tmdbId) : runRows.length + idx,
          };
        });

      const activeTmdbIds = new Set(
        queueRows
          .filter((row) => String(row?.status || '').trim().toLowerCase() !== 'deleted')
          .map((row) => tmdbIdFromJob(row))
          .filter((value) => value > 0)
      );

      const visibleQueueRows = queueRows.filter((row) => {
        const status = String(row?.status || '').trim().toLowerCase();
        const releaseState = String(row?.releaseState || '').trim().toLowerCase();
        const tmdbId = tmdbIdFromJob(row);
        if (status !== 'deleted') return true;
        if (!(tmdbId > 0)) return true;
        if (releaseState !== 'timed_out') return true;
        return !activeTmdbIds.has(tmdbId);
      });

      const merged = [...visibleQueueRows, ...placeholders].sort((left, right) => {
        const orderDiff = Number(left?._sortOrder || 0) - Number(right?._sortOrder || 0);
        if (orderDiff !== 0) return orderDiff;
        const leftDeleted = String(left?.status || '').trim().toLowerCase() === 'deleted' ? 1 : 0;
        const rightDeleted = String(right?.status || '').trim().toLowerCase() === 'deleted' ? 1 : 0;
        if (leftDeleted !== rightDeleted) return leftDeleted - rightDeleted;
        const leftTime = Number(left?.updatedAt || left?.cleanedAt || left?.completedAt || left?.addedAt || 0) || 0;
        const rightTime = Number(right?.updatedAt || right?.cleanedAt || right?.completedAt || right?.addedAt || 0) || 0;
        return rightTime - leftTime;
      });

      setJobs(merged);
    } catch (e) {
      setJobsErr(e?.message || `Failed to load ${selectionType} jobs.`);
    } finally {
      setJobsLoading(false);
    }
  };

  const actJob = async (job, action) => {
    const realId = String(job?.id || '').trim();
    if (!realId || isPlaceholderJob(job)) return;
    let confirmMessage = '';
    if (action === 'replace') {
      confirmMessage =
        `Replace this ${itemLabel} with another random ${itemLabel} from the current selection strategy?\n\nIf this ${itemLabel} is already downloaded/cleaned/released, its files will also be removed.`;
    } else if (action === 'delete') {
      confirmMessage =
        `Delete this ${itemLabel} job?\n\nIf this ${itemLabel} already exists in Downloading, Cleaned and Ready, or final library folders, those files will also be removed.`;
    } else {
      return;
    }
    if (!window.confirm(confirmMessage)) return;

    const busyKey = `${action}:${realId}`;
    setJobActionKey(busyKey);
    setErr('');
    setOk('');
    setJobsErr('');
    try {
      if (action === 'replace') {
        setJobActionRun({
          id: '',
          itemId: realId,
          action,
          title: String(job?.title || itemLabel).trim(),
          status: 'running',
          progress: 1,
          phaseLabel: 'Queueing replacement…',
        });
        const r = await fetch('/api/admin/autodownload/downloads/control', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: selectionType, id: realId, action, title: job?.title || '', background: true }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Failed to ${action} ${selectionType} job.`);

        const startedRun = j?.run || null;
        if (startedRun) setJobActionRun(startedRun);
        if (j?.alreadyRunning) {
          setOk(`Replace is already running for ${String(job?.title || itemLabel).trim()}. Waiting for completion…`);
        }
        const finishedRun = await waitForDownloadControlRun(startedRun?.id || '', setJobActionRun);

        const nextLogs = await load();
        const refreshedRun =
          (Array.isArray(nextLogs) ? nextLogs : []).find(
            (row) => String(row?.id || '').trim() === String(finishedRun?.result?.log?.id || selectedRun?.id || '').trim()
          ) || selectedRun;
        if (refreshedRun) await openRun(refreshedRun);

        if (String(finishedRun?.status || '').trim().toLowerCase() === 'failed') {
          throw new Error(String(finishedRun?.error || '').trim() || `Failed to replace ${selectionType} job.`);
        }

        setOk(
          `Replaced ${String(job?.title || itemLabel).trim()} with ${String(
            finishedRun?.result?.replacement?.title || finishedRun?.result?.replacement?.tmdb?.title || `a new ${itemLabel}`
          ).trim()}.`
        );
        return;
      }

      const r = await fetch('/api/admin/autodownload/downloads/control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: selectionType, id: realId, action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Failed to ${action} ${selectionType} job.`);

      const nextLogs = await load();
      const refreshedRun =
        (Array.isArray(nextLogs) ? nextLogs : []).find((row) => String(row?.id || '').trim() === String(j?.log?.id || selectedRun?.id || '').trim()) ||
        (j?.log ? { ...(selectedRun || {}), ...j.log } : selectedRun);
      if (refreshedRun) await openRun(refreshedRun);

      if (action === 'replace') {
        setOk(
          `Replaced ${String(job?.title || itemLabel).trim()} with ${String(
            j?.replacement?.title || j?.replacement?.tmdb?.title || `a new ${itemLabel}`
          ).trim()}.`
        );
      } else {
        setOk(`Deleted ${String(job?.title || itemLabel).trim()} and removed its managed files.`);
      }
    } catch (e) {
      setJobActionRun((prev) =>
        prev
          ? {
              ...prev,
              status: 'failed',
              progress: 100,
              phaseLabel: 'Replace failed',
              error: e?.message || `Failed to ${action} ${selectionType} job.`,
            }
          : prev
      );
      setJobsErr(e?.message || `Failed to ${action} ${selectionType} job.`);
    } finally {
      setJobActionKey('');
    }
  };

  const filteredJobs = useMemo(() => {
    const needle = String(jobsQ || '').trim().toLowerCase();
    const st = String(jobsStatus || 'all').trim().toLowerCase();
    const pipelineFilter = normalizeSeriesPipelineKey(jobsPipeline) || String(jobsPipeline || 'all').trim();
    return (Array.isArray(jobs) ? jobs : []).filter((x) => {
      const displayStatus = getDisplayStatus(x);
      if (st === 'size_rejected') {
        if (!isSizeLimitRejected(x)) return false;
      } else if (st !== 'all' && String(displayStatus?.value || '').toLowerCase() !== st) {
        return false;
      }
      if (selectionType === 'series' && pipelineFilter !== 'all' && seriesPipelineKeyFromRow(x) !== pipelineFilter) {
        return false;
      }
      if (!needle) return true;
      const pipelineKey = seriesPipelineKeyFromRow(x);
      const pipelineMeta = getSeriesPipelineMeta(pipelineKey);
      const hay =
        `${x?.title || ''} ${x?.year || ''} ${x?.qbName || ''} ${x?.tmdb?.id || ''} ${x?._selectionBucket || ''} ${x?._selectionProvider || ''} ${pipelineMeta.label || ''} ${pipelineMeta.shortLabel || ''} ${x?._selectionAcquisitionMode || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [jobs, jobsPipeline, jobsQ, jobsStatus, selectionType]);

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
    if (!confirm(`Run the ${selectionStrategyLabel} now?`)) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/selection-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true, type: selectionType }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Selection job failed.');
      if (j?.result?.skipped) setOk(`Skipped: ${j?.result?.reason || 'not due'}`);
      else setOk(`Selected ${j?.result?.log?.totalSelected ?? 0} ${selectionType === 'series' ? 'series' : 'movie'} item(s).`);
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
        body: JSON.stringify({ force: true, type: selectionType, background: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Trigger failed.');

      const startedRun = j?.run || null;
      setOk(j?.alreadyRunning ? 'AutoDownload is already running. Waiting for it to finish…' : 'AutoDownload started. Waiting for completion…');
      setTriggerProgress(40);

      const finishedRun = await waitForSchedulerRun(startedRun?.id || '');
      if (String(finishedRun?.status || '').trim().toLowerCase() === 'failed') {
        throw new Error(String(finishedRun?.error || '').trim() || 'Trigger failed.');
      }

      const summary = summarizeSchedulerRun(finishedRun, selectionType);
      if (summary.skipped) {
        setOk(`Triggered once. Skipped: ${summary.reason || 'not due'}`);
      } else {
        setOk(`Triggered once. Selected: ${summary.selected} · Started: ${summary.started} · Failed: ${summary.failed}`);
      }
      setTriggerProgress(90);
      await load();
      setTriggerProgress(100);
    } catch (e) {
      setErr(e?.message || 'Trigger failed.');
      await load().catch(() => null);
      setTriggerProgress(100);
    } finally {
      setBusy(false);
      setTimeout(() => {
        setIsTriggering(false);
        setTriggerProgress(0);
      }, 500);
    }
  };

  const deleteAllSelectionJobs = async () => {
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

  const clearSelectionLog = async () => {
    if (!confirm(`Clear all ${selectionLogTitle} entries?`)) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch(`/api/admin/autodownload/selection-log?type=${encodeURIComponent(selectionType)}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Failed to clear ${selectionLogTitle}.`);
      setOk(`Cleared ${Number(j?.deleted || 0)} ${selectionType} selection log entr${Number(j?.deleted || 0) === 1 ? 'y' : 'ies'}.`);
      await load();
    } catch (e) {
      setErr(e?.message || `Failed to clear ${selectionLogTitle}.`);
    } finally {
      setBusy(false);
    }
  };

  const notes = [
    {
      title: 'Purpose',
      items: isMovie
        ? [
            `Shows runs of the ${selectionStrategyLabel} (Recent/Classic × Animation/Live Action).`,
            `Click a row to open the ${jobsLabel} table in a modal.`,
          ]
        : [
            'Shows each Series Selection Log run with pipeline counts: New S1 Pack, New Episode, Existing Series, and Retry.',
            'Click a row to open the Series Jobs table with pipeline, source, status, and action details.',
          ],
    },
    ...(isMovie
      ? []
      : [
          {
            title: 'Series pipelines',
            items: [
              'New S1 Pack bootstraps missing shows with a Season 1 pack.',
              'New Episode bootstraps missing shows with one Season 1 episode when packs are too large or weakly seeded.',
              'Existing Series continues shows already in the NAS with the next missing aired episode.',
              'Retry is used by timeout/replacement flows with stricter source gates.',
            ],
          },
        ]),
    {
      title: 'Run Now',
      items: ['Runs the selection immediately (admin debug). It still respects safety checks like mount health and storage limit.'],
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{selectionLogTitle}</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            {isMovie
              ? `Daily/interval selection runs for ${selectionLabel} strategy. Click any row to open the ${jobsLabel} table.`
              : `Daily/interval series runs grouped by New S1 Pack, New Episode, Existing Series, and Retry pipelines. Click any row to open the ${jobsLabel} table.`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title={`${selectionLogTitle} — Notes`} sections={notes} />
          <AdminAutoDownloadSelectionSettingsButton type={selectionType} />
          <button
            onClick={triggerAutoDownloadOnce}
            disabled={loading || busy}
            title="Manually trigger one AutoDownload cycle."
            className="rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            Trigger AutoDownload Once
          </button>
          {showDeleteAll ? (
            <button
              onClick={deleteAllSelectionJobs}
              disabled={loading || busy}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
              style={{
                ...toneStyle('danger'),
              }}
            >
              Delete All
            </button>
          ) : null}
          <button
            onClick={runNow}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {busy ? 'Running…' : 'Run Now'}
          </button>
          <button
            onClick={clearSelectionLog}
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
            {isMovie ? (
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
            ) : (
              <tr>
                <th className="px-3 py-2">Run time</th>
                <th className="px-3 py-2">Release date</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Pipeline counts</th>
                <th className="px-3 py-2">Bucket counts</th>
                <th className="px-3 py-2">Skipped dup</th>
                <th className="px-3 py-2">Skipped no source</th>
                <th className="px-3 py-2">Skipped storage</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            )}
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
                {isMovie ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2">
                      <SeriesPipelineCounts log={x} />
                    </td>
                    <td className="px-3 py-2">
                      <BucketCountsSummary log={x} />
                    </td>
                  </>
                )}
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
                <td colSpan={isMovie ? 11 : 9} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
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
                <div className="text-base font-semibold">{jobsLabel}</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  Run: {selectedRun?.runAt ? new Date(selectedRun.runAt).toLocaleString() : '—'} · Selected:{' '}
                  <Num v={selectedRun?.totalSelected} /> · Release: {selectedRun?.releaseDate || '—'}
                </div>
                {!isMovie ? (
                  <div className="mt-2">
                    <SeriesPipelineCounts log={selectedRun} />
                  </div>
                ) : null}
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
                {!isMovie ? (
                  <select
                    value={jobsPipeline}
                    onChange={(e) => setJobsPipeline(e.target.value)}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                  >
                    <option value="all">All pipelines</option>
                    <option value="newSeries">New S1 Pack</option>
                    <option value="newSeriesEpisode">New Episode</option>
                    <option value="existingSeries">Existing Series</option>
                    <option value="deferredRetry">Retry</option>
                    <option value="legacy">Legacy / unknown</option>
                  </select>
                ) : null}
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
            {jobActionRun && String(jobActionRun?.action || '').toLowerCase() === 'replace' ? (
              <div
                className="mt-3 rounded-lg border px-3 py-3"
                style={
                  toneStyle(
                    String(jobActionRun?.status || '').toLowerCase() === 'failed'
                      ? 'danger'
                      : String(jobActionRun?.status || '').toLowerCase() === 'completed'
                        ? 'success'
                        : 'info'
                  )
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-medium">
                    Replacing {String(jobActionRun?.title || itemLabel).trim() || itemLabel}
                  </div>
                  <div>{Math.max(0, Math.min(100, Number(jobActionRun?.progress || 0) || 0))}%</div>
                </div>
                <div className="mt-1 text-xs opacity-80">
                  {String(jobActionRun?.phaseLabel || '').trim() ||
                    (String(jobActionRun?.status || '').toLowerCase() === 'completed'
                      ? 'Replacement completed.'
                      : String(jobActionRun?.status || '').toLowerCase() === 'failed'
                        ? String(jobActionRun?.error || 'Replacement failed.').trim()
                        : 'Replacement in progress…')}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(0, Math.min(100, Number(jobActionRun?.progress || 0) || 0))}%`,
                      backgroundColor:
                        String(jobActionRun?.status || '').toLowerCase() === 'failed'
                          ? 'var(--admin-pill-danger-text)'
                          : String(jobActionRun?.status || '').toLowerCase() === 'completed'
                            ? 'var(--admin-pill-success-text)'
                            : 'var(--brand)',
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-3 py-2">Title</th>
                    {!isMovie ? <th className="px-3 py-2">Pipeline</th> : null}
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Progress</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Added / Downloaded</th>
                    <th className="px-3 py-2">Error</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((x) => (
                    <tr key={x.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-3">
                          <MoviePoster tmdbId={x?.tmdb?.id} title={x.title || x.qbName || 'Untitled'} mediaType={selectionType} />
                          <div className="min-w-0">
                            <div className="font-medium">{x.title || x.qbName || 'Untitled'}</div>
                            <div className="mt-1 line-clamp-1 text-xs text-[var(--admin-muted)]">
                              {x.year ? `${x.year} · ` : ''}
                              {x.tmdb?.id ? `TMDB:${x.tmdb.id}` : ''}
                            </div>
                            {x?._selectionBucket || x?._selectionProvider ? (
                              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                                {isMovie
                                  ? `${x?._selectionBucket ? `Bucket: ${x._selectionBucket}` : ''}${
                                      x?._selectionProvider
                                        ? `${x?._selectionBucket ? ' · ' : ''}Provider: ${String(x._selectionProvider).toUpperCase()}`
                                        : ''
                                    }`
                                  : x?._selectionProvider
                                    ? `Provider: ${String(x._selectionProvider).toUpperCase()}`
                                    : x?._selectionBucket
                                      ? `Bucket: ${x._selectionBucket}`
                                      : ''}
                              </div>
                            ) : null}
                            {isPlaceholderJob(x) ? (
                              <div className="mt-1 text-xs" style={{ color: 'var(--admin-pill-warning-text)' }}>
                                Queue row not found. This title only exists in the selection log right now.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      {!isMovie ? (
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-start gap-1">
                            <SeriesPipelinePill
                              pipelineKey={seriesPipelineKeyFromRow(x)}
                              acquisitionMode={x?._selectionAcquisitionMode || x?.seriesMeta?.acquisitionMode || x?.seriesMeta?.mode}
                            />
                            <div className="text-xs text-[var(--admin-muted)]">
                              {acquisitionModeLabel(x?._selectionAcquisitionMode || x?.seriesMeta?.acquisitionMode || x?.seriesMeta?.mode) || 'Mode —'}
                            </div>
                            {x?._selectionBucket ? (
                              <div className="text-xs text-[var(--admin-muted)]">Bucket: {x._selectionBucket}</div>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2" title={jobStatusHelp(x, selectionType)}>
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
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <span aria-hidden="true">＋</span>
                            <span>{x.addedAt ? new Date(x.addedAt).toLocaleString() : 'Added —'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span aria-hidden="true">↓</span>
                            <span>{x.downloadedAt || x.completedAt ? new Date(x.downloadedAt || x.completedAt).toLocaleString() : 'Downloaded —'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--admin-pill-danger-text)' }}>
                        {x.error || x.deletedReason || ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {showRowReplaceDelete ? (
                          (() => {
                            const replaceReason = replaceDisabledReason(x, selectionType);
                            const deleteReason = deleteDisabledReason(x, selectionType);
                            const replaceDisabled = Boolean(jobActionKey) || Boolean(replaceReason);
                            const deleteDisabled = Boolean(jobActionKey) || Boolean(deleteReason);
                            const replaceTitle = replaceReason || `Replace this ${itemLabel} with another random ${itemLabel}.`;
                            const deleteTitle = deleteReason || `Delete this ${itemLabel} and remove any managed files for it.`;
                            return (
                              <div className="flex justify-end gap-2">
                                <div className="flex items-center gap-1">
                                  <span className="inline-flex" title={replaceTitle}>
                                    <button
                                      type="button"
                                      onClick={() => actJob(x, 'replace')}
                                      disabled={replaceDisabled}
                                      title={replaceTitle}
                                      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      {jobActionKey === `replace:${x.id}` ? 'Replacing…' : 'Replace'}
                                    </button>
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="inline-flex" title={deleteTitle}>
                                    <button
                                      type="button"
                                      onClick={() => actJob(x, 'delete')}
                                      disabled={deleteDisabled}
                                      title={deleteTitle}
                                      className="rounded-lg border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                                      style={toneStyle('danger')}
                                    >
                                      {jobActionKey === `delete:${x.id}` ? 'Deleting…' : 'Delete'}
                                    </button>
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedJob(x)}
                                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10"
                                >
                                  Details
                                </button>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedJob(x)}
                              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs hover:bg-black/10"
                            >
                              Details
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!jobsLoading && filteredJobs.length === 0 ? (
                    <tr>
                      <td colSpan={isMovie ? 7 : 8} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                        {`No ${selectionType} jobs found.`}
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
