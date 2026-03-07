import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../../lib/server/adminDb';
import { updateAutodownloadSettings } from '../../../../../../lib/server/autodownload/autodownloadDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clampNum(v, { min = null, max = null, fallback = null } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.floor(n * 1000) / 1000;
  if (min !== null && x < min) return min;
  if (max !== null && x > max) return max;
  return x;
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const db = await getAdminDb();
  return NextResponse.json(
    { ok: true, triggerSettings: db.autodownloadSettings?.watchfolderTrigger || null },
    { status: 200 }
  );
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const errors = [];

  const enabledInput = body?.enabled;
  const enabled = enabledInput === undefined ? true : Boolean(enabledInput);
  const cooldownMinutes = clampNum(body?.cooldownMinutes, { min: 0, max: 1440, fallback: 10 });
  const modeRaw = String(body?.mode || 'debounced').trim().toLowerCase();
  const mode = modeRaw === 'immediate' ? 'immediate' : 'debounced';
  if (modeRaw && !['debounced', 'immediate'].includes(modeRaw)) {
    errors.push('Watchfolder scan mode must be debounced or immediate.');
  }

  if (errors.length) {
    return NextResponse.json({ ok: false, error: 'Validation failed.', errors }, { status: 400 });
  }

  await updateAutodownloadSettings({
    watchfolderTrigger: {
      enabled,
      cooldownMinutes,
      mode,
      triggerAfterFinalOnly: true,
    },
  });

  const db = await getAdminDb();
  return NextResponse.json(
    { ok: true, triggerSettings: db.autodownloadSettings?.watchfolderTrigger || null },
    { status: 200 }
  );
}
