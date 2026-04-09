'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import ChannelCard from '../../components/ChannelCard';
import VideoPlayer from '../../components/VideoPlayer';

const LIVE_REFRESH_MS = 15_000;

async function readJsonSafe(res) {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: (text || '').slice(0, 200) || 'Invalid response' };
  }
}

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

function normalizeUsername(v) {
  return String(v || '').trim().toLowerCase();
}

function pinsKey({ username = '', origin = '' } = {}) {
  const u = normalizeUsername(username) || 'anon';
  const o = String(origin || '').trim() || 'origin';
  return `3jtv.livePins:${u}:${o}`;
}

function restartsKey({ username = '', origin = '' } = {}) {
  const u = normalizeUsername(username) || 'anon';
  const o = String(origin || '').trim() || 'origin';
  return `3jtv.liveRestarts:${u}:${o}`;
}

function downKey({ username = '', origin = '' } = {}) {
  const u = normalizeUsername(username) || 'anon';
  const o = String(origin || '').trim() || 'origin';
  return `3jtv.liveDown:${u}:${o}`;
}

function lastHeroKey({ username = '', origin = '' } = {}) {
  const u = normalizeUsername(username) || 'anon';
  const o = String(origin || '').trim() || 'origin';
  return `3jtv.liveLastHero:${u}:${o}`;
}

function readJsonStorage(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function normalizePinnedIds(value) {
  const rows = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  for (const raw of rows) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeDownMap(value) {
  const obj = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const id = String(k || '').trim();
    const ts = Number(v || 0) || 0;
    if (!id || ts <= 0) continue;
    out[id] = ts;
  }
  return out;
}

function normalizeRestartMap(value) {
  const obj = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const id = String(k || '').trim();
    const n = Number(v || 0);
    if (!id || !Number.isFinite(n) || n < 0) continue;
    out[id] = Math.floor(n);
  }
  return out;
}

