'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Protected from '../../components/Protected';
import Row from '../../components/Row';
import { useSession } from '../../components/SessionProvider';
import HeroDetail from '../../components/HeroDetail';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import { readJsonSafe } from '../../lib/readJsonSafe';
import { getCatalogSettings, selectRotatingCategory } from '../../lib/catalogSettings';
import HoverMovieCard from '../../components/HoverMovieCard';

export default function MoviesPage() {
  const { session } = useSession();
  const { settings } = usePublicSettings();
  const username = String(session?.user?.username || '').trim();
  const [all, setAll] = useState([]);
  const [cats, setCats] = useState([]);
  const [worthToWait, setWorthToWait] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(60);
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!session?.streamBase) return;
    let alive = true;
    let pollTimer = null;

    const loadMovies = async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const [vodRes, catRes] = await Promise.all([
          fetch(`/api/xuione/vod?streamBase=${encodeURIComponent(session.streamBase)}`, { cache: 'no-store' }).then(readJsonSafe),
          fetch(`/api/xuione/vod/categories?streamBase=${encodeURIComponent(session.streamBase)}`, { cache: 'no-store' }).then(readJsonSafe),
        ]);
        if (!alive) return;
        if (!vodRes.ok) throw new Error(vodRes.error || 'Failed to load movies');
        const items = (vodRes.items || []).map(m => ({
          ...m,
          href: `/movies/${m.id}`,
          backdrop: m.image,
        }));
        setAll(items);
        setCats(catRes?.categories || []);
        setErr('');
        if (!silent) setVisible(60);
      } catch (e) { if (alive) setErr(e.message || 'Network error'); }
      finally { if (alive && !silent) setLoading(false); }
    };

    loadMovies({ silent: false });
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
        const r = await fetch(`/api/public/autodownload/upcoming?${sp.toString()}`, { cache: 'no-store' });
        const d = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !d?.ok) throw new Error(d?.error || 'Failed to load upcoming queue');
        const items = (Array.isArray(d?.items) ? d.items : []).filter((x) => String(x?.mediaType || '').toLowerCase() === 'movie');
        setWorthToWait(items);
      } catch {
        if (alive) setWorthToWait([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username]);

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
  const visibleItems = useMemo(() => all.slice(0, visible), [all, visible]);
  const heroItem = useMemo(() => {
    const i = byAdded[0];
    if (!i) return null;
    return { ...i, title: i.title, overview: '', duration: i.duration, rating: i.rating, year: i.year, genre: i.genre, image: i.backdrop };
  }, [byAdded]);

  useEffect(() => {
    if (loading) return;
    if (!sentinelRef.current) return;
    if (visible >= all.length) return;

    const el = sentinelRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e?.isIntersecting) setVisible((v) => Math.min(all.length, v + 48));
      },
      { rootMargin: '800px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, visible, all.length]);

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        {heroItem ? (
          <HeroDetail
            item={heroItem}
            onPlay={() => {
              try { sessionStorage.setItem('3jtv.playIntent', String(Date.now())); } catch {}
              window.location.href = `/watch/movie/${heroItem.id}?auto=1`;
            }}
            buttons={(
              <>
                <a target="_blank" rel="noreferrer" href={heroItem.trailer || '#'} className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">Trailer</a>
                <button className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">+ Watchlist</button>
                <button className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">👍 Like</button>
                <button className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">👎 Dislike</button>
              </>
            )}
            height="min-h-[58vh] md:min-h-[62vh]"      // ✅ a bit shorter so rows peek
          />
        ) : loading ? (
          <div className="-mx-4 sm:-mx-6 lg:-mx-10 min-h-[58vh] md:min-h-[62vh] overflow-hidden rounded-xl border border-neutral-900 bg-neutral-950/60">
            <div className="h-full w-full animate-pulse bg-gradient-to-br from-neutral-900 via-neutral-800/30 to-neutral-900" />
          </div>
        ) : null}

        <Row title={catalog.labels.moviesPage.top} items={topMovies} loading={loading} kind="movie" />
        <Row title={catalog.labels.moviesPage.recentlyAdded} items={byAdded} loading={loading} kind="movie" />
        <Row title={catalog.labels.moviesPage.recommended} items={recommended} loading={loading} kind="movie" />
        {cats.slice(0, catalog.categories.movieGenreRows.maxCategories).map(c => (
          <Row
            key={c.id}
            title={c.name}
            items={all
              .filter(m => String(m.category_id)===String(c.id))
              .slice(0, catalog.categories.movieGenreRows.displayCount)}
            kind="movie"
          />
        ))}

        {worthToWait.length || loading ? (
          <Row title={catalog.labels.moviesPage.worthToWait} items={worthToWait} loading={loading} kind="movie" />
        ) : (
          <section className="mt-8">
            <h3 className="mb-3 text-lg font-semibold">{catalog.labels.moviesPage.worthToWait}</h3>
            <p className="text-sm text-neutral-400">No upcoming queued movies right now.</p>
          </section>
        )}

        {/* All movies (infinite scroll grid) */}
        <section className="mt-8">
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
                {visibleItems.map((m) => (
                  <HoverMovieCard
                    key={m.id}
                    item={m}
                  />
                ))}
              </div>

              <div ref={sentinelRef} className="h-10" />
              {visible < all.length ? (
                <div className="mt-3 text-sm text-neutral-400">Loading more…</div>
              ) : all.length ? (
                <div className="mt-3 text-sm text-neutral-500">You’ve reached the end.</div>
              ) : null}
            </>
          )}
        </section>

      </section>
    </Protected>
  );
}
