import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { listA2pMessages } from '../../../../../lib/server/a2pMessaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const data = await listA2pMessages({
    status: url.searchParams.get('status') || 'ALL',
    purpose: url.searchParams.get('purpose') || 'ALL',
    search: url.searchParams.get('search') || '',
    page: url.searchParams.get('page') || 1,
    pageSize: url.searchParams.get('pageSize') || url.searchParams.get('page_size') || 20,
  });
  return NextResponse.json({ ok: true, ...data }, { status: 200 });
}
