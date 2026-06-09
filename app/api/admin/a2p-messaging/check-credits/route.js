import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { checkA2pCredits } from '../../../../../lib/server/a2pMessaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const settings = await checkA2pCredits();
    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to check A2P credits.' }, { status: 400 });
  }
}
