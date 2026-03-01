// components/Header.jsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from './SessionProvider';
import { usePublicSettings } from './PublicSettingsProvider';
import { useUserPreferences } from './UserPreferencesProvider';

// icons
import {
  Search,
  User,
  Menu,
  X,
  Film,
  Tv,
  SquarePlus,
  ChevronRight,
  LogOut,
  Check,
} from 'lucide-react';
import NotificationsBell from './NotificationsBell';

const BRAND = 'var(--brand)';
const HEADER_H = 64;

// ---------- helpers ----------
function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function requestCtaForPath(pathname = '/') {
  const p = String(pathname || '/').toLowerCase();
  if (p.startsWith('/movies')) {
    return { href: '/request?type=movie', label: 'Request Movie' };
  }
  if (p.startsWith('/series')) {
    return { href: '/request?type=tv', label: 'Request Series' };
  }
  if (p === '/' || p.startsWith('/home')) {
    return { href: '/request?type=all', label: 'Request' };
  }
  return { href: '/request?type=all', label: 'Request' };
}

function NavLink({ href, children }) {
  const path = usePathname() || '/';
  const active = path === href || (href !== '/' && path.startsWith(href));
  return (
    <Link
      href={href}
      className={cx(
        'relative rounded-md px-3 py-2 no-underline font-bold cursor-pointer',
        'text-[14px] md:text-[16px]',
        active
          ? 'text-white border-b-2 border-[var(--brand)] pb-[6px]'
          : 'text-neutral-300 hover:text-white hover:bg-white/10'
      )}
      style={{ ['--brand']: BRAND }}
    >
      {children}
    </Link>
  );
}

// ---------- Search Modal ----------
function SearchModal({ open, onClose }) {
  const router = useRouter();
  const { session } = useSession();
  const [q, setQ] = useState('');
  const [movieCats, setMovieCats] = useState([]);
  const [seriesCats, setSeriesCats] = useState([]);
  const [pick, setPick] = useState(null); // { id, name }

  useEffect(() => {
    if (!open) return;
    setPick(null);

    const load = async () => {
      try {
        const qs = `?streamBase=${encodeURIComponent(session?.streamBase || '')}`;
        const [m, s] = await Promise.all([
          fetch(`/api/xuione/vod/categories${qs}`).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/xuione/series/categories${qs}`).then((r) => r.json()).catch(() => ({})),
        ]);
        setMovieCats(m?.categories || []);
        setSeriesCats(s?.categories || []);
      } catch {
        setMovieCats([]);
        setSeriesCats([]);
      }
    };
    load();
  }, [open, session?.streamBase]);

  const goSearch = (e) => {
    e?.preventDefault?.();
    if (!q.trim()) return;
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    onClose();
  };

  const goCategory = (type, id) => {
    if (type === 'movie') router.push(`/movies?cat=${encodeURIComponent(id)}`);
    else router.push(`/series?cat=${encodeURIComponent(id)}`);
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
              placeholder="Search movies, series…"
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
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Film size={16} className="text-neutral-300" />
              <h4 className="text-sm font-semibold">Movie Categories</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {movieCats.map((c) => (
                <button
                  key={`m-${c.id}`}
                  onClick={() => setPick({ id: c.id, name: c.name })}
                  className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500"
                  title="Choose Movies or Series"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <Tv size={16} className="text-neutral-300" />
              <h4 className="text-sm font-semibold">Series Categories</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {seriesCats.map((c) => (
                <button
                  key={`s-${c.id}`}
                  onClick={() => setPick({ id: c.id, name: c.name })}
                  className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 hover:border-neutral-500"
                  title="Choose Movies or Series"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* When a category is clicked, ask Movies / Series */}
        {pick && (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="mb-3 text-sm text-neutral-300">
              <span className="font-medium text-white">{pick.name}</span> — open as:
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => goCategory('movie', pick.id)}
                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 hover:bg-white/15"
              >
                <Film size={16} />
                Movies
                <ChevronRight size={16} />
              </button>
              <button
                onClick={() => goCategory('series', pick.id)}
                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 hover:bg-white/15"
              >
                <Tv size={16} />
                Series
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Profile Popover ----------
function ProfileMenu({ open, onClose }) {
  const { logout } = useSession();
  const { movieCardClickAction, setMovieCardClickAction } = useUserPreferences();
  const router = useRouter();
  const [mode, setMode] = useState('adult'); // 'adult' or 'kids'
  const ref = useRef(null);

  useEffect(() => {
    const saved = typeof window !== 'undefined' && localStorage.getItem('profile.mode');
    if (saved === 'kids' || saved === 'adult') setMode(saved);
  }, []);
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
            localStorage.setItem('profile.mode', 'adult');
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
            localStorage.setItem('profile.mode', 'kids');
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
function MobileMenu({ open, onClose, onOpenSearch, requestCta }) {
  const pathname = usePathname() || '/';
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
            ['/series', 'Series'],
            ['/live', 'Live'],
            ['/bookmarks', 'My watchlist'],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cx(
                'rounded-lg px-3 py-3 no-underline',
                pathname === href || (href !== '/' && pathname.startsWith(href))
                  ? 'bg-white/10 text-white'
                  : 'text-neutral-300 hover:bg-white/10 hover:text-white'
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-6 border-t border-neutral-800 pt-4">
          <div className="grid grid-cols-3 gap-3">
            <Link
              href={requestCta?.href || '/request?type=all'}
              onClick={onClose}
              className="flex flex-col items-center gap-1 rounded-lg bg-white/5 p-3 hover:bg-white/10"
              title={requestCta?.label || 'Request'}
            >
              <SquarePlus /> <span className="text-xs text-center">{requestCta?.label || 'Request'}</span>
            </Link>

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
  const { session } = useSession();
  const { settings } = usePublicSettings();
  const pathname = usePathname() || '/';
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const logoUrl = settings?.brand?.logoUrl || '/brand/logo.svg';
  const requestCta = requestCtaForPath(pathname);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header
        id="site-header"
        className={cx(
          'fixed inset-x-0 top-0 z-50 h-16 transition-colors',
          scrolled
            ? 'border-b border-neutral-900 bg-neutral-950/70 supports-[backdrop-filter]:backdrop-blur'
            : 'bg-transparent border-b border-transparent'
        )}
        style={{ height: HEADER_H }}
      >
        <div className="mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          {/* Left: logo + nav */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center">
              <img
                src={logoUrl}
                onError={(e) => (e.currentTarget.src = '/brand/logo.png')}
                alt="3J TV"
                className="h-12"
                draggable={false}
              />
            </Link>

            <nav className="hidden md:flex items-center gap-2">
              <NavLink href="/">Home</NavLink>
              <NavLink href="/movies">Movies</NavLink>
              <NavLink href="/series">Series</NavLink>
              <NavLink href="/live">Live</NavLink>
              <NavLink href="/bookmarks">My watchlist</NavLink>
            </nav>
          </div>

          {/* Right: actions */}
          <div className="relative flex items-center gap-1">
            {/* Request (contextual) */}
            <Link
              href={requestCta.href}
              className="hidden sm:inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-semibold text-neutral-100 hover:border-neutral-500 hover:bg-neutral-800"
              title={requestCta.label}
            >
              <SquarePlus size={15} />
              <span>{requestCta.label}</span>
            </Link>

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
                className="inline-flex items-center rounded-full border border-neutral-700 bg-neutral-900 p-2 text-neutral-200 hover:border-neutral-500"
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
      />
    </>
  );
}
