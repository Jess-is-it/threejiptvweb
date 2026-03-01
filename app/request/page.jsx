'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import { readJsonSafe } from '../../lib/readJsonSafe';

const FILTERS = [
  { id: 'popular', label: 'Popular' },
  { id: 'tagalog', label: 'Tagalog' },
  { id: 'anime', label: 'Anime' },
  { id: 'action', label: 'Action' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'horror', label: 'Horror' },
  { id: 'romance', label: 'Romance' },
  { id: 'drama', label: 'Drama' },
  { id: 'scifi', label: 'Sci-fi' },
];

function normalizeType(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'movie') return 'movie';
  if (s === 'tv' || s === 'series') return 'tv';
  return 'all';
}

function normalizeFilter(value) {
  const s = String(value || '').trim().toLowerCase();
  if (FILTERS.find((x) => x.id === s)) return s;
  return 'popular';
}

function mediaKey(item) {
  const type = String(item?.mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  return `${type}:${Number(item?.tmdbId || 0)}`;
}

function mediaKeyFromPair(tmdbId, mediaType) {
  const type = String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  return `${type}:${Number(tmdbId || 0)}`;
}

function tmdbImage(path, size = 'w500') {
  const p = String(path || '').trim();
  if (!p) return '/images/placeholder.png';
  if (p.startsWith('http')) return p;
  return `https://image.tmdb.org/t/p/${size}${p}`;
}

function yearFromDate(date) {
  const s = String(date || '').trim();
  const m = s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

function requestStatusLabel(tags, status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return String(tags?.pending || 'Pending');
  if (s === 'approved') return String(tags?.approved || 'Approved');
  if (s === 'available_now') return String(tags?.availableNow || 'Available Now');
  if (s === 'rejected') return String(tags?.rejected || 'Rejected');
  if (s === 'archived') return String(tags?.archived || 'Archived');
  return s ? s.replaceAll('_', ' ') : '';
}

function useToasts() {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 2600);
  }, []);
  const View = () => (
    <div className="pointer-events-none fixed inset-0 z-[120] flex flex-col items-center justify-end gap-2 px-4 pb-5 sm:justify-start sm:pt-20">
      {items.map((x) => (
        <div
          key={x.id}
          className={
            'pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ' +
            (x.tone === 'error'
              ? 'border-red-500/35 bg-red-500/15 text-red-100'
              : x.tone === 'success'
                ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                : 'border-white/15 bg-black/60 text-neutral-100')
          }
        >
          {x.text}
        </div>
      ))}
    </div>
  );
  return { push, View };
}

