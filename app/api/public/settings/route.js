import { NextResponse } from 'next/server';

import { getPublicSettings } from '../../../../lib/server/settings';
import { getRequestSettings } from '../../../../lib/server/requestService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const [settings, requestSettings] = await Promise.all([getPublicSettings(), getRequestSettings()]);
  return NextResponse.json(
    {
      ok: true,
      settings: {
        ...settings,
        requests: {
          ...(settings?.requests && typeof settings.requests === 'object' ? settings.requests : {}),
          enabled: requestSettings?.enabled !== false,
        },
      },
    },
    { status: 200 }
  );
}
