import 'server-only';

import crypto from 'node:crypto';

import { fetchMountStatus } from './mountService';
import {
  countDispatchableDownloads,
  deleteSeriesPartialsForSelectionLog,
  pauseManagedDownloadsForMountOffline,
  pauseManagedDownloadsForVpnNotReady,
  resumeManagedDownloadsPausedForMount,
  resumeManagedDownloadsPausedForVpn,
  startQueuedDownloads,
  syncDownloadsFromClient,
  runTimeoutChecker,
} from './downloadService';
import { processNextCompleted } from './processingService';
import { schedulerMaybeTriggerXuiScans } from './xuiService';
import { getAutodownloadSettings, updateAutodownloadSettings } from './autodownloadDb';
import { runMovieSelectionJob, runSeriesSelectionJob, runSelectionJobForType } from './selectionService';
import { releaseDueSelections } from './releaseService';
import { isReleaseDateDue, normalizeReleaseTimezone } from './releaseSchedule';
import { runTelegramNotificationTick } from '../telegramNotifications';
import { ensureQbittorrentVpnReadyForDispatch } from './vpnService';
import { runDeletionCycle } from './deletionService';

function now() {
  return Date.now();
}

function sanitizeTickType(type) {
  const t = String(type || 'all').trim().toLowerCase();
  if (t === 'movie' || t === 'series') return t;
  return 'all';
}

