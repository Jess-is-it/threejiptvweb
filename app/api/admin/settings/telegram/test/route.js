import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { sendTelegramTestNotification } from '../../../../../../lib/server/telegramNotifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const result = await sendTelegramTestNotification({
      admin,
      override: body?.telegram || body?.telegramSecrets || null,
      settingsOverride: body?.notificationSettings || null,
      scenario: body?.scenario || 'general',
    });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to send Telegram test notification.' },
      { status: 400 }
    );
  }
}
