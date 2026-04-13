'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import Protected from '../../components/Protected';
import Row from '../../components/Row';
import { useSession } from '../../components/SessionProvider';
import { useProfileMode } from '../../components/useProfileMode';
import CatalogHero from '../../components/CatalogHero';
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
const ALL_MOVIES_LOAD_MORE_ROOT_MARGIN = '1600px 0px';
const ALL_MOVIES_INITIAL_ROWS = 4;
const ALL_MOVIES_BATCH_ROWS = 4;

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
    backdrop: movie.backdropImage || movie.backdrop || movie.image,
  }));
}

export default function MoviesPage() {
  const { session } = useSession();
  const { mode: profileMode } = useProfileMode();
  const kidsMode = profileMode === 'kids';
  const { settings } = usePublicSettings();
  const username = String(session?.user?.username || '').trim();
  const [all, setAll] = useState([]);
  const [worthToWait, setWorthToWait] = useState([]);
  const [leavingSoon, setLeavingSoon] = useState([]);
  const [worthToWaitLoading, setWorthToWaitLoading] = useState(true);
  const [leavingSoonLoading, setLeavingSoonLoading] = useState(true);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [showHeroJump, setShowHeroJump] = useState(false);
  const [restoreState, setRestoreState] = useState(null);
  const [allMoviesColumns, setAllMoviesColumns] = useState(6);
  const [allMoviesRenderedCount, setAllMoviesRenderedCount] = useState(0);
  const allMoviesSectionRef = useRef(null);
  const allMoviesLoadMoreRef = useRef(null);
  const prefetchedAllMoviePosterSrcsRef = useRef(new Set());
  const restoreAppliedRef = useRef(false);

  const allView = useMemo(() => {
    if (!kidsMode) return all;
    return all.filter((item) => item?.kidsSafe === true);
  }, [all, kidsMode]);
  const worthToWaitView = useMemo(() => {
    if (!kidsMode) return worthToWait;
    return worthToWait.filter((item) => item?.kidsSafe === true);
  }, [worthToWait, kidsMode]);
  const leavingSoonView = useMemo(() => {
    if (!kidsMode) return leavingSoon;
    return leavingSoon.filter((item) => item?.kidsSafe === true);
  }, [leavingSoon, kidsMode]);

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

    const cachedCatalog = readMovieCatalog(session.streamBase, { resolveKids: kidsMode });
    if (cachedCatalog?.ok) {
      setAll(normalizeMovieItems(cachedCatalog.items));
      setErr('');
      setLoading(false);
    }

    const loadMovies = async ({ silent = false } = {}) => {
      if (!silent && !cachedCatalog?.ok) setLoading(true);
      try {
        const vodRes = await prefetchMovieCatalog(session.streamBase, { resolveKids: kidsMode });
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
  }, [session?.streamBase, kidsMode]);

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
    if (loading || !allView.length) return;

    const baseCount = initialAllMoviesCount(allView.length, allMoviesColumns);
    setAllMoviesRenderedCount((current) => {
      const targetIndex = Math.max(0, Number(restoreState?.allMoviesIndex || 0) || 0);
      const restoreCount = restoreState
        ? Math.min(allView.length, Math.max(baseCount, targetIndex + allMoviesBatchSize(allMoviesColumns, 2)))
        : baseCount;
      const nextCount = Math.max(current, restoreCount);
      return nextCount === current ? current : nextCount;
    });
  }, [allView.length, allMoviesColumns, loading, restoreState]);

  useEffect(() => {
    if (loading) return;
    if (allMoviesRenderedCount >= allView.length) return;
    const loadMoreEl = allMoviesLoadMoreRef.current;
    if (!loadMoreEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setAllMoviesRenderedCount((current) => {
          if (current >= allView.length) return current;
          return Math.min(allView.length, current + allMoviesBatchSize(allMoviesColumns, ALL_MOVIES_BATCH_ROWS));
        });
      },
      { rootMargin: ALL_MOVIES_LOAD_MORE_ROOT_MARGIN }
    );

    observer.observe(loadMoreEl);
    return () => observer.disconnect();
  }, [allView.length, allMoviesColumns, allMoviesRenderedCount, loading]);

  const catalog = useMemo(() => getCatalogSettings(settings || {}), [settings]);
  const byRating = useMemo(() => [...allView].sort((a, b) => (b.rating || 0) - (a.rating || 0)), [allView]);
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
      [...allView]
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
    [allView, catalog]
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
      const items = allView.filter((item) => catalogItemMatchesGenre(item, row.name)).slice(0, displayCount);
      if (!items.length) continue;
      out.set(row.name, items);
    }
    return out;
  }, [allView, movieLayoutRows, catalog.categories.movieGenreRows.displayCount]);
  const visibleItems = useMemo(
    () => allView.slice(0, allMoviesRenderedCount),
    [allView, allMoviesRenderedCount]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!allView.length || !allMoviesColumns) return;

    const nextItems = allView.slice(
      allMoviesRenderedCount,
      Math.min(allView.length, allMoviesRenderedCount + allMoviesColumns * 2)
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
  }, [allView, allMoviesColumns, allMoviesRenderedCount]);

  useEffect(() => {
    if (!restoreState || restoreAppliedRef.current || loading) return;
    if (!allView.length) return;

    const targetScrollY = Math.max(0, Number(restoreState?.scrollY || 0) || 0);
    const targetIndex = Math.max(0, Number(restoreState?.allMoviesIndex || 0) || 0);

    const attemptRestore = () => {
      const minimumCount = Math.min(
        allView.length,
        Math.max(
          initialAllMoviesCount(allView.length, allMoviesColumns),
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
  }, [allView.length, allMoviesColumns, loading, restoreState]);

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
  }, [loading, allView.length, allMoviesRenderedCount, movieLayoutRows]);

  const scrollToHero = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        <CatalogHero
          pageKey="moviesPage"
          storageKey={`moviesPage:${kidsMode ? 'kids' : 'adult'}`}
          catalog={catalog}
          sourceItems={{
            top: topMovies,
            recentlyAdded: byAdded,
            leavingSoon: leavingSoonView,
            recommended,
            worthToWait: worthToWaitView,
          }}
          loading={loading}
        />

        {kidsMode && !loading && !allView.length ? (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-sm text-neutral-200">
            No kids-safe movies found in the library.
          </div>
        ) : null}

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
            return <Row key={token} title={catalog.labels.moviesPage.leavingSoon} items={leavingSoonView} loading={loading || leavingSoonLoading} kind="movie" priority={true} />;
          }
          if (row.key === 'recommended') {
            return <Row key={token} title={catalog.labels.moviesPage.recommended} items={recommended} loading={loading} kind="movie" />;
          }
          if (row.key === 'worthToWait') {
            return <Row key={token} title={catalog.labels.moviesPage.worthToWait} items={worthToWaitView} loading={loading || worthToWaitLoading} kind="movie" priority={true} />;
          }
          if (row.key === 'allMovies') {
            if (!loading && !allView.length) return null;
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
                          eagerImage={index < allMoviesColumns * 4}
                          playContext={{
                            source: 'moviesAll',
                            visibleCount: allMoviesRenderedCount,
                            allMoviesIndex: index,
                          }}
                        />
                      ))}
                    </div>
                    {allMoviesRenderedCount < allView.length ? (
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
