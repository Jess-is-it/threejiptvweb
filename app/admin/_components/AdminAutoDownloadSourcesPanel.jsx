'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import EditModal from './EditModal';
import NotesButton from './NotesButton';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
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

function LogDetailsModal({ row, onClose }) {
  if (!row) return null;
  const details = row?.detailsJson && typeof row.detailsJson === 'object' ? row.detailsJson : {};

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

export default function AdminAutoDownloadSourcesPanel() {
  const [providers, setProviders] = useState([]);
  const [summary, setSummary] = useState({});
  const [logs, setLogs] = useState([]);

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

  const loadSources = useCallback(async () => {
    const r = await fetch('/api/admin/autodownload/sources', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load sources.');
    setProviders(Array.isArray(j.providers) ? j.providers : []);
    setSummary(j.summary || {});
    return j;
  }, []);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const q = new URLSearchParams({
        provider: providerFilter,
        domain: domainFilter,
        range,
        status: statusFilter,
        errorCategory: errorFilter,
        view: tab,
        limit: '400',
      });
      const r = await fetch(`/api/admin/autodownload/sources/logs?${q.toString()}`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load logs.');
      setLogs(Array.isArray(j.logs) ? j.logs : []);
    } catch (e) {
      setErr(e?.message || 'Failed to load logs.');
    } finally {
      setLoadingLogs(false);
    }
  }, [providerFilter, domainFilter, range, statusFilter, errorFilter, tab]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      await Promise.all([loadSources(), loadLogs()]);
    } catch (e) {
      setErr(e?.message || 'Failed to load Download Sources.');
    } finally {
      setLoading(false);
    }
  }, [loadLogs, loadSources]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const patchProvider = async (providerId, patch, successMsg = 'Updated.') => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/sources', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, patch }),
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
        body: JSON.stringify({ order: sorted.map((x) => x.id) }),
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
        body: JSON.stringify({ force, onlyDomain }),
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
      const r = await fetch('/api/admin/autodownload/sources/test-all', { method: 'POST' });
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
        body: JSON.stringify({ domain }),
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
    const target = providerFilter === 'all' ? 'all providers' : `${String(providerFilter).toUpperCase()} provider`;
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Clear logs for ${target}? This cannot be undone.`);
      if (!confirmed) return;
    }

    setBusy(true);
    setErr('');
    setOk('');
    try {
      const q = new URLSearchParams({ provider: providerFilter || 'all' });
      const r = await fetch(`/api/admin/autodownload/sources/logs?${q.toString()}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to clear logs.');

      setProviders(Array.isArray(j.providers) ? j.providers : []);
      setSummary(j.summary || {});
      await loadLogs();

      const deleted = Number(j.deletedCount || 0);
      setOk(deleted === 1 ? 'Cleared 1 log entry.' : `Cleared ${deleted} log entries.`);
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
          : {
              domains: normalizeDomainsText(editForm.domainsText).split(/\r?\n/).filter(Boolean),
              searchPathTemplate: String(editForm.tpbSearchPathTemplate || '/search/{query}/1/99/201'),
            },
    };

    await patchProvider(provider.id, patch, `${String(provider.displayName || provider.id).trim()} updated.`);
    setEditOpen(false);
  };

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Manages torrent provider adapters (YTS/TPB) with health status, tests, backoff, and logs.',
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
          <div className="text-lg font-semibold">Download Sources</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Provider health, test controls, backoff policies, and recent provider activity.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="Download Sources — Notes" sections={notes} />
          <button
            type="button"
            disabled
            title="Coming soon"
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm opacity-70"
          >
            Add provider (Coming soon)
          </button>
          <button
            onClick={testAll}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Test all'}
          </button>
          <button
            onClick={loadAll}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}

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

      <div id="source-log-viewer" className="mt-6 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Provider Logs</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Recent activity, errors/blocks, and backoff events.</div>
          </div>

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
              {logs.map((row) => (
                <tr key={row.id} className="border-t border-[var(--admin-border)]">
                  <td className="px-2 py-2">{fmtDate(row.timestamp)}</td>
                  <td className="px-2 py-2 uppercase">{row.providerId || '—'}</td>
                  <td className="px-2 py-2">{row.action || '—'}</td>
                  <td className="px-2 py-2">
                    <span className={cx('inline-flex rounded-full border px-2 py-0.5', row.success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200')}>
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

              {!loadingLogs && logs.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">No logs found for current filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
