import { NextResponse } from 'next/server';

import { getAdminDb, saveAdminDb } from '../../../../lib/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function nowMs() {
  return Date.now();
}

function listForUser(db, username) {
  const list = db.notifications?.[username];
  return Array.isArray(list) ? list : [];
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const username = String(searchParams.get('username') || '').trim();
    if (!username) return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });

    const db = await getAdminDb();
    const items = listForUser(db, username).slice(0, 100);
    const unread = items.filter((n) => !n.readAt).length;

    return NextResponse.json({ ok: true, items, unread }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load notifications' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    if (!username) return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });

    const markAll = Boolean(body?.markAll);
    const markReadIds = Array.isArray(body?.markReadIds) ? body.markReadIds.map(String) : [];

    const db = await getAdminDb();
    const list = listForUser(db, username);
    const at = nowMs();

    const next = list.map((n) => {
      if (n.readAt) return n;
      if (markAll) return { ...n, readAt: at };
      if (markReadIds.includes(String(n.id))) return { ...n, readAt: at };
      return n;
    });

    db.notifications = db.notifications && typeof db.notifications === 'object' ? db.notifications : {};
    db.notifications[username] = next;
    await saveAdminDb(db);

    const unread = next.filter((n) => !n.readAt).length;
    return NextResponse.json({ ok: true, unread }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update notifications' }, { status: 500 });
  }
}
