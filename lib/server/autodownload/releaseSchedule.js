import 'server-only';

const DEFAULT_RELEASE_TZ = 'Asia/Manila';
const DEFAULT_RELEASE_DELAY_DAYS = 3;

function pad2(n) {
  return String(Number(n || 0)).padStart(2, '0');
}

export function normalizeReleaseTimezone(input) {
  const tz = String(input || '').trim();
  if (!tz) return DEFAULT_RELEASE_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_RELEASE_TZ;
  }
}

export function normalizeReleaseDelayDays(input) {
  const n = Number(input);
  if (!Number.isFinite(n)) return DEFAULT_RELEASE_DELAY_DAYS;
  const v = Math.floor(n);
  return Math.max(0, Math.min(30, v));
}

export function dateKeyInTimezone(ts = Date.now(), timeZone = DEFAULT_RELEASE_TZ) {
  const tz = normalizeReleaseTimezone(timeZone);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Number(ts || Date.now())));
  } catch {
    const d = new Date(Number(ts || Date.now()));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
}

export function addDaysToDateKey(dateKey, days = 0) {
  const s = String(dateKey || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKeyInTimezone(Date.now(), DEFAULT_RELEASE_TZ);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + normalizeReleaseDelayDays(days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function buildReleaseTagFromDateKey(dateKey) {
  const s = String(dateKey || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'Reldate';
  const yearShort = Number(m[1]) % 100;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return `Reldate${month}-${day}-${yearShort}`;
}

export function computeReleaseMeta({
  startedAt = Date.now(),
  delayDays = DEFAULT_RELEASE_DELAY_DAYS,
  timeZone = DEFAULT_RELEASE_TZ,
} = {}) {
  const tz = normalizeReleaseTimezone(timeZone);
  const releaseDelayDays = normalizeReleaseDelayDays(delayDays);
  const baseDate = dateKeyInTimezone(startedAt, tz);
  const releaseDate = addDaysToDateKey(baseDate, releaseDelayDays);
  return {
    releaseDate,
    releaseTag: buildReleaseTagFromDateKey(releaseDate),
    releaseDelayDays,
    releaseTimezone: tz,
  };
}

export function isReleaseDateDue({ releaseDate, nowTs = Date.now(), timeZone = DEFAULT_RELEASE_TZ } = {}) {
  const rd = String(releaseDate || '').trim();
  if (!rd) return false;
  const today = dateKeyInTimezone(nowTs, timeZone);
  return today >= rd;
}

