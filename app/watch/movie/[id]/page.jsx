'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Protected from '../../../../components/Protected';
import { useSession } from '../../../../components/SessionProvider';
import VideoPlayer from '../../../../components/VideoPlayer';
import { readJsonSafe } from '../../../../lib/readJsonSafe';

function parseCreds(streamBase) {
  const u = new URL(streamBase);
  const p = u.pathname.split('/').filter(Boolean);
  const i = p.indexOf('live');
  return { username: p[i + 1], password: p[i + 2] };
}

export default function WatchMovie() {
  const { session, setServerOrigin } = useSession();
  const { id } = useParams();
  const q = useSearchParams();
  const auto = q.get('auto') === '1';

  const [servers, setServers] = useState([]);
  const [origin, setOrigin] = useState('');
  const [ext, setExt] = useState(null);
  const [meta, setMeta] = useState({
    id,
    type: 'movie',
    title: `Movie #${id}`,
    image: '',
    year: null,
    genre: null,
    plot: '',
    duration: null,
    backHref: id ? `/movies/${id}` : '/movies',
  });
  const [subs, setSubs] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/health');
        const d = await readJsonSafe(r);
        const list = (d?.servers || []).map((u, i) => ({ label:`Server ${i+1}`, origin:new URL(u).origin }));
        setServers(list);
        if (!origin && list.length) setOrigin(list[0].origin);
      } catch {}
    })();
  }, [origin]);

  useEffect(() => {
    if (!session?.streamBase || !servers.length) return;
    const o = new URL(session.streamBase).origin;
    const found = servers.find(s => s.origin === o);
    if (found) setOrigin(found.origin);
  }, [session?.streamBase, servers]);

  const { mp4, hls } = useMemo(() => {
    if (!session?.streamBase || !id || !origin) return { mp4:'', hls:'' };
    const { username, password } = parseCreds(session.streamBase);
    const safeExt = ext && ext.toLowerCase() !== 'm3u8' ? ext.toLowerCase() : null;
    return {
      mp4: safeExt ? `${origin}/movie/${username}/${password}/${id}.${safeExt}` : `${origin}/movie/${username}/${password}/${id}.mp4`,
      hls: `${origin}/movie/${username}/${password}/${id}.m3u8`,
    };
  }, [session?.streamBase, id, origin, ext]);

  useEffect(() => {
    if (!session?.streamBase) return;
    (async () => {
      try {
        const url = `/api/xuione/vod/${id}?streamBase=${encodeURIComponent(session.streamBase)}`;
        const r = await fetch(url);
        const d = await readJsonSafe(r);
        if (r.ok && d.ok) {
          setMeta({
            id,
            type: 'movie',
            title: d.title,
            image: d.image,
            href: `/watch/movie/${id}`,
            year: d.year || null,
            genre: d.genre || null,
            plot: d.plot || '',
            duration: d.duration || null,
            backHref: `/movies/${id}`,
          });
          setSubs(Array.isArray(d.subtitles) ? d.subtitles : []);
          setExt(d.ext || null);
        }
      } catch {}
    })();
  }, [id, session?.streamBase]);

  return (
    <Protected>
      <section className="p-0">
        <VideoPlayer
          mp4={mp4}
          hls={hls}
          preferHls={true}
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
