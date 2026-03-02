import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { addQueueItemFromTmdb, listDownloads, startQueuedDownloads } from '../../../../../lib/server/autodownload/downloadService';
import { ensureAutoSelectionSeeded } from '../../../../../lib/server/autodownload/selectionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'movie';
  const seedFlag = String(searchParams.get('seed') || '1').trim().toLowerCase();
  const dispatchFlag = String(searchParams.get('dispatch') || '1').trim().toLowerCase();
  const allowSeed = !(seedFlag === '0' || seedFlag === 'false' || seedFlag === 'no' || seedFlag === 'off');
  const allowDispatch = !(dispatchFlag === '0' || dispatchFlag === 'false' || dispatchFlag === 'no' || dispatchFlag === 'off');
  let list = await listDownloads(type);
  const hasActiveItems = Array.isArray(list)
    ? list.some((x) => String(x?.status || '').toLowerCase() !== 'deleted')
    : false;

  if (allowSeed && !hasActiveItems) {
    await Promise.all([
      ensureAutoSelectionSeeded({ type: 'movie' }).catch(() => null),
      ensureAutoSelectionSeeded({ type: 'series' }).catch(() => null),
    ]);
    list = await listDownloads(type);
  }

  const hasPendingDispatch = Array.isArray(list)
    ? list.some((x) => {
        const st = String(x?.status || '').toLowerCase();
        return (st === 'queued' || st === 'failed' || st === '') && !x?.qbHash && Number(x?.tmdb?.id || 0) > 0;
      })
    : false;

  if (allowDispatch && hasPendingDispatch) {
    await startQueuedDownloads({ type, limitPerType: 2 }).catch(() => null);
    list = await listDownloads(type);
  }

  return NextResponse.json({ ok: true, items: list }, { status: 200 });
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    if (!body?.tmdbId) {
      throw new Error('Manual URL add is disabled. Please add items via TMDB search.');
    }

    const item = await addQueueItemFromTmdb({
      type: body?.type,
      tmdbId: body?.tmdbId,
      mediaType: body?.tmdbMediaType || body?.mediaType || null,
      categoryOrGenre: body?.categoryOrGenre || body?.category || body?.genre || '',
    });
    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to add download.' }, { status: 400 });
  }
}
