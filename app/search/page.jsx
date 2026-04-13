'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Protected from '../../components/Protected';
import HoverMovieCard from '../../components/HoverMovieCard';
import { useSession } from '../../components/SessionProvider';
import { readJsonSafe } from '../../lib/readJsonSafe';

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeGenreText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizeTitleKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchTerms(query) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean);
}

function buildSearchHaystack(item) {
  return normalizeSearchText(
    [item?.title, item?.year, item?.genre, item?.categoryName, item?.plot, item?.overview].filter(Boolean).join(' ')
  );
}

function createSearchComparator(query) {
  const normalizedQuery = normalizeSearchText(query);
  return (a, b) => {
    const aTitle = normalizeSearchText(a?.title);
    const bTitle = normalizeSearchText(b?.title);

    const aExact = aTitle === normalizedQuery ? 1 : 0;
    const bExact = bTitle === normalizedQuery ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const aPrefix = aTitle.startsWith(normalizedQuery) ? 1 : 0;
    const bPrefix = bTitle.startsWith(normalizedQuery) ? 1 : 0;
    if (aPrefix !== bPrefix) return bPrefix - aPrefix;

    const aRating = Number(a?.rating || 0) || 0;
    const bRating = Number(b?.rating || 0) || 0;
    if (aRating !== bRating) return bRating - aRating;

    const aAdded = Number(a?.added || 0) || 0;
    const bAdded = Number(b?.added || 0) || 0;
    if (aAdded !== bAdded) return bAdded - aAdded;

    return String(a?.title || '').localeCompare(String(b?.title || ''));
  };
}

function matchItems(items, query) {
  const terms = getSearchTerms(query);
  if (!terms.length) return items.slice();
  return items.filter((item) => {
    const haystack = buildSearchHaystack(item);
    return terms.every((term) => haystack.includes(term));
  });
}

function sortTextResults(items, query) {
  if (!String(query || '').trim()) return items.slice();
  const compare = createSearchComparator(query);
  return items.slice().sort(compare);
}

function matchesGenre(item, genre) {
  const wanted = normalizeGenreText(genre);
  if (!wanted) return true;

  const categoryName = normalizeGenreText(item?.categoryName);
  if (categoryName === wanted) return true;

  const itemGenre = normalizeGenreText(item?.genre);
  if (!itemGenre) return false;
  return itemGenre.split(/\s+/).join('').includes(wanted);
}

function sortFallback(a, b) {
  const aRating = Number(a?.rating || 0) || 0;
  const bRating = Number(b?.rating || 0) || 0;
  if (aRating !== bRating) return bRating - aRating;

  const aAdded = Number(a?.added || 0) || 0;
  const bAdded = Number(b?.added || 0) || 0;
  if (aAdded !== bAdded) return bAdded - aAdded;

  return String(a?.title || '').localeCompare(String(b?.title || ''));
}

function buildRankingLookup(rankings) {
  const byExact = new Map();
  const byTitle = new Map();

  for (const entry of rankings || []) {
    const titleKey = normalizeTitleKey(entry?.title || '');
    const year = String(entry?.year || '').trim();
    const popularity = Number(entry?.popularity || 0) || 0;
    if (!titleKey) continue;

    const exactKey = `${titleKey}|${year}`;
    const prevExact = byExact.get(exactKey);
    if (!prevExact || popularity > prevExact.popularity) {
      byExact.set(exactKey, { popularity });
    }

    const prevTitle = byTitle.get(titleKey);
    if (!prevTitle || popularity > prevTitle.popularity) {
      byTitle.set(titleKey, { popularity });
    }
  }

  return { byExact, byTitle };
}

function getItemPopularity(item, rankingLookup) {
  const titleKey = normalizeTitleKey(item?.title || '');
  const year = String(item?.year || '').trim();
  if (!titleKey) return null;

  const exact = rankingLookup.byExact.get(`${titleKey}|${year}`);
  if (exact) return exact.popularity;

  const fallback = rankingLookup.byTitle.get(titleKey);
  if (fallback) return fallback.popularity;

  return null;
}

