'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import EditModal from './EditModal';
import NotesButton from './NotesButton';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function Tag({ className = '', children }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-0.5 text-[10px] font-medium leading-none text-[var(--admin-muted)]',
        className
      )}
    >
      {children}
    </span>
  );
}

function Badge({ tone = 'neutral', className = '', children }) {
  const t = String(tone || 'neutral').trim().toLowerCase();
  const toneClass =
    t === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : t === 'danger' || t === 'fail'
        ? 'border-red-500/30 bg-red-500/10 text-red-200'
        : t === 'warning'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
          : 'border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text)]';

  return (
    <span className={cx('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none', toneClass, className)}>
      {children}
    </span>
  );
}

function fmtDate(ts) {
  const n = Number(ts || 0);
  if (!n) return '—';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '—';
  }
}

function fmtMs(ms) {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n)} ms`;
}

function fmtRate(rate) {
  const n = Number(rate || 0);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

function fmtCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat().format(n);
}

function fmtBackoff(ms) {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const sec = Math.ceil(n / 1000);
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min > 0) return `${min}m ${String(rem).padStart(2, '0')}s`;
  return `${rem}s`;
}

function statusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'healthy') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (s === 'degraded') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (s === 'blocked') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (s === 'disabled') return 'border-neutral-600 bg-neutral-800/50 text-neutral-200';
  return 'border-neutral-600 bg-neutral-800/50 text-neutral-200';
}

function normalizeDomainsText(input) {
  return String(input || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join('\n');
}

function shortId(value) {
  const str = String(value || '').trim();
  if (!str) return '—';
  if (str.length <= 18) return str;
  return `${str.slice(0, 8)}…${str.slice(-8)}`;
}

function summarizeLogGroup(group) {
  const rows = Array.isArray(group?.rows) ? group.rows : [];
  let successCount = 0;
  let failCount = 0;
  let backoffCount = 0;
  let blockedCount = 0;
  let totalResults = 0;
  let durationTotal = 0;
  let durationSamples = 0;
  let firstTimestamp = 0;
  let latestTimestamp = 0;
  const providers = new Set();

  for (const row of rows) {
    const ts = Number(row?.timestamp || 0) || 0;
    if (!firstTimestamp || (ts && ts < firstTimestamp)) firstTimestamp = ts;
    if (ts > latestTimestamp) latestTimestamp = ts;

    if (row?.success === true) successCount += 1;
    if (row?.success === false) failCount += 1;

    if (String(row?.action || '').toLowerCase() === 'backoff') backoffCount += 1;
    if (String(row?.errorCategory || '').toUpperCase() === 'BLOCKED') blockedCount += 1;

    const count = Number(row?.resultsCount);
    if (Number.isFinite(count) && count > 0) totalResults += count;

    const duration = Number(row?.durationMs);
    if (Number.isFinite(duration) && duration > 0) {
      durationTotal += duration;
      durationSamples += 1;
    }

    const provider = String(row?.providerId || '').trim().toUpperCase();
    if (provider) providers.add(provider);
  }

  const totalEntries = rows.length;
  const avgDurationMs = durationSamples ? durationTotal / durationSamples : 0;
  const tone = failCount === 0 ? 'healthy' : successCount > 0 ? 'mixed' : 'failing';

  return {
    ...group,
    providers: [...providers],
    totalEntries,
    successCount,
    failCount,
    backoffCount,
    blockedCount,
    totalResults,
    avgDurationMs,
    firstTimestamp,
    latestTimestamp,
    tone,
  };
}

function summaryToneClass(tone) {
  if (tone === 'healthy') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (tone === 'mixed') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-red-500/30 bg-red-500/10 text-red-200';
}

function LogDetailsModal({ row, onClose }) {
  if (!row) return null;
  const details = row?.detailsJson && typeof row.detailsJson === 'object' ? row.detailsJson : {};
  const selectionLogId = String(row?.selectionLogId || '').trim();
  const query = String(row?.query || details?.query || '').trim();

  return (
    <div className="fixed inset-0 z-[95]">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="absolute left-1/2 top-1/2 w-[min(980px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
        <div className="border-b border-[var(--admin-border)] p-4">
          <div className="text-lg font-semibold">Provider Log Details</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">{fmtDate(row.timestamp)} · {String(row.providerId || '').toUpperCase()} · {row.action}</div>
        </div>

        <div className="max-h-[70vh] overflow-auto space-y-4 p-4 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Message</div>
            <div className="mt-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">{row.message || '—'}</div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Selection Log</div>
            <div className="mt-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 font-mono text-xs break-all">
              {selectionLogId || '—'}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Query</div>
            <div className="mt-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 font-mono text-xs break-all">
              {query || '—'}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Raw URL</div>
            <div className="mt-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 font-mono text-xs break-all">
              {details.requestUrl || '—'}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Sanitized Response Snippet</div>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
              {details.responseSnippet || '—'}
            </pre>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Attempted Domains</div>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
              {Array.isArray(details.attempted_domains) && details.attempted_domains.length ? details.attempted_domains.join('\n') : '—'}
            </pre>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Per Attempt Outcomes</div>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
              {Array.isArray(details.per_attempt_outcomes) && details.per_attempt_outcomes.length
                ? JSON.stringify(details.per_attempt_outcomes, null, 2)
                : '—'}
            </pre>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Stack / Trace</div>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
              {details.stack || '—'}
            </pre>
          </div>
        </div>

        <div className="flex justify-end border-t border-[var(--admin-border)] p-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminAutoDownloadSourcesPanel({ type = 'movie' } = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mediaType = String(type || 'movie').toLowerCase() === 'series' ? 'series' : 'movie';
  const selectionLogIdFilter = String(searchParams?.get('selectionLogId') || '').trim();
  const detailMode = Boolean(selectionLogIdFilter);
  const [providers, setProviders] = useState([]);
  const [summary, setSummary] = useState({});
  const [logs, setLogs] = useState([]);
  const [logsTotalCount, setLogsTotalCount] = useState(0);
  const [selectionLogSummary, setSelectionLogSummary] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [tab, setTab] = useState('recent');
  const [providerFilter, setProviderFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [range, setRange] = useState('24h');
  const [statusFilter, setStatusFilter] = useState('all');
  const [errorFilter, setErrorFilter] = useState('all');

  const pageSizeOptions = useMemo(() => [20, 50, 100, 200, 500, 1000], []);
  const detailPageSizeRaw = Number(searchParams?.get('pageSize') || 0) || 0;
  const detailPageSize = detailMode && pageSizeOptions.includes(detailPageSizeRaw) ? detailPageSizeRaw : 100;
  const detailPageRaw = Number(searchParams?.get('page') || 0) || 0;
  const detailPage = detailMode && Number.isFinite(detailPageRaw) && detailPageRaw > 0 ? Math.floor(detailPageRaw) : 1;
  const detailOffset = Math.max(0, (detailPage - 1) * detailPageSize);

  const updateQuery = useCallback(
    (patch) => {
      if (!detailMode) return;
      const next = new URLSearchParams(searchParams ? searchParams.toString() : '');
      for (const [k, v] of Object.entries(patch || {})) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      router.replace(`${pathname}?${next.toString()}`);
    },
    [detailMode, pathname, router, searchParams]
  );

  const [editOpen, setEditOpen] = useState(false);
  const [editProviderId, setEditProviderId] = useState('');
  const [editForm, setEditForm] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(null);

  const providersSorted = useMemo(
    () => [...providers].sort((a, b) => Number(a?.priority || 0) - Number(b?.priority || 0)),
    [providers]
  );

  const allDomainOptions = useMemo(() => {
    const set = new Set();
    for (const p of providersSorted) {
      const rows = Array.isArray(p?.domainHealth) ? p.domainHealth : [];
      for (const row of rows) {
        const d = String(row?.domain || '').trim();
        if (d) set.add(d);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [providersSorted]);

  const logGroups = useMemo(() => {
    const grouped = new Map();
    for (const row of Array.isArray(logs) ? logs : []) {
      const selectionLogId = String(row?.selectionLogId || '').trim();
      const fallbackKey = `${String(row?.correlationId || '').trim()}:${String(row?.jobId || '').trim()}:${String(row?.providerId || '').trim()}`;
      const groupKey = selectionLogId || fallbackKey || `unlinked:${String(row?.id || '').trim()}`;
      const current = grouped.get(groupKey) || {
        key: groupKey,
        selectionLogId,
        latestTimestamp: 0,
        query: '',
        rows: [],
      };
      current.rows.push(row);
      current.latestTimestamp = Math.max(current.latestTimestamp, Number(row?.timestamp || 0) || 0);
      if (!current.query) current.query = String(row?.query || '').trim();
      grouped.set(groupKey, current);
    }

    return [...grouped.values()]
      .sort((a, b) => Number(b?.latestTimestamp || 0) - Number(a?.latestTimestamp || 0))
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0)),
      }));
  }, [logs]);

  const selectionLogGroups = useMemo(
    () => logGroups.filter((group) => group.selectionLogId).map((group) => summarizeLogGroup(group)),
    [logGroups]
  );

  const unlinkedLogCount = useMemo(
    () =>
      logGroups
        .filter((group) => !group.selectionLogId)
        .reduce((sum, group) => sum + (Array.isArray(group?.rows) ? group.rows.length : 0), 0),
    [logGroups]
  );

  const groupedLogSummary = useMemo(() => {
    const providersUsed = new Set();
    let totalEntries = 0;
    let successCount = 0;
    let failCount = 0;
    let backoffCount = 0;

    for (const group of selectionLogGroups) {
      totalEntries += Number(group?.totalEntries || 0);
      successCount += Number(group?.successCount || 0);
      failCount += Number(group?.failCount || 0);
      backoffCount += Number(group?.backoffCount || 0);
      for (const provider of Array.isArray(group?.providers) ? group.providers : []) providersUsed.add(provider);
    }

    return {
      selectionLogCount: selectionLogGroups.length,
      totalEntries,
      successCount,
      failCount,
      backoffCount,
      providersUsed: providersUsed.size,
    };
  }, [selectionLogGroups]);

  const detailTotalPages = useMemo(() => {
    if (!detailMode) return 1;
    const total = Number(logsTotalCount || 0) || 0;
    const size = Math.max(1, Number(detailPageSize || 100) || 100);
    return Math.max(1, Math.ceil(total / size));
  }, [detailMode, detailPageSize, logsTotalCount]);

  const detailShowing = useMemo(() => {
    if (!detailMode) return { from: 0, to: 0 };
    if (!logsTotalCount) return { from: 0, to: 0 };
    const from = Math.min(logsTotalCount, detailOffset + 1);
    const to = Math.min(logsTotalCount, detailOffset + (Array.isArray(logs) ? logs.length : 0));
    return { from, to };
  }, [detailMode, detailOffset, logs, logsTotalCount]);

  const buildSelectionLogHref = useCallback(
    (selectionLogId) => {
      const q = new URLSearchParams();
      q.set('selectionLogId', String(selectionLogId || '').trim());
      q.set('page', '1');
      q.set('pageSize', '100');
      return `?${q.toString()}`;
    },
    []
  );

  const loadSources = useCallback(async () => {
    const q = new URLSearchParams({ type: mediaType });
    const r = await fetch(`/api/admin/autodownload/sources?${q.toString()}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load sources.');
    setProviders(Array.isArray(j.providers) ? j.providers : []);
    setSummary(j.summary || {});
    return j;
  }, [mediaType]);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const q = new URLSearchParams({
        type: mediaType,
        provider: providerFilter,
        selectionLogId: selectionLogIdFilter,
        domain: domainFilter,
        range,
        status: statusFilter,
        errorCategory: errorFilter,
        view: tab,
        limit: detailMode ? String(detailPageSize) : '800',
      });
      if (detailMode) q.set('offset', String(detailOffset));
      const r = await fetch(`/api/admin/autodownload/sources/logs?${q.toString()}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load logs.');
      setLogs(Array.isArray(j.logs) ? j.logs : []);
      setProviders(Array.isArray(j.providers) ? j.providers : []);
      setLogsTotalCount(Number(j.totalCount || 0) || 0);
      setSelectionLogSummary(j.selectionLogSummary && typeof j.selectionLogSummary === 'object' ? j.selectionLogSummary : null);
    } catch (e) {
      setErr(e?.message || 'Failed to load logs.');
    } finally {
      setLoadingLogs(false);
    }
  }, [
    mediaType,
    providerFilter,
    selectionLogIdFilter,
    domainFilter,
    range,
    statusFilter,
    errorFilter,
    tab,
    detailMode,
    detailOffset,
    detailPageSize,
  ]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (detailMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr('');
    loadSources()
      .catch((e) => setErr(e?.message || 'Failed to load Download Sources.'))
      .finally(() => setLoading(false));
  }, [detailMode, loadSources]);

  useEffect(() => {
    if (!detailMode) return;
    if (!logsTotalCount) return;
    if (detailOffset < logsTotalCount) return;
    const lastPage = Math.max(1, Math.ceil(logsTotalCount / Math.max(1, detailPageSize)));
    if (detailPage > lastPage) updateQuery({ page: String(lastPage) });
  }, [detailMode, detailOffset, detailPage, detailPageSize, logsTotalCount, updateQuery]);

  const refreshAll = useCallback(async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      if (!detailMode) await loadSources();
      await loadLogs();
      setOk('Refreshed.');
    } catch (e) {
      setErr(e?.message || 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  }, [detailMode, loadLogs, loadSources]);

  const patchProvider = async (providerId, patch, successMsg = 'Updated.') => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/sources', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, patch, type: mediaType }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Update failed.');
      setProviders(Array.isArray(j.providers) ? j.providers : []);
      setSummary(j.summary || {});
      setOk(successMsg);
    } catch (e) {
      setErr(e?.message || 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const reorderProvider = async (providerId, dir) => {
    const sorted = [...providersSorted];
    const idx = sorted.findIndex((p) => p.id === providerId);
    if (idx < 0) return;
    const nextIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= sorted.length) return;

    const tmp = sorted[idx];
    sorted[idx] = sorted[nextIdx];
    sorted[nextIdx] = tmp;

    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/sources', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order: sorted.map((x) => x.id), type: mediaType }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Reorder failed.');
      setProviders(Array.isArray(j.providers) ? j.providers : []);
      setSummary(j.summary || {});
      setOk('Priority order updated.');
    } catch (e) {
      setErr(e?.message || 'Reorder failed.');
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async (providerId, force = false, onlyDomain = '') => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch(`/api/admin/autodownload/sources/${encodeURIComponent(providerId)}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force, onlyDomain, type: mediaType }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Provider test failed.');
      await Promise.all([loadSources(), loadLogs()]);
      if (j?.skipped) setOk(`Skipped: ${j?.reason || 'backoff'}.`);
      else setOk('Provider test completed.');
    } catch (e) {
      setErr(e?.message || 'Provider test failed.');
    } finally {
      setBusy(false);
    }
  };

  const testAll = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/sources/test-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: mediaType }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Test all failed.');
      await Promise.all([loadSources(), loadLogs()]);
      setOk('Test all completed.');
    } catch (e) {
      setErr(e?.message || 'Test all failed.');
    } finally {
      setBusy(false);
    }
  };

  const validateProvider = async (providerId, domain = '') => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch(`/api/admin/autodownload/sources/${encodeURIComponent(providerId)}/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain, type: mediaType }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Validation failed.');
      await Promise.all([loadSources(), loadLogs()]);
      const rows = Array.isArray(j.results) ? j.results : [];
      const okCount = rows.filter((x) => x?.ok).length;
      setOk(domain ? `Validated ${domain} (${okCount}/${rows.length} successful).` : `Validated domains (${okCount}/${rows.length} successful).`);
    } catch (e) {
      setErr(e?.message || 'Validation failed.');
    } finally {
      setBusy(false);
    }
  };

  const clearLogs = async () => {
    const target = detailMode
      ? `selection log ${selectionLogIdFilter}`
      : providerFilter === 'all'
        ? 'all providers'
        : `${String(providerFilter).toUpperCase()} provider`;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Clear logs for ${target}? This cannot be undone.`);
      if (!confirmed) return;
    }

    setBusy(true);
    setErr('');
    setOk('');
    try {
      const q = new URLSearchParams({ provider: providerFilter || 'all', type: mediaType });
      if (selectionLogIdFilter) q.set('selectionLogId', selectionLogIdFilter);
      const r = await fetch(`/api/admin/autodownload/sources/logs?${q.toString()}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to clear logs.');

      setProviders(Array.isArray(j.providers) ? j.providers : []);
      setSummary(j.summary || {});
      await loadLogs();

      const deleted = Number(j.deletedCount || 0);
      if (detailMode) {
        setOk(deleted === 1 ? 'Cleared 1 provider log entry for this selection log.' : `Cleared ${deleted} provider log entries for this selection log.`);
      } else {
        setOk(deleted === 1 ? 'Cleared 1 log entry.' : `Cleared ${deleted} log entries.`);
      }
    } catch (e) {
      setErr(e?.message || 'Failed to clear logs.');
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (provider) => {
    const domainRows = Array.isArray(provider?.domainHealth) ? provider.domainHealth : [];
    const domainText = domainRows.length
      ? domainRows.map((x) => String(x?.domain || '').trim()).filter(Boolean).join('\n')
      : Array.isArray(provider?.config?.domains)
      ? provider.config.domains.join('\n')
      : '';

    setEditProviderId(provider.id);
    setEditForm({
      enabled: Boolean(provider.enabled),
      stopOnFirstValid: provider.stopOnFirstValid !== false,
      maxAttemptsPerTitle: Number(provider.maxAttemptsPerTitle || 2),
      backoffMinutesOnError: Number(provider.backoffMinutesOnError || 30),
      failureThresholdBlocked: Number(provider.failureThresholdBlocked || 3),
      testQuery: String(provider.testQuery || ''),
      resetBackoff: false,
      domainsText: domainText,
      ytsApiBasePath: String(provider?.config?.apiBasePath || '/api/v2/'),
      ytsEndpoint: String(provider?.config?.endpoint || 'list_movies.json'),
      tpbSearchPathTemplate: String(provider?.config?.searchPathTemplate || '/search/{query}/1/99/201'),
      genericEndpoint: String(provider?.config?.endpoint || ''),
      genericApiKey: String(provider?.config?.apiKey || ''),
      eztvEndpoint: String(provider?.config?.endpoint || '/api/get-torrents'),
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const provider = providersSorted.find((x) => x.id === editProviderId);
    if (!provider || !editForm) return;

    const patch = {
      enabled: Boolean(editForm.enabled),
      stopOnFirstValid: Boolean(editForm.stopOnFirstValid),
      maxAttemptsPerTitle: Number(editForm.maxAttemptsPerTitle),
      backoffMinutesOnError: Number(editForm.backoffMinutesOnError),
      failureThresholdBlocked: Number(editForm.failureThresholdBlocked),
      testQuery: String(editForm.testQuery || ''),
      resetBackoff: Boolean(editForm.resetBackoff),
      config:
        provider.key === 'yts'
          ? {
              domains: normalizeDomainsText(editForm.domainsText).split(/\r?\n/).filter(Boolean),
              apiBasePath: String(editForm.ytsApiBasePath || '/api/v2/'),
              endpoint: String(editForm.ytsEndpoint || ''),
            }
            : provider.key === 'tpb'
              ? {
                  domains: normalizeDomainsText(editForm.domainsText).split(/\r?\n/).filter(Boolean),
                  searchPathTemplate: String(editForm.tpbSearchPathTemplate || '/search/{query}/1/99/201'),
                }
              : provider.key === 'jackett' || provider.key === 'prowlarr'
                ? {
                    domains: normalizeDomainsText(editForm.domainsText).split(/\r?\n/).filter(Boolean),
                    endpoint: String(editForm.genericEndpoint || ''),
                    apiKey: String(editForm.genericApiKey || ''),
                  }
              : provider.key === 'eztv'
                ? {
                    domains: normalizeDomainsText(editForm.domainsText).split(/\r?\n/).filter(Boolean),
                    endpoint: String(editForm.eztvEndpoint || '/api/get-torrents'),
                  }
              : {
                  domains: normalizeDomainsText(editForm.domainsText).split(/\r?\n/).filter(Boolean),
                },
    };

    await patchProvider(provider.id, patch, `${String(provider.displayName || provider.id).trim()} updated.`);
    setEditOpen(false);
  };

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Manages torrent provider adapters (YTS/TPB/Jackett/Prowlarr/EZTV) with health status, tests, backoff, and logs.',
        'No anti-bot bypass is implemented. Blocked/challenge responses are recorded and backoff is applied.',
      ],
    },
    {
      title: 'Status badges',
      items: [
        'Healthy: tests/searches succeed with low failure rate.',
        'Degraded: intermittent failures or consistent empty results.',
        'Blocked: repeated block/network failures crossed threshold or active backoff.',
      ],
    },
    {
      title: 'TPB domain rotation',
      items: [
        'On network/timeout failures, TPB rotates to the next configured domain for the next attempt.',
        'If all configured domains fail in a rotation cycle, provider is marked Blocked and enters backoff.',
      ],
    },
  ];
  const editingProvider = providersSorted.find((x) => x.id === editProviderId) || null;

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">
            {detailMode ? `Selection Log ${shortId(selectionLogIdFilter)}` : mediaType === 'series' ? 'Series Download Sources' : 'Movie Download Sources'}
          </div>
          {detailMode ? (
            <div className="mt-1 text-sm text-[var(--admin-muted)]">
              {selectionLogSummary
                ? `Latest activity ${fmtDate(selectionLogSummary.latestTimestamp)} · Window ${fmtDate(selectionLogSummary.firstTimestamp)} to ${fmtDate(
                    selectionLogSummary.latestTimestamp
                  )}`
                : 'Latest activity — · Window —'}
            </div>
          ) : (
            <div className="mt-1 text-sm text-[var(--admin-muted)]">
              Provider health, test controls, backoff policies, and recent provider activity.
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!detailMode ? <NotesButton title="Download Sources — Notes" sections={notes} /> : null}
          {!detailMode ? (
            <button
              type="button"
              disabled
              title="Coming soon"
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm opacity-70"
            >
              Add provider (Coming soon)
            </button>
          ) : null}
          {!detailMode ? (
            <button
              onClick={testAll}
              disabled={loading || busy}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {busy ? 'Working…' : 'Test all'}
            </button>
          ) : null}
          {!detailMode ? (
            <button
              onClick={refreshAll}
              disabled={loading || busy}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {busy ? 'Working…' : 'Refresh'}
            </button>
          ) : null}
        </div>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}

      {!detailMode ? (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Healthy', summary.healthy, 'text-emerald-200'],
              ['Degraded', summary.degraded, 'text-amber-200'],
              ['Blocked', summary.blocked, 'text-red-200'],
              ['Disabled', summary.disabled, 'text-neutral-200'],
              ['Unknown', summary.unknown, 'text-neutral-300'],
            ].map(([label, count, cls]) => (
              <div key={label} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs text-[var(--admin-muted)]">{label}</div>
                <div className={cx('mt-1 text-lg font-semibold', cls)}>{Number(count || 0)}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {providersSorted.map((p) => (
              <div key={p.id} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">{p.displayName}</div>
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">Priority {p.priority}</div>
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Active base: <span className="font-medium text-[var(--admin-text)]">{p.activeBase || '—'}</span>
                    </div>
                    {p.primaryUnreachableRotated ? (
                      <div className="mt-1 text-[11px] text-amber-300">Primary unreachable; rotated</div>
                    ) : null}
                  </div>
                  <span className={cx('inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium', statusClass(p.status))}>
                    {String(p.status || 'unknown').charAt(0).toUpperCase() + String(p.status || 'unknown').slice(1)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
                    <div className="text-[var(--admin-muted)]">Last checked</div>
                    <div className="mt-1">{fmtDate(p.lastCheckedAt)}</div>
                  </div>
                  <div className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
                    <div className="text-[var(--admin-muted)]">Last success</div>
                    <div className="mt-1">{fmtDate(p.lastSuccessAt)}</div>
                  </div>
                  <div className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
                    <div className="text-[var(--admin-muted)]">Failures (24h)</div>
                    <div className="mt-1 font-semibold">{Number(p.failureCount24h || 0)}</div>
                  </div>
                  <div className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
                    <div className="text-[var(--admin-muted)]">Fail rate (1h)</div>
                    <div className="mt-1 font-semibold">{fmtRate(p.failRate1h)}</div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-[var(--admin-muted)]">
                  Backoff remaining: <span className="font-medium text-[var(--admin-text)]">{fmtBackoff(p.backoffRemainingMs)}</span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-[var(--admin-muted)]">
                    <input
                      type="checkbox"
                      checked={Boolean(p.enabled)}
                      disabled={busy}
                      onChange={(e) => patchProvider(p.id, { enabled: e.target.checked }, `${p.displayName} ${e.target.checked ? 'enabled' : 'disabled'}.`)}
                    />
                    Enabled
                  </label>

                  <button
                    type="button"
                    onClick={() => testProvider(p.id)}
                    disabled={busy}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs hover:bg-black/10 disabled:opacity-60"
                  >
                    Test
                  </button>

                  <button
                    type="button"
                    onClick={() => testProvider(p.id, false, p.activeDomain || '')}
                    disabled={busy || !p.activeDomain}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs hover:bg-black/10 disabled:opacity-60"
                  >
                    Test active
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProviderFilter(p.id);
                      setDomainFilter('all');
                      setTab('recent');
                      const el = document.getElementById('source-log-viewer');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs hover:bg-black/10"
                  >
                    View logs
                  </button>

                  <button
                    type="button"
                    onClick={() => patchProvider(p.id, { enabled: false }, `${p.displayName} disabled.`)}
                    disabled={busy || !p.enabled}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200 hover:bg-red-500/15 disabled:opacity-60"
                  >
                    Disable
                  </button>

                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs hover:bg-black/10"
                  >
                    Configure
                  </button>
                </div>

                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => reorderProvider(p.id, 'up')}
                    disabled={busy || p.priority <= 1}
                    className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => reorderProvider(p.id, 'down')}
                    disabled={busy || p.priority >= providersSorted.length}
                    className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Move down
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div id="source-log-viewer" className="mt-6 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        {!detailMode ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Provider Logs by Selection Log</div>
                <div className="mt-1 text-xs text-[var(--admin-muted)]">
                  Selection-log summaries with KPIs, plus a dedicated drill-in view for row-level provider logs.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-1">
                  {[
                    ['recent', 'Recent Activity'],
                    ['errors', 'Errors & Blocks'],
                    ['backoff', 'Backoff Events'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cx(
                        'rounded-md px-2 py-1 text-xs',
                        tab === id ? 'bg-primary/15 text-primary' : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)]'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-7">
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
              >
                <option value="all">Provider: All</option>
                {providersSorted.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>

              <select
                value={range}
                onChange={(e) => setRange(e.target.value)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
              >
                <option value="24h">Range: Last 24h</option>
                <option value="7d">Range: Last 7d</option>
              </select>

              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
              >
                <option value="all">Domain: All</option>
                {allDomainOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
              >
                <option value="all">Result: All</option>
                <option value="success">Result: Success</option>
                <option value="fail">Result: Fail</option>
              </select>

              <select
                value={errorFilter}
                onChange={(e) => setErrorFilter(e.target.value)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
              >
                <option value="all">Error: All</option>
                <option value="NETWORK">NETWORK</option>
                <option value="DNS">DNS</option>
                <option value="HTTP">HTTP</option>
                <option value="AUTH">AUTH</option>
                <option value="BLOCKED">BLOCKED</option>
                <option value="PARSE">PARSE</option>
                <option value="TIMEOUT">TIMEOUT</option>
              </select>

              <button
                type="button"
                onClick={loadLogs}
                disabled={loadingLogs || busy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs hover:bg-black/10 disabled:opacity-60"
              >
                {loadingLogs ? 'Loading…' : 'Reload logs'}
              </button>

              <button
                type="button"
                onClick={clearLogs}
                disabled={loadingLogs || busy}
                title={providerFilter === 'all' ? 'Clear logs for all providers' : `Clear logs for ${String(providerFilter).toUpperCase()}`}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 hover:bg-red-500/15 disabled:opacity-60"
              >
                Clear logs
              </button>
            </div>
          </>
        ) : null}

        {detailMode ? (
          <>
            <div className="mt-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">Selection Log {shortId(selectionLogIdFilter)}</div>
                  <div className="mt-1 text-xs text-[var(--admin-muted)]">
                    {selectionLogSummary
                      ? `Latest activity ${fmtDate(selectionLogSummary.latestTimestamp)} · Window ${fmtDate(selectionLogSummary.firstTimestamp)} to ${fmtDate(
                          selectionLogSummary.latestTimestamp
                        )}`
                      : 'Latest activity — · Window —'}
                  </div>
                  {selectionLogSummary?.query ? (
                    <div className="mt-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 font-mono text-[11px] break-all">
                      {selectionLogSummary.query}
                    </div>
                  ) : null}
                  <div className="mt-2 font-mono text-[11px] text-[var(--admin-muted)] break-all">{selectionLogIdFilter}</div>
                </div>

                {selectionLogSummary ? (
                  <span
                    className={cx(
                      'inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium',
                      summaryToneClass(
                        selectionLogSummary.failCount === 0
                          ? 'healthy'
                          : selectionLogSummary.successCount > 0
                            ? 'mixed'
                            : 'failing'
                      )
                    )}
                  >
                    {selectionLogSummary.failCount === 0 ? 'Healthy' : selectionLogSummary.successCount > 0 ? 'Mixed' : 'Failing'}
                  </span>
                ) : null}
              </div>

              {selectionLogSummary ? (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {[
                      ['Entries', fmtCount(selectionLogSummary.totalEntries), 'neutral'],
                      ['Providers', fmtCount(selectionLogSummary.providers.length), 'neutral'],
                      ['Success', fmtCount(selectionLogSummary.successCount), 'success'],
                      ['Failures', fmtCount(selectionLogSummary.failCount), 'fail'],
                      ['Results', fmtCount(selectionLogSummary.totalResults), 'neutral'],
                      ['Avg Duration', fmtMs(selectionLogSummary.avgDurationMs), 'neutral'],
                    ].map(([label, value, kind]) => (
                      <Badge key={label} tone={kind}>
                        <span className={kind === 'neutral' ? 'text-[var(--admin-muted)]' : ''}>{label}</span>
                        <span className="ml-1 font-semibold">{value}</span>
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {selectionLogSummary.providers.map((provider) => (
                      <span
                        key={provider}
                        className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-[11px] font-medium"
                      >
                        {provider}
                      </span>
                    ))}
                    {selectionLogSummary.backoffCount ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                        Backoff events: {fmtCount(selectionLogSummary.backoffCount)}
                      </span>
                    ) : null}
                    {selectionLogSummary.blockedCount ? (
                      <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
                        Blocked responses: {fmtCount(selectionLogSummary.blockedCount)}
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={providerFilter}
                  onChange={(e) => {
                    setProviderFilter(e.target.value);
                    updateQuery({ page: '1' });
                  }}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
                >
                  <option value="all">Provider: All</option>
                  {(Array.isArray(selectionLogSummary?.providers) ? selectionLogSummary.providers : []).map((p) => {
                    const id = String(p || '').trim();
                    if (!id) return null;
                    return (
                      <option key={id} value={id.toLowerCase()}>
                        {id.toUpperCase()}
                      </option>
                    );
                  })}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    updateQuery({ page: '1' });
                  }}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
                >
                  <option value="all">Result: All</option>
                  <option value="success">Result: Success</option>
                  <option value="fail">Result: Fail</option>
                </select>
              </div>

              <div className="text-xs text-[var(--admin-muted)]">
                Showing {fmtCount(detailShowing.from)}-{fmtCount(detailShowing.to)} of {fmtCount(logsTotalCount)}
              </div>
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--admin-border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--admin-surface)] text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-2 py-2">Time</th>
                    <th className="px-2 py-2">Provider</th>
                    <th className="px-2 py-2">Action</th>
                    <th className="px-2 py-2">Result</th>
                    <th className="px-2 py-2">HTTP</th>
                    <th className="px-2 py-2">Error</th>
                    <th className="px-2 py-2">Message</th>
                    <th className="px-2 py-2">Duration</th>
                    <th className="px-2 py-2">Count</th>
                    <th className="px-2 py-2">Domain</th>
                    <th className="px-2 py-2">Correlation / Job</th>
                    <th className="px-2 py-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(logs) ? logs : []).map((row) => (
                    <tr key={row.id} className="border-t border-[var(--admin-border)]">
                      <td className="px-2 py-2">{fmtDate(row.timestamp)}</td>
                      <td className="px-2 py-2 uppercase">{row.providerId || '—'}</td>
                      <td className="px-2 py-2">{row.action || '—'}</td>
                      <td className="px-2 py-2">
                        <span
                          className={cx(
                            'inline-flex rounded-full border px-2 py-0.5',
                            row.success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'
                          )}
                        >
                          {row.success ? 'success' : 'fail'}
                        </span>
                      </td>
                      <td className="px-2 py-2">{row.httpStatus || '—'}</td>
                      <td className="px-2 py-2">{row.errorCategory || '—'}</td>
                      <td className="max-w-[240px] px-2 py-2 truncate" title={row.message || ''}>{row.message || '—'}</td>
                      <td className="px-2 py-2">{fmtMs(row.durationMs)}</td>
                      <td className="px-2 py-2">{row.resultsCount ?? '—'}</td>
                      <td className="max-w-[180px] px-2 py-2 truncate" title={row.domainUsed || ''}>{row.domainUsed || '—'}</td>
                      <td className="max-w-[210px] px-2 py-2 truncate" title={`${row.correlationId || ''} ${row.jobId || ''}`}>{row.correlationId || row.jobId || '—'}</td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => setDetailsOpen(row)}
                          className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 hover:bg-black/10"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}

                  {!loadingLogs && !selectionLogSummary ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                        No provider logs found for this selection log.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">
                Page <span className="font-medium text-[var(--admin-text)]">{fmtCount(detailPage)}</span> of{' '}
                <span className="font-medium text-[var(--admin-text)]">{fmtCount(detailTotalPages)}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-[var(--admin-muted)]">
                  Entries per page
                  <select
                    value={detailPageSize}
                    onChange={(e) => updateQuery({ pageSize: e.target.value, page: '1' })}
                    className="ml-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs"
                  >
                    {pageSizeOptions.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => updateQuery({ page: String(Math.max(1, detailPage - 1)) })}
                  disabled={detailPage <= 1 || loadingLogs}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs hover:bg-black/10 disabled:opacity-60"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => updateQuery({ page: String(Math.min(detailTotalPages, detailPage + 1)) })}
                  disabled={detailPage >= detailTotalPages || loadingLogs}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs hover:bg-black/10 disabled:opacity-60"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              {[
                ['Selection Logs', fmtCount(groupedLogSummary.selectionLogCount), 'text-[var(--admin-text)]'],
                ['Provider Logs', fmtCount(groupedLogSummary.totalEntries), 'text-[var(--admin-text)]'],
                ['Success', fmtCount(groupedLogSummary.successCount), 'text-emerald-200'],
                ['Failures', fmtCount(groupedLogSummary.failCount), 'text-red-200'],
                ['Providers Used', fmtCount(groupedLogSummary.providersUsed), 'text-[var(--admin-text)]'],
                ['Backoff Events', fmtCount(groupedLogSummary.backoffCount), 'text-amber-200'],
              ].map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                  <div className="text-[11px] text-[var(--admin-muted)]">{label}</div>
                  <div className={cx('mt-1 text-base font-semibold', tone)}>{value}</div>
                </div>
              ))}
            </div>

            {unlinkedLogCount ? (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {fmtCount(unlinkedLogCount)} unlinked provider maintenance/test entr{unlinkedLogCount === 1 ? 'y is' : 'ies are'} hidden from the selection-log summary view.
              </div>
            ) : null}

            <div className="mt-3 space-y-3">
              {selectionLogGroups.map((group) => (
                <div key={group.key} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">Selection Log {shortId(group.selectionLogId)}</div>
                      <div className="mt-1 text-xs text-[var(--admin-muted)]">
                        Latest activity {fmtDate(group.latestTimestamp)} · Window {fmtDate(group.firstTimestamp)} to {fmtDate(group.latestTimestamp)}
                      </div>
                      {group.query ? (
                        <div className="mt-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 font-mono text-[11px] break-all">
                          {group.query}
                        </div>
                      ) : null}
                      <div className="mt-2 font-mono text-[11px] text-[var(--admin-muted)] break-all">{group.selectionLogId}</div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={cx(
                          'inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium',
                          summaryToneClass(group.tone)
                        )}
                      >
                        {group.tone === 'healthy' ? 'Healthy' : group.tone === 'mixed' ? 'Mixed' : 'Failing'}
                      </span>

                      <a
                        href={buildSelectionLogHref(group.selectionLogId)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs hover:bg-black/10"
                      >
                        View
                      </a>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {[
                      ['Entries', fmtCount(group.totalEntries)],
                      ['Providers', fmtCount(group.providers.length)],
                      ['Success', fmtCount(group.successCount)],
                      ['Failures', fmtCount(group.failCount)],
                      ['Results', fmtCount(group.totalResults)],
                      ['Avg Duration', fmtMs(group.avgDurationMs)],
                    ].map(([label, value]) => (
                      <Tag key={label}>
                        <span>{label}</span>
                        <span className="ml-1 font-semibold text-[var(--admin-text)]">{value}</span>
                      </Tag>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {group.providers.map((provider) => (
                      <Tag key={provider} className="uppercase text-[var(--admin-text)]">
                        {provider}
                      </Tag>
                    ))}
                    {group.backoffCount ? (
                      <Tag>
                        <span>Backoff</span>
                        <span className="ml-1 font-semibold text-[var(--admin-text)]">{fmtCount(group.backoffCount)}</span>
                      </Tag>
                    ) : null}
                    {group.blockedCount ? (
                      <Tag>
                        <span>Blocked</span>
                        <span className="ml-1 font-semibold text-[var(--admin-text)]">{fmtCount(group.blockedCount)}</span>
                      </Tag>
                    ) : null}
                  </div>
                </div>
              ))}

              {!loadingLogs && selectionLogGroups.length === 0 ? (
                <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-8 text-center text-sm text-[var(--admin-muted)]">
                  No selection-log grouped provider logs found for the current filters.
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <EditModal
        open={editOpen}
        title={`Configure Provider${editProviderId ? `: ${String(editProviderId).toUpperCase()}` : ''}`}
        description="Update provider settings, backoff policy, and adapter-specific configuration."
        error={err}
        success={ok}
        onCancel={() => setEditOpen(false)}
        onSave={saveEdit}
        saveDisabled={!editForm || busy}
        saving={busy}
      >
        {editForm ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(editForm.enabled)}
                onChange={(e) => setEditForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              Provider enabled
            </label>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(editForm.stopOnFirstValid)}
                onChange={(e) => setEditForm((prev) => ({ ...prev, stopOnFirstValid: e.target.checked }))}
              />
              Stop on first valid
            </label>

            <div>
              <div className="mb-1 text-xs text-[var(--admin-muted)]">Max attempts per title</div>
              <input
                type="number"
                min={1}
                max={5}
                value={editForm.maxAttemptsPerTitle}
                onChange={(e) => setEditForm((prev) => ({ ...prev, maxAttemptsPerTitle: e.target.value }))}
                className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <div className="mb-1 text-xs text-[var(--admin-muted)]">Backoff minutes on error</div>
              <input
                type="number"
                min={1}
                max={1440}
                value={editForm.backoffMinutesOnError}
                onChange={(e) => setEditForm((prev) => ({ ...prev, backoffMinutesOnError: e.target.value }))}
                className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <div className="mb-1 text-xs text-[var(--admin-muted)]">Failure threshold to mark blocked</div>
              <input
                type="number"
                min={1}
                max={20}
                value={editForm.failureThresholdBlocked}
                onChange={(e) => setEditForm((prev) => ({ ...prev, failureThresholdBlocked: e.target.value }))}
                className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
              />
            </div>

            <div>
              <div className="mb-1 text-xs text-[var(--admin-muted)]">Test query text</div>
              <input
                value={editForm.testQuery}
                onChange={(e) => setEditForm((prev) => ({ ...prev, testQuery: e.target.value }))}
                className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
                placeholder="The Matrix 1999"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(editForm.resetBackoff)}
                onChange={(e) => setEditForm((prev) => ({ ...prev, resetBackoff: e.target.checked }))}
              />
              Reset backoff + failure streak on save
            </label>

            <div className="md:col-span-2">
              <div className="mb-1 text-xs text-[var(--admin-muted)]">
                {editProviderId === 'yts' ? 'Base API domains (one per line)' : 'Base domains (one per line)'}
              </div>
              <textarea
                value={editForm.domainsText}
                onChange={(e) => setEditForm((prev) => ({ ...prev, domainsText: e.target.value }))}
                className="min-h-[110px] w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
              />
              {editProviderId === 'yts' ? (
                <div className="mt-1 text-[11px] text-[var(--admin-muted)]">System tries bases top-to-bottom. First healthy base is used.</div>
              ) : null}
            </div>

            {editProviderId === 'yts' ? (
              <>
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-[var(--admin-muted)]">API base path</div>
                  <input
                    value={editForm.ytsApiBasePath}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, ytsApiBasePath: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
                    placeholder="/api/v2/"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-[var(--admin-muted)]">Endpoint (readonly default)</div>
                  <input
                    value={editForm.ytsEndpoint}
                    readOnly
                    className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm opacity-80"
                  />
                </div>
              </>
            ) : null}

            {editProviderId === 'tpb' ? (
              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-[var(--admin-muted)]">Search path template</div>
                <input
                  value={editForm.tpbSearchPathTemplate}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, tpbSearchPathTemplate: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
                  placeholder="/search/{query}/1/99/201"
                />
              </div>
            ) : null}

            {editProviderId === 'jackett' || editProviderId === 'prowlarr' ? (
              <>
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-[var(--admin-muted)]">API endpoint path</div>
                  <input
                    value={editForm.genericEndpoint}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, genericEndpoint: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
                    placeholder={editProviderId === 'jackett' ? '/api/v2.0/indexers/all/results/torznab/api' : '/api/v1/search'}
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-[var(--admin-muted)]">API key</div>
                  <input
                    value={editForm.genericApiKey}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, genericApiKey: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
                    placeholder="Paste API key"
                  />
                </div>
              </>
            ) : null}

            {editProviderId === 'eztv' ? (
              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-[var(--admin-muted)]">API endpoint path</div>
                <input
                  value={editForm.eztvEndpoint}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, eztvEndpoint: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm"
                  placeholder="/api/get-torrents"
                />
                <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                  For best results, use a test query like <span className="font-mono">tt0944947</span> (IMDb id).
                </div>
              </div>
            ) : null}

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() => validateProvider(editProviderId)}
                disabled={busy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs hover:bg-black/10 disabled:opacity-60"
              >
                Validate all {editProviderId === 'yts' ? 'bases' : 'domains'}
              </button>
            </div>

            <div className="md:col-span-2 overflow-x-auto rounded-lg border border-[var(--admin-border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--admin-surface)] text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-2 py-2">Base URL</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Last checked</th>
                    <th className="px-2 py-2">Last success</th>
                    <th className="px-2 py-2">Failure streak</th>
                    <th className="px-2 py-2">Backoff</th>
                    <th className="px-2 py-2">Last error</th>
                    <th className="px-2 py-2">Duration</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(editingProvider?.domainHealth) ? editingProvider.domainHealth : []).map((row) => (
                    <tr key={row.id || row.domain} className="border-t border-[var(--admin-border)]">
                      <td className="max-w-[220px] truncate px-2 py-2" title={row.domain || ''}>{row.domain || '—'}</td>
                      <td className="px-2 py-2">
                        <span className={cx('inline-flex rounded-full border px-2 py-0.5', statusClass(row.status || 'unknown'))}>
                          {String(row.status || 'unknown')}
                        </span>
                      </td>
                      <td className="px-2 py-2">{fmtDate(row.lastCheckedAt)}</td>
                      <td className="px-2 py-2">{fmtDate(row.lastSuccessAt)}</td>
                      <td className="px-2 py-2">{Number(row.failureStreak || 0)}</td>
                      <td className="px-2 py-2">{fmtBackoff(row.backoffRemainingMs)}</td>
                      <td className="max-w-[220px] truncate px-2 py-2" title={`${row.lastErrorCategory || ''} ${row.lastErrorMessage || ''}`}>
                        {row.lastErrorCategory ? `${row.lastErrorCategory}: ` : ''}{row.lastErrorMessage || '—'}
                      </td>
                      <td className="px-2 py-2">{fmtMs(row.lastDurationMs)}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => validateProvider(editProviderId, row.domain)}
                            disabled={busy}
                            className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 hover:bg-black/10 disabled:opacity-60"
                          >
                            Validate
                          </button>
                          <button
                            type="button"
                            onClick={() => patchProvider(editProviderId, { activeDomain: row.domain }, 'Active domain updated.')}
                            disabled={busy}
                            className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 hover:bg-black/10 disabled:opacity-60"
                          >
                            Use as active
                          </button>
                          <button
                            type="button"
                            onClick={() => patchProvider(editProviderId, { removeDomain: row.domain }, 'Domain removed.')}
                            disabled={busy || (Array.isArray(editingProvider?.domainHealth) ? editingProvider.domainHealth.length <= 1 : false)}
                            className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-200 hover:bg-red-500/15 disabled:opacity-60"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {!busy && !(Array.isArray(editingProvider?.domainHealth) ? editingProvider.domainHealth.length : 0) ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-center text-[var(--admin-muted)]">No domain records.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </EditModal>

      <LogDetailsModal row={detailsOpen} onClose={() => setDetailsOpen(null)} />
    </div>
  );
}
