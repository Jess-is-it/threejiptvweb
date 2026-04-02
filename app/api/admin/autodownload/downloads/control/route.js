import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import {
  controlDownload,
  getDownloadControlBackgroundStatus,
  startDownloadControlInBackground,
} from '../../../../../../lib/server/autodownload/downloadService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const query = new URL(req.url).searchParams;
  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const wantStatus = toBool(body?.status ?? query.get('status') ?? false);
    const runId = String(body?.runId || query.get('runId') || '').trim();
    if (wantStatus) {
      const status = getDownloadControlBackgroundStatus({ runId });
      return NextResponse.json({ ok: true, ...status }, { status: 200 });
    }

    const background = toBool(body?.background ?? body?.async ?? query.get('background') ?? query.get('async') ?? false);
    if (background) {
      const started = startDownloadControlInBackground({
        type: body?.type || query.get('type') || 'movie',
        id: body?.id || query.get('id') || '',
        action: body?.action || query.get('action') || '',
        title: body?.title || query.get('title') || '',
        deleteArtifacts: toBool(body?.deleteArtifacts ?? query.get('deleteArtifacts') ?? true),
      });
      return NextResponse.json({ ok: true, ...started }, { status: started.accepted ? 202 : 200 });
    }

    const result = await controlDownload({ type: body?.type, id: body?.id, action: body?.action });
    return NextResponse.json(
      {
        ok: true,
        item: result?.item || result || null,
        replacement: result?.replacement || null,
        log: result?.log || null,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Action failed.' }, { status: 400 });
  }
}

export async function GET(req) {
  return POST(req);
}
