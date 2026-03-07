import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getTmdbGenres } from '../../../../../../lib/server/autodownload/tmdbService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const [movie, tv] = await Promise.all([getTmdbGenres({ mediaType: 'movie' }), getTmdbGenres({ mediaType: 'tv' })]);
    return NextResponse.json({ ok: true, movie: movie.genres || [], tv: tv.genres || [] }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load TMDB genres.' }, { status: 400 });
  }
}

