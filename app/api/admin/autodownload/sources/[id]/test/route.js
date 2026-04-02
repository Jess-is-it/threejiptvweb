import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../../lib/server/adminApiAuth';
import { testDownloadSourceProvider } from '../../../../../../../lib/server/autodownload/sourceProvidersService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, ctx) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const params = await ctx.params;
  const providerId = params?.id ? String(params.id) : '';

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const type = String(body?.type || 'movie').toLowerCase() === 'series' ? 'series' : 'movie';
    const result = await testDownloadSourceProvider({
      providerId,
      type,
      query: body?.query || '',
      force: Boolean(body?.force),
      onlyDomain: body?.onlyDomain || '',
      correlationId: body?.correlationId || '',
      jobId: body?.jobId || '',
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Provider test failed.' }, { status: 400 });
  }
}
