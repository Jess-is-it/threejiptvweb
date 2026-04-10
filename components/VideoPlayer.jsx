'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Hls from 'hls.js';
import { upsertContinue } from './continueStore';
import { useSession } from './SessionProvider';
import { readJsonSafe } from '../lib/readJsonSafe';
import { readMovieReturnState } from '../lib/moviePlaySeed';
import {
  ArrowLeft,
  Flag,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Captions,
  Maximize2,
  Minimize2,
  Check,
  X,
  SkipForward,
  List,
} from 'lucide-react';

function isPrivateHostname(host = '') {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost') return true;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  return value === '::1' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd');
}

function toBrowserMediaUrl(raw, { forceProxy = false } = {}) {
  try {
    if (typeof window === 'undefined') return raw;
    const url = new URL(String(raw || ''), window.location.href);
    const hintedExt = String(
      url.searchParams.get('extension') || url.searchParams.get('format') || url.searchParams.get('type') || ''
    )
      .trim()
      .toLowerCase();
    const hlsLike = /\.m3u8($|\?)/i.test(url.toString()) || hintedExt === 'm3u8';
    const privateHost = isPrivateHostname(url.hostname);
    const crossOrigin = url.origin !== window.location.origin;
    if (!crossOrigin) return url.toString();
    if (forceProxy || hlsLike || privateHost) {
      return `/api/proxy/hls?url=${encodeURIComponent(url.toString())}`;
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function useToasts() {
  const [msgs, setMsgs] = useState([]);
  const push = (text, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setMsgs((m) => [...m, { id, text, tone }]);
    setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 3200);
  };
  const View = () => (
    <div className="pointer-events-none fixed inset-0 z-[120] flex flex-col items-center justify-center gap-3 px-4">
      {msgs.map((m) => (
        <div
          key={m.id}
          className={
            'pointer-events-auto flex w-full max-w-lg items-start gap-4 rounded-2xl border px-6 py-5 text-base shadow-2xl backdrop-blur-md sm:max-w-xl sm:text-lg ' +
            (m.tone === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-50'
              : m.tone === 'error'
                ? 'border-red-500/30 bg-red-500/15 text-red-50'
                : 'border-white/10 bg-black/60 text-neutral-100')
          }
          role="status"
          aria-live="polite"
        >
          <div className="mt-0.5 shrink-0">
            {m.tone === 'success' ? (
              <Check size={18} />
            ) : m.tone === 'error' ? (
              <X size={18} />
            ) : (
              <Flag size={18} />
            )}
          </div>
          <div className="min-w-0 leading-snug">{m.text}</div>
        </div>
      ))}
    </div>
  );
  return { push, View };
}

export default function VideoPlayer({
  mp4, hls, preferHls = false, meta,
  mode = 'inline', // 'inline' | 'immersive'
  chrome = 'default', // 'default' | 'background'
  autoFullscreen = false,
  autoPlayOnLoad = false,
  startMuted = undefined,
  fill = false,
  servers = [],
  activeOrigin = '',
  onSelectServer = null,
  onPlaybackError = null,
  onMutedChange = null,
  controlRef = null,
  subtitles = [],
  menuNavigation = null,
  seriesNavigation = null,
}) {
  const router = useRouter();
  const { session } = useSession();
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const attachSrcRef = useRef(null);
  const forcedUseHlsRef = useRef(null);
  const isBackgroundChrome = chrome === 'background';
  const [origin, setOrigin] = useState(activeOrigin);
  const [srcs, setSrcs] = useState({ mp4, hls });
  const [useHls, setUseHls] = useState(Boolean((preferHls && hls) || (!mp4 && hls)));
  const [err, setErr] = useState('');
  const [showControls, setShowControls] = useState(true);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState({ position: 0, duration: 0 });
  const [subsOpen, setSubsOpen] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportChoice, setReportChoice] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scrub, setScrub] = useState({ active: false, value: 0 });
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [fsArmed, setFsArmed] = useState(Boolean(autoFullscreen));
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [nextPreviewOpen, setNextPreviewOpen] = useState(false);
  const [episodeBrowserOpen, setEpisodeBrowserOpen] = useState(false);
  const [episodeBrowserSeason, setEpisodeBrowserSeason] = useState(null);
  const [menuBrowserOpen, setMenuBrowserOpen] = useState(false);
  const [menuBrowserGroupId, setMenuBrowserGroupId] = useState(null);
  const [menuNextPreviewOpen, setMenuNextPreviewOpen] = useState(false);
  const stallTimer = useRef(null);
  const attemptRef = useRef({ key: '', triedMp4: false, triedHls: false });
  const currentRef = useRef({ kind: '', url: '' });
  const prevMp4Ref = useRef(mp4);
  const liveRecoverRef = useRef({ lastAt: 0, tries: 0 });
  const livePlaylistRecoverRef = useRef({ lastAt: 0, windowStartAt: 0, tries: 0 });
  const liveHardResetRef = useRef({ lastAt: 0, windowStartAt: 0, resets: 0 });
  const { push, View: Toasts } = useToasts();
  const onMutedChangeRef = useRef(null);

  useEffect(() => {
    onMutedChangeRef.current = typeof onMutedChange === 'function' ? onMutedChange : null;
  }, [onMutedChange]);

  useEffect(() => {
    forcedUseHlsRef.current = useHls;
  }, [useHls]);

  const isHlsSource = (raw) => {
    const s = String(raw || '');
    if (/\.m3u8($|\?)/i.test(s)) return true;
    try {
      const u = new URL(s, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
      const ext = String(
        u.searchParams.get('extension') || u.searchParams.get('format') || u.searchParams.get('type') || ''
      )
        .trim()
        .toLowerCase();
      if (ext === 'm3u8') return true;
    } catch {}
    // Our proxy hides the upstream extension in the querystring.
    // Detect `.../api/proxy/hls?url=<upstream.m3u8>`
    if (s.startsWith('/api/proxy/hls?')) {
      try {
        const u = new URL(s, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
        const inner = u.searchParams.get('url') || '';
        if (/\.m3u8($|\?)/i.test(inner)) return true;
        const innerUrl = new URL(inner, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
        const ext = String(
          innerUrl.searchParams.get('extension') ||
            innerUrl.searchParams.get('format') ||
            innerUrl.searchParams.get('type') ||
            ''
        )
          .trim()
          .toLowerCase();
        return ext === 'm3u8';
      } catch {}
    }
    return false;
  };

  const subtitleTracks = useMemo(
    () =>
      (subtitles || [])
        .map((track) => ({
          ...track,
          url: toBrowserMediaUrl(track?.url || '', { forceProxy: true }),
        }))
        .filter((track) => track.url),
    [subtitles]
  );
  const seriesSeasons = useMemo(
    () => (Array.isArray(seriesNavigation?.seasons) ? seriesNavigation.seasons : []),
    [seriesNavigation?.seasons]
  );
  const menuGroups = useMemo(
    () => (Array.isArray(menuNavigation?.groups) ? menuNavigation.groups : []),
    [menuNavigation?.groups]
  );
  const menuGroupLabel = String(menuNavigation?.groupLabel || 'Categories').trim() || 'Categories';
  const menuItemLabel = String(menuNavigation?.itemLabel || 'Channels').trim() || 'Channels';
  const currentMenuItemId = String(menuNavigation?.currentItemId || '').trim();
  const nextMenuItem = menuNavigation?.nextItem || null;
  const currentSeriesSeasonNumber = Number(seriesNavigation?.currentSeasonNumber || 0) || null;
  const currentSeriesEpisodeId = String(seriesNavigation?.currentEpisodeId || '').trim();
  const nextSeriesEpisode =
    meta?.type === 'series' && seriesNavigation?.nextEpisode ? seriesNavigation.nextEpisode : null;
  const activeEpisodeBrowserSeason = useMemo(() => {
    if (!episodeBrowserSeason) return null;
    return (
      seriesSeasons.find((season) => Number(season?.seasonNumber || 0) === Number(episodeBrowserSeason || 0)) || null
    );
  }, [episodeBrowserSeason, seriesSeasons]);
  const canNavigateSeriesEpisodes =
    meta?.type === 'series' && typeof seriesNavigation?.onSelectEpisode === 'function' && seriesSeasons.length > 0;
  const canNavigateMenu =
    typeof menuNavigation?.onSelectItem === 'function' && menuGroups.length > 0;
  const renderMenuNav = canNavigateMenu && !canNavigateSeriesEpisodes;

  useEffect(() => {
    setNextPreviewOpen(false);
    setEpisodeBrowserOpen(false);
    setEpisodeBrowserSeason(currentSeriesSeasonNumber || null);
  }, [meta?.id, currentSeriesSeasonNumber]);

  useEffect(() => {
    setMenuNextPreviewOpen(false);
    setMenuBrowserOpen(false);
    setMenuBrowserGroupId(null);
  }, [meta?.id]);

  // overlay visibility
  useEffect(() => {
    const poke = () => {
      setShowControls(true);
      clearTimeout(stallTimer.current);
      stallTimer.current = setTimeout(() => {
        setShowControls(false);
        setSubsOpen(false);
        setVolOpen(false);
      }, 1800);
    };
    const el = wrapRef.current;
    el?.addEventListener('mousemove', poke);
    el?.addEventListener('touchstart', poke, { passive:true });
    el?.addEventListener('touchmove', poke, { passive:true });
    poke();
    return () => {
      el?.removeEventListener('mousemove', poke);
      el?.removeEventListener('touchstart', poke);
      el?.removeEventListener('touchmove', poke);
      clearTimeout(stallTimer.current);
    };
  }, []);

  // immersive mode: prevent background scrolling
  useEffect(() => {
    if (mode !== 'immersive') return;
    try {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    } catch {}
  }, [mode]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    onFs();
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    setFsArmed(Boolean(autoFullscreen));
  }, [autoFullscreen]);

  // If MP4 URL changes (e.g., after we learn container extension), only auto-prefer MP4
  // when caller did not explicitly ask to keep HLS first.
  useEffect(() => {
    if (prevMp4Ref.current !== mp4) {
      prevMp4Ref.current = mp4;
      if (mp4 && !preferHls) setUseHls(false);
    }
  }, [mp4, preferHls]);

  useLayoutEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (typeof v.volume === 'number') setVol(v.volume);
      const nextMuted = Boolean(v.muted);
      const nextVol = typeof v.volume === 'number' ? v.volume : 1;
      setMuted(nextMuted);
      setNeedsUnmute(Boolean(v.muted || v.volume === 0));
      onMutedChangeRef.current?.(nextMuted, nextVol);
    } catch {}

    const onVol = () => {
      try {
        const nextMuted = Boolean(v.muted);
        const nextVol = typeof v.volume === 'number' ? v.volume : 1;
        setVol(nextVol);
        setMuted(nextMuted);
        setNeedsUnmute(Boolean(v.muted || v.volume === 0));
        onMutedChangeRef.current?.(nextMuted, nextVol);
      } catch {}
    };
    v.addEventListener('volumechange', onVol);
    return () => v.removeEventListener('volumechange', onVol);
  }, []);

  // keep origin in sync with parent
  useEffect(() => { setOrigin(activeOrigin || origin); }, [activeOrigin]); // eslint-disable-line

  // when origin changes, rebuild URLs
  useEffect(() => {
    if (!origin || !meta?.id) return;
    const build = (template) => {
      if (!template) return '';
      try {
        const u = new URL(template);
        return `${origin}${u.pathname}`;
      } catch {
        return template;
      }
    };
    setSrcs({ mp4: build(mp4), hls: build(hls) });
  }, [origin, mp4, hls, meta?.id]);

  // core attach
  useLayoutEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let hlsInst;
    let loadTimeout;

    const attachSrc = (url, forceUseHls = null) => {
      setErr('');

      // Ensure we don't leak old HLS instances when we re-attach/recover (important for long-running live playback).
      if (hlsInst) {
        try {
          hlsInst.destroy();
        } catch {}
        hlsInst = null;
      }

      const maybeProxy = (raw) => {
        const proxied = toBrowserMediaUrl(raw, { forceProxy: meta?.type === 'live' });
        return proxied || raw;
      };

      const isHlsLike = isHlsSource(url);
      const finalUrl = maybeProxy(url);
      const useHlsWanted = typeof forceUseHls === 'boolean' ? forceUseHls : useHls;
      forcedUseHlsRef.current = useHlsWanted;
      currentRef.current = {
        kind: useHlsWanted && isHlsLike ? 'hls' : 'mp4',
        url: finalUrl,
      };
      // clear previous
      v.pause();
      v.removeAttribute('src');
      v.load();

      // attach
      if (useHlsWanted && isHlsLike) {
        if (Hls.isSupported()) {
          hlsInst = new Hls({
            // Low latency mode tends to be brittle on some IPTV panels (sequence discontinuities, short windows).
            // Prefer stability over minimal latency.
            lowLatencyMode: meta?.type === 'live' ? false : true,
            enableWorker: true,
            backBufferLength: 90,
            maxBufferLength: 30,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 10,
            // network retries
            manifestLoadingMaxRetry: 6,
            manifestLoadingRetryDelay: 1000,
            levelLoadingMaxRetry: 6,
            levelLoadingRetryDelay: 1000,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000,
            fragLoadingMaxRetryTimeout: 60000,
          });
          hlsInst.loadSource(finalUrl);
          hlsInst.attachMedia(v);
          hlsInst.on(Hls.Events.ERROR, (_evt, data) => {
            if (!data) return;
            const detail = String(data?.details || '').toLowerCase();
            const msg = String(data?.err?.message || data?.error?.message || '');
            const isLiveRecoverablePlaylistNoise =
              meta?.type === 'live' &&
              (msg.toLowerCase().includes('media sequence mismatch') ||
                detail === 'levelparsingerror' ||
                detail === 'levelloaderror' ||
                detail === 'manifestloaderror');
            try {
              // Live IPTV panels can emit transient playlist mismatches even while playback stays healthy.
              // The recovery path below handles those; avoid spamming the console with expected noise.
              if (!isLiveRecoverablePlaylistNoise) {
                console.warn('[3JTV][HLS]', data?.type, data?.details, data);
              }
            } catch {}
            if (data?.fatal) {
              // Hard reset helper: destroy/recreate pipeline with a cache-busted root playlist.
              const hardResetLive = () => {
                try {
                  const isLive = meta?.type === 'live';
                  if (!isLive || !srcs.hls) return false;
                  const now = Date.now();
                  if (!liveHardResetRef.current.windowStartAt || now - liveHardResetRef.current.windowStartAt > 60_000) {
                    liveHardResetRef.current.windowStartAt = now;
                    liveHardResetRef.current.resets = 0;
                  }
                  // Prevent rapid flicker loops.
                  if (now - (liveHardResetRef.current.lastAt || 0) < 8000) return false;
                  if (liveHardResetRef.current.resets >= 3) return false;
                  liveHardResetRef.current.lastAt = now;
                  liveHardResetRef.current.resets += 1;

                  const bust = (s) => {
                    const str = String(s || '');
                    if (!str) return str;
                    return str.includes('?') ? `${str}&_t=${Date.now()}` : `${str}?_t=${Date.now()}`;
                  };
                  attachSrc(bust(srcs.hls));
                  setTimeout(() => {
                    try {
                      v.play?.();
                    } catch {}
                  }, 200);
                  return true;
                } catch {
                  return false;
                }
              };

              // Soft reload helper: refresh manifest loading without detaching the <video>.
              // This avoids a visible flicker for transient live playlist inconsistencies.
              const softResyncLive = () => {
                try {
                  const isLive = meta?.type === 'live';
                  if (!isLive || !srcs.hls) return false;
                  const now = Date.now();
                  if (
                    !livePlaylistRecoverRef.current.windowStartAt ||
                    now - livePlaylistRecoverRef.current.windowStartAt > 20_000
                  ) {
                    livePlaylistRecoverRef.current.windowStartAt = now;
                    livePlaylistRecoverRef.current.tries = 0;
                  }
                  if (now - (livePlaylistRecoverRef.current.lastAt || 0) < 1500) return false;
                  if (livePlaylistRecoverRef.current.tries >= 4) return false;
                  livePlaylistRecoverRef.current.lastAt = now;
                  livePlaylistRecoverRef.current.tries += 1;
                  // Ask hls.js to re-sync from the current live edge without replacing the media pipeline.
                  try { hlsInst?.stopLoad?.(); } catch {}
                  try { hlsInst?.startLoad?.(-1); } catch {}
                  setTimeout(() => {
                    try { v.play?.(); } catch {}
                  }, 120);
                  return true;
                } catch {
                  return false;
                }
              };

              const softReloadLive = () => {
                try {
                  const isLive = meta?.type === 'live';
                  if (!isLive || !srcs.hls) return false;
                  const now = Date.now();
                  if (now - (liveHardResetRef.current.lastAt || 0) < 4000) return false;
                  const bust = (s) => {
                    const str = String(s || '');
                    if (!str) return str;
                    return str.includes('?') ? `${str}&_t=${Date.now()}` : `${str}?_t=${Date.now()}`;
                  };
                  // Stop loading, refresh root, then resume from live edge.
                  try { hlsInst?.stopLoad?.(); } catch {}
                  try { hlsInst?.loadSource?.(bust(srcs.hls)); } catch {}
                  try { hlsInst?.startLoad?.(-1); } catch {}
                  // Keep current audio state.
                  setTimeout(() => {
                    try { v.play?.(); } catch {}
                  }, 150);
                  return true;
                } catch {
                  return false;
                }
              };

              // If a nested playlist URL expires or the upstream returned HTML (common after a while on live),
              // restart from the root source to get a fresh token.
              try {
                const isLive = meta?.type === 'live';
                const status =
                  data?.response?.code ||
                  data?.response?.status ||
                  data?.networkDetails?.status ||
                  data?.networkDetails?.statusCode ||
                  0;
                const isNet = data.type === Hls.ErrorTypes.NETWORK_ERROR;
                const is404 = Number(status) === 404;
                const isLevelOrManifest =
                  String(data?.details || '').includes('level') || String(data?.details || '').includes('manifest');
                const isSeqMismatch = msg.toLowerCase().includes('media sequence mismatch');
                const isLivePlaylistError =
                  detail === 'levelparsingerror' ||
                  detail === 'levelloaderror' ||
                  detail === 'manifestloaderror';
                if (isLive && (isSeqMismatch || isLivePlaylistError)) {
                  // First try an in-place live-edge resync; only reload the source if that fails.
                  if (softResyncLive()) return;
                  if (softReloadLive()) return;
                  if (hardResetLive()) return;
                }
                if (isLive && isNet && (is404 || isLevelOrManifest)) {
                  if (softResyncLive()) return;
                  if (softReloadLive()) return;
                  if (hardResetLive()) return;
                }
              } catch {}

              // If the "m3u8" URL actually returns a media file (common with some panels),
              // HLS parsing fails with "no EXTM3U delimiter". In that case, try playing the
              // same URL as a direct video source.
              try {
                const msg = String(data?.err?.message || '');
                const noExtM3u =
                  data?.details === 'manifestParsingError' && msg.toLowerCase().includes('no extm3u');
                if (noExtM3u) {
                  const k = `${srcs.mp4}|${srcs.hls}`;
                  if (attemptRef.current.key !== k) {
                    attemptRef.current = { key: k, triedMp4: false, triedHls: false };
                  }
                  attemptRef.current.triedHls = true;
                  attemptRef.current.triedMp4 = true;
                  setErr('');
                  setUseHls(false);
                  setSrcs((s) => ({ ...s, mp4: data?.url || s.hls }));
                  return;
                }
              } catch {}

              // Attempt recovery for common fatal types
              try {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                  hlsInst?.startLoad?.();
                  return;
                }
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                  hlsInst?.recoverMediaError?.();
                  return;
                }
              } catch {}

              // If HLS failed, try MP4 once (often needed when m3u8 doesn't exist for this title).
              const k = `${srcs.mp4}|${srcs.hls}`;
              if (attemptRef.current.key !== k) {
                attemptRef.current = { key: k, triedMp4: false, triedHls: false };
              }
              if (srcs.mp4 && !attemptRef.current.triedMp4) {
                attemptRef.current.triedMp4 = true;
                setUseHls(false);
                return;
              }

              const detail = [data?.type, data?.details].filter(Boolean).join(' / ');
              setErr(detail ? `Playback error (${detail}).` : 'Playback error.');
            }
          });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = finalUrl;
        } else {
          setErr('HLS not supported.');
        }
      } else {
        v.src = finalUrl;
      }
    };

    // choose mp4 first; fallback to hls when error fires
    const start = async () => {
      const k = `${srcs.mp4}|${srcs.hls}`;
      if (attemptRef.current.key !== k) {
        attemptRef.current = { key: k, triedMp4: false, triedHls: false };
      }

      const url = (useHls ? (srcs.hls || srcs.mp4) : (srcs.mp4 || srcs.hls)) || '';
      if (!url) return;

      setAutoplayBlocked(false);
      if (url === srcs.hls) attemptRef.current.triedHls = true;
      if (url === srcs.mp4) attemptRef.current.triedMp4 = true;

      const maybeProxy = (raw) => {
        const proxied = toBrowserMediaUrl(raw, { forceProxy: meta?.type === 'live' });
        return proxied || raw;
      };
      const desiredFinal = maybeProxy(url);
      const useHlsForCheck = typeof forcedUseHlsRef.current === 'boolean' ? forcedUseHlsRef.current : useHls;
      const desiredKind = useHlsForCheck && isHlsSource(url) ? 'hls' : 'mp4';
      const isSame = currentRef.current?.url === desiredFinal && currentRef.current?.kind === desiredKind;
      const hasMediaAttached = Boolean(v.currentSrc || v.src);
      if (!isSame || !hasMediaAttached) {
        attachSrc(url, useHlsForCheck);
      }

      const tryPlay = async () => {
        if (!autoPlayOnLoad) return;

        try {
          // Live: start muted (autoplay-friendly) unless caller overrides.
          // VOD: try with sound first unless caller overrides.
          if (typeof startMuted === 'boolean') {
            v.muted = startMuted;
            if (!startMuted && typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
          } else if (meta?.type === 'live') {
            v.muted = true;
          } else {
            v.muted = false;
            if (typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
          }
        } catch {}

        try {
          await v.play();
          setNeedsUnmute(Boolean(v.muted || v.volume === 0));
        } catch (e) {
          // Some browsers won't allow audible autoplay after navigation, even if user clicked.
          // For VOD, prefer "start muted" over "doesn't start at all" (Netflix-style).
          const errName = String(e?.name || '').toLowerCase();
          const errMsg = String(e?.message || '').toLowerCase();
          const isAutoplayPolicy = errName.includes('notallowed') || errMsg.includes('notallowed');
          // Even when a caller asks for sound (`startMuted=false`), browsers may block audible autoplay
          // after a navigation. For Live, prefer "play muted + show unmute hint" over "doesn't start".
          const allowMutedFallback =
            meta?.type === 'live' ? true : (startMuted !== false && isAutoplayPolicy);
          if (allowMutedFallback) {
            try {
              v.muted = true;
              await v.play();
              setNeedsUnmute(true);
              setAutoplayBlocked(false);
              return;
            } catch {}
          }

          try { v.pause(); } catch {}
          setAutoplayBlocked(true);
          setNeedsUnmute(true);
          return;
        }

        // Fullscreen must be triggered by a user gesture; handled via ensureFullscreen().
      };

      // auto-switch if not playing within 15s
      clearTimeout(loadTimeout);
      loadTimeout = setTimeout(() => {
        if (v.readyState < 3) {
          const next = nextServer(origin, servers);
          if (next && next !== origin) {
            push(`${meta?.type === 'live' ? 'Stream' : 'Movie'} not responding for 15s, switching server…`);
            switchServer(next, true);
          }
        }
      }, 15000);

      await tryPlay();
    };

    attachSrcRef.current = attachSrc;

    // server switch with position preservation
    const switchServer = async (newOrigin, silent = false) => {
      const pos = Number.isFinite(v.currentTime) ? v.currentTime : 0;
      const wasPlaying = !v.paused;
      if (!silent) push(`Changing to ${labelFor(newOrigin, servers)}…`);
      setOrigin(newOrigin);
      // rebuild URLs immediately
      const build = (template) => {
        if (!template) return '';
        try { const u = new URL(template); return `${newOrigin}${u.pathname}`; }
        catch { return template; }
      };
      const newMp4 = build(mp4); const newHls = build(hls);
      const preferHls = useHls || (!newMp4 && newHls);
      attachSrc(preferHls ? newHls : newMp4);

      const onReady = async () => {
        try { v.currentTime = pos; } catch {}
        if (wasPlaying) { try { await v.play(); } catch {} }
        v.removeEventListener('loadedmetadata', onReady);
      };
      v.addEventListener('loadedmetadata', onReady, { once:true });
      onSelectServer && onSelectServer(newOrigin);
    };

    // handlers
	    const onError = () => {
	      const mediaErr = v?.error;
	      const errCode = mediaErr?.code || 0;
	      try {
	        console.warn('[3JTV][VIDEO]', 'error', errCode, mediaErr);
	      } catch {}
        try {
          onPlaybackError?.({
            code: errCode,
            message: String(mediaErr?.message || '').trim(),
            kind: currentRef.current?.kind || '',
            url: currentRef.current?.url || '',
            meta,
          });
        } catch {}

        // Live streams can occasionally return a bad segment (HTML/502) which causes a demuxer parse error.
        // Try a lightweight recover once or twice before surfacing the error.
        try {
          const isLive = meta?.type === 'live';
          const isDemux =
            String(mediaErr?.message || '').toLowerCase().includes('demuxer_error') ||
            String(mediaErr?.message || '').toLowerCase().includes('could_not_parse');
          if (isLive && errCode === 4 && isDemux && srcs.hls) {
            const now = Date.now();
            if (now - liveRecoverRef.current.lastAt > 3000) {
              liveRecoverRef.current.lastAt = now;
              liveRecoverRef.current.tries = 0;
            }
            if (liveRecoverRef.current.tries < 2) {
              liveRecoverRef.current.tries += 1;
              try {
                hlsInst?.recoverMediaError?.();
              } catch {}
              try {
                attachSrc(srcs.hls);
                // Best-effort resume
                setTimeout(() => {
                  try {
                    v.play?.();
                  } catch {}
                }, 250);
                return;
              } catch {}
            }
          }
        } catch {}

	      const k = `${srcs.mp4}|${srcs.hls}`;
	      if (attemptRef.current.key !== k) {
	        attemptRef.current = { key: k, triedMp4: false, triedHls: false };
	      }

      // Try the other format once.
      if (currentRef.current.kind === 'mp4' && srcs.hls && !attemptRef.current.triedHls) {
        attemptRef.current.triedHls = true;
        setUseHls(true);
        return;
      }
      if (currentRef.current.kind === 'hls' && srcs.mp4 && !attemptRef.current.triedMp4) {
        attemptRef.current.triedMp4 = true;
        setUseHls(false);
        return;
      }

      const msg =
        errCode === 1
          ? 'Playback error (aborted).'
          : errCode === 2
            ? 'Playback error (network).'
            : errCode === 3
              ? 'Playback error (decode).'
              : errCode === 4
                ? 'Playback error (unsupported source).'
                : 'Playback error.';
      setErr(msg);
    };
    const onWaiting = () => { /* optional hook */ };
    const onTime = () => {
      try {
        const duration = Number(v.duration);
        const position = Number(v.currentTime);
        setTime({
          position: Number.isFinite(position) ? position : 0,
          duration: Number.isFinite(duration) ? duration : 0,
        });
        const ok = Number.isFinite(duration) && duration > 0;
        upsertContinue({
          id: meta.id, type: meta.type || 'movie',
          title: meta.title || 'Untitled', image: meta.image || '', href: meta.href || '',
          progress: ok ? Math.round((position / duration) * 100) : null,
          position: ok ? position : null,
          duration: ok ? duration : null,
        });
      } catch {}
    };
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);

    v.addEventListener('error', onError);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    start();

    return () => {
      v.removeEventListener('error', onError);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      if (hlsInst) hlsInst.destroy();
      clearTimeout(loadTimeout);
      if (attachSrcRef.current === attachSrc) attachSrcRef.current = null;
    };
  }, [origin, srcs, useHls, autoFullscreen, autoPlayOnLoad, mp4, hls, servers, meta, chrome, startMuted]);

  const infoVisible = !showControls && paused;
  const backVisible = Boolean(showControls || err || autoplayBlocked);

  const title = meta?.title || 'Now Playing';
  const subTitle = useMemo(() => {
    const bits = [];
    if (meta?.type === 'series') {
      if (meta?.seasonNumber && meta?.episodeNumber) bits.push(`S${meta.seasonNumber}E${meta.episodeNumber}`);
    }
    if (meta?.year) bits.push(String(meta.year));
    if (meta?.genre) bits.push(String(meta.genre));
    return bits.filter(Boolean).join(' · ');
  }, [meta?.type, meta?.seasonNumber, meta?.episodeNumber, meta?.year, meta?.genre]);

  const desc = meta?.plot || meta?.overview || '';

  const canSeek = useMemo(() => {
    const d = Number(time.duration);
    return Number.isFinite(d) && d > 1 && d < 24 * 60 * 60 * 24; // < 24h
  }, [time.duration]);

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.paused) {
        await ensureFullscreen();
        // User gesture: try to start with sound, but fall back to muted if the browser blocks it.
        try {
          if (v.muted) v.muted = false;
          if (typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
        } catch {}
        try {
          await v.play();
          setAutoplayBlocked(false);
          setNeedsUnmute(Boolean(v.muted || v.volume === 0));
        } catch (e) {
          const errName = String(e?.name || '').toLowerCase();
          const errMsg = String(e?.message || '').toLowerCase();
          const isPolicy = errName.includes('notallowed') || errMsg.includes('notallowed');
          if (meta?.type === 'live' || isPolicy) {
            try {
              v.muted = true;
              await v.play();
              setAutoplayBlocked(false);
              setNeedsUnmute(true);
              return;
            } catch {}
          }
          throw e;
        }
      } else {
        v.pause();
      }
    } catch {}
  };

  const seekBy = (delta) => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const next = Math.max(0, Number(v.currentTime || 0) + Number(delta || 0));
      v.currentTime = next;
      setTime((t) => ({ ...t, position: next }));
    } catch {}
  };

  const seekTo = (t) => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const d = Number(time.duration || 0);
      const next = Math.min(d, Math.max(0, Number(t || 0)));
      v.currentTime = next;
      setTime((x) => ({ ...x, position: next }));
    } catch {}
  };

  const setVolume = (value) => {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.min(1, Math.max(0, Number(value)));
    try {
      v.volume = next;
      if (next > 0) v.muted = false;
      if (next === 0) v.muted = true;
    } catch {}
  };

  const onSpeakerClick = () => {
    const v = videoRef.current;
    if (!v) return;

    // First click: open slider. Next click: toggle mute.
    if (!volOpen) {
      setVolOpen(true);
      try {
        if (v.muted) v.muted = false;
        if (typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
      } catch {}
      return;
    }

    try {
      v.muted = !v.muted;
      if (!v.muted && typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
    } catch {}
  };

  const ensureFullscreen = async () => {
    if (!fsArmed) return;
    try {
      if (document.fullscreenElement) {
        setFsArmed(false);
        return;
      }
      await wrapRef.current?.requestFullscreen?.();
    } catch {
      // ignore (browser can refuse even with a gesture)
    } finally {
      setFsArmed(false);
    }
  };

  const unmuteNow = async () => {
    const v = videoRef.current;
    if (!v) return;
    // Avoid `await` here to preserve user activation for browsers that are strict about gesture chains.
    ensureFullscreen();
    try {
      v.muted = false;
      if (typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
      setNeedsUnmute(false);
      setAutoplayBlocked(false);
    } catch {}
    try {
      if (v.paused) {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {}
  };

  const muteNow = () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = true;
      setNeedsUnmute(true);
    } catch {}
  };

  const toggleMuteNow = () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.muted || v.volume === 0) {
        unmuteNow();
        return;
      }
      muteNow();
    } catch {}
  };

  useEffect(() => {
    if (!controlRef) return;
    try {
      controlRef.current = {
        mute: muteNow,
        unmute: unmuteNow,
        toggleMute: toggleMuteNow,
        isMuted: () => Boolean(videoRef.current?.muted || videoRef.current?.volume === 0),
        setVolume,
        switchToSources: (opts) => switchToSourcesNow({ ...(opts || {}) }),
      };
    } catch {}
    return () => {
      try {
        if (controlRef.current) controlRef.current = null;
      } catch {}
    };
  }, [controlRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {}

    try {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    } catch {}
    const movieReturnState = meta?.type === 'movie' ? readMovieReturnState() : null;
    if (movieReturnState?.href && typeof window !== 'undefined') {
      window.location.href = movieReturnState.href;
      return;
    }
    const href = meta?.backHref || (meta?.type === 'movie' ? `/movies/${meta?.id}` : '/');
    if (typeof window !== 'undefined') {
      window.location.href = href;
      return;
    }
    router.push(href);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await wrapRef.current?.requestFullscreen?.();
      }
    } catch {}
  };

  const goToSeriesEpisode = (episode) => {
    if (!canNavigateSeriesEpisodes || !episode?.id) return;
    if (String(episode.id) === currentSeriesEpisodeId) {
      setEpisodeBrowserOpen(false);
      setNextPreviewOpen(false);
      return;
    }
    setEpisodeBrowserOpen(false);
    setNextPreviewOpen(false);
    seriesNavigation.onSelectEpisode(episode);
  };

  const toggleEpisodeBrowser = () => {
    if (!canNavigateSeriesEpisodes) return;
    setSubsOpen(false);
    setVolOpen(false);
    setEpisodeBrowserOpen((open) => {
      const nextOpen = !open;
      setEpisodeBrowserSeason(nextOpen ? currentSeriesSeasonNumber || null : currentSeriesSeasonNumber || null);
      return nextOpen;
    });
  };

  const toggleMenuBrowser = () => {
    if (!canNavigateMenu) return;
    setSubsOpen(false);
    setVolOpen(false);
    setMenuBrowserOpen((open) => {
      const nextOpen = !open;
      setMenuBrowserGroupId(null);
      return nextOpen;
    });
  };

  const activeMenuGroup = useMemo(() => {
    const id = String(menuBrowserGroupId || '').trim();
    if (!id) return null;
    return menuGroups.find((g) => String(g?.id || '').trim() === id) || null;
  }, [menuBrowserGroupId, menuGroups]);

  const switchToSourcesNow = async ({
    mp4: nextMp4,
    hls: nextHls,
    preferHls: nextPreferHls = true,
    withSound = false,
  } = {}) => {
    const v = videoRef.current;
    if (!v) return;
    const mp4Url = String(nextMp4 || '').trim();
    const hlsUrl = String(nextHls || '').trim();
    const prefer = Boolean(nextPreferHls);
    const wantUseHls = Boolean((prefer && hlsUrl) || (!mp4Url && hlsUrl));
    const url = (wantUseHls ? (hlsUrl || mp4Url) : (mp4Url || hlsUrl)) || '';
    if (!url) return;

    try {
      setUseHls(wantUseHls);
    } catch {}
    try {
      forcedUseHlsRef.current = wantUseHls;
    } catch {}
    try {
      attachSrcRef.current?.(url, wantUseHls);
    } catch {}

    try {
      if (withSound) {
        v.muted = false;
        if (typeof v.volume === 'number' && v.volume === 0) v.volume = 1;
      } else {
        v.muted = true;
      }
    } catch {}

    try {
      await v.play();
      setAutoplayBlocked(false);
      setNeedsUnmute(Boolean(v.muted || v.volume === 0));
    } catch (e) {
      try {
        v.muted = true;
        await v.play();
        setAutoplayBlocked(false);
        setNeedsUnmute(true);
      } catch {}
    }
  };

  const selectMenuItem = (item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    try {
      if (item?.mp4 || item?.hls) {
        // Keep audio on channel switches by swapping streams within the user gesture.
        switchToSourcesNow({
          mp4: item.mp4 || '',
          hls: item.hls || '',
          preferHls: item.preferHls !== false,
          withSound: true,
        });
      }
      menuNavigation?.onSelectItem?.(item);
    } catch {}
    setMenuBrowserOpen(false);
    setMenuBrowserGroupId(null);
    setMenuNextPreviewOpen(false);
  };

  const reportOptions = [
    {
      key: 'buffering',
      title: 'Buffering & Loading',
      info: 'The video is blurry, buffering or not loading.',
    },
    {
      key: 'subs',
      title: 'Subtitles & Captions',
      info: 'The subtitles or captions dont seem to be working correctly.',
    },
    {
      key: 'av',
      title: 'Audio & Video',
      info: 'Its hard to hear or view the video.',
    },
    {
      key: 'other',
      title: 'Another Issue',
      info: "There's something else thats wrong with the show or movie.",
    },
  ];
  const nextEpisodeLabel = nextSeriesEpisode
    ? `S${nextSeriesEpisode.seasonNumber} • E${nextSeriesEpisode.episodeNumber}`
    : '';
  const nextEpisodeHint =
    nextSeriesEpisode?.nextSeasonStart
      ? `Next season episode 1`
      : nextSeriesEpisode
        ? 'Next episode'
        : '';

  const sendReport = async () => {
    if (!reportChoice) return;
    try {
      const username = session?.user?.username || '';
      const choiceTitle =
        (reportOptions || []).find((o) => o.key === reportChoice)?.title || reportChoice;
      const r = await fetch('/api/public/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username,
          choice: reportChoice,
          choiceTitle,
          message: reportMsg,
          meta: {
            id: meta?.id || null,
            type: meta?.type || null,
            title: meta?.title || null,
            href: meta?.href || null,
          },
          position: time.position,
          duration: time.duration,
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to send report');
      push('Report sent. Thanks for letting us know.', 'success');
      setReportOpen(false);
      setReportMsg('');
      setReportChoice('');
    } catch (e) {
      push(e?.message || 'Failed to send report.', 'error');
    }
  };

  if (isBackgroundChrome) {
    return (
      <div
        ref={wrapRef}
        className={mode === 'immersive' ? 'fixed inset-0 z-[60] bg-black' : fill ? 'h-full w-full' : 'w-full'}
      >
        <div
          className={
            mode === 'immersive'
              ? 'relative h-full w-full bg-black'
              : fill
                ? 'relative h-full w-full overflow-hidden bg-black'
                : 'relative aspect-video overflow-hidden rounded-xl border border-neutral-800 bg-black'
          }
        >
          <video
            ref={videoRef}
            playsInline
            className="h-full w-full object-cover"
            controls={false}
            preload="auto"
          >
            {subtitleTracks.map((t, i) => (
              <track
                key={i}
                kind="subtitles"
                src={t.url}
                label={t.label || t.lang || `Sub ${i + 1}`}
                srcLang={t.srclang || undefined}
              />
            ))}
          </video>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className={mode === 'immersive' ? 'fixed inset-0 z-[60] bg-black' : fill ? 'h-full w-full' : 'w-full'}
      onClick={() => setShowControls(true)}
    >
      <div
        className={
          mode === 'immersive'
            ? 'relative h-full w-full bg-black'
            : fill
              ? 'relative h-full w-full overflow-hidden bg-black'
              : 'relative aspect-video overflow-hidden rounded-xl border border-neutral-800 bg-black'
        }
      >
        <button
          className={
            'absolute left-4 top-4 z-[140] inline-flex items-center justify-center rounded-xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md transition-opacity hover:bg-black/55 ' +
            (backVisible ? 'opacity-100' : 'pointer-events-none opacity-0')
          }
          onClick={(e) => {
            e.stopPropagation();
            goBack();
          }}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft size={22} />
        </button>

        <video
          ref={videoRef}
          playsInline
          className={`h-full w-full ${meta?.type === 'live' ? 'object-cover' : 'object-contain'}`}
          controls={false}
          preload="auto"
        >
          {subtitleTracks.map((t, i) => (
            <track
              key={i}
              kind="subtitles"
              src={t.url}
              label={t.label || t.lang || `Sub ${i+1}`}
              srcLang={t.srclang || undefined}
            />
          ))}
        </video>

        <Toasts />

        {/* subtle gradient for legibility */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-black/30" />

        {/* Autoplay blocked: require a gesture to start with sound */}
        {autoplayBlocked ? (
          <div className="absolute inset-0 z-30 grid place-items-center">
            <button
              className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-black/60 px-6 py-4 text-sm font-semibold text-white shadow-2xl backdrop-blur-md hover:bg-black/70"
              onClick={unmuteNow}
              title="Play with sound"
            >
              <Play size={22} />
              Play
            </button>
          </div>
        ) : null}

        {/* Muted hint (common due to autoplay policies) */}
        {needsUnmute && !paused && !autoplayBlocked ? (
          <button
            className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md hover:bg-black/65"
            onClick={unmuteNow}
            title="Tap to unmute"
          >
            Tap to unmute
          </button>
        ) : null}

        {/* PAUSED info overlay (when idle) */}
        {infoVisible ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-5 sm:p-6">
            <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-md">
              <div className="text-xs font-semibold tracking-wide text-neutral-200">
                YOU&apos;RE WATCHING
              </div>
              <div className="mt-1 text-2xl font-extrabold text-white sm:text-3xl">{title}</div>
              {subTitle ? <div className="mt-1 text-sm text-neutral-200">{subTitle}</div> : null}
              {desc ? <div className="mt-3 line-clamp-3 text-sm text-neutral-200">{desc}</div> : null}
              <div className="mt-4 flex items-center justify-between text-xs text-neutral-200">
                <div>
                  {formatTime(time.position)}
                  {time.duration ? ` / ${formatTime(time.duration)}` : ''}
                </div>
                <div className="rounded-full bg-white/15 px-3 py-1 font-semibold text-white">PAUSED</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Controls overlay */}
        <div
          className={
            'absolute inset-0 z-20 transition-opacity ' +
            (showControls ? 'opacity-100' : 'opacity-0 pointer-events-none')
          }
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top right: report */}
          <button
            className="absolute right-4 top-4 inline-flex items-center justify-center rounded-xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
            onClick={() => setReportOpen(true)}
            aria-label="Report an issue"
            title="Report"
          >
            <Flag size={20} />
          </button>

          {/* Timeline (VOD only) */}
          {canSeek ? (
            <div className="absolute bottom-20 left-4 right-4">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-md">
                <div className="w-14 text-right text-xs text-neutral-200 tabular-nums">
                  {formatTime(scrub.active ? scrub.value : time.position)}
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Number(time.duration || 1))}
                  step={0.25}
                  value={Math.min(
                    Math.max(0, scrub.active ? scrub.value : time.position),
                    Number(time.duration || 1)
                  )}
                  onMouseDown={() => setScrub((s) => ({ ...s, active: true }))}
                  onTouchStart={() => setScrub((s) => ({ ...s, active: true }))}
                  onChange={(e) =>
                    setScrub((s) => ({ ...s, active: true, value: Number(e.target.value) }))
                  }
                  onMouseUp={() =>
                    setScrub((s) => {
                      seekTo(s.value);
                      return { ...s, active: false };
                    })
                  }
                  onTouchCancel={() => setScrub((s) => ({ ...s, active: false }))}
                  onTouchEnd={() =>
                    setScrub((s) => {
                      seekTo(s.value);
                      return { ...s, active: false };
                    })
                  }
                  className="h-2 w-full cursor-pointer accent-[var(--brand)]"
                  aria-label="Timeline"
                />
                <div className="w-14 text-xs text-neutral-200 tabular-nums">{formatTime(time.duration)}</div>
              </div>
            </div>
          ) : null}

          {/* Bottom left: transport */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <button
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/90 p-4 text-black hover:bg-white"
              onClick={togglePlay}
              aria-label={paused ? 'Play' : 'Pause'}
              title={paused ? 'Play' : 'Pause'}
            >
              {paused ? <Play size={24} /> : <Pause size={24} />}
            </button>
            <button
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
              onClick={() => seekBy(-10)}
              aria-label="Rewind 10 seconds"
              title="Rewind 10s"
            >
              <RotateCcw size={22} />
            </button>
            <button
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
              onClick={() => seekBy(10)}
              aria-label="Forward 10 seconds"
              title="Forward 10s"
            >
              <RotateCw size={22} />
            </button>

            <div className="relative">
              <button
                className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
                onClick={onSpeakerClick}
                aria-label={muted || vol === 0 ? 'Unmute' : 'Volume'}
                title={muted || vol === 0 ? 'Unmute' : 'Volume'}
              >
                {muted || vol === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
              </button>

              {volOpen ? (
                <div className="absolute bottom-14 left-0 w-56 overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-3 text-sm text-white shadow-2xl backdrop-blur-md">
                  <div className="mb-2 text-xs font-semibold text-neutral-200">Volume</div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={muted ? 0 : vol}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="h-2 w-full cursor-pointer accent-[var(--brand)]"
                    aria-label="Volume slider"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-200 tabular-nums">
                    <span>{muted ? 'Muted' : `${Math.round((vol || 0) * 100)}%`}</span>
                    <button
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 hover:bg-white/10"
                      onClick={() => {
                        const v = videoRef.current;
                        if (!v) return;
                        try {
                          v.muted = !v.muted;
                          if (!v.muted && v.volume === 0) v.volume = 1;
                        } catch {}
                      }}
                    >
                      {muted ? 'Unmute' : 'Mute'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Bottom right: subtitles + fullscreen */}
          <div className="absolute bottom-4 right-4 flex items-center gap-3">
            {renderMenuNav ? (
              <div className="relative">
                <button
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
                  onClick={toggleMenuBrowser}
                  aria-label={`Browse ${menuGroupLabel}`}
                  title={`Browse ${menuGroupLabel}`}
                >
                  <List size={22} />
                </button>

                {menuBrowserOpen ? (
                  <div className="absolute bottom-14 right-0 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-black/75 text-white shadow-2xl backdrop-blur-md">
                    {activeMenuGroup ? (
                      <>
                        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-3">
                          <button
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-100 hover:bg-white/10"
                            onClick={() => setMenuBrowserGroupId(null)}
                          >
                            <ArrowLeft size={14} />
                            {menuGroupLabel}
                          </button>
                          <div className="text-right">
                            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-300">
                              {String(activeMenuGroup?.title || '').trim() || menuItemLabel}
                            </div>
                            <div className="text-[11px] text-neutral-400">
                              {(Array.isArray(activeMenuGroup?.items) ? activeMenuGroup.items : []).length} {menuItemLabel.toLowerCase()}
                            </div>
                          </div>
                        </div>

                        <div className="max-h-[60vh] space-y-2 overflow-auto p-3">
                          {(Array.isArray(activeMenuGroup?.items) ? activeMenuGroup.items : []).map((item) => {
                            const isCurrent = String(item?.id || '').trim() === currentMenuItemId;
                            return (
                              <button
                                key={String(item?.id || '')}
                                className={
                                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ' +
                                  (isCurrent
                                    ? 'border-[var(--brand)] bg-white/10'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10')
                                }
                                onClick={() => selectMenuItem(item)}
                                title={String(item?.title || item?.name || '').trim() || 'Channel'}
                              >
                                <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                                  {item?.image ? (
                                    <img src={item.image} alt={item?.title || ''} className="h-full w-full object-cover" />
                                  ) : null}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                                    {menuItemLabel.slice(0, -1) || menuItemLabel}
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                                    {String(item?.title || item?.name || 'Channel').trim()}
                                  </div>
                                </div>
                                {isCurrent ? (
                                  <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-200">
                                    Now
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="border-b border-white/10 px-4 py-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-300">
                            {menuGroupLabel}
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-400">
                            Choose a category, then pick a channel.
                          </div>
                        </div>
                        <div className="max-h-[60vh] space-y-2 overflow-auto p-3">
                          {menuGroups.map((group) => {
                            const id = String(group?.id || '').trim();
                            const title = String(group?.title || group?.name || '').trim() || menuGroupLabel;
                            const count = (Array.isArray(group?.items) ? group.items : []).length;
                            return (
                              <button
                                key={id || title}
                                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:bg-white/10"
                                onClick={() => setMenuBrowserGroupId(id)}
                              >
                                <div>
                                  <div className="text-sm font-semibold text-white">{title}</div>
                                  <div className="mt-1 text-[11px] text-neutral-400">
                                    {count} {menuItemLabel.toLowerCase()}
                                  </div>
                                </div>
                                <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-200">
                                  Open
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {renderMenuNav && nextMenuItem?.id ? (
              <div className="relative">
                <button
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
                  onClick={() => selectMenuItem(nextMenuItem)}
                  onMouseEnter={() => setMenuNextPreviewOpen(true)}
                  onMouseLeave={() => setMenuNextPreviewOpen(false)}
                  onFocus={() => setMenuNextPreviewOpen(true)}
                  onBlur={() => setMenuNextPreviewOpen(false)}
                  aria-label={`Next ${menuItemLabel.slice(0, -1) || menuItemLabel}`}
                  title={`Next ${menuItemLabel.slice(0, -1) || menuItemLabel}`}
                >
                  <SkipForward size={22} />
                </button>

                {menuNextPreviewOpen ? (
                  <div className="pointer-events-none absolute bottom-14 right-0 w-72 overflow-hidden rounded-2xl border border-white/10 bg-black/75 text-white shadow-2xl backdrop-blur-md">
                    <div className="flex gap-3 p-3">
                      <div className="h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                        {nextMenuItem?.image ? (
                          <img
                            src={nextMenuItem.image}
                            alt={nextMenuItem.title || ''}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-300">
                          Up next
                        </div>
                        {nextMenuItem?.groupTitle ? (
                          <div className="mt-1 text-xs text-neutral-300">{nextMenuItem.groupTitle}</div>
                        ) : null}
                        <div className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                          {String(nextMenuItem?.title || 'Channel').trim()}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {canNavigateSeriesEpisodes ? (
              <div className="relative">
                <button
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
                  onClick={toggleEpisodeBrowser}
                  aria-label="View all episodes"
                  title="View all episodes"
                >
                  <List size={22} />
                </button>

                {episodeBrowserOpen ? (
                  <div className="absolute bottom-14 right-0 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-black/75 text-white shadow-2xl backdrop-blur-md">
                    {activeEpisodeBrowserSeason ? (
                      <>
                        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-3">
                          <button
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-neutral-100 hover:bg-white/10"
                            onClick={() => setEpisodeBrowserSeason(null)}
                          >
                            <ArrowLeft size={14} />
                            Seasons
                          </button>
                          <div className="text-right">
                            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-300">
                              Season {activeEpisodeBrowserSeason.seasonNumber}
                            </div>
                            <div className="text-[11px] text-neutral-400">
                              {activeEpisodeBrowserSeason.episodes.length} episode{activeEpisodeBrowserSeason.episodes.length === 1 ? '' : 's'}
                            </div>
                          </div>
                        </div>
                        <div className="max-h-[60vh] space-y-2 overflow-auto p-3">
                          {activeEpisodeBrowserSeason.episodes.map((episode) => {
                            const isCurrent = String(episode.id) === currentSeriesEpisodeId;
                            return (
                              <button
                                key={episode.id}
                                className={
                                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ' +
                                  (isCurrent
                                    ? 'border-[var(--brand)] bg-white/10'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10')
                                }
                                onClick={() => goToSeriesEpisode(episode)}
                                title={`S${episode.seasonNumber}E${episode.episodeNumber} — ${episode.title}`}
                              >
                                <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                                  {episode.image ? (
                                    <img src={episode.image} alt={episode.title || ''} className="h-full w-full object-cover" />
                                  ) : null}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                                    Episode {episode.episodeNumber}
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                                    {episode.title || `Episode ${episode.episodeNumber}`}
                                  </div>
                                </div>
                                {isCurrent ? (
                                  <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-200">
                                    Now
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="border-b border-white/10 px-4 py-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-300">
                            Seasons
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-400">
                            Choose another season, then jump to any episode.
                          </div>
                        </div>
                        <div className="max-h-[60vh] space-y-2 overflow-auto p-3">
                          {seriesSeasons.map((season) => {
                            const isCurrent = Number(season.seasonNumber) === Number(currentSeriesSeasonNumber || 0);
                            return (
                              <button
                                key={season.seasonNumber}
                                className={
                                  'flex w-full items-center justify-between rounded-xl border p-3 text-left transition ' +
                                  (isCurrent
                                    ? 'border-[var(--brand)] bg-white/10'
                                    : 'border-white/10 bg-white/5 hover:bg-white/10')
                                }
                                onClick={() => setEpisodeBrowserSeason(season.seasonNumber)}
                              >
                                <div>
                                  <div className="text-sm font-semibold text-white">Season {season.seasonNumber}</div>
                                  <div className="mt-1 text-[11px] text-neutral-400">
                                    {season.episodes.length} episode{season.episodes.length === 1 ? '' : 's'}
                                    {isCurrent ? ' • Current season' : ''}
                                  </div>
                                </div>
                                <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-200">
                                  Open
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {nextSeriesEpisode?.id && canNavigateSeriesEpisodes ? (
              <div className="relative">
                <button
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
                  onClick={() => goToSeriesEpisode(nextSeriesEpisode)}
                  onMouseEnter={() => setNextPreviewOpen(true)}
                  onMouseLeave={() => setNextPreviewOpen(false)}
                  onFocus={() => setNextPreviewOpen(true)}
                  onBlur={() => setNextPreviewOpen(false)}
                  aria-label="Play next episode"
                  title="Next episode"
                >
                  <SkipForward size={22} />
                </button>

                {nextPreviewOpen ? (
                  <div className="pointer-events-none absolute bottom-14 right-0 w-72 overflow-hidden rounded-2xl border border-white/10 bg-black/75 text-white shadow-2xl backdrop-blur-md">
                    <div className="flex gap-3 p-3">
                      <div className="h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                        {nextSeriesEpisode.image ? (
                          <img
                            src={nextSeriesEpisode.image}
                            alt={nextSeriesEpisode.title || ''}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-300">
                          {nextSeriesEpisode.nextSeasonStart ? 'Next season' : 'Up next'}
                        </div>
                        <div className="mt-1 text-xs text-neutral-300">{nextEpisodeLabel}</div>
                        <div className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                          {nextSeriesEpisode.title || `Episode ${nextSeriesEpisode.episodeNumber}`}
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-400">{nextEpisodeHint}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {meta?.type !== 'live' ? (
              <div className="relative">
                <button
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
                  onClick={() => setSubsOpen((v) => !v)}
                  aria-label="Subtitles"
                  title="Subtitles"
                >
                  <Captions size={22} />
                </button>

                {subsOpen ? (
                  <div className="absolute bottom-14 right-0 w-64 overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-2 text-sm text-white shadow-2xl backdrop-blur-md">
                    <div className="px-2 pb-2 pt-1 text-xs font-semibold text-neutral-200">Subtitles</div>
                    <button
                      className="flex w-full items-center justify-between rounded-lg px-2 py-2 hover:bg-white/10"
                      onClick={() => {
                        const v = videoRef.current;
                        if (!v) return;
                        try {
                          for (const t of Array.from(v.textTracks || [])) t.mode = 'disabled';
                        } catch {}
                        setSubsOpen(false);
                        push('Subtitles off');
                      }}
                    >
                      Off
                    </button>
                    {subtitleTracks.map((t, idx) => (
                      <button
                        key={`${t.url}-${idx}`}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-2 hover:bg-white/10"
                        onClick={() => {
                          const v = videoRef.current;
                          if (!v) return;
                          try {
                            const tracks = Array.from(v.textTracks || []);
                            tracks.forEach((x, i) => {
                              x.mode = i === idx ? 'showing' : 'disabled';
                            });
                          } catch {}
                          setSubsOpen(false);
                          push(`Subtitles: ${t.label || t.lang || 'On'}`);
                        }}
                      >
                        <span className="truncate">{t.label || t.lang || `Subtitle ${idx + 1}`}</span>
                      </button>
                    ))}
                    {!subtitleTracks.length ? (
                      <div className="px-2 py-2 text-xs text-neutral-200">No subtitles available.</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/45 p-4 text-white backdrop-blur-md hover:bg-black/55"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={22} /> : <Maximize2 size={22} />}
            </button>
          </div>
        </div>
      </div>

      {/* error banner */}
      {err ? (
        <div
          className={
            mode === 'immersive'
              ? 'pointer-events-none absolute left-4 right-4 top-4 z-[120] rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-200 backdrop-blur'
              : 'mt-3 text-sm text-red-400'
          }
        >
          {err}
        </div>
      ) : null}

      {/* report modal */}
      {reportOpen ? (
        <div className="fixed inset-0 z-[110]">
          <button
            aria-label="Close report modal"
            className="absolute inset-0 bg-black/70"
            onClick={() => setReportOpen(false)}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-neutral-950 p-5 text-neutral-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Report an issue</div>
                <div className="mt-1 text-sm text-neutral-400">Tell us what’s wrong with this video.</div>
              </div>
              <button
                className="rounded-lg p-2 text-neutral-300 hover:bg-white/10"
                onClick={() => setReportOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {reportOptions.map((o) => {
                const active = reportChoice === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => setReportChoice(o.key)}
                    className={
                      'w-full rounded-xl border p-4 text-left transition ' +
                      (active ? 'border-[var(--brand)] bg-white/5' : 'border-white/10 hover:bg-white/5')
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{o.title}</div>
                        <div className="mt-1 text-sm text-neutral-300">{o.info}</div>
                      </div>
                      {active ? (
                        <div className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand)] text-white">
                          <Check size={16} />
                        </div>
                      ) : (
                        <div className="mt-0.5 h-7 w-7 rounded-full border border-white/20" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm text-neutral-300">Message (optional)</label>
              <textarea
                value={reportMsg}
                onChange={(e) => setReportMsg(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                placeholder="Add more details…"
              />
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                onClick={() => setReportOpen(false)}
              >
                Cancel
              </button>
              <button
                disabled={!reportChoice}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--brand)' }}
                onClick={sendReport}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function nextServer(currentOrigin, servers) {
  if (!servers?.length) return null;
  const idx = servers.findIndex(s => s.origin === currentOrigin);
  const next = servers[(idx + 1) % servers.length];
  return next?.origin || null;
}
function labelFor(origin, servers) {
  return servers.find(s => s.origin === origin)?.label || 'Server';
}

function formatTime(sec) {
  const s = Math.max(0, Number(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const mm = String(m).padStart(2, '0');
  const sss = String(ss).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${sss}` : `${m}:${sss.padStart(2, '0')}`;
}
