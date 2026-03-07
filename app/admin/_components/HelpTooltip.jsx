'use client';

import { useId } from 'react';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

export default function HelpTooltip({ text = '', className = '' }) {
  const id = useId();
  const msg = String(text || '').trim();
  if (!msg) return null;

  return (
    <span className={cx('relative inline-flex items-center', className)}>
      <span className="group inline-flex">
        <button
          type="button"
          aria-label="Field help"
          aria-describedby={id}
          tabIndex={-1}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface)] text-[11px] text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
        >
          ?
        </button>
        <span
          id={id}
          role="tooltip"
          className={
            'pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-lg border border-[var(--admin-border)] ' +
            'bg-[var(--admin-surface)] px-3 py-2 text-xs text-[var(--admin-text)] shadow-lg opacity-0 ' +
            'transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
          }
        >
          {msg}
        </span>
      </span>
    </span>
  );
}
