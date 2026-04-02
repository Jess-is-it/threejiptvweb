'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import Row from '../../components/Row';
import CatalogHero from '../../components/CatalogHero';
import {
  prefetchLeavingSoonCatalog,
  prefetchSeriesCatalog,
  prefetchUpcomingCatalog,
  readLeavingSoonCatalog,
  readSeriesCatalog,
  readUpcomingCatalog,
} from '../../lib/publicCatalogCache';
import {
  catalogItemMatchesGenre,
  getCatalogSettings,
  parseCatalogRowToken,
  selectRotatingCategory,
} from '../../lib/catalogSettings';

export default function SeriesPage() {
  const { session } = useSession();
  const { settings } = usePublicSettings();
  const username = String(session?.user?.username || '').trim();
  const [all, setAll] = useState([]);
  const [worthToWait, setWorthToWait] = useState([]);
  const [leavingSoon, setLeavingSoon] = useState([]);
  const [worthToWaitLoading, setWorthToWaitLoading] = useState(true);
  const [leavingSoonLoading, setLeavingSoonLoading] = useState(true);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.streamBase) return;
    let alive = true;
    const cached = readSeriesCatalog(session.streamBase);
    if (cached?.ok && Array.isArray(cached.items)) {
      setAll(cached.items.map((s) => ({ ...s, href: `/series/${s.id}` })));
      setErr('');
      setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      try {
        const sRes = await prefetchSeriesCatalog(session.streamBase);
        if (!alive) return;
        if (!sRes.ok) throw new Error(sRes.error || 'Failed to load series');
        setAll((sRes.items || []).map(s => ({ ...s, href: `/series/${s.id}` })));
        setErr('');
      } catch (e) {
        if (!alive) return;
        if (!cached?.ok) setErr(e.message || 'Network error');
      } finally {
        if (alive && !cached?.ok) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [session?.streamBase]);

  useEffect(() => {
    let alive = true;
    const upcomingCached = readUpcomingCatalog({ username, mediaType: 'series', limit: 120 });
    const leavingCached = readLeavingSoonCatalog({ mediaType: 'series', limit: 120 });

    if (upcomingCached?.ok && Array.isArray(upcomingCached.items)) {
      setWorthToWait(upcomingCached.items);
      setWorthToWaitLoading(false);
    } else {
      setWorthToWaitLoading(true);
    }

    if (leavingCached?.ok && Array.isArray(leavingCached.items)) {
      setLeavingSoon(leavingCached.items);
      setLeavingSoonLoading(false);
    } else {
      setLeavingSoonLoading(true);
    }

    (async () => {
      try {
        const [upcomingRes, leavingRes] = await Promise.all([
          prefetchUpcomingCatalog({ username, mediaType: 'series', limit: 120 }),
          prefetchLeavingSoonCatalog({ mediaType: 'series', limit: 120 }),
        ]);
        if (!alive) return;
        setWorthToWait(Array.isArray(upcomingRes?.items) ? upcomingRes.items : []);
        setLeavingSoon(Array.isArray(leavingRes?.items) ? leavingRes.items : []);
      } catch {
        if (alive) setWorthToWait([]);
        if (alive) setLeavingSoon([]);
      } finally {
        if (alive) {
          setWorthToWaitLoading(false);
          setLeavingSoonLoading(false);
        }
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
  const seriesLayoutRows = useMemo(
    () => (Array.isArray(catalog.layouts?.seriesPage?.rows) ? catalog.layouts.seriesPage.rows : []),
    [catalog.layouts?.seriesPage?.rows]
  );
  const seriesGenreRows = useMemo(() => {
    const displayCount = Number(catalog.categories.seriesGenreRows.displayCount || 0);
    if (displayCount <= 0) return new Map();

    const out = new Map();
    for (const token of seriesLayoutRows) {
      const row = parseCatalogRowToken(token);
      if (!row || row.kind !== 'genre') continue;
      const items = all.filter((item) => catalogItemMatchesGenre(item, row.name)).slice(0, displayCount);
      if (!items.length) continue;
      out.set(row.name, items);
    }
    return out;
  }, [all, seriesLayoutRows, catalog.categories.seriesGenreRows.displayCount]);

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        <CatalogHero
          pageKey="seriesPage"
          catalog={catalog}
          sourceItems={{
            top,
            recentlyAdded: recent,
            leavingSoon,
            worthToWait,
          }}
          loading={loading}
        />

        {seriesLayoutRows.map((token) => {
          const row = parseCatalogRowToken(token);
          if (!row) return null;

          if (row.kind === 'genre') {
            const items = seriesGenreRows.get(row.name) || [];
            if (!loading && !items.length) return null;
            return <Row key={token} title={row.name} items={items} loading={loading} kind="series" />;
          }

          if (row.key === 'top') {
            return <Row key={token} title={catalog.labels.seriesPage.top} items={top} loading={loading} kind="series" />;
          }
          if (row.key === 'recentlyAdded') {
            return <Row key={token} title={catalog.labels.seriesPage.recentlyAdded} items={recent} loading={loading} kind="series" />;
          }
          if (row.key === 'leavingSoon') {
            return <Row key={token} title={catalog.labels.seriesPage.leavingSoon} items={leavingSoon} loading={loading || leavingSoonLoading} kind="series" priority={true} />;
          }
          if (row.key === 'worthToWait') {
            return <Row key={token} title={catalog.labels.seriesPage.worthToWait} items={worthToWait} loading={loading || worthToWaitLoading} kind="series" priority={true} />;
          }

          return null;
        })}
      </section>
    </Protected>
  );
}
