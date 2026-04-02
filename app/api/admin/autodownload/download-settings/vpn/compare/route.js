import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../../lib/server/adminApiAuth';
import { runVpnMovieDownloadComparison } from '../../../../../../../lib/server/autodownload/vpnService';

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
    const maxRunMinutesInput = body?.maxRunMinutes !== undefined ? Number(body?.maxRunMinutes || 0) : null;
    const sampleSecondsLegacy = body?.sampleSeconds !== undefined ? Number(body?.sampleSeconds || 0) : null;
    const maxRunMinutes =
      Number.isFinite(maxRunMinutesInput) && maxRunMinutesInput > 0
        ? maxRunMinutesInput
        : Number.isFinite(sampleSecondsLegacy) && sampleSecondsLegacy > 0
          ? Math.max(3, Math.ceil(sampleSecondsLegacy / 60))
          : 25;
    const minSeeders = body?.minSeeders === undefined ? null : Number(body.minSeeders || 0);
    const result = await runVpnMovieDownloadComparison({ maxRunMinutes, minSeeders });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'VPN download comparison failed.' }, { status: 400 });
  }
}
