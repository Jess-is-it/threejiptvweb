import { NextResponse } from 'next/server';

import { getPublicSettings } from '../../../../lib/server/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const settings = await getPublicSettings();
  return NextResponse.json({ ok: true, settings }, { status: 200 });
}
