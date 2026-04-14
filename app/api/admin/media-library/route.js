import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../lib/server/adminApiAuth';
import { deleteMediaLibraryItems, listMediaLibrary, listMediaLibraryLogs } from '../../../../lib/server/autodownload/mediaLibraryService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const view = String(searchParams.get('view') || '').trim().toLowerCase();
    if (view === 'logs') {
      const out = await listMediaLibraryLogs({
        type: searchParams.get('type') || 'movie',
        limit: searchParams.get('limit') || 100,
      });
      return NextResponse.json(out, { status: 200 });
    }
    const out = await listMediaLibrary({
      type: searchParams.get('type') || 'movie',
      q: searchParams.get('q') || '',
      presence: searchParams.get('presence') || 'all',
      category: searchParams.get('category') || '',
      genre: searchParams.get('genre') || '',
      sort: searchParams.get('sort') || 'title_asc',
      page: searchParams.get('page') || 1,
      pageSize: searchParams.get('pageSize') || 25,
      refresh: isTruthy(searchParams.get('refresh')),
    });
    return NextResponse.json(out, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load media library.' }, { status: 400 });
  }
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const action = String(body?.action || '').trim().toLowerCase();
    if (action !== 'delete') {
      return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
    }

    const out = await deleteMediaLibraryItems({
      type: body?.type || 'movie',
      ids: Array.isArray(body?.ids) ? body.ids : [],
      actor: admin?.username || admin?.email || 'admin',
    });
    return NextResponse.json(out, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to delete media.' }, { status: 400 });
  }
}
