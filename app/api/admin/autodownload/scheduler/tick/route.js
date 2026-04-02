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

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin && !hasSchedulerToken(req)) {
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
    const background = toBool(body?.background ?? body?.async ?? query.get('background') ?? query.get('async') ?? false);
    const wantStatus = toBool(body?.status ?? query.get('status') ?? false);
    const runId = String(body?.runId || query.get('runId') || '').trim();

    if (wantStatus) {
      const status = getSchedulerTickBackgroundStatus({ runId });
      return NextResponse.json({ ok: true, ...status }, { status: 200 });
    }

    if (background) {
      const started = startSchedulerTickInBackground({ force, type });
      return NextResponse.json({ ok: true, ...started }, { status: started.accepted ? 202 : 200 });
    }

    const r = await schedulerTick({ force, type });
    return NextResponse.json({ ok: true, result: r }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Tick failed.' }, { status: 400 });
  }
}

export async function GET(req) {
  // Allow GET for systemd timer / cron
  return POST(req);
}
