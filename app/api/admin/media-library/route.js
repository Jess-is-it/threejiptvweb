import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../lib/server/adminApiAuth';
import { deleteMediaLibraryItems, listMediaLibrary, listMediaLibraryLogs } from '../../../../lib/server/autodownload/mediaLibraryService';
import {
  createManualUpload,
  getManualUploadPreflight,
  listManualUploads,
  manualReleaseNow,
  saveManualUploadFolderSettings,
  updateManualReleaseDate,
} from '../../../../lib/server/autodownload/manualUploadService';

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
    if (view === 'manual') {
      const out = await listManualUploads({
        type: searchParams.get('type') || 'movie',
        limit: searchParams.get('limit') || 50,
      });
      return NextResponse.json(out, { status: 200 });
    }
    if (view === 'preflight') {
      const out = await getManualUploadPreflight({
        type: searchParams.get('type') || 'movie',
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

  try {
    const contentType = String(req.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const action = String(form.get('action') || '').trim().toLowerCase();
      if (action !== 'manual_upload') {
        return NextResponse.json({ ok: false, error: 'Unsupported form action.' }, { status: 400 });
      }
      const type = String(form.get('type') || 'movie').trim();
      const title = String(form.get('title') || '').trim();
      const year = String(form.get('year') || '').trim();
      const tmdbId = String(form.get('tmdbId') || '').trim();
      const tmdbMediaType = String(form.get('tmdbMediaType') || '').trim();
      const releaseDate = String(form.get('releaseDate') || '').trim();
      const processNow = String(form.get('processNow') || '1').trim();
      const releaseNow = String(form.get('releaseNow') || '0').trim();
      const files = form.getAll('files').filter((x) => x && typeof x === 'object');
      const filePaths = form
        .getAll('filePaths')
        .map((x) => String(x || '').trim())
        .filter(Boolean);
      const out = await createManualUpload({
        type,
        title,
        year,
        tmdbId,
        tmdbMediaType,
        releaseDate,
        processNow: isTruthy(processNow),
        releaseNow: isTruthy(releaseNow),
        files,
        filePaths,
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch {}

    const action = String(body?.action || '').trim().toLowerCase();
    if (action === 'delete') {
      const out = await deleteMediaLibraryItems({
        type: body?.type || 'movie',
        ids: Array.isArray(body?.ids) ? body.ids : [],
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_update_release_date') {
      const out = await updateManualReleaseDate({
        type: body?.type || 'movie',
        id: body?.id || '',
        releaseDate: body?.releaseDate || '',
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_release_now') {
      const out = await manualReleaseNow({
        type: body?.type || 'movie',
        id: body?.id || '',
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_upload_folders_save') {
      const out = await saveManualUploadFolderSettings({
        rootName: body?.rootName,
        moviesProcessing: body?.moviesProcessing,
        seriesProcessing: body?.seriesProcessing,
      });
      return NextResponse.json(out, { status: 200 });
    }

    return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Request failed.' }, { status: 400 });
  }
}
