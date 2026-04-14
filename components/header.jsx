// components/Header.jsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from './SessionProvider';
import { usePublicSettings } from './PublicSettingsProvider';
import { useUserPreferences } from './UserPreferencesProvider';
import { useProfileMode } from './useProfileMode';
import {
  prefetchLeavingSoonCatalog,
  prefetchMovieCatalog,
  prefetchUpcomingCatalog,
  prefetchSeriesCatalog,
  readLeavingSoonCatalog,
  readUpcomingCatalog,
  readSeriesCatalog,
} from '../lib/publicCatalogCache';
import {
  isKidsCategoryName,
  isKidsLiveCategoryName,
} from '../lib/kidsMode';

// icons
import {
  Search,
  User,
  Menu,
  X,
  SquarePlus,
  LogOut,
  Check,
} from 'lucide-react';
import NotificationsBell from './NotificationsBell';

const BRAND = 'var(--brand)';
const HEADER_H = 64;
const HERO_HEADER_SCROLL_RATIO = 0.45;
const HERO_HEADER_SCROLL_MIN = 180;
const PRIMARY_PUBLIC_ROUTES = ['/', '/movies', '/series', '/live', '/bookmarks'];
const PRIMARY_SECTION_ROUTES = new Set(PRIMARY_PUBLIC_ROUTES);

// ---------- helpers ----------
function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function normalizeRouteHref(href = '') {
  return String(href || '').split('#')[0].trim();
}

function prefetchRoute(router, href = '') {
  const normalizedHref = normalizeRouteHref(href);
  if (!normalizedHref || normalizedHref === '#') return;
  try {
    router.prefetch?.(normalizedHref);
  } catch {}
}

function isPlainLeftNavClick(event) {
  return !event.defaultPrevented && event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

function announceRouteStart(href = '') {
  const normalizedHref = normalizeRouteHref(href);
  if (!normalizedHref || normalizedHref === '#') return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('3jtv:route-start', { detail: { href: normalizedHref } }));
}

function shouldUseHardSectionNavigation(currentPath = '/', href = '') {
  const normalizedHref = normalizeRouteHref(href);
  if (!PRIMARY_SECTION_ROUTES.has(normalizedHref)) return false;
  const normalizedCurrent = normalizeRouteHref(currentPath || '/');
  if (normalizedCurrent === normalizedHref) return false;
  return PRIMARY_SECTION_ROUTES.has(normalizedCurrent);
}

function requestCtaForPath(pathname = '/') {
  const p = String(pathname || '/').toLowerCase();
  if (p.startsWith('/movies')) {
    return { href: '/request?type=movie', label: 'Request Movie' };
  }
  if (p.startsWith('/series')) {
    return { href: '/request?type=tv', label: 'Request Series' };
  }
  if (p === '/') {
    return { href: '/request?type=all', label: 'Request' };
  }
  return { href: '/request?type=all', label: 'Request' };
}

function NavLink({ href, children, onWarm }) {
  const router = useRouter();
  const path = usePathname() || '/';
  const active = path === href || (href !== '/' && path.startsWith(href));
  const warmRoute = () => {
    if (active) return;
    prefetchRoute(router, href);
    onWarm?.();
  };
  return (
    <Link
      href={href}
      prefetch
      onMouseEnter={warmRoute}
      onFocus={warmRoute}
      onTouchStart={warmRoute}
      onClick={(event) => {
        if (active || !isPlainLeftNavClick(event)) return;
        announceRouteStart(href);
        if (shouldUseHardSectionNavigation(path, href) && typeof window !== 'undefined') {
          event.preventDefault();
          window.location.assign(href);
        }
      }}
      className={cx(
        'relative rounded-md px-3 py-2 no-underline font-bold cursor-pointer',
        'text-[14px] md:text-[16px]',
        active
          ? 'text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
          : 'text-neutral-300 hover:text-white hover:bg-white/10'
      )}
      style={active ? { background: BRAND } : undefined}
    >
      {children}
    </Link>
  );
}

