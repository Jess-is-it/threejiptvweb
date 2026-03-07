'use client';

import { useMemo, useState } from 'react';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function NotesModal({ open, title, sections, onClose }) {
  if (!open) return null;
  const list = Array.isArray(sections) ? sections : [];
  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close notes" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-[var(--admin-text)]">{title || 'Notes'}</div>
            <div className="mt-1 text-sm text-[var(--admin-muted)]">Quick guide for this page.</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
          >
            Close
          </button>
        </div>

        <div className="mt-4 max-h-[70vh] overflow-auto pr-1">
          {list.map((s) => (
            <div key={s.title} className="mt-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
              <div className="text-sm font-semibold text-[var(--admin-text)]">{s.title}</div>
              {Array.isArray(s.items) && s.items.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--admin-text)]">
                  {s.items.map((it, idx) => (
                    <li key={`${s.title}-${idx}`}>{it}</li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-sm text-[var(--admin-muted)]">—</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function NotesButton({ title = 'Notes', sections = [], className = '' }) {
  const [open, setOpen] = useState(false);
  const safeSections = useMemo(() => (Array.isArray(sections) ? sections : []), [sections]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        tabIndex={-1}
        className={cx(
          'inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10',
          className
        )}
        title="Open notes"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface)] text-[11px] text-[var(--admin-muted)]">
          i
        </span>
        Notes
      </button>
      <NotesModal open={open} title={title} sections={safeSections} onClose={() => setOpen(false)} />
    </>
  );
}
