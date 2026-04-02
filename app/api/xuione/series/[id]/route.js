import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { parseStreamBase, resolveXuioneAssetUrl, xtreamWithFallback } from '../../_shared';
import { findLocalSeriesEpisodeSubtitles } from '../../../../../lib/server/subtitles/localSubtitleService';
import { searchSeriesEpisodeSubtitles } from '../../../../../lib/server/subtitles/openSubtitlesService';
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

function normalizeEpisodeSubtitles(rawSubtitles) {
  return (Array.isArray(rawSubtitles) ? rawSubtitles : [])
    .map((subtitle) => ({
      source: 'xui',
      lang: subtitle?.language || subtitle?.lang || 'Subtitle',
      label: subtitle?.language || subtitle?.lang || 'Subtitle',
      srclang: mapLanguageCode(subtitle?.language || subtitle?.lang || ''),
      url: subtitle?.url || subtitle?.path || '',
    }))
    .filter((subtitle) => subtitle.url);
}

async function handle(req, ctx) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const streamBase = url.searchParams.get('streamBase') || '';
    const episodeId = String(url.searchParams.get('episodeId') || '').trim();
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
    const episodeLookup = new Map();

    const seasons = Object.keys(eps)
      .sort((a, b) => Number(a) - Number(b))
      .map((sn) => {
        const seasonNumber = Number(sn || 0);
        const episodes = (eps[sn] || []).map((e) => {
          const normalizedEpisode = {
            id: String(e?.id ?? e?.episode_id ?? ''),
            episode: Number(e?.episode_num || e?.num || 0),
            seasonNumber,
            title: e?.title || e?.name || `Episode ${e?.episode_num || ''}`,
            image: resolveXuioneAssetUrl(e?.info?.movie_image || e?.info?.info?.thumbnail || '', server),
            duration: e?.info?.duration || e?.info?.duration_secs || null,
            airdate: e?.releaseDate || e?.added || null,
            // ✅ include file container extension for correct URL building
            ext:
              e?.container_extension ||
              e?.info?.container_extension ||
              e?.info?.info?.container_extension ||
              null,
          };
          if (normalizedEpisode.id) {
            episodeLookup.set(normalizedEpisode.id, {
              ...normalizedEpisode,
              subtitles: normalizeEpisodeSubtitles(
                e?.subtitles || e?.info?.subtitles || e?.info?.info?.subtitles || []
              ),
            });
          }
          return normalizedEpisode;
        });
        return {
          season: String(sn),
          episodes,
        };
      });

    let subtitles = [];
    const currentEpisode = episodeId ? episodeLookup.get(episodeId) || null : null;
    if (currentEpisode?.id && currentEpisode.seasonNumber > 0 && currentEpisode.episode > 0) {
      let localSubtitles = [];
      let openSubtitles = [];
      try {
        localSubtitles = await findLocalSeriesEpisodeSubtitles({
          title: i?.name || 'Series',
          year: (i?.releaseDate || '').slice(0, 4) || '',
          seasonNumber: currentEpisode.seasonNumber,
          episodeNumber: currentEpisode.episode,
        });
      } catch {}
      try {
        openSubtitles = await searchSeriesEpisodeSubtitles({
          title: i?.name || 'Series',
          year: (i?.releaseDate || '').slice(0, 4) || '',
          seasonNumber: currentEpisode.seasonNumber,
          episodeNumber: currentEpisode.episode,
          acceptLanguage: req.headers.get('accept-language') || '',
        });
      } catch {}
      subtitles = mergeSubtitleTrackLists(localSubtitles, currentEpisode.subtitles, openSubtitles);
    }

    return NextResponse.json({
      ok: true,
      id: String(id),
      title: i?.name || 'Series',
      image: resolveXuioneAssetUrl(i?.cover || i?.series_cover || '', server),
      plot: i?.plot || '',
      rating: i?.rating || null,
      year: (i?.releaseDate || '').slice(0, 4) || null,
      genre: i?.genre || '',
      seasons,
      subtitles,
    }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message || 'Series info error' }, { status: 500 });
  }
}

export async function GET(req, ctx) { return handle(req, ctx); }
export async function POST(req, ctx) { return handle(req, ctx); }
