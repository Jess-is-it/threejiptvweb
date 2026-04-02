import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import {
  getSchedulerTickBackgroundStatus,
  schedulerTick,
  startSchedulerTickInBackground,
} from '../../../../../../lib/server/autodownload/schedulerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasSchedulerToken(req) {
  const token = String(process.env.SCHEDULER_TOKEN || '').trim();
  if (!token) return false;
  const q = new URL(req.url).searchParams.get('token') || '';
  const h = req.headers.get('x-scheduler-token') || '';
  return q === token || h === token;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
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

function summarizeTick(result, type = 'all') {
  const tickType = String(type || 'all').trim().toLowerCase();
  const movieSelected = selectedCount(result?.selection?.movies);
  const seriesSelected = selectedCount(result?.selection?.series);
  const selected =
    tickType === 'movie' ? movieSelected : tickType === 'series' ? seriesSelected : movieSelected + seriesSelected;
  return {
    ok: result?.ok !== false,
    skipped: Boolean(result?.skipped),
    reason: String(result?.reason || '').trim(),
    selected,
    movieSelected,
    seriesSelected,
    started: Math.max(0, Number(result?.dispatch?.started || 0) || 0),
    failed: Math.max(0, Number(result?.dispatch?.failed || 0) || 0),
    released: Math.max(0, Number(result?.release?.releasedItems || 0) || 0),
    at: Number(result?.at || 0) || 0,
  };
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  const schedulerAuthed = !admin && hasSchedulerToken(req);
  if (!admin && !schedulerAuthed) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const query = new URL(req.url).searchParams;
  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const typeRaw = String(body?.type || query.get('type') || 'all').trim().toLowerCase();
    const type = typeRaw === 'movie' || typeRaw === 'series' ? typeRaw : 'all';
    const force = toBool(body?.force ?? query.get('force') ?? false);
    const background = toBool(
      body?.background ??
        body?.async ??
        query.get('background') ??
        query.get('async') ??
        (schedulerAuthed ? true : false)
    );
    const wantStatus = toBool(body?.status ?? query.get('status') ?? false);
    const runId = String(body?.runId || query.get('runId') || '').trim();
    const compact = toBool(body?.compact ?? query.get('compact') ?? false) || schedulerAuthed;

    if (wantStatus) {
      const status = getSchedulerTickBackgroundStatus({ runId });
      return NextResponse.json({ ok: true, ...status }, { status: 200 });
    }

    if (background) {
      const started = startSchedulerTickInBackground({ force, type });
      return NextResponse.json({ ok: true, ...started }, { status: started.accepted ? 202 : 200 });
    }

    const r = await schedulerTick({ force, type });
    if (compact) {
      return NextResponse.json({ ok: true, summary: summarizeTick(r, type) }, { status: 200 });
    }
    return NextResponse.json({ ok: true, result: r }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Tick failed.' }, { status: 400 });
  }
}

export async function GET(req) {
  // Allow GET for systemd timer / cron
  return POST(req);
}
