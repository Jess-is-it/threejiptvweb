import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { parseStreamBase, xtreamWithFallback } from '../../_shared';

async function handle(req, ctx) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const streamBase = url.searchParams.get('streamBase') || '';
    if (!id || !streamBase) {
      return NextResponse.json({ ok: false, error: 'Missing input' }, { status: 400 });
    }

    const { server, username, password } = parseStreamBase(streamBase);
    const data = await xtreamWithFallback({
      server,
      username,
      password,
      action: 'get_series_info',
      extra: { series_id: String(id) },
    });

    const i = data?.info || {};
    const eps = data?.episodes || {};

    const seasons = Object.keys(eps)
      .sort((a, b) => Number(a) - Number(b))
      .map((sn) => ({
        season: String(sn),
        episodes: (eps[sn] || []).map((e) => ({
          id: String(e?.id ?? e?.episode_id ?? ''),
          episode: Number(e?.episode_num || e?.num || 0),
          title: e?.title || e?.name || `Episode ${e?.episode_num || ''}`,
          image: e?.info?.movie_image || e?.info?.info?.thumbnail || '',
          duration: e?.info?.duration || e?.info?.duration_secs || null,
          airdate: e?.releaseDate || e?.added || null,
          // ✅ include file container extension for correct URL building
          ext:
            e?.container_extension ||
            e?.info?.container_extension ||
            e?.info?.info?.container_extension ||
            null,
        })),
      }));

    return NextResponse.json({
      ok: true,
      id: String(id),
      title: i?.name || 'Series',
      image: i?.cover || i?.series_cover || '',
      plot: i?.plot || '',
      rating: i?.rating || null,
      year: (i?.releaseDate || '').slice(0, 4) || null,
      genre: i?.genre || '',
      seasons,
    }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Series info error' }, { status: 500 });
  }
}

export async function GET(req, ctx) { return handle(req, ctx); }
export async function POST(req, ctx) { return handle(req, ctx); }