// ---------- Search Modal ----------
function SearchModal({ open, onClose }) {
  const router = useRouter();
  const { session } = useSession();
  const { mode: profileMode } = useProfileMode();
  const [q, setQ] = useState('');
  const [categories, setCategories] = useState([]);
  const [liveCategories, setLiveCategories] = useState([]);
  const [showAllGenres, setShowAllGenres] = useState(false);

  useEffect(() => {
    if (!open) return;

    const load = async () => {
      try {
        const qs = `?streamBase=${encodeURIComponent(session?.streamBase || '')}`;
        const [m, s, live] = await Promise.all([
          fetch(`/api/xuione/vod/categories${qs}`).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/xuione/series/categories${qs}`).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/xuione/live`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        ]);
        const merged = [...(m?.categories || []), ...(s?.categories || [])]
          .map((category) => ({
            id: String(category?.id || '').trim(),
            name: String(category?.name || '').trim(),
          }))
          .filter((category) => category.name);

        const deduped = [];
        const seen = new Set();
        for (const category of merged) {
          const key = category.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(category);
        }
        deduped.sort((a, b) => a.name.localeCompare(b.name));
        const isKids = profileMode === 'kids';
        setCategories(isKids ? deduped.filter((c) => isKidsCategoryName(c?.name)) : deduped);
        setLiveCategories(
          isKids
            ? (Array.isArray(live?.categories) ? live.categories : []).filter((c) => isKidsLiveCategoryName(c?.name))
            : Array.isArray(live?.categories)
              ? live.categories
              : []
        );
      } catch {
        setCategories([]);
        setLiveCategories([]);
      }
    };
    load();
  }, [open, session?.streamBase, profileMode]);

  const goSearch = (e) => {
    e?.preventDefault?.();
    if (!q.trim()) return;
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    onClose();
  };

  const goCategorySearch = (name) => {
    if (!String(name || '').trim()) return;
    router.push(`/search?genre=${encodeURIComponent(String(name).trim())}`);
    onClose();
  };

  const goLiveCategorySearch = (id) => {
    const cid = String(id || '').trim();
    if (!cid) return;
    router.push(`/search?liveCat=${encodeURIComponent(cid)}`);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      {/* overlay */}
      <button
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      {/* dialog */}
      <div className="absolute left-1/2 top-1/2 w-[min(780px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Search</h3>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-neutral-300 hover:bg-white/10"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={goSearch} className="mt-3">
          <div className="flex overflow-hidden rounded-lg border border-neutral-800">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search movies, series, live TV…"
              className="w-full bg-neutral-900 px-3 py-3 outline-none"
            />
            <button
              className="flex items-center gap-2 bg-[var(--brand)] px-4 font-medium text-white"
              style={{ ['--brand']: BRAND }}
            >
              <Search size={18} /> Search
            </button>
          </div>
        </form>

        {/* Categories */}
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <Search size={16} className="text-neutral-300" />
            <h4 className="text-sm font-semibold">Movie Genres</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {(showAllGenres ? categories : categories.slice(0, 5)).map((category) => (
              <button
                key={`cat-${category.name.toLowerCase()}`}
                onClick={() => goCategorySearch(category.name)}
                className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500"
                title={`Search ${category.name}`}
              >
                {category.name}
              </button>
            ))}
            {categories.length > 5 ? (
              <button
                type="button"
                onClick={() => setShowAllGenres((prev) => !prev)}
                className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500"
              >
                {showAllGenres ? 'Less' : 'More'}
              </button>
            ) : null}
          </div>
        </div>

        {liveCategories.length ? (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2">
              <Search size={16} className="text-neutral-300" />
              <h4 className="text-sm font-semibold">Live TV Categories</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {liveCategories.map((category) => {
                const id = String(category?.id || '').trim();
                const name = String(category?.name || '').trim();
                if (!id || !name) return null;
                return (
                  <button
                    key={`livecat-${id}`}
                    onClick={() => goLiveCategorySearch(id)}
                    className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500"
                    title={`Browse ${name}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Profile Popover ----------
function ProfileMenu({ open, onClose }) {
  const { logout } = useSession();
  const { movieCardClickAction, setMovieCardClickAction } = useUserPreferences();
  const router = useRouter();
  const { mode, setMode } = useProfileMode(); // 'adult' or 'kids'
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (!open) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="absolute right-0 top-full z-[65] mt-2 w-64">
      <div
        ref={ref}
        className="relative rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Profile</div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-300 hover:bg-white/10"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <button
          onClick={() => {
            setMode('adult');
          }}
          className={cx(
            'flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-white/10',
            mode === 'adult' ? 'text-white' : 'text-neutral-300'
          )}
        >
          Adult {mode === 'adult' ? <Check size={16} /> : null}
        </button>

        <button
          onClick={() => {
            setMode('kids');
          }}
          className={cx(
            'flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-white/10',
            mode === 'kids' ? 'text-white' : 'text-neutral-300'
          )}
        >
          Kids {mode === 'kids' ? <Check size={16} /> : null}
        </button>

        <div className="my-2 border-t border-neutral-800" />

        <div className="px-1">
          <div className="mb-1 text-xs font-semibold text-neutral-300">Movie card click</div>
          <button
            onClick={() => setMovieCardClickAction('play')}
            className={cx(
              'flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-white/10',
              movieCardClickAction === 'play' ? 'text-white' : 'text-neutral-300'
            )}
          >
            Play immediately {movieCardClickAction === 'play' ? <Check size={16} /> : null}
          </button>
          <button
            onClick={() => setMovieCardClickAction('preview')}
            className={cx(
              'flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-white/10',
              movieCardClickAction === 'preview' ? 'text-white' : 'text-neutral-300'
            )}
          >
            Preview trailer {movieCardClickAction === 'preview' ? <Check size={16} /> : null}
          </button>
        </div>

        <div className="my-2 border-t border-neutral-800" />

        <button
          onClick={async () => {
            try {
              await logout?.();
            } finally {
              router.replace('/login');
            }
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-red-300 hover:bg-red-500/10"
        >
          <LogOut size={16} /> Logout
        </button>
      </div>
    </div>
  );
}

// ---------- Mobile Drawer ----------
function MobileMenu({ open, onClose, onOpenSearch, requestCta, requestEnabled, showSeriesNav }) {
  const pathname = usePathname() || '/';
  const router = useRouter();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75]">
      <button
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="absolute right-0 top-0 h-full w-[82vw] max-w-[420px] rounded-l-2xl border-l border-neutral-800 bg-neutral-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-lg font-semibold">Menu</div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-neutral-300 hover:bg-white/10"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {[
            ['/', 'Home'],
            ['/movies', 'Movies'],
            ...(showSeriesNav ? [['/series', 'Series']] : []),
            ['/live', 'Live TV'],
            ['/bookmarks', 'My watchlist'],
          ].map(([href, label]) => (
            (() => {
              const active = pathname === href || (href !== '/' && pathname.startsWith(href));
              const warmRoute = () => {
                if (active) return;
                prefetchRoute(router, href);
              };
              return (
            <Link
              key={href}
              href={href}
              prefetch
              onMouseEnter={warmRoute}
              onFocus={warmRoute}
              onTouchStart={warmRoute}
              onClick={(event) => {
                if (!active && isPlainLeftNavClick(event)) announceRouteStart(href);
                if (!active && isPlainLeftNavClick(event) && shouldUseHardSectionNavigation(pathname, href) && typeof window !== 'undefined') {
                  event.preventDefault();
                  onClose();
                  window.location.assign(href);
                  return;
                }
                onClose();
              }}
              className={cx(
                'rounded-lg px-3 py-3 no-underline',
                active
                  ? 'text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
                  : 'text-neutral-300 hover:bg-white/10 hover:text-white'
              )}
              style={active ? { background: BRAND } : undefined}
            >
              {label}
            </Link>
              );
            })()
          ))}
        </nav>

        <div className="mt-6 border-t border-neutral-800 pt-4">
          <div className={`grid gap-3 ${requestEnabled ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {requestEnabled ? (
              <Link
                href={requestCta?.href || '/request?type=all'}
                prefetch
                onClick={onClose}
                className="flex flex-col items-center gap-1 rounded-lg bg-white/5 p-3 hover:bg-white/10"
                title={requestCta?.label || 'Request'}
              >
                <SquarePlus /> <span className="text-xs text-center">{requestCta?.label || 'Request'}</span>
              </Link>
            ) : null}

            <button
              onClick={() => {
                onClose();
                onOpenSearch();
              }}
              className="flex flex-col items-center gap-1 rounded-lg bg-white/5 p-3 hover:bg-white/10"
              title="Search"
            >
              <Search /> <span className="text-xs">Search</span>
            </button>

            <Link
              href="#profile"
              onClick={(e) => e.preventDefault()}
              className="flex flex-col items-center gap-1 rounded-lg bg-white/5 p-3 opacity-70"
              title="Use profile button on header"
            >
              <User /> <span className="text-xs">Profile</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Header ----------
export default function Header() {
  const router = useRouter();
  const { session } = useSession();
  const { ready, settings } = usePublicSettings();
  const { mode: profileMode } = useProfileMode();
  const pathname = usePathname() || '/';
  const username = String(session?.user?.username || '').trim();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [kidsHasSeries, setKidsHasSeries] = useState(true);

  const logoUrl = settings?.brand?.logoUrl || '/brand/logo.svg';
  const requestCta = requestCtaForPath(pathname);
  const requestEnabled = ready ? settings?.requests?.enabled !== false : false;
  const heroBackdropEnabled =
    pathname === '/' || pathname.startsWith('/movies') || pathname.startsWith('/series') || pathname.startsWith('/live');
  const heroHeaderActive = heroBackdropEnabled && !scrolled;
  const warmMovieCatalog = useCallback(() => {
    if (!session?.streamBase) return;
    prefetchMovieCatalog(session.streamBase).catch(() => {});
  }, [session?.streamBase]);
  const warmSeriesCatalog = useCallback(() => {
    if (!session?.streamBase) return;
    prefetchSeriesCatalog(session.streamBase).catch(() => {});
  }, [session?.streamBase]);

  useEffect(() => {
    const onScroll = () => {
      const heroThreshold = heroBackdropEnabled
        ? Math.max(HERO_HEADER_SCROLL_MIN, Math.round(window.innerHeight * HERO_HEADER_SCROLL_RATIO))
        : 8;
      setScrolled(window.scrollY > heroThreshold);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [heroBackdropEnabled]);

  useEffect(() => {
    const targets = new Set(PRIMARY_PUBLIC_ROUTES);
    const requestHref = normalizeRouteHref(requestCta?.href || '');
    if (requestEnabled && requestHref) targets.add(requestHref);

    const warmAllRoutes = () => {
      for (const href of targets) {
        if (href === pathname) continue;
        prefetchRoute(router, href);
      }
    };

    let idleId = null;
    let timeoutId = null;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(warmAllRoutes, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(warmAllRoutes, 250);
    }

    return () => {
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [pathname, requestCta?.href, requestEnabled, router, session?.streamBase]);

  useEffect(() => {
    if (profileMode !== 'kids') {
      setKidsHasSeries(true);
      return;
    }
    if (!session?.streamBase) return;

    let alive = true;
    (async () => {
      try {
        const cached = readSeriesCatalog(session.streamBase, { resolveKids: true });
        const items = cached?.ok && Array.isArray(cached.items)
          ? cached.items
          : (await prefetchSeriesCatalog(session.streamBase, { resolveKids: true })).items || [];
        const cachedUpcoming = readUpcomingCatalog({ username, mediaType: 'series', limit: 120 });
        const cachedLeaving = readLeavingSoonCatalog({ mediaType: 'series', limit: 120 });
        const upcomingHasKidsTags =
          cachedUpcoming?.ok &&
          Array.isArray(cachedUpcoming.items) &&
          cachedUpcoming.items.every((item) => !String(item?.title || '').trim() || typeof item?.kidsSafe === 'boolean');
        const leavingHasKidsTags =
          cachedLeaving?.ok &&
          Array.isArray(cachedLeaving.items) &&
          cachedLeaving.items.every((item) => !String(item?.title || '').trim() || typeof item?.kidsSafe === 'boolean');
        const [upcomingRes, leavingRes] = await Promise.all([
          upcomingHasKidsTags ? cachedUpcoming : prefetchUpcomingCatalog({ username, mediaType: 'series', limit: 120 }),
          leavingHasKidsTags ? cachedLeaving : prefetchLeavingSoonCatalog({ mediaType: 'series', limit: 120 }),
        ]);
        const combined = [
          ...(Array.isArray(items) ? items : []),
          ...(Array.isArray(upcomingRes?.items) ? upcomingRes.items : []),
          ...(Array.isArray(leavingRes?.items) ? leavingRes.items : []),
        ];
        if (!alive) return;

        setKidsHasSeries(combined.some((item) => item?.kidsSafe === true));
      } catch {
        if (!alive) return;
        // Don't hide Series if we can't verify.
        setKidsHasSeries(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [profileMode, session?.streamBase, username]);

  const showSeriesNav = profileMode !== 'kids' || kidsHasSeries;

  useEffect(() => {
    if (!session?.streamBase) return;

    let idleId = null;
    let timeoutId = null;
    const warmCatalogs = () => {
      if (!pathname.startsWith('/movies')) warmMovieCatalog();
      if (!pathname.startsWith('/series')) warmSeriesCatalog();
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(warmCatalogs, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(warmCatalogs, 300);
    }

    return () => {
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [pathname, session?.streamBase, warmMovieCatalog, warmSeriesCatalog]);

  return (
    <>
      <header
        id="site-header"
        className={cx(
          'fixed inset-x-0 top-0 z-50 h-16 transition-[background-color,border-color,backdrop-filter]',
          heroHeaderActive
            ? 'border-b border-transparent bg-transparent'
            : 'border-b border-white/10 bg-neutral-950/55 supports-[backdrop-filter]:backdrop-blur-md'
        )}
        style={{ height: HEADER_H }}
      >
        {heroHeaderActive ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/85 via-black/45 to-transparent"
          />
        ) : null}

        <div className="relative z-10 mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          {/* Left: logo + nav */}
          <div className="flex items-center gap-8">
            <Link
              href="/"
              prefetch
              onMouseEnter={() => {
                prefetchRoute(router, '/');
                prefetchRoute(router, '/movies');
                warmMovieCatalog();
                warmSeriesCatalog();
              }}
              onFocus={() => {
                prefetchRoute(router, '/');
                prefetchRoute(router, '/movies');
                warmMovieCatalog();
                warmSeriesCatalog();
              }}
              onTouchStart={() => {
                prefetchRoute(router, '/');
                prefetchRoute(router, '/movies');
                warmMovieCatalog();
                warmSeriesCatalog();
              }}
              onClick={(event) => {
                if (pathname === '/' || !isPlainLeftNavClick(event)) return;
                announceRouteStart('/');
              }}
              className="flex items-center"
            >
              <img
                src={logoUrl}
                onError={(e) => (e.currentTarget.src = '/brand/logo.png')}
                alt="3J TV"
                className="h-12"
                draggable={false}
              />
            </Link>

            <nav className="hidden md:flex items-center gap-2">
              <NavLink href="/" onWarm={() => {
                warmMovieCatalog();
                warmSeriesCatalog();
              }}>Home</NavLink>
              <NavLink href="/movies" onWarm={warmMovieCatalog}>Movies</NavLink>
              {showSeriesNav ? <NavLink href="/series" onWarm={warmSeriesCatalog}>Series</NavLink> : null}
              <NavLink href="/live">Live TV</NavLink>
              <NavLink href="/bookmarks">My watchlist</NavLink>
            </nav>
          </div>

          {/* Right: actions */}
          <div className="relative flex items-center gap-1">
            {profileMode === 'kids' ? (
              <span
                className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-200"
                title="Kids mode is enabled"
              >
                <Check size={14} />
                KIDS Selected
              </span>
            ) : null}
            {/* Request (contextual) */}
            {requestEnabled ? (
              <Link
                href={requestCta.href}
                prefetch
                onMouseEnter={() => prefetchRoute(router, requestCta.href)}
                onFocus={() => prefetchRoute(router, requestCta.href)}
                onTouchStart={() => prefetchRoute(router, requestCta.href)}
                onClick={(event) => {
                  if (!isPlainLeftNavClick(event)) return;
                  announceRouteStart(requestCta.href);
                }}
                className={cx(
                  'hidden sm:inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-neutral-100 transition-colors',
                  heroHeaderActive
                    ? 'border border-white/15 bg-black/25 hover:border-white/30 hover:bg-black/35 supports-[backdrop-filter]:backdrop-blur-sm'
                    : 'border border-neutral-700 bg-neutral-900 hover:border-neutral-500 hover:bg-neutral-800'
                )}
                title={requestCta.label}
              >
                <SquarePlus size={15} />
                <span>{requestCta.label}</span>
              </Link>
            ) : null}

            {/* Search (opens modal) */}
            <button
              onClick={() => setSearchOpen(true)}
              className="inline-flex items-center rounded-md p-2 text-neutral-200 hover:bg-white/10"
              title="Search"
              aria-label="Open search"
            >
              <Search />
            </button>

            {/* Notifications */}
            <NotificationsBell />

            {/* Profile (popover) */}
            <div className="relative">
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className={cx(
                  'inline-flex items-center rounded-full p-2 text-neutral-200 transition-colors',
                  heroHeaderActive
                    ? 'border border-white/15 bg-black/25 hover:border-white/30 hover:bg-black/35 supports-[backdrop-filter]:backdrop-blur-sm'
                    : 'border border-neutral-700 bg-neutral-900 hover:border-neutral-500'
                )}
                aria-label="Profile"
                title="Profile"
              >
                <User />
              </button>
              <ProfileMenu open={profileOpen} onClose={() => setProfileOpen(false)} />
            </div>

            {/* Burger (mobile) */}
            <button
              onClick={() => setMobileOpen(true)}
              className="ml-1 inline-flex items-center rounded-md p-2 text-neutral-200 hover:bg-white/10 md:hidden"
              aria-label="Open menu"
              title="Menu"
            >
              <Menu />
            </button>
          </div>
        </div>
      </header>

      {/* Spacer for fixed header */}
      <div aria-hidden className="h-16" />

      {/* Overlays */}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <MobileMenu
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onOpenSearch={() => setSearchOpen(true)}
        requestCta={requestCta}
        requestEnabled={requestEnabled}
        showSeriesNav={showSeriesNav}
      />
    </>
  );
}
