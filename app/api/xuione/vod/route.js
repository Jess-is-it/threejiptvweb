import { NextResponse } from 'next/server';
import { parseStreamBase, xtreamWithFallback } from '../_shared';

export const dynamic = 'force-dynamic';

function normalizeAddedMs(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const raw = String(value).trim();
    if (!raw) continue;

    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      if (n >= 1e12) return Math.floor(n);
      if (n >= 1e9) return Math.floor(n * 1000);
    }

    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const streamBase = searchParams.get('streamBase') || '';
  try {
    const { server, username, password } = parseStreamBase(streamBase);
    const vod = await xtreamWithFallback({
      server, username, password, action: 'get_vod_streams'
    });

    const items = (Array.isArray(vod) ? vod : []).map((v) => {
      const id = v?.stream_id ?? v?.id;
      const added = normalizeAddedMs(
        v?.added,
        v?.date_added,
        v?.last_modified,
        v?.releaseDate,
        v?.release_date
      );
      return {
        id,
        title: v?.name || `Movie #${id}`,
        image: v?.stream_icon || v?.cover || '',
        plot: v?.plot || v?.overview || '',
        year: v?.year || null,
        rating: v?.rating ?? null,
        added,
        kind: 'movie',
        href: id ? `/movies/${id}` : '#',
      };
    });

    return NextResponse.json(
      { ok: true, items },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
      }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
