'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { flushSync } from 'react-dom';
import Protected from '../components/Protected';
import CatalogHero from '../components/CatalogHero';
import VideoPlayer from '../components/VideoPlayer';
import { useProfileMode } from '../components/useProfileMode';
import { usePublicSettings } from '../components/PublicSettingsProvider';
import { useSession } from '../components/SessionProvider';
import {
  getCatalogSettings,
  selectRotatingCategory,
} from '../lib/catalogSettings';
import {
  prefetchLeavingSoonCatalog,
  prefetchMovieCatalog,
  prefetchSeriesCatalog,
  prefetchUpcomingCatalog,
  readLeavingSoonCatalog,
  readMovieCatalog,
  readSeriesCatalog,
  readUpcomingCatalog,
} from '../lib/publicCatalogCache';
import { pickKidsCategoryIds } from '../lib/kidsMode';

const HEADER_H = 64;
const SHELL_HEADER_OFFSET = 64;
const SECTION_TOP_GAP = 24;
const HOME_LIVE_AUTOPLAY_MS = 12_000;
const LIVE_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

function normalizeMovieItems(items = []) {
  return (Array.isArray(items) ? items : []).map((movie) => ({
    ...movie,
    href: `/movies/${movie.id}`,
    backdrop: movie.backdropImage || movie.backdrop || movie.image,
  }));
}

function normalizeUsername(value = '') {
  return String(value || '').trim().toLowerCase();
}

