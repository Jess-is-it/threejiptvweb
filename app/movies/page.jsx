'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import Protected from '../../components/Protected';
import Row from '../../components/Row';
import { useSession } from '../../components/SessionProvider';
import CatalogHero from '../../components/CatalogHero';
import MoviesInitialLoader from '../../components/MoviesInitialLoader';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import {
  catalogItemMatchesGenre,
  getCatalogSettings,
  parseCatalogRowToken,
  selectRotatingCategory,
} from '../../lib/catalogSettings';
import HoverMovieCard from '../../components/HoverMovieCard';
import { clearMovieReturnState, readMovieReturnState } from '../../lib/moviePlaySeed';
import {
  prefetchLeavingSoonCatalog,
  prefetchMovieCatalog,
  prefetchUpcomingCatalog,
  readLeavingSoonCatalog,
  readMovieCatalog,
  readUpcomingCatalog,
} from '../../lib/publicCatalogCache';
import { getCardPosterFallbackSrc, getCardPosterSrc } from '../../lib/catalogPoster';

const ALL_MOVIES_VISIBILITY_TOP_OFFSET = 120;
const ALL_MOVIES_VISIBILITY_BOTTOM_OFFSET = 120;
const ALL_MOVIES_LOAD_MORE_ROOT_MARGIN = '2600px 0px';
const ALL_MOVIES_INITIAL_ROWS = 4;
const ALL_MOVIES_BATCH_ROWS = 6;
const ALL_MOVIES_EAGER_ROWS = 6;
const ALL_MOVIES_PRELOAD_AHEAD_ROWS = 8;
const ALL_MOVIES_BACKGROUND_PRELOAD_ROWS = 8;
const INITIAL_SCREEN_ASSET_TIMEOUT_MS = 6500;
const INITIAL_SCREEN_MIN_READY_ASSETS = 10;
const MOVIES_INITIAL_LOADER_MESSAGES = [
  'Checking database for the latest movies...',
  'Matching fresh artwork with your library...',
  'Loading the first movie cards into view...',
  'Warming up All Movies for smoother scrolling...',
];

function getAllMoviesGridColumns(viewportWidth = 0) {
  const width = Number(viewportWidth || 0);
  if (width >= 1024) return 6;
  if (width >= 768) return 4;
  if (width >= 640) return 3;
  return 2;
}

function allMoviesBatchSize(columns = 6, rows = ALL_MOVIES_BATCH_ROWS) {
  return Math.max(1, Number(columns || 0) || 1) * Math.max(1, Number(rows || 0) || 1);
}

function initialAllMoviesCount(itemCount = 0, columns = 6) {
  return Math.min(itemCount, allMoviesBatchSize(columns, ALL_MOVIES_INITIAL_ROWS));
}

function normalizeMovieItems(items = []) {
  return (Array.isArray(items) ? items : []).map((movie) => ({
    ...movie,
    href: `/movies/${movie.id}`,
    backdrop: movie.backdropImage || movie.backdrop || '',
  }));
}

