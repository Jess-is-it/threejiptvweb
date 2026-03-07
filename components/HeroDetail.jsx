// components/HeroDetail.jsx
'use client';
import { useEffect, useState } from 'react';

export default function HeroDetail({
  item = {},
  onPlay,
  onAdd,
  onDetails,
  buttons = null,
  height = 'min-h-[68vh] md:min-h-[72vh] lg:min-h-[74vh]',
  behindHeader = true,
}) {
  const {
    title = '',
    image = '',
    backdrop: backdropIn,
    year,
    plot = '',
    rating,
    genre,
  } = item || {};

  const backdrop = backdropIn || image || '';

  // NEW: measure header height so we can perfectly overlap
  const [headerH, setHeaderH] = useState(64);
  useEffect(() => {
    const measure = () => {
      const el = document.getElementById('site-header');
      setHeaderH(el ? el.offsetHeight : 64);
    };
    measure();
    window.addEventListener('resize', measure);
    // Re-measure shortly after paint for mobile toolbars
    const t = setTimeout(measure, 100);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(t);
    };
  }, []);

  const offsetStyle = behindHeader ? { marginTop: -headerH, paddingTop: headerH } : undefined;

  return (
    <section
      style={offsetStyle}
      className={`relative -mx-4 sm:-mx-6 lg:-mx-10 mb-6 ${height}`}
    >
      {/* BACKDROP (visual only; don't block clicks) */}
      <div className="absolute inset-0 pointer-events-none">
        {backdrop ? (
          <img src={backdrop} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="h-full w-full bg-neutral-800" />
        )}
        {/* vertical fade; start totally transparent to avoid top band */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/30 to-black/80" />
        {/* LEFT overlay band for desktop/TV */}
        <div className="absolute inset-y-0 left-0 hidden w-[70%] md:block bg-gradient-to-r from-black/75 via-black/55 to-transparent" />
      </div>

      {/* CONTENT pinned bottom-left */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-8 sm:px-6 lg:px-10 md:pb-10">
        <div className="max-w-3xl rounded-2xl border border-white/10 bg-black/35 p-5 shadow-2xl backdrop-blur-md sm:p-6">
          <h1 className="mb-2 text-3xl font-extrabold leading-tight sm:text-4xl md:text-5xl">
            {title}{year ? ` (${year})` : ''}
          </h1>
          <div className="mb-3 text-sm text-neutral-200">
            {genre ? <span className="mr-2">{genre}</span> : null}
            {rating ? <span>• ⭐ {rating}</span> : null}
          </div>
          {plot ? (
            <p className="mb-5 line-clamp-3 max-w-2xl text-sm text-neutral-200 md:text-base">{plot}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {onPlay && (
              <button
                onClick={onPlay}
                className="h-12 rounded-md px-5 font-medium text-white"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                Play
              </button>
            )}
            {onAdd && (
              <button
                onClick={onAdd}
                title="Add to watchlist"
                aria-label="Add to watchlist"
                className="flex h-12 w-12 items-center justify-center rounded-md border border-white/15 bg-black/25 hover:border-white/30"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
            )}
            {onDetails && (
              <button
                onClick={onDetails}
                title="Details"
                aria-label="Details"
                className="flex h-12 w-12 items-center justify-center rounded-md border border-white/15 bg-black/25 hover:border-white/30"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 8h.01M11 11h2v5h-2z" fill="currentColor" />
                </svg>
              </button>
            )}
            {buttons}
          </div>
        </div>
      </div>
    </section>
  );
}
