'use client';

import { useEffect } from 'react';
import { Pencil } from 'lucide-react';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

export function EditIconButton({ onClick, className = '', title = 'Edit' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-[var(--admin-muted)] hover:bg-black/10 hover:text-[var(--admin-text)]',
        className
      )}
      title={title}
      aria-label={title}
    >
      <Pencil size={16} />
    </button>
  );
}

export default function EditModal({
  open,
  title = 'Edit',
  description = '',
  error = '',
  success = '',
  onCancel,
  onSave,
  saveLabel = 'Save',
  saveDisabled = false,
  saving = false,
  children,
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close"
        onClick={() => onCancel?.()}
      />
      <div className="absolute left-1/2 top-1/2 w-[min(860px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
        <div className="border-b border-[var(--admin-border)] p-5">
          <div className="text-lg font-semibold text-[var(--admin-text)]">{title}</div>
          {description ? <div className="mt-1 text-sm text-[var(--admin-muted)]">{description}</div> : null}
        </div>

        <div className="max-h-[70vh] overflow-auto p-5">
          {error ? <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}
          {success ? <div className="mb-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</div> : null}
          {children}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--admin-border)] p-4">
          <button
            type="button"
            onClick={() => onCancel?.()}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave?.()}
            disabled={saving || saveDisabled}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