function shouldHideDown({ downAt = 0, nowTs = Date.now(), ttlMs = 20 * 60 * 1000 } = {}) {
  const ts = Number(downAt || 0) || 0;
  if (!ts) return false;
  return nowTs - ts < ttlMs;
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

function uptimeSecondsOf(channel) {
  const n = Number(channel?.uptimeSeconds);
  // Treat 0 as unknown: some catalogs don't provide real uptime.
  return Number.isFinite(n) && n > 0 ? n : -1;
}

export default function LivePage() {
  const { session } = useSession();
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selCat, setSelCat] = useState('ALL');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const heroWrapRef = useRef(null);
  const username = String(session?.user?.username || '').trim();
  const sessionOrigin = useMemo(() => getOriginFromStreamBase(session?.streamBase), [session?.streamBase]);

  const [pinnedIds, setPinnedIds] = useState([]);
  const [restartMap, setRestartMap] = useState({});
  const [downMap, setDownMap] = useState({});
  const [heroId, setHeroId] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroFs, setHeroFs] = useState(false);
  const [heroMsg, setHeroMsg] = useState('');
  const servers = useMemo(() => (sessionOrigin ? [{ label: 'Current server', origin: sessionOrigin }] : []), [sessionOrigin]);

  useEffect(() => {
    if (!session?.streamBase) {
      setLoading(false);
      return;
    }
    let alive = true;
    let intervalId = null;
    let ctrl = null;

    const load = async ({ silent = false } = {}) => {
      if (silent && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        if (!silent) setLoading(true);
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        const r = await fetch('/api/xuione/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          signal: ctrl.signal,
          // Probing every channel on a tight polling loop is expensive and can destabilize the server.
          // We rely on XUI status/pid + player error handling instead.
          body: JSON.stringify({ streamBase: session?.streamBase, probe: false, fresh: true }),
        });
        const data = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !data.ok) throw new Error(data?.error || 'Failed to load live channels');
        // Apply the latest list immediately so stopped streams disappear and the count updates
        // even while the hero player is active.
        setCategories([{ id: 'ALL', name: 'All' }, ...(data.categories || [])]);
        setChannels(Array.isArray(data.channels) ? data.channels : []);
        if (!silent) setErr('');
      } catch (e) {
        // Avoid wiping the list on background refresh failures.
        if (!silent) setErr(e.message || 'Network error');
      } finally {
        if (alive && !silent) setLoading(false);
      }
    };

    load({ silent: false });
    // Background refresh is intentionally conservative; aggressive polling was destabilizing the server
    // while the user was already watching the active channel.
    intervalId = setInterval(() => load({ silent: true }), LIVE_REFRESH_MS);

    return () => {
      alive = false;
      if (intervalId) clearInterval(intervalId);
      if (ctrl) ctrl.abort();
    };
  }, [session?.streamBase]);

  useEffect(() => {
    if (!username || !sessionOrigin) return;
    const pins = normalizePinnedIds(readJsonStorage(pinsKey({ username, origin: sessionOrigin }), []));
    const restarts = normalizeRestartMap(readJsonStorage(restartsKey({ username, origin: sessionOrigin }), {}));
    const down = normalizeDownMap(readJsonStorage(downKey({ username, origin: sessionOrigin }), {}));
    setPinnedIds(pins);
    setRestartMap(restarts);
    setDownMap(down);

    const lastHero = String(readJsonStorage(lastHeroKey({ username, origin: sessionOrigin }), '') || '').trim();
    if (lastHero) setHeroId((current) => (String(current || '').trim() ? current : lastHero));
  }, [username, sessionOrigin]);

  useEffect(() => {
    const id = String(heroId || '').trim();
    if (!id || !username || !sessionOrigin) return;
    writeJsonStorage(lastHeroKey({ username, origin: sessionOrigin }), id);
  }, [heroId, username, sessionOrigin]);

  useEffect(() => {
    const onFs = () => setHeroFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    onFs();
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const isDownHidden = (id) => {
    const downAt = downMap?.[String(id || '').trim()] || 0;
    return shouldHideDown({ downAt });
  };

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out = channels.filter((c) => {
      if (c?.isUp === false) return false;
      if (isDownHidden(c?.id)) return false;
      const okCat = selCat === 'ALL' ? true : String(c.category_id) === String(selCat);
      const okQ = !ql ? true : (c.name || '').toLowerCase().includes(ql);
      return okCat && okQ;
    });
    // Default Live view should be stable and helpful: pinned first, then longest uptime.
    if (selCat === 'ALL') {
      const pinnedSet = new Set(pinnedIds.map((id) => String(id || '').trim()).filter(Boolean));
      out.sort((a, b) => {
        const ida = String(a?.id || '').trim();
        const idb = String(b?.id || '').trim();
        const pa = pinnedSet.has(ida);
        const pb = pinnedSet.has(idb);
        if (pa !== pb) return pa ? -1 : 1;
        const ua = uptimeSecondsOf(a);
        const ub = uptimeSecondsOf(b);
        if (ua >= 0 && ub >= 0 && ua !== ub) return ub - ua;
        // Heuristic uptime ordering: on the XUI host, older running processes tend to have smaller PIDs.
        const pida = Number(a?.xuiPid);
        const pidb = Number(b?.xuiPid);
        if (Number.isFinite(pida) && Number.isFinite(pidb) && pida !== pidb) return pida - pidb;
        const na = Number(a?.number || 0) || 0;
        const nb = Number(b?.number || 0) || 0;
        if (na && nb && na !== nb) return na - nb;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });
    }
    return out;
  }, [channels, selCat, q, downMap, pinnedIds]);

  const heroList = useMemo(() => {
    const base = channels.filter((c) => c?.isUp !== false).filter((c) => !isDownHidden(c?.id));
    const byId = new Map(base.map((c) => [String(c?.id || '').trim(), c]));
    const pins = pinnedIds.map((id) => byId.get(String(id || '').trim())).filter(Boolean);
    const pinnedSet = new Set(pins.map((c) => String(c?.id || '').trim()));
    const rest = base
      .filter((c) => !pinnedSet.has(String(c?.id || '').trim()))
      .sort((a, b) => {
        const ua = uptimeSecondsOf(a);
        const ub = uptimeSecondsOf(b);
        if (ua >= 0 && ub >= 0 && ua !== ub) return ub - ua;
        const pida = Number(a?.xuiPid);
        const pidb = Number(b?.xuiPid);
        if (Number.isFinite(pida) && Number.isFinite(pidb) && pida !== pidb) return pida - pidb;
        const ra = restartMap?.[String(a?.id || '').trim()] ?? 0;
        const rb = restartMap?.[String(b?.id || '').trim()] ?? 0;
        if (ra !== rb) return ra - rb;
        const na = Number(a?.number || 0) || 0;
        const nb = Number(b?.number || 0) || 0;
        if (na && nb && na !== nb) return na - nb;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
    return [...pins, ...rest];
  }, [channels, pinnedIds, restartMap, downMap]);

  useEffect(() => {
    if (!heroList.length) {
      setHeroId('');
      setHeroIndex(0);
      return;
    }
    // If the current hero is missing (filtered out), pick a new one.
    const wanted = String(heroId || '').trim();
    const idx = wanted ? heroList.findIndex((c) => String(c?.id || '').trim() === wanted) : -1;
    const nextIdx = idx >= 0 ? idx : 0;
    setHeroIndex(nextIdx);
    setHeroId(String(heroList[nextIdx]?.id || '').trim());
  }, [heroList, heroId]);

  const activeHero = heroList.length ? heroList[Math.min(heroList.length - 1, Math.max(0, heroIndex))] : null;
  const heroPinned = activeHero ? pinnedIds.includes(String(activeHero?.id || '').trim()) : false;

  // Keep meta stable across background refreshes; VideoPlayer re-attaches its media pipeline when `meta` changes.
  const playerMeta = useMemo(() => {
    const id = String(activeHero?.id || '').trim();
    if (!id) {
      return {
        id: '',
        type: 'live',
        title: 'Live',
        image: '',
        href: '/live',
        backHref: '/live',
      };
    }
    return {
      id,
      type: 'live',
      title: activeHero?.name || `Live #${id}`,
      image: activeHero?.logo || '',
      href: `/watch/live/${id}`,
      backHref: '/live',
    };
  }, [activeHero?.id, activeHero?.name, activeHero?.logo]);

  const playback = useMemo(() => {
    if (!session?.streamBase || !activeHero?.id || !sessionOrigin) return { mp4: '', hls: '', preferHls: true };
    const { username: u, password: p } = parseCreds(session.streamBase);
    const directSource = rebaseSourceOrigin(pickDirectSource(activeHero), sessionOrigin);
    const directIsHls = isHlsLikeSource(directSource);
    const normalizedExt = normalizeLiveExt(activeHero?.ext || sourceExtension(directSource) || '');
    const defaultHls = `${sessionOrigin}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${activeHero.id}.m3u8`;
    const fallbackExt = normalizedExt && normalizedExt !== 'm3u8' ? normalizedExt : 'ts';
    const defaultDirect = `${sessionOrigin}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${activeHero.id}.${fallbackExt}`;

    if (directSource) {
      return { mp4: directIsHls ? '' : directSource, hls: directIsHls ? directSource : defaultHls, preferHls: true };
    }
    return { mp4: normalizedExt === 'm3u8' ? '' : defaultDirect, hls: defaultHls, preferHls: true };
  }, [session?.streamBase, sessionOrigin, activeHero?.id, activeHero?.ext, activeHero?.directSource, activeHero?.streamSources]);

  const setHeroById = (id) => {
    const wanted = String(id || '').trim();
    if (!wanted) return;
    const idx = heroList.findIndex((c) => String(c?.id || '').trim() === wanted);
    if (idx < 0) return;
    setHeroIndex(idx);
    setHeroId(wanted);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {}
  };

  const togglePinned = (channel) => {
    const id = String(channel?.id || '').trim();
    if (!id || !username || !sessionOrigin) return;
    setPinnedIds((current) => {
      const exists = current.includes(id);
      const next = exists ? current.filter((x) => x !== id) : [...current, id];
      const normalized = normalizePinnedIds(next);
      writeJsonStorage(pinsKey({ username, origin: sessionOrigin }), normalized);
      return normalized;
    });
  };

  const bumpRestart = (id) => {
    const cid = String(id || '').trim();
    if (!cid || !username || !sessionOrigin) return;
    setRestartMap((current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      next[cid] = Math.min(9999, (Number(next[cid] || 0) || 0) + 1);
      writeJsonStorage(restartsKey({ username, origin: sessionOrigin }), next);
      return next;
    });
  };

  const markDown = (id) => {
    const cid = String(id || '').trim();
    if (!cid || !username || !sessionOrigin) return;
    setDownMap((current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      next[cid] = Date.now();
      writeJsonStorage(downKey({ username, origin: sessionOrigin }), next);
      return next;
    });
  };

  const goNext = (dir) => {
    if (!heroList.length) return;
    const n = heroList.length;
    let i = heroIndex;
    for (let step = 0; step < n; step += 1) {
      i = (i + (dir > 0 ? 1 : -1) + n) % n;
      const candidate = heroList[i];
      if (!candidate) continue;
      if (candidate?.isUp === false) continue;
      if (isDownHidden(candidate?.id)) continue;
      setHeroIndex(i);
      setHeroId(String(candidate?.id || '').trim());
      return;
    }
  };

  const toggleFullscreen = async () => {
    const el = heroWrapRef.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (el?.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch {}
  };

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        <h1 className="mb-4 text-2xl font-bold">Live</h1>
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
          {/* Hero */}
          <div
            ref={heroWrapRef}
            className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-black"
            style={{ height: '56vh' }}
          >
            {activeHero ? (
              <>
                <VideoPlayer
                  key={`hero-${String(activeHero?.id || '')}`}
                  mp4={playback.mp4}
                  hls={playback.hls}
                  preferHls={playback.preferHls}
                  meta={playerMeta}
                  mode="inline"
                  autoPlayOnLoad={true}
                  autoFullscreen={false}
                  servers={servers}
                  activeOrigin={sessionOrigin}
                  onPlaybackError={({ code }) => {
                    bumpRestart(activeHero?.id);
                    // If it's truly unsupported/offline, mark it down and advance.
                    if (Number(code || 0) === 4) {
                      markDown(activeHero?.id);
                      setHeroMsg(`Channel seems down. Switching…`);
                      setTimeout(() => setHeroMsg(''), 2500);
                      goNext(1);
                    }
                  }}
                />

                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
                  <div className="max-w-xl">
                    <div className="text-xs uppercase tracking-wide text-white/70">Now Playing</div>
                    <div className="mt-1 line-clamp-2 text-2xl font-extrabold text-white sm:text-3xl">
                      {activeHero?.name || 'Live Channel'}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/75">
                      {activeHero?.number ? <span className="rounded bg-white/10 px-2 py-1">#{activeHero.number}</span> : null}
                      {Number.isFinite(Number(restartMap?.[String(activeHero?.id || '').trim()] ?? 0)) ? (
                        <span className="rounded bg-white/10 px-2 py-1">
                          Restarts: {restartMap?.[String(activeHero?.id || '').trim()] ?? 0}
                        </span>
                      ) : null}
                      {heroMsg ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-100">{heroMsg}</span> : null}
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="absolute left-3 top-1/2 z-20 -translate-y-1/2">
                  <button
                    type="button"
                    onClick={() => goNext(-1)}
                    className="rounded-full border border-white/15 bg-black/55 p-3 text-white hover:bg-black/70"
                    aria-label="Previous channel"
                    title="Previous"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>
                </div>
                <div className="absolute right-3 top-1/2 z-20 -translate-y-1/2">
                  <button
                    type="button"
                    onClick={() => goNext(1)}
                    className="rounded-full border border-white/15 bg-black/55 p-3 text-white hover:bg-black/70"
                    aria-label="Next channel"
                    title="Next"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </button>
                </div>
                <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => togglePinned(activeHero)}
                    className="rounded-lg border border-white/15 bg-black/55 px-3 py-2 text-xs font-semibold text-white hover:bg-black/70"
                    title={heroPinned ? 'Unpin from hero' : 'Pin to hero'}
                  >
                    {heroPinned ? 'Pinned' : 'Pin'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="rounded-lg border border-white/15 bg-black/55 px-3 py-2 text-xs font-semibold text-white hover:bg-black/70"
                    title={heroFs ? 'Exit fullscreen' : 'Fullscreen'}
                  >
                    {heroFs ? 'Exit FS' : 'Fullscreen'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/70">
                {loading ? 'Loading channels…' : 'No live channels available.'}
              </div>
            )}
          </div>

          {/* Right: Channel list */}
          <aside className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/40" style={{ height: '56vh' }}>
            <div className="flex h-full flex-col">
              <div className="border-b border-neutral-800 p-3">
                <div className="text-sm font-semibold text-neutral-100">Channels</div>
                <div className="mt-2 no-scrollbar flex gap-2 overflow-x-auto pb-1">
                  {categories.map((c) => {
                    const active = String(selCat) === String(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelCat(String(c.id))}
                        className={
                          'whitespace-nowrap rounded-full border px-3 py-1 text-xs transition ' +
                          (active
                            ? 'border-white bg-white text-black'
                            : 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500')
                        }
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search channel..."
                    className="w-full rounded-lg bg-neutral-900 px-3 py-2 text-sm outline-none ring-1 ring-neutral-800 focus:ring-white"
                  />
                </div>
                <div className="mt-2 text-xs text-neutral-400">{filtered.length} channels</div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {loading ? (
                    Array.from({ length: 10 }, (_, i) => (
                      <div key={`sk-side-${i}`} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3" aria-hidden="true">
                        <div className="flex items-center gap-3 animate-pulse">
                          <div className="h-12 w-12 rounded bg-neutral-950" />
                          <div className="flex-1">
                            <div className="h-3 w-3/4 rounded bg-neutral-800" />
                            <div className="mt-2 h-2 w-1/3 rounded bg-neutral-800/70" />
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    filtered.map((ch) => (
                      <ChannelCard
                        key={ch.id}
                        channel={ch}
                        pinned={pinnedIds.includes(String(ch?.id || '').trim())}
                        onTogglePinned={togglePinned}
                        onSelect={() => setHeroById(ch.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>

      </section>
    </Protected>
  );
}
