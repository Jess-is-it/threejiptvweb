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

function getOriginFromStreamBase(streamBase) {
  try {
    return streamBase ? new URL(streamBase).origin : '';
  } catch {
    return '';
  }
}

function normalizeLiveExt(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^\./, '');
}

function isHlsLikeSource(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (/\.m3u8($|\?)/i.test(raw)) return true;
  try {
    const url = new URL(raw);
    const ext = normalizeLiveExt(
      url.searchParams.get('extension') || url.searchParams.get('format') || url.searchParams.get('type')
    );
    return ext === 'm3u8';
  } catch {
    return /(?:extension|format|type)=m3u8/i.test(raw);
  }
}

function sourceExtension(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const extFromQuery = normalizeLiveExt(
      url.searchParams.get('extension') || url.searchParams.get('format') || url.searchParams.get('type')
    );
    if (extFromQuery) return extFromQuery;
    const match = url.pathname.match(/\.([a-z0-9]+)$/i);
    return normalizeLiveExt(match?.[1] || '');
  } catch {
    const match = raw.match(/\.([a-z0-9]+)(?:$|\?)/i);
    return normalizeLiveExt(match?.[1] || '');
  }
}

function rebaseSourceOrigin(source = '', origin = '') {
  const rawSource = String(source || '').trim();
  const rawOrigin = String(origin || '').trim();
  if (!rawSource || !rawOrigin) return rawSource;
  try {
    const url = new URL(rawSource);
    return `${rawOrigin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawSource;
  }
}

function pickDirectSource(channel) {
  const candidates = [
    channel?.directSource,
    ...(Array.isArray(channel?.streamSources) ? channel.streamSources : []),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
  return candidates[0] || '';
}

export default function WatchLivePage() {
  const { session, setServerOrigin } = useSession();
  const params = useParams();
  const id = params?.id;
  const q = useSearchParams();
  const auto = q.get('auto') === '1';
  const sessionOrigin = useMemo(() => getOriginFromStreamBase(session?.streamBase), [session?.streamBase]);

  const [channel, setChannel] = useState(null);
  const [err, setErr] = useState('');
  const [servers, setServers] = useState(() =>
    sessionOrigin ? [{ label: 'Current server', origin: sessionOrigin }] : []
  );
  const [origin, setOrigin] = useState(sessionOrigin);

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
        const list = (d?.servers || []).map((u, i) => ({ label: `Server ${i + 1}`, origin: new URL(u).origin }));
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

  const { mp4, hls, preferHls } = useMemo(() => {
    if (!session?.streamBase || !id || !playbackOrigin) return { mp4: '', hls: '', preferHls: true };
    const { username, password } = parseCreds(session.streamBase);
    const directSource = rebaseSourceOrigin(pickDirectSource(channel), playbackOrigin);
    const directSourceIsHls = isHlsLikeSource(directSource);
    const normalizedExt = normalizeLiveExt(channel?.ext || sourceExtension(directSource) || '');
    const defaultHls = `${playbackOrigin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.m3u8`;
    const fallbackExt = normalizedExt && normalizedExt !== 'm3u8' ? normalizedExt : 'ts';
    const defaultDirect = `${playbackOrigin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${fallbackExt}`;

    if (directSource) {
      return {
        mp4: directSourceIsHls ? '' : directSource,
        hls: directSourceIsHls ? directSource : defaultHls,
        preferHls: true,
      };
    }

    return {
      mp4: normalizedExt === 'm3u8' ? '' : defaultDirect,
      hls: defaultHls,
      preferHls: true,
    };
  }, [session?.streamBase, id, playbackOrigin, channel]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!session?.streamBase || !id) return;
        const r = await fetch('/api/xuione/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamBase: session?.streamBase }),
        });
        const data = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !data.ok) throw new Error(data?.error || 'Failed to load channel');
        const ch = (data.channels || []).find((c) => String(c.id) === String(id));
        setChannel(ch || null);
      } catch (e) {
        setErr(e.message || 'Network error');
      }
    })();
    return () => { alive = false; };
  }, [session?.streamBase, id]);

  return (
    <Protected>
      <section className="p-0">
        {err ? <p className="absolute left-4 top-4 z-[90] text-sm text-red-300">{err}</p> : null}
        <VideoPlayer
          mp4={mp4}
          hls={hls}
          preferHls={preferHls}
          meta={{
            id,
            type: 'live',
            title: channel?.name || `Live #${id}`,
            image: channel?.logo || '',
            href: `/watch/live/${id}`,
            backHref: '/live',
          }}
          mode="immersive"
          servers={servers}
          activeOrigin={playbackOrigin}
          onSelectServer={(o) => {
            setOrigin(o);
            setServerOrigin?.(o);
          }}
          autoFullscreen={auto}
          autoPlayOnLoad={true}
        />
      </section>
    </Protected>
  );
}
