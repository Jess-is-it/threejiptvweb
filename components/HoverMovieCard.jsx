'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Bell, Info, Play, Star } from 'lucide-react';
import { useSession } from './SessionProvider';
import { readJsonSafe } from '../lib/readJsonSafe';
import { useUserPreferences } from './UserPreferencesProvider';

const trailerCache = new Map();

function ytSrc(key) {
  const k = encodeURIComponent(String(key || '').trim());
  if (!k) return '';
  // loop=1 requires playlist=<id>
  // Note: YouTube embed UI cannot be fully removed; these params minimize branding/overlays.
  return `https://www.youtube-nocookie.com/embed/${k}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1&loop=1&playlist=${k}&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0`;
}

function fmtDuration(d) {
  if (d === null || d === undefined || d === '') return '';
  if (typeof d === 'number') {
    const s = Math.max(0, Math.floor(d));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }
  const str = String(d);
  // common forms: "01:40:12" or "100 min"
  const m = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const h = Number(m[1] || 0);
    const mm = Number(m[2] || 0);
    if (h) return `${h}h ${mm}m`;
    return `${mm}m`;
  }
  return str;
}

function extractYouTubeKey(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return (u.pathname || '').replace('/', '');
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v') || '';
  } catch {}
  return '';
}

function formatReleaseDate(dateValue, { includeYear = true } = {}) {
  const raw = String(dateValue || '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(dd)) return raw;
  try {
    const dt = new Date(Date.UTC(y, mm - 1, dd));
    const options = {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    };
    if (includeYear) options.year = 'numeric';
    return new Intl.DateTimeFormat('en-US', {
      ...options,
    }).format(dt);
  } catch {
    return raw;
  }
}

export default function HoverMovieCard({ item, kind = 'movie', className = '', style = {}, showTitle = false }) {
  const router = useRouter();
  const { session } = useSession();
  const { movieCardClickAction } = useUserPreferences();
  const [modalOpen, setModalOpen] = useState(false);
  const [trailerKey, setTrailerKey] = useState('');
  const [loadingTrailer, setLoadingTrailer] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [meta, setMeta] = useState(null);
  const [tmdb, setTmdb] = useState(null);
  const [loadingTmdb, setLoadingTmdb] = useState(false);
  const [remindLoading, setRemindLoading] = useState(false);
  const [remindError, setRemindError] = useState('');
  const [remindSuccess, setRemindSuccess] = useState('');
  const [reminded, setReminded] = useState(Boolean(item?.reminded));
  const closeTimer = useRef(null);

  const cacheKey = `${String(item?.title || '').trim()}|${String(item?.year || '').trim()}`;
  const trailerUrl = useMemo(() => ytSrc(trailerKey), [trailerKey]);
  const releaseDate = String(item?.releaseDate || '').trim();
  const releaseDateLabel = useMemo(() => formatReleaseDate(releaseDate), [releaseDate]);
  const releaseDateCardLabel = useMemo(() => formatReleaseDate(releaseDate, { includeYear: false }), [releaseDate]);
  const mediaType = String(item?.mediaType || (kind === 'tv' || kind === 'series' ? 'tv' : 'movie')).toLowerCase() === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(item?.tmdbId || 0);
  const isUpcoming = Boolean(releaseDate) && String(item?.releaseState || '').toLowerCase() !== 'released' && tmdbId > 0;
  const description = String(tmdb?.overview || meta?.plot || item?.overview || '').trim();
  const tmdbRatingText =
    tmdb?.rating !== null && tmdb?.rating !== undefined && Number.isFinite(Number(tmdb.rating))
      ? Number(tmdb.rating).toFixed(1)
      : '';
  const xuiRatingText =
    meta?.rating !== null && meta?.rating !== undefined && String(meta.rating).trim()
      ? String(meta.rating).trim()
      : '';
  const genresText = meta?.genre
    ? String(meta.genre).trim()
    : Array.isArray(tmdb?.genres) && tmdb.genres.length
      ? tmdb.genres.slice(0, 2).join(', ')
      : '';
  const durationText = meta?.duration
    ? fmtDuration(meta.duration)
    : tmdb?.runtime
      ? fmtDuration(tmdb.runtime * 60)
      : '';
  const yearText = String(item?.year || '').trim();

  useEffect(() => {
    setReminded(Boolean(item?.reminded));
    setRemindError('');
    setRemindSuccess('');
  }, [item?.id, item?.reminded]);

  const closeModal = () => {
    setModalOpen(false);
    clearTimeout(closeTimer.current);
  };

  useEffect(() => {
    if (!modalOpen) return;

    let alive = true;
    setTmdb(null);

    // Fetch detailed metadata (genre/duration/trailer hint)
    (async () => {
      if (!session?.streamBase || !item?.id || kind !== 'movie') return;
      setLoadingMeta(true);
      try {
        const r = await fetch(`/api/xuione/vod/${item.id}?streamBase=${encodeURIComponent(session.streamBase)}`);
        const d = await readJsonSafe(r);
        if (!alive) return;
        if (r.ok && d?.ok) setMeta(d);
      } catch {} finally {
        if (alive) setLoadingMeta(false);
      }
    })();

    // Fetch TMDB rating + genres + runtime
    (async () => {
      if (!item?.title) return;
      setLoadingTmdb(true);
      try {
        const sp = new URLSearchParams();
        sp.set('title', item.title);
        if (item.year) sp.set('year', String(item.year));
        sp.set('kind', kind);
        if (tmdbId > 0) sp.set('id', String(tmdbId));
        sp.set('mediaType', mediaType);
        const r = await fetch(`/api/tmdb/details?${sp.toString()}`);
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.ok && d?.ok) {
          setTmdb({
            rating: d?.rating ?? null,
            genres: Array.isArray(d?.genres) ? d.genres : [],
            runtime: d?.runtime ?? null,
            overview: String(d?.overview || '').trim(),
            cast: Array.isArray(d?.cast) ? d.cast : [],
          });
        }
      } catch {} finally {
        if (alive) setLoadingTmdb(false);
      }
    })();

    // Fetch trailer key (from Xuione trailer first; fallback to TMDB->YouTube)
    (async () => {
      if (!item?.title) return;
      const cached = trailerCache.get(cacheKey);
      if (cached !== undefined) {
        if (alive) setTrailerKey(cached || '');
        return;
      }

      setLoadingTrailer(true);
      try {
        const sp = new URLSearchParams();
        sp.set('title', item.title);
        if (item.year) sp.set('year', String(item.year));
        sp.set('kind', kind);
        const r = await fetch(`/api/tmdb/trailer?${sp.toString()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json().catch(() => ({}));
        const k = String(d?.key || '').trim();
        trailerCache.set(cacheKey, k || null);
        if (alive) setTrailerKey(k);
      } catch {
        trailerCache.set(cacheKey, null);
        if (alive) setTrailerKey('');
      } finally {
        if (alive) setLoadingTrailer(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  // If Xuione VOD info includes a YouTube trailer link, prefer it (fast + more accurate for IPTV titles).
  useEffect(() => {
    if (!modalOpen) return;
    if (trailerKey) return;
    const k = extractYouTubeKey(meta?.trailer);
    if (!k) return;
    trailerCache.set(cacheKey, k);
    setTrailerKey(k);
  }, [modalOpen, meta?.trailer, trailerKey, cacheKey]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const onPlay = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
    } catch {}
    if (kind === 'movie') router.push(`/watch/movie/${item.id}?auto=1`);
    else router.push(item?.href || '#');
  };

  const onInfo = (e) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(item?.href || `/movies/${item.id}`);
  };

  const onRemind = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (reminded) {
      setRemindSuccess('Reminder already enabled.');
      setRemindError('');
      return;
    }
    const username = String(session?.user?.username || '').trim();
    if (!username) {
      setRemindError('Please sign in again to enable reminders.');
      setRemindSuccess('');
      return;
    }
    if (!tmdbId) {
      setRemindError('Missing TMDB title id for reminder.');
      setRemindSuccess('');
      return;
    }
    setRemindLoading(true);
    setRemindError('');
    setRemindSuccess('');
    try {
      const r = await fetch('/api/public/autodownload/upcoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remind',
          username,
          tmdbId,
          mediaType,
          title: String(item?.title || '').trim(),
          releaseDate,
        }),
      });
      const d = await readJsonSafe(r);
      if (!r.ok || !d?.ok) throw new Error(d?.error || 'Failed to subscribe reminder.');
      setReminded(true);
      setRemindSuccess('Reminder enabled. We will notify you when available.');
      setRemindError('');
    } catch (err) {
      setRemindError(err?.message || 'Failed to subscribe reminder.');
      setRemindSuccess('');
    } finally {
      setRemindLoading(false);
    }
  };

  const href = item?.href || (item?.id ? `/movies/${item.id}` : '#');
  const img = item?.image || '/placeholders/poster-fallback.jpg';

  const modalEl =
    modalOpen && typeof document !== 'undefined' ? (
      <div
        className="fixed inset-0 z-[1000]"
        onMouseEnter={() => {
          clearTimeout(closeTimer.current);
        }}
        onMouseLeave={() => {
          // Close when user moves away from the modal as well.
          clearTimeout(closeTimer.current);
          closeTimer.current = setTimeout(() => {
            closeModal();
          }, 80);
        }}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/70"
          aria-label="Close preview"
          onClick={() => closeModal()}
        />

        <div className="absolute left-1/2 top-1/2 w-[min(820px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl">
          <div className="relative aspect-video bg-black">
            {trailerUrl ? (
              <iframe
                key={trailerKey}
                src={trailerUrl}
                title={`${item?.title || 'Trailer'} trailer`}
                className="absolute inset-0 h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <>
                <img src={img} alt={item?.title || ''} className="h-full w-full object-cover" />
                {loadingTrailer ? (
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-neutral-900 via-neutral-800/40 to-neutral-900" />
                ) : null}
              </>
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          </div>

          <div className="p-5 text-neutral-100">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-xl font-semibold">{item?.title || meta?.title || 'Untitled'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                  {tmdbRatingText ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs text-neutral-100">
                      <Star size={12} className="fill-amber-300 text-amber-300" />
                      {tmdbRatingText}
                    </span>
                  ) : null}
                  {xuiRatingText ? (
                    <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs text-neutral-100">
                      XUI {xuiRatingText}
                    </span>
                  ) : null}
                  {isUpcoming && releaseDateLabel ? (
                    <span className="mr-2 rounded-full border border-amber-300/40 bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-100">
                      Release date: {releaseDateLabel}
                    </span>
                  ) : null}
                  {genresText ? <span>{genresText}</span> : null}
                  {durationText ? <span>• {durationText}</span> : null}
                  {yearText ? <span>• {yearText}</span> : null}
                  {loadingTmdb ? (
                    <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs text-neutral-300">
                      Loading TMDB…
                    </span>
                  ) : null}
                  {loadingMeta && !meta ? <span className="text-neutral-400">Loading details…</span> : null}
                </div>
                {description ? (
                  <p className="mt-3 line-clamp-3 text-sm text-neutral-200">{description}</p>
                ) : null}
                {Array.isArray(tmdb?.cast) && tmdb.cast.length ? (
                  <p className="mt-2 line-clamp-2 text-xs text-neutral-300">
                    <span className="font-semibold text-neutral-200">Cast:</span> {tmdb.cast.slice(0, 8).join(', ')}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                {isUpcoming ? (
                  <button
                    onClick={onRemind}
                    disabled={remindLoading || reminded}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#CA4443] bg-[#CA4443] px-4 py-3 text-sm font-semibold text-white hover:bg-[#b73d3c] disabled:cursor-not-allowed disabled:opacity-70"
                    aria-label="Remind me"
                    title="Remind me"
                  >
                    <Bell size={16} />
                    <span>{reminded ? 'Reminder enabled' : remindLoading ? 'Saving…' : 'Remind me'}</span>
                  </button>
                ) : (
                  <button
                    onClick={onPlay}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-neutral-100"
                    aria-label="Play"
                    title="Play"
                  >
                    <Play size={18} />
                    <span>Play</span>
                  </button>
                )}
                <button
                  onClick={onInfo}
                  className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-white hover:bg-white/15"
                  aria-label="More info"
                  title="More info"
                >
                  <Info size={18} />
                </button>
              </div>
            </div>
            </div>
            {isUpcoming && (remindError || remindSuccess) ? (
              <div className={`mt-3 text-xs ${remindError ? 'text-red-300' : 'text-emerald-300'}`}>
                {remindError || remindSuccess}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div
      className={
        // Fixed poster footprint; the card inside is `absolute` and scales on hover.
        'relative aspect-[2/3] overflow-visible ' +
        (modalOpen ? 'z-[250] ' : 'z-10 ') +
        ' ' +
        className
      }
      style={style}
    >
      {/* Click behavior is controlled by user preference. */}
      <button
        type="button"
        className="absolute inset-0 overflow-hidden rounded-lg bg-neutral-800"
        onClick={(e) => {
          if (kind !== 'movie') return router.push(href);
          if (isUpcoming || movieCardClickAction === 'preview') {
            e.preventDefault();
            e.stopPropagation();
            setModalOpen(true);
            return;
          }
          return onPlay(e);
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={item?.title ? (isUpcoming ? `Preview ${item.title}` : `Play ${item.title}`) : isUpcoming ? 'Preview' : 'Play'}
        title={item?.title || ''}
      >
        <img src={img} alt={item?.title || ''} className="h-full w-full object-cover" loading="lazy" />
        {isUpcoming && releaseDateCardLabel ? (
          <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-amber-300/40 bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
            {releaseDateCardLabel}
          </div>
        ) : null}
      </button>

      {/* Optional title below the card (kept outside the expanding element) */}
      {showTitle ? <div className="mt-2 line-clamp-1 text-sm text-neutral-200">{item?.title}</div> : null}

      {/* Preview modal (optional) */}
      {modalEl ? createPortal(modalEl, document.body) : null}
    </div>
  );
}
