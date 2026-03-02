'use client';
import { useEffect, useMemo, useState } from 'react';
import Protected from '../../../components/Protected';
import { useParams, useSearchParams } from 'next/navigation';
import { useSession } from '../../../components/SessionProvider';
import { getContinueList } from '../../../components/continueStore';
import HeroDetail from '../../../components/HeroDetail';
import { readJsonSafe } from '../../../lib/readJsonSafe';

export default function MovieDetails() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const { session } = useSession();
  const username = String(session?.user?.username || '').trim();
  const isUpcoming = String(searchParams?.get('upcoming') || '').trim() === '1';
  const [meta, setMeta] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  const [details, setDetails] = useState(null);
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindText, setRemindText] = useState('');
  const [err, setErr] = useState('');

  const cont = useMemo(
    () => getContinueList().find(x => x.type==='movie' && String(x.id)===String(id)) || null,
    [id]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (isUpcoming) {
          const sp = new URLSearchParams();
          sp.set('tmdbId', String(id));
          sp.set('mediaType', 'movie');
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
        } else {
          if (!session?.streamBase) return;
          const r = await fetch(`/api/xuione/vod/${id}?streamBase=${encodeURIComponent(session.streamBase)}`);
          const d = await readJsonSafe(r);
          if (!alive) return;
          if (!r.ok || !d.ok) throw new Error(d?.error || `HTTP ${r.status}`);
          setMeta(d);
          setUpcoming(null);
          setDetails(null);
        }
        setErr('');
      } catch(e){ if (alive) setErr(e.message || 'Failed to load'); }
    })();
    return () => { alive = false; };
  }, [id, session?.streamBase, isUpcoming, username]);

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
          duration: meta.duration,
          genre: meta.genre,
        }
      : null;

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
          mediaType: 'movie',
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

  const trailerHref =
    details?.trailer?.key
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(String(details.trailer.key || ''))}`
      : null;

  return (
    <Protected>
      <section className="py-6">
        {err ? <p className="mb-3 text-sm text-red-400">{err}</p> : null}
        {item ? (
          <HeroDetail
            item={item}
            onPlay={isUpcoming ? null : () => {
              try { sessionStorage.setItem('3jtv.playIntent', String(Date.now())); } catch {}
              window.location.href = `/watch/movie/${id}?auto=1`;
            }}
            buttons={(
              <>
                {!isUpcoming && meta?.trailer ? <a target="_blank" rel="noreferrer" href={meta.trailer} className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">Trailer</a> : null}
                {isUpcoming && trailerHref ? (
                  <a target="_blank" rel="noreferrer" href={trailerHref} className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">
                    Trailer
                  </a>
                ) : null}
                {isUpcoming ? (
                  <button
                    onClick={remind}
                    disabled={remindBusy || !username}
                    className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
                  >
                    {remindBusy ? 'Saving…' : 'Remind Me'}
                  </button>
                ) : (
                  <button className="rounded border border-neutral-700 bg-neutral-900 px-4 py-2 text-neutral-200 hover:border-neutral-500">+ Watchlist</button>
                )}
              </>
            )}
            height="min-h-[58vh] md:min-h-[62vh]"     // ✅ same as /movies hero
          />
        ) : null}

        {isUpcoming && upcoming ? (
          <div className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-sm font-semibold text-neutral-100">Worth to wait</div>
            <div className="mt-1 text-sm text-neutral-300">
              Release date: {upcoming?.releaseDate || '—'}{upcoming?.releaseTag ? ` · ${upcoming.releaseTag}` : ''}
            </div>
            {remindText ? <div className="mt-2 text-xs text-emerald-300">{remindText}</div> : null}
            {Array.isArray(details?.cast) && details.cast.length ? (
              <div className="mt-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Cast</div>
                <div className="flex flex-wrap gap-2">
                  {details.cast.slice(0, 10).map((row) => (
                    <span key={`${row.id}:${row.name}`} className="rounded-full border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-xs text-neutral-200">
                      {row.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <h2 className="mb-3 text-lg font-semibold">{isUpcoming ? 'More details' : 'Related movies'}</h2>
          <p className="text-sm text-neutral-400">
            {isUpcoming ? 'This title is queued and will be released on the configured release date.' : 'Coming next: same-category from Xuione.'}
          </p>
        </div>
      </section>
    </Protected>
  );
}
