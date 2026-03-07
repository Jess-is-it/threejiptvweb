import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getLibraryInventorySnapshot, getOrRefreshLibraryInventory, syncLibraryInventory } from '../../../../../lib/server/autodownload/libraryInventoryService';
import { cleanLibrary, previewLibraryCleaning } from '../../../../../lib/server/autodownload/libraryCleaningService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const refresh = String(searchParams.get('refresh') || '').toLowerCase();
  if (refresh === '1' || refresh === 'true' || refresh === 'yes') {
    const out = await getOrRefreshLibraryInventory({ force: true });
    return NextResponse.json(out, { status: out?.ok ? 200 : 200 });
  }

  const inventory = await getLibraryInventorySnapshot();
  return NextResponse.json(
    {
      ok: true,
      refreshed: false,
      stale: false,
      ageMs: inventory?.updatedAt ? Math.max(0, Date.now() - Number(inventory.updatedAt || 0)) : null,
      inventory,
    },
    { status: 200 }
  );
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const force = Boolean(body?.force ?? true);
  try {
    const action = String(body?.action || '').trim().toLowerCase();
    if (action === 'clean_preview') {
      const preview = await previewLibraryCleaning({ sampleLimit: body?.sampleLimit });
      return NextResponse.json(preview, { status: preview?.ok ? 200 : 400 });
    }
    if (action === 'clean_run') {
      const confirm = body?.confirm === true || String(body?.confirm || '').toLowerCase() === 'yes';
      if (!confirm) {
        return NextResponse.json(
          { ok: false, error: 'Confirmation required before running Clean Library.' },
          { status: 400 }
        );
      }
      const result = await cleanLibrary({ sampleLimit: body?.sampleLimit });
      if (!result?.ok) return NextResponse.json(result, { status: 400 });
      const inventory = await syncLibraryInventory().catch(() => null);
      return NextResponse.json({ ...result, inventory }, { status: 200 });
    }

    if (force) {
      const inventory = await syncLibraryInventory();
      return NextResponse.json({ ok: true, refreshed: true, stale: false, inventory }, { status: 200 });
    }
    const out = await getOrRefreshLibraryInventory({ force: false });
    return NextResponse.json(out, { status: out?.ok ? 200 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to refresh inventory.' }, { status: 400 });
  }
}
