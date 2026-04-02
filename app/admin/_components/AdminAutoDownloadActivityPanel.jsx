'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

function fmtDate(ts) {
  const n = Number(ts || 0);
  return n > 0 ? new Date(n).toLocaleString() : '—';
}

function resolveUser(row = {}) {
  return row?.username || row?.userId || row?.userIp || '—';
}

function SortIndicator({ active, dir }) {
  if (!active) return <span className="text-[10px] text-[var(--admin-muted)]">↕</span>;
  return dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
}

function TopWatchedCard({ row, rank }) {
  const backdrop = String(row?.backdropImage || row?.image || '').trim();
  const safeBackdrop =
    backdrop && (backdrop.startsWith('http://') || backdrop.startsWith('https://') || backdrop.startsWith('/placeholders/'))
      ? backdrop
      : '';

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
      <div className="relative h-28 overflow-hidden bg-[var(--admin-surface-2)]">
        {safeBackdrop ? (
          <>
            <img src={safeBackdrop} alt={row?.title || 'Backdrop'} className="h-full w-full object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
          </>
        ) : null}
        <div className="absolute left-3 top-3 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-black/70 px-2 text-xs font-semibold text-white">
          #{rank}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3 text-white">
          <div className="truncate text-sm font-semibold">{row?.title || 'Untitled'}</div>
          <div className="mt-1 text-xs text-white/80">
            Users: {row?.viewerCount || 0} • Plays: {row?.playCount || 0}
          </div>
        </div>
      </div>
      <div className="px-3 py-2 text-xs text-[var(--admin-muted)]">Last watched: {fmtDate(row?.lastWatchedAt)}</div>
    </div>
  );
}

const PAGE_SIZE = 15;

export default function AdminAutoDownloadActivityPanel() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [rows, setRows] = useState([]);
  const [topMovies, setTopMovies] = useState([]);
  const [topSeries, setTopSeries] = useState([]);
  const [sortKey, setSortKey] = useState('startedAt');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/autodownload/activity?limit=3000&recentLimit=250', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load activity logs.');
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setTopMovies(Array.isArray(j.topMovies) ? j.topMovies.slice(0, 10) : []);
      setTopSeries(Array.isArray(j.topSeries) ? j.topSeries.slice(0, 10) : []);
    } catch (error) {
      setErr(error?.message || 'Failed to load activity logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const sortedRows = useMemo(() => {
    const next = [...rows];
    next.sort((a, b) => {
      let left;
      let right;
      switch (sortKey) {
        case 'type':
          left = String(a?.type || '').toLowerCase();
          right = String(b?.type || '').toLowerCase();
          break;
        case 'title':
          left = String(a?.title || a?.streamDisplayName || '').toLowerCase();
          right = String(b?.title || b?.streamDisplayName || '').toLowerCase();
          break;
        case 'user':
          left = String(resolveUser(a)).toLowerCase();
          right = String(resolveUser(b)).toLowerCase();
          break;
        case 'endedAt':
          left = Number(a?.endedAt || 0);
          right = Number(b?.endedAt || 0);
          break;
        case 'startedAt':
        default:
          left = Number(a?.startedAt || 0);
          right = Number(b?.startedAt || 0);
          break;
      }

      if (left < right) return sortDir === 'asc' ? -1 : 1;
      if (left > right) return sortDir === 'asc' ? 1 : -1;
      return Number(b?.timestamp || 0) - Number(a?.timestamp || 0);
    });
    return next;
  }, [rows, sortDir, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [page, sortedRows]);

  const onSort = (key) => {
    setPage(1);
    setSortKey((current) => {
      if (current === key) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        return current;
      }
      setSortDir(key === 'type' || key === 'title' || key === 'user' ? 'asc' : 'desc');
      return key;
    });
  };

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">Movie / Series Activity Logs</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Uses XUI One activity logs to estimate recent watch activity and top watched titles for deletion protection.
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Top watched movies</div>
            <div className="text-xs text-[var(--admin-muted)]">Top 10</div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(loading ? [] : topMovies).map((row, index) => (
              <TopWatchedCard key={`movie:${row.xuiId}`} row={row} rank={index + 1} />
            ))}
            {!loading && !topMovies.length ? <div className="text-sm text-[var(--admin-muted)]">No movie watch activity found.</div> : null}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Top watched series</div>
            <div className="text-xs text-[var(--admin-muted)]">Top 10</div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(loading ? [] : topSeries).map((row, index) => (
              <TopWatchedCard key={`series:${row.xuiId}`} row={row} rank={index + 1} />
            ))}
            {!loading && !topSeries.length ? <div className="text-sm text-[var(--admin-muted)]">No series watch activity found.</div> : null}
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--admin-border)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
          <div className="text-sm font-semibold">Recent Activity</div>
          <div className="text-xs text-[var(--admin-muted)]">
            {sortedRows.length ? `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, sortedRows.length)} of ${sortedRows.length}` : '0 rows'}
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm text-[var(--admin-muted)]">Loading…</div>
        ) : sortedRows.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto">
                <thead className="bg-[var(--admin-surface-2)] text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                  <tr>
                    {[
                      ['type', 'Type'],
                      ['title', 'Title'],
                      ['user', 'User'],
                      ['startedAt', 'Started'],
                      ['endedAt', 'Ended'],
                    ].map(([key, label]) => (
                      <th key={key} className="px-4 py-3 text-left">
                        <button
                          type="button"
                          onClick={() => onSort(key)}
                          className="inline-flex items-center gap-1 text-left hover:text-[var(--admin-text)]"
                        >
                          <span>{label}</span>
                          <SortIndicator active={sortKey === key} dir={sortDir} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, index) => (
                    <tr
                      key={`${row.type}:${row.xuiId}:${row.timestamp}:${index}`}
                      className="border-t border-[var(--admin-border)] text-sm hover:bg-[var(--admin-surface-2)]/60"
                    >
                      <td className="px-4 py-3 capitalize">{row?.type || 'movie'}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-[28rem] truncate">{row?.title || row?.streamDisplayName || 'Untitled'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[12rem] truncate">{resolveUser(row)}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDate(row?.startedAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDate(row?.endedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
              <div className="text-xs text-[var(--admin-muted)]">Sorted by {sortKey} ({sortDir})</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <div className="text-sm text-[var(--admin-muted)]">
                  Page {page} of {totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page >= totalPages}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-4 py-6 text-sm text-[var(--admin-muted)]">No movie or series activity rows found.</div>
        )}
      </div>
    </div>
  );
}
