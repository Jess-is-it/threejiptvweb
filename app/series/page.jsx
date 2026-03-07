'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import Row from '../../components/Row';
import HeroDetail from '../../components/HeroDetail';
import { readJsonSafe } from '../../lib/readJsonSafe';
import { getCatalogSettings, selectRotatingCategory } from '../../lib/catalogSettings';

export default function SeriesPage() {
  const { session } = useSession();
  const { settings } = usePublicSettings();
  const username = String(session?.user?.username || '').trim();
  const [all, setAll] = useState([]);
  const [cats, setCats] = useState([]);
  const [worthToWait, setWorthToWait] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.streamBase) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const [sRes, cRes] = await Promise.all([
          fetch(`/api/xuione/series?streamBase=${encodeURIComponent(session.streamBase)}`).then(readJsonSafe),
          fetch(`/api/xuione/series/categories?streamBase=${encodeURIComponent(session.streamBase)}`).then(readJsonSafe),
        ]);
        if (!alive) return;
        if (!sRes.ok) throw new Error(sRes.error || 'Failed to load series');
        setAll((sRes.items || []).map(s => ({ ...s, href: `/series/${s.id}` })));
        setCats(cRes?.categories || []);
        setErr('');
      } catch (e) { if (alive) setErr(e.message || 'Network error'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
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
        const items = (Array.isArray(d?.items) ? d.items : []).filter((x) => String(x?.mediaType || '').toLowerCase() === 'tv');
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
  const ranked = useMemo(() => [...all].sort((a, b) => (b.rating || 0) - (a.rating || 0)), [all]);
  const top = useMemo(
    () =>
      selectRotatingCategory(ranked, {
        ...catalog.categories.topSeries,
        displayCount: catalog.categories.topSeries.displayCount,
      }),
    [ranked, catalog]
  );
  const recent = useMemo(
    () => [...all].sort((a,b)=>(b.added||0)-(a.added||0)).slice(0, catalog.categories.recentlyAddedSeries.displayCount),
    [all, catalog]
  );
  const heroItem = useMemo(() => {
    const i = recent[0] || top[0] || all[0];
    return i ? { ...i, overview:'', image:i.image } : null;
  }, [recent, top, all]);

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        {heroItem ? (
          <HeroDetail
            item={heroItem}
            onPlay={() => (window.location.href = `/series/${heroItem.id}`)}
            buttons={
              <>
                <a href={`/series/${heroItem.id}`} className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">Open Series</a>
                <button className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">+ Watchlist</button>
              </>
            }
            height="min-h-[58vh] md:min-h-[62vh]"
          />
        ) : loading ? (
          <div className="-mx-4 sm:-mx-6 lg:-mx-10 min-h-[58vh] md:min-h-[62vh] overflow-hidden rounded-xl border border-neutral-900 bg-neutral-950/60">
            <div className="h-full w-full animate-pulse bg-gradient-to-br from-neutral-900 via-neutral-800/30 to-neutral-900" />
          </div>
        ) : null}

        <Row title={catalog.labels.seriesPage.top} items={top} loading={loading} kind="series" />
        <Row title={catalog.labels.seriesPage.recentlyAdded} items={recent} loading={loading} kind="series" />
        {cats.slice(0, catalog.categories.seriesGenreRows.maxCategories).map(c => (
          <Row
            key={c.id}
            title={c.name}
            items={all
              .filter(s => String(s.category_id)===String(c.id))
              .slice(0, catalog.categories.seriesGenreRows.displayCount)}
            kind="series"
          />
        ))}
        {worthToWait.length || loading ? (
          <Row title={catalog.labels.seriesPage.worthToWait} items={worthToWait} loading={loading} kind="series" />
        ) : (
          <section className="mt-8">
            <h3 className="mb-3 text-lg font-semibold">{catalog.labels.seriesPage.worthToWait}</h3>
            <p className="text-sm text-neutral-400">No upcoming queued series right now.</p>
          </section>
        )}
      </section>
    </Protected>
  );
}
