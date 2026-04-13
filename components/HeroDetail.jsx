// components/HeroDetail.jsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Volume2, VolumeX } from 'lucide-react';

const SHELL_HEADER_OFFSET = 64;
const SECTION_TOP_GAP = 24;

function stripTrailingYearCopies(value, year) {
  const title = String(value || '').trim();
  const normalizedYear = String(year || '').trim();
  if (!title || !normalizedYear) return title;
  const escapedYear = normalizedYear.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:\\s*\\(${escapedYear}\\))+\\s*$`);
  return title.replace(pattern, '').trim() || title;
}

function heroTrailerSrc(key) {
  const encoded = encodeURIComponent(String(key || '').trim());
  if (!encoded) return '';
  return `https://www.youtube-nocookie.com/embed/${encoded}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${encoded}&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&enablejsapi=1`;
}

export default function HeroDetail({
  item = {},
  onPlay,
  onAdd,
  onDetails,
  buttons = null,
  topLeftContent = null,
  height = 'min-h-[68vh] md:min-h-[72vh] lg:min-h-[74vh]',
  behindHeader = true,
  showYearInTitle = true,
  trailerKey = '',
  trailerStartDelayMs = 6000,
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
  const baseTitle = stripTrailingYearCopies(title, year);
  const displayTitle = showYearInTitle && year ? `${baseTitle} (${year})` : baseTitle;
  const normalizedTrailerKey = String(trailerKey || '').trim();
  const [showTrailer, setShowTrailer] = useState(false);
  const [trailerMuted, setTrailerMuted] = useState(true);
  const [trailerFrameSize, setTrailerFrameSize] = useState(null);
  const [trailerCountdown, setTrailerCountdown] = useState(null);
  const [trailerReady, setTrailerReady] = useState(false);
  const [trailerUnavailable, setTrailerUnavailable] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const sectionRef = useRef(null);
  const trailerFrameRef = useRef(null);
  const trailerSrc = useMemo(
    () => heroTrailerSrc(normalizedTrailerKey),
    [normalizedTrailerKey]
  );

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

  useEffect(() => {
    const updateBrowserOnline = () => {
      setBrowserOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    };

    updateBrowserOnline();
    window.addEventListener('online', updateBrowserOnline);
    window.addEventListener('offline', updateBrowserOnline);
    return () => {
      window.removeEventListener('online', updateBrowserOnline);
      window.removeEventListener('offline', updateBrowserOnline);
    };
  }, []);

  const offsetStyle = behindHeader
    ? {
        marginTop: -(headerH + SHELL_HEADER_OFFSET + SECTION_TOP_GAP),
        paddingTop: headerH,
      }
    : undefined;

  useEffect(() => {
    setShowTrailer(false);
    setTrailerMuted(true);
    setTrailerCountdown(null);
    setTrailerReady(false);
    setTrailerUnavailable(false);
    if (!normalizedTrailerKey) return undefined;
    if (!browserOnline) {
      setTrailerUnavailable(true);
      return undefined;
    }

    const delayMs = Math.max(0, Number(trailerStartDelayMs || 0));
    const targetAt = Date.now() + delayMs;
    setTrailerCountdown(Math.max(1, Math.ceil(delayMs / 1000)));

    const updateCountdown = () => {
      setTrailerCountdown(Math.max(1, Math.ceil((targetAt - Date.now()) / 1000)));
    };

    const interval = setInterval(updateCountdown, 250);
    const timer = setTimeout(() => {
      clearInterval(interval);
      setTrailerCountdown(null);
      setShowTrailer(true);
    }, delayMs);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [browserOnline, normalizedTrailerKey, trailerStartDelayMs]);

  useEffect(() => {
    if (!showTrailer || !trailerSrc || trailerUnavailable || trailerReady) return undefined;
    const loadTimeout = setTimeout(() => {
      setTrailerUnavailable(true);
      setShowTrailer(false);
      setTrailerReady(false);
      setTrailerCountdown(null);
    }, 7000);

    return () => clearTimeout(loadTimeout);
  }, [showTrailer, trailerReady, trailerSrc, trailerUnavailable]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return undefined;

    const measureTrailerFrame = () => {
      const rect = el.getBoundingClientRect();
      const containerWidth = Math.max(1, rect.width || 0);
      const containerHeight = Math.max(1, rect.height || 0);
      const trailerRatio = 16 / 9;
      let width = containerWidth;
      let height = width / trailerRatio;

      if (height < containerHeight) {
        height = containerHeight;
        width = height * trailerRatio;
      }

      setTrailerFrameSize((current) => {
        const next = {
          width: Math.ceil(width),
          height: Math.ceil(height),
        };
        if (
          current &&
          Math.abs(current.width - next.width) < 2 &&
          Math.abs(current.height - next.height) < 2
        ) {
          return current;
        }
        return next;
      });
    };

    measureTrailerFrame();
    window.addEventListener('resize', measureTrailerFrame);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measureTrailerFrame);
      resizeObserver.observe(el);
    }

    return () => {
      window.removeEventListener('resize', measureTrailerFrame);
      resizeObserver?.disconnect();
    };
  }, []);

  const sendTrailerCommand = (func) => {
    try {
      trailerFrameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args: [] }),
        '*'
      );
    } catch {}
  };

  const unmuteTrailer = () => {
    setTrailerMuted(false);
    sendTrailerCommand('unMute');
    sendTrailerCommand('playVideo');
    setTimeout(() => {
      sendTrailerCommand('unMute');
      sendTrailerCommand('playVideo');
    }, 150);
  };

  const muteTrailer = () => {
    setTrailerMuted(true);
    sendTrailerCommand('mute');
  };

  return (
    <section
      ref={sectionRef}
      style={offsetStyle}
      className={`relative -mx-4 sm:-mx-6 lg:-mx-10 mb-6 overflow-hidden ${height}`}
    >
      {topLeftContent ? (
        <div
          className="absolute left-4 z-20 sm:left-6 lg:left-10"
          style={{ top: Math.max(headerH + 16, 20) }}
        >
          {topLeftContent}
        </div>
      ) : null}

      {/* BACKDROP (visual only; don't block clicks) */}
      <div className="absolute inset-0 pointer-events-none">
        {backdrop ? (
          <img src={backdrop} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="h-full w-full bg-neutral-800" />
        )}
        {showTrailer && trailerSrc && !trailerUnavailable ? (
          <iframe
            ref={trailerFrameRef}
            key={normalizedTrailerKey}
            src={trailerSrc}
            title={`${baseTitle || 'Movie'} trailer`}
            className={`absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2 border-0 transition-opacity duration-700 ${trailerReady ? 'opacity-100' : 'opacity-0'}`}
            style={
              trailerFrameSize
                ? {
                    width: `${trailerFrameSize.width}px`,
                    height: `${trailerFrameSize.height}px`,
                  }
                : {
                    width: '100%',
                    height: '100%',
                  }
            }
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            tabIndex={-1}
            onLoad={() => setTrailerReady(true)}
            onError={() => {
              setTrailerUnavailable(true);
              setShowTrailer(false);
              setTrailerReady(false);
              setTrailerCountdown(null);
            }}
          />
        ) : null}
        {/* vertical fade; start totally transparent to avoid top band */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/30 to-black/80" />
        {/* LEFT overlay band for desktop/TV */}
        <div className="absolute inset-y-0 left-0 hidden w-[70%] md:block bg-gradient-to-r from-black/75 via-black/55 to-transparent" />
      </div>

      {showTrailer && trailerSrc && trailerReady && !trailerUnavailable ? (
        <button
          type="button"
          onClick={trailerMuted ? unmuteTrailer : muteTrailer}
          className="absolute bottom-6 right-4 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-2xl backdrop-blur-md transition hover:bg-black/75 sm:right-6 lg:right-10"
          aria-label={trailerMuted ? 'Unmute trailer' : 'Mute trailer'}
          title={trailerMuted ? 'Unmute trailer' : 'Mute trailer'}
        >
          {trailerMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      ) : null}

      {normalizedTrailerKey && !showTrailer && !trailerUnavailable && trailerCountdown ? (
        <div
          className="absolute right-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/55 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-2xl backdrop-blur-md sm:right-6 lg:right-10"
          style={{ top: Math.max(headerH + 18, 22) }}
        >
          <span className="text-neutral-300">Trailer autoplay in</span>
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-2 text-black">
            {trailerCountdown}
          </span>
        </div>
      ) : null}

      {/* CONTENT pinned bottom-left */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-8 sm:px-6 lg:px-10 md:pb-10">
        <div className="max-w-3xl rounded-2xl border border-white/10 bg-black/35 p-5 shadow-2xl backdrop-blur-md sm:p-6">
          <h1 className="mb-2 text-3xl font-extrabold leading-tight sm:text-4xl md:text-5xl">
            {displayTitle}
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
                className="inline-flex h-12 items-center gap-2 rounded-md px-5 font-medium text-white"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                <Play size={18} />
                <span>Play</span>
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
