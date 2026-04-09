'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react';
import { flushSync } from 'react-dom';
import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import VideoPlayer from '../../components/VideoPlayer';

const LIVE_REFRESH_MS = 15_000;
const BRAND = 'var(--brand)';
const HEADER_H = 64;
const SHELL_HEADER_OFFSET = 64;
const SCROLL_EDGE_TOLERANCE = 4;

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

function LiveCategoryRow({ group, activeId, onSelect }) {
  const scroller = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const channels = useMemo(() => (Array.isArray(group?.channels) ? group.channels : []), [group?.channels]);
  const title = String(group?.name || '').trim() || 'Channels';

  const scrollByAmount = (dir) => {
    const el = scroller.current;
    if (!el) return;
    const delta = Math.round(el.clientWidth * 0.9) * (dir === 'left' ? -1 : 1);
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const updateScrollControls = () => {
      const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const nextCanScrollLeft = el.scrollLeft > SCROLL_EDGE_TOLERANCE;
      const nextCanScrollRight = maxScrollLeft - el.scrollLeft > SCROLL_EDGE_TOLERANCE;
      setCanScrollLeft((prev) => (prev === nextCanScrollLeft ? prev : nextCanScrollLeft));
      setCanScrollRight((prev) => (prev === nextCanScrollRight ? prev : nextCanScrollRight));
    };

    const onWheel = (e) => {
      // Convert vertical wheel gestures into horizontal row scrolling.
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
      e.preventDefault();
    };

    updateScrollControls();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', updateScrollControls, { passive: true });
    window.addEventListener('resize', updateScrollControls, { passive: true });

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateScrollControls());
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', updateScrollControls);
      window.removeEventListener('resize', updateScrollControls);
      resizeObserver?.disconnect();
    };
  }, [channels]);

  if (!channels.length) return null;

  return (
    <section className="group relative pt-3">
      <div className="flex items-center px-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
          {title}
          <span className="ml-2 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-neutral-200">
            {channels.length}
          </span>
        </div>
      </div>

      <div className="relative mt-2">
        <div
          ref={scroller}
          className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-3 pb-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {channels.map((ch) => {
            const id = String(ch?.id || '').trim();
            const active = activeId ? String(activeId) === id : false;
            const logo = String(ch?.logo || '').trim();
            return (
              <button
                key={id || ch.id}
                type="button"
                onClick={() => onSelect?.(id)}
                className={
                  'group/card relative h-20 w-32 flex-none snap-start overflow-hidden rounded-xl border bg-neutral-900/40 sm:h-24 sm:w-40 ' +
                  (active ? 'border-white ring-2 ring-white/30' : 'border-neutral-800 hover:border-neutral-600')
                }
                title={ch?.name || `CH ${id}`}
                aria-label={ch?.name || `Channel ${id}`}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition group-hover/card:opacity-100" />
                <div className="flex h-full w-full items-center justify-center bg-neutral-950/40">
                  {logo ? (
                    <img src={logo} alt="" className="h-full w-full object-contain p-2" loading="lazy" />
                  ) : (
                    <span className="text-xs text-neutral-500">No Logo</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Arrows: desktop only, show on row hover */}
        {canScrollLeft ? (
          <button
            onClick={() => scrollByAmount('left')}
            aria-label="Scroll left"
            className="
              absolute left-0 top-1/2 -translate-y-1/2 z-30
              hidden md:flex h-12 w-12 items-center justify-center rounded-full
              border border-neutral-700 bg-neutral-900/70 hover:bg-neutral-800/90
              opacity-0 md:group-hover:opacity-100
              pointer-events-none md:group-hover:pointer-events-auto
              transition-opacity
            "
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        ) : null}

        {canScrollRight ? (
          <button
            onClick={() => scrollByAmount('right')}
            aria-label="Scroll right"
            className="
              absolute right-0 top-1/2 -translate-y-1/2 z-30
              hidden md:flex h-12 w-12 items-center justify-center rounded-full
              border border-neutral-700 bg-neutral-900/70 hover:bg-neutral-800/90
              opacity-0 md:group-hover:opacity-100
              pointer-events-none md:group-hover:pointer-events-auto
              transition-opacity
            "
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        ) : null}

        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-black to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-black to-transparent" />
      </div>
    </section>
  );
}

export default function LivePage() {
  const { session } = useSession();
  const [headerH, setHeaderH] = useState(HEADER_H);
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const heroWrapRef = useRef(null);
  const heroPlayerRef = useRef(null);
  const username = String(session?.user?.username || '').trim();
  const sessionOrigin = useMemo(() => getOriginFromStreamBase(session?.streamBase), [session?.streamBase]);

  const [pinnedIds, setPinnedIds] = useState([]);
  const [restartMap, setRestartMap] = useState({});
  const [downMap, setDownMap] = useState({});
  const [heroId, setHeroId] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroFs, setHeroFs] = useState(false);
  const [heroMsg, setHeroMsg] = useState('');
  const [heroMuted, setHeroMuted] = useState(false);
  const servers = useMemo(() => (sessionOrigin ? [{ label: 'Current server', origin: sessionOrigin }] : []), [sessionOrigin]);

  useEffect(() => {
    const measure = () => {
      const el = document.getElementById('site-header');
      setHeaderH(el ? el.offsetHeight : HEADER_H);
    };
    measure();
    window.addEventListener('resize', measure);
    const t = setTimeout(measure, 100);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(t);
    };
  }, []);

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
          // Probe the actual stream URLs with a short server-side cache so stopped/down streams
          // disappear quickly without a full page refresh.
          body: JSON.stringify({ streamBase: session?.streamBase, probe: true, fresh: true }),
        });
        const data = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !data.ok) throw new Error(data?.error || 'Failed to load live channels');
        // Apply the latest list immediately so stopped streams disappear and the count updates
        // even while the hero player is active.
        setCategories(Array.isArray(data.categories) ? data.categories : []);
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

  // Best-effort: browsers can block audible autoplay after navigation. Unmute on first user interaction.
  useEffect(() => {
    const onFirstGesture = () => {
      try {
        heroPlayerRef.current?.unmute?.();
      } catch {}
    };
    window.addEventListener('pointerdown', onFirstGesture, { capture: true, once: true });
    window.addEventListener('keydown', onFirstGesture, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown', onFirstGesture, true);
    };
  }, []);

  const isDownHidden = (id) => {
    const downAt = downMap?.[String(id || '').trim()] || 0;
    return shouldHideDown({ downAt });
  };

  const visibleChannels = useMemo(() => {
    return channels.filter((c) => c?.isUp !== false).filter((c) => !isDownHidden(c?.id));
  }, [channels, downMap]);

  const channelsByCategory = useMemo(() => {
    const pinnedSet = new Set(pinnedIds.map((id) => String(id || '').trim()).filter(Boolean));
    const compare = (a, b) => {
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
    };

    const map = new Map();
    for (const ch of visibleChannels) {
      const cid = String(ch?.category_id ?? '').trim() || 'UNCAT';
      const list = map.get(cid);
      if (list) list.push(ch);
      else map.set(cid, [ch]);
    }

    for (const list of map.values()) list.sort(compare);

    const ordered = [];
    const seen = new Set();
    for (const c of Array.isArray(categories) ? categories : []) {
      const id = String(c?.id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const list = map.get(id);
      if (list?.length) ordered.push({ id, name: c?.name || `Category ${id}`, channels: list });
    }
    // If some categories exist in the catalog but aren't in the category list, render them last.
    for (const [id, list] of map.entries()) {
      if (seen.has(id)) continue;
      ordered.push({ id, name: id === 'UNCAT' ? 'Other' : `Category ${id}`, channels: list });
    }
    return ordered;
  }, [visibleChannels, categories, pinnedIds]);

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

  useEffect(() => {
    if (!activeHero?.id) return;
    // Best-effort: try to keep audio on when the hero changes (browsers may still require a gesture).
    const t = setTimeout(() => {
      tryUnmuteHero();
    }, 120);
    return () => clearTimeout(t);
  }, [activeHero?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    flushSync(() => {
      setHeroIndex(idx);
      setHeroId(wanted);
    });
    try {
      // User gesture: make a best-effort attempt to start with sound.
      heroPlayerRef.current?.unmute?.();
      setTimeout(() => heroPlayerRef.current?.unmute?.(), 75);
    } catch {}
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {}
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

  const heroVideoEl = () => {
    const host = heroWrapRef.current;
    if (!host) return null;
    return host.querySelector('video');
  };

  const tryUnmuteHero = () => {
    const ctl = heroPlayerRef.current;
    if (ctl?.unmute) {
      try {
        ctl.unmute();
      } catch {}
      setHeroMuted(false);
      return true;
    }
    const v = heroVideoEl();
    if (!v) return false;
    try {
      v.muted = false;
      if (typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
    } catch {}
    try {
      const p = v.play?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
    setHeroMuted(false);
    return true;
  };

  const toggleHeroMute = () => {
    const ctl = heroPlayerRef.current;
    if (ctl?.toggleMute) {
      try {
        ctl.toggleMute();
      } catch {}
      try {
        setHeroMuted(Boolean(ctl.isMuted?.()));
      } catch {}
      return true;
    }
    const v = heroVideoEl();
    if (!v) return false;
    try {
      const isMuted = Boolean(v.muted || v.volume === 0);
      if (isMuted) {
        tryUnmuteHero();
        return true;
      }
      v.muted = true;
      setHeroMuted(true);
    } catch {}
    return true;
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
        document.exitFullscreen();
        return;
      }
      if (el?.requestFullscreen) {
        el.requestFullscreen();
      }
    } catch {}
  };

  return (
    <Protected>
      <section className="px-4 pb-10 pt-0 sm:px-6 lg:px-10">
        {err ? <p className="mb-3 text-sm text-red-400">{err}</p> : null}

        {/* Hero */}
        <div
          ref={heroWrapRef}
          className="group relative -mx-4 sm:-mx-6 lg:-mx-10 w-auto overflow-hidden bg-black"
          style={{
            marginTop: `-${headerH + SHELL_HEADER_OFFSET}px`,
            height: 'calc(100vh - 160px)',
          }}
        >
          {activeHero ? (
            <>
              <div className="absolute inset-0">
                <VideoPlayer
                  mp4={playback.mp4}
                  hls={playback.hls}
                  preferHls={playback.preferHls}
                  meta={playerMeta}
                  mode="inline"
                  fill={true}
                  autoPlayOnLoad={true}
                  autoFullscreen={false}
                  startMuted={false}
                  controlRef={heroPlayerRef}
                  onMutedChange={(m) => setHeroMuted(Boolean(m))}
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
              </div>

	              {/* TOP gradient under the header so nav stays readable */}
	              <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-20 sm:h-24 lg:h-28 bg-gradient-to-b from-black/75 via-black/40 to-transparent" />

	              {/* BOTTOM vignette + copy (movies hero style) */}
	              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />

	              <div className="pointer-events-none relative z-10 flex h-full flex-col justify-end px-4 sm:px-6 lg:px-10 pb-10">
	                <div className="pointer-events-auto max-w-[72ch] bg-gradient-to-r from-black/80 via-black/50 to-transparent p-5 sm:p-6">
	                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-white/70">Now playing</div>

	                  <h2 className="mb-3 text-3xl font-extrabold leading-tight text-white sm:text-4xl md:text-6xl line-clamp-2">
	                    {activeHero?.name || 'Live Channel'}
	                  </h2>

	                  {activeHero?.number || heroMsg ? (
	                    <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-neutral-200">
	                      {activeHero?.number ? <span className="rounded bg-white/10 px-2 py-1">#{activeHero.number}</span> : null}
	                      {heroMsg ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-100">{heroMsg}</span> : null}
	                    </div>
	                  ) : (
	                    <div className="mb-5" />
	                  )}

	                  <div className="flex items-center gap-3">
	                    <button
	                      type="button"
	                      onClick={toggleFullscreen}
	                      className="inline-flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-white"
	                      style={{ background: BRAND }}
	                      title={heroFs ? 'Exit fullscreen' : 'Fullscreen'}
	                    >
	                      {heroFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
	                      {heroFs ? 'Exit Fullscreen' : 'Fullscreen'}
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => {
	                        try {
	                          toggleHeroMute();
	                        } catch {}
	                      }}
	                      className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
	                      title={heroMuted ? 'Unmute' : 'Mute'}
	                      aria-label={heroMuted ? 'Unmute' : 'Mute'}
	                    >
	                      {heroMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
	                    </button>
	                  </div>
	                </div>
	              </div>
	            </>
	          ) : (
	            <div className="flex h-full items-center justify-center text-sm text-white/70">
	              {loading ? 'Loading channels…' : 'No live channels available.'}
            </div>
          )}
        </div>

        {/* Channels */}
        <div className="relative z-10 -mt-10 pb-3">
          <div className="px-3 text-xs text-neutral-400">{visibleChannels.length} online</div>

          {loading ? (
            <div className="px-3 pt-3">
              <div className="h-4 w-40 animate-pulse rounded bg-neutral-800/70" />
              <div className="mt-3 no-scrollbar flex gap-3 overflow-x-auto pb-1">
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={`sk-strip-${i}`}
                    className="h-20 w-32 flex-none rounded-xl border border-neutral-800 bg-neutral-900/40"
                    aria-hidden="true"
                  >
                    <div className="h-full w-full animate-pulse rounded-xl bg-neutral-900/40" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            channelsByCategory
              .filter((g) => g.channels?.length)
              .map((group) => (
                <LiveCategoryRow
                  key={group.id}
                  group={group}
                  activeId={activeHero ? String(activeHero?.id || '').trim() : ''}
                  onSelect={(id) => setHeroById(id)}
                />
              ))
          )}
        </div>
      </section>
    </Protected>
  );
}
