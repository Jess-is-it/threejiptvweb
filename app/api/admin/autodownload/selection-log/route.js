import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getAdminDb, saveAdminDb } from '../../../../../lib/server/adminDb';
import { runSelectionJobForType } from '../../../../../lib/server/autodownload/selectionService';
import { buildReleaseTagFromDateKey, normalizeReleaseTimezone } from '../../../../../lib/server/autodownload/releaseSchedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function tmdbIdFromSelectedItem(row) {
  const id = Number(row?.tmdbId || row?.tmdb?.id || row?.id || 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function dedupeSelectedItems(items = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(items) ? items : []) {
    const tmdbId = tmdbIdFromSelectedItem(row);
    const key = tmdbId > 0 ? `tmdb:${tmdbId}` : `row:${JSON.stringify(row || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function recountPickedCounts(items = []) {
  const counts = {
    recentAnimationSelected: 0,
    recentLiveActionSelected: 0,
    classicAnimationSelected: 0,
    classicLiveActionSelected: 0,
  };
  for (const row of Array.isArray(items) ? items : []) {
    const bucket = String(row?.bucket || '').trim();
    if (bucket === 'recentAnimation') counts.recentAnimationSelected += 1;
    else if (bucket === 'recentLive') counts.recentLiveActionSelected += 1;
    else if (bucket === 'classicAnimation') counts.classicAnimationSelected += 1;
    else if (bucket === 'classicLive') counts.classicLiveActionSelected += 1;
  }
  return counts;
}

function normalizeLogForDisplay(log = {}) {
  const selectedItems = dedupeSelectedItems(log?.selectedItems || []);
  return {
    ...log,
    selectedItems,
    totalSelected: selectedItems.length,
    ...recountPickedCounts(selectedItems),
  };
}

function normalizeSelectionType(type) {
  return String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
}

function queueKeyForType(type) {
  return normalizeSelectionType(type) === 'series' ? 'downloadsSeries' : 'downloadsMovies';
}

function isActiveDownloadRow(row = {}) {
  return String(row?.status || '').trim().toLowerCase() !== 'deleted';
}

function numericTimestamp(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function logSortValue(log = {}) {
  return Math.max(
    numericTimestamp(log?.updatedAt),
    numericTimestamp(log?.runAt),
    numericTimestamp(log?.releasedAt)
  );
}

function buildRecoveredSelectedItems(rows = [], { selectionLogId = '', type = 'movie' } = {}) {
  return dedupeSelectedItems(
    rows.map((row) => {
      const tmdbId = tmdbIdFromSelectedItem(row);
      const title = String(row?.tmdb?.title || row?.title || '').trim();
      const year = String(row?.tmdb?.year || row?.year || '').trim();
      return {
        id: tmdbId || String(row?.id || '').trim() || title,
        tmdbId: tmdbId || 0,
        title,
        year,
        bucket: '',
        type,
        provider: String(row?.source?.provider || '').trim(),
        selectionLogId,
        releaseDate: String(row?.releaseDate || '').trim(),
        releaseTag: String(row?.releaseTag || '').trim(),
      };
    })
  ).filter((row) => Number(row?.tmdbId || 0) > 0 || String(row?.title || '').trim());
}

function buildRecoveredSelectionLog(logId, type, rows = []) {
  const selectionType = normalizeSelectionType(type);
  const activeRows = rows.filter((row) => isActiveDownloadRow(row));
  if (!activeRows.length) return null;

  const latestRow =
    [...activeRows].sort(
      (a, b) =>
        Math.max(
          numericTimestamp(b?.updatedAt),
          numericTimestamp(b?.cleanedAt),
          numericTimestamp(b?.completedAt),
          numericTimestamp(b?.addedAt),
          numericTimestamp(b?.releasedAt)
        ) -
        Math.max(
          numericTimestamp(a?.updatedAt),
          numericTimestamp(a?.cleanedAt),
          numericTimestamp(a?.completedAt),
          numericTimestamp(a?.addedAt),
          numericTimestamp(a?.releasedAt)
        )
    )[0] || activeRows[0];

  const runAtCandidates = activeRows
    .map((row) =>
      Math.max(
        numericTimestamp(row?.addedAt),
        numericTimestamp(row?.updatedAt),
        numericTimestamp(row?.cleanedAt),
        numericTimestamp(row?.completedAt)
      )
    )
    .filter((value) => value > 0);
  const releasedAtCandidates = activeRows.map((row) => numericTimestamp(row?.releasedAt)).filter((value) => value > 0);
  const runAt = runAtCandidates.length ? Math.min(...runAtCandidates) : Date.now();
  const updatedAt = runAtCandidates.length ? Math.max(...runAtCandidates) : runAt;
  const selectedItems = buildRecoveredSelectedItems(activeRows, { selectionLogId: logId, type: selectionType });

  return {
    id: String(logId || '').trim(),
    selectionType,
    triggerReason: 'recovered_reference',
    runAt,
    updatedAt,
    totalSelected: selectedItems.length,
    ...recountPickedCounts(selectedItems),
    skippedDuplicatesCount: 0,
    skippedNoSourceCount: 0,
    skippedStorageLimitCount: 0,
    insufficient: [],
    selectedItems,
    errorMessage: null,
    releaseDate: String(latestRow?.releaseDate || '').trim(),
    releaseTag: String(latestRow?.releaseTag || '').trim(),
    releaseDelayDays: Math.max(0, Number(latestRow?.releaseDelayDays || 0) || 0) || 3,
    releaseTimezone: normalizeReleaseTimezone(latestRow?.releaseTimezone || 'Asia/Manila'),
    releasedAt: releasedAtCandidates.length ? Math.max(...releasedAtCandidates) : null,
  };
}

function isRecoveredReferenceLog(log = {}) {
  return String(log?.triggerReason || '').trim().toLowerCase() === 'recovered_reference';
}

function normalizeReleaseDate(value) {
  const s = String(value || '').trim();
  return s;
}

function queueKeyForLogType(type) {
  return normalizeSelectionType(type) === 'series' ? 'downloadsSeries' : 'downloadsMovies';
}

function rewriteSelectionLogIdInQueue(db, type, fromId, toId) {
  const src = String(fromId || '').trim();
  const dst = String(toId || '').trim();
  if (!src || !dst || src === dst) return 0;
  const queueKey = queueKeyForLogType(type);
  const rows = Array.isArray(db?.[queueKey]) ? db[queueKey] : [];
  let updated = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (String(row?.selectionLogId || '').trim() !== src) continue;
    rows[i] = { ...row, selectionLogId: dst, updatedAt: Date.now() };
    updated += 1;
  }
  db[queueKey] = rows;
  return updated;
}

function mergeSelectedItems(a = [], b = [], canonicalId = '') {
  const merged = dedupeSelectedItems([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]).map((row) => ({
    ...row,
    selectionLogId: canonicalId || row?.selectionLogId,
  }));
  return merged;
}

function logMergeSortValue(log = {}) {
  return logSortValue(log);
}

function chooseCanonicalLogForRelease(logs = []) {
  const list = Array.isArray(logs) ? logs : [];
  if (!list.length) return null;

  // Prefer a "real" log when present; recoveries should fold into it.
  const sorted = [...list].sort((a, b) => {
    const aRecovered = isRecoveredReferenceLog(a);
    const bRecovered = isRecoveredReferenceLog(b);
    if (aRecovered !== bRecovered) return aRecovered ? 1 : -1;
    const aItems = Array.isArray(a?.selectedItems) ? a.selectedItems.length : 0;
    const bItems = Array.isArray(b?.selectedItems) ? b.selectedItems.length : 0;
    if (aItems !== bItems) return bItems - aItems;
    return logMergeSortValue(b) - logMergeSortValue(a);
  });
  return sorted[0] || null;
}

function dedupeSelectionLogsByTypeAndReleaseDate(db) {
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  if (db.selectionLogs.length < 2) return { changed: false, removed: 0, remappedQueueRows: 0 };

  const groups = new Map();
  for (const row of db.selectionLogs) {
    const type = normalizeSelectionType(row?.selectionType || 'movie');
    const releaseDate = normalizeReleaseDate(row?.releaseDate || '');
    if (!releaseDate) continue;
    const key = `${type}|${releaseDate}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  let changed = false;
  let removed = 0;
  let remappedQueueRows = 0;

  for (const [key, rows] of groups.entries()) {
    if (!rows || rows.length < 2) continue;
    const [type] = key.split('|');
    const canonical = chooseCanonicalLogForRelease(rows);
    const canonicalId = String(canonical?.id || '').trim();
    if (!canonicalId) continue;

    const keep = [];
    for (const row of rows) {
      const id = String(row?.id || '').trim();
      if (!id) {
        keep.push(row);
        continue;
      }
      if (id === canonicalId) {
        keep.push(row);
        continue;
      }

      // Merge any recovered data into the canonical row and remap queued download references.
      remappedQueueRows += rewriteSelectionLogIdInQueue(db, type, id, canonicalId);
      canonical.selectedItems = mergeSelectedItems(canonical.selectedItems, row?.selectedItems, canonicalId);
      canonical.totalSelected = canonical.selectedItems.length;
      canonical.updatedAt = Math.max(numericTimestamp(canonical?.updatedAt), numericTimestamp(row?.updatedAt), Date.now());
      canonical.runAt = Math.min(numericTimestamp(canonical?.runAt) || Infinity, numericTimestamp(row?.runAt) || Infinity);
      if (!Number.isFinite(canonical.runAt) || canonical.runAt === Infinity) canonical.runAt = numericTimestamp(canonical?.updatedAt) || Date.now();
      canonical.skippedDuplicatesCount = Math.max(0, Number(canonical?.skippedDuplicatesCount || 0) + Number(row?.skippedDuplicatesCount || 0));
      canonical.skippedNoSourceCount = Math.max(0, Number(canonical?.skippedNoSourceCount || 0) + Number(row?.skippedNoSourceCount || 0));
      canonical.skippedStorageLimitCount = Math.max(0, Number(canonical?.skippedStorageLimitCount || 0) + Number(row?.skippedStorageLimitCount || 0));
      const insufficient = [...(Array.isArray(canonical?.insufficient) ? canonical.insufficient : []), ...(Array.isArray(row?.insufficient) ? row.insufficient : [])];
      canonical.insufficient = insufficient;
      changed = true;
      removed += 1;
    }

    if (removed > 0) {
      // Ensure the canonical row is present exactly once.
      db.selectionLogs = db.selectionLogs.filter((x) => {
        const id = String(x?.id || '').trim();
        if (!id) return true;
        if (id === canonicalId) return true;
        const xType = normalizeSelectionType(x?.selectionType || 'movie');
        const xReleaseDate = normalizeReleaseDate(x?.releaseDate || '');
        return !(xType === type && xReleaseDate && `${xType}|${xReleaseDate}` === key);
      });
      // Re-insert canonical (in case it was filtered out due to object identity mismatches).
      const canonicalIdx = db.selectionLogs.findIndex((x) => String(x?.id || '').trim() === canonicalId);
      if (canonicalIdx < 0) db.selectionLogs.unshift(canonical);
      else db.selectionLogs[canonicalIdx] = canonical;
    }
  }

  if (!changed) return { changed: false, removed: 0, remappedQueueRows: 0 };
  return { changed: true, removed, remappedQueueRows };
}

function dedupeSelectionLogsById(db) {
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  if (db.selectionLogs.length < 2) return { changed: false, removed: 0 };

  const byId = new Map();
  const order = [];

  const preferTrigger = (value) => {
    const s = String(value || '').trim();
    if (!s) return '';
    if (s.toLowerCase() === 'recovered_reference') return '';
    return s;
  };

  for (const row of db.selectionLogs) {
    const id = String(row?.id || '').trim();
    if (!id) {
      order.push(row);
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, row);
      continue;
    }

    const existing = byId.get(id) || {};
    const incoming = row || {};
    const triggerReason =
      preferTrigger(incoming?.triggerReason) ||
      preferTrigger(existing?.triggerReason) ||
      String(incoming?.triggerReason || existing?.triggerReason || '').trim() ||
      null;

    const merged = {
      ...existing,
      ...incoming,
      triggerReason,
      runAt: Math.min(numericTimestamp(existing?.runAt) || Infinity, numericTimestamp(incoming?.runAt) || Infinity),
      updatedAt: Math.max(numericTimestamp(existing?.updatedAt), numericTimestamp(incoming?.updatedAt)),
      totalSelected: Math.max(0, Number(existing?.totalSelected || 0) || 0, Number(incoming?.totalSelected || 0) || 0),
      skippedDuplicatesCount: Math.max(0, Number(existing?.skippedDuplicatesCount || 0) || 0, Number(incoming?.skippedDuplicatesCount || 0) || 0),
      skippedNoSourceCount: Math.max(0, Number(existing?.skippedNoSourceCount || 0) || 0, Number(incoming?.skippedNoSourceCount || 0) || 0),
      skippedStorageLimitCount: Math.max(0, Number(existing?.skippedStorageLimitCount || 0) || 0, Number(incoming?.skippedStorageLimitCount || 0) || 0),
    };

    const existingItems = Array.isArray(existing?.selectedItems) ? existing.selectedItems : [];
    const incomingItems = Array.isArray(incoming?.selectedItems) ? incoming.selectedItems : [];
    merged.selectedItems = incomingItems.length >= existingItems.length ? incomingItems : existingItems;

    if (!Number.isFinite(merged.runAt) || merged.runAt === Infinity) merged.runAt = numericTimestamp(incoming?.runAt) || numericTimestamp(existing?.runAt) || Date.now();

    byId.set(id, merged);
  }

  const deduped = [];
  const seen = new Set();
  for (const row of db.selectionLogs) {
    const id = String(row?.id || '').trim();
    if (!id) {
      deduped.push(row);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(byId.get(id) || row);
  }

  const removed = Math.max(0, db.selectionLogs.length - deduped.length);
  if (!removed) return { changed: false, removed: 0 };
  db.selectionLogs = deduped;
  return { changed: true, removed };
}

async function backfillReferencedSelectionLogs(db) {
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  db.downloadsMovies = Array.isArray(db.downloadsMovies) ? db.downloadsMovies : [];
  db.downloadsSeries = Array.isArray(db.downloadsSeries) ? db.downloadsSeries : [];

  const dedupe = dedupeSelectionLogsById(db);
  const dedupeByRelease = dedupeSelectionLogsByTypeAndReleaseDate(db);
  if (dedupe.changed || dedupeByRelease.changed) await saveAdminDb(db);

  const knownIds = new Set(db.selectionLogs.map((row) => String(row?.id || '').trim()).filter(Boolean));
  const recovered = [];

  for (const selectionType of ['movie', 'series']) {
    const queueKey = queueKeyForType(selectionType);
    const groups = new Map();
    for (const row of db[queueKey]) {
      if (!isActiveDownloadRow(row)) continue;
      const logId = String(row?.selectionLogId || '').trim();
      if (!logId || knownIds.has(logId)) continue;
      const list = groups.get(logId) || [];
      list.push(row);
      groups.set(logId, list);
    }

    for (const [logId, rows] of groups.entries()) {
      const recoveredLog = buildRecoveredSelectionLog(logId, selectionType, rows);
      if (!recoveredLog) continue;

      // If a canonical log exists for this release date already, remap queue rows to that log id
      // and merge recovered selectedItems into it. This prevents duplicated selection log entries
      // for the same day.
      const rel = normalizeReleaseDate(recoveredLog?.releaseDate || '');
      const candidates = db.selectionLogs.filter(
        (x) =>
          normalizeSelectionType(x?.selectionType || selectionType) === normalizeSelectionType(selectionType) &&
          normalizeReleaseDate(x?.releaseDate || '') === rel
      );
      const canonical = chooseCanonicalLogForRelease(candidates);
      const canonicalId = String(canonical?.id || '').trim();
      if (canonicalId && canonicalId !== String(logId || '').trim()) {
        rewriteSelectionLogIdInQueue(db, selectionType, logId, canonicalId);
        canonical.selectedItems = mergeSelectedItems(canonical.selectedItems, recoveredLog.selectedItems, canonicalId);
        canonical.totalSelected = canonical.selectedItems.length;
        canonical.updatedAt = Math.max(numericTimestamp(canonical?.updatedAt), numericTimestamp(recoveredLog?.updatedAt), Date.now());
        await saveAdminDb(db);
        continue;
      }

      knownIds.add(logId);
      recovered.push(recoveredLog);
    }
  }

  if (!recovered.length) return { recoveredCount: 0 };

  db.selectionLogs = [...db.selectionLogs, ...recovered].sort((a, b) => logSortValue(b) - logSortValue(a));
  // If recovered logs collide with real logs for the same releaseDate, fold them in now.
  const postDedupeByRelease = dedupeSelectionLogsByTypeAndReleaseDate(db);
  await saveAdminDb(db);
  return { recoveredCount: recovered.length, dedupedByRelease: postDedupeByRelease };
}

function getReferencedSelectionLogIds(db, type = 'all') {
  const wantedType = String(type || 'all').trim().toLowerCase();
  const types = wantedType === 'all' ? ['movie', 'series'] : [normalizeSelectionType(wantedType)];
  const ids = new Set();

  for (const selectionType of types) {
    const queueKey = queueKeyForType(selectionType);
    const rows = Array.isArray(db?.[queueKey]) ? db[queueKey] : [];
    for (const row of rows) {
      if (!isActiveDownloadRow(row)) continue;
      const logId = String(row?.selectionLogId || '').trim();
      if (logId) ids.add(logId);
    }
  }

  return ids;
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200) || 200));
  const type = String(searchParams.get('type') || 'movie').toLowerCase();
  const db = await getAdminDb();
  await backfillReferencedSelectionLogs(db);
  const all = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  const logs = all
    .filter((x) => {
      if (type === 'all') return true;
      const logType = String(x?.selectionType || 'movie').toLowerCase();
      return logType === (type === 'series' ? 'series' : 'movie');
    })
    .sort((a, b) => logSortValue(b) - logSortValue(a))
    .slice(0, limit)
    .map((log) => normalizeLogForDisplay(log));
  return NextResponse.json(
    { ok: true, logs, selection: db.autodownloadSettings?.selection || null },
    { status: 200 }
  );
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const type = String(body?.type || 'movie').toLowerCase() === 'series' ? 'series' : 'movie';
    const result = await runSelectionJobForType({ type, force: Boolean(body?.force ?? true) });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Selection job failed.' }, { status: 400 });
  }
}

