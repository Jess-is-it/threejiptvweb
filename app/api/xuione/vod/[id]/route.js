import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { parseStreamBase, xtreamWithFallback } from '../../_shared';
async function handle(req, ctx) {
  try {
    const { id } = await ctx.params; // ✅ await params
    const url = new URL(req.url);
    const streamBase = url.searchParams.get('streamBase') || '';
    if (!id || !streamBase) {
      return NextResponse.json({ ok: false, error: 'Missing input' }, { status: 400 });
    }

    const { server, username, password } = parseStreamBase(streamBase);
    const info = await xtreamWithFallback({
      server,
      username,
      password,
      action: 'get_vod_info',
      extra: { vod_id: String(id) },
    });

    const i = info?.info || {};
    const image = i.cover || i.movie_image || info?.movie_data?.stream_icon || '';
    const subsRaw = info?.movie_data?.subtitles;
    const subtitles = Array.isArray(subsRaw)
      ? subsRaw
          .map((s) => ({
            lang: s?.language || s?.lang || 'Subtitle',
            url: s?.url || s?.path || '',
          }))
          .filter((s) => s.url)
      : [];

    return NextResponse.json(
      {
        ok: true,
        id,
        title: i.name || `Movie ${id}`,
        plot: i.plot || '',
        rating: i.rating || null,
        duration: i.duration || i.duration_secs || null,
        year: (i.releasedate || '').slice(0, 4) || null,
        genre: i.genre || i.category_name || null,
        image,
        trailer: i.youtube_trailer || null,
        ext:
          info?.movie_data?.container_extension ||
          i?.container_extension ||
          info?.info?.container_extension ||
          null,
        subtitles,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'VOD info error' },
      { status: 502 }
    );
  }
}
export async function GET(req, ctx){ return handle(req, ctx); }
export async function POST(req, ctx){ return handle(req, ctx); }
