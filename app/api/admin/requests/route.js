import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../lib/server/adminApiAuth';
import { createUserNotification } from '../../../../lib/server/notifications';
import {
  archiveRequestsByStatus,
  listRequestQueue,
  REQUEST_STATUS,
  updateRequestStatus,
} from '../../../../lib/server/requestService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mediaLabel(mediaType) {
  return String(mediaType || '').toLowerCase() === 'tv' ? 'Series' : 'Movie';
}

function uniqueReminderUsers(row) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(row?.reminderSubscribers) ? row.reminderSubscribers : [];
  for (const item of list) {
    const u = String(item?.username || '').trim().toLowerCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function notifyAvailableNow(row) {
  const users = uniqueReminderUsers(row);
  if (!users.length) return { notified: 0 };

  const title = String(row?.title || '').trim() || `TMDB #${row?.tmdbId || ''}`;
  const label = mediaLabel(row?.mediaType);
  const text = `${label} "${title}" is now available on 3J TV.`;

  const settled = await Promise.allSettled(
    users.map((username) =>
      createUserNotification({
        username,
        type: 'request',
        requestId: row?.id || null,
        title: `Available Now - ${title}`,
        message: text,
        meta: {
          tmdbId: Number(row?.tmdbId || 0) || null,
          mediaType: row?.mediaType || 'movie',
        },
      })
    )
  );

  const notified = settled.filter((x) => x.status === 'fulfilled').length;
  return { notified };
}

function statusCounts(rows) {
  const base = {
    pending: 0,
    approved: 0,
    available_now: 0,
    rejected: 0,
    archived: 0,
    total: 0,
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    const st = String(row?.status || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(base, st)) base[st] += 1;
    base.total += 1;
  }
  return base;
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const status = String(searchParams.get('status') || 'active').trim().toLowerCase();
    const includeArchived = ['1', 'true', 'yes'].includes(
      String(searchParams.get('includeArchived') || '').trim().toLowerCase()
    );

    const [filtered, all] = await Promise.all([
      listRequestQueue({ status, includeArchived }),
      listRequestQueue({ status: 'all', includeArchived: true }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        items: filtered.items,
        settings: filtered.settings,
        counts: statusCounts(all.items),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load request queue' }, { status: 500 });
  }
}

export async function PATCH(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim().toLowerCase();

    if (action === 'status') {
      const ids = Array.isArray(body?.ids)
        ? body.ids.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      if (!ids.length && body?.id) ids.push(String(body.id).trim());
      if (!ids.length) {
        return NextResponse.json({ ok: false, error: 'No request ids provided' }, { status: 400 });
      }

      const uniqIds = [...new Set(ids)];
      let notified = 0;
      const updatedItems = [];

      for (const id of uniqIds) {
        const result = await updateRequestStatus({
          id,
          status: body?.status,
        });
        if (result?.item) updatedItems.push(result.item);
        if (result?.changedToAvailableNow) {
          const sent = await notifyAvailableNow(result.item);
          notified += Number(sent?.notified || 0);
        }
      }

      return NextResponse.json(
        {
          ok: true,
          updated: updatedItems.length,
          item: updatedItems[0] || null,
          items: updatedItems,
          notified,
        },
        { status: 200 }
      );
    }

    if (action === 'archive') {
      const ids = Array.isArray(body?.ids) ? body.ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
      if (ids.length) {
        let archived = 0;
        for (const id of ids) {
          await updateRequestStatus({ id, status: REQUEST_STATUS.ARCHIVED });
          archived += 1;
        }
        return NextResponse.json({ ok: true, archived }, { status: 200 });
      }

      const statuses = Array.isArray(body?.statuses) ? body.statuses : [REQUEST_STATUS.AVAILABLE_NOW, REQUEST_STATUS.REJECTED];
      const out = await archiveRequestsByStatus(statuses);
      return NextResponse.json({ ok: true, ...out }, { status: 200 });
    }

    return NextResponse.json({ ok: false, error: 'Invalid action. Use status or archive.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update request queue' }, { status: 400 });
  }
}

export async function POST() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
