'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Protected from '../../../../components/Protected';
import { useSession } from '../../../../components/SessionProvider';
import VideoPlayer from '../../../../components/VideoPlayer';

function parseCreds(streamBase) {
  const u = new URL(streamBase);
  const p = u.pathname.split('/').filter(Boolean);
  const i = p.indexOf('live');
  return { username: p[i + 1], password: p[i + 2] };
}

async function readJsonSafe(res) {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: (text || '').slice(0, 200) || 'Invalid response' };
  }
}

export default function WatchLivePage() {
  const { session, setServerOrigin } = useSession();
  const params = useParams();
  const id = params?.id;
  const q = useSearchParams();
  const auto = q.get('auto') === '1';

  const [channel, setChannel] = useState(null);
  const [err, setErr] = useState('');
  const [servers, setServers] = useState([]);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/auth/health');
        const d = await readJsonSafe(r);
        const list = (d?.servers || []).map((u, i) => ({ label: `Server ${i + 1}`, origin: new URL(u).origin }));
        setServers(list);
        if (!origin && list.length) setOrigin(list[0].origin);
      } catch {}
    })();
  }, [origin]);

  useEffect(() => {
    if (!session?.streamBase || !servers.length) return;
    try {
      const o = new URL(session.streamBase).origin;
      const found = servers.find((s) => s.origin === o);
      if (found) setOrigin(found.origin);
    } catch {}
  }, [session?.streamBase, servers]);

  const hlsUpstream = useMemo(() => {
    if (!session?.streamBase || !id || !origin) return '';
    const { username, password } = parseCreds(session.streamBase);
    return `${origin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.m3u8`;
  }, [session?.streamBase, id, origin]);

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
          mp4=""
          hls={hlsUpstream}
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
          activeOrigin={origin}
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