function sortByTmdbPopularity(items, rankingLookup) {
  return items.slice().sort((a, b) => {
    const aPopularity = getItemPopularity(a, rankingLookup);
    const bPopularity = getItemPopularity(b, rankingLookup);
    const aHas = aPopularity !== null;
    const bHas = bPopularity !== null;

    if (aHas && bHas && aPopularity !== bPopularity) return bPopularity - aPopularity;
    if (aHas !== bHas) return aHas ? -1 : 1;

    return sortFallback(a, b);
  });
}

function mergeCategories(...lists) {
  const out = [];
  const seen = new Set();

  for (const list of lists) {
    for (const category of list || []) {
      const name = String(category?.name || '').trim();
      if (!name) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: String(category?.id || '').trim(),
        name,
      });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function filterGenreItems(items, genre, rankingLookup) {
  if (!genre) return items.slice();

  const localMatches = items.filter((item) => matchesGenre(item, genre));
  if (localMatches.length) return localMatches;

  const hasTmdbLookup = Boolean(rankingLookup?.byExact?.size || rankingLookup?.byTitle?.size);
  if (!hasTmdbLookup) return [];

  return items.filter((item) => getItemPopularity(item, rankingLookup) !== null);
}

function SearchResultsGrid({ items, kind = 'movie' }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.map((item) => (
        <div key={`${kind}-${item.id}`} className="min-w-0">
          <HoverMovieCard item={item} kind={kind} />
          <div className="mt-2 min-w-0">
            <div className="line-clamp-2 text-sm font-medium text-neutral-100">
              {item?.title || 'Untitled'}
            </div>
            {item?.year ? <div className="mt-1 text-xs text-neutral-500">{item.year}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveResultsGrid({ items }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {items.map((item) => (
        <div key={`live-${item.id}`} className="min-w-0">
          <Link
            href={item.href}
            onClick={() => {
              try {
                sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
              } catch {}
            }}
            className="block"
          >
            <div className="h-16 w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950/60 hover:border-neutral-600 sm:h-20">
              {item?.image ? (
                <img src={item.image} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[11px] text-neutral-500">
                  No Logo
                </div>
              )}
            </div>
            <div className="mt-1 line-clamp-1 text-[11px] font-medium text-neutral-200">
              {item?.title || 'Untitled'}
            </div>
          </Link>
        </div>
      ))}
    </div>
  );
}

function SearchSkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={`search-sk-${index}`} className="aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800/70">
          <div className="h-full w-full animate-pulse bg-gradient-to-br from-neutral-800 via-neutral-700/40 to-neutral-800" />
        </div>
      ))}
    </div>
  );
}

