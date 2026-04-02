'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import NotesButton from './NotesButton';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function toneVars(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'success') {
    return {
      borderColor: 'var(--admin-pill-success-border)',
      backgroundColor: 'var(--admin-pill-success-bg)',
      color: 'var(--admin-pill-success-text)',
    };
  }
  if (t === 'warning') {
    return {
      borderColor: 'var(--admin-pill-warning-border)',
      backgroundColor: 'var(--admin-pill-warning-bg)',
      color: 'var(--admin-pill-warning-text)',
    };
  }
  if (t === 'danger') {
    return {
      borderColor: 'var(--admin-pill-danger-border)',
      backgroundColor: 'var(--admin-pill-danger-bg)',
      color: 'var(--admin-pill-danger-text)',
    };
  }
  return {
    borderColor: 'var(--admin-pill-neutral-border)',
    backgroundColor: 'var(--admin-pill-neutral-bg)',
    color: 'var(--admin-pill-neutral-text)',
  };
}

function statusPillStyle(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pass') return toneVars('success');
  if (s === 'warn') return toneVars('warning');
  if (s === 'fail') return toneVars('danger');
  return toneVars('neutral');
}

function scorePillStyle(passed, total) {
  const p = Number(passed || 0);
  const t = Number(total || 0);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return toneVars('neutral');
  if (p >= t) return toneVars('success');
  if (p >= Math.ceil(t / 2)) return toneVars('warning');
  return toneVars('danger');
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

async function fetchJson(url, init = undefined) {
  const r = await fetch(url, { cache: 'no-store', ...(init || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Request failed: ${url}`);
  return j;
}

async function safeFetch(url, init = undefined) {
  try {
    const data = await fetchJson(url, init);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || 'Request failed.' };
  }
}

export default function AdminAutoDownloadReadinessPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [lastRunAt, setLastRunAt] = useState(null);
  const [summary, setSummary] = useState({
    passed: 0,
    total: 0,
    status: 'warn',
    model: {
      coreReady: false,
      connectivityReady: false,
      e2eReady: false,
      passed: 0,
      total: 0,
      status: 'warn',
      items: [],
    },
  });

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const readinessR = await safeFetch('/api/admin/autodownload/readiness/summary');
      if (!readinessR.ok) throw new Error(readinessR.error || 'Failed to load readiness summary.');
      const nextSummary = readinessR.data?.summary || {};
      setSummary({
        passed: Number.isFinite(Number(nextSummary?.passed)) ? Number(nextSummary.passed) : 0,
        total: Number.isFinite(Number(nextSummary?.total)) ? Number(nextSummary.total) : 0,
        status: String(nextSummary?.status || 'warn'),
        model: {
          coreReady: nextSummary?.model?.coreReady === true,
          connectivityReady: nextSummary?.model?.connectivityReady === true,
          e2eReady: nextSummary?.model?.e2eReady === true,
          passed: Number.isFinite(Number(nextSummary?.model?.passed)) ? Number(nextSummary.model.passed) : 0,
          total: Number.isFinite(Number(nextSummary?.model?.total)) ? Number(nextSummary.model.total) : 0,
          status: String(nextSummary?.model?.status || nextSummary?.status || 'warn'),
          items: Array.isArray(nextSummary?.model?.items) ? nextSummary.model.items : [],
        },
      });
    } catch (e) {
      setErr(e?.message || 'Failed to load readiness data.');
    } finally {
      setLoading(false);
    }
  };

  const runLiveChecks = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const [engineR, mountR, qbR, xuiR, providersR] = await Promise.all([
        safeFetch('/api/admin/autodownload/engine-host/test', { method: 'POST' }),
        safeFetch('/api/admin/autodownload/mount/status'),
        safeFetch('/api/admin/autodownload/download-settings/test', { method: 'POST' }),
        safeFetch('/api/admin/autodownload/xui/test', { method: 'POST' }),
        safeFetch('/api/admin/autodownload/sources/test-all', { method: 'POST' }),
      ]);

      setLastRunAt(Date.now());
      const failed = [engineR, mountR, qbR, xuiR, providersR].filter((row) => !row.ok);
      setOk(failed.length ? `Live checks completed with ${failed.length} issue(s).` : 'Live sanity checks completed.');
      await load();
    } catch (e) {
      setErr(e?.message || 'Live checks failed.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checks = summary.model || { coreReady: false, connectivityReady: false, e2eReady: false, items: [] };
  const passedCount = Number.isFinite(Number(summary.passed)) ? Number(summary.passed) : 0;
  const totalCount = Number.isFinite(Number(summary.total)) ? Number(summary.total) : 0;

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Runs a sanity checklist to confirm AutoDownload setup is complete before end-to-end testing.',
        'Covers policy, scheduler, qB options, cleaning, timeout replacement, release hold, watchfolder, VPN, and XUI.',
      ],
    },
    {
      title: 'How to use',
      items: ['Refresh checklist to inspect saved configuration.', 'Run live sanity checks to test connectivity and provider health quickly.'],
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold">AutoDownload Sanity Check</div>
            <span className="inline-flex rounded-full border px-2 py-1 text-xs font-semibold" style={scorePillStyle(passedCount, totalCount)}>
              {passedCount}/{totalCount}
            </span>
          </div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Sanity checklist to verify your setup is ready for AutoDownload testing.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="Sanity Check — Notes" sections={notes} />
          <button
            type="button"
            onClick={load}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh checklist
          </button>
          <button
            type="button"
            onClick={runLiveChecks}
            disabled={loading || busy}
            className="admin-btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-60"
          >
            {busy ? 'Running checks…' : 'Run live sanity checks'}
          </button>
        </div>
      </div>

      {err ? (
        <div className="mt-4 rounded-lg border px-3 py-2 text-sm" style={toneVars('danger')}>
          {err}
        </div>
      ) : null}
      {ok ? (
        <div className="mt-4 rounded-lg border px-3 py-2 text-sm" style={toneVars('success')}>
          {ok}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Core setup</div>
          <div className="mt-1 inline-flex rounded-full border px-2 py-1 text-xs" style={statusPillStyle(checks.coreReady ? 'pass' : 'fail')}>
            {checks.coreReady ? 'Ready' : 'Not Ready'}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Connectivity checks</div>
          <div className="mt-1 inline-flex rounded-full border px-2 py-1 text-xs" style={statusPillStyle(checks.connectivityReady ? 'pass' : 'warn')}>
            {checks.connectivityReady ? 'Passing' : 'Needs Test/Fix'}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">End-to-end readiness</div>
          <div className="mt-1 inline-flex rounded-full border px-2 py-1 text-xs" style={statusPillStyle(checks.e2eReady ? 'pass' : 'fail')}>
            {checks.e2eReady ? 'Ready to Test' : 'Not Ready'}
          </div>
          <div className="mt-1 text-[11px] text-[var(--admin-muted)]">Last live run: {fmtDate(lastRunAt)}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {checks.items.map((row) => (
          <div key={row.label} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold">{row.label}</div>
              <span
                className="inline-flex rounded-full border px-2 py-1 text-xs"
                style={statusPillStyle(row.ok ? 'pass' : row.required ? 'fail' : 'warn')}
              >
                {row.ok ? 'OK' : row.required ? 'Fix Required' : 'Check'}
              </span>
            </div>
            <div className="mt-2 text-xs text-[var(--admin-muted)]">{row.detail}</div>
            <div className="mt-3">
              <Link
                href={row.href}
                className="inline-flex rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs text-[var(--admin-text)] no-underline hover:bg-black/10"
              >
                Open settings
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
