'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import { usePublicSettings } from '../../components/PublicSettingsProvider';
import Row from '../../components/Row';
import CatalogHero from '../../components/CatalogHero';
import { readJsonSafe } from '../../lib/readJsonSafe';
import { prefetchSeriesCatalog, readSeriesCatalog } from '../../lib/publicCatalogCache';
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
    (async () => {
      try {
        const sp = new URLSearchParams();
        if (username) sp.set('username', username);
        sp.set('limit', '120');
        const leavingSp = new URLSearchParams();
        leavingSp.set('mediaType', 'series');
        leavingSp.set('limit', '120');
        const [r, leavingResp] = await Promise.all([
          fetch(`/api/public/autodownload/upcoming?${sp.toString()}`, { cache: 'no-store' }),
          fetch(`/api/public/autodownload/leaving-soon?${leavingSp.toString()}`, { cache: 'no-store' }),
        ]);
        const d = await readJsonSafe(r);
        const leavingJson = await readJsonSafe(leavingResp);
        if (!alive) return;
        if (!r.ok || !d?.ok) throw new Error(d?.error || 'Failed to load upcoming queue');
        const items = (Array.isArray(d?.items) ? d.items : []).filter((x) => String(x?.mediaType || '').toLowerCase() === 'tv');
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
            return <Row key={token} title={catalog.labels.seriesPage.leavingSoon} items={leavingSoon} loading={loading} kind="series" />;
          }
          if (row.key === 'worthToWait') {
            return <Row key={token} title={catalog.labels.seriesPage.worthToWait} items={worthToWait} loading={loading} kind="series" />;
          }

          return null;
        })}
      </section>
    </Protected>
  );
}
