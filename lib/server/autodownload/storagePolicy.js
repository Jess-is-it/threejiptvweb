import 'server-only';

const GB = 1024 * 1024 * 1024;

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

export function bytesToGb(bytes, digits = 2) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return round(n / GB, digits);
}

export function gbToBytes(gb) {
  const n = Number(gb || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * GB);
}

function coercePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeTimeHHMM(value, fallback = '00:00') {
  const raw = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return fallback;
  const [hh, mm] = raw.split(':').map((item) => Number(item));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeLegacyPercent(value, fallback = 95) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(100, Math.max(1, n));
}

export function deriveStoragePolicy({ settings, totalBytes = 0 } = {}) {
  const totalGb = bytesToGb(totalBytes, 3);
  const storage = settings?.storage && typeof settings.storage === 'object' ? settings.storage : {};
  const deletion = settings?.deletion && typeof settings.deletion === 'object' ? settings.deletion : {};

  const limitGbExplicit = coercePositive(storage?.limitGb ?? settings?.storageLimitGb);
  const legacyPercent = normalizeLegacyPercent(storage?.limitPercent ?? settings?.storageLimitPercent ?? 95, 95);
  const derivedLimitGb = limitGbExplicit || (totalGb > 0 ? round((legacyPercent / 100) * totalGb, 3) : null);

  const triggerGbExplicit = coercePositive(deletion?.triggerUsedGb);
  const defaultTriggerGb = derivedLimitGb !== null ? Math.max(0, round(derivedLimitGb - 50, 3)) : null;
  let triggerUsedGb = triggerGbExplicit || defaultTriggerGb;
  if (derivedLimitGb !== null && triggerUsedGb !== null && triggerUsedGb > derivedLimitGb) {
    triggerUsedGb = derivedLimitGb;
  }

  const deleteBatchTargetGb = coercePositive(deletion?.deleteBatchTargetGb) || 50;
  const deleteDelayDays = Math.max(0, Math.min(30, Number(deletion?.deleteDelayDays ?? 3) || 3));
  const deleteExecutionTime = normalizeTimeHHMM(deletion?.deleteExecutionTime, '00:00');
  const previewRefreshTime = normalizeTimeHHMM(deletion?.previewRefreshTime, '00:00');
  const protectRecentReleaseDays = Math.max(0, Math.min(3650, Number(deletion?.protectRecentReleaseDays ?? 60) || 60));
  const protectRecentWatchDays = Math.max(0, Math.min(3650, Number(deletion?.protectRecentWatchDays ?? 7) || 7));
  const seriesEligibleThreshold = Math.max(0, Math.min(100000, Math.floor(Number(deletion?.seriesEligibleThreshold ?? 10) || 10)));
  const maxSeriesPerBatch = Math.max(0, Math.min(100000, Math.floor(Number(deletion?.maxSeriesPerBatch ?? 1) || 1)));

  const freeAtLimitGb = totalGb > 0 && derivedLimitGb !== null ? Math.max(0, round(totalGb - derivedLimitGb, 3)) : null;
  const freeAtTriggerGb = totalGb > 0 && triggerUsedGb !== null ? Math.max(0, round(totalGb - triggerUsedGb, 3)) : null;

  return {
    totalGb,
    limitUsedGb: derivedLimitGb,
    legacyLimitPercent: legacyPercent,
    triggerUsedGb,
    deleteBatchTargetGb,
    deleteDelayDays,
    deleteExecutionTime,
    previewRefreshTime,
    protectRecentReleaseDays,
    protectRecentWatchDays,
    seriesEligibleThreshold,
    maxSeriesPerBatch,
    freeAtLimitGb,
    freeAtTriggerGb,
    deletionEnabled: deletion?.enabled === true,
    pauseSelectionWhileActive: deletion?.pauseSelectionWhileActive !== false,
  };
}

export function computeVolumeState({ label = 'storage', totalBytes = 0, usedBytes = 0, availBytes = 0, policy } = {}) {
  const totalGb = bytesToGb(totalBytes, 3);
  const usedGb = bytesToGb(usedBytes, 3);
  const availGb = bytesToGb(availBytes, 3);
  const resolvedPolicy = policy && typeof policy === 'object' ? policy : deriveStoragePolicy({ totalBytes, settings: {} });
  const limitUsedGb = coercePositive(resolvedPolicy?.limitUsedGb);
  const triggerUsedGb = coercePositive(resolvedPolicy?.triggerUsedGb);
  const freeAtLimitGb = coercePositive(resolvedPolicy?.freeAtLimitGb);
  const freeAtTriggerGb = coercePositive(resolvedPolicy?.freeAtTriggerGb);

  const limitReached = limitUsedGb !== null ? usedGb >= limitUsedGb : freeAtLimitGb !== null ? availGb <= freeAtLimitGb : false;
  const triggerReached = triggerUsedGb !== null ? usedGb >= triggerUsedGb : freeAtTriggerGb !== null ? availGb <= freeAtTriggerGb : false;

  return {
    label,
    totalBytes: Number(totalBytes || 0),
    usedBytes: Number(usedBytes || 0),
    availBytes: Number(availBytes || 0),
    totalGb,
    usedGb,
    availGb,
    usedPct: totalGb > 0 ? round((usedGb / totalGb) * 100, 2) : null,
    limitReached,
    triggerReached,
    remainingBeforeLimitGb: limitUsedGb !== null ? round(limitUsedGb - usedGb, 3) : null,
    remainingBeforeTriggerGb: triggerUsedGb !== null ? round(triggerUsedGb - usedGb, 3) : null,
  };
}

export function storageLimitMessage({ usedGb = 0, limitUsedGb = null } = {}) {
  if (limitUsedGb === null || limitUsedGb === undefined) return 'Storage limit reached.';
  return `Storage limit reached (${round(usedGb, 2)} GB used of ${round(limitUsedGb, 2)} GB limit).`;
}

export function storageProjectionMessage({ projectedUsedGb = 0, limitUsedGb = null } = {}) {
  if (limitUsedGb === null || limitUsedGb === undefined) return 'Storage guardrail would be exceeded.';
  return `Storage guardrail: would exceed ${round(limitUsedGb, 2)} GB (projected ${round(projectedUsedGb, 2)} GB).`;
}
