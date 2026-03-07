'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../../../components/Protected';
import { useSession } from '../../../../components/SessionProvider';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { readJsonSafe } from '../../../../lib/readJsonSafe';

export default function SeriesDetail() {
  const { session } = useSession();
  const { id } = useParams();
  const [series, setSeries] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [selSeason, setSelSeason] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.streamBase) return; // wait for session
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const url = `/api/xuione/series/${id}?streamBase=${encodeURIComponent(session.streamBase)}`;
        const r = await fetch(url);
        const data = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !data.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        setSeries(data.series || null);
        setEpisodes(data.episodes || {});
        const seasons = Object.keys(data.episodes || {}).map(n => Number(n)).sort((a,b)=>a-b);
        setSelSeason(seasons[0] ?? null);
        setErr('');
      } catch (e) {
        if (alive) setErr(e.message || 'Failed to load');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, session?.streamBase]);

  const seasons = useMemo(() => Object.keys(episodes).map(n => Number(n)).sort((a,b)=>a-b), [episodes]);
  const list = episodes[selSeason] || [];

  return (
    <Protected>
      <section className="py-6">
        <h1 className="mb-2 text-2xl font-bold">{series?.title || `Series #${id}`}</h1>
        {!session?.streamBase ? (
          <p className="text-sm text-neutral-400">Loading session…</p>
        ) : loading ? (
          <p className="text-sm text-neutral-400">Loading episodes…</p>
        ) : err ? (
          <p className="text-sm text-red-400">{err}</p>
        ) : null}

        {/* Season selector */}
        <div className="mb-4 flex flex-wrap gap-2">
          {seasons.map(s => (
            <button
              key={s}
              onClick={() => setSelSeason(s)}
              className={'rounded-full border px-3 py-1 text-sm ' + (s === selSeason ? 'bg-white text-black' : 'border-neutral-700')}
            >
              Season {s}
            </button>
          ))}
        </div>

        {/* Episodes */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {list.map(e => (
            <Link
              key={e.id}
              href={`/watch/series/${id}/${e.id}`}
              className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 hover:border-neutral-600"
            >
              <div className="text-sm font-medium text-neutral-100">E{e.episode_num ?? ''} — {e.title}</div>
              <div className="text-xs text-neutral-400">#{e.id} · {e.container_extension?.toUpperCase?.() || 'MP4'}</div>
            </Link>
          ))}
        </div>
      </section>
    </Protected>
  );
}
