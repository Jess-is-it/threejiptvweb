'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Protected from '../../../../components/Protected';
import { useSession } from '../../../../components/SessionProvider';
import VideoPlayer from '../../../../components/VideoPlayer';
import { readJsonSafe } from '../../../../lib/readJsonSafe';
import { readMoviePlaySeed } from '../../../../lib/moviePlaySeed';

function parseCreds(streamBase) {
  const u = new URL(streamBase);
  const p = u.pathname.split('/').filter(Boolean);
  const i = p.indexOf('live');
  return { username: p[i + 1], password: p[i + 2] };
}

function getOriginFromStreamBase(streamBase) {
  try {
    return streamBase ? new URL(streamBase).origin : '';
  } catch {
    return '';
  }
}

function buildInitialMeta(id, seed = null) {
  return {
    id,
    type: 'movie',
    title: seed?.title || `Movie #${id}`,
    image: seed?.image || '',
    year: seed?.year || null,
    genre: seed?.genre || null,
    plot: seed?.plot || '',
    duration: seed?.duration || null,
    backHref: seed?.backHref || (id ? `/movies/${id}` : '/movies'),
  };
}

export default function WatchMovie() {
  const { session, setServerOrigin } = useSession();
  const { id } = useParams();
  const q = useSearchParams();
  const auto = q.get('auto') === '1';
  const moviePlaySeed = useMemo(() => readMoviePlaySeed(id), [id]);
  const sessionOrigin = useMemo(() => getOriginFromStreamBase(session?.streamBase), [session?.streamBase]);
  const fallbackOrigin = sessionOrigin || '';

  const [servers, setServers] = useState(() =>
    fallbackOrigin ? [{ label: 'Current server', origin: fallbackOrigin }] : []
  );
  const [origin, setOrigin] = useState(fallbackOrigin);
  const [ext, setExt] = useState(moviePlaySeed?.ext || null);
  const [meta, setMeta] = useState(() => buildInitialMeta(id, moviePlaySeed));
  const [subs, setSubs] = useState([]);

  useEffect(() => {
    setMeta(buildInitialMeta(id, moviePlaySeed));
    setExt(moviePlaySeed?.ext || null);
    setSubs([]);
  }, [id, moviePlaySeed]);

  useEffect(() => {
    if (!sessionOrigin) return;
    setOrigin((current) => current || sessionOrigin);
    setServers((current) => {
      if (current.some((row) => row.origin === sessionOrigin)) return current;
      return [{ label: 'Current server', origin: sessionOrigin }, ...current];
    });
  }, [sessionOrigin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/health', { cache: 'no-store' });
        const d = await readJsonSafe(r);
        if (cancelled) return;
        const list = (d?.servers || []).map((u, i) => ({ label:`Server ${i+1}`, origin:new URL(u).origin }));
        setServers((current) => {
          const merged = [...current];
          for (const row of list) {
            if (!row?.origin || merged.some((entry) => entry.origin === row.origin)) continue;
            merged.push(row);
          }
          return merged;
        });
        const preferred = list.find((row) => row.origin === sessionOrigin) || list[0] || null;
        if (preferred?.origin) {
          setOrigin((current) => {
            if (!current || current === sessionOrigin) return preferred.origin;
            return current;
          });
          if (preferred.origin !== sessionOrigin) setServerOrigin?.(preferred.origin);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionOrigin, setServerOrigin]);

  const playbackOrigin = origin || sessionOrigin;

  const { mp4, hls } = useMemo(() => {
    if (!session?.streamBase || !id || !playbackOrigin) return { mp4:'', hls:'' };
    const { username, password } = parseCreds(session.streamBase);
    const normalizedExt = String(ext || '').trim().toLowerCase();
    const isHlsOnly = normalizedExt === 'm3u8';
    const safeExt = normalizedExt && !isHlsOnly ? normalizedExt : null;
    return {
      mp4: isHlsOnly ? '' : safeExt ? `${playbackOrigin}/movie/${username}/${password}/${id}.${safeExt}` : `${playbackOrigin}/movie/${username}/${password}/${id}.mp4`,
      hls: isHlsOnly ? `${playbackOrigin}/movie/${username}/${password}/${id}.m3u8` : '',
    };
  }, [session?.streamBase, id, playbackOrigin, ext]);

  useEffect(() => {
    if (!session?.streamBase) return;
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/xuione/vod/${id}?streamBase=${encodeURIComponent(session.streamBase)}`;
        const r = await fetch(url);
        const d = await readJsonSafe(r);
        if (cancelled) return;
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
    return () => {
      cancelled = true;
    };
  }, [id, session?.streamBase]);

  return (
    <Protected>
      <section className="p-0">
        <VideoPlayer
          mp4={mp4}
          hls={hls}
          preferHls={false}
          meta={meta}
          mode="immersive"
          autoFullscreen={auto}
          autoPlayOnLoad={true}
          servers={servers}
          activeOrigin={playbackOrigin}
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
