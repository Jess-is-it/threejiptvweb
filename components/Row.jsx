// components/Row.jsx
'use client';
import { useEffect, useRef, useState } from 'react';
import HoverMovieCard from './HoverMovieCard';
import Link from 'next/link';
import CatalogPosterImage from './CatalogPosterImage';

const SCROLL_EDGE_TOLERANCE = 4;
const INITIAL_RENDER_COUNT = 12;
const RENDER_CHUNK_SIZE = 12;
const RENDER_AHEAD_MULTIPLIER = 1.25;

export default function Row({
  title,
  items = [],
  loading = false,
  skeletonCount = 12,
  kind = 'movie',
  priority = false,
}) {
  const scroller = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [renderedCount, setRenderedCount] = useState(() =>
    Math.min(Array.isArray(items) ? items.length : 0, INITIAL_RENDER_COUNT)
  );
  const hasItems = Array.isArray(items) && items.length > 0;
  const showSkeleton = Boolean(loading);
  const skeletonItems = showSkeleton ? Array.from({ length: skeletonCount }, (_, i) => ({ id: `sk-${i}` })) : [];
  const renderedItems = showSkeleton ? [] : (Array.isArray(items) ? items.slice(0, renderedCount) : []);

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
    if (showSkeleton) return;
    setRenderedCount(Math.min(Array.isArray(items) ? items.length : 0, INITIAL_RENDER_COUNT));
  }, [items, showSkeleton]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || showSkeleton) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const updateScrollControls = () => {
      if (renderedCount < items.length) {
        const remaining = Math.max(0, el.scrollWidth - (el.scrollLeft + el.clientWidth));
        if (remaining <= el.clientWidth * RENDER_AHEAD_MULTIPLIER) {
          setRenderedCount((current) => Math.min(items.length, current + RENDER_CHUNK_SIZE));
        }
      }

      const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const nextCanScrollLeft = el.scrollLeft > SCROLL_EDGE_TOLERANCE;
      const nextCanScrollRight =
        renderedCount < items.length || maxScrollLeft - el.scrollLeft > SCROLL_EDGE_TOLERANCE;
      setCanScrollLeft((prev) => (prev === nextCanScrollLeft ? prev : nextCanScrollLeft));
      setCanScrollRight((prev) => (prev === nextCanScrollRight ? prev : nextCanScrollRight));
    };

    const onWheel = (e) => {
      // Convert vertical wheel gestures into horizontal row scrolling.
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
      e.preventDefault();
    };

    updateScrollControls();

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', updateScrollControls, { passive: true });
    window.addEventListener('resize', updateScrollControls, { passive: true });

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateScrollControls());
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', updateScrollControls);
      window.removeEventListener('resize', updateScrollControls);
      resizeObserver?.disconnect();
    };
  }, [showSkeleton, items, renderedCount]);

  if (!loading && !hasItems) return null;

  return (
    <section
      className="group relative my-6"
      style={priority ? undefined : { contentVisibility: 'auto', containIntrinsicSize: '340px' }}
    >
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
            : renderedItems.map((x, index) => {
                const rowKind = String(kind || '').toLowerCase();
                const itemKind = String(x?.kind || '').toLowerCase();
                const treatAsMovie = rowKind === 'movie' || (rowKind === 'mixed' && itemKind === 'movie');
                const eagerPoster = priority ? index < 12 : index < 8;

                return treatAsMovie ? (
                  <HoverMovieCard
                    key={x.id}
                    item={x}
                    kind="movie"
                    eagerImage={eagerPoster}
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
                      <CatalogPosterImage
                        item={x}
                        alt={x.title || ''}
                        eager={eagerPoster}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </Link>
                );
              })}
        </div>

        {/* Arrows: desktop only, show on row hover */}
        {!showSkeleton && hasItems ? (
          <>
            {canScrollLeft ? (
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
            ) : null}

            {canScrollRight ? (
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
            ) : null}
          </>
        ) : null}

        {/* Edge fades (visual only) */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-black to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-black to-transparent" />
      </div>
    </section>
  );
}
