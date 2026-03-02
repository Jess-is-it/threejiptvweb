'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../../components/Protected';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '../../../components/SessionProvider';
import HeroDetail from '../../../components/HeroDetail';
import { readJsonSafe } from '../../../lib/readJsonSafe';

export default function SeriesDetails() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const { session } = useSession();
  const username = String(session?.user?.username || '').trim();
  const router = useRouter();
  const isUpcoming = String(searchParams?.get('upcoming') || '').trim() === '1';

  const [meta, setMeta] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [details, setDetails] = useState(null);
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindText, setRemindText] = useState('');
  const [activeSeason, setActiveSeason] = useState('');
  const [err, setErr] = useState('');

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
        const firstSeason = String(d?.seasons?.[0]?.season || '1');
        setActiveSeason(firstSeason);
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
          image: details?.posterPath ? `https://image.tmdb.org/t/p/w500${details.posterPath}` : '/images/placeholder.png',
          backdrop: details?.backdropPath ? `https://image.tmdb.org/t/p/w1280${details.backdropPath}` : '',
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
          image: meta.image,
          plot: meta.plot,
          year: meta.year,
          rating: meta.rating,
          duration: null,
          genre: meta.genre,
        }
      : null;

  const currentEpisodes = useMemo(() => {
    const s = meta?.seasons?.find((x) => String(x?.season) === String(activeSeason));
    return s?.episodes || [];
  }, [meta, activeSeason]);

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

  const trailerHref = details?.trailer?.key
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(String(details.trailer.key || ''))}`
    : null;

  return (
    <Protected>
      <section className="py-6">
        {err ? <p className="mb-3 text-sm text-red-400">{err}</p> : null}
        {item ? (
          <HeroDetail
            item={item}
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
            buttons={
              isUpcoming ? (
                <>
                  {trailerHref ? (
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={trailerHref}
                      className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500"
                    >
                      Trailer
                    </a>
                  ) : null}
                  <button
                    onClick={remind}
                    disabled={remindBusy || !username}
                    className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
                  >
                    {remindBusy ? 'Saving…' : 'Remind Me'}
                  </button>
                </>
              ) : (
                <></>
              )
            }
            height="min-h-[58vh] md:min-h-[62vh]"
          />
        ) : null}

        {isUpcoming && upcoming ? (
          <div className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-sm font-semibold text-neutral-100">Worth to wait</div>
            <div className="mt-1 text-sm text-neutral-300">
              Release date: {upcoming?.releaseDate || '—'}
              {upcoming?.releaseTag ? ` · ${upcoming.releaseTag}` : ''}
            </div>
            {remindText ? <div className="mt-2 text-xs text-emerald-300">{remindText}</div> : null}
            {Array.isArray(details?.cast) && details.cast.length ? (
              <div className="mt-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Cast</div>
                <div className="flex flex-wrap gap-2">
                  {details.cast.slice(0, 10).map((row) => (
                    <span
                      key={`${row.id}:${row.name}`}
                      className="rounded-full border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs text-neutral-200"
                    >
                      {row.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
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

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
      </section>
    </Protected>
  );
}
