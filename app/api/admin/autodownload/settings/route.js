import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../lib/server/adminDb';
import { updateAutodownloadSettings } from '../../../../../lib/server/autodownload/autodownloadDb';
import { fetchVodStorageDevices } from '../../../../../lib/server/autodownload/mountService';
import { normalizeReleaseDelayDays, normalizeReleaseTimezone } from '../../../../../lib/server/autodownload/releaseSchedule';
import { bytesToGb, deriveStoragePolicy } from '../../../../../lib/server/autodownload/storagePolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const DEFAULT_TIMEZONE = 'Asia/Manila';

async function resolveStoragePolicyVolumeStats(existingDb) {
  const fallbackResolvedPath =
    String(existingDb?.mountSettings?.xuiVodPath || '').trim() ||
    String(existingDb?.deletionState?.vodState?.resolvedPath || '').trim() ||
    '/home/xui/content/vod';
  try {
    const vodStorage = await fetchVodStorageDevices();
    const logicalSize = Number(vodStorage?.logical?.size || 0);
    const logicalUsed = Number(vodStorage?.logical?.used || 0);
    const logicalAvail = Number(vodStorage?.logical?.avail || 0);
    if (logicalSize > 0) {
      return {
        totalBytes: logicalSize,
        usedBytes: logicalUsed > 0 ? logicalUsed : 0,
        availBytes: logicalAvail > 0 ? logicalAvail : Math.max(0, logicalSize - (logicalUsed > 0 ? logicalUsed : 0)),
        resolvedPath: String(vodStorage?.resolvedPath || vodStorage?.preferredPath || fallbackResolvedPath).trim() || fallbackResolvedPath,
      };
    }
  } catch {}
  const fallbackTotal =
    Number(existingDb?.deletionState?.vodState?.totalBytes || 0) ||
    Number(existingDb?.mountStatus?.space?.total || 0) ||
    0;
  const fallbackUsed =
    Number(existingDb?.deletionState?.vodState?.usedBytes || 0) ||
    Number(existingDb?.mountStatus?.space?.used || 0) ||
    0;
  const fallbackAvail =
    Number(existingDb?.deletionState?.vodState?.availBytes || 0) ||
    Number(existingDb?.mountStatus?.space?.avail || 0) ||
    Math.max(0, fallbackTotal - fallbackUsed);
  return {
    totalBytes: fallbackTotal,
    usedBytes: fallbackUsed,
    availBytes: fallbackAvail,
    resolvedPath: fallbackResolvedPath,
  };
}

