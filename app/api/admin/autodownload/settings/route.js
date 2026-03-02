import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../lib/server/adminDb';
import { updateAutodownloadSettings } from '../../../../../lib/server/autodownload/autodownloadDb';
import { normalizeReleaseDelayDays, normalizeReleaseTimezone } from '../../../../../lib/server/autodownload/releaseSchedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const DEFAULT_TIMEZONE = 'Asia/Manila';

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
  return NextResponse.json(
    { ok: true, settings: db.autodownloadSettings || null, mountStatus: db.mountStatus || null },
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

  const storageLimitPercent = clampNum(body?.storage?.limitPercent, { min: 1, max: 100, fallback: 95 });

  const maxMovieGb = clampNum(body?.sizeLimits?.maxMovieGb, { min: 0.1, max: 500, fallback: 2.5 });
  const maxEpisodeGbRaw = String(body?.sizeLimits?.maxEpisodeGb ?? '').trim();
  const maxEpisodeGb =
    maxEpisodeGbRaw === '' || maxEpisodeGbRaw === 'null' ? null : clampNum(maxEpisodeGbRaw, { min: 0.05, max: 500, fallback: null });
  const minMovieSeeders = clampNum(body?.sourceFilters?.minMovieSeeders, { min: 0, max: 100000, fallback: 1 });
  const minSeriesSeeders = clampNum(body?.sourceFilters?.minSeriesSeeders, { min: 0, max: 100000, fallback: 1 });

  const timeoutEnabled = Boolean(body?.timeoutChecker?.enabled);
  const maxWaitHours = clampNum(body?.timeoutChecker?.maxWaitHours, { min: 1, max: 168, fallback: 6 });
  const intervalMinutes = clampNum(body?.timeoutChecker?.intervalMinutes, { min: 1, max: 1440, fallback: 15 });
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

  const movieSel = validateSelectionStrategy(body?.movieSelectionStrategy || {}, { label: 'Movie strategy' });
  errors.push(...movieSel.errors);
  const seriesSel = validateSelectionStrategy(body?.seriesSelectionStrategy || {}, {
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
    storage: { limitPercent: storageLimitPercent },
    sizeLimits: { maxMovieGb, maxEpisodeGb },
    sourceFilters: { minMovieSeeders, minSeriesSeeders },
    timeoutChecker: { enabled: timeoutEnabled, maxWaitHours, intervalMinutes },
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