function liveCatalogCacheKey({ origin = '' } = {}) {
  const rawOrigin = String(origin || '').trim() || 'origin';
  return `3jtv.liveCatalogCache:${rawOrigin}`;
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

function getOriginFromStreamBase(streamBase) {
  try {
    return streamBase ? new URL(streamBase).origin : '';
  } catch {
    return '';
  }
}

function parseCreds(streamBase) {
  try {
    const url = new URL(streamBase);
    const parts = url.pathname.split('/').filter(Boolean);
    const liveIndex = parts.indexOf('live');
    return { username: parts[liveIndex + 1] || '', password: parts[liveIndex + 2] || '' };
  } catch {
    return { username: '', password: '' };
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
    return normalizeLiveExt(url.pathname.match(/\.([a-z0-9]+)$/i)?.[1] || '');
  } catch {
    return normalizeLiveExt(raw.match(/\.([a-z0-9]+)(?:$|\?)/i)?.[1] || '');
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
  const value = Number(channel?.uptimeSeconds);
  return Number.isFinite(value) && value > 0 ? value : -1;
}

function compareLiveChannels(a, b) {
  const uptimeA = uptimeSecondsOf(a);
  const uptimeB = uptimeSecondsOf(b);
  if (uptimeA >= 0 && uptimeB >= 0 && uptimeA !== uptimeB) return uptimeB - uptimeA;
  const pidA = Number(a?.xuiPid);
  const pidB = Number(b?.xuiPid);
  if (Number.isFinite(pidA) && Number.isFinite(pidB) && pidA !== pidB) return pidA - pidB;
  return String(a?.name || '').localeCompare(String(b?.name || ''));
}

function livePlaybackFor(channel, streamBase, sessionOrigin) {
  if (!streamBase || !channel?.id || !sessionOrigin) return { mp4: '', hls: '', preferHls: true };
  const { username, password } = parseCreds(streamBase);
  const directSource = rebaseSourceOrigin(pickDirectSource(channel), sessionOrigin);
  const directIsHls = isHlsLikeSource(directSource);
  const normalizedExt = normalizeLiveExt(channel?.ext || sourceExtension(directSource) || '');
  const defaultHls = `${sessionOrigin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${channel.id}.m3u8`;
  const fallbackExt = normalizedExt && normalizedExt !== 'm3u8' ? normalizedExt : 'ts';
  const defaultDirect = `${sessionOrigin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${channel.id}.${fallbackExt}`;

  if (directSource) {
    return { mp4: directIsHls ? '' : directSource, hls: directIsHls ? directSource : defaultHls, preferHls: true };
  }
  return { mp4: normalizedExt === 'm3u8' ? '' : defaultDirect, hls: defaultHls, preferHls: true };
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

function HomeLiveHero({ session, kidsMode = false, behindHeader = false }) {
  const [headerH, setHeaderH] = useState(HEADER_H);
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [playerMode, setPlayerMode] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [playerResetKey, setPlayerResetKey] = useState(0);
  const heroWrapRef = useRef(null);
  const heroPlayerRef = useRef(null);
  const playerModeRef = useRef(false);
  const sessionOrigin = useMemo(() => getOriginFromStreamBase(session?.streamBase), [session?.streamBase]);

  useEffect(() => {
    const measure = () => {
      const el = document.getElementById('site-header');
      setHeaderH(el ? el.offsetHeight : HEADER_H);
    };
    measure();
    window.addEventListener('resize', measure);
    const timer = setTimeout(measure, 100);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    playerModeRef.current = Boolean(playerMode);
  }, [playerMode]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const isFullscreen = Boolean(document.fullscreenElement);
      setPlayerFullscreen(isFullscreen);
      if (!isFullscreen && playerModeRef.current) {
        playerModeRef.current = false;
        setPlayerMode(false);
        setPlayerResetKey((current) => current + 1);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!session?.streamBase) {
      setLoading(false);
      return undefined;
    }

    let alive = true;
    const cacheKey = liveCatalogCacheKey({ origin: sessionOrigin });
    const cached = readJsonStorage(cacheKey, null);
    const cachedTs = Number(cached?.ts || 0) || 0;
    const cacheFresh = Boolean(cachedTs && Date.now() - cachedTs < LIVE_CATALOG_CACHE_TTL_MS);
    const cachedCategories = cacheFresh && Array.isArray(cached?.categories) ? cached.categories : [];
    const cachedChannels = cacheFresh && Array.isArray(cached?.channels) ? cached.channels : [];

    if (cachedCategories.length || cachedChannels.length) {
      setCategories(cachedCategories);
      setChannels(cachedChannels);
      setLoading(false);
    } else {
      setLoading(true);
    }

    (async () => {
      try {
        const response = await fetch('/api/xuione/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ streamBase: session.streamBase, probe: true, fresh: true }),
        });
        const data = await readJsonSafe(response);
        if (!alive) return;
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'Failed to load live channels');
        const nextCategories = Array.isArray(data.categories) ? data.categories : [];
        const nextChannels = Array.isArray(data.channels) ? data.channels : [];
        setCategories(nextCategories);
        setChannels(nextChannels);
        writeJsonStorage(cacheKey, { ts: Date.now(), categories: nextCategories, channels: nextChannels });
      } catch {
        if (!alive) return;
        if (!cachedCategories.length && !cachedChannels.length) {
          setCategories([]);
          setChannels([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [session?.streamBase, sessionOrigin]);

  const kidsCategoryIds = useMemo(() => (kidsMode ? pickKidsCategoryIds(categories) : new Set()), [kidsMode, categories]);
  const visibleChannels = useMemo(() => {
    const list = Array.isArray(channels) ? channels : [];
    return list
      .filter((channel) => channel?.isUp !== false)
      .filter((channel) => !kidsMode || kidsCategoryIds.has(String(channel?.category_id ?? '').trim()));
  }, [channels, kidsMode, kidsCategoryIds]);

  const heroSlides = useMemo(() => {
    const categoryById = new Map(
      (Array.isArray(categories) ? categories : []).map((category) => [
        String(category?.id ?? '').trim(),
        String(category?.name || '').trim(),
      ])
    );
    const grouped = new Map();
    for (const channel of visibleChannels) {
      const categoryId = String(channel?.category_id ?? '').trim() || 'UNCAT';
      if (!grouped.has(categoryId)) grouped.set(categoryId, []);
      grouped.get(categoryId).push(channel);
    }

    return [...grouped.entries()].map(([categoryId, rows]) => {
      const sortedRows = [...rows].sort(compareLiveChannels);
      return {
        categoryId,
        categoryName: categoryById.get(categoryId) || (categoryId === 'UNCAT' ? 'Other' : 'Live TV'),
        channel: sortedRows[0],
      };
    }).filter((slide) => slide.channel);
  }, [categories, visibleChannels]);

  useEffect(() => {
    setActiveIndex((current) => (heroSlides.length ? Math.min(current, heroSlides.length - 1) : 0));
  }, [heroSlides.length]);

  useEffect(() => {
    if (playerMode || heroSlides.length < 2) return undefined;
    const timer = setTimeout(() => {
      setActiveIndex((current) => (current + 1) % heroSlides.length);
    }, HOME_LIVE_AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [activeIndex, heroSlides.length, playerMode]);

  const activeSlide = heroSlides[activeIndex] || null;
  const activeChannel = activeSlide?.channel || null;
  const playback = useMemo(
    () => livePlaybackFor(activeChannel, session?.streamBase, sessionOrigin),
    [activeChannel, session?.streamBase, sessionOrigin]
  );
  const playerMeta = useMemo(() => {
    const id = String(activeChannel?.id || '').trim();
    return {
      id,
      type: 'live',
      title: activeChannel?.name || (id ? `Live #${id}` : 'Live TV'),
      image: activeChannel?.logo || '',
      href: id ? `/watch/live/${id}` : '/live',
      backHref: '/',
    };
  }, [activeChannel]);

  const move = (delta) => {
    if (heroSlides.length < 2) return;
    setActiveIndex((current) => (current + delta + heroSlides.length) % heroSlides.length);
  };

  const exitPlayerFullscreen = async ({ exitFullscreen } = {}) => {
    try {
      await exitFullscreen?.();
    } catch {}
    playerModeRef.current = false;
    flushSync(() => setPlayerMode(false));
    setPlayerResetKey((current) => current + 1);
    setPlayerFullscreen(false);
  };

  const playFullscreen = () => {
    if (!activeChannel?.id || (!playback.mp4 && !playback.hls)) return;
    const host = heroWrapRef.current;
    playerModeRef.current = true;
    flushSync(() => setPlayerMode(true));
    try {
      host?.requestFullscreen?.();
    } catch {}
    try {
      heroPlayerRef.current?.switchToSources?.({
        nextMp4: playback.mp4,
        nextHls: playback.hls,
        nextPreferHls: playback.preferHls,
        withSound: true,
      });
    } catch {}
    try {
      heroPlayerRef.current?.unmute?.();
    } catch {}
    setTimeout(() => {
      try {
        if (!document.fullscreenElement) {
          playerModeRef.current = false;
          setPlayerMode(false);
          setPlayerResetKey((current) => current + 1);
        }
      } catch {
        playerModeRef.current = false;
        setPlayerMode(false);
        setPlayerResetKey((current) => current + 1);
      }
    }, 900);
  };

  return (
    <div
      ref={heroWrapRef}
      className={
        playerFullscreen
          ? 'group relative h-screen w-screen overflow-hidden bg-black'
          : 'group relative -mx-4 sm:-mx-6 lg:-mx-10 mb-6 h-[68vh] md:h-[72vh] lg:h-[74vh] w-auto overflow-hidden bg-black'
      }
      style={
        playerFullscreen
          ? {
              marginTop: 0,
              paddingTop: 0,
              touchAction: 'none',
            }
          : behindHeader
          ? {
              marginTop: `-${headerH + SHELL_HEADER_OFFSET + SECTION_TOP_GAP}px`,
              paddingTop: `${headerH}px`,
              touchAction: 'pan-y',
            }
          : {
              marginTop: 0,
              paddingTop: 0,
              touchAction: 'pan-y',
            }
      }
    >
      <div className="absolute inset-0">
        {activeChannel ? (
          <VideoPlayer
            key={`home-live:${activeChannel.id}:${playerResetKey}`}
            mp4={playerMode ? playback.mp4 : ''}
            hls={playerMode ? playback.hls : ''}
            preferHls={playback.preferHls}
            meta={playerMeta}
            mode="inline"
            fill={true}
            autoPlayOnLoad={playerMode}
            autoFullscreen={false}
            startMuted={playerMode ? false : true}
            chrome={playerMode ? 'default' : 'background'}
            controlRef={heroPlayerRef}
            onBack={exitPlayerFullscreen}
            servers={sessionOrigin ? [{ label: 'Current server', origin: sessionOrigin }] : []}
            activeOrigin={sessionOrigin}
          />
        ) : (
          <div className="absolute inset-0 bg-neutral-950" />
        )}

        {!playerMode && activeChannel?.logo ? (
          <div className="absolute inset-0 bg-black">
            <img src={activeChannel.logo} alt="" className="h-full w-full object-cover opacity-85" loading="eager" />
          </div>
        ) : null}
        {!playerMode ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] h-20 bg-gradient-to-b from-black/75 via-black/40 to-transparent sm:h-24 lg:h-28" />
            <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black via-black/25 to-transparent" />
          </>
        ) : null}
      </div>

      {!playerMode ? (
        <div
          className="absolute right-4 z-20 flex flex-col items-end gap-2 sm:right-6 lg:right-10"
          style={{ top: `${behindHeader ? headerH + 18 : 18}px` }}
        >
          <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-black/45 px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur-md">
            <span className="uppercase tracking-[0.2em] text-white/70">Live channels</span>
            <span aria-hidden className="h-1 w-1 rounded-full bg-white/35" />
            <span className="text-white">{visibleChannels.length}</span>
          </div>
        </div>
      ) : null}

      {!playerMode ? (
        <div className="relative z-10 flex h-full flex-col justify-end px-4 pb-10 sm:px-6 lg:px-10">
        <div className="max-w-[72ch] bg-gradient-to-r from-black/80 via-black/50 to-transparent p-5 sm:p-6">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70">Live TV</div>
          <h2 className="mb-2 line-clamp-2 text-3xl font-extrabold leading-tight text-white sm:text-4xl md:text-6xl">
            {activeChannel?.name || (loading ? 'Loading Live TV…' : 'No live channels available')}
          </h2>
          {activeSlide?.categoryName ? (
            <div className="mb-5 flex flex-wrap items-center gap-x-3 text-sm text-neutral-200">
              <span>• {activeSlide.categoryName}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={playFullscreen}
              disabled={!activeChannel?.id || (!playback.mp4 && !playback.hls)}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-white no-underline"
              style={{ background: 'var(--brand)' }}
            >
              <Play size={18} />
              Play
            </button>
            <a
              href="/live"
              className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-5 py-3 font-semibold text-white no-underline backdrop-blur-md transition hover:bg-white/15"
            >
              Go to Live TV
              <ArrowRight size={18} />
            </a>
          </div>
        </div>
        </div>
      ) : null}

      {!playerMode && heroSlides.length > 1 ? (
        <>
          <button
            type="button"
            className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60 sm:inline-flex"
            onClick={() => move(-1)}
            aria-label="Previous live channel"
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60 sm:inline-flex"
            onClick={() => move(1)}
            aria-label="Next live channel"
          >
            <ChevronRight />
          </button>
          <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-2 py-1">
            <div className="flex items-center gap-1">
              {heroSlides.map((slide, index) => (
                <button
                  type="button"
                  key={`${slide.categoryId}:${slide.channel?.id || index}`}
                  onClick={() => setActiveIndex(index)}
                  className={`h-2 w-3 cursor-pointer rounded-full transition-all ${
                    index === activeIndex ? 'w-4 bg-[var(--brand)]' : 'bg-white/60'
                  }`}
                  aria-label={`Go to live slide ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function HomePage() {
  const { session } = useSession();
  const { mode: profileMode } = useProfileMode();
  const { settings } = usePublicSettings();
  const kidsMode = profileMode === 'kids';
  const username = String(session?.user?.username || '').trim();
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [movieWorthToWait, setMovieWorthToWait] = useState([]);
  const [movieLeavingSoon, setMovieLeavingSoon] = useState([]);
  const [seriesWorthToWait, setSeriesWorthToWait] = useState([]);
  const [seriesLeavingSoon, setSeriesLeavingSoon] = useState([]);
  const [moviesLoading, setMoviesLoading] = useState(true);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const catalog = useMemo(() => getCatalogSettings(settings || {}), [settings]);

  useEffect(() => {
    if (!session?.streamBase) return undefined;
    let alive = true;
    const cached = readMovieCatalog(session.streamBase, { resolveKids: kidsMode });
    if (cached?.ok) {
      setMovies(normalizeMovieItems(cached.items));
      setMoviesLoading(false);
    }
    (async () => {
      try {
        const response = await prefetchMovieCatalog(session.streamBase, { resolveKids: kidsMode });
        if (!alive) return;
        setMovies(normalizeMovieItems(response?.items || []));
      } catch {
        if (!alive || cached?.ok) return;
        setMovies([]);
      } finally {
        if (alive) setMoviesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.streamBase, kidsMode]);

  useEffect(() => {
    if (!session?.streamBase) return undefined;
    let alive = true;
    const cached = readSeriesCatalog(session.streamBase, { resolveKids: kidsMode });
    if (cached?.ok && Array.isArray(cached.items)) {
      setSeries(cached.items.map((item) => ({ ...item, href: `/series/${item.id}` })));
      setSeriesLoading(false);
    }
    (async () => {
      try {
        const response = await prefetchSeriesCatalog(session.streamBase, { resolveKids: kidsMode });
        if (!alive) return;
        setSeries((response?.items || []).map((item) => ({ ...item, href: `/series/${item.id}` })));
      } catch {
        if (!alive || cached?.ok) return;
        setSeries([]);
      } finally {
        if (alive) setSeriesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.streamBase, kidsMode]);

  useEffect(() => {
    let alive = true;
    const cachedMovieUpcoming = readUpcomingCatalog({ username, mediaType: 'movie', limit: 120 });
    const cachedMovieLeaving = readLeavingSoonCatalog({ mediaType: 'movie', limit: 120 });
    const cachedSeriesUpcoming = readUpcomingCatalog({ username, mediaType: 'series', limit: 120 });
    const cachedSeriesLeaving = readLeavingSoonCatalog({ mediaType: 'series', limit: 120 });

    if (cachedMovieUpcoming?.ok) setMovieWorthToWait(cachedMovieUpcoming.items || []);
    if (cachedMovieLeaving?.ok) setMovieLeavingSoon(cachedMovieLeaving.items || []);
    if (cachedSeriesUpcoming?.ok) setSeriesWorthToWait(cachedSeriesUpcoming.items || []);
    if (cachedSeriesLeaving?.ok) setSeriesLeavingSoon(cachedSeriesLeaving.items || []);

    (async () => {
      try {
        const [movieUpcoming, movieLeaving, seriesUpcoming, seriesLeaving] = await Promise.all([
          prefetchUpcomingCatalog({ username, mediaType: 'movie', limit: 120 }),
          prefetchLeavingSoonCatalog({ mediaType: 'movie', limit: 120 }),
          prefetchUpcomingCatalog({ username, mediaType: 'series', limit: 120 }),
          prefetchLeavingSoonCatalog({ mediaType: 'series', limit: 120 }),
        ]);
        if (!alive) return;
        setMovieWorthToWait(Array.isArray(movieUpcoming?.items) ? movieUpcoming.items : []);
        setMovieLeavingSoon(Array.isArray(movieLeaving?.items) ? movieLeaving.items : []);
        setSeriesWorthToWait(Array.isArray(seriesUpcoming?.items) ? seriesUpcoming.items : []);
        setSeriesLeavingSoon(Array.isArray(seriesLeaving?.items) ? seriesLeaving.items : []);
      } catch {}
    })();

    return () => {
      alive = false;
    };
  }, [username]);

  const moviesView = useMemo(() => {
    if (!kidsMode) return movies;
    return movies.filter((item) => item?.kidsSafe === true);
  }, [movies, kidsMode]);
  const movieWorthToWaitView = useMemo(() => {
    if (!kidsMode) return movieWorthToWait;
    return movieWorthToWait.filter((item) => item?.kidsSafe === true);
  }, [movieWorthToWait, kidsMode]);
  const movieLeavingSoonView = useMemo(() => {
    if (!kidsMode) return movieLeavingSoon;
    return movieLeavingSoon.filter((item) => item?.kidsSafe === true);
  }, [movieLeavingSoon, kidsMode]);
  const seriesView = useMemo(() => {
    if (!kidsMode) return series;
    return series.filter((item) => item?.kidsSafe === true);
  }, [series, kidsMode]);
  const seriesWorthToWaitView = useMemo(() => {
    if (!kidsMode) return seriesWorthToWait;
    return seriesWorthToWait.filter((item) => item?.kidsSafe === true);
  }, [seriesWorthToWait, kidsMode]);
  const seriesLeavingSoonView = useMemo(() => {
    if (!kidsMode) return seriesLeavingSoon;
    return seriesLeavingSoon.filter((item) => item?.kidsSafe === true);
  }, [seriesLeavingSoon, kidsMode]);

  const moviesByRating = useMemo(() => [...moviesView].sort((a, b) => (b.rating || 0) - (a.rating || 0)), [moviesView]);
  const topMovies = useMemo(
    () => selectRotatingCategory(moviesByRating, {
      ...catalog.categories.topMovies,
      displayCount: catalog.categories.topMovies.displayCount,
    }),
    [moviesByRating, catalog]
  );
  const recentlyAddedMovies = useMemo(
    () => [...moviesView].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, catalog.categories.recentlyAddedMovies.displayCount),
    [moviesView, catalog]
  );
  const recommendedMovies = useMemo(
    () => moviesByRating.slice(5).slice(0, catalog.categories.recommendedMovies.displayCount),
    [moviesByRating, catalog]
  );
  const rankedSeries = useMemo(() => [...seriesView].sort((a, b) => (b.rating || 0) - (a.rating || 0)), [seriesView]);
  const topSeries = useMemo(
    () => selectRotatingCategory(rankedSeries, {
      ...catalog.categories.topSeries,
      displayCount: catalog.categories.topSeries.displayCount,
    }),
    [rankedSeries, catalog]
  );
  const recentlyAddedSeries = useMemo(
    () => [...seriesView].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, catalog.categories.recentlyAddedSeries.displayCount),
    [seriesView, catalog]
  );
  const showSeriesHero = !kidsMode || seriesLoading || seriesView.length || seriesWorthToWaitView.length || seriesLeavingSoonView.length;

  return (
    <Protected>
      <section className="px-4 pb-10 pt-6 sm:px-6 lg:px-10">
        <CatalogHero
          pageKey="moviesPage"
          storageKey={`home:moviesPage:${kidsMode ? 'kids' : 'adult'}:${normalizeUsername(username) || 'anon'}`}
          catalog={catalog}
          sourceItems={{
            top: topMovies,
            recentlyAdded: recentlyAddedMovies,
            leavingSoon: movieLeavingSoonView,
            recommended: recommendedMovies,
            worthToWait: movieWorthToWaitView,
          }}
          loading={moviesLoading}
          behindHeader={true}
          sectionLabel="Movies"
          sectionCta={{ href: '/movies', label: 'Go to Movies' }}
        />

        {showSeriesHero ? (
          <CatalogHero
            pageKey="seriesPage"
            storageKey={`home:seriesPage:${kidsMode ? 'kids' : 'adult'}:${normalizeUsername(username) || 'anon'}`}
            catalog={catalog}
            sourceItems={{
              top: topSeries,
              recentlyAdded: recentlyAddedSeries,
              leavingSoon: seriesLeavingSoonView,
              worthToWait: seriesWorthToWaitView,
            }}
            loading={seriesLoading}
            behindHeader={false}
            sectionLabel="Series"
            sectionCta={{ href: '/series', label: 'Go to Series' }}
          />
        ) : null}

        <HomeLiveHero session={session} kidsMode={kidsMode} behindHeader={false} />
      </section>
    </Protected>
  );
}
