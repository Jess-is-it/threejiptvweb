'use client';
import Link from 'next/link';

export default function ChannelCard({ channel }) {
  const logo = channel.logo || '';
  const title = channel.name || `CH ${channel.id}`;

  // We’ll wire /watch in the next step; for now the link points to a stub.
  const href = `/watch/live/${channel.id}?auto=1`;

  return (
    <Link
      href={href}
      onClick={() => {
        try {
          sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
        } catch {}
      }}
      className="block rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 transition hover:border-neutral-600 focus:outline-none focus-visible:ring"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded bg-neutral-950">
          {logo ? (
            <img src={logo} alt={title} className="h-full w-full object-contain" loading="lazy" />
          ) : (
            <span className="text-xs text-neutral-500">No Logo</span>
          )}
        </div>
        <div>
          <div className="line-clamp-1 text-sm font-medium text-neutral-100">{title}</div>
          {channel.number ? (
            <div className="text-xs text-neutral-400">#{channel.number}</div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
