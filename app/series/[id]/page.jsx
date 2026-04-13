'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../../components/Protected';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '../../../components/SessionProvider';
import HeroDetail from '../../../components/HeroDetail';
import { readJsonSafe } from '../../../lib/readJsonSafe';
import { addToWatchlist, isInWatchlist, removeFromWatchlist } from '../../../lib/utils';
import { prefetchSeriesCatalog, readSeriesCatalog } from '../../../lib/publicCatalogCache';
import { useProfileMode } from '../../../components/useProfileMode';
import Row from '../../../components/Row';
import { ArrowLeft, Bell, Bookmark, Check } from 'lucide-react';

function tmdbImage(path = '', size = 'w500') {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://image.tmdb.org/t/p/${size}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function normalizeGenreToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function genreTokensFromValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeGenreToken(entry)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((entry) => normalizeGenreToken(entry))
    .filter(Boolean);
}

export default function SeriesDetails() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const { session } = useSession();
  const { mode: profileMode } = useProfileMode();
  const kidsMode = profileMode === 'kids';
  const username = String(session?.user?.username || '').trim();
  const router = useRouter();
  const isUpcoming = String(searchParams?.get('upcoming') || '').trim() === '1';

  const [meta, setMeta] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [leavingSoon, setLeavingSoon] = useState(null);
  const [details, setDetails] = useState(null);
  const [catalogItems, setCatalogItems] = useState([]);
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindText, setRemindText] = useState('');
  const [activeSeason, setActiveSeason] = useState('');
  const [err, setErr] = useState('');
  const [watchlisted, setWatchlisted] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState('');

  useEffect(() => {
    if (isUpcoming) {
      setWatchlisted(false);
      setWatchlistMessage('');
      return;
    }
    setWatchlisted(isInWatchlist(id, 'series'));
  }, [id, isUpcoming]);

  useEffect(() => {
    if (!watchlistMessage) return undefined;
    const timer = setTimeout(() => setWatchlistMessage(''), 2600);
    return () => clearTimeout(timer);
  }, [watchlistMessage]);

  useEffect(() => {
    if (!session?.streamBase) return;
    let alive = true;

    const cached = readSeriesCatalog(session.streamBase, { resolveKids: kidsMode });
    if (cached?.ok && Array.isArray(cached.items)) {
      setCatalogItems(cached.items);
    }

    (async () => {
      try {
        const response = await prefetchSeriesCatalog(session.streamBase, { resolveKids: kidsMode });
        if (!alive) return;
        setCatalogItems(Array.isArray(response?.items) ? response.items : []);
      } catch {
        if (!alive) return;
        if (!cached?.ok) setCatalogItems([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [session?.streamBase, kidsMode]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (isUpcoming) {
          const sp = new URLSearchParams();
          sp.set('tmdbId', String(id));
          sp.set('mediaType', 'tv');
          if (username) sp.set('username', username);
          const r = await fetch(`/api/public/autodownload/upcoming/details?${sp.toString()}`, {
            cache: 'no-store',
          });
          const d = await readJsonSafe(r);
          if (!alive) return;
          if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);
          setUpcoming(d?.upcoming || null);
          setLeavingSoon(null);
          setDetails(d?.details || null);
          setMeta(null);
          setRemindText(d?.upcoming?.reminded ? 'Reminder saved.' : '');
          setErr('');
          return;
        }

        if (!session?.streamBase) return;
        const r = await fetch(`/api/xuione/series/${id}?streamBase=${encodeURIComponent(session.streamBase)}`);
        const d = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !d.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setMeta(d);
        setUpcoming(null);
        setDetails(null);
        setLeavingSoon(null);
        setRemindText('');
        const firstSeason = String(d?.seasons?.[0]?.season || '1');
        setActiveSeason(firstSeason);

        const tmdbDetailParams = new URLSearchParams();
        if (d?.title) tmdbDetailParams.set('title', String(d.title));
        if (d?.year) tmdbDetailParams.set('year', String(d.year));
        tmdbDetailParams.set('kind', 'series');
        tmdbDetailParams.set('mediaType', 'tv');

        const tmdbTrailerParams = new URLSearchParams();
        if (d?.title) tmdbTrailerParams.set('title', String(d.title));
        if (d?.year) tmdbTrailerParams.set('year', String(d.year));
        tmdbTrailerParams.set('kind', 'series');

        const [leavingResult, tmdbDetailsResult, tmdbTrailerResult] = await Promise.allSettled([
          fetch(`/api/public/autodownload/leaving-soon/details?mediaType=series&xuiId=${encodeURIComponent(String(id))}`, {
            cache: 'no-store',
          }).then(async (response) => ({
            ok: response.ok,
            data: await readJsonSafe(response),
          })),
          d?.title
            ? fetch(`/api/tmdb/details?${tmdbDetailParams.toString()}`, { cache: 'no-store' }).then(async (response) => ({
                ok: response.ok,
                data: await readJsonSafe(response),
              }))
            : Promise.resolve(null),
          d?.title
            ? fetch(`/api/tmdb/trailer?${tmdbTrailerParams.toString()}`, { cache: 'no-store' }).then(async (response) => ({
                ok: response.ok,
                data: await readJsonSafe(response),
              }))
            : Promise.resolve(null),
        ]);
        if (!alive) return;

        const leavingPayload =
          leavingResult.status === 'fulfilled' && leavingResult.value?.ok && leavingResult.value?.data?.ok
            ? leavingResult.value.data.item || null
            : null;
        setLeavingSoon(leavingPayload);

        const tmdbPayload =
          tmdbDetailsResult.status === 'fulfilled' && tmdbDetailsResult.value?.ok && tmdbDetailsResult.value?.data?.ok
            ? tmdbDetailsResult.value.data
            : null;
        const trailerPayload =
          tmdbTrailerResult.status === 'fulfilled' && tmdbTrailerResult.value?.ok && tmdbTrailerResult.value?.data?.ok
            ? tmdbTrailerResult.value.data
            : null;

        setDetails(
          tmdbPayload
            ? {
                ...tmdbPayload,
                trailer: trailerPayload?.key
                  ? {
                      key: String(trailerPayload.key || '').trim(),
                      name: String(trailerPayload.name || '').trim(),
                      site: String(trailerPayload.site || '').trim(),
                      type: 'Trailer',
                    }
                  : null,
              }
            : null
        );
        setErr('');
      } catch (e) {
        if (alive) setErr(e?.message || 'Failed to load');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, isUpcoming, session?.streamBase, username]);

  const item = isUpcoming
    ? details
      ? {
          id,
          title: details?.title,
          image: tmdbImage(details?.posterPath, 'w500') || '/images/placeholder.png',
          backdrop: tmdbImage(details?.backdropPath, 'w1280'),
          plot: details?.overview,
          year: String(details?.releaseDate || '').slice(0, 4),
          rating: details?.rating ? Number(details.rating).toFixed(1) : '',
          duration: details?.runtime ? `${details.runtime}m` : '',
          genre: Array.isArray(details?.genres) ? details.genres.join(', ') : '',
        }
      : null
    : meta
      ? {
          id,
          title: meta.title,
          image: tmdbImage(details?.posterPath, 'w500') || meta.image,
          backdrop: tmdbImage(details?.backdropPath, 'w1280') || meta.image,
          plot: details?.overview || meta.plot,
          year: meta.year || String(details?.releaseDate || '').slice(0, 4),
          rating:
            details?.rating !== null && details?.rating !== undefined
              ? Number(details.rating).toFixed(1)
              : meta.rating,
          duration: details?.runtime ? `${details.runtime}m` : null,
          genre:
            Array.isArray(details?.genres) && details.genres.length
              ? details.genres.join(', ')
              : meta.genre,
        }
      : null;

  const currentEpisodes = useMemo(() => {
    const s = meta?.seasons?.find((x) => String(x?.season) === String(activeSeason));
    return s?.episodes || [];
  }, [meta, activeSeason]);

  const castEntries = useMemo(
    () =>
      (Array.isArray(details?.cast) ? details.cast : [])
        .map((entry, index) => {
          if (typeof entry === 'string') {
            return {
              id: `cast-${index}`,
              name: entry,
              character: '',
              profilePath: '',
            };
          }
          return {
            id: entry?.id || `cast-${index}`,
            name: String(entry?.name || '').trim(),
            character: String(entry?.character || '').trim(),
            profilePath: String(entry?.profilePath || '').trim(),
          };
        })
        .filter((entry) => entry.name),
    [details?.cast]
  );

  const currentGenreTokens = useMemo(() => {
    const tokens = new Set([
      ...genreTokensFromValue(Array.isArray(details?.genres) ? details.genres : []),
      ...genreTokensFromValue(item?.genre),
    ]);
    return tokens;
  }, [details?.genres, item?.genre]);

  const moreLikeThis = useMemo(() => {
    const rows = Array.isArray(catalogItems) ? catalogItems : [];
    const currentId = String(id || '').trim();
    const currentYear = String(item?.year || '').trim();

    return rows
      .filter((series) => String(series?.id || '').trim() && String(series.id) !== currentId)
      .map((series) => {
        const seriesGenreTokens = new Set([
          ...genreTokensFromValue(series?.genre),
          ...genreTokensFromValue(series?.categoryName),
        ]);
        let score = 0;
        currentGenreTokens.forEach((token) => {
          if (seriesGenreTokens.has(token)) score += 5;
        });

        if (!score) return { series, score: 0 };
        if (currentYear && String(series?.year || '').trim() === currentYear) score += 1;

        const rating = Number(series?.rating || 0);
        if (Number.isFinite(rating) && rating > 0) score += rating / 10;

        return {
          series: {
            ...series,
            href: series?.href || `/series/${series.id}`,
          },
          score,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const bRating = Number(b.series?.rating || 0) || 0;
        const aRating = Number(a.series?.rating || 0) || 0;
        if (bRating !== aRating) return bRating - aRating;
        return String(a.series?.title || '').localeCompare(String(b.series?.title || ''));
      })
      .slice(0, 18)
      .map((entry) => entry.series);
  }, [catalogItems, currentGenreTokens, id, item?.year]);

  const toggleWatchlist = () => {
    if (!item || isUpcoming) return;
    if (watchlisted) {
      removeFromWatchlist(id, 'series');
      setWatchlisted(false);
      setWatchlistMessage(`${item.title || 'Series'} removed from My Watchlist.`);
      return;
    }
    addToWatchlist({
      id,
      type: 'series',
      title: item.title,
      image: item.image,
      imageFallback: meta?.image || '',
      posterPath: details?.posterPath || '',
      backdrop: item.backdrop,
      plot: item.plot,
      year: item.year,
      rating: item.rating,
      duration: item.duration,
      genre: item.genre,
      tmdbId: details?.tmdbId || '',
      href: `/series/${id}`,
    });
    setWatchlisted(true);
    setWatchlistMessage(`${item.title || 'Series'} added to My Watchlist.`);
  };

  const remind = async () => {
    if (!username || !details?.tmdbId || remindBusy) return;
    setRemindBusy(true);
    try {
      const r = await fetch('/api/public/autodownload/upcoming', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'remind',
          username,
          tmdbId: details.tmdbId,
          mediaType: 'tv',
          title: details?.title || '',
          releaseDate: upcoming?.releaseDate || details?.releaseDate || '',
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save reminder');
      setRemindText('Reminder saved.');
    } catch (e) {
      setRemindText(e?.message || 'Failed to save reminder');
    } finally {
      setRemindBusy(false);
    }
  };

  const heroTrailerKey = String(details?.trailer?.key || '').trim();

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        {watchlistMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="fixed right-4 top-24 z-[950] rounded-2xl border border-emerald-400/30 bg-emerald-950/90 px-4 py-3 text-sm font-semibold text-emerald-100 shadow-2xl shadow-black/40 backdrop-blur-md"
          >
            {watchlistMessage}
          </div>
        ) : null}
        {err ? <p className="mb-3 text-sm text-red-400">{err}</p> : null}
        {item ? (
          <HeroDetail
            item={item}
            showYearInTitle={false}
            trailerKey={heroTrailerKey}
            trailerStartDelayMs={6000}
            onPlay={
              isUpcoming
                ? null
                : () => {
                    const first = currentEpisodes?.[0];
                    if (first) {
                      try {
                        sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
                      } catch {}
                      router.push(`/watch/series/${id}/${first.id}?auto=1`);
                    }
                  }
            }
            topLeftContent={(
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.history.length > 1) {
                    router.back();
                    return;
                  }
                  router.push('/series');
                }}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-white/15 bg-black/55 px-4 text-white backdrop-blur-md transition hover:bg-black/75"
                aria-label="Back"
                title="Back"
              >
                <ArrowLeft size={18} />
                <span>Back</span>
              </button>
            )}
            buttons={(
              <>
                {isUpcoming ? (
                  <button
                    onClick={remind}
                    disabled={remindBusy || !username}
                    className="inline-flex h-12 items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 transition hover:border-neutral-500 disabled:opacity-60"
                  >
                    <Bell size={18} />
                    <span>{remindBusy ? 'Saving…' : 'Remind Me'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleWatchlist}
                    className="inline-flex h-12 items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 transition hover:border-neutral-500"
                    title={watchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                    aria-label={watchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    {watchlisted ? <Check size={18} /> : <Bookmark size={18} />}
                    <span>{watchlisted ? 'Watchlisted' : 'Watchlist'}</span>
                  </button>
                )}
              </>
            )}
            height="min-h-[58vh] md:min-h-[62vh]"
          />
        ) : null}

        {castEntries.length ? (
          <section className="mb-6">
            <h2 className="mb-3 text-lg font-semibold">Cast</h2>
            <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {castEntries.slice(0, 12).map((entry) => (
                <div
                  key={`${entry.id}:${entry.name}`}
                  className="w-28 shrink-0 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3"
                >
                  <div className="aspect-[2/3] overflow-hidden rounded-xl bg-neutral-900">
                    {entry.profilePath ? (
                      <div className="relative h-full w-full">
                        <img
                          src={tmdbImage(entry.profilePath, 'w300')}
                          alt={entry.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-neutral-500">
                        No photo
                      </div>
                    )}
                  </div>
                  <div className="mt-2 line-clamp-2 text-sm font-medium text-neutral-100">{entry.name}</div>
                  {entry.character ? (
                    <div className="mt-1 line-clamp-2 text-xs text-neutral-400">{entry.character}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {!isUpcoming && leavingSoon ? (
          <div className="mb-6 rounded-xl border border-amber-700/50 bg-amber-950/30 p-4">
            <div className="text-sm font-semibold text-amber-100">Leaving soon</div>
            <div className="mt-1 text-sm text-amber-50">Scheduled removal date: {leavingSoon?.deleteDate || '—'}</div>
          </div>
        ) : null}

        {isUpcoming && upcoming ? (
          <div className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-sm font-semibold text-neutral-100">Worth to wait</div>
            <div className="mt-1 text-sm text-neutral-300">
              Release date: {upcoming?.releaseDate || '—'}
              {upcoming?.releaseTag ? ` · ${upcoming.releaseTag}` : ''}
            </div>
            {remindText ? <div className="mt-2 text-xs text-emerald-300">{remindText}</div> : null}
          </div>
        ) : null}

        {isUpcoming ? null : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {(meta?.seasons || []).map((s) => (
                <button
                  key={s.season}
                  onClick={() => setActiveSeason(String(s.season))}
                  className={
                    'rounded-lg border px-3 py-1 text-sm ' +
                    (String(activeSeason) === String(s.season)
                      ? 'border-white bg-white text-black'
                      : 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500')
                  }
                >
                  Season {s.season}
                </button>
              ))}
            </div>

            <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {currentEpisodes.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => {
                    try {
                      sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
                    } catch {}
                    router.push(`/watch/series/${id}/${ep.id}?auto=1`);
                  }}
                  className="group overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-left"
                  title={`S${activeSeason}E${ep.episode} — ${ep.title}`}
                >
                  <div className="aspect-video overflow-hidden bg-neutral-800">
                    {ep.image ? <img src={ep.image} alt={ep.title} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="p-2">
                    <div className="text-xs text-neutral-400">
                      S{activeSeason} • E{ep.episode}
                    </div>
                    <div className="line-clamp-2 text-sm text-neutral-200">{ep.title}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {moreLikeThis.length ? (
          <Row title="More like this" items={moreLikeThis} kind="series" priority={true} />
        ) : (
          <div>
            <h2 className="mb-3 text-lg font-semibold">More like this</h2>
            <p className="text-sm text-neutral-400">
              {isUpcoming
                ? 'This title is queued and will be released on the configured release date.'
                : 'No similar series found in the current library yet.'}
            </p>
          </div>
        )}
      </section>
    </Protected>
  );
}
