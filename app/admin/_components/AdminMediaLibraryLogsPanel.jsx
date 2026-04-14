'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';

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

function resultTone(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'completed') return 'success';
  if (normalized === 'partial') return 'warning';
  if (normalized === 'failed') return 'danger';
  if (normalized === 'not_found') return 'neutral';
  return 'neutral';
}

function resultLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'completed') return 'Completed';
  if (normalized === 'partial') return 'Partial';
  if (normalized === 'failed') return 'Failed';
  if (normalized === 'not_found') return 'Not found';
  return value || 'Unknown';
}

function targetTone(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'deleted') return 'success';
  if (normalized === 'missing') return 'neutral';
  if (normalized === 'unavailable') return 'warning';
  if (normalized === 'partial') return 'warning';
  if (normalized === 'failed') return 'danger';
  return 'neutral';
}

function targetLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'deleted') return 'Deleted';
  if (normalized === 'missing') return 'Not existing';
  if (normalized === 'unavailable') return 'Unavailable';
  if (normalized === 'partial') return 'Partial';
  if (normalized === 'failed') return 'Failed';
  return value || 'Unknown';
}

export default function AdminMediaLibraryLogsPanel({ type = 'movie' }) {
  const resolvedType = String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const isSeries = resolvedType === 'series';
  const title = isSeries ? 'Series Recent Deletion Logs' : 'Movie Recent Deletion Logs';
  const backHref = isSeries ? '/admin/media-library/series' : '/admin/media-library/movies';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState(null);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams();
      qs.set('type', resolvedType);
      qs.set('view', 'logs');
      qs.set('limit', '100');
      const response = await fetch(`/api/admin/media-library?${qs.toString()}`, { cache: 'no-store' });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load deletion logs.');
      setData(json);
    } catch (error) {
      setErr(error?.message || 'Failed to load deletion logs.');
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [resolvedType]);

  useEffect(() => {
    load({ refresh: false });
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="flex items-center gap-3 text-sm text-[var(--admin-muted)]">
          <Loader2 size={18} className="animate-spin" />
          Loading deletion logs…
        </div>
      </div>
    );
  }

  const logs = data?.logs || { items: [], summary: {} };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Recent admin-triggered deletion results for the {isSeries ? 'series' : 'movie'} Media Library.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
          >
            <ArrowLeft size={16} />
            Back to {isSeries ? 'Series List' : 'Movie List'}
          </Link>
          <button
            type="button"
            onClick={() => load({ refresh: true })}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <StatusPill tone="neutral">Total {logs?.summary?.total || 0}</StatusPill>
        <StatusPill tone="neutral">Last 7 days {logs?.summary?.last7d || 0}</StatusPill>
        <StatusPill tone="success">Completed {logs?.summary?.completed || 0}</StatusPill>
        <StatusPill tone="warning">Partial {logs?.summary?.partial || 0}</StatusPill>
        <StatusPill tone="danger">Failed {logs?.summary?.failed || 0}</StatusPill>
        <StatusPill tone="neutral">Not found {logs?.summary?.notFound || 0}</StatusPill>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="overflow-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-3">When</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">Result</th>
                <th className="px-3 py-3">XUI</th>
                <th className="px-3 py-3">NAS</th>
                <th className="px-3 py-3">By</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(logs?.items) ? logs.items : []).length ? (
                logs.items.map((log) => (
                  <tr key={log?.id} className="border-t border-[var(--admin-border)] align-top">
                    <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">{fmtDate(log?.createdAt)}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{log?.title || 'Untitled'}</div>
                      <div className="mt-1 text-xs text-[var(--admin-muted)]">
                        {log?.year || '—'} {log?.tmdbId ? `• TMDb ${log.tmdbId}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={resultTone(log?.status)}>{resultLabel(log?.status)}</StatusPill>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <StatusPill tone={targetTone(log?.xui?.status)}>{targetLabel(log?.xui?.status)}</StatusPill>
                      </div>
                      {Number(log?.xui?.ids?.length || 0) ? (
                        <div className="mt-1 text-xs text-[var(--admin-muted)]">IDs: {log.xui.ids.join(', ')}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={targetTone(log?.nas?.status)}>{targetLabel(log?.nas?.status)}</StatusPill>
                      {log?.nas?.path ? <div className="mt-1 break-all text-xs text-[var(--admin-muted)]">{log.nas.path}</div> : null}
                      {log?.nas?.error ? <div className="mt-1 text-xs text-red-300">{log.nas.error}</div> : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">{log?.createdBy || 'admin'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--admin-muted)]">
                    No deletion logs yet for this list.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
