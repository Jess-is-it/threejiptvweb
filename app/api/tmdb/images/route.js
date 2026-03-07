// app/api/tmdb/images/route.js
import { NextResponse } from 'next/server';
import { getSecret } from '../../../../lib/server/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function looksLikeV4Token(key) {
  // TMDb v4 tokens are JWT-like (typically start with "eyJ")
  const s = String(key || '');
  return s.length > 40 && s.includes('.') && s.startsWith('eyJ');
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'movie'; // 'movie' or 'tv'
    const id = url.searchParams.get('id');
    const key = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY;
    if (!id || !key) {
      return NextResponse.json({ ok: false, error: 'Missing id or TMDB_API_KEY' }, { status: 400 });
    }

    const baseUrl = `https://api.themoviedb.org/3/${type}/${id}/images?include_image_language=null`;
    const r = await fetch(
      looksLikeV4Token(key) ? baseUrl : `${baseUrl}&api_key=${encodeURIComponent(key)}`,
      {
        headers: looksLikeV4Token(key) ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' },
        cache: 'no-store',
      }
    );
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `TMDb ${r.status}` }, { status: 502 });
    }
    const data = await r.json();
    return NextResponse.json({ ok: true, backdrops: data.backdrops || [], posters: data.posters || [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
