'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { flushSync } from 'react-dom';
import Protected from '../../../../../components/Protected';
import { useSession } from '../../../../../components/SessionProvider';
import VideoPlayer from '../../../../../components/VideoPlayer';
import { readJsonSafe } from '../../../../../lib/readJsonSafe';

function parseCreds(streamBase) {
  const u = new URL(streamBase);
  const p = u.pathname.split('/').filter(Boolean);
  const i = p.indexOf('live');
  return { username: p[i + 1], password: p[i + 2] };
}

export default function WatchSeries() {
  const { seriesId, episodeId: routeEpisodeId } = useParams();
  const { session, setServerOrigin } = useSession();
  const q = useSearchParams();
  const auto = q.get('auto') === '1';
  const queryString = q?.toString() || '';
  const initialEpisodeId = String(routeEpisodeId || '').trim();

  const [servers, setServers] = useState([]);
  const [origin, setOrigin] = useState('');
  const [activeEpisodeId, setActiveEpisodeId] = useState(initialEpisodeId);
  const [seriesNavData, setSeriesNavData] = useState({ title: '', seasons: [] });
  const [meta, setMeta] = useState({
    id: initialEpisodeId,
    type: 'series',
    title: 'Episode',
    image: '',
    href: '',
    year: null,
    genre: null,
    plot: '',
    seasonNumber: null,
    episodeNumber: null,
    seriesId,
    backHref: seriesId ? `/series/${seriesId}` : '/series',
  });
  const [subs, setSubs] = useState([]);
  const [ext, setExt] = useState(null); // <- container extension per episode
  const [episodeInfoReady, setEpisodeInfoReady] = useState(false);

  useEffect(() => {
    const nextRouteEpisodeId = String(routeEpisodeId || '').trim();
    if (!nextRouteEpisodeId) return;
    if (nextRouteEpisodeId !== activeEpisodeId) {
      setEpisodeInfoReady(false);
      setExt(null);
      setSubs([]);
    }
    setActiveEpisodeId((current) => (current === nextRouteEpisodeId ? current : nextRouteEpisodeId));
  }, [activeEpisodeId, routeEpisodeId]);

  // Load available servers
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/health');
        const d = await readJsonSafe(r);
        const list = (d?.servers || []).map((u, i) => ({
          label: `Server ${i + 1}`,
          origin: new URL(u).origin,
        }));
        setServers(list);
        if (!origin && list.length) setOrigin(list[0].origin);
      } catch {}
    })();
  }, [origin]);

  // Prefer the session's server
  useEffect(() => {
    if (!servers.length) return;
    let currentOrigin = '';
    try {
      currentOrigin = session?.streamBase ? new URL(session.streamBase).origin : '';
    } catch {}
    const preferred = servers.find((row) => row.origin === currentOrigin) || servers[0];
    if (preferred?.origin && preferred.origin !== origin) setOrigin(preferred.origin);
    if (preferred?.origin && preferred.origin !== currentOrigin) setServerOrigin?.(preferred.origin);
  }, [origin, session?.streamBase, servers, setServerOrigin]);

  // Fetch series info → set title/poster and discover the episode extension
  useEffect(() => {
    if (!session?.streamBase || !activeEpisodeId) {
      setEpisodeInfoReady(false);
      return;
    }
    let cancelled = false;
    setEpisodeInfoReady(false);
    (async () => {
      try {
        const url = `/api/xuione/series/${seriesId}?streamBase=${encodeURIComponent(
          session.streamBase
        )}&episodeId=${encodeURIComponent(activeEpisodeId)}`;
        const r = await fetch(url);
        const d = await readJsonSafe(r);
        if (cancelled) return;
        if (r.ok && d.ok) {
          const normalizedSeasons = (Array.isArray(d?.seasons) ? d.seasons : [])
            .map((season) => {
              const seasonNumber = Number(season?.season || 0);
              const episodes = (Array.isArray(season?.episodes) ? season.episodes : [])
                .map((episode) => ({
                  id: String(episode?.id || ''),
                  seasonNumber,
                  episodeNumber: Number(episode?.episode || 0),
                  title: String(episode?.title || `Episode ${episode?.episode || ''}`).trim(),
                  image: episode?.image || d.image || '',
                  duration: episode?.duration || null,
                  airdate: episode?.airdate || null,
                  ext: episode?.ext || null,
                }))
                .filter((episode) => episode.id && Number.isFinite(episode.episodeNumber) && episode.episodeNumber > 0)
                .sort((left, right) => left.episodeNumber - right.episodeNumber);

              return {
                seasonNumber,
                episodes,
              };
            })
            .filter((season) => Number.isFinite(season.seasonNumber) && season.seasonNumber > 0 && season.episodes.length > 0)
            .sort((left, right) => left.seasonNumber - right.seasonNumber);

          const all =
            normalizedSeasons.flatMap((season) =>
              season.episodes.map((episode) => ({
                ...episode,
                season: season.seasonNumber,
                episode: episode.episodeNumber,
              }))
            ) || [];
          const ep = all.find((x) => String(x.id) === String(activeEpisodeId));
          const title = ep
            ? `S${ep.season}E${ep.episode} — ${ep.title}`
            : d.title || 'Episode';

          setSeriesNavData({
            title: String(d?.title || 'Series').trim(),
            seasons: normalizedSeasons,
          });
          setMeta({
            id: activeEpisodeId,
            type: 'series',
            title,
            image: d.image,
            href: `/watch/series/${seriesId}/${activeEpisodeId}`,
            year: d.year || null,
            genre: d.genre || null,
            plot: d.plot || '',
            seasonNumber: ep?.season ? Number(ep.season) : null,
            episodeNumber: ep?.episode ?? null,
            seriesId,
            backHref: `/series/${seriesId}`,
          });
          // ✅ store container extension if present (mkv/mp4/avi/…)
          setExt(ep?.ext || null);
          setSubs(Array.isArray(d?.subtitles) ? d.subtitles : []);
        }
      } catch {
      } finally {
        if (!cancelled) setEpisodeInfoReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesId, activeEpisodeId, session?.streamBase]);

  const seriesNavigation = useMemo(() => {
    const seasons = Array.isArray(seriesNavData?.seasons) ? seriesNavData.seasons : [];
    const currentSeason =
      seasons.find((season) => season.episodes.some((episode) => String(episode.id) === String(activeEpisodeId))) || null;
    const currentEpisode =
      currentSeason?.episodes.find((episode) => String(episode.id) === String(activeEpisodeId)) || null;

    let nextEpisode = null;
    if (currentSeason && currentEpisode) {
      const currentIndex =
        currentSeason.episodes.findIndex((episode) => String(episode.id) === String(activeEpisodeId));
      if (currentIndex >= 0 && currentIndex + 1 < currentSeason.episodes.length) {
        nextEpisode = {
          ...currentSeason.episodes[currentIndex + 1],
          nextSeasonStart: false,
        };
      } else {
        const nextSeason = seasons.find((season) => season.seasonNumber > currentSeason.seasonNumber && season.episodes.length > 0);
        if (nextSeason) {
          nextEpisode = {
            ...nextSeason.episodes[0],
            nextSeasonStart: true,
          };
        }
      }
    }

    return {
      seriesId: String(seriesId || ''),
      seriesTitle: String(seriesNavData?.title || meta?.title || 'Series').trim(),
      seasons,
      currentSeasonNumber: currentSeason?.seasonNumber || meta?.seasonNumber || null,
      currentEpisodeId: String(activeEpisodeId || ''),
      currentEpisodeNumber: currentEpisode?.episodeNumber || meta?.episodeNumber || null,
      nextEpisode,
    };
  }, [
    seriesId,
    activeEpisodeId,
    meta?.title,
    meta?.seasonNumber,
    meta?.episodeNumber,
    seriesNavData,
  ]);

  const navigateToEpisode = useCallback(
    (episode) => {
      const targetId = String(episode?.id || '').trim();
      if (!targetId || !seriesId || targetId === String(activeEpisodeId)) return;
      const nextSeasonNumber = Number(episode?.seasonNumber || 0) || null;
      const nextEpisodeNumber = Number(episode?.episodeNumber || 0) || null;
      const nextTitle = String(
        episode?.title || (nextEpisodeNumber ? `Episode ${nextEpisodeNumber}` : 'Episode')
      ).trim();
      try {
        sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
      } catch {}
      const targetUrl = `/watch/series/${seriesId}/${targetId}${queryString ? `?${queryString}` : ''}`;
      flushSync(() => {
        setEpisodeInfoReady(false);
        setExt(episode?.ext || null);
        setMeta((current) => ({
          ...current,
          id: targetId,
          title:
            nextSeasonNumber && nextEpisodeNumber
              ? `S${nextSeasonNumber}E${nextEpisodeNumber} — ${nextTitle}`
              : nextTitle || current.title,
          image: episode?.image || current.image || '',
          href: `/watch/series/${seriesId}/${targetId}`,
          seasonNumber: nextSeasonNumber,
          episodeNumber: nextEpisodeNumber,
          seriesId,
          backHref: `/series/${seriesId}`,
        }));
        setSubs([]);
        setActiveEpisodeId(targetId);
      });
      try {
        window.history.replaceState(window.history.state, '', targetUrl);
      } catch {}
    },
    [activeEpisodeId, queryString, seriesId]
  );

  // Build playback URLs only after the episode metadata request has had a chance
  // to discover the real container extension. Starting with a guessed .m3u8 URL
  // causes a recoverable 404/unsupported-source flash on panels without series HLS.
  const { mp4, hls } = useMemo(() => {
    if (!episodeInfoReady || !session?.streamBase || !activeEpisodeId || !origin) return { mp4: '', hls: '' };
    const { username, password } = parseCreds(session.streamBase);

    const normalizedExt = String(ext || '').trim().toLowerCase();
    const isHlsOnly = normalizedExt === 'm3u8';
    const safeExt = normalizedExt && !isHlsOnly ? normalizedExt : 'mp4';

    return {
      mp4: isHlsOnly ? '' : `${origin}/series/${username}/${password}/${activeEpisodeId}.${safeExt}`,
      hls: isHlsOnly ? `${origin}/series/${username}/${password}/${activeEpisodeId}.m3u8` : '',
    };
  }, [episodeInfoReady, session?.streamBase, activeEpisodeId, origin, ext]);

  return (
    <Protected>
      <section className="p-0">
        <VideoPlayer
          mp4={mp4}                 // uses proper container (mkv/mp4/…)
          hls={hls}
          meta={meta}
          mode="immersive"
          autoFullscreen={auto}
          autoPlayOnLoad={true}
          servers={servers}
          activeOrigin={origin}
          onSelectServer={(o) => {
            setOrigin(o);
            setServerOrigin?.(o);
          }}
          subtitles={subs}
          seriesNavigation={{
            ...seriesNavigation,
            onSelectEpisode: navigateToEpisode,
          }}
        />
      </section>
    </Protected>
  );
}
