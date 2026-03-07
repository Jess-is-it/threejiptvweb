import { NextResponse } from 'next/server';
import { getSecret } from '../../../../lib/server/secrets';

const TMDB_BASE = 'https://api.themoviedb.org/3';

export const runtime = 'nodejs';

function withKey(url, apiKey, params = {}) {
  const u = new URL(url);
  if (apiKey) u.searchParams.set('api_key', apiKey);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  return u.toString();
}

async function tmdb(path, apiKey, params) {
  const r = await fetch(withKey(`${TMDB_BASE}${path}`, apiKey, params), { cache: 'no-store' });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

const norm = (s = '') =>
  s
    .toLowerCase()
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const cleanTitle = (s = '') => s.replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s*\[[^\]]+\]\s*$/, '').trim();

export async function GET(req) {
  try {
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, error: 'Missing TMDB_API_KEY' }, { status: 500 });

    const sp = new URL(req.url).searchParams;
    const rawTitle = sp.get('title') || '';
    const year = (sp.get('year') || '').trim();
    const hint = (sp.get('kind') || '').toLowerCase(); // movie | series

    if (!rawTitle) return NextResponse.json({ ok: false, error: 'Missing title' }, { status: 400 });

    const title = cleanTitle(rawTitle);
    const order = hint === 'series' || hint === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];

    let pick = null;
    let mediaType = null;
    for (const type of order) {
      const res = await tmdb(type === 'tv' ? '/search/tv' : '/search/movie', apiKey, {
        query: title,
        include_adult: 'false',
        ...(year ? (type === 'tv' ? { first_air_date_year: year } : { year }) : {}),
      });
      const list = Array.isArray(res?.results) ? res.results : [];
      if (!list.length) continue;

      const target = norm(title);
      const best = list
        .map((x) => {
          const t = norm(x?.name || x?.title || '');
          const date = x?.first_air_date || x?.release_date || '';
          const yOk = year ? date.startsWith(year) : false;
          const same = t === target;
          const score = (x?.popularity || 0) + (same ? 100 : 0) + (yOk ? 50 : 0);
          return { x, score };
        })
        .sort((a, b) => b.score - a.score)[0]?.x;

      if (best) {
        pick = best;
        mediaType = type;
        break;
      }
    }

    if (!pick) return NextResponse.json({ ok: false, notFound: true }, { status: 404 });

    const vids = await tmdb(`/${mediaType}/${pick.id}/videos`, apiKey, { language: 'en-US' });
    const list = Array.isArray(vids?.results) ? vids.results : [];

    const candidates = list
      .filter((v) => (v?.site || '').toLowerCase() === 'youtube' && v?.key)
      .map((v) => {
        const type = String(v?.type || '').toLowerCase();
        const isTrailer = type === 'trailer' ? 2 : type === 'teaser' ? 1 : 0;
        const official = v?.official ? 1 : 0;
        const published = Date.parse(v?.published_at || '') || 0;
        return { v, score: isTrailer * 100 + official * 25 + Math.min(20, Math.floor(published / 1e11)) };
      })
      .sort((a, b) => b.score - a.score);

    const best = candidates[0]?.v || null;
    if (!best) return NextResponse.json({ ok: false, notFound: true }, { status: 404 });

    return NextResponse.json(
      {
        ok: true,
        media_type: mediaType,
        id: pick.id,
        site: 'YouTube',
        key: best.key,
        name: best.name || '',
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'TMDB error' }, { status: 500 });
  }
}

