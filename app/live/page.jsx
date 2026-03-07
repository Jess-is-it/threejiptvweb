'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import ChannelCard from '../../components/ChannelCard';

async function readJsonSafe(res) {
  const text = await res.text().catch(() => '');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: (text || '').slice(0, 200) || 'Invalid response' };
  }
}

export default function LivePage() {
  const { session } = useSession();
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selCat, setSelCat] = useState('ALL');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.streamBase) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch('/api/xuione/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamBase: session?.streamBase }),
        });
        const data = await readJsonSafe(r);
        if (!alive) return;
        if (!r.ok || !data.ok) throw new Error(data?.error || 'Failed to load live channels');
        // Prepend ALL
        setCategories([{ id: 'ALL', name: 'All' }, ...(data.categories || [])]);
        setChannels(data.channels || []);
        setErr('');
      } catch (e) {
        setErr(e.message || 'Network error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.streamBase]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return channels.filter((c) => {
      const okCat = selCat === 'ALL' ? true : String(c.category_id) === String(selCat);
      const okQ = !ql ? true : (c.name || '').toLowerCase().includes(ql);
      return okCat && okQ;
    });
  }, [channels, selCat, q]);

  return (
    <Protected>
      <section className="py-6 px-4 sm:px-6 lg:px-10">
        <h1 className="mb-4 text-2xl font-bold">Live Channels</h1>
        {err ? <p className="mb-4 text-sm text-red-400">{err}</p> : null}

        {/* Category scroller */}
        <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
          {categories.map((c) => {
            const active = String(selCat) === String(c.id);
            return (
              <button
                key={c.id}
                onClick={() => setSelCat(String(c.id))}
                className={
                  'whitespace-nowrap rounded-full border px-3 py-1 text-sm transition ' +
                  (active
                    ? 'border-white bg-white text-black'
                    : 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500')
                }
              >
                {c.name}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search channel..."
            className="w-full rounded-lg bg-neutral-900 px-3 py-2 outline-none ring-1 ring-neutral-800 focus:ring-white md:max-w-md"
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {Array.from({ length: 24 }, (_, i) => (
              <div
                key={`sk-${i}`}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
                aria-hidden="true"
              >
                <div className="flex items-center gap-3 animate-pulse">
                  <div className="h-12 w-12 rounded bg-neutral-950" />
                  <div className="flex-1">
                    <div className="h-3 w-3/4 rounded bg-neutral-800" />
                    <div className="mt-2 h-2 w-1/3 rounded bg-neutral-800/70" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-neutral-400">{filtered.length} channels</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {filtered.map((ch) => (
                <ChannelCard key={ch.id} channel={ch} />
              ))}
            </div>
          </div>
        )}
      </section>
    </Protected>
  );
}
