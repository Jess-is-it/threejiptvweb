import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../../../../lib/server/adminDb';
import { notifyTelegramUserReportCreated } from '../../../../lib/server/telegramNotifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function nowMs() {
  return Date.now();
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    const choice = String(body?.choice || '').trim();
    const choiceTitle = String(body?.choiceTitle || '').trim();
    const message = String(body?.message || '').trim();
    const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};

    if (!username) {
      return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });
    }
    if (!choice) {
      return NextResponse.json({ ok: false, error: 'Missing choice' }, { status: 400 });
    }

    const report = {
      id: crypto.randomUUID(),
      createdAt: nowMs(),
      updatedAt: nowMs(),
      status: 'open', // open | resolved | ignored
      user: { username },
      choice,
      choiceTitle: choiceTitle || choice,
      message,
      meta: {
        id: meta?.id ?? null,
        type: meta?.type ?? null,
        title: meta?.title ?? null,
        href: meta?.href ?? null,
      },
      context: {
        position: Number.isFinite(Number(body?.position)) ? Number(body.position) : null,
        duration: Number.isFinite(Number(body?.duration)) ? Number(body.duration) : null,
      },
      resolution: null,
    };

    const db = await getAdminDb();
    db.reports.unshift(report);
    await saveAdminDb(db);
    notifyTelegramUserReportCreated(report).catch(() => null);

    return NextResponse.json({ ok: true, id: report.id }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to create report' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
