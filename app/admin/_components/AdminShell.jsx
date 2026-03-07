'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePublicSettings } from '../../../components/PublicSettingsProvider';
import ChunkAutoReload from './ChunkAutoReload';
import ThemeToggle from './ThemeToggle';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Film,
  LayoutDashboard,
  Link as LinkIcon,
  HardDrive,
  Download,
  Search,
  Globe,
  Server,
  Settings,
  Settings2,
  KeyRound,
  Tv,
  LibraryBig,
  Users,
  Flag,
  ListChecks,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

const autodownloadPrimaryItems = [
  { href: '/admin/autodownload/readiness', label: 'Sanity Check', icon: CheckCircle2 },
  { href: '/admin/autodownload/movies', label: 'Movies', icon: Film },
  { href: '/admin/autodownload/series', label: 'Series', icon: Tv },
  { href: '/admin/autodownload/library', label: 'Library Inventory', icon: LibraryBig },
];

const autodownloadSettingsItems = [
  { href: '/admin/autodownload/engine', label: 'Engine Host', icon: Server },
  { href: '/admin/autodownload/storage', label: 'Storage & Mount', icon: HardDrive },
  { href: '/admin/autodownload/settings', label: 'AutoDownload Settings', icon: Settings2 },
  { href: '/admin/autodownload/sources', label: 'Download Sources', icon: Globe },
  { href: '/admin/autodownload/qbittorrent', label: 'qBittorrent', icon: Download },
  { href: '/admin/autodownload/processing-log', label: 'Processing Log', icon: FileText },
  { href: '/admin/autodownload/xui', label: 'XUI Integration', icon: LinkIcon },
  { href: '/admin/autodownload/scan-log', label: 'Scan Log', icon: Search },
];

function Nav({ href, icon: Icon, children, onClick }) {
  const path = usePathname() || '';
  const active = path === href || (href !== '/admin' && path.startsWith(href));
  return (
    <Link
      href={href}
      onClick={onClick}
      className={
        'no-underline flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ' +
        (active
          ? 'bg-[var(--admin-active-bg)] text-[var(--admin-text)]'
          : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] hover:text-[var(--admin-text)]')
      }
    >
      {Icon ? (
        <Icon size={18} className={active ? 'text-[var(--admin-text)]' : 'text-[var(--admin-muted)]'} />
      ) : null}
      {children}
    </Link>
  );
}

function pageTitle(pathname) {
  if (!pathname) return 'Admin';
  if (pathname === '/admin') return 'Dashboard';
  if (pathname.startsWith('/admin/autodownload')) return 'AutoDownload';
  if (pathname.startsWith('/admin/category-settings')) return 'Category Settings';
  if (pathname.startsWith('/admin/settings')) return 'Settings';
  if (pathname.startsWith('/admin/secrets')) return 'Secrets';
  if (pathname.startsWith('/admin/admins')) return 'Admins';
  if (pathname.startsWith('/admin/reports')) return 'Reports';
  if (pathname.startsWith('/admin/requests')) return 'Requests Queue';
  if (pathname.startsWith('/admin/request-settings')) return 'Request Settings';
  return 'Admin';
}

