'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FilterX, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';

import { readJsonSafe } from '../../../lib/readJsonSafe';

function fmtDate(value) {
  const ts = Number(value || 0);
  if (!(ts > 0)) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

function fmtAge(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value < 0) return 'Unknown';
  if (value < 60 * 1000) return 'Just now';
  const minutes = Math.floor(value / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function kpiLabel(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : '0';
}

function toneStyle(tone = 'neutral') {
  const normalized = String(tone || 'neutral').trim().toLowerCase();
  return {
    borderColor: `var(--admin-pill-${normalized}-border)`,
    backgroundColor: `var(--admin-pill-${normalized}-bg)`,
    color: `var(--admin-pill-${normalized}-text)`,
  };
}

function StatusPill({ tone = 'neutral', children }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium" style={toneStyle(tone)}>
      {children}
    </span>
  );
}

function presenceTone(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'both') return 'success';
  if (normalized === 'xui_only') return 'warning';
  if (normalized === 'nas_only') return 'info';
  return 'neutral';
}

function presenceLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'both') return 'XUI + NAS';
  if (normalized === 'xui_only') return 'XUI only';
  if (normalized === 'nas_only') return 'NAS only';
  return 'Unknown';
}

function KpiCard({ label, value, hint = '', actionHint = '', href = '' }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-[var(--admin-muted)]">{label}</div>
        {href ? <ExternalLink size={14} className="mt-0.5 text-[var(--admin-muted)]" /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold">{kpiLabel(value)}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{hint}</div> : null}
      {actionHint ? <div className="mt-1 text-[11px] font-medium text-[var(--admin-text)]">{actionHint}</div> : null}
    </>
  );

  if (!href) {
    return <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">{content}</div>;
  }

  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      prefetch={false}
      title="Open recent deletion logs in a new tab"
      className="block rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 transition hover:bg-black/10"
    >
      {content}
    </Link>
  );
}

function buildDeleteSummary(summary = {}) {
  const requested = Number(summary?.requested || 0) || 0;
  const completed = Number(summary?.completed || 0) || 0;
  const partial = Number(summary?.partial || 0) || 0;
  const failed = Number(summary?.failed || 0) || 0;
  const notFound = Number(summary?.notFound || 0) || 0;
  return `Processed ${requested} title(s) — completed: ${completed}, partial: ${partial}, failed: ${failed}, not found: ${notFound}.`;
}