function SearchSuggestionList({ items, loading, query, onSelectItem, onShowResults }) {
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/98 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur">
      {loading ? (
        <div className="px-4 py-3 text-sm text-neutral-400">Loading library suggestions…</div>
      ) : items.length ? (
        <div className="max-h-[420px] overflow-y-auto">
          {items.map((item) => (
            <button
              key={`search-suggestion-${item.kind}-${item.id}`}
              type="button"
              onClick={() => onSelectItem(item)}
              className="flex w-full items-center gap-3 border-b border-neutral-900 px-4 py-3 text-left transition hover:bg-white/5"
            >
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-neutral-900">
                {item?.image ? (
                  <img
                    src={item.image}
                    alt={item?.title || 'Poster'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{item?.title || 'Untitled'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                  <span className="rounded-full border border-neutral-700 px-2 py-0.5 uppercase tracking-[0.18em]">
                    {item?.kind === 'series' ? 'Series' : 'Movie'}
                  </span>
                  {item?.year ? <span>{item.year}</span> : null}
                  {item?.categoryName ? <span className="truncate">{item.categoryName}</span> : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-sm text-neutral-400">No matching titles found yet.</div>
      )}

      <div className="border-t border-neutral-800 bg-neutral-950 px-3 py-2">
        <button
          type="button"
          onClick={onShowResults}
          className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-white transition hover:bg-white/5"
        >
          Show all results for &quot;{trimmedQuery}&quot;
        </button>
      </div>
    </div>
  );
}

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session } = useSession();
  const searchFieldRef = useRef(null);

  const query = String(searchParams?.get('q') || '').trim();
  const genre = String(searchParams?.get('genre') || '').trim();
  const liveCat = String(searchParams?.get('liveCat') || '').trim();
  const deferredQuery = useDeferredValue(query);
  const deferredGenre = useDeferredValue(genre);
  const deferredLiveCat = useDeferredValue(liveCat);

  const [draft, setDraft] = useState(query);
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [liveCategories, setLiveCategories] = useState([]);
  const [liveChannels, setLiveChannels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [genreRanking, setGenreRanking] = useState(null);
  const [genreRankingLoading, setGenreRankingLoading] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    setSuggestionsOpen(false);
  }, [query, genre]);

  useEffect(() => {
    if (!session?.streamBase) return;
    let alive = true;
    setLoading(true);

    (async () => {
      try {
        const qs = `?streamBase=${encodeURIComponent(session.streamBase)}`;
        const [moviesRes, movieCatsRes, seriesRes, seriesCatsRes, liveRes] = await Promise.all([
          fetch(`/api/xuione/vod${qs}`, { cache: 'no-store' }).then(readJsonSafe),
          fetch(`/api/xuione/vod/categories${qs}`, { cache: 'no-store' }).then(readJsonSafe),
          fetch(`/api/xuione/series${qs}`, { cache: 'no-store' }).then(readJsonSafe),
          fetch(`/api/xuione/series/categories${qs}`, { cache: 'no-store' }).then(readJsonSafe),
          fetch('/api/xuione/live', { cache: 'no-store' }).then(readJsonSafe),
        ]);
        if (!alive) return;

        if (!moviesRes?.ok) throw new Error(moviesRes?.error || 'Failed to load movies.');
        if (!seriesRes?.ok) throw new Error(seriesRes?.error || 'Failed to load series.');

        const movieCategoryNames = new Map(
          (movieCatsRes?.categories || []).map((category) => [
            String(category?.id || '').trim(),
            String(category?.name || '').trim(),
          ])
        );
        const seriesCategoryNames = new Map(
          (seriesCatsRes?.categories || []).map((category) => [
            String(category?.id || '').trim(),
            String(category?.name || '').trim(),
          ])
        );
        setCategories(mergeCategories(movieCatsRes?.categories || [], seriesCatsRes?.categories || []));

        if (liveRes?.ok) {
          setLiveCategories(Array.isArray(liveRes?.categories) ? liveRes.categories : []);
          setLiveChannels(Array.isArray(liveRes?.channels) ? liveRes.channels : []);
        } else {
          setLiveCategories([]);
          setLiveChannels([]);
        }

        setMovies(
          (moviesRes.items || []).map((item) => ({
            ...item,
            href: `/movies/${item.id}`,
            kind: 'movie',
            categoryName:
              movieCategoryNames.get(String(item?.category_id || item?.categoryId || '').trim()) ||
              String(item?.category_name || '').trim() ||
              '',
          }))
        );
        setSeries(
          (seriesRes.items || []).map((item) => ({
            ...item,
            href: `/series/${item.id}`,
            kind: 'series',
            categoryName:
              seriesCategoryNames.get(String(item?.category_id || item?.categoryId || '').trim()) ||
              String(item?.category_name || '').trim() ||
              '',
          }))
        );
        setErr('');
      } catch (error) {
        if (alive) {
          setMovies([]);
          setSeries([]);
          setCategories([]);
          setLiveCategories([]);
          setLiveChannels([]);
          setErr(error?.message || 'Failed to load the library.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [session?.streamBase]);

  useEffect(() => {
    if (!deferredGenre) {
      setGenreRanking(null);
      setGenreRankingLoading(false);
      return;
    }

    let alive = true;
    setGenreRankingLoading(true);

    (async () => {
      try {
        const response = await fetch(
          `/api/tmdb/genre-ranking?genre=${encodeURIComponent(deferredGenre)}`,
          { cache: 'no-store' }
        );
        const json = await readJsonSafe(response);
        if (!alive) return;
        if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load genre ranking.');
        setGenreRanking({
          movie: buildRankingLookup(json.movieRankings || []),
          series: buildRankingLookup(json.seriesRankings || []),
        });
      } catch {
        if (alive) setGenreRanking(null);
      } finally {
        if (alive) setGenreRankingLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [deferredGenre]);

  const emptyRankingLookup = useMemo(() => ({ byExact: new Map(), byTitle: new Map() }), []);
  const movieRankingLookup = genreRanking?.movie || emptyRankingLookup;
  const seriesRankingLookup = genreRanking?.series || emptyRankingLookup;

  const moviePool = useMemo(
    () => filterGenreItems(movies, deferredGenre, movieRankingLookup),
    [movies, deferredGenre, movieRankingLookup]
  );
  const seriesPool = useMemo(
    () => filterGenreItems(series, deferredGenre, seriesRankingLookup),
    [series, deferredGenre, seriesRankingLookup]
  );

  const movieMatches = useMemo(
    () => (deferredQuery ? matchItems(moviePool, deferredQuery) : moviePool),
    [moviePool, deferredQuery]
  );
  const seriesMatches = useMemo(
    () => (deferredQuery ? matchItems(seriesPool, deferredQuery) : seriesPool),
    [seriesPool, deferredQuery]
  );

  const movieResults = useMemo(() => {
    if (deferredGenre) {
      return sortByTmdbPopularity(movieMatches, movieRankingLookup);
    }
    return sortTextResults(movieMatches, deferredQuery);
  }, [movieMatches, deferredGenre, deferredQuery, movieRankingLookup]);

  const seriesResults = useMemo(() => {
    if (deferredGenre) {
      return sortByTmdbPopularity(seriesMatches, seriesRankingLookup);
    }
    return sortTextResults(seriesMatches, deferredQuery);
  }, [seriesMatches, deferredGenre, deferredQuery, seriesRankingLookup]);

  const hasLibrarySearch = Boolean(query || genre);
  const baseResults = hasLibrarySearch ? movieResults.length + seriesResults.length : 0;
  const hasActiveSearch = Boolean(query || genre || liveCat);
  const trimmedDraft = draft.trim();
  const deferredDraftQuery = useDeferredValue(trimmedDraft);

  const suggestionItems = useMemo(() => {
    if (!deferredDraftQuery) return [];
    return sortTextResults(matchItems([...movies, ...series], deferredDraftQuery), deferredDraftQuery).slice(0, 8);
  }, [movies, series, deferredDraftQuery]);

  const buildSearchUrl = (nextQuery, nextGenre, nextLiveCat) => {
    const nextParams = new URLSearchParams();
    if (nextGenre) nextParams.set('genre', nextGenre);
    if (nextLiveCat) nextParams.set('liveCat', nextLiveCat);
    if (nextQuery) nextParams.set('q', nextQuery);
    return nextParams.toString() ? `/search?${nextParams.toString()}` : '/search';
  };

  const submitDraftSearch = () => {
    setSuggestionsOpen(false);
    router.replace(buildSearchUrl(trimmedDraft, trimmedDraft ? '' : genre, liveCat));
  };

  const onSubmit = (event) => {
    event.preventDefault();
    submitDraftSearch();
  };

  const applyGenreFilter = (nextGenre) => {
    setSuggestionsOpen(false);
    router.replace(buildSearchUrl(trimmedDraft, nextGenre, liveCat));
  };

  const clearGenreFilter = () => {
    applyGenreFilter('');
  };

  const applyLiveCategoryFilter = (nextLiveCat) => {
    setSuggestionsOpen(false);
    router.replace(buildSearchUrl(trimmedDraft, genre, nextLiveCat));
  };

  const clearLiveCategoryFilter = () => {
    applyLiveCategoryFilter('');
  };

  const onSelectSuggestion = (item) => {
    if (!item?.href) return;
    setSuggestionsOpen(false);
    router.push(item.href);
  };

  const onSearchInputBlur = () => {
    requestAnimationFrame(() => {
      if (!searchFieldRef.current?.contains(document.activeElement)) {
        setSuggestionsOpen(false);
      }
    });
  };

  const heading = genre
    ? query
      ? `Results for "${query}" in ${genre}`
      : `${genre}`
    : query
      ? `Results for "${query}"`
      : 'Start a search';

  const liveCategoryNameById = useMemo(() => {
    const map = new Map();
    for (const category of liveCategories || []) {
      const id = String(category?.id || '').trim();
      const name = String(category?.name || '').trim();
      if (!id || !name) continue;
      map.set(id, name);
    }
    return map;
  }, [liveCategories]);

  const liveItems = useMemo(() => {
    return (liveChannels || [])
      .map((channel) => {
        const id = String(channel?.id || '').trim();
        if (!id) return null;
        const categoryId = String(channel?.category_id || channel?.categoryId || '').trim();
        return {
          id,
          kind: 'live',
          title: String(channel?.name || `CH ${id}`).trim(),
          image: String(channel?.logo || '').trim(),
          categoryId,
          categoryName: categoryId ? String(liveCategoryNameById.get(categoryId) || '').trim() : '',
          href: `/watch/live/${id}?auto=1`,
        };
      })
      .filter(Boolean);
  }, [liveChannels, liveCategoryNameById]);

  const liveResults = useMemo(() => {
    const pool = deferredLiveCat
      ? liveItems.filter((item) => String(item.categoryId) === String(deferredLiveCat))
      : liveItems;
    const matched = deferredQuery ? matchItems(pool, deferredQuery) : pool;
    return sortTextResults(matched, deferredQuery);
  }, [liveItems, deferredQuery, deferredLiveCat]);

  const liveShouldShow = Boolean(hasActiveSearch && (deferredQuery || deferredLiveCat) && liveResults.length);
  const totalResultsCount = baseResults + (liveShouldShow ? liveResults.length : 0);

  return (
    <Protected>
      <section className="px-4 py-6 sm:px-6 lg:px-10">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">Search</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Find Movies, Series, And Live TV
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">
            Search across your current 3J TV library by title, year, or keywords.
          </p>

          <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <div ref={searchFieldRef} className="relative flex-1">
              <label className="block">
                <span className="sr-only">Search your library</span>
                <input
                  value={draft}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDraft(nextValue);
                    setSuggestionsOpen(Boolean(nextValue.trim()));
                  }}
                  onFocus={() => {
                    if (trimmedDraft) setSuggestionsOpen(true);
                  }}
                  onBlur={onSearchInputBlur}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSuggestionsOpen(false);
                    }
                  }}
                  placeholder="Search movies, series, live TV..."
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-white outline-none ring-2 ring-transparent placeholder:text-neutral-500 focus:border-neutral-700 focus:ring-white/10"
                />
              </label>

              {suggestionsOpen ? (
                <SearchSuggestionList
                  items={suggestionItems}
                  loading={loading}
                  query={trimmedDraft}
                  onSelectItem={onSelectSuggestion}
                  onShowResults={submitDraftSearch}
                />
              ) : null}
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-5 py-3 text-sm font-semibold text-white hover:brightness-110"
            >
              <Search size={18} />
              Search
            </button>
          </form>

          {genre ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200">
                <span className="text-neutral-400">Genre</span>
                <span className="font-medium text-white">{genre}</span>
              </div>
              <button
                type="button"
                onClick={clearGenreFilter}
                className="inline-flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white"
              >
                <X size={14} />
                Clear genre
              </button>
            </div>
          ) : null}

          {categories.length ? (
            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">Movie Genres</div>
                <div className="text-xs text-neutral-500">
                  Select a genre to filter movies and series together
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearGenreFilter}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    genre
                      ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white'
                      : 'border-[var(--brand)] bg-[var(--brand)]/15 text-white'
                  }`}
                >
                  All
                </button>

                {categories.map((category) => {
                  const active = normalizeGenreText(category.name) === normalizeGenreText(genre);
                  return (
                    <button
                      key={`search-genre-${category.name.toLowerCase()}`}
                      type="button"
                      onClick={() => applyGenreFilter(category.name)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        active
                          ? 'border-[var(--brand)] bg-[var(--brand)]/15 text-white'
                          : 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white'
                      }`}
                    >
                      {category.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {liveCategories.length ? (
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">Live TV Categories</div>
                <div className="text-xs text-neutral-500">Filter Live TV results below</div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearLiveCategoryFilter}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    liveCat
                      ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white'
                      : 'border-[var(--brand)] bg-[var(--brand)]/15 text-white'
                  }`}
                >
                  All
                </button>

                {liveCategories.map((category) => {
                  const id = String(category?.id || '').trim();
                  const name = String(category?.name || '').trim();
                  if (!id || !name) return null;
                  const active = String(id) === String(liveCat);
                  return (
                    <button
                      key={`search-livecat-${id}`}
                      type="button"
                      onClick={() => applyLiveCategoryFilter(id)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        active
                          ? 'border-[var(--brand)] bg-[var(--brand)]/15 text-white'
                          : 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {err ? <p className="mt-6 text-sm text-red-400">{err}</p> : null}

        {!hasActiveSearch ? (
          <section className="mt-8 rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center">
            <h2 className="text-lg font-semibold text-white">{heading}</h2>
            <p className="mt-2 text-sm text-neutral-400">
              Use the box above to search your movies, series, and live TV.
            </p>
          </section>
        ) : null}

        {hasActiveSearch ? (
          <section className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">
                  {genre ? (
                    <>
                      Genre <span className="text-[var(--brand)]">{genre}</span>
                      {query ? (
                        <>
                          {' '}
                          with <span className="text-white/90">&quot;{query}&quot;</span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    query ? (
                      <>
                        Results for <span className="text-[var(--brand)]">&quot;{query}&quot;</span>
                      </>
                    ) : liveCat ? (
                      <>
                        Live TV{' '}
                        <span className="text-[var(--brand)]">
                          {liveCategoryNameById.get(String(liveCat)) || 'Category'}
                        </span>
                      </>
                    ) : (
                      <>Results</>
                    )
                  )}
                </h2>
                <p className="mt-1 text-sm text-neutral-400">
                  {loading
                    ? 'Searching your library…'
                    : `${totalResultsCount} result${totalResultsCount === 1 ? '' : 's'} found`}
                </p>
              </div>
              {genre ? (
                <div className="text-right text-xs text-neutral-500">
                  {genreRankingLoading ? 'Sorting by TMDB popularity…' : 'Sorted by TMDB popularity'}
                </div>
              ) : null}
            </div>

            {loading ? (
              <div className="mt-5">
                <SearchSkeletonGrid />
              </div>
            ) : null}

            {!loading && !totalResultsCount ? (
              <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 text-center">
                <h3 className="text-lg font-semibold text-white">No results found</h3>
                <p className="mt-2 text-sm text-neutral-400">
                  {genre
                    ? 'Try a different genre, or search within this genre by title or year.'
                    : 'Try a different title, a shorter phrase, or a release year.'}
                </p>
              </div>
            ) : null}

            {!loading && hasLibrarySearch && movieResults.length ? (
              <section className="mt-6">
                <h3 className="mb-4 text-lg font-semibold text-white">Movies ({movieResults.length})</h3>
                <SearchResultsGrid items={movieResults} kind="movie" />
              </section>
            ) : null}

            {!loading && hasLibrarySearch && seriesResults.length ? (
              <section className="mt-8">
                <h3 className="mb-4 text-lg font-semibold text-white">Series ({seriesResults.length})</h3>
                <SearchResultsGrid items={seriesResults} kind="series" />
              </section>
            ) : null}

            {!loading && liveShouldShow ? (
              <section className="mt-8">
                <h3 className="mb-4 text-lg font-semibold text-white">Live TV ({liveResults.length})</h3>
                <LiveResultsGrid items={liveResults} />
              </section>
            ) : null}
          </section>
        ) : null}
      </section>
    </Protected>
  );
}
