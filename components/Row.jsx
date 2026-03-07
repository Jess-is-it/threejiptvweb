// components/Row.jsx
'use client';
import { useEffect, useRef } from 'react';
import HoverMovieCard from './HoverMovieCard';
import Link from 'next/link';

export default function Row({ title, items = [], loading = false, skeletonCount = 12, kind = 'movie' }) {
  const scroller = useRef(null);
  const hasItems = Array.isArray(items) && items.length > 0;
  const showSkeleton = loading && !hasItems;
  const skeletonItems = showSkeleton ? Array.from({ length: skeletonCount }, (_, i) => ({ id: `sk-${i}` })) : [];

  const scrollByAmount = (dir) => {
    const el = scroller.current;
    if (!el) return;
    const delta = Math.round(el.clientWidth * 0.9) * (dir === 'left' ? -1 : 1);
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  // ~6.5 posters visible in viewport on desktop:
  // 100 / 6.5 = 15.3846vw; clamp to keep sane on very small/large screens
 const cardStyle = { width: 'calc(clamp(150px, 15.38vw, 210px) + 32px)' };

  useEffect(() => {
    const el = scroller.current;
    if (!el || showSkeleton) return;

    const onWheel = (e) => {
      // Convert vertical wheel gestures into horizontal row scrolling.
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
      e.preventDefault();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [showSkeleton, items.length]);

  if (!loading && !hasItems) return null;

  return (
    <section className="group relative my-6">
      {title && <h3 className="mb-3 text-lg font-semibold">{title}</h3>}

      <div className="relative">
        <div
          ref={scroller}
          className="flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory pr-2"
          style={{ scrollbarWidth: 'none' }}
        >
          <style jsx>{`
            div::-webkit-scrollbar { display: none; }
          `}</style>

          {showSkeleton
            ? skeletonItems.map((x) => (
                <div key={x.id} className="snap-start shrink-0" style={cardStyle} aria-hidden="true">
                  <div className="aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800/70 animate-pulse">
                    <div className="h-full w-full bg-gradient-to-br from-neutral-800 via-neutral-700/40 to-neutral-800" />
                  </div>
                </div>
              ))
            : items.map((x) => {
                const rowKind = String(kind || '').toLowerCase();
                const itemKind = String(x?.kind || '').toLowerCase();
                const treatAsMovie = rowKind === 'movie' || (rowKind === 'mixed' && itemKind === 'movie');

                return treatAsMovie ? (
                  <HoverMovieCard
                    key={x.id}
                    item={x}
                    kind="movie"
                    className="snap-start shrink-0"
                    style={cardStyle}
                  />
                ) : (
                  <Link
                    key={x.id}
                    href={x.href || '#'}
                    className="snap-start shrink-0"
                    style={cardStyle}
                    title={x.title || ''}
                    aria-label={x.title || 'Poster'}
                  >
                    <div className="aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800">
                      <img
                        src={x.image || '/placeholders/poster-fallback.jpg'}
                        alt={x.title || ''}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </Link>
                );
              })}
        </div>

        {/* Arrows: desktop only, show on row hover */}
        {!showSkeleton && hasItems ? (
          <>
            <button
              onClick={() => scrollByAmount('left')}
              aria-label="Scroll left"
              className="
                absolute left-0 top-1/2 -translate-y-1/2 z-30
                hidden md:flex h-12 w-12 items-center justify-center rounded-full
                border border-neutral-700 bg-neutral-900/70 hover:bg-neutral-800/90
                opacity-0 md:group-hover:opacity-100
                pointer-events-none md:group-hover:pointer-events-auto
                transition-opacity
              "
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>

            <button
              onClick={() => scrollByAmount('right')}
              aria-label="Scroll right"
              className="
                absolute right-0 top-1/2 -translate-y-1/2 z-30
                hidden md:flex h-12 w-12 items-center justify-center rounded-full
                border border-neutral-700 bg-neutral-900/70 hover:bg-neutral-800/90
                opacity-0 md:group-hover:opacity-100
                pointer-events-none md:group-hover:pointer-events-auto
                transition-opacity
              "
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" />
              </svg>
            </button>
          </>
        ) : null}

        {/* Edge fades (visual only) */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-black to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-black to-transparent" />
      </div>
    </section>
  );
}
