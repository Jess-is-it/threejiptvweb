'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CheckCircle2,
  Download,
  Film,
  FileText,
  HardDrive,
  Link as LinkIcon,
  Search,
  Globe,
  Server,
  Shield,
  Settings2,
  Tv,
  LibraryBig,
} from 'lucide-react';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

const items = [
  { href: '/admin/autodownload/readiness', label: 'Sanity Check', icon: CheckCircle2 },
  { href: '/admin/autodownload/engine', label: 'Engine Host', icon: Server },
  { href: '/admin/autodownload/storage', label: 'Storage & Mount', icon: HardDrive },
  { href: '/admin/autodownload/settings', label: 'AutoDownload Settings', icon: Settings2 },
  { href: '/admin/autodownload/autodelete/settings', label: 'AutoDelete Settings', icon: Settings2 },
  { href: '/admin/autodownload/sources', label: 'Download Sources', icon: Globe },
  { href: '/admin/autodownload/qbittorrent', label: 'qBittorrent', icon: Download },
  { href: '/admin/autodownload/vpn', label: 'VPN Routing', icon: Shield },
  { href: '/admin/autodownload/selection-log/movies', label: 'Movies Selection Log', icon: Film },
  { href: '/admin/autodownload/selection-log/series', label: 'Series Selection Log', icon: Tv },
  { href: '/admin/autodownload/autodelete/movies', label: 'Movies Deletion Log', icon: Film },
  { href: '/admin/autodownload/autodelete/series', label: 'Series Deletion Log', icon: Tv },
  { href: '/admin/autodownload/library', label: 'Library Inventory', icon: LibraryBig },
  { href: '/admin/autodownload/processing-log', label: 'Processing Log', icon: FileText },
  { href: '/admin/autodownload/xui', label: 'XUI Integration', icon: LinkIcon },
  { href: '/admin/autodownload/scan-log', label: 'Scan Log', icon: Search },
];

export default function AutoDownloadNav() {
  const path = usePathname() || '';
  return (
    <div className="mb-6 overflow-x-auto">
      <div className="inline-flex min-w-full items-center gap-2 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
        {items.map((it) => {
          const active = path === it.href || path.startsWith(`${it.href}/`);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cx(
                'group inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors hover:no-underline hover:opacity-100',
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
    </div>
  );
}