export default function AdminShell({ admin, children }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { settings } = usePublicSettings();
  const pathname = usePathname() || '/admin';
  const autodownloadActive = pathname.startsWith('/admin/autodownload');
  const autodownloadSettingsActive = autodownloadSettingsItems.some(
    (it) => pathname === it.href || pathname.startsWith(`${it.href}/`)
  );
  const [autodownloadOpen, setAutodownloadOpen] = useState(autodownloadActive);
  const [autodownloadSettingsOpen, setAutodownloadSettingsOpen] = useState(autodownloadSettingsActive);
  const [sanitySummary, setSanitySummary] = useState({ passed: null, total: null, status: 'warn' });

  useEffect(() => {
    if (autodownloadActive) setAutodownloadOpen(true);
  }, [autodownloadActive]);

  useEffect(() => {
    if (autodownloadSettingsActive) setAutodownloadSettingsOpen(true);
  }, [autodownloadSettingsActive]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const loadSanitySummary = async () => {
      try {
        const r = await fetch('/api/admin/autodownload/readiness/summary', { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) return;
        const summary = j?.summary || {};
        if (cancelled) return;
        setSanitySummary({
          passed: Number.isFinite(Number(summary?.passed)) ? Number(summary.passed) : null,
          total: Number.isFinite(Number(summary?.total)) ? Number(summary.total) : null,
          status: String(summary?.status || 'warn'),
        });
      } catch {}
    };

    loadSanitySummary();
    timer = setInterval(loadSanitySummary, 60000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const brandName = settings?.brand?.name || '3J TV';
  const logoUrl = settings?.brand?.logoUrl || '/brand/logo.svg';

  const logout = async () => {
    setBusy(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {}
    router.replace('/admin/login');
  };

  return (
    <div data-admin-ui="1" className="min-h-dvh bg-[var(--admin-bg)] text-[var(--admin-text)]">
      <ChunkAutoReload />
      {/* Mobile backdrop */}
      {sidebarOpen ? (
        <button
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-[60] bg-black/60 lg:hidden"
        />
      ) : null}

      <div className="flex min-h-dvh">
        {/* Sidebar */}
        <aside
          className={cx(
            'fixed inset-y-0 left-0 z-[70] flex w-72 flex-col overflow-y-auto border-r border-[var(--admin-border)] bg-[var(--admin-surface-solid)]/95 backdrop-blur transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex h-16 items-center justify-between border-b border-[var(--admin-border)] px-4">
            <Link href="/admin" className="no-underline flex items-center gap-3">
              <img
                src={logoUrl}
                onError={(e) => (e.currentTarget.src = '/brand/logo.png')}
                alt={brandName}
                className="h-8 w-8 rounded"
              />
              <div className="leading-tight">
                <div className="text-sm font-semibold">{brandName}</div>
                <div className="text-[11px] text-[var(--admin-muted)]">Admin Portal</div>
              </div>
            </Link>
            <button
              className="rounded-lg p-2 text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] lg:hidden"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <nav className="px-3 py-4">
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
              Menu
            </div>
            <div className="space-y-1">
              <Nav href="/admin" icon={LayoutDashboard} onClick={() => setSidebarOpen(false)}>
                Dashboard
              </Nav>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setAutodownloadOpen((v) => !v)}
                  aria-expanded={autodownloadOpen}
                  aria-controls="autodownload-subnav"
                  className={cx(
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition',
                    autodownloadActive
                      ? 'bg-[var(--admin-active-bg)] text-[var(--admin-text)]'
                      : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] hover:text-[var(--admin-text)]'
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Download
                      size={18}
                      className={autodownloadActive ? 'text-[var(--admin-text)]' : 'text-[var(--admin-muted)]'}
                    />
                    AutoDownload
                  </span>
                  {autodownloadOpen ? (
                    <ChevronDown
                      size={16}
                      className={autodownloadActive ? 'text-[var(--admin-text)]' : 'text-[var(--admin-muted)]'}
                    />
                  ) : (
                    <ChevronRight
                      size={16}
                      className={autodownloadActive ? 'text-[var(--admin-text)]' : 'text-[var(--admin-muted)]'}
                    />
                  )}
                </button>

                {autodownloadOpen ? (
                  <div id="autodownload-subnav" className="space-y-1 pl-5">
                    {autodownloadPrimaryItems.map((it) => {
                      const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
                      const Icon = it.icon;
                      const isSanity = it.href === '/admin/autodownload/readiness';
                      const hasRatio = Number.isFinite(Number(sanitySummary?.passed)) && Number.isFinite(Number(sanitySummary?.total));
                      const ratioText = hasRatio ? `${Number(sanitySummary.passed)}/${Number(sanitySummary.total)}` : '--/--';
                      const ratioStyle =
                        sanitySummary?.status === 'good'
                          ? {
                              borderColor: 'var(--admin-pill-success-border)',
                              backgroundColor: 'var(--admin-pill-success-bg)',
                              color: 'var(--admin-pill-success-text)',
                            }
                          : sanitySummary?.status === 'bad'
                            ? {
                                borderColor: 'var(--admin-pill-danger-border)',
                                backgroundColor: 'var(--admin-pill-danger-bg)',
                                color: 'var(--admin-pill-danger-text)',
                              }
                            : {
                                borderColor: 'var(--admin-pill-warning-border)',
                                backgroundColor: 'var(--admin-pill-warning-bg)',
                                color: 'var(--admin-pill-warning-text)',
                              };
                      return (
                        <Link
                          key={it.href}
                          href={it.href}
                          onClick={() => setSidebarOpen(false)}
                          className={cx(
                            'group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors hover:no-underline hover:opacity-100',
                            active
                              ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
                              : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] hover:text-[var(--admin-text)]'
                          )}
                        >
                          <Icon
                            size={16}
                            className={cx(
                              'shrink-0',
                              active ? 'text-primary' : 'text-[var(--admin-muted)] group-hover:text-[var(--admin-text)]'
                            )}
                          />
                          <span className="truncate">{it.label}</span>
                          {isSanity ? (
                            <span
                              className={cx(
                                'ml-auto inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold'
                              )}
                              style={ratioStyle}
                              title="Sanity score (passed checks / total checks)"
                            >
                              {ratioText}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}

                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setAutodownloadSettingsOpen((v) => !v)}
                        aria-expanded={autodownloadSettingsOpen}
                        aria-controls="autodownload-settings-subnav"
                        className={cx(
                          'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition',
                          autodownloadSettingsActive
                            ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
                            : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] hover:text-[var(--admin-text)]'
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <Settings2
                            size={16}
                            className={autodownloadSettingsActive ? 'text-primary' : 'text-[var(--admin-muted)]'}
                          />
                          Settings
                        </span>
                        {autodownloadSettingsOpen ? (
                          <ChevronDown
                            size={16}
                            className={autodownloadSettingsActive ? 'text-primary' : 'text-[var(--admin-muted)]'}
                          />
                        ) : (
                          <ChevronRight
                            size={16}
                            className={autodownloadSettingsActive ? 'text-primary' : 'text-[var(--admin-muted)]'}
                          />
                        )}
                      </button>

                      {autodownloadSettingsOpen ? (
                        <div id="autodownload-settings-subnav" className="space-y-1 pl-5">
                          {autodownloadSettingsItems.map((it) => {
                            const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
                            const Icon = it.icon;
                            return (
                              <Link
                                key={it.href}
                                href={it.href}
                                onClick={() => setSidebarOpen(false)}
                                className={cx(
                                  'group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors hover:no-underline hover:opacity-100',
                                  active
                                    ? 'bg-primary/15 text-primary ring-1 ring-primary/35'
                                    : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] hover:text-[var(--admin-text)]'
                                )}
                              >
                                <Icon
                                  size={16}
                                  className={cx(
                                    'shrink-0',
                                    active ? 'text-primary' : 'text-[var(--admin-muted)] group-hover:text-[var(--admin-text)]'
                                  )}
                                />
                                <span>{it.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <Nav href="/admin/settings" icon={Settings} onClick={() => setSidebarOpen(false)}>
                Settings
              </Nav>
              <Nav href="/admin/secrets" icon={KeyRound} onClick={() => setSidebarOpen(false)}>
                Secrets
              </Nav>
              <Nav href="/admin/admins" icon={Users} onClick={() => setSidebarOpen(false)}>
                Admins
              </Nav>
              <Nav href="/admin/reports" icon={Flag} onClick={() => setSidebarOpen(false)}>
                Reports
              </Nav>
              <Nav href="/admin/requests" icon={ListChecks} onClick={() => setSidebarOpen(false)}>
                Requests
              </Nav>
              <Nav href="/admin/request-settings" icon={Settings2} onClick={() => setSidebarOpen(false)}>
                Request Settings
              </Nav>
              <Nav href="/admin/category-settings" icon={Settings2} onClick={() => setSidebarOpen(false)}>
                Category Settings
              </Nav>
            </div>
          </nav>

          <div className="mt-auto border-t border-[var(--admin-border)] p-4">
            <div className="text-xs text-[var(--admin-muted)]">Signed in as</div>
            <div className="truncate text-sm font-medium">{admin?.username || admin?.email || 'admin'}</div>
            <button
              disabled={busy}
              onClick={logout}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              <LogOut size={16} />
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </aside>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-40 border-b border-[var(--admin-border)] bg-[var(--admin-surface)] backdrop-blur">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  className="rounded-lg p-2 text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] lg:hidden"
                  aria-label="Open sidebar"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={18} />
                </button>
                <div>
                  <div className="text-sm font-semibold">{pageTitle(pathname)}</div>
                  <div className="text-[11px] text-[var(--admin-muted)]">3J TV · Admin</div>
                </div>
              </div>

              <div className="hidden items-center gap-3 sm:flex">
                <ThemeToggle />
                <div className="text-xs text-[var(--admin-muted)]">{admin?.username || admin?.email}</div>
                <span className="h-5 w-px bg-[var(--admin-border)]" />
                <button
                  disabled={busy}
                  onClick={logout}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                >
                  {busy ? 'Signing out…' : 'Sign out'}
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
