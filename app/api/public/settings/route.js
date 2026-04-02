import { NextResponse } from 'next/server';

import { getPublicSettings } from '../../../../lib/server/settings';
import { getRequestSettings } from '../../../../lib/server/requestService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const [settings, requestSettings] = await Promise.all([getPublicSettings(), getRequestSettings()]);
  const publicSettings = settings && typeof settings === 'object' ? { ...settings } : {};

  // Temporarily disable category-settings-driven public catalog behavior.
  delete publicSettings.catalog;

  return NextResponse.json(
    {
      ok: true,
      settings: {
        ...publicSettings,
        requests: {
          ...(publicSettings?.requests && typeof publicSettings.requests === 'object' ? publicSettings.requests : {}),
          enabled: requestSettings?.enabled !== false,
        },
      },
    },
    { status: 200 }
  );
}
