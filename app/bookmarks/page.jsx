'use client';

import Protected from '../../components/Protected';

export default function BookmarksPage() {
  return (
    <Protected>
      <section className="py-10 px-4 sm:px-6 lg:px-10">
        <h1 className="text-2xl font-bold">My Watchlist</h1>
        <p className="mt-3 max-w-2xl text-sm text-neutral-300">
          Watchlist page is available and ready for upcoming saved-title features.
        </p>
      </section>
    </Protected>
  );
}
