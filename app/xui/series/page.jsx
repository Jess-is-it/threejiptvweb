'use client';
import { useEffect, useState } from 'react';
import Protected from '../../../components/Protected';
import { useSession } from '../../../components/SessionProvider';
import MediaCard from '../../../components/MediaCard';
import Link from 'next/link';
import { readJsonSafe } from '../../../lib/readJsonSafe';

export default function XuiSeries() {
  const { session } = useSession();
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const showSkeleton = Boolean(session?.streamBase) && loading;

  useEffect(() => {
    if (!session?.streamBase) return; // wait for session hydration
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const url = `/api/xuione/series?streamBase=${encodeURIComponent(session.streamBase)}`;
        const r = await fetch(url);
        const data = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !data.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        setItems((data.items || []).slice(0, 60));
        setErr('');
      } catch (e) {
        if (alive) setErr(e.message || 'Failed to load');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [session?.streamBase]);

  return (
    <Protected>
      <section className="py-6">
        <h1 className="mb-4 text-2xl font-bold">Your Library — Series (Xuione)</h1>
        {!session?.streamBase ? (
          <p className="text-sm text-neutral-400">Loading session…</p>
        ) : err ? (
          <p className="text-sm text-red-400">{err}</p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9">
          {showSkeleton
            ? Array.from({ length: 27 }, (_, i) => (
                <div key={`sk-${i}`} className="group block" aria-hidden="true">
                  <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800 animate-pulse" />
                  <div className="mt-2 h-3 w-3/4 rounded bg-neutral-800/70 animate-pulse" />
                </div>
              ))
            : items.map((it) => (
                <Link key={it.id} href={`/xui/series/${it.id}`} className="block">
                  <MediaCard item={{ ...it, href: undefined }} kind="tv" />
                </Link>
              ))}
        </div>
      </section>
    </Protected>
  );
}
