function normalizeTimezone(input, fallback = 'Asia/Manila') {
  const tz = String(input || '').trim();
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return fallback;
  }
}

function getPart(parts, type, fallback = 0) {
  const value = parts.find((part) => part?.type === type)?.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function releaseStartUtcMs({ releaseDate = '', timeZone = 'Asia/Manila' } = {}) {
  const value = String(releaseDate || '').trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const tz = normalizeTimezone(timeZone, 'Asia/Manila');
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(utcGuess));
  const zonedAsUtc = Date.UTC(
    getPart(parts, 'year', year),
    getPart(parts, 'month', month) - 1,
    getPart(parts, 'day', day),
    getPart(parts, 'hour', 0),
    getPart(parts, 'minute', 0),
    getPart(parts, 'second', 0)
  );
  const offsetMs = zonedAsUtc - utcGuess;
  return utcGuess - offsetMs;
}

export function msUntilRelease({ releaseDate = '', timeZone = 'Asia/Manila', nowTs = Date.now() } = {}) {
  const releaseMs = releaseStartUtcMs({ releaseDate, timeZone });
  if (!Number.isFinite(releaseMs)) return null;
  return releaseMs - Number(nowTs || Date.now());
}
