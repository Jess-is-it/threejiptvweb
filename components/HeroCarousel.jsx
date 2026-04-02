// components/HeroCarousel.jsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, Plus, Info } from 'lucide-react';
import TmdbBackdrop from './TmdbBackdrop';
import { readJsonSafe } from '../lib/readJsonSafe';
import { msUntilRelease } from '../lib/releaseTime';

const BRAND = 'var(--brand)';
const HEADER_H = 64;
const SHELL_HEADER_OFFSET = 64;
const SECTION_TOP_GAP = 24;
const MINUTE_MS = 60 * 1000;
const MANUAL_INTERACTION_AUTOPLAY_MS = 30 * 1000;

function tmdbFull(path) {
  const raw = String(path || '').trim();
  if (!raw) return '';
  if (
    raw.startsWith('/api/') ||
    raw.startsWith('/placeholders/') ||
    raw.startsWith('/images/') ||
    raw.startsWith('/brand/')
  ) {
    return raw;
  }
  if (/^https:\/\/image\.tmdb\.org\/t\/p\//i.test(raw)) {
    return raw.replace(/(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)\//i, '$1w1280/');
  }
  if (raw.startsWith('http')) return raw;
  return `https://image.tmdb.org/t/p/w1280${raw.startsWith('/') ? raw : `/${raw}`}`;
}

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

function formatMinutes(totalMinutes) {
  const rounded = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (!rounded) return '';
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtRuntime(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1000 ? formatMinutes(value / 60) : formatMinutes(value);
  }

  const raw = String(value).trim();
  if (!raw) return '';

  const clockMatch = raw.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (clockMatch) {
    const hours = Number(clockMatch[1] || 0);
    const minutes = Number(clockMatch[2] || 0);
    const seconds = Number(clockMatch[3] || 0);
    return formatMinutes(hours * 60 + minutes + seconds / 60);
  }

  const hoursMatch = raw.match(/(\d+)\s*h/i);
  const minutesMatch = raw.match(/(\d+)\s*m/i);
  if (hoursMatch || minutesMatch) {
    const hours = Number(hoursMatch?.[1] || 0);
    const minutes = Number(minutesMatch?.[1] || 0);
    return formatMinutes(hours * 60 + minutes);
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric >= 1000 ? formatMinutes(numeric / 60) : formatMinutes(numeric);
  }

  return raw;
}

function genreLabelsFromValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatCountdownLabel(remainingMs) {
  if (!Number.isFinite(remainingMs)) return '';
  if (remainingMs <= 0) return 'Today';

  const roundedMinutes = Math.max(1, Math.ceil(remainingMs / MINUTE_MS));
  const days = Math.floor(roundedMinutes / (24 * 60));
  const hours = Math.floor((roundedMinutes % (24 * 60)) / 60);
  const minutes = roundedMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function normalizeAutoplayMs(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

const slideKey = (item) => String(item?.heroKey || item?.id || item?.href || item?.title || '');

export default function HeroCarousel({
  items = [],
  autoplayMs = 7000,
  onPlay,
  onAdd,
  onDetails,
  initialDetailsMap = {},
}) {
  const slides = useMemo(() => items.filter(Boolean), [items]);
  const defaultAutoplayMs = useMemo(() => normalizeAutoplayMs(autoplayMs), [autoplayMs]);

  const [index, setIndex] = useState(0);
  const [headerH, setHeaderH] = useState(HEADER_H);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [manualAutoplayActive, setManualAutoplayActive] = useState(false);
  const [controlsHovered, setControlsHovered] = useState(false);
  const [heroHovered, setHeroHovered] = useState(false);

  // Map of item.id -> image url (starts with any immediate src, then upgrades via TMDB)
  const [resolvedSrc, setResolvedSrc] = useState(() => {
    const init = {};
    for (const it of slides) init[slideKey(it)] = immediateSrc(it) || null;
    return init;
  });

  // Map of item.id -> { overview, rating, genres[], runtime }
  const [detailsMap, setDetailsMap] = useState(() =>
    initialDetailsMap && typeof initialDetailsMap === 'object' ? initialDetailsMap : {}
  );

  const timerRef = useRef(null);
  const touchRef = useRef({ active: false, x: 0, y: 0 });

  useEffect(() => {
    const measure = () => {
      const el = document.getElementById('site-header');
      setHeaderH(el ? el.offsetHeight : HEADER_H);
    };

    measure();
    window.addEventListener('resize', measure);
    const timer = setTimeout(measure, 100);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    setIndex((current) => {
      if (!slides.length) return 0;
      return current >= slides.length ? 0 : current;
    });
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2) {
      setManualAutoplayActive(false);
      setControlsHovered(false);
      setHeroHovered(false);
    }
  }, [slides.length]);

  useEffect(() => {
    const hasUpcomingWorthToWait = slides.some(
      (item) =>
        String(item?.heroSourceKey || '').trim() === 'worthToWait' &&
        String(item?.releaseDate || '').trim() &&
        String(item?.releaseState || '').trim().toLowerCase() !== 'released'
    );
    if (!hasUpcomingWorthToWait) return undefined;

    setNowTs(Date.now());
    const timer = setInterval(() => setNowTs(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  }, [slides]);

  // keep immediate fallbacks synced when slides change
  useEffect(() => {
    setResolvedSrc((prev) => {
      const next = { ...prev };
      for (const it of slides) {
        const key = slideKey(it);
        if (!next[key]) next[key] = immediateSrc(it) || null;
      }
      return next;
    });
  }, [slides]);

  useEffect(() => {
    if (!initialDetailsMap || typeof initialDetailsMap !== 'object') return;
    setDetailsMap((prev) => ({ ...initialDetailsMap, ...prev }));
  }, [initialDetailsMap]);

  useEffect(() => {
    setResolvedSrc((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const slide of slides) {
        const key = slideKey(slide);
        if (next[key]) continue;
        const details = detailsMap[key] || {};
        const fallbackSrc = tmdbFull(details?.backdropPath || details?.posterPath || '') || immediateSrc(slide);
        if (!fallbackSrc) continue;
        next[key] = fallbackSrc;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [detailsMap, slides]);

  // Fetch TMDB details (overview, genres, runtime, rating)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const jobs = slides.map(async (it) => {
        const key = slideKey(it);
        if (Object.prototype.hasOwnProperty.call(detailsMap, key)) return;
        const title = encodeURIComponent(stripYear(it.title || ''));
        const year = encodeURIComponent(it.year || '');
        const kind = encodeURIComponent(it.kind || '');
        try {
          const r = await fetch(`/api/tmdb/details?title=${title}&year=${year}&kind=${kind}`, { cache: 'no-store' });
          if (!r.ok) {
            if (!cancelled) setDetailsMap((m) => ({ ...m, [key]: null }));
            return;
          }
          const data = await readJsonSafe(r);
          if (!data?.ok) {
            if (!cancelled) setDetailsMap((m) => ({ ...m, [key]: null }));
            return;
          }
          if (!cancelled) {
            setDetailsMap((m) => ({
              ...m,
              [key]: {
                overview: data.overview || '',
                rating: data.rating ?? null,
                genres: Array.isArray(data.genres) ? data.genres : [],
                runtime: data.runtime ?? null,
                popularity: data.popularity ?? null,
                voteCount: data.voteCount ?? null,
                releaseDate: data.releaseDate || '',
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
  }, [slides, detailsMap]);

  const effectiveAutoplayMs = defaultAutoplayMs
    ? manualAutoplayActive && heroHovered
      ? MANUAL_INTERACTION_AUTOPLAY_MS
      : defaultAutoplayMs
    : 0;

  const clearAutoplayTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const moveToSlide = (nextIndex, { manual = false } = {}) => {
    if (!slides.length) return;
    clearAutoplayTimer();
    if (manual) setManualAutoplayActive(true);
    const normalized = ((Number(nextIndex || 0) % slides.length) + slides.length) % slides.length;
    setIndex(normalized);
  };

  const stepSlide = (delta, { manual = false } = {}) => {
    if (!slides.length) return;
    clearAutoplayTimer();
    if (manual) setManualAutoplayActive(true);
    setIndex((current) => (current + delta + slides.length) % slides.length);
  };

  const handleArrowHoverStart = () => {
    clearAutoplayTimer();
    setControlsHovered(true);
  };

  const handleArrowHoverEnd = () => {
    setControlsHovered(false);
  };

  const handleHeroMouseEnter = () => {
    setHeroHovered(true);
  };

  const handleHeroMouseLeave = () => {
    setHeroHovered(false);
    setControlsHovered(false);
    setManualAutoplayActive(false);
  };

  const handleTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    touchRef.current = {
      active: true,
      x: touch.clientX,
      y: touch.clientY,
    };
  };

  const handleTouchEnd = (event) => {
    const touchState = touchRef.current;
    touchRef.current = { active: false, x: 0, y: 0 };
    if (!touchState.active || slides.length < 2) return;

    const touch = event.changedTouches?.[0];
    if (!touch) return;

    const deltaX = touch.clientX - touchState.x;
    const deltaY = touch.clientY - touchState.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX < 48 || absX <= absY * 1.1) return;

    stepSlide(deltaX < 0 ? 1 : -1, { manual: true });
  };

  // autoplay
  useEffect(() => {
    clearAutoplayTimer();
    if (!effectiveAutoplayMs || slides.length < 2 || controlsHovered) return undefined;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setIndex((current) => (current + 1) % slides.length);
    }, effectiveAutoplayMs);

    return () => clearAutoplayTimer();
  }, [slides.length, index, effectiveAutoplayMs, controlsHovered, clearAutoplayTimer]);

  if (!slides.length) return null;

  const active = slides[index];
  const activeKey = slideKey(active);
  const d = detailsMap[activeKey] || {};
  const hasWideBackdrop = Boolean(d?.backdropPath || active?.backdrop_path || active?.backdropImage);
  const shouldContainBackdrop = !hasWideBackdrop && Boolean(d?.posterPath || active?.posterPath || active?.image);
  const src =
    resolvedSrc[activeKey] ||
    tmdbFull(d?.backdropPath || d?.posterPath || '') ||
    immediateSrc(active) ||
    '/placeholders/poster-fallback.jpg';
  const title = stripYear(active.title || '');
  const rating = (d.rating ?? active.rating) || null;
  const ratingText = rating ? (Math.round(rating * 10) / 10).toFixed(1) : null;
  const genreLabels = genreLabelsFromValue(d.genres).length
    ? genreLabelsFromValue(d.genres)
    : genreLabelsFromValue(active.genre || active.genres);
  const genresText = genreLabels.slice(0, 3).join(', ');
  const runtimeText = fmtRuntime(d.runtime ?? active.duration);
  const overviewText = String(d.overview || active.plot || active.overview || '').trim();
  const primaryLabel = String(active?.heroPrimaryLabel || 'Play').trim() || 'Play';
  const showWorthToWaitBadge =
    String(active?.heroSourceKey || '').trim() === 'worthToWait' &&
    String(active?.releaseDate || '').trim() &&
    String(active?.releaseState || '').trim().toLowerCase() !== 'released';
  const countdownText = showWorthToWaitBadge
    ? formatCountdownLabel(
        msUntilRelease({
          releaseDate: active.releaseDate,
          timeZone: String(active?.releaseTimezone || '').trim() || 'Asia/Manila',
          nowTs,
        })
      )
    : '';

  return (
    <div
      className="group relative -mx-4 sm:-mx-6 lg:-mx-10 mb-6 h-[68vh] md:h-[72vh] lg:h-[74vh] w-auto overflow-hidden"
      style={{
        marginTop: `-${headerH + SHELL_HEADER_OFFSET + SECTION_TOP_GAP}px`,
        paddingTop: `${headerH}px`,
        touchAction: 'pan-y',
      }}
      onMouseEnter={handleHeroMouseEnter}
      onMouseLeave={handleHeroMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        touchRef.current = { active: false, x: 0, y: 0 };
      }}
    >
      {/* background */}
      <div className="absolute inset-0">
        {src ? (
          <TmdbBackdrop path={src} alt={active.title} preferContain={shouldContainBackdrop} />
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
      {showWorthToWaitBadge && countdownText ? (
        <div
          className="absolute right-4 z-20 inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-amber-300/35 bg-black/45 px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur-md sm:right-6 lg:right-10"
          style={{ top: `${headerH + 18}px` }}
        >
          <span className="uppercase tracking-[0.2em] text-amber-200/85">Coming soon</span>
          <span aria-hidden className="h-1 w-1 rounded-full bg-amber-200/70" />
          <span className="text-white">{countdownText}</span>
        </div>
      ) : null}

      <div className="relative z-10 flex h-full flex-col justify-end px-4 sm:px-6 lg:px-10 pb-10">
        <div className="max-w-[72ch] bg-gradient-to-r from-black/80 via-black/50 to-transparent p-5 sm:p-6">
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
          {overviewText ? (
            <p className="mb-5 max-w-3xl text-sm text-neutral-200 md:text-base line-clamp-3">
              {overviewText}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            {onPlay ? (
              <button
                onClick={() => onPlay(active)}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-3 font-semibold text-white"
                style={{ background: BRAND }}
              >
                <Play size={18} /> {primaryLabel}
              </button>
            ) : null}
            {onAdd ? (
              <button
                onClick={() => onAdd(active)}
                className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
                title="Add to watchlist"
              >
                <Plus />
              </button>
            ) : null}
            {onDetails ? (
              <button
                onClick={() => onDetails(active)}
                className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/15"
                title="Details"
              >
                <Info />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* arrows */}
      <button
        type="button"
        className="
          absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white
          sm:inline-flex
          hover:bg-black/60 cursor-pointer z-20 transition
        "
        onClick={() => stepSlide(-1, { manual: true })}
        onMouseEnter={handleArrowHoverStart}
        onMouseLeave={handleArrowHoverEnd}
        onFocus={handleArrowHoverStart}
        onBlur={handleArrowHoverEnd}
        aria-label="Previous"
      >
        <ChevronLeft />
      </button>
      <button
        type="button"
        className="
          absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white
          sm:inline-flex
          hover:bg-black/60 cursor-pointer z-20 transition
        "
        onClick={() => stepSlide(1, { manual: true })}
        onMouseEnter={handleArrowHoverStart}
        onMouseLeave={handleArrowHoverEnd}
        onFocus={handleArrowHoverStart}
        onBlur={handleArrowHoverEnd}
        aria-label="Next"
      >
        <ChevronRight />
      </button>

      {/* dots */}
      <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-2 py-1">
        <div className="flex items-center gap-1">
          {slides.map((s, i) => (
            <button
              type="button"
              key={slideKey(s)}
              onClick={() => moveToSlide(i, { manual: true })}
              className={`h-2 w-3 cursor-pointer rounded-full transition-all ${
                i === index ? 'w-4 bg-[var(--brand)]' : 'bg-white/60'
              }`}
              style={{ ['--brand']: BRAND }}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
