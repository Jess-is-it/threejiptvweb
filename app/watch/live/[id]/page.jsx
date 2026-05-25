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

function readRecentPlayIntent(maxAgeMs = 15_000) {
  if (typeof window === 'undefined') return false;
  try {
    const ts = Number(sessionStorage.getItem('3jtv.playIntent') || 0) || 0;
    return Boolean(ts && Date.now() - ts <= maxAgeMs);
  } catch {
    return false;
  }
}

function buildLivePlayback({ channel = null, id = '', streamBase = '', origin = '' } = {}) {
  const streamId = String(channel?.id || id || '').trim();
  if (!streamBase || !streamId || !origin) return { mp4: '', hls: '', preferHls: true };

  const { username, password } = parseCreds(streamBase);
  const directSource = rebaseSourceOrigin(pickDirectSource(channel), origin);
  const directSourceIsHls = isHlsLikeSource(directSource);
  const normalizedExt = normalizeLiveExt(channel?.ext || sourceExtension(directSource) || '');
  const defaultHls = `${origin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.m3u8`;
  const fallbackExt = normalizedExt && normalizedExt !== 'm3u8' ? normalizedExt : 'ts';
  const defaultDirect = `${origin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${fallbackExt}`;

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
}

export default function WatchLivePage() {
  const { session, setServerOrigin } = useSession();
  const params = useParams();
  const id = String(params?.id || '').trim();
  const q = useSearchParams();
  const auto = q.get('auto') === '1';
  const sessionOrigin = useMemo(() => getOriginFromStreamBase(session?.streamBase), [session?.streamBase]);

  const [activeId, setActiveId] = useState(id);
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [err, setErr] = useState('');
  const [startWithSound] = useState(() => readRecentPlayIntent());
  const [servers, setServers] = useState(() =>
    sessionOrigin ? [{ label: 'Current server', origin: sessionOrigin }] : []
  );
  const [origin, setOrigin] = useState(sessionOrigin);

  useEffect(() => {
    setActiveId(id);
  }, [id]);

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

  const channel = useMemo(
    () => (channels || []).find((c) => String(c?.id || '').trim() === String(activeId || '').trim()) || null,
    [activeId, channels]
  );

  const { mp4, hls, preferHls } = useMemo(() => {
    return buildLivePlayback({
      channel,
      id: activeId,
      streamBase: session?.streamBase,
      origin: playbackOrigin,
    });
  }, [activeId, session?.streamBase, playbackOrigin, channel]);

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
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setChannels(Array.isArray(data.channels) ? data.channels : []);
      } catch (e) {
        setErr(e.message || 'Network error');
      }
    })();
    return () => { alive = false; };
  }, [session?.streamBase, id]);

  const menuNavigation = useMemo(() => {
    const currentId = String(activeId || '').trim();
    if (!currentId || !session?.streamBase || !playbackOrigin) return null;

    const visibleChannels = (Array.isArray(channels) ? channels : []).filter((row) => row?.isUp !== false);
    const byCategory = new Map();
    for (const ch of visibleChannels) {
      const categoryId = String(ch?.category_id ?? '').trim() || 'UNCAT';
      const list = byCategory.get(categoryId);
      if (list) list.push(ch);
      else byCategory.set(categoryId, [ch]);
    }

    const groups = [];
    const seen = new Set();
    for (const category of Array.isArray(categories) ? categories : []) {
      const categoryId = String(category?.id ?? '').trim();
      if (!categoryId || seen.has(categoryId)) continue;
      seen.add(categoryId);
      const rows = byCategory.get(categoryId) || [];
      if (!rows.length) continue;
      groups.push({
        id: categoryId,
        title: String(category?.name || '').trim() || `Category ${categoryId}`,
        items: rows.map((ch) => ({
          id: String(ch?.id || '').trim(),
          title: String(ch?.name || '').trim() || 'Channel',
          image: String(ch?.logo || '').trim(),
          ...buildLivePlayback({
            channel: ch,
            streamBase: session.streamBase,
            origin: playbackOrigin,
          }),
        })),
      });
    }

    for (const [categoryId, rows] of byCategory.entries()) {
      if (seen.has(categoryId) || !rows.length) continue;
      groups.push({
        id: categoryId,
        title: categoryId === 'UNCAT' ? 'Other' : `Category ${categoryId}`,
        items: rows.map((ch) => ({
          id: String(ch?.id || '').trim(),
          title: String(ch?.name || '').trim() || 'Channel',
          image: String(ch?.logo || '').trim(),
          ...buildLivePlayback({
            channel: ch,
            streamBase: session.streamBase,
            origin: playbackOrigin,
          }),
        })),
      });
    }

    const normalizedGroups = groups
      .map((group) => ({
        ...group,
        items: (Array.isArray(group.items) ? group.items : []).filter((item) => item.id),
      }))
      .filter((group) => group.items.length);

    const flat = normalizedGroups.flatMap((group) =>
      group.items.map((item) => ({ ...item, groupId: group.id, groupTitle: group.title }))
    );
    const idx = flat.findIndex((item) => String(item?.id || '').trim() === currentId);
    const previousItem = flat.length ? flat[(idx > 0 ? idx - 1 : flat.length - 1)] : null;
    const nextItem = flat.length ? flat[(idx >= 0 ? idx + 1 : 0) % flat.length] : null;

    return {
      switchMode: 'parent',
      groupLabel: 'Categories',
      itemLabel: 'Channels',
      groups: normalizedGroups,
      currentItemId: currentId,
      previousItem,
      nextItem,
      onSelectItem: (item) => {
        const nextId = String(item?.id || '').trim();
        if (!nextId) return;
        try {
          sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
        } catch {}
        setActiveId(nextId);
        try {
          window.history.replaceState(window.history.state, '', `/watch/live/${encodeURIComponent(nextId)}?auto=1`);
        } catch {}
      },
    };
  }, [activeId, categories, channels, playbackOrigin, session?.streamBase]);

  return (
    <Protected>
      <section className="p-0">
        {err ? <p className="absolute left-4 top-4 z-[90] text-sm text-red-300">{err}</p> : null}
        <VideoPlayer
          mp4={mp4}
          hls={hls}
          preferHls={preferHls}
          meta={{
            id: activeId,
            type: 'live',
            title: channel?.name || `Live #${activeId}`,
            image: channel?.logo || '',
            href: `/watch/live/${activeId}`,
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
          startMuted={startWithSound ? false : undefined}
          autoUnmuteOnLoad={startWithSound}
          menuNavigation={menuNavigation}
        />
      </section>
    </Protected>
  );
}
