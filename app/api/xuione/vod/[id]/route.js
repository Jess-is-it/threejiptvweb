import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

import { parseStreamBase, resolveXuioneAssetUrl, xtreamWithFallback } from '../../_shared';
import { findLocalMovieSubtitles } from '../../../../../lib/server/subtitles/localSubtitleService';
import { searchMovieSubtitles } from '../../../../../lib/server/subtitles/openSubtitlesService';
import { mergeSubtitleTrackLists } from '../../../../../lib/server/subtitles/trackUtils';

function mapLanguageCode(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (raw.includes('tagalog') || raw.includes('filipino')) return 'tl';
  if (raw.includes('english')) return 'en';
  if (raw === 'eng') return 'en';
  if (raw === 'fil') return 'tl';
  if (raw === 'tgl') return 'tl';
  return raw.slice(0, 2);
}

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
    const image = resolveXuioneAssetUrl(i.cover || i.movie_image || info?.movie_data?.stream_icon || '', server);
    const subsRaw = info?.movie_data?.subtitles;
    const xuiSubtitles = Array.isArray(subsRaw)
      ? subsRaw
          .map((s) => ({
            lang: s?.language || s?.lang || 'Subtitle',
            label: s?.language || s?.lang || 'Subtitle',
            srclang: mapLanguageCode(s?.language || s?.lang || ''),
            url: s?.url || s?.path || '',
          }))
          .filter((s) => s.url)
      : [];
    let localSubtitles = [];
    try {
      localSubtitles = await findLocalMovieSubtitles({
        title: i.name || `Movie ${id}`,
        year: (i.releasedate || '').slice(0, 4) || '',
      });
    } catch {}

    const mergedExisting = mergeSubtitleTrackLists(localSubtitles, xuiSubtitles);
    let openSubtitles = [];
    try {
      openSubtitles = await searchMovieSubtitles({
        title: i.name || `Movie ${id}`,
        year: (i.releasedate || '').slice(0, 4) || '',
        acceptLanguage: req.headers.get('accept-language') || '',
      });
    } catch {}

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
        subtitles: mergeSubtitleTrackLists(localSubtitles, xuiSubtitles, openSubtitles),
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
