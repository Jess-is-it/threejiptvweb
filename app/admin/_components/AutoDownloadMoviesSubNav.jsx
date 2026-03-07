'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText } from 'lucide-react';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

const items = [
  { href: '/admin/autodownload/movies', label: 'Selection Log', icon: FileText },
];

export default function AutoDownloadMoviesSubNav() {
  const path = usePathname() || '';
  return (
    <div className="mb-4 overflow-x-auto">
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