function isValidTimeHHMM(s) {
  const v = String(s || '').trim();
  if (!/^\d{2}:\d{2}$/.test(v)) return false;
  const [hh, mm] = v.split(':').map((x) => Number(x));
  return Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function isValidTimezone(tz) {
  const s = String(tz || '').trim();
  if (!s) return false;
  try {
    // Will throw RangeError for invalid tz.
    new Intl.DateTimeFormat('en-US', { timeZone: s }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function uniqLower(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const v = String(raw || '')
      .trim()
      .replace(/^\./, '')
      .toLowerCase();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function clampNum(v, { min = null, max = null, fallback = null } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.floor(n * 1000) / 1000; // keep a few decimals
  if (min !== null && x < min) return min;
  if (max !== null && x > max) return max;
  return x;
}

function normalizeDays(days) {
  const out = [];
  const seen = new Set();
  for (const d of Array.isArray(days) ? days : []) {
    const n = Number(d);
    if (!Number.isFinite(n)) continue;
    const x = Math.floor(n);
    if (x < 0 || x > 6) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

const FIXED_CATEGORIES = ['English', 'Asian'];
const DEFAULT_CLEANING_TEMPLATES = {
  movieFolder: '{title} ({year})-{quality}',
  movieFile: '{title} ({year})-{quality}',
  movieSubtitle: '{title} ({year})-{quality}.{lang}',
  seriesFolder: '{title} ({year})',
  seriesSeasonFolder: 'Season {season}',
  seriesEpisode: '{title} - S{season}E{episode}',
  seriesSubtitle: '{title} - S{season}E{episode}.{lang}',
};
const ALLOWED_MOVIE_TOKENS = new Set(['title', 'year', 'quality', 'resolution', 'type', 'lang']);
const ALLOWED_SERIES_TOKENS = new Set(['title', 'year', 'quality', 'resolution', 'type', 'season', 'episode', 'lang']);
const ALLOWED_SERIES_SEASON_FOLDER_TOKENS = new Set(['title', 'year', 'quality', 'resolution', 'type', 'season']);

function normalizeTemplate(v, fallback) {
  const s = String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (s || fallback).slice(0, 180);
}

function validateTemplateTokens({ template, allowedTokens, label, errors }) {
  const t = String(template || '').trim();
  if (!t) {
    errors.push(`${label} must not be empty.`);
    return;
  }
  if (/[\\/]/.test(t)) {
    errors.push(`${label} must not contain path separators.`);
  }
  const found = [...t.matchAll(/\{([a-z_]+)\}/gi)].map((m) => String(m[1] || '').toLowerCase());
  for (const token of found) {
    if (!allowedTokens.has(token)) {
      errors.push(`${label} has unsupported token {${token}}.`);
    }
  }
}

function validateSelectionStrategy(
  s,
  {
    label = 'Selection strategy',
    defaults = {
      recentMonthsRange: 5,
      classicYearStart: 1996,
      classicYearEnd: 2012,
      recentAnimationCount: 1,
      recentLiveActionCount: 3,
      classicAnimationCount: 1,
      classicLiveActionCount: 3,
    },
  } = {}
) {
  const errors = [];
  const recentMonthsRange = clampNum(s?.recentMonthsRange, { min: 1, max: 120, fallback: defaults.recentMonthsRange });
  const classicYearStart = clampNum(s?.classicYearStart, { min: 1900, max: 2100, fallback: defaults.classicYearStart });
  const classicYearEnd = clampNum(s?.classicYearEnd, { min: 1900, max: 2100, fallback: defaults.classicYearEnd });
  const recentAnimationCount = clampNum(s?.recentAnimationCount, { min: 0, max: 100, fallback: defaults.recentAnimationCount });
  const recentLiveActionCount = clampNum(s?.recentLiveActionCount, { min: 0, max: 100, fallback: defaults.recentLiveActionCount });
  const classicAnimationCount = clampNum(s?.classicAnimationCount, { min: 0, max: 100, fallback: defaults.classicAnimationCount });
  const classicLiveActionCount = clampNum(s?.classicLiveActionCount, { min: 0, max: 100, fallback: defaults.classicLiveActionCount });

  if (classicYearStart >= classicYearEnd) errors.push(`${label}: Classic year start must be less than classic year end.`);
  if (recentMonthsRange < 1) errors.push(`${label}: Recent months range must be >= 1.`);
  if (
    recentAnimationCount + recentLiveActionCount + classicAnimationCount + classicLiveActionCount <= 0
  ) {
    errors.push(`${label}: At least one selection count must be > 0.`);
  }

  return {
    errors,
    value: {
      recentMonthsRange,
      classicYearStart,
      classicYearEnd,
      recentAnimationCount,
      recentLiveActionCount,
      classicAnimationCount,
      classicLiveActionCount,
    },
  };
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const db = await getAdminDb();
  const storagePolicyVolume = await resolveStoragePolicyVolumeStats(db).catch(() => ({ totalBytes: 0, usedBytes: 0 }));
  const hydratedSettings = JSON.parse(JSON.stringify(db.autodownloadSettings || null));
  if (hydratedSettings) {
    const policy = deriveStoragePolicy({ settings: hydratedSettings, totalBytes: Number(storagePolicyVolume?.totalBytes || 0) || 0 });
    if (!Number.isFinite(Number(hydratedSettings?.storage?.limitGb || 0)) || Number(hydratedSettings?.storage?.limitGb || 0) <= 0) {
      hydratedSettings.storage = {
        ...(hydratedSettings.storage && typeof hydratedSettings.storage === 'object' ? hydratedSettings.storage : {}),
        limitGb: Number(policy?.limitUsedGb || 0) > 0 ? policy.limitUsedGb : null,
      };
    }
    if (!Number.isFinite(Number(hydratedSettings?.deletion?.triggerUsedGb || 0)) || Number(hydratedSettings?.deletion?.triggerUsedGb || 0) <= 0) {
      hydratedSettings.deletion = {
        ...(hydratedSettings.deletion && typeof hydratedSettings.deletion === 'object' ? hydratedSettings.deletion : {}),
        triggerUsedGb: Number(policy?.triggerUsedGb || 0) > 0 ? policy.triggerUsedGb : null,
      };
    }
  }
  return NextResponse.json(
    { ok: true, settings: hydratedSettings, mountStatus: db.mountStatus || null, storagePolicyVolume },
    { status: 200 }
  );
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const existingDb = await getAdminDb();
  const existingSettings = existingDb.autodownloadSettings || {};

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const errors = [];

  const enabled = Boolean(body?.enabled);
  const moviesEnabled = Boolean(body?.moviesEnabled);
  const seriesEnabled = Boolean(body?.seriesEnabled);

  const tzInput = String(body?.schedule?.timezone || '').trim();
  const tz = tzInput && tzInput !== 'UTC' ? tzInput : DEFAULT_TIMEZONE;
  if (!isValidTimezone(tz)) errors.push('Invalid timezone.');

  const days = normalizeDays(body?.schedule?.days);
  if (!days.length) errors.push('Select at least one day of week.');

  const startTime = String(body?.schedule?.startTime || '').trim() || '00:00';
  const endTime = String(body?.schedule?.endTime || '').trim() || '23:59';
  if (!isValidTimeHHMM(startTime)) errors.push('Invalid start time.');
  if (!isValidTimeHHMM(endTime)) errors.push('Invalid end time.');

  const { totalBytes: mountTotalBytes, usedBytes: mountUsedBytes } = await resolveStoragePolicyVolumeStats(existingDb);
  const currentStoragePolicy = deriveStoragePolicy({ settings: existingSettings, totalBytes: mountTotalBytes });
  const totalGb = bytesToGb(mountTotalBytes, 3);
  const usedGb = bytesToGb(mountUsedBytes, 3);
  const storageLimitGb = clampNum(body?.storage?.limitGb ?? currentStoragePolicy.limitUsedGb ?? null, {
    min: 1,
    max: totalGb > 0 ? Math.max(1, totalGb) : 100000,
    fallback: currentStoragePolicy.limitUsedGb ?? null,
  });
  if (!Number.isFinite(storageLimitGb) || storageLimitGb <= 0) errors.push('Storage limit must be greater than 0 GB.');
  if (Number.isFinite(storageLimitGb) && Number.isFinite(usedGb) && usedGb > 0 && storageLimitGb < usedGb) {
    errors.push(`Storage limit must be greater than or equal to current VOD used size (${usedGb.toFixed(1)} GB).`);
  }

  const deletionEnabled = body?.deletion?.enabled === undefined ? existingSettings?.deletion?.enabled === true : Boolean(body?.deletion?.enabled);
  const triggerUsedGb = clampNum(
    body?.deletion?.triggerUsedGb ?? existingSettings?.deletion?.triggerUsedGb ?? (Number(storageLimitGb || 0) > 0 ? Number(storageLimitGb) - 50 : null),
    { min: 1, max: totalGb > 0 ? Math.max(1, totalGb) : 100000, fallback: null }
  );
  if (!Number.isFinite(triggerUsedGb) || triggerUsedGb <= 0) errors.push('Deletion trigger must be greater than 0 GB.');
  if (Number.isFinite(storageLimitGb) && Number.isFinite(triggerUsedGb) && triggerUsedGb > storageLimitGb) {
    errors.push('Deletion trigger GB must be less than or equal to storage limit GB.');
  }
  const deleteBatchTargetGb = clampNum(body?.deletion?.deleteBatchTargetGb ?? existingSettings?.deletion?.deleteBatchTargetGb ?? 50, {
    min: 1,
    max: 5000,
    fallback: 50,
  });
  const deleteDelayDays = clampNum(body?.deletion?.deleteDelayDays ?? existingSettings?.deletion?.deleteDelayDays ?? 3, {
    min: 0,
    max: 30,
    fallback: 3,
  });
  const deleteExecutionTime = String(body?.deletion?.deleteExecutionTime ?? existingSettings?.deletion?.deleteExecutionTime ?? '00:00').trim() || '00:00';
  if (!isValidTimeHHMM(deleteExecutionTime)) errors.push('Deletion execution time must use HH:MM.');
  const previewRefreshTime = String(body?.deletion?.previewRefreshTime ?? existingSettings?.deletion?.previewRefreshTime ?? '00:00').trim() || '00:00';
  if (!isValidTimeHHMM(previewRefreshTime)) errors.push('Deletion preview refresh time must use HH:MM.');
  const protectRecentReleaseDays = clampNum(
    body?.deletion?.protectRecentReleaseDays ?? existingSettings?.deletion?.protectRecentReleaseDays ?? 60,
    { min: 0, max: 3650, fallback: 60 }
  );
  const protectRecentWatchDays = clampNum(
    body?.deletion?.protectRecentWatchDays ?? existingSettings?.deletion?.protectRecentWatchDays ?? 7,
    { min: 0, max: 3650, fallback: 7 }
  );
  const seriesEligibleThreshold = clampNum(
    body?.deletion?.seriesEligibleThreshold ?? existingSettings?.deletion?.seriesEligibleThreshold ?? 10,
    { min: 0, max: 100000, fallback: 10 }
  );
  const maxSeriesPerBatch = clampNum(
    body?.deletion?.maxSeriesPerBatch ?? existingSettings?.deletion?.maxSeriesPerBatch ?? 1,
    { min: 0, max: 100000, fallback: 1 }
  );
  const pauseSelectionWhileActive =
    body?.deletion?.pauseSelectionWhileActive === undefined
      ? existingSettings?.deletion?.pauseSelectionWhileActive !== false
      : Boolean(body?.deletion?.pauseSelectionWhileActive);

  const maxMovieGb = clampNum(body?.sizeLimits?.maxMovieGb, { min: 0.1, max: 500, fallback: 2.5 });
  const maxEpisodeGbRaw = String(body?.sizeLimits?.maxEpisodeGb ?? '').trim();
  const maxEpisodeGb =
    maxEpisodeGbRaw === '' || maxEpisodeGbRaw === 'null' ? null : clampNum(maxEpisodeGbRaw, { min: 0.05, max: 500, fallback: null });
  const minMovieSeeders = clampNum(body?.sourceFilters?.minMovieSeeders, { min: 0, max: 100000, fallback: 1 });
  const minSeriesSeeders = clampNum(body?.sourceFilters?.minSeriesSeeders, { min: 0, max: 100000, fallback: 1 });

  const timeoutEnabled = Boolean(body?.timeoutChecker?.enabled);
  const maxWaitHours = clampNum(body?.timeoutChecker?.maxWaitHours, { min: 1, max: 168, fallback: 6 });
  const intervalMinutes = clampNum(body?.timeoutChecker?.intervalMinutes, { min: 1, max: 1440, fallback: 15 });
  const strictSeriesReplacementInput = body?.timeoutChecker?.strictSeriesReplacement;
  const strictSeriesReplacement =
    strictSeriesReplacementInput === undefined
      ? existingSettings?.timeoutChecker?.strictSeriesReplacement !== false
      : Boolean(strictSeriesReplacementInput);
  const deletePartialSeriesOnReplacementFailureInput = body?.timeoutChecker?.deletePartialSeriesOnReplacementFailure;
  const deletePartialSeriesOnReplacementFailure =
    deletePartialSeriesOnReplacementFailureInput === undefined
      ? existingSettings?.timeoutChecker?.deletePartialSeriesOnReplacementFailure !== false
      : Boolean(deletePartialSeriesOnReplacementFailureInput);

  const cleaningEnabledInput = body?.cleaning?.enabled;
  const cleaningEnabled =
    cleaningEnabledInput === undefined ? existingSettings?.cleaning?.enabled !== false : Boolean(cleaningEnabledInput);
  const createMovieFolderIfMissingInput = body?.cleaning?.createMovieFolderIfMissing;
  const createMovieFolderIfMissing =
    createMovieFolderIfMissingInput === undefined
      ? existingSettings?.cleaning?.createMovieFolderIfMissing !== false
      : Boolean(createMovieFolderIfMissingInput);
  const existingTemplates = existingSettings?.cleaning?.templates || {};
  const incomingTemplates = body?.cleaning?.templates || {};
  const cleaningTemplates = {
    movieFolder: normalizeTemplate(incomingTemplates?.movieFolder ?? existingTemplates?.movieFolder, DEFAULT_CLEANING_TEMPLATES.movieFolder),
    movieFile: normalizeTemplate(incomingTemplates?.movieFile ?? existingTemplates?.movieFile, DEFAULT_CLEANING_TEMPLATES.movieFile),
    movieSubtitle: normalizeTemplate(incomingTemplates?.movieSubtitle ?? existingTemplates?.movieSubtitle, DEFAULT_CLEANING_TEMPLATES.movieSubtitle),
    seriesFolder: normalizeTemplate(incomingTemplates?.seriesFolder ?? existingTemplates?.seriesFolder, DEFAULT_CLEANING_TEMPLATES.seriesFolder),
    seriesSeasonFolder: normalizeTemplate(
      incomingTemplates?.seriesSeasonFolder ?? existingTemplates?.seriesSeasonFolder,
      DEFAULT_CLEANING_TEMPLATES.seriesSeasonFolder
    ),
    seriesEpisode: normalizeTemplate(incomingTemplates?.seriesEpisode ?? existingTemplates?.seriesEpisode, DEFAULT_CLEANING_TEMPLATES.seriesEpisode),
    seriesSubtitle: normalizeTemplate(incomingTemplates?.seriesSubtitle ?? existingTemplates?.seriesSubtitle, DEFAULT_CLEANING_TEMPLATES.seriesSubtitle),
  };

  validateTemplateTokens({
    template: cleaningTemplates.movieFolder,
    allowedTokens: ALLOWED_MOVIE_TOKENS,
    label: 'Movie folder template',
    errors,
  });
  validateTemplateTokens({
    template: cleaningTemplates.movieFile,
    allowedTokens: ALLOWED_MOVIE_TOKENS,
    label: 'Movie file template',
    errors,
  });
  validateTemplateTokens({
    template: cleaningTemplates.movieSubtitle,
    allowedTokens: ALLOWED_MOVIE_TOKENS,
    label: 'Movie subtitle template',
    errors,
  });
  validateTemplateTokens({
    template: cleaningTemplates.seriesFolder,
    allowedTokens: ALLOWED_SERIES_TOKENS,
    label: 'Series folder template',
    errors,
  });
  validateTemplateTokens({
    template: cleaningTemplates.seriesSeasonFolder,
    allowedTokens: ALLOWED_SERIES_SEASON_FOLDER_TOKENS,
    label: 'Series season folder template',
    errors,
  });
  validateTemplateTokens({
    template: cleaningTemplates.seriesEpisode,
    allowedTokens: ALLOWED_SERIES_TOKENS,
    label: 'Series episode template',
    errors,
  });
  validateTemplateTokens({
    template: cleaningTemplates.seriesSubtitle,
    allowedTokens: ALLOWED_SERIES_TOKENS,
    label: 'Series subtitle template',
    errors,
  });
  const releaseDelayDays = normalizeReleaseDelayDays(body?.release?.delayDays ?? body?.releaseDelayDays ?? 3);
  const releaseTimezone = normalizeReleaseTimezone(
    body?.release?.timezone || body?.releaseTimezone || body?.schedule?.timezone || DEFAULT_TIMEZONE
  );

  const videoExtensions = uniqLower(body?.fileRules?.videoExtensions);
  const subtitleExtensions = uniqLower(body?.fileRules?.subtitleExtensions);
  if (!videoExtensions.length) errors.push('Allowed video extensions must not be empty.');
  if (!subtitleExtensions.length) errors.push('Allowed subtitle extensions must not be empty.');

  const skipSample = Boolean(body?.fileRules?.skipSample);

  // Categories/Genres are now automatic; keep the list fixed for display.
  // Any legacy defaults are ignored (but may still exist in DB for back-compat).

  const movieSel = validateSelectionStrategy(body?.movieSelectionStrategy ?? existingSettings?.movieSelectionStrategy ?? {}, {
    label: 'Movie strategy',
  });
  errors.push(...movieSel.errors);
  const seriesSel = validateSelectionStrategy(body?.seriesSelectionStrategy ?? existingSettings?.seriesSelectionStrategy ?? {}, {
    label: 'Series strategy',
    defaults: {
      recentMonthsRange: 12,
      classicYearStart: 1990,
      classicYearEnd: 2018,
      recentAnimationCount: 1,
      recentLiveActionCount: 2,
      classicAnimationCount: 1,
      classicLiveActionCount: 2,
    },
  });
  errors.push(...seriesSel.errors);

  const existingWatchfolderTrigger = existingSettings?.watchfolderTrigger || {};
  const wfEnabled = body?.watchfolderTrigger?.enabled;
  const watchfolderAutoTriggerEnabled =
    wfEnabled === undefined ? existingWatchfolderTrigger.enabled !== false : Boolean(wfEnabled);
  const watchfolderCooldownMinutes = clampNum(
    body?.watchfolderTrigger?.cooldownMinutes ?? existingWatchfolderTrigger.cooldownMinutes,
    { min: 0, max: 1440, fallback: 10 }
  );
  const watchfolderModeRaw = String(body?.watchfolderTrigger?.mode ?? existingWatchfolderTrigger.mode ?? 'debounced')
    .trim()
    .toLowerCase();
  const watchfolderMode = watchfolderModeRaw === 'immediate' ? 'immediate' : 'debounced';
  if (watchfolderModeRaw && !['debounced', 'immediate'].includes(watchfolderModeRaw)) errors.push('Watchfolder scan mode must be debounced or immediate.');

  if (errors.length) {
    return NextResponse.json({ ok: false, error: 'Validation failed.', errors }, { status: 400 });
  }

  await updateAutodownloadSettings({
    enabled,
    moviesEnabled,
    seriesEnabled,
    schedule: { timezone: tz, days, startTime, endTime },
    storage: { limitGb: storageLimitGb, limitPercent: currentStoragePolicy.legacyLimitPercent || 95 },
    deletion: {
      enabled: deletionEnabled,
      triggerUsedGb,
      deleteBatchTargetGb,
      deleteDelayDays,
      deleteExecutionTime,
      previewRefreshTime,
      protectRecentReleaseDays,
      protectRecentWatchDays,
      seriesEligibleThreshold,
      maxSeriesPerBatch,
      pauseSelectionWhileActive,
    },
    sizeLimits: { maxMovieGb, maxEpisodeGb },
    sourceFilters: { minMovieSeeders, minSeriesSeeders },
    timeoutChecker: {
      enabled: timeoutEnabled,
      maxWaitHours,
      intervalMinutes,
      strictSeriesReplacement,
      deletePartialSeriesOnReplacementFailure,
    },
    cleaning: {
      enabled: cleaningEnabled,
      createMovieFolderIfMissing,
      templates: cleaningTemplates,
    },
    release: {
      delayDays: releaseDelayDays,
      timezone: releaseTimezone,
    },
    fileRules: {
      videoExtensions,
      subtitleExtensions,
      keepSubtitleLanguages: ['en', 'tl'],
      languagePatterns: {
        en: '(eng|english|en)',
        tl: '(tag|fil|filipino|tl)',
      },
      skipSample,
    },
    categories: {
      categories: FIXED_CATEGORIES,
    },
    movieSelectionStrategy: movieSel.value,
    seriesSelectionStrategy: seriesSel.value,
    watchfolderTrigger: {
      enabled: watchfolderAutoTriggerEnabled,
      cooldownMinutes: watchfolderCooldownMinutes,
      mode: watchfolderMode,
      triggerAfterFinalOnly: true,
    },
  });

  const db = await getAdminDb();
  return NextResponse.json(
    { ok: true, settings: db.autodownloadSettings || null, mountStatus: db.mountStatus || null },
    { status: 200 }
  );
}

export async function PATCH(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const existingDb = await getAdminDb();
  const existingSettings = existingDb.autodownloadSettings || {};

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const section = String(body?.section || '').trim().toLowerCase();
  if (section !== 'selection_rules') {
    return NextResponse.json({ ok: false, error: 'Unsupported settings patch.' }, { status: 400 });
  }

  const type = String(body?.type || 'movie').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const errors = [];
  const patch = {};

  if (type === 'movie') {
    const maxMovieGb = clampNum(body?.sizeLimits?.maxMovieGb, { min: 0.1, max: 500, fallback: null });
    const minMovieSeeders = clampNum(body?.sourceFilters?.minMovieSeeders, { min: 0, max: 100000, fallback: null });
    const movieSel = validateSelectionStrategy(body?.selectionStrategy ?? body?.movieSelectionStrategy ?? existingSettings?.movieSelectionStrategy ?? {}, {
      label: 'Movie strategy',
    });
    if (!Number.isFinite(maxMovieGb) || maxMovieGb <= 0) errors.push('Max movie size must be greater than 0.');
    if (!Number.isFinite(minMovieSeeders) || minMovieSeeders < 0) errors.push('Min movie seeders must be 0 or greater.');
    errors.push(...movieSel.errors);
    patch.sizeLimits = { maxMovieGb };
    patch.sourceFilters = { minMovieSeeders };
    patch.movieSelectionStrategy = movieSel.value;
  } else {
    const maxEpisodeGbRaw = String(body?.sizeLimits?.maxEpisodeGb ?? '').trim();
    const maxEpisodeGb =
      maxEpisodeGbRaw === '' || maxEpisodeGbRaw === 'null'
        ? null
        : clampNum(maxEpisodeGbRaw, { min: 0.05, max: 500, fallback: null });
    const minSeriesSeeders = clampNum(body?.sourceFilters?.minSeriesSeeders, { min: 0, max: 100000, fallback: null });
    const seriesSel = validateSelectionStrategy(body?.selectionStrategy ?? body?.seriesSelectionStrategy ?? existingSettings?.seriesSelectionStrategy ?? {}, {
      label: 'Series strategy',
      defaults: {
        recentMonthsRange: 12,
        classicYearStart: 1990,
        classicYearEnd: 2018,
        recentAnimationCount: 1,
        recentLiveActionCount: 2,
        classicAnimationCount: 1,
        classicLiveActionCount: 2,
      },
    });
    if (maxEpisodeGbRaw && (!Number.isFinite(maxEpisodeGb) || maxEpisodeGb <= 0)) {
      errors.push('Max episode size must be greater than 0 when set.');
    }
    if (!Number.isFinite(minSeriesSeeders) || minSeriesSeeders < 0) errors.push('Min series seeders must be 0 or greater.');
    errors.push(...seriesSel.errors);
    patch.sizeLimits = { maxEpisodeGb };
    patch.sourceFilters = { minSeriesSeeders };
    patch.timeoutChecker = {
      strictSeriesReplacement: body?.timeoutChecker?.strictSeriesReplacement !== false,
      deletePartialSeriesOnReplacementFailure: body?.timeoutChecker?.deletePartialSeriesOnReplacementFailure !== false,
    };
    patch.seriesSelectionStrategy = seriesSel.value;
  }

  if (errors.length) {
    return NextResponse.json({ ok: false, error: 'Validation failed.', errors }, { status: 400 });
  }

  await updateAutodownloadSettings(patch);
  const db = await getAdminDb();
  return NextResponse.json(
    { ok: true, settings: db.autodownloadSettings || null, mountStatus: db.mountStatus || null },
    { status: 200 }
  );
}
