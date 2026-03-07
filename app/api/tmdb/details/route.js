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
  s.toLowerCase().replace(/[\u2019'":,!?()[\].\-]/g, '').replace(/\s+/g, ' ').trim();
const cleanTitle = (s = '') => s.replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s*\[[^\]]+\]\s*$/, '').trim();

export async function GET(req) {
  try {
    const apiKey = (await getSecret('tmdbApiKey')) || process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ ok:false, error:'Missing TMDB_API_KEY' }, { status:500 });

    const sp = new URL(req.url).searchParams;
    const rawTitle = sp.get('title') || '';
    const year = (sp.get('year') || '').trim();
    const hint = (sp.get('kind') || '').toLowerCase();   // 'movie' | 'series'
    const id = Number(sp.get('id') || 0);
    const mediaHint = (sp.get('mediaType') || hint || '').toLowerCase();
    const directMediaType = mediaHint === 'tv' || mediaHint === 'series' ? 'tv' : 'movie';

    let pick = null, mediaType = null;
    if (Number.isFinite(id) && id > 0) {
      pick = { id };
      mediaType = directMediaType;
    } else {
      if (!rawTitle) return NextResponse.json({ ok:false, error:'Missing title' }, { status:400 });

      const title = cleanTitle(rawTitle);
      const order = (hint === 'series' || hint === 'tv') ? ['tv','movie'] : ['movie','tv'];

      for (const type of order) {
        const res = await tmdb(type === 'tv' ? '/search/tv' : '/search/movie', apiKey, {
          query: title, include_adult: 'false',
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
          .sort((a,b) => b.score - a.score)[0]?.x;

        if (best) { pick = best; mediaType = type; break; }
      }
    }
    if (!pick || !mediaType) return NextResponse.json({ ok:false, notFound:true }, { status:404 });

    const details = await tmdb(`/${mediaType}/${pick.id}`, apiKey, { append_to_response: 'credits' });
    const genres = Array.isArray(details?.genres) ? details.genres.map(g => g.name) : [];
    const runtime =
      mediaType === 'movie'
        ? details?.runtime ?? null
        : Array.isArray(details?.episode_run_time) ? details.episode_run_time[0] ?? null : null;
    const cast = Array.isArray(details?.credits?.cast)
      ? details.credits.cast
          .map((c) => String(c?.name || '').trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];

    return NextResponse.json({
      ok: true,
      id: pick.id,
      media_type: mediaType,
      title: details?.title || details?.name || '',
      overview: details?.overview || '',
      rating: details?.vote_average ?? null,
      genres,
      runtime,
      cast,
    });
  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message || 'TMDB error' }, { status:500 });
  }
}
