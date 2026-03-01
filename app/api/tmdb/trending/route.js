import { getSecret } from '../../../../lib/server/secrets';
import { NextResponse } from 'next/server';

const API = 'https://api.themoviedb.org/3';

export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const key = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY;
    if (!key) return NextResponse.json({ ok: false, error: 'TMDB_API_KEY missing' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'movie';
    const window = searchParams.get('window') || 'week';
    const page = searchParams.get('page') || '1';

    const url = `${API}/trending/${encodeURIComponent(type)}/${encodeURIComponent(window)}?language=en-US&include_adult=false&page=${encodeURIComponent(page)}&api_key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return NextResponse.json({ ok: false, error: `TMDb error ${r.status}` }, { status: 502 });

    const data = await r.json();
    return NextResponse.json({ ok: true, ...data }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Unexpected error' }, { status: 500 });
  }
}
