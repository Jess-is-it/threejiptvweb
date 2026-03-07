'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { useSession } from './SessionProvider';
import { readJsonSafe } from '../lib/readJsonSafe';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function fmt(ts) {
  const n = Number(ts || 0);
  if (!n) return '';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '';
  }
}

export default function NotificationsBell() {
  const { session } = useSession();
  const username = session?.user?.username || '';

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const top = useMemo(() => (Array.isArray(items) ? items.slice(0, 12) : []), [items]);

  const load = async () => {
    if (!username) return;
    try {
      const r = await fetch(`/api/public/notifications?username=${encodeURIComponent(username)}`, { cache: 'no-store' });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) return;
      setItems(Array.isArray(j.items) ? j.items : []);
      setUnread(Number(j.unread || 0));
    } catch {}
  };

  useEffect(() => {
    load();
    if (!username) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  useEffect(() => {
    const onClick = (e) => {
      if (!open) return;
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const markAllRead = async () => {
    if (!username) return;
    setBusy(true);
    try {
      const r = await fetch('/api/public/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, markAll: true }),
      });
      const j = await readJsonSafe(r);
      if (r.ok && j.ok) {
        setUnread(Number(j.unread || 0));
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (id) => {
    if (!username || !id) return;
    setBusy(true);
    try {
      const r = await fetch('/api/public/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, markReadIds: [String(id)] }),
      });
      const j = await readJsonSafe(r);
      if (r.ok && j.ok) {
        setUnread(Number(j.unread || 0));
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!username) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center rounded-md p-2 text-neutral-200 hover:bg-white/10"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--brand)] px-1 text-[11px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-[65] mt-2 w-[min(420px,92vw)]">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-3 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Notifications</div>
                <div className="text-[11px] text-neutral-400">
                  {unread ? `${unread} unread` : 'All caught up'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={busy || unread === 0}
                  onClick={markAllRead}
                  className={cx(
                    'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
                    'border-neutral-800 bg-white/5 text-neutral-200 hover:bg-white/10 disabled:opacity-50'
                  )}
                >
                  <Check size={14} /> Mark all read
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-neutral-300 hover:bg-white/10"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-[420px] space-y-2 overflow-auto pr-1">
              {!top.length ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-3 text-xs text-neutral-300">
                  No notifications yet.
                </div>
              ) : (
                top.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={cx(
                      'w-full rounded-lg border p-3 text-left transition',
                      n.readAt
                        ? 'border-neutral-800 bg-neutral-900/20 hover:bg-neutral-900/35'
                        : 'border-[var(--brand)]/30 bg-[var(--brand)]/5 hover:bg-[var(--brand)]/10'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-neutral-100">{n.title || 'Update'}</div>
                        {n.message ? (
                          <div className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-neutral-300">{n.message}</div>
                        ) : null}
                        <div className="mt-2 text-[11px] text-neutral-400">{fmt(n.createdAt)}</div>
                      </div>
                      {!n.readAt ? (
                        <span className="mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
