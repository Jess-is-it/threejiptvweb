// app/page.jsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Protected from '../components/Protected';
import { useSession } from '../components/SessionProvider';
import { usePublicSettings } from '../components/PublicSettingsProvider';
import Row from '../components/Row';
import HeroCarousel from '../components/HeroCarousel';
import { getContinueList, addToWatchlist } from '../lib/utils';
import { getCatalogSettings, selectRotatingCategory } from '../lib/catalogSettings';

export default function Home() {
  const { session } = useSession();
  const { settings } = usePublicSettings();
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [channels, setChannels] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  // Load all content from Xuione
  useEffect(() => {
    if (!session?.streamBase) return;
    let alive = true;
    setLoading(true);

    (async () => {
      try {
        const qs = `?streamBase=${encodeURIComponent(session.streamBase)}`;
        const [mRes, sRes, lRes] = await Promise.all([
          fetch(`/api/xuione/vod${qs}`).then((r) => r.json()),
          fetch(`/api/xuione/series${qs}`).then((r) => r.json()),
          fetch(`/api/xuione/live${qs}`)
            .then((r) => r.json())
            .catch(() => ({ ok: false })),
        ]);
        if (!alive) return;

        if (!mRes.ok) throw new Error(mRes.error || 'Failed to load movies');
        if (!sRes.ok) throw new Error(sRes.error || 'Failed to load series');

        setMovies((mRes.items || []).map((x) => ({ ...x, kind: 'movie', href: `/movies/${x.id}` })));
        setSeries((sRes.items || []).map((x) => ({ ...x, kind: 'series', href: `/series/${x.id}` })));

        if (lRes?.ok) {
          const chans = (lRes.channels || []).map((ch) => ({
            id: ch.id,
            title: ch.name,
            image: ch.logo,
            kind: 'live',
            href: `/watch/live/${ch.id}`,
          }));
          setChannels(chans);
        } else {
          setChannels([]);
        }

        setErr('');
      } catch (e) {
        if (alive) setErr(e.message || 'Network error');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [session?.streamBase]);

  // Rows
  const catalog = useMemo(() => getCatalogSettings(settings || {}), [settings]);
  const topMoviesRanked = useMemo(() => [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)), [movies]);
  const topMovies = useMemo(
    () => selectRotatingCategory(topMoviesRanked, catalog.categories.topMovies),
    [topMoviesRanked, catalog]
  );
  const recentMovies = useMemo(
    () =>
      [...movies]
        .sort((a, b) => (b.added || 0) - (a.added || 0))
        .slice(0, catalog.categories.recentlyAddedMovies.displayCount),
    [movies, catalog]
  );
  const topSeriesRanked = useMemo(() => [...series].sort((a, b) => (b.rating || 0) - (a.rating || 0)), [series]);
  const topSeries = useMemo(
    () => selectRotatingCategory(topSeriesRanked, catalog.categories.topSeries),
    [topSeriesRanked, catalog]
  );
  const recentMixed = useMemo(
    () => [...movies, ...series].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 20),
    [movies, series]
  );
  const continueList = useMemo(
    () =>
      getContinueList().map((x) => ({
        id: x.id,
        title: x.title,
        image: x.image,
        kind: x.type === 'movie' ? 'movie' : 'series',
        href:
          x.type === 'movie'
            ? `/watch/movie/${x.id}`
            : x.sid
            ? `/watch/series/${x.sid}/${x.id}`
            : '#',
      })),
    []
  );

  // Hero items for the carousel (grab a few good candidates)
  const heroItems = useMemo(() => {
    const candidates = [
      ...(recentMixed || []),
      ...(topMovies || []),
      ...(topSeries || []),
    ].filter(Boolean);
    // fallback if lists are short
    return (candidates.length ? candidates : [...movies, ...series]).slice(0, 5);
  }, [recentMixed, topMovies, topSeries, movies, series]);

  // Hero actions
  const handleHeroPlay = (item) => {
    // Movies: play directly. Series: open details (episodes).
    if ((item.kind || '').toLowerCase() === 'series') {
      window.location.href = `/series/${item.id}`;
    } else {
      try {
        sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
      } catch {}
      window.location.href = `/watch/movie/${item.id}?auto=1`;
    }
  };

  const handleHeroAdd = (item) => {
    addToWatchlist({
      id: item.id,
      type: (item.kind || 'movie').toLowerCase(),
      title: item.title,
      image: item.image || item.poster || item.backdrop,
    });
  };

  const handleHeroDetails = (item) => {
    const href =
      (item.kind || '').toLowerCase() === 'series'
        ? `/series/${item.id}`
        : `/movies/${item.id}`;
    window.location.href = href;
  };

  return (
    <Protected>
      {/* FULL-BLEED HERO (slides under fixed header). 
          -mt-16 + pt-16 assumes header height = h-16 (64px). */}
      <div className="-mt-16 pt-16">
        {heroItems.length > 0 ? (
          <HeroCarousel
            items={heroItems}
            autoplayMs={7000}
            onPlay={handleHeroPlay}
            onAdd={handleHeroAdd}
            onDetails={handleHeroDetails}
          />
        ) : loading ? (
          <div className="mx-4 sm:mx-6 lg:mx-10 my-4 min-h-[58vh] md:min-h-[62vh] overflow-hidden rounded-xl border border-neutral-900 bg-neutral-950/60">
            <div className="h-full w-full animate-pulse bg-gradient-to-br from-neutral-900 via-neutral-800/30 to-neutral-900" />
          </div>
        ) : null}
      </div>

      {/* ROWS — add horizontal padding only to content below the hero */}
      <section className="px-4 sm:px-6 lg:px-10 mt-6">
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        {continueList.length > 0 && (
          <Row title="Continue Watching" items={continueList} kind="mixed" />
        )}
        <Row title={catalog.labels.homePage.topMovies} items={topMovies} loading={loading} kind="movie" />
        <Row title={catalog.labels.homePage.recentMixed} items={recentMixed} loading={loading} kind="mixed" />
        <Row title={catalog.labels.homePage.topSeries} items={topSeries} loading={loading} kind="series" />
        <Row title={catalog.labels.homePage.recentMovies} items={recentMovies} loading={loading} kind="movie" />
        {channels.length > 0 && (
          <Row title="Live Channels" items={channels.slice(0, 20)} loading={loading} kind="live" />
        )}
      </section>
    </Protected>
  );
}
