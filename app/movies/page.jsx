'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import Protected from '../../components/Protected';
import Row from '../../components/Row';
import { useSession } from '../../components/SessionProvider';
import CatalogHero from '../../components/CatalogHero';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import { readJsonSafe } from '../../lib/readJsonSafe';
import {
  catalogItemMatchesGenre,
  getCatalogSettings,
  parseCatalogRowToken,
  selectRotatingCategory,
} from '../../lib/catalogSettings';
import HoverMovieCard from '../../components/HoverMovieCard';
import { clearMovieReturnState, readMovieReturnState } from '../../lib/moviePlaySeed';
import { prefetchMovieCatalog, readMovieCatalog } from '../../lib/publicCatalogCache';

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
  const { settings } = usePublicSettings();
  const username = String(session?.user?.username || '').trim();
  const [all, setAll] = useState([]);
  const [worthToWait, setWorthToWait] = useState([]);
  const [leavingSoon, setLeavingSoon] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [showHeroJump, setShowHeroJump] = useState(false);
  const [restoreState, setRestoreState] = useState(null);
  const [allMoviesColumns, setAllMoviesColumns] = useState(6);
  const [allMoviesRenderedCount, setAllMoviesRenderedCount] = useState(0);
  const allMoviesSectionRef = useRef(null);
  const allMoviesLoadMoreRef = useRef(null);
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
    (async () => {
      try {
        const sp = new URLSearchParams();
        if (username) sp.set('username', username);
        sp.set('limit', '120');
        const leavingSp = new URLSearchParams();
        leavingSp.set('mediaType', 'movie');
        leavingSp.set('limit', '120');
        const [r, leavingResp] = await Promise.all([
          fetch(`/api/public/autodownload/upcoming?${sp.toString()}`, { cache: 'no-store' }),
          fetch(`/api/public/autodownload/leaving-soon?${leavingSp.toString()}`, { cache: 'no-store' }),
        ]);
        const d = await readJsonSafe(r);
        const leavingJson = await readJsonSafe(leavingResp);
        if (!alive) return;
        if (!r.ok || !d?.ok) throw new Error(d?.error || 'Failed to load upcoming queue');
        const items = (Array.isArray(d?.items) ? d.items : []).filter((x) => String(x?.mediaType || '').toLowerCase() === 'movie');
        setWorthToWait(items);
        setLeavingSoon(leavingResp.ok && leavingJson?.ok && Array.isArray(leavingJson.items) ? leavingJson.items : []);
      } catch {
        if (alive) setWorthToWait([]);
        if (alive) setLeavingSoon([]);
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
            return <Row key={token} title={catalog.labels.moviesPage.leavingSoon} items={leavingSoon} loading={loading} kind="movie" />;
          }
          if (row.key === 'recommended') {
            return <Row key={token} title={catalog.labels.moviesPage.recommended} items={recommended} loading={loading} kind="movie" />;
          }
          if (row.key === 'worthToWait') {
            return <Row key={token} title={catalog.labels.moviesPage.worthToWait} items={worthToWait} loading={loading} kind="movie" />;
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
                          eagerImage={index < allMoviesColumns * 2}
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