export async function DELETE(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = String(searchParams.get('type') || 'movie').toLowerCase();

  const db = await getAdminDb();
  await backfillReferencedSelectionLogs(db);
  const all = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  const protectedIds = getReferencedSelectionLogIds(db, type);
  let preservedReferenced = 0;
  const next = all.filter((x) => {
    const logType = String(x?.selectionType || 'movie').toLowerCase();
    const wantedType = type === 'all' ? 'all' : type === 'series' ? 'series' : 'movie';
    const isTargeted = wantedType === 'all' || logType === wantedType;
    if (!isTargeted) return true;
    const logId = String(x?.id || '').trim();
    if (logId && protectedIds.has(logId)) {
      preservedReferenced += 1;
      return true;
    }
    return false;
  });
  db.selectionLogs = next;
  await saveAdminDb(db);

  return NextResponse.json(
    {
      ok: true,
      deleted: Math.max(0, all.length - next.length),
      preservedReferenced,
      remaining: next.length,
      type: type === 'all' ? 'all' : type === 'series' ? 'series' : 'movie',
    },
    { status: 200 }
  );
}

function isValidDateKey(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === mo && dt.getUTCDate() === d;
}

export async function PATCH(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const action = String(body?.action || '').trim().toLowerCase();
  if (action !== 'set_release_date') {
    return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
  }

  const logId = String(body?.logId || body?.id || '').trim();
  const releaseDate = String(body?.releaseDate || '').trim();
  if (!logId) {
    return NextResponse.json({ ok: false, error: 'Missing selection log id.' }, { status: 400 });
  }
  if (!isValidDateKey(releaseDate)) {
    return NextResponse.json({ ok: false, error: 'Invalid release date. Use YYYY-MM-DD.' }, { status: 400 });
  }

  const db = await getAdminDb();
  await backfillReferencedSelectionLogs(db);
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  db.downloadsMovies = Array.isArray(db.downloadsMovies) ? db.downloadsMovies : [];
  db.downloadsSeries = Array.isArray(db.downloadsSeries) ? db.downloadsSeries : [];

  const logIdx = db.selectionLogs.findIndex((x) => String(x?.id || '').trim() === logId);
  if (logIdx < 0) {
    return NextResponse.json({ ok: false, error: 'Selection log not found.' }, { status: 404 });
  }

  const log = db.selectionLogs[logIdx] || {};
  if (Number(log?.releasedAt || 0) > 0) {
    return NextResponse.json({ ok: false, error: 'Cannot edit release date after release processing.' }, { status: 400 });
  }

  const type = String(log?.selectionType || 'movie').toLowerCase() === 'series' ? 'series' : 'movie';
  const queueKey = type === 'series' ? 'downloadsSeries' : 'downloadsMovies';
  const rows = db[queueKey];
  const hasReleasedRows = rows.some(
    (x) =>
      String(x?.selectionLogId || '').trim() === logId &&
      String(x?.releaseState || '').trim().toLowerCase() === 'released'
  );
  if (hasReleasedRows) {
    return NextResponse.json({ ok: false, error: 'Cannot edit release date after release processing.' }, { status: 400 });
  }

  const releaseTimezone = normalizeReleaseTimezone(log?.releaseTimezone || 'Asia/Manila');
  const releaseTag = buildReleaseTagFromDateKey(releaseDate);
  const updatedAt = Date.now();

  const nextLog = {
    ...log,
    releaseDate,
    releaseTag,
    releaseTimezone,
    updatedAt,
  };
  db.selectionLogs[logIdx] = nextLog;

  let updatedRows = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (String(row?.selectionLogId || '').trim() !== logId) continue;
    if (String(row?.releaseState || '').trim().toLowerCase() === 'released') continue;
    rows[i] = {
      ...row,
      releaseDate,
      releaseTag,
      releaseTimezone: normalizeReleaseTimezone(row?.releaseTimezone || releaseTimezone),
      updatedAt,
    };
    updatedRows += 1;
  }

  db[queueKey] = rows;
  await saveAdminDb(db);
  return NextResponse.json({ ok: true, log: nextLog, updatedRows }, { status: 200 });
}
