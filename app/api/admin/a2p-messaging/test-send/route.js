import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { sendA2pTestSms } from '../../../../../lib/server/a2pMessaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const destination = String(body?.destination || '').trim();
    const messageText = String(body?.messageText || body?.message_text || '').trim();
    if (destination.length < 8) throw new Error('Destination is required.');
    if (!messageText) throw new Error('Message text is required.');
    const settings = await sendA2pTestSms(body, admin);
    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to send A2P test SMS.' }, { status: 400 });
  }
}
