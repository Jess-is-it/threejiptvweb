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
const ALL_MOVIES_DEFER_ROOT_MARGIN = '1200px 0px';
const ALL_MOVIES_GRID_GAP_PX = 12;
const ALL_MOVIES_OVERSCAN_ROWS = 3;
const DEFAULT_ALL_MOVIES_ROW_HEIGHT = 320;

function getAllMoviesGridColumns(viewportWidth = 0) {
  const width = Number(viewportWidth || 0);
  if (width >= 1024) return 6;
  if (width >= 768) return 4;
  if (width >= 640) return 3;
  return 2;
}

function defaultAllMoviesWindow(itemCount = 0, columns = 6) {
  const initialColumns = Math.max(1, Number(columns || 0) || 1);
  const initialEnd = Math.min(itemCount, initialColumns * 4);
  return { startIndex: 0, endIndex: initialEnd };
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
  const [allMoviesReady, setAllMoviesReady] = useState(false);
  const [allMoviesGridMetrics, setAllMoviesGridMetrics] = useState({
    columns: 6,
    rowHeight: DEFAULT_ALL_MOVIES_ROW_HEIGHT,
  });
  const [allMoviesWindow, setAllMoviesWindow] = useState(() => defaultAllMoviesWindow(0, 6));
  const allMoviesSectionRef = useRef(null);
  const allMoviesMountRef = useRef(null);
  const allMoviesGridRef = useRef(null);
  const restoreAppliedRef = useRef(false);

  useEffect(() => {
    const currentHref =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}${window.location.hash}`
        : '/movies';
    const nextRestoreState = readMovieReturnState();
    if (!nextRestoreState || nextRestoreState.href !== currentHref) return;
    setRestoreState(nextRestoreState);
    setAllMoviesReady(true);
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
    if (allMoviesReady || restoreState) return;
    const mountEl = allMoviesMountRef.current;
    if (!mountEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setAllMoviesReady(true);
        }
      },
      { rootMargin: ALL_MOVIES_DEFER_ROOT_MARGIN }
    );
    observer.observe(mountEl);
    return () => observer.disconnect();
  }, [allMoviesReady, restoreState]);

  useEffect(() => {
    if (!allMoviesReady || loading) return;
    const gridEl = allMoviesGridRef.current;
    if (!gridEl) return;

    const updateGridMetrics = () => {
      const nextColumns = getAllMoviesGridColumns(window.innerWidth || 0);
      const width = gridEl.clientWidth || 0;
      const cardWidth =
        width > 0
          ? Math.max(120, (width - ALL_MOVIES_GRID_GAP_PX * Math.max(0, nextColumns - 1)) / nextColumns)
          : 180;
      const nextRowHeight = Math.max(
        DEFAULT_ALL_MOVIES_ROW_HEIGHT,
        Math.ceil(cardWidth * 1.5 + ALL_MOVIES_GRID_GAP_PX)
      );

      setAllMoviesGridMetrics((current) => {
        if (current.columns === nextColumns && current.rowHeight === nextRowHeight) return current;
        return {
          columns: nextColumns,
          rowHeight: nextRowHeight,
        };
      });
    };

    updateGridMetrics();

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateGridMetrics());
      resizeObserver.observe(gridEl);
    }

    window.addEventListener('resize', updateGridMetrics);
    return () => {
      window.removeEventListener('resize', updateGridMetrics);
      resizeObserver?.disconnect();
    };
  }, [allMoviesReady, loading]);

  useEffect(() => {
    if (!allMoviesReady || loading || !all.length) return;

    const updateVisibleWindow = () => {
      const gridEl = allMoviesGridRef.current;
      if (!gridEl) return;

      const columns = Math.max(1, Number(allMoviesGridMetrics.columns || 0) || 1);
      const rowHeight = Math.max(
        DEFAULT_ALL_MOVIES_ROW_HEIGHT,
        Number(allMoviesGridMetrics.rowHeight || 0) || DEFAULT_ALL_MOVIES_ROW_HEIGHT
      );
      const totalRows = Math.max(1, Math.ceil(all.length / columns));
      const gridRect = gridEl.getBoundingClientRect();
      const gridTop = window.scrollY + gridRect.top;
      const viewportTop = window.scrollY;
      const viewportBottom = viewportTop + (window.innerHeight || document.documentElement.clientHeight || 0);
      const viewportStartRow = Math.floor((viewportTop - gridTop) / rowHeight);
      const viewportEndRow = Math.ceil((viewportBottom - gridTop) / rowHeight);
      const startRow = Math.max(0, viewportStartRow - ALL_MOVIES_OVERSCAN_ROWS);
      const endRow = Math.min(totalRows, viewportEndRow + ALL_MOVIES_OVERSCAN_ROWS);
      const nextStartIndex = Math.min(all.length, startRow * columns);
      const nextEndIndex = Math.min(
        all.length,
        Math.max(nextStartIndex + columns * 2, endRow * columns)
      );

      setAllMoviesWindow((current) => {
        if (current.startIndex === nextStartIndex && current.endIndex === nextEndIndex) return current;
        return {
          startIndex: nextStartIndex,
          endIndex: nextEndIndex,
        };
      });
    };

    updateVisibleWindow();
    window.addEventListener('scroll', updateVisibleWindow, { passive: true });
    window.addEventListener('resize', updateVisibleWindow);
    return () => {
      window.removeEventListener('scroll', updateVisibleWindow);
      window.removeEventListener('resize', updateVisibleWindow);
    };
  }, [all.length, allMoviesGridMetrics.columns, allMoviesGridMetrics.rowHeight, allMoviesReady, loading]);

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
  const allMoviesColumns = Math.max(1, Number(allMoviesGridMetrics.columns || 0) || 1);
  const allMoviesRowHeight = Math.max(
    DEFAULT_ALL_MOVIES_ROW_HEIGHT,
    Number(allMoviesGridMetrics.rowHeight || 0) || DEFAULT_ALL_MOVIES_ROW_HEIGHT
  );
  const allMoviesTotalRows = Math.max(0, Math.ceil(all.length / allMoviesColumns));
  const allMoviesStartRow = Math.floor(allMoviesWindow.startIndex / allMoviesColumns);
  const allMoviesEndRow = Math.ceil(allMoviesWindow.endIndex / allMoviesColumns);
  const allMoviesTopPadding = allMoviesStartRow * allMoviesRowHeight;
  const allMoviesBottomPadding = Math.max(0, (allMoviesTotalRows - allMoviesEndRow) * allMoviesRowHeight);
  const visibleItems = useMemo(
    () => all.slice(allMoviesWindow.startIndex, allMoviesWindow.endIndex),
    [all, allMoviesWindow.endIndex, allMoviesWindow.startIndex]
  );

  useEffect(() => {
    if (!restoreState || restoreAppliedRef.current || loading || !allMoviesReady) return;
    if (!all.length) return;

    const targetScrollY = Math.max(0, Number(restoreState?.scrollY || 0) || 0);
    const targetIndex = Math.max(0, Number(restoreState?.allMoviesIndex || 0) || 0);

    const attemptRestore = () => {
      const columns = Math.max(1, Number(allMoviesGridMetrics.columns || 0) || 1);
      const targetRow = Math.floor(targetIndex / columns);
      const nextStartIndex = Math.max(0, (targetRow - ALL_MOVIES_OVERSCAN_ROWS) * columns);
      const nextEndIndex = Math.min(
        all.length,
        Math.max(nextStartIndex + columns * 4, (targetRow + ALL_MOVIES_OVERSCAN_ROWS + 2) * columns)
      );
      setAllMoviesWindow((current) => {
        if (current.startIndex === nextStartIndex && current.endIndex === nextEndIndex) return current;
        return { startIndex: nextStartIndex, endIndex: nextEndIndex };
      });

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
  }, [all.length, allMoviesGridMetrics.columns, allMoviesReady, loading, restoreState]);

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
  }, [loading, all.length, movieLayoutRows]);

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
                style={{ contentVisibility: 'auto', containIntrinsicSize: '1600px' }}
              >
                <h3 className="mb-4 text-lg font-semibold">{catalog.labels.moviesPage.allMovies}</h3>

                {!allMoviesReady && !restoreState ? (
                  <div ref={allMoviesMountRef} className="h-px w-full" aria-hidden="true" />
                ) : loading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {Array.from({ length: 24 }, (_, i) => (
                      <div key={`sk-${i}`} className="aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800/70 animate-pulse">
                        <div className="h-full w-full bg-gradient-to-br from-neutral-800 via-neutral-700/40 to-neutral-800" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    ref={allMoviesGridRef}
                    style={{
                      paddingTop: `${allMoviesTopPadding}px`,
                      paddingBottom: `${allMoviesBottomPadding}px`,
                    }}
                  >
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {visibleItems.map((m, index) => {
                        const allMoviesIndex = allMoviesWindow.startIndex + index;
                        return (
                        <HoverMovieCard
                          key={m.id}
                          item={m}
                          eagerImage={index < allMoviesColumns * 2}
                          playContext={{
                            source: 'moviesAll',
                            visibleCount: allMoviesWindow.endIndex,
                            allMoviesIndex,
                          }}
                        />
                        );
                      })}
                    </div>
                  </div>
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
