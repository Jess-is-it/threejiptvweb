'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../components/Protected';
import Hero from '../../components/Hero';
import Row from '../../components/Row';
import { getContinueList } from '../../components/continueStore';
import { useSession } from '../../components/SessionProvider';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import { getCatalogSettings, selectRotatingCategory } from '../../lib/catalogSettings';

export default function Home() {
  const { session } = useSession();
  const { settings } = usePublicSettings();
  const username = String(session?.user?.username || '').trim();
  const [heroItems, setHero] = useState([]);
  const [topMovies, setTopMovies] = useState([]);
  const [recentMixed, setRecentMixed] = useState([]);
  const [top10, setTop10] = useState([]);
  const [recMovies, setRecMovies] = useState([]);
  const [topSeries, setTopSeries] = useState([]);
  const [recentMovies, setRecentMovies] = useState([]);
  const [worthToWait, setWorthToWait] = useState([]);
  const [releasedFromQueue, setReleasedFromQueue] = useState([]);
  const [cont, setCont] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // TMDb loads
  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        setLoading(true);
        const [nowM, onAirT, topM, topT, popM, trendM, trendT] = await Promise.all([
          fetch('/api/tmdb/list?type=movie&list=now_playing').then((r) => r.json()),
          fetch('/api/tmdb/list?type=tv&list=on_the_air').then((r) => r.json()),
          fetch('/api/tmdb/list?type=movie&list=top_rated').then((r) => r.json()),
          fetch('/api/tmdb/list?type=tv&list=top_rated').then((r) => r.json()),
          fetch('/api/tmdb/list?type=movie&list=popular').then((r) => r.json()),
          fetch('/api/tmdb/trending?type=movie&window=week').then((r) => r.json()),
          fetch('/api/tmdb/trending?type=tv&window=week').then((r) => r.json()),
        ]);
        if (!ok) return;
        setHero([...(nowM.results || []).slice(0, 5), ...(onAirT.results || []).slice(0, 5)]);

        const moviePoolMap = new Map();
        [...(topM.results || []), ...(popM.results || []), ...(trendM.results || []), ...(nowM.results || [])].forEach(
          (item) => {
            const key = String(item?.id || '');
            if (!key || moviePoolMap.has(key)) return;
            moviePoolMap.set(key, item);
          }
        );
        const moviePool = [...moviePoolMap.values()].sort(
          (a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.popularity || 0) - (a.popularity || 0)
        );
        setTopMovies(moviePool);

        const seriesPoolMap = new Map();
        [...(topT.results || []), ...(trendT.results || []), ...(onAirT.results || [])].forEach((item) => {
          const key = String(item?.id || '');
          if (!key || seriesPoolMap.has(key)) return;
          seriesPoolMap.set(key, item);
        });
        const seriesPool = [...seriesPoolMap.values()].sort(
          (a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.popularity || 0) - (a.popularity || 0)
        );
        setTopSeries(seriesPool);

        setRecMovies(popM.results || []);
        setRecentMovies(nowM.results || []);
        setRecentMixed([
          ...(nowM.results || []).slice(0, 10),
          ...(onAirT.results || []).slice(0, 10),
        ]);
        const topTen = [...(trendM.results || []), ...(trendT.results || [])]
          .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
          .slice(0, 10);
        setTop10(topTen);
      } catch (e) {
        setErr(e.message || 'Failed to load');
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => { ok = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const upcomingSp = new URLSearchParams();
        if (username) upcomingSp.set('username', username);
        upcomingSp.set('limit', '80');

        const releasedSp = new URLSearchParams();
        releasedSp.set('state', 'released');
        releasedSp.set('limit', '80');

        const [upcomingResp, releasedResp] = await Promise.all([
          fetch(`/api/public/autodownload/upcoming?${upcomingSp.toString()}`, { cache: 'no-store' }),
          fetch(`/api/public/autodownload/upcoming?${releasedSp.toString()}`, { cache: 'no-store' }),
        ]);
        const upcomingJson = await upcomingResp.json().catch(() => ({}));
        const releasedJson = await releasedResp.json().catch(() => ({}));
        if (!alive) return;
        if (!upcomingResp.ok || !upcomingJson?.ok) throw new Error(upcomingJson?.error || 'Failed to load upcoming titles');
        setWorthToWait(Array.isArray(upcomingJson.items) ? upcomingJson.items : []);
        setReleasedFromQueue(releasedResp.ok && releasedJson?.ok && Array.isArray(releasedJson.items) ? releasedJson.items : []);
      } catch {
        if (alive) setWorthToWait([]);
        if (alive) setReleasedFromQueue([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username]);

  // Load Continue Watching (✅ correct parentheses)
  useEffect(() => {
    const sync = () => {
      const list = getContinueList();
      setCont(list.map((x) => ({
        id: x.id,
        image: x.image || '',
        title: x.title,
        href: x.href || '',
      })));
    };
    sync();
    const id = setInterval(sync, 2000);
    return () => clearInterval(id);
  }, []);

  const catalog = useMemo(() => getCatalogSettings(settings || {}), [settings]);
  const topMoviesRow = useMemo(() => selectRotatingCategory(topMovies, catalog.categories.topMovies), [topMovies, catalog]);
  const topSeriesRow = useMemo(() => selectRotatingCategory(topSeries, catalog.categories.topSeries), [topSeries, catalog]);
  const recommendedRow = useMemo(
    () => (recMovies || []).slice(0, catalog.categories.recommendedMovies.displayCount),
    [recMovies, catalog]
  );
  const recentMoviesRow = useMemo(
    () => (recentMovies || []).slice(0, catalog.categories.recentlyAddedMovies.displayCount),
    [recentMovies, catalog]
  );

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}
        {heroItems.length ? (
          <Hero items={heroItems} />
        ) : loading ? (
          <div className="mb-8 aspect-[16/7] w-full overflow-hidden rounded-xl border border-neutral-900 bg-neutral-950/60">
            <div className="h-full w-full animate-pulse bg-gradient-to-br from-neutral-900 via-neutral-800/30 to-neutral-900" />
          </div>
        ) : null}

        <Row title={catalog.labels.homePage.topMovies} items={topMoviesRow} loading={loading} kind="movie" />
        <Row title={catalog.labels.homePage.worthToWait} items={worthToWait} loading={loading} kind="tv" />
        <Row title={catalog.labels.homePage.recentlyAdded} items={releasedFromQueue} loading={loading} kind="tv" />
        <Row title={catalog.labels.homePage.recentMixed} items={recentMixed} loading={loading} kind="movie" />
        {cont.length ? <Row title="Continue Watching" items={cont} kind="movie" /> : null}
        <Row title={catalog.labels.homePage.top10} items={top10} loading={loading} kind="movie" />
        <Row title={catalog.labels.homePage.recommendedMovies} items={recommendedRow} loading={loading} kind="movie" />
        <Row title={catalog.labels.homePage.topSeries} items={topSeriesRow} loading={loading} kind="tv" />
        <Row title={catalog.labels.homePage.recentMovies} items={recentMoviesRow} loading={loading} kind="movie" />
      </section>
    </Protected>
  );
}