export default function AdminMediaLibraryPanel({ type = 'movie' }) {
  const resolvedType = String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const isSeries = resolvedType === 'series';
  const itemLabel = isSeries ? 'series' : 'movie';
  const pageTitle = isSeries ? 'Series List' : 'Movie List';
  const logsHref = isSeries ? '/admin/media-library/series/logs' : '/admin/media-library/movies/logs';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [data, setData] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [presence, setPresence] = useState('all');
  const [category, setCategory] = useState('');
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState('title_asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(String(queryInput || '').trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    setPage(1);
  }, [presence, category, genre, sort, pageSize, resolvedType]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams();
      qs.set('type', resolvedType);
      qs.set('q', query);
      qs.set('presence', presence);
      if (!isSeries && category) qs.set('category', category);
      if (genre) qs.set('genre', genre);
      qs.set('sort', sort);
      qs.set('page', String(page));
      qs.set('pageSize', String(pageSize));
      if (refresh) qs.set('refresh', '1');

      const response = await fetch(`/api/admin/media-library?${qs.toString()}`, { cache: 'no-store' });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || `Failed to load ${itemLabel} library.`);
      setData(json);
    } catch (error) {
      setErr(error?.message || `Failed to load ${itemLabel} library.`);
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [resolvedType, query, presence, isSeries, category, genre, sort, page, pageSize, itemLabel]);

  useEffect(() => {
    load({ refresh: false });
  }, [load]);

  useEffect(() => {
    setSelectedIds([]);
  }, [data?.items]);

  useEffect(() => {
    const categories = Array.isArray(data?.filters?.categories) ? data.filters.categories : [];
    if (category && !categories.includes(category)) setCategory('');
  }, [data?.filters?.categories, category]);

  useEffect(() => {
    const genres = Array.isArray(data?.filters?.genres) ? data.filters.genres : [];
    if (genre && !genres.includes(genre)) setGenre('');
  }, [data?.filters?.genres, genre]);

  const visibleIds = useMemo(() => (Array.isArray(data?.items) ? data.items.map((row) => String(row?.id || '')).filter(Boolean) : []), [data?.items]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const anyFilters = Boolean(query || presence !== 'all' || category || genre || sort !== 'title_asc');
  const working = refreshing || deleting;

  const toggleSelectOne = (id) => {
    const resolvedId = String(id || '').trim();
    if (!resolvedId) return;
    setSelectedIds((current) => (current.includes(resolvedId) ? current.filter((value) => value !== resolvedId) : [...current, resolvedId]));
  };

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((value) => !visibleIds.includes(value));
      return [...new Set([...current, ...visibleIds])];
    });
  };

  const runDelete = async (ids) => {
    const targetIds = (Array.isArray(ids) ? ids : []).map((value) => String(value || '').trim()).filter(Boolean);
    if (!targetIds.length) return;

    const label = targetIds.length === 1 ? `Delete this ${itemLabel}?` : `Delete ${targetIds.length} ${isSeries ? 'series' : 'movies'}?`;
    const confirmText = `${label}\n\nThis removes matching entries from XUI and the NAS snapshot/path when available. Missing targets are reported as not existing.`;
    if (typeof window !== 'undefined' && !window.confirm(confirmText)) return;

    setDeleting(true);
    setErr('');
    setOk('');
    try {
      const response = await fetch('/api/admin/media-library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          type: resolvedType,
          ids: targetIds,
        }),
      });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || `Failed to delete ${itemLabel}.`);
      setOk(buildDeleteSummary(json?.summary));
      setSelectedIds([]);
      await load({ refresh: false });
    } catch (error) {
      setErr(error?.message || `Failed to delete ${itemLabel}.`);
    } finally {
      setDeleting(false);
    }
  };

  const clearFilters = () => {
    setQueryInput('');
    setQuery('');
    setPresence('all');
    setCategory('');
    setGenre('');
    setSort('title_asc');
    setPage(1);
    setPageSize(25);
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="flex items-center gap-3 text-sm text-[var(--admin-muted)]">
          <Loader2 size={18} className="animate-spin" />
          Loading {pageTitle.toLowerCase()}…
        </div>
      </div>
    );
  }

  const summary = data?.summary || {};
  const pagination = data?.pagination || {};
  const xuiStatus = data?.sourceStatus?.xui || {};
  const nasStatus = data?.sourceStatus?.nas || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Manage the {isSeries ? 'series' : 'movie'} library across XUI and NAS storage, including direct deletion with per-target result tracking.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load({ refresh: true })}
          disabled={working}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Refresh
        </button>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
      ) : null}
      {ok ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{ok}</div>
      ) : null}

      {!xuiStatus?.available ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          XUI index unavailable. NAS snapshot rows still load. {xuiStatus?.error ? `Reason: ${xuiStatus.error}` : ''}
        </div>
      ) : null}
      {!nasStatus?.available ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          NAS is offline or not writable. Deletion can still remove existing XUI entries, but NAS deletions will be marked unavailable until the mount is back.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="XUI + NAS" value={summary.both} hint="Present in both sources" />
        <KpiCard label="XUI Only" value={summary.xuiOnly} hint="Present only in XUI" />
        <KpiCard label="NAS Only" value={summary.nasOnly} hint="Present only in NAS snapshot" />
        <KpiCard label="Filtered" value={summary.filtered} hint={`Page ${pagination.page || 1} of ${pagination.totalPages || 1}`} />
        <KpiCard
          label="Recent Deletes"
          value={summary.recentDeletes}
          hint="Last 7 days"
          actionHint="Click to open logs in a new tab"
          href={logsHref}
        />
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <label className="flex h-9 w-72 shrink-0 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 text-xs">
            <Search size={14} className="text-[var(--admin-muted)]" />
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={isSeries ? 'Search title / genre / path' : 'Search title / category / genre / path'}
              className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--admin-muted)]"
            />
          </label>

          <select
            value={presence}
            onChange={(event) => setPresence(event.target.value)}
            className="h-9 w-36 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
          >
            <option value="all">All sources</option>
            <option value="both">XUI + NAS</option>
            <option value="xui_only">XUI only</option>
            <option value="nas_only">NAS only</option>
          </select>

          {!isSeries ? (
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-9 w-40 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
            >
              <option value="">All categories</option>
              {(Array.isArray(data?.filters?.categories) ? data.filters.categories : []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}

          <select
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
            className="h-9 w-40 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
          >
            <option value="">All genres</option>
            {(Array.isArray(data?.filters?.genres) ? data.filters.genres : []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="h-9 w-36 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
          >
            <option value="title_asc">Title A–Z</option>
            <option value="title_desc">Title Z–A</option>
            <option value="year_desc">Year newest</option>
            <option value="year_asc">Year oldest</option>
            <option value="presence">Presence</option>
          </select>

          <button
            type="button"
            onClick={clearFilters}
            disabled={!anyFilters || working}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 text-xs font-medium hover:bg-black/10 disabled:opacity-50"
          >
            <FilterX size={14} />
            Clear
          </button>
        </div>

        <div className="mt-2 text-[11px] text-[var(--admin-muted)]">
          XUI rows: {kpiLabel(xuiStatus?.count)} • NAS snapshot rows: {kpiLabel(nasStatus?.count)} • NAS snapshot:{' '}
          {nasStatus?.updatedAt ? `${fmtDate(nasStatus.updatedAt)} (${fmtAge(nasStatus.ageMs)})` : 'never'}
        </div>
      </div>

      {selectedIds.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
          <div className="text-sm">
            <span className="font-medium">{selectedIds.length}</span> {selectedIds.length === 1 ? itemLabel : `${itemLabel}s`} selected on this page.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={working}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => runDelete(selectedIds)}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-60"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete selected
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-3">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Select all rows" />
                </th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">IDs</th>
                <th className="px-3 py-3">Library</th>
                <th className="px-3 py-3">Sources</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(data?.items) ? data.items : []).length ? (
                data.items.map((row) => {
                  const checked = selectedIds.includes(String(row?.id || ''));
                  return (
                    <tr key={row?.id} className="border-t border-[var(--admin-border)] align-top">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={checked} onChange={() => toggleSelectOne(row?.id)} aria-label={`Select ${row?.title}`} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="min-w-[220px]">
                          <div className="font-medium">{row?.title || 'Untitled'}</div>
                          <div className="mt-1 text-xs text-[var(--admin-muted)]">
                            {row?.year || '—'} {row?.tmdbId ? `• TMDb ${row.tmdbId}` : ''} {row?.originalTitle ? `• ${row.originalTitle}` : ''}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <StatusPill tone={presenceTone(row?.presence)}>{presenceLabel(row?.presence)}</StatusPill>
                            {Number(row?.xuiCount || 0) > 1 ? <StatusPill tone="warning">{row.xuiCount} XUI entries</StatusPill> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                        <div>XUI: {Number(row?.xuiCount || 0) ? row.xuiIds.join(', ') : 'Not existing'}</div>
                        <div className="mt-1">TMDb: {row?.tmdbId || '—'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                        {!isSeries ? (
                          <>
                            <div>Category: {row?.category || '—'}</div>
                            <div className="mt-1">Genre: {row?.genre || '—'}</div>
                            <div className="mt-1 break-all">Path: {row?.nasPath || 'Not existing in NAS snapshot'}</div>
                          </>
                        ) : (
                          <>
                            <div>Genre: {row?.genre || '—'}</div>
                            <div className="mt-1">Folder: {row?.folder || '—'}</div>
                            <div className="mt-1 break-all">Path: {row?.nasPath || 'Not existing in NAS snapshot'}</div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <StatusPill tone={Number(row?.xuiCount || 0) > 0 ? 'success' : 'neutral'}>
                            {Number(row?.xuiCount || 0) > 0 ? 'XUI tracked' : 'XUI not existing'}
                          </StatusPill>
                          <StatusPill tone={row?.nasPath ? 'info' : 'neutral'}>{row?.nasPath ? 'NAS tracked' : 'NAS not existing'}</StatusPill>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => runDelete([row?.id])}
                          disabled={working}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                        >
                          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--admin-muted)]">
                    No {isSeries ? 'series' : 'movies'} match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--admin-border)] px-4 py-3 text-sm">
          <div className="text-[var(--admin-muted)]">
            Showing {pagination?.startIndex || 0}-{pagination?.endIndex || 0} of {kpiLabel(pagination?.totalItems)}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value || 25) || 25)}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm outline-none"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={(pagination?.page || 1) <= 1 || working}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 disabled:opacity-50"
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <div className="px-2 text-[var(--admin-muted)]">
              Page {pagination?.page || 1} / {pagination?.totalPages || 1}
            </div>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(Number(pagination?.totalPages || 1) || 1, current + 1))}
              disabled={(pagination?.page || 1) >= (pagination?.totalPages || 1) || working}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 disabled:opacity-50"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
