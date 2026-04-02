import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { clearDownloadSourceLogs, queryDownloadSourceLogs } from '../../../../../../lib/server/autodownload/sourceProvidersService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);

  try {
    const out = await queryDownloadSourceLogs({
      type: searchParams.get('type') || 'movie',
      provider: searchParams.get('provider') || 'all',
      domain: searchParams.get('domain') || 'all',
      range: searchParams.get('range') || '24h',
      status: searchParams.get('status') || 'all',
      errorCategory: searchParams.get('errorCategory') || 'all',
      view: searchParams.get('view') || 'recent',
      limit: Number(searchParams.get('limit') || 300) || 300,
    });

    return NextResponse.json({ ok: true, ...out }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load source logs.' }, { status: 400 });
  }
}

export async function DELETE(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);

  try {
    const out = await clearDownloadSourceLogs({
      provider: searchParams.get('provider') || 'all',
      type: searchParams.get('type') || 'movie',
    });
    return NextResponse.json({ ok: true, ...out }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to clear source logs.' }, { status: 400 });
  }
}
