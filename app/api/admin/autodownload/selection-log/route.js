import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getAdminDb, saveAdminDb } from '../../../../../lib/server/adminDb';
import { runSelectionJobForType } from '../../../../../lib/server/autodownload/selectionService';
import { buildReleaseTagFromDateKey, normalizeReleaseTimezone } from '../../../../../lib/server/autodownload/releaseSchedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') || 200) || 200));
  const type = String(searchParams.get('type') || 'movie').toLowerCase();
  const db = await getAdminDb();
  const all = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  const logs = all
    .filter((x) => {
      if (type === 'all') return true;
      const logType = String(x?.selectionType || 'movie').toLowerCase();
      return logType === (type === 'series' ? 'series' : 'movie');
    })
    .slice(0, limit);
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
  const all = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  const before = all.length;
  const next =
    type === 'all'
      ? []
      : all.filter((x) => {
          const logType = String(x?.selectionType || 'movie').toLowerCase();
          return logType !== (type === 'series' ? 'series' : 'movie');
        });
  db.selectionLogs = next;
  await saveAdminDb(db);

  return NextResponse.json(
    {
      ok: true,
      deleted: Math.max(0, before - next.length),
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
