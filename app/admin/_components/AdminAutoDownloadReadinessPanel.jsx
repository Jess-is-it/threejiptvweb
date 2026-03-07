'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

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

  const [snapshot, setSnapshot] = useState({
    settings: null,
    engineHost: null,
    mount: null,
    mountStatus: null,
    qb: null,
    xui: null,
    providers: [],
    loadErrors: [],
  });

  const [live, setLive] = useState({
    engine: null,
    mount: null,
    qb: null,
    xui: null,
    providers: null,
  });

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const [settingsR, engineR, mountR, mountStatusR, qbR, xuiR, sourcesR] = await Promise.all([
        safeFetch('/api/admin/autodownload/settings'),
        safeFetch('/api/admin/autodownload/engine-host'),
        safeFetch('/api/admin/autodownload/mount'),
        safeFetch('/api/admin/autodownload/mount/status'),
        safeFetch('/api/admin/autodownload/download-settings'),
        safeFetch('/api/admin/autodownload/xui'),
        safeFetch('/api/admin/autodownload/sources'),
      ]);

      const loadErrors = [
        !settingsR.ok ? `Settings: ${settingsR.error}` : '',
        !engineR.ok ? `Engine Host: ${engineR.error}` : '',
        !mountR.ok ? `Mount settings: ${mountR.error}` : '',
        !mountStatusR.ok ? `Mount status: ${mountStatusR.error}` : '',
        !qbR.ok ? `qBittorrent: ${qbR.error}` : '',
        !xuiR.ok ? `XUI: ${xuiR.error}` : '',
        !sourcesR.ok ? `Download Sources: ${sourcesR.error}` : '',
      ].filter(Boolean);

      setSnapshot({
        settings: settingsR.ok ? settingsR.data?.settings || null : null,
        engineHost: engineR.ok ? engineR.data?.engineHost || null : null,
        mount: mountR.ok ? mountR.data?.mount || null : null,
        mountStatus: mountStatusR.ok ? mountStatusR.data?.status || null : null,
        qb: qbR.ok ? qbR.data?.qb || null : null,
        xui: xuiR.ok ? xuiR.data?.xui || null : null,
        providers: sourcesR.ok && Array.isArray(sourcesR.data?.providers) ? sourcesR.data.providers : [],
        loadErrors,
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

      setLive({
        engine: engineR.ok ? engineR.data?.result || { ok: true } : { ok: false, error: engineR.error },
        mount: mountR.ok ? mountR.data?.status || { ok: true } : { ok: false, error: mountR.error },
        qb: qbR.ok ? qbR.data?.result || { ok: true } : { ok: false, error: qbR.error },
        xui: xuiR.ok ? xuiR.data?.result || { ok: true } : { ok: false, error: xuiR.error },
        providers: providersR.ok
          ? providersR.data
          : {
              ok: false,
              error: providersR.error,
            },
      });

      setLastRunAt(Date.now());
      setOk('Live sanity checks completed.');
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

  const checks = useMemo(() => {
    const s = snapshot.settings || {};
    const engine = snapshot.engineHost || {};
    const mount = snapshot.mount || {};
    const mountStatus = snapshot.mountStatus || {};
    const qb = snapshot.qb || {};
    const xui = snapshot.xui || {};
    const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];

    const enabledProviders = providers.filter((p) => p?.enabled !== false);
    const activeProviders = enabledProviders.filter((p) => ['healthy', 'degraded'].includes(String(p?.status || '').toLowerCase()));

    const moviesEnabled = Boolean(s?.moviesEnabled);
    const seriesEnabled = Boolean(s?.seriesEnabled);

    const engineConfigured = Boolean(engine?.host && engine?.username && engine?.hasSecret);
    const mountConfigured = Boolean(mount?.windowsHost && mount?.shareName && mount?.mountDir && mount?.hasCredentials);
    const scheduleConfigured = Boolean(s?.schedule?.timezone && Array.isArray(s?.schedule?.days) && s.schedule.days.length > 0);
    const coreEnabled = Boolean(s?.enabled && (moviesEnabled || seriesEnabled));
    const qbConfigured = Boolean(qb?.hasCredentials && qb?.moviesSavePath && qb?.seriesSavePath);

    const movieStrategy = s?.movieSelectionStrategy || null;
    const seriesStrategy = s?.seriesSelectionStrategy || null;
    const movieStrategyOk = Boolean(movieStrategy);
    const seriesStrategyOk = Boolean(seriesStrategy);

    const xuiConfigured = Boolean(
      xui?.baseUrl &&
        xui?.hasAccessCode &&
        xui?.hasApiKey &&
        (!moviesEnabled || xui?.watchFolderIdMovies) &&
        (!seriesEnabled || xui?.watchFolderIdSeries)
    );

    const engineTestOk = live.engine?.ok === true || engine?.lastTestOk === true;
    const mountOk = live.mount?.ok === true || mountStatus?.ok === true;
    const qbTestOk = live.qb?.ok === true || qb?.lastTestOk === true;
    const xuiTestOk = live.xui?.ok === true;

    const providerLiveResults = Array.isArray(live.providers?.results) ? live.providers.results : [];
    const providerLiveOk = providerLiveResults.length ? providerLiveResults.some((x) => x?.ok) : null;
    const providersOk = providerLiveOk === true || activeProviders.length > 0;

    const coreReady = engineConfigured && mountConfigured && scheduleConfigured && coreEnabled && qbConfigured && movieStrategyOk && seriesStrategyOk;
    const connectivityReady = engineTestOk && mountOk && qbTestOk && providersOk;
    const e2eReady = coreReady && connectivityReady && xuiConfigured && (xuiTestOk || xui?.baseUrl === '');

    return {
      coreReady,
      connectivityReady,
      e2eReady,
      items: [
        {
          label: 'AutoDownload policy configured',
          detail: `Enabled: ${coreEnabled ? 'Yes' : 'No'} • Schedule: ${scheduleConfigured ? 'OK' : 'Missing'}`,
          href: '/admin/autodownload/settings',
          required: true,
          ok: coreEnabled && scheduleConfigured,
        },
        {
          label: 'Engine Host configured + reachable',
          detail: engineConfigured ? `Host: ${engine.host || '—'} • Last test: ${engine.lastTestOk === true ? 'OK' : engine.lastTestOk === false ? 'Failed' : 'Not tested'}` : 'Not configured',
          href: '/admin/autodownload/engine',
          required: true,
          ok: engineConfigured && engineTestOk,
        },
        {
          label: 'Storage mount configured',
          detail: mountConfigured ? `Mount: ${mount.mountDir || '—'} • SMB share set` : 'Not configured',
          href: '/admin/autodownload/storage',
          required: true,
          ok: mountConfigured,
        },
        {
          label: 'Storage mount is mounted + writable',
          detail: mountConfigured ? `Mount state: ${mountOk ? 'Mounted/Writable' : 'Not ready'}` : 'Mount not configured',
          href: '/admin/autodownload/storage',
          required: true,
          ok: mountConfigured && mountOk,
        },
        {
          label: 'qBittorrent configured + API reachable',
          detail: qbConfigured ? `Port ${qb.port || 8080} • Last test: ${qb.lastTestOk === true ? 'OK' : qb.lastTestOk === false ? 'Failed' : 'Not tested'}` : 'Not configured',
          href: '/admin/autodownload/qbittorrent',
          required: true,
          ok: qbConfigured && qbTestOk,
        },
        {
          label: 'Download Sources healthy',
          detail: `${enabledProviders.length} enabled • ${activeProviders.length} usable (healthy/degraded)`,
          href: '/admin/autodownload/sources',
          required: true,
          ok: providersOk,
        },
        {
          label: 'Movie + Series selection strategies set',
          detail: `Movie: ${movieStrategyOk ? 'OK' : 'Missing'} • Series: ${seriesStrategyOk ? 'OK' : 'Missing'}`,
          href: '/admin/autodownload/settings',
          required: true,
          ok: movieStrategyOk && seriesStrategyOk,
        },
        {
          label: 'XUI integration (for IPTV ingest)',
          detail: xuiConfigured
            ? `Configured • Watchfolders M/S: ${xui.watchFolderIdMovies || '—'}/${xui.watchFolderIdSeries || '—'}`
            : 'Not fully configured',
          href: '/admin/autodownload/xui',
          required: true,
          ok: xuiConfigured && (live.xui ? xuiTestOk : true),
        },
      ],
    };
  }, [live, snapshot]);

  const passedCount = checks.items.filter((x) => x.ok).length;
  const totalCount = checks.items.length;

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Runs a sanity checklist to confirm AutoDownload setup is complete before end-to-end testing.',
        'This page is for validation/testing only and does not change scheduler policy.',
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

      {snapshot.loadErrors.length ? (
        <div className="mt-4 rounded-xl border p-3 text-sm" style={toneVars('warning')}>
          <div className="font-semibold">Some checks could not load:</div>
          <ul className="mt-2 list-disc pl-5">
            {snapshot.loadErrors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}

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
