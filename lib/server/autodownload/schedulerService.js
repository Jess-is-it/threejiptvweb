import 'server-only';

import { fetchMountStatus } from './mountService';
import { deleteSeriesPartialsForSelectionLog, startQueuedDownloads, syncDownloadsFromClient, runTimeoutChecker } from './downloadService';
import { processNextCompleted } from './processingService';
import { schedulerMaybeTriggerXuiScans } from './xuiService';
import { getAutodownloadSettings, updateAutodownloadSettings } from './autodownloadDb';
import { runMovieSelectionJob, runSeriesSelectionJob, runSelectionJobForType } from './selectionService';
import { releaseDueSelections } from './releaseService';
import { isReleaseDateDue, normalizeReleaseTimezone } from './releaseSchedule';
import { ensureQbittorrentVpnReadyForDispatch } from './vpnService';

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

export async function schedulerTick({ force = false, type = 'all' } = {}) {
  const tickType = sanitizeTickType(type);
  const settings = await getAutodownloadSettings();
  const enabled = Boolean(settings?.enabled);
  if (!enabled && !force) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  const out = {
    ok: true,
    at: now(),
    mount: null,
    sync: null,
    dispatch: null,
    vpn: null,
    timeouts: null,
    processed: null,
    release: null,
    xui: null,
    selection: null,
    timeoutReplacements: null,
  };

  try {
    out.mount = await fetchMountStatus().catch((e) => ({ ok: false, error: e?.message || 'mount status failed' }));
  } catch {}

  const runMovies = tickType === 'all' || tickType === 'movie';
  const runSeries = tickType === 'all' || tickType === 'series';

  const [moviesSelection, seriesSelection] = await Promise.all([
    runMovies
      ? runMovieSelectionJob({ force }).catch((e) => ({ ok: false, error: e?.message || 'movie selection failed' }))
      : Promise.resolve({ ok: true, skipped: true, reason: 'scope' }),
    runSeries
      ? runSeriesSelectionJob({ force }).catch((e) => ({ ok: false, error: e?.message || 'series selection failed' }))
      : Promise.resolve({ ok: true, skipped: true, reason: 'scope' }),
  ]);
  out.selection = { movies: moviesSelection, series: seriesSelection };
  const dispatchType = tickType === 'all' ? 'all' : tickType;
  const cleaningEnabled = settings?.cleaning?.enabled !== false;

  const limitByType = {
    movie: runMovies ? selectedCount(moviesSelection) : 0,
    series: runSeries ? selectedCount(seriesSelection) : 0,
  };

  let shouldDispatch =
    force ||
    (dispatchType === 'movie' ? limitByType.movie > 0 : dispatchType === 'series' ? limitByType.series > 0 : limitByType.movie > 0 || limitByType.series > 0);

  if (shouldDispatch) {
    out.vpn = await ensureQbittorrentVpnReadyForDispatch().catch((e) => ({
      ok: false,
      required: true,
      summary: e?.message || 'VPN guard failed.',
    }));
    if (!out.vpn?.ok) {
      shouldDispatch = false;
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
    out.dispatch = await startQueuedDownloads({ type: dispatchType, limitPerType: 2, limitByType, skipVpnGuard: true }).catch((e) => ({
      ok: false,
      error: e?.message || 'dispatch failed',
    }));

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

  out.sync = await syncDownloadsFromClient({ type: dispatchType }).catch((e) => ({ ok: false, error: e?.message || 'sync failed' }));
  out.timeouts = await runTimeoutChecker().catch((e) => ({ ok: false, error: e?.message || 'timeout checker failed' }));
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
  out.processed = cleaningEnabled
    ? await processNextCompleted({ type: dispatchType, all: true }).catch((e) => ({
        ok: false,
        error: e?.message || 'processing failed',
      }))
    : { ok: true, skipped: true, reason: 'cleaning_disabled' };
  out.release = await releaseDueSelections({ type: dispatchType }).catch((e) => ({
    ok: false,
    error: e?.message || 'release failed',
  }));
  out.xui = await schedulerMaybeTriggerXuiScans().catch((e) => ({ ok: false, error: e?.message || 'xui scan failed' }));

  await updateAutodownloadSettings({
    scheduler: {
      ...(settings?.scheduler || {}),
      lastTickAt: out.at,
    },
  });

  return out;
}
