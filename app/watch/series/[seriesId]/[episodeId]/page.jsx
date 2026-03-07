'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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
  const { seriesId, episodeId } = useParams();
  const { session, setServerOrigin } = useSession();
  const q = useSearchParams();
  const auto = q.get('auto') === '1';

  const [servers, setServers] = useState([]);
  const [origin, setOrigin] = useState('');
  const [meta, setMeta] = useState({
    id: episodeId,
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
    if (!session?.streamBase || !servers.length) return;
    const o = new URL(session.streamBase).origin;
    const found = servers.find((s) => s.origin === o);
    if (found) setOrigin(found.origin);
  }, [session?.streamBase, servers]);

  // Fetch series info → set title/poster and discover the episode extension
  useEffect(() => {
    if (!session?.streamBase) return;
    (async () => {
      try {
        const url = `/api/xuione/series/${seriesId}?streamBase=${encodeURIComponent(
          session.streamBase
        )}`;
        const r = await fetch(url);
        const d = await readJsonSafe(r);
        if (r.ok && d.ok) {
          const all =
            d?.seasons?.flatMap((s) =>
              s.episodes.map((e) => ({ ...e, season: s.season }))
            ) || [];
          const ep = all.find((x) => String(x.id) === String(episodeId));
          const title = ep
            ? `S${ep.season}E${ep.episode} — ${ep.title}`
            : d.title || 'Episode';
          setMeta({
            id: episodeId,
            type: 'series',
            title,
            image: d.image,
            href: `/watch/series/${seriesId}/${episodeId}`,
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
          // Subtitles (per-episode is not standardized in Xuione; leaving empty)
          setSubs([]);
        }
      } catch {}
    })();
  }, [seriesId, episodeId, session?.streamBase]);

  // Build playback URLs (MP4-first using discovered extension; HLS as fallback)
  const { mp4, hls } = useMemo(() => {
    if (!session?.streamBase || !episodeId || !origin) return { mp4: '', hls: '' };
    const { username, password } = parseCreds(session.streamBase);

    // if panel says "m3u8" we shouldn't try file container; use HLS only
    const safeExt = ext && ext.toLowerCase() !== 'm3u8' ? ext.toLowerCase() : null;

    return {
      mp4: safeExt ? `${origin}/series/${username}/${password}/${episodeId}.${safeExt}` : '',
      hls: `${origin}/series/${username}/${password}/${episodeId}.m3u8`,
    };
  }, [session?.streamBase, episodeId, origin, ext]);

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
        />
      </section>
    </Protected>
  );
}
