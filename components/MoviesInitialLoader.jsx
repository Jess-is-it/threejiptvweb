'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

const DEFAULT_MESSAGES = [
  'Checking database for the latest movies...',
  'Matching fresh artwork with your library...',
  'Loading the first movie cards into view...',
  'Warming up All Movies for smoother scrolling...',
];

export default function MoviesInitialLoader({
  show = false,
  messages = DEFAULT_MESSAGES,
}) {
  const safeMessages = Array.isArray(messages) && messages.length ? messages : DEFAULT_MESSAGES;
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!show) {
      setMessageIndex(0);
      return undefined;
    }

    const timer = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % safeMessages.length);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [safeMessages, show]);

  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[65] h-[76vh]">
      <div className="absolute inset-0 bg-gradient-to-b from-black/82 via-black/52 to-transparent backdrop-blur-[2px]" />

      <div className="absolute inset-x-0 top-24 flex justify-center px-4 sm:top-28 sm:px-6 lg:px-10">
        <div className="w-full max-w-xl rounded-[28px] border border-white/12 bg-black/68 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#CA4443]/40 bg-[#CA4443]/14 text-[#ff8f8f]">
              <Loader2 size={20} className="animate-spin" />
            </div>

            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">
                Preparing Your Movie Shelf
              </div>
              <div className="mt-2 text-lg font-semibold leading-snug text-white sm:text-xl">
                {safeMessages[messageIndex]}
              </div>
              <div className="mt-2 text-sm leading-6 text-neutral-300">
                We&apos;re loading the hero and the first batch of movie cards so the page fills in cleanly.
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-full bg-white/10">
            <div className="h-1.5 w-full animate-pulse rounded-full bg-gradient-to-r from-[#CA4443] via-white/85 to-[#CA4443]" />
          </div>
        </div>
      </div>
    </div>
  );
}
