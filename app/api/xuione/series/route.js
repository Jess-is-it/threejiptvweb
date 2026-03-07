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
    const series = await xtreamWithFallback({
      server, username, password, action: 'get_series'
    });

    const items = (Array.isArray(series) ? series : []).map((s) => {
      const id = s?.series_id ?? s?.id;
      const year =
        (s?.releaseDate && String(s.releaseDate).slice(0, 4)) ||
        s?.year ||
        null;
      const added = normalizeAddedMs(
        s?.added,
        s?.date_added,
        s?.last_modified,
        s?.releaseDate,
        s?.release_date
      );

      return {
        id,
        title: s?.name || `Series #${id}`,
        image: s?.cover || s?.stream_icon || '',
        plot: s?.plot || s?.overview || '',
        year,
        rating: s?.rating ?? null,
        added,
        kind: 'series',
        href: id ? `/series/${id}` : '#',
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