function pushUniqueItems(target, seen, items, limit) {
  if (!Array.isArray(items) || limit <= 0) return;
  for (const item of items) {
    if (!item || target.length >= limit) break;
    const key = String(item?.id || item?.tmdbId || item?.href || item?.title || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
}

function pushUniqueSources(target, seen, values, limit = Infinity) {
  for (const value of values) {
    if (target.length >= limit) break;
    const src = String(value || '').trim();
    if (!src || seen.has(src)) continue;
    seen.add(src);
    target.push(src);
  }
}

export default function MoviesPage() {
  const { session } = useSession();
  const { settings } = usePublicSettings();
  const username = String(session?.user?.username || '').trim();
  const [all, setAll] = useState([]);
  const [worthToWait, setWorthToWait] = useState([]);
  const [leavingSoon, setLeavingSoon] = useState([]);
  const [worthToWaitLoading, setWorthToWaitLoading] = useState(true);
  const [leavingSoonLoading, setLeavingSoonLoading] = useState(true);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [initialScreenAssetsReady, setInitialScreenAssetsReady] = useState(false);
  const [showHeroJump, setShowHeroJump] = useState(false);
  const [restoreState, setRestoreState] = useState(null);
  const [allMoviesColumns, setAllMoviesColumns] = useState(6);
  const [allMoviesRenderedCount, setAllMoviesRenderedCount] = useState(0);
  const allMoviesSectionRef = useRef(null);
  const allMoviesLoadMoreRef = useRef(null);
  const prefetchedAllMoviePosterSrcsRef = useRef(new Set());
  const restoreAppliedRef = useRef(false);

  useEffect(() => {
    const currentHref =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}${window.location.hash}`
        : '/movies';
    const nextRestoreState = readMovieReturnState();
    if (!nextRestoreState || nextRestoreState.href !== currentHref) return;
    setRestoreState(nextRestoreState);
  }, []);

  useEffect(() => {
    const onPageShow = (event) => {
      if (event?.persisted) {
        clearMovieReturnState();
        setRestoreState(null);
        restoreAppliedRef.current = true;
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    if (!session?.streamBase) return;
    let alive = true;
    let pollTimer = null;

    const cachedCatalog = readMovieCatalog(session.streamBase);
    if (cachedCatalog?.ok) {
      setAll(normalizeMovieItems(cachedCatalog.items));
      setErr('');
      setLoading(false);
    }

    const loadMovies = async ({ silent = false } = {}) => {
      if (!silent && !cachedCatalog?.ok) setLoading(true);
      try {
        const vodRes = await prefetchMovieCatalog(session.streamBase);
        if (!alive) return;
        if (!vodRes.ok) throw new Error(vodRes.error || 'Failed to load movies');
        setAll(normalizeMovieItems(vodRes.items));
        setErr('');
      } catch (e) { if (alive) setErr(e.message || 'Network error'); }
      finally {
        if (alive && !silent) setLoading(false);
      }
    };

    loadMovies({ silent: Boolean(cachedCatalog?.ok) });
    pollTimer = setInterval(() => {
      loadMovies({ silent: true });
    }, 60 * 1000);

    return () => {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [session?.streamBase]);

  useEffect(() => {
    let alive = true;
    const upcomingCached = readUpcomingCatalog({ username, mediaType: 'movie', limit: 120 });
    const leavingCached = readLeavingSoonCatalog({ mediaType: 'movie', limit: 120 });

    if (upcomingCached?.ok && Array.isArray(upcomingCached.items)) {
      setWorthToWait(upcomingCached.items);
      setWorthToWaitLoading(false);
    } else {
      setWorthToWaitLoading(true);
    }

    if (leavingCached?.ok && Array.isArray(leavingCached.items)) {
      setLeavingSoon(leavingCached.items);
      setLeavingSoonLoading(false);
    } else {
      setLeavingSoonLoading(true);
    }

    (async () => {
      try {
        const [upcomingRes, leavingRes] = await Promise.all([
          prefetchUpcomingCatalog({ username, mediaType: 'movie', limit: 120 }),
          prefetchLeavingSoonCatalog({ mediaType: 'movie', limit: 120 }),
        ]);
        if (!alive) return;
        setWorthToWait(Array.isArray(upcomingRes?.items) ? upcomingRes.items : []);
        setLeavingSoon(Array.isArray(leavingRes?.items) ? leavingRes.items : []);
      } catch {
        if (alive) setWorthToWait([]);
        if (alive) setLeavingSoon([]);
      } finally {
        if (alive) {
          setWorthToWaitLoading(false);
          setLeavingSoonLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [username]);

  useEffect(() => {
    if (loading) return;
    const updateColumns = () => {
      const nextColumns = getAllMoviesGridColumns(window.innerWidth || 0);
      setAllMoviesColumns((current) => (current === nextColumns ? current : nextColumns));
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => {
      window.removeEventListener('resize', updateColumns);
    };
  }, [loading]);

  useEffect(() => {
    if (loading || !all.length) return;

    const baseCount = initialAllMoviesCount(all.length, allMoviesColumns);
    setAllMoviesRenderedCount((current) => {
      const targetIndex = Math.max(0, Number(restoreState?.allMoviesIndex || 0) || 0);
      const restoreCount = restoreState
        ? Math.min(all.length, Math.max(baseCount, targetIndex + allMoviesBatchSize(allMoviesColumns, 2)))
        : baseCount;
      const nextCount = Math.max(current, restoreCount);
      return nextCount === current ? current : nextCount;
    });
  }, [all.length, allMoviesColumns, loading, restoreState]);

  useEffect(() => {
    if (loading) return;
    if (allMoviesRenderedCount >= all.length) return;
    const loadMoreEl = allMoviesLoadMoreRef.current;
    if (!loadMoreEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setAllMoviesRenderedCount((current) => {
          if (current >= all.length) return current;
          return Math.min(all.length, current + allMoviesBatchSize(allMoviesColumns, ALL_MOVIES_BATCH_ROWS));
        });
      },
      { rootMargin: ALL_MOVIES_LOAD_MORE_ROOT_MARGIN }
    );

    observer.observe(loadMoreEl);
    return () => observer.disconnect();
  }, [all.length, allMoviesColumns, allMoviesRenderedCount, loading]);

  const catalog = useMemo(() => getCatalogSettings(settings || {}), [settings]);
  const byRating = useMemo(() => [...all].sort((a, b) => (b.rating || 0) - (a.rating || 0)), [all]);
  const topMovies = useMemo(
    () =>
      selectRotatingCategory(byRating, {
        ...catalog.categories.topMovies,
        displayCount: catalog.categories.topMovies.displayCount,
      }),
    [byRating, catalog]
  );
  const byAdded  = useMemo(
    () =>
      [...all]
        .sort((a, b) => {
          const aAdded = Number(a?.added || 0) || 0;
          const bAdded = Number(b?.added || 0) || 0;
          if (bAdded !== aAdded) return bAdded - aAdded;

          const aId = Number(a?.id || 0);
          const bId = Number(b?.id || 0);
          if (Number.isFinite(aId) && Number.isFinite(bId) && bId !== aId) return bId - aId;
          return String(b?.id || '').localeCompare(String(a?.id || ''));
        })
        .slice(0, catalog.categories.recentlyAddedMovies.displayCount),
    [all, catalog]
  );
  const recommended = useMemo(
    () =>
      byRating
        .slice(5)
        .slice(0, catalog.categories.recommendedMovies.displayCount),
    [byRating, catalog]
  );
  const movieLayoutRows = useMemo(
    () => (Array.isArray(catalog.layouts?.moviesPage?.rows) ? catalog.layouts.moviesPage.rows : []),
    [catalog.layouts?.moviesPage?.rows]
  );
  const movieGenreRows = useMemo(() => {
    const displayCount = Number(catalog.categories.movieGenreRows.displayCount || 0);
    if (displayCount <= 0) return new Map();

    const out = new Map();
    for (const token of movieLayoutRows) {
      const row = parseCatalogRowToken(token);
      if (!row || row.kind !== 'genre') continue;
      const items = all.filter((item) => catalogItemMatchesGenre(item, row.name)).slice(0, displayCount);
      if (!items.length) continue;
      out.set(row.name, items);
    }
    return out;
  }, [all, movieLayoutRows, catalog.categories.movieGenreRows.displayCount]);
  const visibleItems = useMemo(
    () => all.slice(0, allMoviesRenderedCount),
    [all, allMoviesRenderedCount]
  );
  const initialLoaderPosterItems = useMemo(() => {
    const items = [];
    const seen = new Set();
    const allMoviesInitialCount = Math.max(36, allMoviesColumns * 8);

    pushUniqueItems(items, seen, topMovies, 6);
    pushUniqueItems(items, seen, byAdded, 10);
    pushUniqueItems(items, seen, recommended, 14);
    pushUniqueItems(items, seen, all, allMoviesInitialCount);
    pushUniqueItems(items, seen, worthToWait, allMoviesInitialCount + 4);
    pushUniqueItems(items, seen, leavingSoon, allMoviesInitialCount + 8);

    return items;
  }, [all, allMoviesColumns, byAdded, leavingSoon, recommended, topMovies, worthToWait]);
  const initialLoaderBackdropSources = useMemo(() => {
    const sources = [];
    const seen = new Set();
    const candidates = [topMovies[0], byAdded[0], recommended[0], worthToWait[0], leavingSoon[0]];
    pushUniqueSources(
      sources,
      seen,
      candidates.map((item) => item?.backdropImage || item?.backdrop || ''),
      3
    );
    return sources;
  }, [byAdded, leavingSoon, recommended, topMovies, worthToWait]);
  const showInitialMoviesLoader =
    loading ||
    worthToWaitLoading ||
    leavingSoonLoading ||
    !initialScreenAssetsReady;

  useEffect(() => {
    if (loading) {
      setInitialScreenAssetsReady(false);
    }
  }, [loading]);

  useEffect(() => {
    if (loading || worthToWaitLoading || leavingSoonLoading) return;
    if (initialScreenAssetsReady) return;
    if (typeof window === 'undefined') return;

    const sources = [];
    const seen = new Set();
    pushUniqueSources(sources, seen, initialLoaderBackdropSources, 3);
    pushUniqueSources(
      sources,
      seen,
      initialLoaderPosterItems.map((item) => getCardPosterSrc(item) || getCardPosterFallbackSrc(item)),
      24
    );

    if (!sources.length) {
      setInitialScreenAssetsReady(true);
      return;
    }

    let cancelled = false;
    let settled = 0;
    let done = false;
    const targetReadyCount = Math.min(
      sources.length,
      Math.max(INITIAL_SCREEN_MIN_READY_ASSETS, allMoviesColumns * 3)
    );
    const images = [];

    const finish = () => {
      if (cancelled || done) return;
      done = true;
      setInitialScreenAssetsReady(true);
    };

    const markSettled = () => {
      if (cancelled || done) return;
      settled += 1;
      if (settled >= targetReadyCount) finish();
    };

    const timeout = window.setTimeout(finish, INITIAL_SCREEN_ASSET_TIMEOUT_MS);

    for (const src of sources) {
      const img = new window.Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.onload = markSettled;
      img.onerror = markSettled;
      img.src = src;
      if (img.complete) {
        window.setTimeout(markSettled, 0);
      }
      images.push(img);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      for (const img of images) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [
    allMoviesColumns,
    initialLoaderBackdropSources,
    initialLoaderPosterItems,
    initialScreenAssetsReady,
    leavingSoonLoading,
    loading,
    worthToWaitLoading,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!all.length || !allMoviesColumns) return;

    const nextItems = all.slice(
      allMoviesRenderedCount,
      Math.min(all.length, allMoviesRenderedCount + allMoviesColumns * ALL_MOVIES_PRELOAD_AHEAD_ROWS)
    );
    const prefetched = prefetchedAllMoviePosterSrcsRef.current;
    const preloadedImages = [];

    for (const item of nextItems) {
      const source = getCardPosterSrc(item) || getCardPosterFallbackSrc(item);
      const src = String(source || '').trim();
      if (!src || prefetched.has(src)) continue;
      prefetched.add(src);
      const img = new window.Image();
      img.decoding = 'async';
      img.src = src;
      preloadedImages.push(img);
    }

    return () => {
      for (const img of preloadedImages) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [all, allMoviesColumns, allMoviesRenderedCount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (loading || !initialScreenAssetsReady || !all.length || !allMoviesColumns) return;
    if (!showHeroJump) return;

    const prefetched = prefetchedAllMoviePosterSrcsRef.current;
    const backgroundCandidates = all.slice(
      allMoviesRenderedCount,
      Math.min(all.length, allMoviesRenderedCount + allMoviesColumns * ALL_MOVIES_BACKGROUND_PRELOAD_ROWS)
    );
    const pendingSources = [];

    for (const item of backgroundCandidates) {
      const src = String(getCardPosterSrc(item) || getCardPosterFallbackSrc(item) || '').trim();
      if (!src || prefetched.has(src)) continue;
      prefetched.add(src);
      pendingSources.push(src);
    }

    if (!pendingSources.length) return;

    let cancelled = false;
    let timer = 0;
    let idleId = 0;
    let cursor = 0;
    const chunkSize = Math.max(4, allMoviesColumns);

    const pump = () => {
      if (cancelled) return;
      for (let index = 0; index < chunkSize && cursor < pendingSources.length; index += 1, cursor += 1) {
        const img = new window.Image();
        img.decoding = 'async';
        img.src = pendingSources[cursor];
      }
      if (cursor >= pendingSources.length || cancelled) return;
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(() => {
          idleId = 0;
          pump();
        }, { timeout: 1200 });
      } else {
        timer = window.setTimeout(pump, 250);
      }
    };

    timer = window.setTimeout(pump, 120);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (idleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [all, allMoviesColumns, allMoviesRenderedCount, initialScreenAssetsReady, loading, showHeroJump]);

  useEffect(() => {
    if (!restoreState || restoreAppliedRef.current || loading) return;
    if (!all.length) return;

    const targetScrollY = Math.max(0, Number(restoreState?.scrollY || 0) || 0);
    const targetIndex = Math.max(0, Number(restoreState?.allMoviesIndex || 0) || 0);

    const attemptRestore = () => {
      const minimumCount = Math.min(
        all.length,
        Math.max(
          initialAllMoviesCount(all.length, allMoviesColumns),
          targetIndex + allMoviesBatchSize(allMoviesColumns, 2)
        )
      );
      setAllMoviesRenderedCount((current) => (current >= minimumCount ? current : minimumCount));

      const maxScroll = Math.max(
        0,
        (document.documentElement?.scrollHeight || document.body?.scrollHeight || 0) - window.innerHeight
      );

      window.scrollTo({ top: Math.min(targetScrollY, maxScroll), behavior: 'auto' });
      restoreAppliedRef.current = true;
      clearMovieReturnState();
      setRestoreState(null);
      return true;
    };

    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        attemptRestore();
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [all.length, allMoviesColumns, loading, restoreState]);

  useEffect(() => {
    const updateAllMoviesVisibility = () => {
      const sectionEl = allMoviesSectionRef.current;
      if (!sectionEl) {
        setShowHeroJump(false);
        return;
      }

      const rect = sectionEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const headerH = document.getElementById('site-header')?.offsetHeight || 64;
      const nextVisible =
        rect.top < viewportHeight - ALL_MOVIES_VISIBILITY_TOP_OFFSET &&
        rect.bottom > headerH + ALL_MOVIES_VISIBILITY_BOTTOM_OFFSET;

      setShowHeroJump((current) => (current === nextVisible ? current : nextVisible));
    };

    updateAllMoviesVisibility();
    window.addEventListener('scroll', updateAllMoviesVisibility, { passive: true });
    window.addEventListener('resize', updateAllMoviesVisibility);
    return () => {
      window.removeEventListener('scroll', updateAllMoviesVisibility);
      window.removeEventListener('resize', updateAllMoviesVisibility);
    };
  }, [loading, all.length, allMoviesRenderedCount, movieLayoutRows]);

  const scrollToHero = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <Protected>
      <MoviesInitialLoader
        show={showInitialMoviesLoader}
        messages={MOVIES_INITIAL_LOADER_MESSAGES}
      />

      <section className="py-6 px-4 sm:px-6 lg:px-10">
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        <CatalogHero
          pageKey="moviesPage"
          catalog={catalog}
          sourceItems={{
            top: topMovies,
            recentlyAdded: byAdded,
            leavingSoon,
            recommended,
            worthToWait,
          }}
          loading={loading}
        />

        {movieLayoutRows.map((token) => {
          const row = parseCatalogRowToken(token);
          if (!row) return null;

          if (row.kind === 'genre') {
            const items = movieGenreRows.get(row.name) || [];
            if (!loading && !items.length) return null;
            return <Row key={token} title={row.name} items={items} loading={loading} kind="movie" />;
          }

          if (row.key === 'top') {
            return <Row key={token} title={catalog.labels.moviesPage.top} items={topMovies} loading={loading} kind="movie" />;
          }
          if (row.key === 'recentlyAdded') {
            return <Row key={token} title={catalog.labels.moviesPage.recentlyAdded} items={byAdded} loading={loading} kind="movie" />;
          }
          if (row.key === 'leavingSoon') {
            return <Row key={token} title={catalog.labels.moviesPage.leavingSoon} items={leavingSoon} loading={loading || leavingSoonLoading} kind="movie" priority={true} />;
          }
          if (row.key === 'recommended') {
            return <Row key={token} title={catalog.labels.moviesPage.recommended} items={recommended} loading={loading} kind="movie" />;
          }
          if (row.key === 'worthToWait') {
            return <Row key={token} title={catalog.labels.moviesPage.worthToWait} items={worthToWait} loading={loading || worthToWaitLoading} kind="movie" priority={true} />;
          }
          if (row.key === 'allMovies') {
            return (
              <section
                ref={allMoviesSectionRef}
                key={token}
                className="mt-8"
              >
                <h3 className="mb-4 text-lg font-semibold">{catalog.labels.moviesPage.allMovies}</h3>

                {loading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {Array.from({ length: 24 }, (_, i) => (
                      <div key={`sk-${i}`} className="aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800/70 animate-pulse">
                        <div className="h-full w-full bg-gradient-to-br from-neutral-800 via-neutral-700/40 to-neutral-800" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {visibleItems.map((m, index) => (
                        <HoverMovieCard
                          key={m.id}
                          item={m}
                          eagerImage={index < allMoviesColumns * ALL_MOVIES_EAGER_ROWS}
                          playContext={{
                            source: 'moviesAll',
                            visibleCount: allMoviesRenderedCount,
                            allMoviesIndex: index,
                          }}
                        />
                      ))}
                    </div>
                    {allMoviesRenderedCount < all.length ? (
                      <div ref={allMoviesLoadMoreRef} className="h-px w-full" aria-hidden="true" />
                    ) : null}
                  </>
                )}
              </section>
            );
          }

          return null;
        })}

      </section>

      <button
        type="button"
        onClick={scrollToHero}
        aria-label="Back to hero"
        title="Back to hero"
        className={`fixed bottom-6 right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white shadow-xl backdrop-blur-md transition-all hover:bg-black/80 sm:right-6 ${
          showHeroJump
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <ArrowUp size={20} />
      </button>
    </Protected>
  );
}