function selectedCount(result) {
  if (!result || typeof result !== 'object') return 0;
  if (result.skipped) return 0;
  const direct = Number(result?.selected?.length || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const fromLog = Number(result?.log?.totalSelected || 0);
  if (Number.isFinite(fromLog) && fromLog > 0) return fromLog;
  return 0;
}

function schedulerLog(message, extra = null) {
  if (!['1', 'true', 'yes'].includes(String(process.env.AUTODOWNLOAD_DEBUG || '').trim().toLowerCase())) return;
  const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const suffix = extra && typeof extra === 'object' ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[scheduler] ${message} heap=${heapMb}MB${suffix}`);
}

async function runSchedulerPhase(name, fn) {
  const startedAt = now();
  schedulerLog(`${name}:start`);
  try {
    const result = await fn();
    schedulerLog(`${name}:done`, { durationMs: now() - startedAt });
    return result;
  } catch (e) {
    schedulerLog(`${name}:error`, { durationMs: now() - startedAt, error: e?.message || String(e) });
    throw e;
  }
}

function countSizeLimitRejections(dispatchResult, type = 'movie') {
  const wantedType = String(type || 'movie').toLowerCase();
  const rows = Array.isArray(dispatchResult?.results) ? dispatchResult.results : [];
  let count = 0;
  for (const row of rows) {
    const rowType = String(row?.type || '').toLowerCase();
    if (rowType && rowType !== wantedType) continue;
    const msg = String(row?.error || '');
    if (/filtered by size limit/i.test(msg)) count++;
  }
  return count;
}

function groupTimeoutReplacements(timeouts, { nowTs = Date.now(), timeZone = 'Asia/Manila' } = {}) {
  const rows = Array.isArray(timeouts?.timedOut) ? timeouts.timedOut : [];
  const out = new Map();
  for (const row of rows) {
    const selectionLogId = String(row?.selectionLogId || '').trim();
    const type = String(row?.type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
    const releaseDate = String(row?.releaseDate || '').trim();
    const releaseTag = String(row?.releaseTag || '').trim();
    if (!selectionLogId) continue;
    if (!releaseDate) continue;
    if (isReleaseDateDue({ releaseDate, nowTs, timeZone })) continue;
    const key = `${type}:${selectionLogId}`;
    const cur = out.get(key) || {
      type,
      selectionLogId,
      releaseDate,
      releaseTag,
      count: 0,
    };
    cur.count += 1;
    out.set(key, cur);
  }
  return [...out.values()].filter((x) => Number(x?.count || 0) > 0);
}

const BACKGROUND_RUN_TTL_MS = 15 * 60 * 1000;
const BACKGROUND_RUN_LIMIT = 12;

function getBackgroundRegistry() {
  if (!globalThis.__threejTvSchedulerBackgroundRegistry) {
    globalThis.__threejTvSchedulerBackgroundRegistry = {
      activeRunId: '',
      runs: new Map(),
    };
  }
  return globalThis.__threejTvSchedulerBackgroundRegistry;
}

function summarizeSchedulerResult(result, type = 'all') {
  const tickType = sanitizeTickType(type);
  const movieSelected = selectedCount(result?.selection?.movies);
  const seriesSelected = selectedCount(result?.selection?.series);
  const selectionResult =
    tickType === 'movie'
      ? result?.selection?.movies
      : tickType === 'series'
        ? result?.selection?.series
        : null;
  const selectionSkipped = Boolean(selectionResult?.skipped);
  const selectionReason = String(selectionResult?.reason || '').trim();
  const selectionOk = selectionResult ? selectionResult?.ok !== false : true;
  return {
    ok: result?.ok !== false && selectionOk,
    skipped: Boolean(result?.skipped) || selectionSkipped,
    reason: String(result?.reason || '').trim() || selectionReason,
    selected:
      tickType === 'movie'
        ? movieSelected
        : tickType === 'series'
          ? seriesSelected
          : movieSelected + seriesSelected,
    movieSelected,
    seriesSelected,
    started: Math.max(0, Number(result?.dispatch?.started || 0) || 0),
    failed: Math.max(0, Number(result?.dispatch?.failed || 0) || 0),
    released: Math.max(0, Number(result?.release?.releasedItems || 0) || 0),
  };
}

function serializeBackgroundRun(run) {
  if (!run) return null;
  return {
    id: String(run.id || ''),
    type: sanitizeTickType(run.type),
    force: Boolean(run.force),
    status: String(run.status || 'idle'),
    startedAt: Number(run.startedAt || 0) || 0,
    finishedAt: Number(run.finishedAt || 0) || 0,
    error: String(run.error || '').trim(),
    summary: run.summary && typeof run.summary === 'object' ? { ...run.summary } : null,
  };
}

function pruneBackgroundRuns(registry) {
  const entries = [...registry.runs.values()].sort((a, b) => Number(b?.startedAt || 0) - Number(a?.startedAt || 0));
  const cutoff = now() - BACKGROUND_RUN_TTL_MS;
  let kept = 0;
  for (const run of entries) {
    const isActive = String(registry.activeRunId || '') === String(run?.id || '');
    const finishedAt = Number(run?.finishedAt || 0) || 0;
    if (isActive) {
      kept += 1;
      continue;
    }
    if (finishedAt && finishedAt < cutoff) {
      registry.runs.delete(run.id);
      continue;
    }
    kept += 1;
    if (kept > BACKGROUND_RUN_LIMIT) registry.runs.delete(run.id);
  }
}

export function getSchedulerTickBackgroundStatus({ runId = '' } = {}) {
  const registry = getBackgroundRegistry();
  const wantedId = String(runId || '').trim();
  if (wantedId) {
    const wanted = registry.runs.get(wantedId) || null;
    return {
      active: Boolean(wanted && String(registry.activeRunId || '') === String(wanted.id || '') && wanted.status === 'running'),
      run: serializeBackgroundRun(wanted),
    };
  }

  const active = registry.activeRunId ? registry.runs.get(registry.activeRunId) || null : null;
  if (active) {
    return { active: active.status === 'running', run: serializeBackgroundRun(active) };
  }

  const latest = [...registry.runs.values()].sort((a, b) => Number(b?.startedAt || 0) - Number(a?.startedAt || 0))[0] || null;
  return { active: false, run: serializeBackgroundRun(latest) };
}

export function startSchedulerTickInBackground({ force = false, type = 'all' } = {}) {
  const registry = getBackgroundRegistry();
  const active = registry.activeRunId ? registry.runs.get(registry.activeRunId) || null : null;
  if (active && active.status === 'running') {
    return {
      accepted: false,
      alreadyRunning: true,
      run: serializeBackgroundRun(active),
    };
  }

  const run = {
    id: crypto.randomUUID(),
    type: sanitizeTickType(type),
    force: Boolean(force),
    status: 'running',
    startedAt: now(),
    finishedAt: 0,
    error: '',
    summary: null,
    promise: null,
  };

  registry.activeRunId = run.id;
  registry.runs.set(run.id, run);

  run.promise = (async () => {
    try {
      const result = await schedulerTick({ force: run.force, type: run.type });
      run.status = 'completed';
      run.finishedAt = now();
      run.summary = summarizeSchedulerResult(result, run.type);
      return result;
    } catch (e) {
      run.status = 'failed';
      run.finishedAt = now();
      run.error = e?.message || 'Tick failed.';
      run.summary = { ok: false, skipped: false, reason: '', selected: 0, movieSelected: 0, seriesSelected: 0, started: 0, failed: 0, released: 0 };
      return null;
    } finally {
      if (String(registry.activeRunId || '') === String(run.id || '')) registry.activeRunId = '';
      run.promise = null;
      pruneBackgroundRuns(registry);
    }
  })();

  return {
    accepted: true,
    alreadyRunning: false,
    run: serializeBackgroundRun(run),
  };
}

export async function schedulerTick({ force = false, type = 'all' } = {}) {
  const tickType = sanitizeTickType(type);
  const settings = await getAutodownloadSettings();
  const enabled = Boolean(settings?.enabled);
  if (!enabled && !force) {
    const notifications = await runSchedulerPhase('notifications', () =>
      runTelegramNotificationTick().catch((e) => ({
        ok: false,
        error: e?.message || 'telegram notifications failed',
      }))
    );
    return { ok: true, skipped: true, reason: 'disabled', notifications };
  }

  const out = {
    ok: true,
    at: now(),
    mount: null,
    deletion: null,
    sync: null,
    dispatch: null,
    vpn: null,
    timeouts: null,
    processed: null,
    release: null,
    xui: null,
    selection: null,
    timeoutReplacements: null,
    notifications: null,
  };

  try {
    out.mount = await runSchedulerPhase('mount', () =>
      fetchMountStatus().catch((e) => ({ ok: false, error: e?.message || 'mount status failed' }))
    );
  } catch {}

  const mountReady = out.mount?.ok === true;
  out.mountGuard = mountReady
    ? await runSchedulerPhase('mountGuard:resume', () =>
        resumeManagedDownloadsPausedForMount().catch((e) => ({ ok: false, action: 'resume', error: e?.message || 'resume failed' }))
      )
    : await runSchedulerPhase('mountGuard:pause', () =>
        pauseManagedDownloadsForMountOffline().catch((e) => ({ ok: false, action: 'pause', error: e?.message || 'pause failed' }))
      );

  out.deletion = await runSchedulerPhase('deletion', () =>
    runDeletionCycle().catch((e) => ({
      ok: false,
      error: e?.message || 'deletion cycle failed',
      active: false,
    }))
  );

  const runMovies = tickType === 'all' || tickType === 'movie';
  const runSeries = tickType === 'all' || tickType === 'series';
  const mountBlocksDownloads = !mountReady;
  const deletionBlocksDownloads =
    Boolean(out?.deletion?.active) &&
    (settings?.deletion?.pauseSelectionWhileActive !== false);

  const [moviesSelection, seriesSelection] = deletionBlocksDownloads
    ? [
        { ok: true, skipped: true, reason: 'deletion_active' },
        { ok: true, skipped: true, reason: 'deletion_active' },
      ]
    : await runSchedulerPhase('selection', () =>
        Promise.all([
          runMovies
            ? runMovieSelectionJob({ force }).catch((e) => ({ ok: false, error: e?.message || 'movie selection failed' }))
            : Promise.resolve({ ok: true, skipped: true, reason: 'scope' }),
          runSeries
            ? runSeriesSelectionJob({ force }).catch((e) => ({ ok: false, error: e?.message || 'series selection failed' }))
            : Promise.resolve({ ok: true, skipped: true, reason: 'scope' }),
        ])
      );
  out.selection = { movies: moviesSelection, series: seriesSelection };
  const dispatchType = tickType === 'all' ? 'all' : tickType;
  const cleaningEnabled = settings?.cleaning?.enabled !== false;
  const dispatchableCounts = await runSchedulerPhase('dispatchableCounts', () =>
    countDispatchableDownloads(dispatchType, out.at).catch(() => ({ movie: 0, series: 0 }))
  );

  const limitByType = {
    movie: runMovies ? Math.max(selectedCount(moviesSelection), Number(dispatchableCounts?.movie || 0)) : 0,
    series: runSeries ? Math.max(selectedCount(seriesSelection), Number(dispatchableCounts?.series || 0)) : 0,
  };

  let shouldDispatch =
    force ||
    (dispatchType === 'movie' ? limitByType.movie > 0 : dispatchType === 'series' ? limitByType.series > 0 : limitByType.movie > 0 || limitByType.series > 0);

  if (mountBlocksDownloads) {
    shouldDispatch = false;
    out.vpn = { ok: true, required: false, summary: 'Dispatch paused while NAS mount is not writable.' };
    out.dispatch = {
      ok: true,
      skipped: true,
      reason: 'mount_not_ready',
      started: 0,
      failed: 0,
      results: [],
      error: out.mount?.error || 'Selection and dispatch are paused while the NAS mount is offline.',
    };
  } else if (deletionBlocksDownloads) {
    shouldDispatch = false;
    out.vpn = { ok: true, required: false, summary: 'Dispatch paused while auto deletion is active.' };
    out.dispatch = {
      ok: true,
      skipped: true,
      reason: 'deletion_active',
      started: 0,
      failed: 0,
      results: [],
      error: 'Selection and dispatch are paused while deletion scheduling/execution is active.',
    };
  } else if (shouldDispatch) {
    out.vpn = await runSchedulerPhase('vpnGuard', () =>
      ensureQbittorrentVpnReadyForDispatch().catch((e) => ({
        ok: false,
        required: true,
        summary: e?.message || 'VPN guard failed.',
      }))
    );
    if (!out.vpn?.ok) {
      shouldDispatch = false;
      await runSchedulerPhase('vpnGuard:pause', () =>
        pauseManagedDownloadsForVpnNotReady({
          type: dispatchType,
          summary: out.vpn?.summary || out.vpn?.error || '',
        }).catch((e) => ({ ok: false, error: e?.message || 'vpn pause annotate failed' }))
      );
      out.dispatch = {
        ok: true,
        skipped: true,
        reason: 'vpn_not_ready',
        started: 0,
        failed: 0,
        results: [],
        error: out.vpn?.summary || 'VPN is required but not ready.',
      };
    }
  } else {
    out.vpn = { ok: true, required: false, summary: 'Dispatch not required this tick.' };
  }

  if (shouldDispatch) {
    await runSchedulerPhase('vpnGuard:resume', () =>
      resumeManagedDownloadsPausedForVpn({ type: dispatchType }).catch((e) => ({ ok: false, error: e?.message || 'vpn resume failed' }))
    );
    out.dispatch = await runSchedulerPhase('dispatch', () =>
      startQueuedDownloads({ type: dispatchType, limitPerType: 2, limitByType, skipVpnGuard: true }).catch((e) => ({
        ok: false,
        error: e?.message || 'dispatch failed',
      }))
    );

    if (runMovies) {
      const rejectedBySize = countSizeLimitRejections(out.dispatch, 'movie');
      if (rejectedBySize > 0) {
        const replacementSelection = await runMovieSelectionJob({
          force: true,
          preserveLastRun: true,
          targetTotal: rejectedBySize,
          triggerReason: 'size_limit_replacement',
        }).catch((e) => ({ ok: false, error: e?.message || 'replacement selection failed' }));

        const replacementSelected = selectedCount(replacementSelection);
        let replacementDispatch = { ok: true, skipped: true, reason: 'no_replacements_selected', started: 0, failed: 0, results: [] };
        if (replacementSelected > 0) {
          replacementDispatch = await startQueuedDownloads({
            type: 'movie',
            limitPerType: 2,
            limitByType: { movie: replacementSelected, series: 0 },
            skipVpnGuard: true,
          }).catch((e) => ({ ok: false, error: e?.message || 'replacement dispatch failed', started: 0, failed: 0, results: [] }));
        }

        out.dispatchReplacement = {
          requested: rejectedBySize,
          selected: replacementSelected,
          selection: replacementSelection,
          dispatch: replacementDispatch,
        };

        if (out.dispatch?.ok && replacementDispatch?.ok) {
          out.dispatch.started = Number(out.dispatch.started || 0) + Number(replacementDispatch.started || 0);
          out.dispatch.failed = Number(out.dispatch.failed || 0) + Number(replacementDispatch.failed || 0);
          out.dispatch.skipped = Number(out.dispatch.skipped || 0) + Number(replacementDispatch.skipped || 0);
          out.dispatch.results = [...(Array.isArray(out.dispatch.results) ? out.dispatch.results : []), ...(replacementDispatch.results || [])];
          out.dispatch.replacements = {
            requested: rejectedBySize,
            selected: replacementSelected,
            started: Number(replacementDispatch.started || 0),
            failed: Number(replacementDispatch.failed || 0),
          };
        }
      }
    }
  } else if (!out.dispatch) {
    out.dispatch = { ok: true, skipped: true, reason: 'selection_not_due', started: 0, failed: 0, results: [] };
  }

  out.sync = await runSchedulerPhase('sync', () =>
    syncDownloadsFromClient({ type: dispatchType }).catch((e) => ({ ok: false, error: e?.message || 'sync failed' }))
  );
  out.timeouts = mountBlocksDownloads
    ? { ok: true, skipped: true, reason: 'mount_not_ready', deleted: 0, timedOut: [], error: out.mount?.error || 'NAS not mounted/writable.' }
    : await runSchedulerPhase('timeouts', () =>
        runTimeoutChecker().catch((e) => ({ ok: false, error: e?.message || 'timeout checker failed' }))
      );
  const releaseTz = normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const strictSeriesReplacement = settings?.timeoutChecker?.strictSeriesReplacement !== false;
  const deletePartialSeriesOnReplacementFailure = settings?.timeoutChecker?.deletePartialSeriesOnReplacementFailure !== false;
  const timeoutReplacementGroups = groupTimeoutReplacements(out.timeouts, { nowTs: out.at, timeZone: releaseTz });
  if (timeoutReplacementGroups.length) {
    const replacementRuns = [];
    const seriesFallbackRuns = [];
    for (const grp of timeoutReplacementGroups) {
      const replacementSelection = await runSelectionJobForType({
        type: grp.type,
        force: true,
        preserveLastRun: true,
        targetTotal: grp.count,
        triggerReason: 'timeout_replacement',
        selectionLogId: grp.selectionLogId,
        releaseDate: grp.releaseDate,
        releaseTag: grp.releaseTag,
      }).catch((e) => ({ ok: false, error: e?.message || 'timeout replacement selection failed' }));
      const replacementSelected = selectedCount(replacementSelection);
      let replacementDispatch = { ok: true, skipped: true, reason: 'no_replacements_selected', started: 0, failed: 0, results: [] };
      if (replacementSelected > 0) {
        replacementDispatch = await startQueuedDownloads({
          type: grp.type,
          limitPerType: 2,
          limitByType:
            grp.type === 'series'
              ? { movie: 0, series: replacementSelected }
              : { movie: replacementSelected, series: 0 },
          skipVpnGuard: true,
        }).catch((e) => ({
          ok: false,
          error: e?.message || 'timeout replacement dispatch failed',
          started: 0,
          failed: 0,
          results: [],
        }));
      }
      replacementRuns.push({
        ...grp,
        requested: grp.count,
        selected: replacementSelected,
        selection: replacementSelection,
        dispatch: replacementDispatch,
      });

      if (grp.type === 'series' && strictSeriesReplacement && replacementSelected < grp.count) {
        const shortfall = Math.max(0, Number(grp.count || 0) - Number(replacementSelected || 0));
        let partialCleanup = { ok: true, skipped: true, reason: 'partial_cleanup_disabled' };
        if (deletePartialSeriesOnReplacementFailure) {
          partialCleanup = await deleteSeriesPartialsForSelectionLog({
            selectionLogId: grp.selectionLogId,
            reason:
              'Series auto-download removed after timeout replacement failed for one or more episodes/seasons across all configured sources.',
          }).catch((e) => ({ ok: false, error: e?.message || 'series partial cleanup failed' }));
        }

        let fallbackSelection = { ok: true, skipped: true, reason: 'no_shortfall' };
        let fallbackSelected = 0;
        let fallbackDispatch = { ok: true, skipped: true, reason: 'none', started: 0, failed: 0, results: [] };
        if (shortfall > 0) {
          fallbackSelection = await runSeriesSelectionJob({
            force: true,
            preserveLastRun: true,
            targetTotal: shortfall,
            triggerReason: 'series_timeout_replacement_fallback',
          }).catch((e) => ({ ok: false, error: e?.message || 'fallback series selection failed' }));
          fallbackSelected = selectedCount(fallbackSelection);
          if (fallbackSelected > 0) {
            fallbackDispatch = await startQueuedDownloads({
              type: 'series',
              limitPerType: 2,
              limitByType: { movie: 0, series: fallbackSelected },
              skipVpnGuard: true,
            }).catch((e) => ({
              ok: false,
              error: e?.message || 'fallback series dispatch failed',
              started: 0,
              failed: 0,
              results: [],
            }));
          } else {
            fallbackDispatch = { ok: true, skipped: true, reason: 'no_fallback_series_selected', started: 0, failed: 0, results: [] };
          }
        }

        seriesFallbackRuns.push({
          ...grp,
          requested: grp.count,
          initiallySelected: replacementSelected,
          shortfall,
          partialCleanup,
          fallbackSelection,
          fallbackSelected,
          fallbackDispatch,
        });
      }
    }
    out.timeoutReplacements = {
      ok: true,
      groups: replacementRuns,
      seriesFallbacks: seriesFallbackRuns,
    };
  } else {
    out.timeoutReplacements = { ok: true, skipped: true, reason: 'none' };
  }
  out.processed = mountBlocksDownloads
    ? { ok: true, skipped: true, reason: 'mount_not_ready' }
    : cleaningEnabled
    ? await runSchedulerPhase('processing', () =>
        processNextCompleted({ type: dispatchType, all: true }).catch((e) => ({
          ok: false,
          error: e?.message || 'processing failed',
        }))
      )
    : { ok: true, skipped: true, reason: 'cleaning_disabled' };
  out.release = mountBlocksDownloads
    ? { ok: true, skipped: true, reason: 'mount_not_ready' }
    : await runSchedulerPhase('release', () =>
        releaseDueSelections({ type: dispatchType }).catch((e) => ({
          ok: false,
          error: e?.message || 'release failed',
        }))
      );
  out.xui = await runSchedulerPhase('xuiScans', () =>
    schedulerMaybeTriggerXuiScans().catch((e) => ({ ok: false, error: e?.message || 'xui scan failed' }))
  );
  out.notifications = await runSchedulerPhase('notifications', () =>
    runTelegramNotificationTick({
      mountStatus: out.mount,
      vodState: out.deletion?.vodState || null,
    }).catch((e) => ({
      ok: false,
      error: e?.message || 'telegram notifications failed',
    }))
  );

  await updateAutodownloadSettings({
    scheduler: {
      ...(settings?.scheduler || {}),
      lastTickAt: out.at,
    },
  });

  return out;
}
