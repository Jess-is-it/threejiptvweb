'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bookmark, CalendarPlus, Clock3, Film, Play, Star, Trash2, Tv } from 'lucide-react';
import Protected from '../../components/Protected';
import CatalogPosterImage from '../../components/CatalogPosterImage';
import { clearWatchlist, getWatchlist, removeFromWatchlist } from '../../lib/utils';
import { persistMoviePlaySeed, persistMovieReturnState } from '../../lib/moviePlaySeed';

function compactUnit(value, singular, plural = `${singular}s`) {
  return `${value}${value === 1 ? singular : plural}`;
}

function formatAdded(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return 'Saved';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return 'Added just now';

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `Added ${compactUnit(elapsedMinutes, 'min')} ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Added ${compactUnit(elapsedHours, 'hr')} ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `Added ${compactUnit(elapsedDays, 'day')} ago`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  const remainingDays = elapsedDays % 30;
  const monthText = compactUnit(elapsedMonths, 'month');
  const dayText = remainingDays ? ` ${compactUnit(remainingDays, 'day')}` : '';
  return `Added ${monthText}${dayText} ago`;
}

function getDetailsHref(item) {
  const id = String(item?.id || '').trim();
  if (!id) return '#';
  return item?.href || (item?.type === 'series' ? `/series/${id}` : `/movies/${id}`);
}

function getPlayHref(item) {
  const id = String(item?.id || '').trim();
  if (!id) return '#';
  return item?.type === 'series' ? getDetailsHref(item) : `/watch/movie/${id}?auto=1`;
}

export default function BookmarksPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const refreshWatchlist = () => setItems(getWatchlist());
    refreshWatchlist();
    const onStorage = (event) => {
      if (!event || event.key === '3jtv_watchlist_v1') refreshWatchlist();
    };
    const onWatchlistChanged = () => refreshWatchlist();
    window.addEventListener('storage', onStorage);
    window.addEventListener('3jtv:watchlist-changed', onWatchlistChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('3jtv:watchlist-changed', onWatchlistChanged);
    };
  }, []);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(''), 2600);
    return () => clearTimeout(timer);
  }, [message]);

  const counts = useMemo(() => {
    const movies = items.filter((item) => item.type === 'movie').length;
    const series = items.filter((item) => item.type === 'series').length;
    return { all: items.length, movies, series };
  }, [items]);

  const visibleItems = useMemo(() => {
    const filtered =
      filter === 'movie'
        ? items.filter((item) => item.type === 'movie')
        : filter === 'series'
          ? items.filter((item) => item.type === 'series')
          : items;

    return filtered.slice().sort((a, b) => {
      if (sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      if (sort === 'type') {
        const typeSort = String(a.type || '').localeCompare(String(b.type || ''));
        if (typeSort) return typeSort;
      }
      return (Number(b.added || 0) || 0) - (Number(a.added || 0) || 0);
    });
  }, [filter, items, sort]);

  const removeItem = (item) => {
    removeFromWatchlist(item.id, item.type);
    setMessage(`${item?.title || 'Title'} removed from My Watchlist.`);
  };

  const prepareMoviePlayback = (item) => {
    if (item?.type === 'series') return;
    try {
      const currentHref =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}${window.location.hash}`
          : '/bookmarks';
      sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
      persistMovieReturnState({
        href: currentHref,
        movieId: item?.id,
        scrollY: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
      });
      persistMoviePlaySeed(
        {
          id: item?.id,
          title: item?.title,
          image: item?.image,
          plot: item?.plot,
          year: item?.year,
          genre: item?.genre,
          duration: item?.duration,
          rating: item?.rating,
          ext: item?.ext,
        },
        { backHref: currentHref }
      );
    } catch {}
  };

  const clearAll = () => {
    if (!items.length) return;
    if (window.confirm('Remove all titles from My Watchlist?')) {
      clearWatchlist();
      setMessage('My Watchlist cleared.');
    }
  };

  return (
    <Protected>
      <section className="px-4 py-10 sm:px-6 lg:px-10">
        {message ? (
          <div
            role="status"
            aria-live="polite"
            className="fixed right-4 top-24 z-[950] rounded-2xl border border-emerald-400/30 bg-emerald-950/90 px-4 py-3 text-sm font-semibold text-emerald-100 shadow-2xl shadow-black/40 backdrop-blur-md"
          >
            {message}
          </div>
        ) : null}

        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-300">
              <Bookmark size={14} />
              Saved titles
            </div>
            <h1 className="mt-4 text-3xl font-bold md:text-4xl">My Watchlist</h1>
            <p className="mt-2 max-w-2xl text-sm text-neutral-300">
              Titles saved from detail pages appear here with poster art, metadata, quick play, details, and remove controls.
            </p>
          </div>

          <button
            type="button"
            onClick={clearAll}
            disabled={!items.length}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={16} />
            Clear all
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="text-sm text-neutral-400">Total saved</div>
            <div className="mt-2 text-3xl font-bold">{counts.all}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="text-sm text-neutral-400">Movies</div>
            <div className="mt-2 text-3xl font-bold">{counts.movies}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <div className="text-sm text-neutral-400">Series</div>
            <div className="mt-2 text-3xl font-bold">{counts.series}</div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ['all', `All (${counts.all})`],
              ['movie', `Movies (${counts.movies})`],
              ['series', `Series (${counts.series})`],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  filter === key
                    ? 'border-white bg-white text-black'
                    : 'border-white/10 bg-white/10 text-neutral-200 hover:bg-white/15'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="rounded-full border border-white/10 bg-neutral-950 px-4 py-2 text-sm text-white outline-none focus:border-white/40"
            >
              <option value="recent">Recently added</option>
              <option value="title">Title</option>
              <option value="type">Type</option>
            </select>
          </label>
        </div>

        {visibleItems.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => {
              const isMovie = item.type !== 'series';
              const detailsHref = getDetailsHref(item);
              const playHref = getPlayHref(item);
              const metadata = [
                item.year ? String(item.year) : '',
                item.duration ? String(item.duration) : '',
                item.genre ? String(item.genre) : '',
              ].filter(Boolean);

              return (
                <article
                  key={`${item.type}:${item.id}`}
                  className="group overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/70 shadow-2xl shadow-black/20 transition hover:border-white/25"
                >
                  <div className="flex gap-4 p-4">
                    <Link
                      href={detailsHref}
                      className="relative aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-2xl bg-neutral-900 sm:w-32"
                      aria-label={`Open ${item.title || 'saved title'}`}
                    >
                      <CatalogPosterImage item={item} alt={item.title || ''} className="h-full w-full object-cover" />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-70" />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={detailsHref} className="line-clamp-2 text-lg font-semibold text-white hover:underline">
                            {item.title || 'Untitled'}
                          </Link>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-300">
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 font-semibold uppercase tracking-wide">
                              {isMovie ? <Film size={12} /> : <Tv size={12} />}
                              {isMovie ? 'Movie' : 'Series'}
                            </span>
                            {item.rating ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1">
                                <Star size={12} className="fill-amber-300 text-amber-300" />
                                {item.rating}
                              </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1">
                              <CalendarPlus size={12} />
                              {formatAdded(item.added)}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeItem(item)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 text-neutral-300 transition hover:bg-red-500/20 hover:text-red-100"
                          aria-label={`Remove ${item.title || 'title'} from watchlist`}
                          title="Remove from watchlist"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {metadata.length ? <p className="mt-3 line-clamp-1 text-sm text-neutral-300">{metadata.join(' • ')}</p> : null}
                      {item.plot ? <p className="mt-3 line-clamp-2 text-sm text-neutral-400">{item.plot}</p> : null}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Link
                          href={playHref}
                          onClick={() => prepareMoviePlayback(item)}
                          className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-100"
                        >
                          {isMovie ? <Play size={16} /> : <Clock3 size={16} />}
                          {isMovie ? 'Play' : 'Details'}
                        </Link>
                        {isMovie ? (
                          <Link
                            href={detailsHref}
                            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                          >
                            Details
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/[0.06] p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
              <Bookmark size={24} />
            </div>
            <h2 className="mt-4 text-xl font-semibold">No saved titles yet</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-neutral-400">
              Open a movie detail page and click Watchlist to save it here for quick playback later.
            </p>
            <Link
              href="/movies"
              className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-neutral-100"
            >
              Browse movies
            </Link>
          </div>
        )}
      </section>
    </Protected>
  );
}
