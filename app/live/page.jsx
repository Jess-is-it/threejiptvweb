'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import { useProfileMode } from '../../components/useProfileMode';
import { pickKidsCategoryIds } from '../../lib/kidsMode';

const LIVE_REFRESH_MS = 15_000;
const BRAND = 'var(--brand)';
const HEADER_H = 64;
const SHELL_HEADER_OFFSET = 64;
const SECTION_TOP_GAP = 24;
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

function downKey({ username = '', origin = '' } = {}) {
  const u = normalizeUsername(username) || 'anon';
  const o = String(origin || '').trim() || 'origin';
  return `3jtv.liveDown:${u}:${o}`;
}

function liveCatalogCacheKey({ origin = '' } = {}) {
  const o = String(origin || '').trim() || 'origin';
  return `3jtv.liveCatalogCache:${o}`;
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

function shouldHideDown({ downAt = 0, nowTs = Date.now(), ttlMs = 20 * 60 * 1000 } = {}) {
  const ts = Number(downAt || 0) || 0;
  if (!ts) return false;
  return nowTs - ts < ttlMs;
}

function uptimeSecondsOf(channel) {
  const n = Number(channel?.uptimeSeconds);
  // Treat 0 as unknown: some catalogs don't provide real uptime.
  return Number.isFinite(n) && n > 0 ? n : -1;
}

function compareLiveRuntime(a, b) {
  const uptimeA = uptimeSecondsOf(a);
  const uptimeB = uptimeSecondsOf(b);
  if (uptimeA !== uptimeB) return uptimeB - uptimeA;
  // Fallback: older-running processes tend to have smaller PIDs on this XUI host.
  const pidA = Number(a?.xuiPid);
  const pidB = Number(b?.xuiPid);
  if (Number.isFinite(pidA) && Number.isFinite(pidB) && pidA !== pidB) return pidA - pidB;
  const numberA = Number(a?.number || 0) || 0;
  const numberB = Number(b?.number || 0) || 0;
  if (numberA && numberB && numberA !== numberB) return numberA - numberB;
  return String(a?.name || '').localeCompare(String(b?.name || ''));
}

function pickLongestRunningChannel(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  return [...list].sort(compareLiveRuntime)[0] || null;
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
            const name = String(ch?.name || '').trim() || `CH ${id}`;
            return (
              <div key={id || ch.id} className="w-32 flex-none snap-start sm:w-40">
                <button
                  type="button"
                  onClick={() => onSelect?.(id)}
                  className={
                    'group/card relative h-20 w-full overflow-hidden rounded-xl border bg-neutral-900/40 sm:h-24 ' +
                    (active ? 'border-white ring-2 ring-white/30' : 'border-neutral-800 hover:border-neutral-600')
                  }
                  title={name}
                  aria-label={name}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition group-hover/card:opacity-100" />
                  <div className="flex h-full w-full items-center justify-center bg-neutral-950/40">
                    {logo ? (
                      <img src={logo} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-xs text-neutral-500">No Logo</span>
                    )}
                  </div>
                </button>
                <div className="mt-1 line-clamp-1 text-[11px] font-medium text-neutral-200">{name}</div>
              </div>
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
  const router = useRouter();
  const { session } = useSession();
  const { mode: profileMode } = useProfileMode();
  const kidsMode = profileMode === 'kids';
  const [headerH, setHeaderH] = useState(HEADER_H);
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const bootstrappedRef = useRef(false);
  const username = String(session?.user?.username || '').trim();
  const sessionOrigin = useMemo(() => getOriginFromStreamBase(session?.streamBase), [session?.streamBase]);

  const [pinnedIds, setPinnedIds] = useState([]);
  const [downMap, setDownMap] = useState({});
  const [heroId, setHeroId] = useState('');

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
    bootstrappedRef.current = Boolean(bootstrapped);
  }, [bootstrapped]);

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
        if (!silent) {
          if (!bootstrappedRef.current) setLoading(true);
          else setRefreshing(true);
        }
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
        const nextCategories = Array.isArray(data.categories) ? data.categories : [];
        const nextChannels = Array.isArray(data.channels) ? data.channels : [];
        setCategories(nextCategories);
        setChannels(nextChannels);
        setBootstrapped(true);
        try {
          writeJsonStorage(liveCatalogCacheKey({ origin: sessionOrigin }), {
            ts: Date.now(),
            categories: nextCategories,
            channels: nextChannels,
          });
        } catch {}
        if (!silent) setErr('');
      } catch (e) {
        // Avoid wiping the list on background refresh failures.
        if (!silent) setErr(e.message || 'Network error');
      } finally {
        if (alive && !silent) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    // Fast path: render cached list immediately, then refresh in the background.
    let usedCache = false;
    if (sessionOrigin && typeof window !== 'undefined') {
      try {
        const cached = readJsonStorage(liveCatalogCacheKey({ origin: sessionOrigin }), null);
        const ts = Number(cached?.ts || 0) || 0;
        const ttlMs = 10 * 60 * 1000;
        if (ts && Date.now() - ts < ttlMs) {
          const cachedCategories = Array.isArray(cached?.categories) ? cached.categories : [];
          const cachedChannels = Array.isArray(cached?.channels) ? cached.channels : [];
          if (cachedCategories.length || cachedChannels.length) {
            setCategories(cachedCategories);
            setChannels(cachedChannels);
            setBootstrapped(true);
            setLoading(false);
            usedCache = true;
          }
        }
      } catch {}
    }

    load({ silent: usedCache });
    // Background refresh is intentionally conservative; aggressive polling was destabilizing the server
    // while the user was already watching the active channel.
    intervalId = setInterval(() => load({ silent: true }), LIVE_REFRESH_MS);

    return () => {
      alive = false;
      if (intervalId) clearInterval(intervalId);
      if (ctrl) ctrl.abort();
    };
  }, [session?.streamBase, sessionOrigin]);

  useEffect(() => {
    if (!username || !sessionOrigin) return;
    const pins = normalizePinnedIds(readJsonStorage(pinsKey({ username, origin: sessionOrigin }), []));
    const down = normalizeDownMap(readJsonStorage(downKey({ username, origin: sessionOrigin }), {}));
    setPinnedIds(pins);
    setDownMap(down);
  }, [username, sessionOrigin]);

  const kidsCategoryIds = useMemo(() => (kidsMode ? pickKidsCategoryIds(categories) : new Set()), [kidsMode, categories]);
  const categoriesView = useMemo(() => {
    if (!kidsMode) return categories;
    if (!kidsCategoryIds.size) return [];
    return (Array.isArray(categories) ? categories : []).filter((c) => kidsCategoryIds.has(String(c?.id || '').trim()));
  }, [kidsMode, categories, kidsCategoryIds]);
  const channelsView = useMemo(() => {
    if (!kidsMode) return channels;
    if (!kidsCategoryIds.size) return [];
    return (Array.isArray(channels) ? channels : []).filter((c) => kidsCategoryIds.has(String(c?.category_id ?? '').trim()));
  }, [kidsMode, channels, kidsCategoryIds]);

  const visibleChannels = useMemo(() => {
    return channelsView
      .filter((c) => c?.isUp !== false)
      .filter((c) => !shouldHideDown({ downAt: downMap?.[String(c?.id || '').trim()] || 0 }));
  }, [channelsView, downMap]);

  const channelsByCategory = useMemo(() => {
    const pinnedSet = new Set(pinnedIds.map((id) => String(id || '').trim()).filter(Boolean));
    const compare = (a, b) => {
      const ida = String(a?.id || '').trim();
      const idb = String(b?.id || '').trim();
      const pa = pinnedSet.has(ida);
      const pb = pinnedSet.has(idb);
      if (pa !== pb) return pa ? -1 : 1;
      return compareLiveRuntime(a, b);
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
    for (const c of Array.isArray(categoriesView) ? categoriesView : []) {
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
  }, [visibleChannels, categoriesView, pinnedIds]);

  const longestRunningHero = useMemo(() => pickLongestRunningChannel(visibleChannels), [visibleChannels]);

  useEffect(() => {
    const wanted = String(heroId || '').trim();
    if (!visibleChannels.length) {
      if (wanted) setHeroId('');
      return;
    }
    if (wanted && visibleChannels.some((channel) => String(channel?.id || '').trim() === wanted)) return;
    const nextId = String(longestRunningHero?.id || '').trim();
    if (nextId && nextId !== wanted) setHeroId(nextId);
  }, [visibleChannels, heroId, longestRunningHero]);

  const activeHero = useMemo(() => {
    const wanted = String(heroId || '').trim();
    if (wanted) {
      const selected = visibleChannels.find((channel) => String(channel?.id || '').trim() === wanted);
      if (selected) return selected;
    }
    return longestRunningHero || null;
  }, [visibleChannels, heroId, longestRunningHero]);

  const activeSlide = useMemo(() => {
    const activeId = String(activeHero?.id || '').trim();
    if (!activeId) return null;
    const group = channelsByCategory.find((row) =>
      (Array.isArray(row?.channels) ? row.channels : []).some((channel) => String(channel?.id || '').trim() === activeId)
    );
    return {
      categoryId: String(group?.id || activeHero?.category_id || '').trim(),
      categoryName: String(group?.name || '').trim() || 'Channels',
      channel: activeHero,
    };
  }, [activeHero, channelsByCategory]);

  const setHeroById = (id) => {
    const wanted = String(id || '').trim();
    if (!wanted) return;
    const exists = visibleChannels.some((channel) => String(channel?.id || '').trim() === wanted);
    if (!exists) return;
    setHeroId(wanted);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {}
  };

  const watchChannel = (id = activeHero?.id) => {
    const targetId = String(id || '').trim();
    if (!targetId) return;
    try {
      sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
    } catch {}
    router.push(`/watch/live/${encodeURIComponent(targetId)}?auto=1`);
  };

  return (
    <Protected>
      <section className="px-4 pb-10 pt-0 sm:px-6 lg:px-10">
        {err ? <p className="mb-3 text-sm text-red-400">{err}</p> : null}

        {/* Hero */}
        <div
          className="group relative -mx-4 mb-6 h-[68vh] w-auto overflow-hidden bg-black sm:-mx-6 md:h-[72vh] lg:-mx-10 lg:h-[74vh]"
          style={{
            marginTop: `-${headerH + SHELL_HEADER_OFFSET + SECTION_TOP_GAP}px`,
            paddingTop: `${headerH}px`,
            touchAction: 'pan-y',
          }}
        >
          {/* background */}
          <div className="absolute inset-0">
            {activeHero?.logo ? (
              <img
                src={activeHero.logo}
                alt=""
                className="h-full w-full object-cover opacity-80 blur-[1px]"
                loading="eager"
              />
            ) : null}
            <div className="absolute inset-0 bg-neutral-950/70" />
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-20 bg-gradient-to-b from-black/75 via-black/40 to-transparent sm:h-24 lg:h-28" />
            <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black via-black/25 to-transparent" />
          </div>

          <div
            className="absolute right-4 z-20 flex flex-col items-end gap-2 sm:right-6 lg:right-10"
            style={{ top: `${headerH + 18}px` }}
          >
            <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-black/45 px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur-md">
              <span className="uppercase tracking-[0.2em] text-white/70">TV channels</span>
              <span aria-hidden className="h-1 w-1 rounded-full bg-white/35" />
              <span className="text-white">{visibleChannels.length}</span>
            </div>
          </div>

          {/* copy & CTAs */}
          <div className="relative z-10 flex h-full flex-col justify-end px-4 pb-10 sm:px-6 lg:px-10">
            <div className="max-w-[72ch] bg-gradient-to-r from-black/80 via-black/50 to-transparent p-5 sm:p-6">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-white/70">Featured channel</div>

              <h2 className="mb-2 line-clamp-2 text-3xl font-extrabold leading-tight text-white sm:text-4xl md:text-6xl">
                {activeHero?.name || (loading ? 'Loading channels…' : 'No live channels available.')}
              </h2>

              {activeSlide?.categoryName ? (
                <div className="mb-3 flex flex-wrap items-center gap-x-3 text-sm text-neutral-200">
                  <span>• {activeSlide.categoryName}</span>
                </div>
              ) : null}

              {activeHero ? (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => watchChannel(activeHero?.id)}
                    className="inline-flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-white"
                    style={{ background: BRAND }}
                    title="Watch"
                  >
                    <Play size={18} /> Watch
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Channels */}
        <div className="relative z-10 -mt-10 pb-3">
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
                  onSelect={(id) => {
                    setHeroById(id);
                    watchChannel(id);
                  }}
                />
              ))
          )}
        </div>
      </section>
    </Protected>
  );
}
