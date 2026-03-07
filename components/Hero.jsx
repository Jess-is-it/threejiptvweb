'use client';
import { useEffect, useMemo, useState } from 'react';

export default function Hero({ items = [] }) {
  const [i, setI] = useState(0);
  const slides = useMemo(() => items.filter(Boolean), [items]);
  const active = slides[i] || null;

  useEffect(() => {
    if (!slides.length) return;
    const id = setInterval(() => setI((p) => (p + 1) % slides.length), 5000);
    return () => clearInterval(id);
  }, [slides.length]);

  if (!active) return null;

  const title =
    active.title || active.original_title || active.name || active.original_name || 'Untitled';

  // Accept TMDb or Xuione images
  const tmdb = (p, size) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);
  const backdrop =
    tmdb(active.backdrop_path, 'w1280') ||
    active.image ||
    tmdb(active.poster_path, 'w780');

  const overview = active.overview || active.plot || '';

  return (
    <div className="relative mb-8 aspect-[16/7] w-full overflow-hidden rounded-xl bg-neutral-900">
      {backdrop ? <img src={backdrop} alt={title} className="h-full w-full object-cover" /> : null}
      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-transparent" />
      <div className="absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-6">
        <div className="max-w-3xl rounded-2xl border border-white/10 bg-black/35 p-5 shadow-2xl backdrop-blur-md sm:p-6">
          <div className="text-3xl font-extrabold leading-tight sm:text-4xl md:text-5xl">{title}</div>
          <p className="mt-3 line-clamp-3 text-sm text-neutral-200 md:text-base">{overview}</p>
          <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => setI((i - 1 + slides.length) % slides.length)}
            aria-label="Previous"
            className="rounded bg-neutral-800/70 px-3 py-2"
          >
            ‹
          </button>
          <button
            onClick={() => setI((i + 1) % slides.length)}
            aria-label="Next"
            className="rounded bg-neutral-800/70 px-3 py-2"
          >
            ›
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
