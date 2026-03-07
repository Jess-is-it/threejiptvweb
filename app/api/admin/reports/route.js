import { NextResponse } from 'next/server';

import { requireAdmin } from '../../../../lib/server/adminAuth';
import { getAdminDb, saveAdminDb } from '../../../../lib/server/adminDb';
import { createUserNotification } from '../../../../lib/server/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function nowMs() {
  return Date.now();
}

export async function GET(req) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const status = String(searchParams.get('status') || '').trim(); // open|resolved|ignored

    const db = await getAdminDb();
    const list = Array.isArray(db.reports) ? db.reports : [];
    const items = status ? list.filter((r) => r.status === status) : list;

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load reports' }, { status: 500 });
  }
}

export async function PATCH(req) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim(); // resolve|ignore
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
    const message = String(body?.message || '').trim();

    if (!ids.length) return NextResponse.json({ ok: false, error: 'No reports selected' }, { status: 400 });
    if (action !== 'resolve' && action !== 'ignore') {
      return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }
    if (action === 'resolve' && !message) {
      return NextResponse.json({ ok: false, error: 'Resolution message is required' }, { status: 400 });
    }

    const db = await getAdminDb();
    const at = nowMs();

    const touched = [];
    db.reports = (Array.isArray(db.reports) ? db.reports : []).map((r) => {
      if (!ids.includes(String(r.id))) return r;
      if (action === 'ignore') {
        const next = {
          ...r,
          status: 'ignored',
          updatedAt: at,
          resolution: {
            action: 'ignored',
            at,
            by: admin.email,
            message: null,
          },
        };
        touched.push(next);
        return next;
      }

      const next = {
        ...r,
        status: 'resolved',
        updatedAt: at,
        resolution: {
          action: 'resolved',
          at,
          by: admin.email,
          message,
        },
      };
      touched.push(next);
      return next;
    });

    await saveAdminDb(db);

    // Notify users for resolved reports
    if (action === 'resolve') {
      await Promise.allSettled(
        touched.map((r) => {
          const kind = String(r?.meta?.type || '').toLowerCase();
          const typeLabel =
            kind === 'movie' ? 'Movie' : kind === 'series' ? 'Series' : kind === 'live' ? 'Live' : 'Content';
          const name = r?.meta?.title || r?.meta?.id || 'Unknown';
          const contentLabel = `${typeLabel}: ${name}`;

          const issue = r?.choiceTitle || r?.choice || '';
          const fullMessage =
            `${message}\n\nContent: ${contentLabel}` +
            (issue ? `\nReported issue: ${issue}` : '');

          return createUserNotification({
            username: r?.user?.username,
            title: `Report resolved — ${contentLabel}`,
            message: fullMessage,
            reportId: r.id,
          });
        })
      );
    }

    return NextResponse.json({ ok: true, updated: touched.length }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update reports' }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
