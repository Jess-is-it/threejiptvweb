'use client';
import { useEffect, useState } from 'react';
import Protected from '../../components/Protected';
import Hero from '../../components/Hero';
import Row from '../../components/Row';
import { getContinueList } from '../../components/continueStore';
import { useSession } from '../../components/SessionProvider';

export default function Home() {
  const { session } = useSession();
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
        setTopMovies(topM.results || []);
        setTopSeries(topT.results || []);
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

        <Row title="Top Movies" items={topMovies} loading={loading} kind="movie" />
        <Row title="Worth to wait" items={worthToWait} loading={loading} kind="tv" />
        <Row title="Recently Added" items={releasedFromQueue} loading={loading} kind="tv" />
        <Row title="Recently added (Movies & Series)" items={recentMixed} loading={loading} kind="movie" />
        {cont.length ? <Row title="Continue Watching" items={cont} kind="movie" /> : null}
        <Row title="Top 10 in 3J TV" items={top10} loading={loading} kind="movie" />
        <Row title="Recommended Movies" items={recMovies} loading={loading} kind="movie" />
        <Row title="Top Series" items={topSeries} loading={loading} kind="tv" />
        <Row title="Recently added movies" items={recentMovies} loading={loading} kind="movie" />
      </section>
    </Protected>
  );
}
