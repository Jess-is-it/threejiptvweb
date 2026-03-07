// components/HeroCarousel.jsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Plus, Info } from 'lucide-react';
import TmdbBackdrop from './TmdbBackdrop';
import { chooseBestBackdrop } from '../lib/tmdb';
import { useSession } from './SessionProvider';
import { readJsonSafe } from '../lib/readJsonSafe';

const BRAND = 'var(--brand)';
const HEADER_H = 64;

const tmdbFull = (path) =>
  !path ? '' : path.startsWith('http') ? path : `https://image.tmdb.org/t/p/original${path}`;

// prefer a backdrop-looking source; never posters
function immediateSrc(item) {
  const p =
    item?.backdrop_path ||
    item?.backdrop ||
    ((typeof item?.image === 'string' && item.image.startsWith('/')) ? item.image : '');
  return tmdbFull(p);
}

// remove "(YYYY)" or "[...]" suffixes in titles
const stripYear = (s = '') => s.replace(/\s*\(\d{4}\)\s*$/, '').replace(/\s*\[[^\]]+\]\s*$/, '').trim();

// mins -> "xh ym"
const fmtRuntime = (mins) => {
  if (!mins && mins !== 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

export default function HeroCarousel({
  items = [],
  autoplayMs = 7000,
  onPlay,
  onAdd,
  onDetails,
}) {
  const { session } = useSession();
  const slides = useMemo(() => items.filter(Boolean).slice(0, 6), [items]);

  const [index, setIndex] = useState(0);

  // Map of item.id -> image url (starts with any immediate src, then upgrades via TMDB)
  const [resolvedSrc, setResolvedSrc] = useState(() => {
    const init = {};
    for (const it of slides) init[it.id] = immediateSrc(it) || null;
    return init;
  });

  // Map of item.id -> { overview, rating, genres[], runtime }
  const [detailsMap, setDetailsMap] = useState({});

  const timerRef = useRef(null);

  // keep immediate fallbacks synced when slides change
  useEffect(() => {
    setResolvedSrc((prev) => {
      const next = { ...prev };
      for (const it of slides) if (!next[it.id]) next[it.id] = immediateSrc(it) || null;
      return next;
    });
  }, [slides]);

  // Try to upgrade to TMDB backdrop for each slide
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const jobs = slides.map(async (it) => {
        try {
          const path = await chooseBestBackdrop(session?.streamBase, it);
          if (!cancelled && path) {
            setResolvedSrc((p) => ({ ...p, [it.id]: tmdbFull(path) }));
          }
        } catch {
          /* ignore */
        }
      });
      await Promise.allSettled(jobs);
    })();
    return () => { cancelled = true; };
  }, [slides, session?.streamBase]);

  // Fetch TMDB details (overview, genres, runtime, rating)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const jobs = slides.map(async (it) => {
        const title = encodeURIComponent(stripYear(it.title || ''));
        const year = encodeURIComponent(it.year || '');
        const kind = encodeURIComponent(it.kind || '');
        try {
          const r = await fetch(`/api/tmdb/details?title=${title}&year=${year}&kind=${kind}`, { cache: 'no-store' });
          if (!r.ok) return;
          const data = await readJsonSafe(r);
          if (!data?.ok) return;
          if (!cancelled) {
            setDetailsMap((m) => ({
              ...m,
              [it.id]: {
                overview: data.overview || '',
                rating: data.rating ?? null,
                genres: Array.isArray(data.genres) ? data.genres : [],
                runtime: data.runtime ?? null,
              },
            }));
          }
        } catch {
          /* ignore */
        }
      });
      await Promise.allSettled(jobs);
    })();
    return () => { cancelled = true; };
  }, [slides]);

  // autoplay
  useEffect(() => {
    if (!autoplayMs || slides.length < 2) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setIndex((i) => (i + 1) % slides.length), autoplayMs);
    return () => clearInterval(timerRef.current);
  }, [slides.length, autoplayMs]);

  if (!slides.length) return null;

  const active = slides[index];
  const src = resolvedSrc[active.id]; // may begin null, then upgrade
  const d = detailsMap[active.id] || {};
  const title = stripYear(active.title || '');
  const rating = (d.rating ?? active.rating) || null;
  const ratingText = rating ? (Math.round(rating * 10) / 10).toFixed(1) : null;
  const genresText = Array.isArray(d.genres) && d.genres.length ? d.genres.slice(0, 3).join(', ') : '';
  const runtimeText = d.runtime ? fmtRuntime(d.runtime) : '';

  return (
    <div
      className="group relative -mt-16 h-[68vh] md:h-[72vh] lg:h-[74vh] w-full overflow-hidden"
      style={{ marginTop: `-${HEADER_H}px` }}
    >
      {/* background */}
      <div className="absolute inset-0">
        {src ? (
          <TmdbBackdrop path={src} alt={active.title} />
        ) : (
          <div className="absolute inset-0 bg-neutral-900" />
        )}

        {/* TOP gradient under the header so nav stays readable */}
        <div
          className="
            pointer-events-none absolute inset-x-0 top-0
            h-20 sm:h-24 lg:h-28
            bg-gradient-to-b from-black/75 via-black/40 to-transparent
            z-[2]
          "
        />

        {/* BOTTOM vignette to darken the lower area over cards */}
        <div
          className="
            pointer-events-none absolute inset-0
            bg-gradient-to-t from-black via-black/25 to-transparent
            z-[1]
          "
        />
      </div>

      {/* copy & CTAs – align with page padding so it lines up with logo/cards */}
      <div className="relative z-10 flex h-full flex-col justify-end px-4 sm:px-6 lg:px-10 pb-10">
        <div className="max-w-[72ch] rounded-2xl border border-white/10 bg-black/35 p-5 shadow-2xl backdrop-blur-md sm:p-6">
          <h2 className="mb-2 text-3xl font-extrabold leading-tight sm:text-4xl md:text-6xl">
            {title}
          </h2>

          {/* meta row */}
          {(ratingText || runtimeText || genresText) ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 text-sm text-neutral-200">
              {ratingText ? <span>★ {ratingText}</span> : null}
              {runtimeText ? <span>• {runtimeText}</span> : null}
              {genresText ? <span>• {genresText}</span> : null}
            </div>
          ) : null}

          {/* overview */}
          {d.overview ? (
            <p className="mb-5 max-w-3xl text-sm text-neutral-200 md:text-base line-clamp-3">
              {d.overview}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              onClick={() => onPlay?.(active)}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-white"
              style={{ background: BRAND }}
            >
              <Play size={18} /> Play
            </button>
            <button
              onClick={() => onAdd?.(active)}
              className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
              title="Add to watchlist"
            >
              <Plus />
            </button>
            <button
              onClick={() => onDetails?.(active)}
              className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
              title="Details"
            >
              <Info />
            </button>
          </div>
        </div>
      </div>

      {/* arrows (appear only on hover) */}
      <button
        className="
          absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white
          hover:bg-black/60 cursor-pointer z-20
          opacity-0 pointer-events-none transition
          group-hover:opacity-100 group-hover:pointer-events-auto
        "
        onClick={() => setIndex((i) => (i - 1 + slides.length) % slides.length)}
        aria-label="Previous"
      >
        <ChevronLeft />
      </button>
      <button
        className="
          absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white
          hover:bg-black/60 cursor-pointer z-20
          opacity-0 pointer-events-none transition
          group-hover:opacity-100 group-hover:pointer-events-auto
        "
        onClick={() => setIndex((i) => (i + 1) % slides.length)}
        aria-label="Next"
      >
        <ChevronRight />
      </button>

      {/* dots */}
      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-2 py-1">
        <div className="flex items-center gap-1">
          {slides.map((s, i) => (
            <span
              key={s.id}
              onClick={() => setIndex(i)}
              className={`h-2 w-3 cursor-pointer rounded-full transition-all ${
                i === index ? 'w-4 bg-[var(--brand)]' : 'bg-white/60'
              }`}
              style={{ ['--brand']: BRAND }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
