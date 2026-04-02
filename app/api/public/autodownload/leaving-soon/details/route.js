import { NextResponse } from 'next/server';

import { findLeavingSoonItem } from '../../../../../../lib/server/autodownload/deletionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const mediaType = String(searchParams.get('mediaType') || searchParams.get('type') || 'movie').trim().toLowerCase();
    const type = mediaType === 'tv' || mediaType === 'series' ? 'series' : 'movie';
    const xuiId = Number(searchParams.get('xuiId') || searchParams.get('id') || 0);
    if (!Number.isFinite(xuiId) || xuiId <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid xuiId' }, { status: 400 });
    }
    const item = await findLeavingSoonItem({ type, xuiId });
    if (!item) {
      return NextResponse.json({ ok: false, error: 'Leaving soon item not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load leaving soon details.' }, { status: 500 });
  }
}