export default function RequestPage() {
  const { session } = useSession();
  const username = String(session?.user?.username || '').trim();
  const streamBase = String(session?.streamBase || '').trim();
  const searchParams = useSearchParams();
  const { push, View: Toasts } = useToasts();

  const initialType = normalizeType(searchParams?.get('type'));
  const initialFilter = normalizeFilter(searchParams?.get('filter'));

  const [type, setType] = useState(initialType);
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [catalog, setCatalog] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErr, setCatalogErr] = useState('');

  const [stateMap, setStateMap] = useState({});
  const [quota, setQuota] = useState({ limit: 3, used: 0, remaining: 3 });
  const [settings, setSettings] = useState({
    dailyLimitDefault: 3,
    defaultLandingCategory: 'popular',
    statusTags: {},
  });

  const [selected, setSelected] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [requestedModal, setRequestedModal] = useState(null);
  const [remindBusy, setRemindBusy] = useState(false);

  const didApplyDefaultFilter = useRef(false);
  const sentinelRef = useRef(null);

  useEffect(() => setType(initialType), [initialType]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  const selectedKeys = useMemo(() => new Set(selected.map((x) => mediaKey(x))), [selected]);

  const resolveCardState = useCallback(
    (item) => {
      const key = mediaKey(item);
      const row = stateMap[key];
      if (row?.state === 'available') return { state: 'available', meta: row };
      if (row?.state === 'requested' || row?.requestId) return { state: 'requested', meta: row };
      return { state: 'requestable', meta: row || null };
    },
    [stateMap]
  );

  const hydrateBaseData = useCallback(async () => {
    if (!username) return;
    const r = await fetch(`/api/public/requests?username=${encodeURIComponent(username)}`, { cache: 'no-store' });
    const j = await readJsonSafe(r);
    if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load request settings');

    const active = j?.activeStates && typeof j.activeStates === 'object' ? j.activeStates : {};
    const mapped = {};
    for (const [k, v] of Object.entries(active)) {
      mapped[k] = { state: 'requested', ...v };
    }

    setStateMap((prev) => ({ ...prev, ...mapped }));
    setSettings(j?.settings || {});
    if (j?.quota) setQuota(j.quota);

    if (!didApplyDefaultFilter.current && !searchParams?.get('filter')) {
      setFilter(normalizeFilter(j?.settings?.defaultLandingCategory));
      didApplyDefaultFilter.current = true;
    }
  }, [username, searchParams]);

  const updateStatesForItems = useCallback(
    async (items) => {
      if (!username || !streamBase) return;
      if (!Array.isArray(items) || !items.length) return;
      const r = await fetch('/api/public/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'state',
          username,
          streamBase,
          items: items.map((x) => ({
            tmdbId: x.tmdbId,
            mediaType: x.mediaType,
            title: x.title,
            originalTitle: x.originalTitle,
            releaseDate: x.releaseDate,
            posterPath: x.posterPath,
            backdropPath: x.backdropPath,
            overview: x.overview,
          })),
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) return;
      const states = j?.states && typeof j.states === 'object' ? j.states : {};
      setStateMap((prev) => ({ ...prev, ...states }));
      if (j?.quota) setQuota(j.quota);
    },
    [username, streamBase]
  );

  const fetchCatalogPage = useCallback(
    async ({ targetPage, reset }) => {
      const params = new URLSearchParams();
      params.set('type', type);
      params.set('filter', filter);
      params.set('page', String(targetPage));
      if (debouncedQuery) params.set('q', debouncedQuery);

      setCatalogLoading(true);
      setCatalogErr('');
      try {
        const r = await fetch(`/api/public/requests/catalog?${params.toString()}`, { cache: 'no-store' });
        const j = await readJsonSafe(r);
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load catalog');
        const rows = Array.isArray(j?.items) ? j.items : [];
        setTotalPages(Number(j?.totalPages || 1) || 1);
        setCatalog((prev) => {
          if (reset) return rows;
          const next = [...prev];
          const seen = new Set(next.map((x) => mediaKey(x)));
          for (const row of rows) {
            const key = mediaKey(row);
            if (seen.has(key)) continue;
            seen.add(key);
            next.push(row);
          }
          return next;
        });
        updateStatesForItems(rows);
      } catch (e) {
        setCatalogErr(e?.message || 'Failed to load catalog');
      } finally {
        setCatalogLoading(false);
      }
    },
    [type, filter, debouncedQuery, updateStatesForItems]
  );

  useEffect(() => {
    hydrateBaseData().catch((e) => {
      push(e?.message || 'Failed to load request data', 'error');
    });
  }, [hydrateBaseData, push]);

  useEffect(() => {
    if (!username || !streamBase) return;
    setPage(1);
    fetchCatalogPage({ targetPage: 1, reset: true });
  }, [username, streamBase, type, filter, debouncedQuery, fetchCatalogPage]);

  useEffect(() => {
    if (!username || !streamBase) return;
    if (page <= 1) return;
    fetchCatalogPage({ targetPage: page, reset: false });
  }, [page, username, streamBase, fetchCatalogPage]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    if (catalogLoading) return;
    if (page >= totalPages) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        setPage((p) => (p < totalPages ? p + 1 : p));
      },
      { rootMargin: '800px 0px' }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [catalogLoading, page, totalPages]);

  const toggleSelect = useCallback(
    (item) => {
      const key = mediaKey(item);
      setSelected((prev) => {
        const exists = prev.some((x) => mediaKey(x) === key);
        if (exists) return prev.filter((x) => mediaKey(x) !== key);
        const remaining = Math.max(0, Number(quota?.remaining ?? quota?.limit ?? 3));
        if (prev.length >= remaining) {
          push(`Daily request limit reached (${Number(quota?.limit || 3)} max).`, 'error');
          return prev;
        }
        return [...prev, item];
      });
    },
    [push, quota]
  );

  const onCardClick = useCallback(
    (item) => {
      const resolved = resolveCardState(item);
      if (resolved.state === 'available') return;
      if (resolved.state === 'requested') {
        setRequestedModal({ item, meta: resolved.meta || {} });
        return;
      }
      toggleSelect(item);
    },
    [resolveCardState, toggleSelect]
  );

  const sendRemind = useCallback(async () => {
    if (!requestedModal?.item || !username) return;
    setRemindBusy(true);
    try {
      const r = await fetch('/api/public/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'remind',
          username,
          tmdbId: requestedModal.item.tmdbId,
          mediaType: requestedModal.item.mediaType,
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to subscribe reminder');
      push(j?.subscribed ? 'Reminder added.' : 'You are already subscribed.', 'success');
      setRequestedModal(null);
    } catch (e) {
      push(e?.message || 'Failed to subscribe reminder', 'error');
    } finally {
      setRemindBusy(false);
    }
  }, [requestedModal, username, push]);

  const submitSelected = useCallback(async () => {
    if (!selected.length || !username || !streamBase) return;
    setSubmitting(true);
    try {
      const r = await fetch('/api/public/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          username,
          streamBase,
          items: selected.map((x) => ({
            tmdbId: x.tmdbId,
            mediaType: x.mediaType,
            title: x.title,
            originalTitle: x.originalTitle,
            releaseDate: x.releaseDate,
            posterPath: x.posterPath,
            backdropPath: x.backdropPath,
            overview: x.overview,
          })),
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to submit requests');

      if (j?.quota) setQuota(j.quota);
      await updateStatesForItems(selected);

      const created = Number(Array.isArray(j?.created) ? j.created.length : 0);
      const duplicates = Number(Array.isArray(j?.duplicates) ? j.duplicates.length : 0);
      const rejectedList = Array.isArray(j?.rejected) ? j.rejected : [];
      const rejectedByLimit = rejectedList.filter((x) => String(x?.reason || '') === 'daily_limit_exceeded');
      const rejectedByAvailable = rejectedList.filter((x) => String(x?.reason || '') === 'available_now');
      const rejectedOther = rejectedList.filter((x) => {
        const reason = String(x?.reason || '');
        return reason !== 'daily_limit_exceeded' && reason !== 'available_now';
      });

      const keepSelection = new Set(
        rejectedByLimit.map((x) => mediaKeyFromPair(x?.tmdbId, x?.mediaType))
      );
      setSelected((prev) => prev.filter((x) => keepSelection.has(mediaKey(x))));

      if (created > 0) {
        push(`Submitted ${created} request${created > 1 ? 's' : ''}.`, 'success');
      }
      if (duplicates > 0) {
        push(
          `${duplicates} title${duplicates > 1 ? 's were' : ' was'} already requested.`,
          'info'
        );
      }
      if (rejectedByAvailable.length > 0) {
        push(
          `${rejectedByAvailable.length} title${
            rejectedByAvailable.length > 1 ? 's are' : ' is'
          } already available now.`,
          'info'
        );
      }
      if (rejectedByLimit.length > 0) {
        push(
          `Daily limit reached. ${rejectedByLimit.length} title${
            rejectedByLimit.length > 1 ? 's were' : ' was'
          } kept in your cart.`,
          'error'
        );
      }
      if (rejectedOther.length > 0) {
        push(
          `Skipped ${rejectedOther.length} title${
            rejectedOther.length > 1 ? 's' : ''
          } due to validation.`,
          'info'
        );
      }
      if (created === 0 && duplicates === 0 && rejectedList.length === 0) {
        push('No new requests were submitted.', 'info');
      }
    } catch (e) {
      push(e?.message || 'Failed to submit requests', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [selected, username, streamBase, updateStatesForItems, push]);

  const maxLimit = Number(quota?.limit || settings?.dailyLimitDefault || 3) || 3;

  return (
    <Protected>
      <section className="relative py-6 px-4 sm:px-6 lg:px-10">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Request</h1>
          <p className="mt-1 text-sm text-neutral-300">
            Choose titles to request. Daily limit: {maxLimit} (used {Number(quota?.used || 0)}).
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'All' },
            { id: 'movie', label: 'Movies' },
            { id: 'tv', label: 'Series' },
          ].map((x) => (
            <button
              key={x.id}
              onClick={() => setType(x.id)}
              className={
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition ' +
                (type === x.id
                  ? 'border-[var(--brand)] bg-[var(--brand)]/20 text-white'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500')
              }
            >
              {x.label}
            </button>
          ))}
        </div>

        <div className="relative mb-4">
          <div className="flex items-center overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            <Search size={16} className="ml-3 text-neutral-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title..."
              className="w-full bg-transparent px-3 py-3 text-sm outline-none"
            />
            {query ? (
              <button
                onClick={() => {
                  setQuery('');
                }}
                className="mr-2 rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
                aria-label="Clear search"
                title="Clear"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="mb-6 -mx-1 overflow-x-auto px-1">
          <div className="flex w-max gap-2">
            {FILTERS.map((g) => (
              <button
                key={g.id}
                onClick={() => setFilter(g.id)}
                className={
                  'rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ' +
                  (filter === g.id
                    ? 'border-[var(--brand)] bg-[var(--brand)]/20 text-white'
                    : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500')
                }
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {catalogErr ? <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{catalogErr}</div> : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {catalog.map((item) => {
            const key = mediaKey(item);
            const resolved = resolveCardState(item);
            const isSelected = selectedKeys.has(key);
            const statusText = String(resolved?.meta?.status || '').toLowerCase();
            const statusDisplay = requestStatusLabel(settings?.statusTags, statusText);
            return (
              <button
                key={key}
                onClick={() => onCardClick(item)}
                disabled={resolved.state === 'available'}
                className={
                  'group relative overflow-hidden rounded-xl border bg-neutral-900 text-left transition ' +
                  (resolved.state === 'available'
                    ? 'cursor-default border-emerald-500/40'
                    : resolved.state === 'requested'
                      ? 'border-amber-500/35 hover:border-amber-400/60'
                      : isSelected
                        ? 'border-[var(--brand)] shadow-[0_0_0_1px_var(--brand)]'
                        : 'border-neutral-800 hover:border-neutral-600')
                }
                title={item.title || ''}
              >
                <div className="aspect-[2/3] overflow-hidden bg-neutral-800">
                  <img
                    src={tmdbImage(item.posterPath)}
                    alt={item.title || ''}
                    className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                </div>
                <div className="p-2">
                  <div className="line-clamp-1 text-sm font-semibold text-neutral-100">{item.title || 'Untitled'}</div>
                  <div className="mt-0.5 text-xs text-neutral-400">
                    {item.mediaType === 'tv' ? 'Series' : 'Movie'}
                    {yearFromDate(item.releaseDate) ? ` • ${yearFromDate(item.releaseDate)}` : ''}
                  </div>
                </div>

                {(resolved.state === 'available' || resolved.state === 'requested') ? (
                  <div className="pointer-events-none absolute left-0 top-0 h-14 w-32 bg-gradient-to-br from-black/80 via-black/45 to-transparent" />
                ) : null}
                {resolved.state === 'available' ? (
                  <span className="absolute left-2 top-2 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                    Available Now
                  </span>
                ) : null}
                {resolved.state === 'requested' ? (
                  <span className="absolute left-2 top-2 rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                    Requested
                  </span>
                ) : null}
                {resolved.state === 'requested' && statusText && statusText !== 'pending' ? (
                  <span className="absolute left-2 top-7 rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] text-neutral-200">
                    {statusDisplay}
                  </span>
                ) : null}
                {resolved.state === 'requestable' && isSelected ? (
                  <span className="absolute right-2 top-2 rounded-md bg-[var(--brand)] px-1.5 py-0.5 text-xs font-bold text-white">
                    ☑
                  </span>
                ) : null}
              </button>
            );
          })}

          {!catalog.length && catalogLoading
            ? Array.from({ length: 12 }, (_, i) => (
                <div key={`rq-sk-${i}`} className="aspect-[2/3] animate-pulse rounded-xl bg-neutral-800/70" />
              ))
            : null}
        </div>

        <div ref={sentinelRef} className="h-10" />
        {catalogLoading && catalog.length ? <div className="text-sm text-neutral-400">Loading more...</div> : null}
        {!catalogLoading && page >= totalPages && catalog.length ? (
          <div className="text-sm text-neutral-500">You have reached the end.</div>
        ) : null}

        {requestedModal ? (
          <div className="fixed inset-0 z-[110]">
            <button className="absolute inset-0 bg-black/70" onClick={() => setRequestedModal(null)} aria-label="Close" />
            <div className="absolute left-1/2 top-1/2 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-neutral-100">{requestedModal.item?.title || 'Requested title'}</div>
                  <p className="mt-2 text-sm text-neutral-300">
                    This title has already been requested and is awaiting download today.
                  </p>
                </div>
                <button
                  onClick={() => setRequestedModal(null)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setRequestedModal(null)}
                  className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500"
                >
                  Close
                </button>
                <button
                  disabled={remindBusy}
                  onClick={sendRemind}
                  className="rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {remindBusy ? 'Saving...' : 'Remind Me'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {selected.length ? (
          <div className="fixed bottom-3 left-3 right-3 z-[105] rounded-2xl border border-neutral-700 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:right-4 sm:w-[min(420px,92vw)]">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-neutral-100">
                Your Requests ({selected.length}/{maxLimit})
              </div>
              <div className="text-xs text-neutral-400">Remaining today: {Math.max(0, Number(quota?.remaining || 0))}</div>
            </div>
            <div className="max-h-44 space-y-1 overflow-auto pr-1">
              {selected.map((item) => (
                <div key={mediaKey(item)} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate text-neutral-100">{item.title || 'Untitled'}</div>
                    <div className="text-neutral-400">
                      {item.mediaType === 'tv' ? 'Series' : 'Movie'}
                      {yearFromDate(item.releaseDate) ? ` • ${yearFromDate(item.releaseDate)}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleSelect(item)}
                    className="rounded-md border border-neutral-700 px-2 py-1 text-neutral-200 hover:border-neutral-500"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              disabled={submitting || !selected.length}
              onClick={submitSelected}
              className="mt-3 w-full rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        ) : null}
      </section>
      <Toasts />
    </Protected>
  );
}
