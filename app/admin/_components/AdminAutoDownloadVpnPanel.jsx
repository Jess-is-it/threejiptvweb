'use client';

import { useEffect, useMemo, useState } from 'react';

import HelpTooltip from './HelpTooltip';
import EditModal, { EditIconButton } from './EditModal';
import NotesButton from './NotesButton';

function Field({ label, children, hint, note }) {
  const infoText = [hint, note].map((item) => String(item || '').trim()).filter(Boolean).join(' • ');
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--admin-text)]">
          <span>{label}</span>
          {infoText ? <HelpTooltip text={infoText} /> : null}
        </label>
      </div>
      {children}
    </div>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className={
        'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30 ' +
        (props.className || '')
      }
    />
  );
}

function toneVars(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'success') {
    return {
      borderColor: 'var(--admin-pill-success-border)',
      backgroundColor: 'var(--admin-pill-success-bg)',
      color: 'var(--admin-pill-success-text)',
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
    borderColor: 'var(--admin-pill-warning-border)',
    backgroundColor: 'var(--admin-pill-warning-bg)',
    color: 'var(--admin-pill-warning-text)',
  };
}

const VPN_TEST_PHASES = ['Checking Engine Host access', 'Checking VPN route rules', 'Checking WireGuard session', 'Validating VPN public IP'];
const COMPARISON_PHASES = [
  { key: 'source', label: 'Selecting seeded source', note: 'Picking one latest popular movie source with high seeders.' },
  { key: 'direct', label: 'Running no-VPN download', note: 'Full benchmark download with VPN disabled.' },
  { key: 'vpn', label: 'Running VPN download', note: 'Full benchmark download with VPN enabled.' },
  { key: 'restore', label: 'Restoring previous VPN state', note: 'Applying your previous VPN enabled/disabled state.' },
  { key: 'finalize', label: 'Finalizing report', note: 'Preparing speed comparison and summary.' },
];

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function inferComparisonPhaseIndexFromError(message = '') {
  const text = String(message || '').toLowerCase();
  if (!text) return 0;
  if (text.includes('no vpn')) return 1;
  if (text.includes('restore')) return 3;
  if (text.includes('vpn')) return 2;
  if (text.includes('source') || text.includes('seeders') || text.includes('tmdb')) return 0;
  return 2;
}

export default function AdminAutoDownloadVpnPanel() {
  const [loading, setLoading] = useState(true);
  const [vpnBusy, setVpnBusy] = useState(false);
  const [vpnApplying, setVpnApplying] = useState(false);
  const [vpnTesting, setVpnTesting] = useState(false);
  const [vpnRegionsBusy, setVpnRegionsBusy] = useState(false);
  const [vpnEditOpen, setVpnEditOpen] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [qbInfo, setQbInfo] = useState(null);
  const [vpnInfo, setVpnInfo] = useState(null);
  const [vpnEnabled, setVpnEnabled] = useState(false);
  const [vpnRegionId, setVpnRegionId] = useState('ph');
  const [vpnRegionName, setVpnRegionName] = useState('Philippines');
  const [vpnKillSwitchEnabled, setVpnKillSwitchEnabled] = useState(true);
  const [vpnRequiredForDispatch, setVpnRequiredForDispatch] = useState(true);
  const [vpnUsername, setVpnUsername] = useState('');
  const [vpnPassword, setVpnPassword] = useState('');
  const [vpnRegions, setVpnRegions] = useState([]);

  const [vpnTestRuntime, setVpnTestRuntime] = useState(null);
  const [vpnTestPhaseIndex, setVpnTestPhaseIndex] = useState(0);
  const [vpnTestModalOpen, setVpnTestModalOpen] = useState(false);
  const [vpnTestResult, setVpnTestResult] = useState(null);
  const [vpnTestError, setVpnTestError] = useState('');
  const [lastTestDurationMs, setLastTestDurationMs] = useState(null);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const [comparisonResult, setComparisonResult] = useState(null);
  const [comparisonProgress, setComparisonProgress] = useState(0);
  const [comparisonStartedAt, setComparisonStartedAt] = useState(null);
  const [comparisonElapsedMs, setComparisonElapsedMs] = useState(0);
  const [comparisonStatus, setComparisonStatus] = useState('No active comparison run.');
  const [comparisonFailurePhaseIndex, setComparisonFailurePhaseIndex] = useState(-1);
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);
  const [internetTestBusy, setInternetTestBusy] = useState(false);
  const [internetTestModalOpen, setInternetTestModalOpen] = useState(false);
  const [internetTestJobId, setInternetTestJobId] = useState('');
  const [internetTestJob, setInternetTestJob] = useState(null);
  const [downloadTestBusy, setDownloadTestBusy] = useState(false);
  const [downloadTestModalOpen, setDownloadTestModalOpen] = useState(false);
  const [downloadTestJobId, setDownloadTestJobId] = useState('');
  const [downloadTestJob, setDownloadTestJob] = useState(null);

  const serviceUserDisplay = qbInfo?.serviceUser || 'qbvpn';
  const selectedRegion = useMemo(() => {
    const selectedId = String(vpnInfo?.regionId || vpnRegionId || '').trim().toLowerCase();
    const matched = vpnRegions.find((row) => String(row?.id || '').trim().toLowerCase() === selectedId);
    if (matched) return matched;
    return {
      id: vpnInfo?.regionId || vpnRegionId || '—',
      name: vpnInfo?.regionName || vpnRegionName || '—',
      country: '',
      city: '',
      portForward: false,
    };
  }, [vpnInfo?.regionId, vpnInfo?.regionName, vpnRegionId, vpnRegionName, vpnRegions]);

  const comparisonPhaseIndex = useMemo(() => {
    const value = Number(comparisonProgress || 0);
    if (value < 20) return 0;
    if (value < 45) return 1;
    if (value < 70) return 2;
    if (value < 90) return 3;
    return 4;
  }, [comparisonProgress]);

  const vpnRuntimeChecks = useMemo(() => {
    if (!vpnTestRuntime || typeof vpnTestRuntime !== 'object') return [];
    return [
      { key: 'iface', label: 'Interface up', ok: vpnTestRuntime.ifaceUp === true },
      { key: 'rule', label: 'Policy route rule', ok: vpnTestRuntime.ruleOk === true },
      { key: 'userroute', label: 'qB user route', ok: vpnTestRuntime.userRouteOk === true },
      {
        key: 'kill',
        label: 'Policy kill switch',
        ok: vpnTestRuntime.killSwitchOk === true,
        skipped: vpnInfo?.killSwitchEnabled === false,
      },
      { key: 'wg', label: 'WireGuard session', ok: vpnTestRuntime.wgOk === true },
      { key: 'handshake', label: 'Recent handshake', ok: vpnTestRuntime.handshakeRecent === true },
      { key: 'host', label: 'Host public IP detected', ok: Boolean(String(vpnTestRuntime.hostIp || '').trim()) },
      {
        key: 'vpnip',
        label: 'VPN interface public IP',
        ok:
          Boolean(String(vpnTestRuntime.vpnIp || '').trim()) &&
          String(vpnTestRuntime.vpnIp || '').trim() !== String(vpnTestRuntime.hostIp || '').trim(),
      },
    ];
  }, [vpnInfo?.killSwitchEnabled, vpnTestRuntime]);

  const internetConnectivity = internetTestJob?.result?.connectivity || null;
  const internetFailureMode =
    internetConnectivity?.rootVpnOk && !internetTestJob?.result?.ok
      ? 'qb-user-only'
      : !internetTestJob?.result?.ok
        ? 'vpn-path'
        : '';
  const persistedDownloadTest = vpnInfo?.lastDownloadTestResult || null;
  const persistedDownloadRun = persistedDownloadTest?.run || null;
  const persistedDownloadSource = persistedDownloadTest?.sourceSelection || null;
  const persistedDownloadRuntime = persistedDownloadTest?.runtime || null;

  const notes = [
    {
      title: 'How VPN works',
      items: [
        'This routes only qBittorrent service traffic through WireGuard VPN.',
        'Web app traffic and IPTV playback stay on normal network.',
      ],
    },
    {
      title: 'Prerequisites',
      items: [
        'Engine Host must be reachable and sudo-enabled in Engine Host settings.',
        'Use PIA manual connection credentials (VPN username/password), not your email login.',
      ],
    },
    {
      title: 'Operational notes',
      items: [
        'Save stores VPN config only.',
        'Test VPN validates credentials and checks runtime routing health.',
      ],
    },
  ];

  const vpnCanSave = useMemo(() => {
    if (!vpnEnabled) return true;
    const regionOk = Boolean(String(vpnRegionId || '').trim());
    const usernameOk = Boolean(String(vpnUsername || '').trim()) || Boolean(vpnInfo?.hasCredentials);
    const passwordOk = Boolean(vpnPassword) || Boolean(vpnInfo?.hasCredentials);
    return Boolean(regionOk && usernameOk && passwordOk);
  }, [vpnEnabled, vpnInfo?.hasCredentials, vpnPassword, vpnRegionId, vpnUsername]);

  const loadVpnRegions = async ({ silent = false } = {}) => {
    setVpnRegionsBusy(true);
    try {
      const r = await fetch('/api/admin/autodownload/download-settings/vpn/regions', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load PIA regions.');
      setVpnRegions(Array.isArray(j?.regions) ? j.regions : []);
    } catch (e) {
      if (!silent) setErr(e?.message || 'Failed to load PIA regions.');
    } finally {
      setVpnRegionsBusy(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const [qbResp, vpnResp] = await Promise.all([
        fetch('/api/admin/autodownload/download-settings', { cache: 'no-store' }),
        fetch('/api/admin/autodownload/download-settings/vpn', { cache: 'no-store' }),
      ]);
      const qbJson = await qbResp.json().catch(() => ({}));
      if (!qbResp.ok || !qbJson?.ok) throw new Error(qbJson?.error || 'Failed to load qBittorrent settings.');
      const qb = qbJson.qb || {};
      setQbInfo(qb);

      const vpnJson = await vpnResp.json().catch(() => ({}));
      if (!vpnResp.ok || !vpnJson?.ok) throw new Error(vpnJson?.error || 'Failed to load VPN settings.');
      const vpn = vpnJson.vpn || {};
      setVpnInfo(vpn);
      setVpnEnabled(Boolean(vpn.enabled));
      setVpnRegionId(String(vpn.regionId || 'ph'));
      setVpnRegionName(String(vpn.regionName || ''));
      setVpnKillSwitchEnabled(vpn.killSwitchEnabled !== false);
      setVpnRequiredForDispatch(vpn.requiredForDispatch !== false);
      setVpnUsername('');
      setVpnPassword('');

      await loadVpnRegions({ silent: true });
    } catch (e) {
      setErr(e?.message || 'Failed to load VPN settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (comparisonBusy) {
      setComparisonStatus('Running benchmark on server… waiting for run completion checks.');
      return;
    }
    if (!comparisonResult && !comparisonError) {
      setComparisonStatus('No active comparison run.');
    }
  }, [comparisonBusy, comparisonError, comparisonResult]);

  useEffect(() => {
    if (!internetTestBusy || !internetTestJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/admin/autodownload/download-settings/vpn/internet?jobId=${encodeURIComponent(internetTestJobId)}`, {
          cache: 'no-store',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to poll VPN internet test.');
        if (cancelled) return;
        const job = j?.job || null;
        setInternetTestJob(job);
        if (job?.status === 'completed') {
          setInternetTestBusy(false);
          setOk(job?.summary || 'VPN internet test completed.');
          await load();
        } else if (job?.status === 'failed') {
          setInternetTestBusy(false);
          setErr(job?.error || 'VPN internet test failed.');
          await load();
        }
      } catch (e) {
        if (cancelled) return;
        setInternetTestBusy(false);
        setErr(e?.message || 'Failed to poll VPN internet test.');
      }
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [internetTestBusy, internetTestJobId]);

  useEffect(() => {
    if (!downloadTestBusy || !downloadTestJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/admin/autodownload/download-settings/vpn/download?jobId=${encodeURIComponent(downloadTestJobId)}`, {
          cache: 'no-store',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to poll VPN download test.');
        if (cancelled) return;
        const job = j?.job || null;
        setDownloadTestJob(job);
        if (job?.status === 'completed') {
          setDownloadTestBusy(false);
          if (job?.result?.vpn) setVpnInfo(job.result.vpn);
          setOk(job?.summary || 'VPN-only download test completed.');
          await load();
        } else if (job?.status === 'failed') {
          setDownloadTestBusy(false);
          setErr(job?.error || 'VPN-only download test failed.');
          await load();
        }
      } catch (e) {
        if (cancelled) return;
        setDownloadTestBusy(false);
        setErr(e?.message || 'Failed to poll VPN download test.');
      }
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [downloadTestBusy, downloadTestJobId]);

  const saveVpnSettings = async () => {
    setVpnBusy(true);
    setErr('');
    setOk('');
    try {
      const payload = {
        enabled: vpnEnabled,
        regionId: String(vpnRegionId || '').trim(),
        regionName: String(vpnRegionName || '').trim(),
        killSwitchEnabled: vpnKillSwitchEnabled,
        requiredForDispatch: vpnRequiredForDispatch,
      };
      if (String(vpnUsername || '').trim()) payload.piaUsername = String(vpnUsername || '').trim();
      if (vpnPassword) payload.piaPassword = vpnPassword;

      const r = await fetch('/api/admin/autodownload/download-settings/vpn', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save VPN settings.');
      const savedVpn = j?.vpn || null;
      setVpnInfo(savedVpn);
      setVpnEnabled(savedVpn?.enabled === true);
      setVpnPassword('');
      setVpnUsername('');
      setOk('VPN settings saved.');
      return true;
    } catch (e) {
      setErr(e?.message || 'Failed to save VPN settings.');
      return false;
    } finally {
      setVpnBusy(false);
    }
  };

  const applyVpn = async ({ disable = false, skipConfirm = false, setMessages = true } = {}) => {
    if (!skipConfirm && disable) {
      if (!confirm('Disable qBittorrent VPN routing now?')) return { ok: false, canceled: true };
    } else if (!skipConfirm && !confirm('Apply qBittorrent VPN routing now?')) {
      return { ok: false, canceled: true };
    }
    setVpnApplying(true);
    if (setMessages) {
      setErr('');
      setOk('');
    }
    try {
      const r = await fetch('/api/admin/autodownload/download-settings/vpn/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(disable ? { action: 'disable' } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || j?.result?.error || 'Failed to apply VPN settings.');
      const result = j?.result || {};
      if (result?.vpn) {
        setVpnInfo(result.vpn);
        setVpnEnabled(result.vpn.enabled === true);
      }
      if (result?.runtime) setVpnTestRuntime(result.runtime);
      if (setMessages) {
        setOk(
          disable
            ? result?.vpn?.lastAppliedSummary || 'VPN disabled.'
            : result?.runtime?.summary || result?.vpn?.lastAppliedSummary || 'VPN applied.'
        );
      }
      await load();
      return { ok: true, result };
    } catch (e) {
      const message = e?.message || 'Failed to apply VPN settings.';
      if (setMessages) setErr(message);
      return { ok: false, error: message };
    } finally {
      setVpnApplying(false);
    }
  };

  const testVpn = async () => {
    setVpnTesting(true);
    setVpnTestModalOpen(true);
    setVpnTestResult(null);
    setVpnTestError('');
    setVpnTestRuntime(null);
    setErr('');
    setOk('');
    setVpnTestPhaseIndex(0);
    const startedAt = Date.now();
    let phaseTimer = null;
    try {
      phaseTimer = setInterval(() => {
        setVpnTestPhaseIndex((prev) => (prev + 1) % VPN_TEST_PHASES.length);
      }, 900);

      if (vpnEnabled) {
        const applyResult = await applyVpn({ disable: false, skipConfirm: true, setMessages: false });
        if (!applyResult?.ok) throw new Error(applyResult?.error || 'Failed to apply VPN settings.');
      }

      const r = await fetch('/api/admin/autodownload/download-settings/vpn/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includePublicIp: true, validateCredentials: true }),
      });
      const j = await r.json().catch(() => ({}));
      const result = j?.result || {};
      const duration = Math.max(0, Date.now() - startedAt);
      setLastTestDurationMs(duration);
      if (result?.runtime) setVpnTestRuntime(result.runtime);
      if (result?.vpn) setVpnInfo(result.vpn);
      const passed = Boolean(r.ok && j?.ok);
      setVpnTestResult({
        ok: passed,
        summary: result?.summary || (passed ? 'VPN check passed.' : j?.error || 'VPN test failed.'),
        runtime: result?.runtime || null,
        durationMs: duration,
      });
      if (!passed) throw new Error(j?.error || result?.summary || 'VPN test failed.');
      setOk(result?.summary || 'VPN check passed.');
      await load();
    } catch (e) {
      const message = e?.message || 'VPN test failed.';
      setVpnTestError(message);
      setErr(message);
    } finally {
      if (phaseTimer) clearInterval(phaseTimer);
      setVpnTesting(false);
    }
  };

  const startInternetTest = async () => {
    setErr('');
    setOk('');
    setInternetTestModalOpen(true);
    setInternetTestJob(null);
    setInternetTestBusy(true);
    try {
      const r = await fetch('/api/admin/autodownload/download-settings/vpn/internet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || !j?.jobId) throw new Error(j?.error || 'Failed to start VPN internet test.');
      setInternetTestJobId(String(j.jobId));
    } catch (e) {
      setInternetTestBusy(false);
      setErr(e?.message || 'Failed to start VPN internet test.');
    }
  };

  const startDownloadTest = async () => {
    setErr('');
    setOk('');
    setDownloadTestModalOpen(true);
    setDownloadTestJob(null);
    setDownloadTestBusy(true);
    try {
      const r = await fetch('/api/admin/autodownload/download-settings/vpn/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxRunMinutes: 35 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || !j?.jobId) throw new Error(j?.error || 'Failed to start VPN-only download test.');
      setDownloadTestJobId(String(j.jobId));
    } catch (e) {
      setDownloadTestBusy(false);
      setErr(e?.message || 'Failed to start VPN-only download test.');
    }
  };

  const runComparison = async () => {
    const confirmed = confirm(
      'Run VPN vs No-VPN benchmark now?\n\nThis will:\n1) choose one popular movie source (0.5GB to 1.0GB, high seeders),\n2) fully download it with VPN OFF,\n3) fully download it again with VPN ON,\n4) restore your previous VPN state.'
    );
    if (!confirmed) return;

    setComparisonBusy(true);
    setComparisonError('');
    setComparisonResult(null);
    setComparisonProgress(6);
    setComparisonStartedAt(Date.now());
    setComparisonElapsedMs(0);
    setComparisonStatus('Starting benchmark...');
    setComparisonFailurePhaseIndex(-1);
    setErr('');
    setOk('');
    let progressTimer = null;
    let elapsedTimer = null;
    const startedAt = Date.now();

    try {
      progressTimer = setInterval(() => {
        setComparisonProgress((prev) => {
          const value = Number(prev || 0);
          const increment = value < 20 ? 6 : value < 45 ? 4 : value < 70 ? 3 : value < 85 ? 2 : 1;
          return Math.min(92, value + increment);
        });
      }, 1000);
      elapsedTimer = setInterval(() => {
        setComparisonElapsedMs(Date.now() - startedAt);
      }, 500);

      const r = await fetch('/api/admin/autodownload/download-settings/vpn/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxRunMinutes: 25 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'VPN comparison failed.');
      setComparisonResult(j?.result || null);
      setComparisonProgress(100);
      setComparisonElapsedMs(Date.now() - startedAt);
      setComparisonStatus('Comparison completed.');
      setComparisonFailurePhaseIndex(-1);
      const fasterLabel = String(j?.result?.comparison?.fasterLabel || 'completed');
      setOk(`VPN comparison finished. Faster mode: ${fasterLabel}.`);
      await load();
    } catch (e) {
      const message = e?.message || 'VPN comparison failed.';
      const failPhaseIndex = inferComparisonPhaseIndexFromError(message);
      const failProgressByPhase = [12, 38, 63, 88, 95];
      setComparisonError(message);
      setComparisonProgress(failProgressByPhase[failPhaseIndex] || 20);
      setComparisonElapsedMs(Date.now() - startedAt);
      setComparisonStatus(`Comparison failed during ${COMPARISON_PHASES[failPhaseIndex]?.label || 'benchmark'} phase.`);
      setComparisonFailurePhaseIndex(failPhaseIndex);
      setErr(message);
      setComparisonModalOpen(true);
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      if (elapsedTimer) clearInterval(elapsedTimer);
      setComparisonBusy(false);
    }
  };

  const vpnSaveDisabled = loading || vpnBusy || vpnApplying || !vpnCanSave;
  const vpnDiagnosticsDisabled = loading || vpnTesting || vpnApplying || comparisonBusy || internetTestBusy || downloadTestBusy;
  const liveDownloadMeta = downloadTestJob?.result?.live || null;

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">VPN Routing (qB-only)</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Dedicated VPN controls for qBittorrent traffic only. IPTV and admin web traffic remain on your normal network.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="VPN Routing — Notes" sections={notes} />
          <button
            onClick={() => load()}
            disabled={loading || vpnBusy || vpnTesting || vpnApplying || comparisonBusy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
          <button
            onClick={() => startDownloadTest()}
            disabled={vpnDiagnosticsDisabled || !vpnEnabled}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {downloadTestBusy ? 'Running VPN Download…' : 'VPN Download Test'}
          </button>
          <button
            onClick={() => startInternetTest()}
            disabled={vpnDiagnosticsDisabled || !vpnEnabled}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {internetTestBusy ? 'Testing Internet…' : 'VPN Internet Test'}
          </button>
          <button
            onClick={() => testVpn()}
            disabled={loading || vpnTesting || vpnApplying || comparisonBusy || internetTestBusy || downloadTestBusy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {vpnTesting ? 'Testing VPN…' : 'Test VPN'}
          </button>
          <EditIconButton onClick={() => setVpnEditOpen(true)} />
        </div>
      </div>

      {!vpnEditOpen && err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {!vpnEditOpen && ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}
      <div className="mt-4 rounded-xl border p-4 text-sm" style={toneVars('warning')}>
        <div className="text-sm font-semibold">Important Information</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>Prerequisite: Engine Host must be configured and reachable.</li>
          <li>Use PIA manual connection credentials (VPN username/password), not your PIA account email login.</li>
          <li>Test VPN validates credentials and checks routing health; when enabled, test also applies the latest routing config.</li>
          <li>qB service account currently routed: <span className="font-semibold">{serviceUserDisplay}</span>.</li>
        </ul>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">VPN Status</div>
          <div className="mt-1 text-sm font-semibold">{vpnEnabled ? 'Enabled' : 'Disabled (opt-out)'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Credentials: {vpnInfo?.hasCredentials ? `Saved (${vpnInfo?.usernamePreview || 'hidden'})` : 'Not set'}
          </div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Service user: {serviceUserDisplay}</div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Selected Server</div>
          <div className="mt-1 text-sm font-semibold">{selectedRegion?.name || '—'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Region ID: {selectedRegion?.id || '—'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            {selectedRegion?.country || '—'}
            {selectedRegion?.city ? ` • ${selectedRegion.city}` : ''}
          </div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Port forwarding: {selectedRegion?.portForward ? 'Supported' : 'Not supported'}</div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Tunnel Configuration</div>
          <div className="mt-1 text-sm font-semibold">{vpnInfo?.interfaceName || 'piawg0'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Route table: {vpnInfo?.routeTable ?? '—'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Mark: {vpnInfo?.markHex || '—'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Kill switch: {vpnInfo?.killSwitchEnabled !== false ? 'On' : 'Off'} • Dispatch guard:{' '}
            {vpnInfo?.requiredForDispatch !== false ? 'On' : 'Off'}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs text-[var(--admin-muted)]">Last Test</div>
          <div className="mt-1 text-sm font-semibold">{vpnInfo?.lastTestSummary || 'Not tested yet'}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            {vpnInfo?.lastTestAt ? new Date(vpnInfo.lastTestAt).toLocaleString() : '—'}
          </div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Latency: {Number.isFinite(Number(lastTestDurationMs)) ? `${Number(lastTestDurationMs)} ms` : 'Not measured'}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Host Public IP</div>
            <div className="mt-1 font-mono text-xs">{vpnInfo?.lastPublicIp || vpnTestRuntime?.hostIp || '—'}</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">VPN Public IP</div>
            <div className="mt-1 font-mono text-xs">{vpnInfo?.lastVpnPublicIp || vpnTestRuntime?.vpnIp || '—'}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Last VPN Download Test</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Stores the latest VPN-only qB benchmark so the result stays visible on this page after the test finishes.
            </div>
          </div>
          <button
            onClick={() => startDownloadTest()}
            disabled={vpnDiagnosticsDisabled || !vpnEnabled}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {downloadTestBusy ? 'Running…' : 'Run Test Again'}
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="font-semibold text-[var(--admin-text)]">
              {vpnInfo?.lastDownloadTestSummary || 'No VPN download test has been saved yet.'}
            </div>
            <span
              className="rounded-full border px-2 py-0.5 font-semibold"
              style={vpnInfo?.lastDownloadTestOk === false ? toneVars('danger') : vpnInfo?.lastDownloadTestOk === true ? toneVars('success') : toneVars('warning')}
            >
              {vpnInfo?.lastDownloadTestOk === true ? 'Passed' : vpnInfo?.lastDownloadTestOk === false ? 'Failed' : 'No result'}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--admin-muted)]">
            <span>Last run: {vpnInfo?.lastDownloadTestAt ? new Date(vpnInfo.lastDownloadTestAt).toLocaleString() : '—'}</span>
            <span>VPN IP: {persistedDownloadRuntime?.vpnIp || '—'}</span>
            <span>Host IP: {persistedDownloadRuntime?.hostIp || '—'}</span>
          </div>
          </div>
        {vpnInfo?.lastDownloadTestAt ? (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs text-[var(--admin-muted)]">
              <div>
                Test Movie:{' '}
                <span className="font-semibold text-[var(--admin-text)]">
                  {persistedDownloadSource?.title || '—'}
                  {persistedDownloadSource?.year ? ` (${persistedDownloadSource.year})` : ''}
                </span>
              </div>
              <div className="mt-1">
                Source: <span className="font-semibold text-[var(--admin-text)]">{persistedDownloadSource?.provider || '—'}</span> ·
                Seeders: <span className="font-semibold text-[var(--admin-text)]"> {persistedDownloadSource?.seeders ?? '—'}</span> ·
                Size: <span className="font-semibold text-[var(--admin-text)]"> {persistedDownloadSource?.sizeGb ?? '—'} GB</span>
              </div>
              <div className="mt-1">
                Torrent: <span className="font-semibold text-[var(--admin-text)]">{persistedDownloadRun?.torrentName || persistedDownloadSource?.name || '—'}</span> ·
                Link: <span className="font-semibold text-[var(--admin-text)]"> {persistedDownloadSource?.linkType || '—'}</span>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Duration</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">{formatDuration(Number(persistedDownloadRun?.durationMs || 0))}</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Peak Download</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(persistedDownloadRun?.peakDownloadMbps || 0).toFixed(3)} MB/s</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Peak Upload</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(persistedDownloadRun?.peakUploadMbps || 0).toFixed(3)} MB/s</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Downloaded</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(persistedDownloadRun?.downloadedMb || 0).toFixed(2)} MB</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Avg Download</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(persistedDownloadRun?.avgDownloadMbps || 0).toFixed(3)} MB/s</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Avg Upload</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(persistedDownloadRun?.avgUploadMbps || 0).toFixed(3)} MB/s</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Uploaded</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(persistedDownloadRun?.uploadedMb || 0).toFixed(2)} MB</div>
              </div>
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">
                <div className="text-[var(--admin-muted)]">Final State</div>
                <div className="mt-1 font-semibold text-[var(--admin-text)]">
                  {persistedDownloadRun?.finalState || '—'} · {Number(persistedDownloadRun?.finalSeeds || 0)} seeds / {Number(persistedDownloadRun?.finalPeers || 0)} peers
                </div>
              </div>
            </div>

            {Array.isArray(persistedDownloadRun?.states) && persistedDownloadRun.states.length ? (
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs text-[var(--admin-muted)]">
                State samples:{' '}
                <span className="font-semibold text-[var(--admin-text)]">
                  {persistedDownloadRun.states.map((row) => `${row.state}:${row.count}`).join(', ')}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {vpnTestRuntime ? (
        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-xs font-semibold text-[var(--admin-muted)]">Last Runtime Check Breakdown</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {vpnRuntimeChecks.map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-xs">
                <span className="text-[var(--admin-text)]">{item.label}</span>
                {item.skipped ? (
                  <span className="rounded-full bg-slate-500/15 px-2 py-0.5 font-semibold text-slate-600 dark:text-slate-300">Skipped</span>
                ) : item.ok ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">✓ Pass</span>
                ) : (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-700 dark:text-red-300">✕ Fail</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {vpnTestModalOpen ? (
        <div className="fixed inset-0 z-[95]">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close VPN test modal"
            onClick={() => {
              if (vpnTesting) return;
              setVpnTestModalOpen(false);
            }}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(920px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--admin-border)] p-5">
              <div>
                <div className="text-lg font-semibold text-[var(--admin-text)]">VPN Test Result</div>
                <div className="mt-1 text-sm text-[var(--admin-muted)]">Runtime checks for qB-only VPN routing.</div>
              </div>
              <button
                type="button"
                disabled={vpnTesting}
                onClick={() => setVpnTestModalOpen(false)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5">
              {vpnTesting ? (
                <div className="mb-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]">
                  Running checks: <span className="font-semibold">{VPN_TEST_PHASES[vpnTestPhaseIndex]}</span>
                </div>
              ) : null}
              {vpnTestError ? (
                <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{vpnTestError}</div>
              ) : null}
              {vpnTestResult ? (
                <div className="mb-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={vpnTestResult.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>
                      {vpnTestResult.ok ? '✓' : '✕'}
                    </span>
                    <span className="font-semibold text-[var(--admin-text)]">{vpnTestResult.summary || 'VPN test completed.'}</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--admin-muted)]">
                    Test latency: {Number.isFinite(Number(vpnTestResult?.durationMs)) ? `${Number(vpnTestResult.durationMs)} ms` : '—'}
                  </div>
                </div>
              ) : null}
              {vpnRuntimeChecks.length ? (
                <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                  <div className="text-xs font-semibold text-[var(--admin-muted)]">Checks</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {vpnRuntimeChecks.map((item) => (
                      <div key={item.key} className="flex items-center justify-between rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1.5 text-xs">
                        <span className="text-[var(--admin-text)]">{item.label}</span>
                        {item.skipped ? (
                          <span className="rounded-full bg-slate-500/15 px-2 py-0.5 font-semibold text-slate-600 dark:text-slate-300">Skipped</span>
                        ) : item.ok ? (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">✓ Pass</span>
                        ) : (
                          <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-700 dark:text-red-300">✕ Fail</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-[var(--admin-muted)]">
                    Host IP: <span className="font-mono text-[var(--admin-text)]">{vpnTestRuntime?.hostIp || '—'}</span> · VPN IP:{' '}
                    <span className="font-mono text-[var(--admin-text)]">{vpnTestRuntime?.vpnIp || '—'}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--admin-border)] p-4">
              <button
                type="button"
                onClick={() => setVpnTestModalOpen(false)}
                disabled={vpnTesting}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => testVpn()}
                disabled={vpnTesting}
                className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                {vpnTesting ? 'Testing…' : 'Run Test Again'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {internetTestModalOpen ? (
        <div className="fixed inset-0 z-[94]">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close VPN internet test modal"
            onClick={() => {
              if (internetTestBusy) return;
              setInternetTestModalOpen(false);
            }}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(940px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--admin-border)] p-5">
              <div>
                <div className="text-lg font-semibold text-[var(--admin-text)]">VPN Internet Test</div>
                <div className="mt-1 text-sm text-[var(--admin-muted)]">Checks whether the qB service user can reach the internet through the VPN path.</div>
              </div>
              <button
                type="button"
                disabled={internetTestBusy}
                onClick={() => setInternetTestModalOpen(false)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5">
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-[var(--admin-text)]">
                    {internetTestJob?.phaseLabel || (internetTestBusy ? 'Starting VPN internet test…' : 'No active test')}
                  </span>
                  <span className="text-xs text-[var(--admin-muted)]">{Math.round(Number(internetTestJob?.progress || 0))}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className={'h-full rounded-full transition-all duration-500 ' + (internetTestJob?.status === 'failed' ? 'bg-red-500' : 'bg-[--brand]')}
                    style={{ width: `${Math.max(internetTestJob ? 3 : 0, Math.min(100, Number(internetTestJob?.progress || 0)))}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-[var(--admin-muted)]">
                  {internetTestJob?.status === 'completed'
                    ? internetTestJob?.summary || 'Completed.'
                    : internetTestJob?.status === 'failed'
                      ? internetTestJob?.error || 'Failed.'
                      : 'Polling live status from server.'}
                </div>
              </div>

              {internetTestJob?.result ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">Host Public IP</div>
                    <div className="mt-1 font-mono text-[var(--admin-text)]">{internetTestJob?.result?.runtime?.hostIp || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">VPN Interface Public IP</div>
                    <div className="mt-1 font-mono text-[var(--admin-text)]">{internetConnectivity?.rootVpnIp || internetTestJob?.result?.runtime?.vpnIp || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">qB User Public IP</div>
                    <div className="mt-1 font-mono text-[var(--admin-text)]">{internetConnectivity?.qbUserIp || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">qB User HTTP</div>
                    <div className="mt-1 font-mono text-[var(--admin-text)]">{internetConnectivity?.qbHttpCode || '—'}</div>
                  </div>
                </div>
              ) : null}

              {internetFailureMode ? (
                <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={toneVars('warning')}>
                  {internetFailureMode === 'qb-user-only'
                    ? 'Host-level VPN is up, but the qB Linux user still cannot reach the internet over that path.'
                    : 'The VPN path itself did not complete the external internet check.'}
                </div>
              ) : null}

              {internetTestJob?.result ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">Root via VPN HTTP</div>
                    <div className="mt-1 font-mono text-[var(--admin-text)]">{internetConnectivity?.rootHttpCode || '—'}</div>
                    {internetConnectivity?.rootError ? <div className="mt-2 text-[11px] text-[var(--admin-muted)]">{internetConnectivity.rootError}</div> : null}
                  </div>
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">qB User Curl Error</div>
                    <div className="mt-1 text-[var(--admin-text)]">{internetConnectivity?.qbError || '—'}</div>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs font-semibold text-[var(--admin-muted)]">Server Logs</div>
                <div className="mt-2 max-h-[280px] space-y-2 overflow-auto">
                  {(Array.isArray(internetTestJob?.logs) ? internetTestJob.logs : []).length ? (
                    (Array.isArray(internetTestJob?.logs) ? internetTestJob.logs : []).map((row, index) => (
                      <div key={`${row?.at || index}-${index}`} className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs">
                        <div className="text-[var(--admin-muted)]">{row?.at ? new Date(row.at).toLocaleString() : '—'}</div>
                        <div className={row?.level === 'error' ? 'mt-1 text-red-700 dark:text-red-300' : 'mt-1 text-[var(--admin-text)]'}>
                          {row?.message || '—'}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs text-[var(--admin-muted)]">
                      No logs yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--admin-border)] p-4">
              <button
                type="button"
                onClick={() => setInternetTestModalOpen(false)}
                disabled={internetTestBusy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => startInternetTest()}
                disabled={internetTestBusy || vpnDiagnosticsDisabled || !vpnEnabled}
                className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                {internetTestBusy ? 'Running…' : 'Run Again'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {downloadTestModalOpen ? (
        <div className="fixed inset-0 z-[94]">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close VPN download test modal"
            onClick={() => {
              if (downloadTestBusy) return;
              setDownloadTestModalOpen(false);
            }}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(980px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--admin-border)] p-5">
              <div>
                <div className="text-lg font-semibold text-[var(--admin-text)]">VPN qB Download Test</div>
                <div className="mt-1 text-sm text-[var(--admin-muted)]">Downloads one ~1GB movie through qB with VPN enabled, then removes the benchmark torrent.</div>
              </div>
              <button
                type="button"
                disabled={downloadTestBusy}
                onClick={() => setDownloadTestModalOpen(false)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5">
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-[var(--admin-text)]">
                    {downloadTestJob?.phaseLabel || (downloadTestBusy ? 'Starting VPN-only download test…' : 'No active test')}
                  </span>
                  <span className="text-xs text-[var(--admin-muted)]">{Math.round(Number(downloadTestJob?.progress || 0))}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className={'h-full rounded-full transition-all duration-500 ' + (downloadTestJob?.status === 'failed' ? 'bg-red-500' : 'bg-[--brand]')}
                    style={{ width: `${Math.max(downloadTestJob ? 3 : 0, Math.min(100, Number(downloadTestJob?.progress || 0)))}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--admin-muted)]">
                  <span>Status: {downloadTestJob?.status || 'idle'}</span>
                  <span>Phase: {downloadTestJob?.phaseKey || '—'}</span>
                  <span>Progress source: live qB poll</span>
                </div>
              </div>

              {liveDownloadMeta ? (
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">Torrent State</div>
                    <div className="mt-1 font-semibold text-[var(--admin-text)]">{liveDownloadMeta?.state || '—'}</div>
                  </div>
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">Speed</div>
                    <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(liveDownloadMeta?.speedMbps || 0).toFixed(3)} MB/s</div>
                  </div>
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">Seeds / Peers</div>
                    <div className="mt-1 font-semibold text-[var(--admin-text)]">
                      {Number(liveDownloadMeta?.seeds || 0)} / {Number(liveDownloadMeta?.peers || 0)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
                    <div className="text-[var(--admin-muted)]">Downloaded</div>
                    <div className="mt-1 font-semibold text-[var(--admin-text)]">{Number(liveDownloadMeta?.downloadedMb || 0).toFixed(2)} MB</div>
                  </div>
                </div>
              ) : null}

              {downloadTestJob?.result?.sourceSelection ? (
                <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs text-[var(--admin-muted)]">
                  <div>
                    Test Movie:{' '}
                    <span className="font-semibold text-[var(--admin-text)]">
                      {downloadTestJob?.result?.sourceSelection?.title || '—'}
                      {downloadTestJob?.result?.sourceSelection?.year ? ` (${downloadTestJob.result.sourceSelection.year})` : ''}
                    </span>
                  </div>
                  <div className="mt-1">
                    Source: <span className="font-semibold text-[var(--admin-text)]">{downloadTestJob?.result?.sourceSelection?.provider || '—'}</span> ·
                    Seeders: <span className="font-semibold text-[var(--admin-text)]"> {downloadTestJob?.result?.sourceSelection?.seeders ?? '—'}</span> ·
                    Size: <span className="font-semibold text-[var(--admin-text)]"> {downloadTestJob?.result?.sourceSelection?.sizeGb ?? '—'} GB</span>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs font-semibold text-[var(--admin-muted)]">Server Logs</div>
                <div className="mt-2 max-h-[280px] space-y-2 overflow-auto">
                  {(Array.isArray(downloadTestJob?.logs) ? downloadTestJob.logs : []).length ? (
                    (Array.isArray(downloadTestJob?.logs) ? downloadTestJob.logs : []).map((row, index) => (
                      <div key={`${row?.at || index}-${index}`} className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs">
                        <div className="text-[var(--admin-muted)]">{row?.at ? new Date(row.at).toLocaleString() : '—'}</div>
                        <div className={row?.level === 'error' ? 'mt-1 text-red-700 dark:text-red-300' : 'mt-1 text-[var(--admin-text)]'}>
                          {row?.message || '—'}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs text-[var(--admin-muted)]">
                      No logs yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--admin-border)] p-4">
              <button
                type="button"
                onClick={() => setDownloadTestModalOpen(false)}
                disabled={downloadTestBusy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => startDownloadTest()}
                disabled={downloadTestBusy || vpnDiagnosticsDisabled || !vpnEnabled}
                className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                {downloadTestBusy ? 'Running…' : 'Run Again'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {comparisonModalOpen ? (
        <div className="fixed inset-0 z-[94]">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close comparison modal"
            onClick={() => {
              if (comparisonBusy) return;
              setComparisonModalOpen(false);
            }}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(940px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--admin-border)] p-5">
              <div>
                <div className="text-lg font-semibold text-[var(--admin-text)]">Download Comparison Progress</div>
                <div className="mt-1 text-sm text-[var(--admin-muted)]">VPN vs no-VPN full benchmark runtime details.</div>
              </div>
              <button
                type="button"
                disabled={comparisonBusy}
                onClick={() => setComparisonModalOpen(false)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5">
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-[var(--admin-text)]">{comparisonStatus}</span>
                  <span className="text-xs text-[var(--admin-muted)]">{Math.round(Number(comparisonProgress || 0))}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className={'h-full rounded-full transition-all duration-500 ' + (comparisonError ? 'bg-red-500' : 'bg-[--brand]')}
                    style={{ width: `${Math.max(comparisonBusy || comparisonResult || comparisonError ? 3 : 0, Math.min(100, Number(comparisonProgress || 0)))}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-[var(--admin-muted)]">
                  Elapsed: {formatDuration(comparisonElapsedMs)}
                  {comparisonStartedAt ? ` · Started: ${new Date(comparisonStartedAt).toLocaleString()}` : ''}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                <div className="text-xs font-semibold text-[var(--admin-muted)]">Phases</div>
                <div className="mt-2 space-y-2">
                  {COMPARISON_PHASES.map((phase, index) => {
                    const failedIndex = comparisonFailurePhaseIndex >= 0 ? comparisonFailurePhaseIndex : comparisonPhaseIndex;
                    const livePhaseIndex = comparisonPhaseIndex;
                    let badgeLabel = 'Pending';
                    let badgeClass = 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
                    if (comparisonBusy) {
                      if (index === livePhaseIndex) {
                        badgeLabel = 'Running';
                        badgeClass = 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
                      } else if (index < livePhaseIndex) {
                        badgeLabel = 'Completed';
                        badgeClass = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
                      }
                    } else if (comparisonError) {
                      if (index < failedIndex) {
                        badgeLabel = 'Completed';
                        badgeClass = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
                      } else if (index === failedIndex) {
                        badgeLabel = 'Failed';
                        badgeClass = 'bg-red-500/15 text-red-700 dark:text-red-300';
                      } else {
                        badgeLabel = 'Skipped';
                        badgeClass = 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
                      }
                    } else if (comparisonResult) {
                      badgeLabel = 'Done';
                      badgeClass = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
                    }
                    return (
                      <div
                        key={phase.key}
                        className="flex items-start justify-between gap-3 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-2 text-xs"
                      >
                        <div>
                          <div className="font-medium text-[var(--admin-text)]">{phase.label}</div>
                          <div className="mt-0.5 text-[var(--admin-muted)]">{phase.note}</div>
                        </div>
                        <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + badgeClass}>{badgeLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {comparisonError ? (
                <div className="mt-3 rounded-lg border px-3 py-2 text-xs" style={toneVars('danger')}>
                  {comparisonError}
                </div>
              ) : null}

              {comparisonResult ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs text-[var(--admin-muted)]">
                    <div>
                      Test Movie:{' '}
                      <span className="font-semibold text-[var(--admin-text)]">
                        {comparisonResult?.sourceSelection?.title || '—'}
                        {comparisonResult?.sourceSelection?.year ? ` (${comparisonResult.sourceSelection.year})` : ''}
                      </span>
                    </div>
                    <div className="mt-1">
                      Source: <span className="font-semibold text-[var(--admin-text)]">{comparisonResult?.sourceSelection?.provider || '—'}</span> ·
                      Seeders: <span className="font-semibold text-[var(--admin-text)]"> {comparisonResult?.sourceSelection?.seeders ?? '—'}</span> ·
                      Link: <span className="font-semibold text-[var(--admin-text)]"> {comparisonResult?.sourceSelection?.linkType || '—'}</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-[var(--admin-border)]">
                    <table className="min-w-full text-xs">
                      <thead className="bg-[var(--admin-surface)] text-[var(--admin-muted)]">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Mode</th>
                          <th className="px-3 py-2 text-left font-semibold">Avg Speed</th>
                          <th className="px-3 py-2 text-left font-semibold">Max Speed</th>
                          <th className="px-3 py-2 text-left font-semibold">Downloaded</th>
                          <th className="px-3 py-2 text-left font-semibold">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(comparisonResult?.runs) ? comparisonResult.runs : []).map((row) => (
                          <tr key={row?.mode || row?.label} className="border-t border-[var(--admin-border)] bg-[var(--admin-surface-2)]">
                            <td className="px-3 py-2 font-medium text-[var(--admin-text)]">{row?.label || row?.mode || '—'}</td>
                            <td className="px-3 py-2 text-[var(--admin-text)]">{Number(row?.avgSpeedMbps || 0).toFixed(3)} MB/s</td>
                            <td className="px-3 py-2 text-[var(--admin-text)]">{Number(row?.maxSpeedMbps || 0).toFixed(3)} MB/s</td>
                            <td className="px-3 py-2 text-[var(--admin-text)]">{Number(row?.downloadedMb || 0).toFixed(2)} MB</td>
                            <td className="px-3 py-2 text-[var(--admin-text)]">{Math.round((Number(row?.durationMs || 0) || 0) / 1000)}s</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg border px-3 py-2 text-xs" style={comparisonResult?.restore?.ok ? toneVars('success') : toneVars('danger')}>
                    Restore state: {comparisonResult?.restore?.summary || '—'}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--admin-border)] p-4">
              <button
                type="button"
                onClick={() => setComparisonModalOpen(false)}
                disabled={comparisonBusy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => runComparison()}
                disabled={comparisonBusy || loading || vpnApplying || vpnTesting}
                className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--brand)' }}
              >
                {comparisonBusy ? 'Running…' : 'Run Again'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <EditModal
        open={vpnEditOpen}
        title="Edit VPN Routing (qB-only)"
        description="Configure optional qB-only VPN routing using Private Internet Access (PIA)."
        error={err}
        success={ok}
        onCancel={async () => {
          setVpnEditOpen(false);
          setVpnPassword('');
          setVpnUsername('');
          await load();
        }}
        onSave={async () => {
          const saved = await saveVpnSettings();
          if (saved) setVpnEditOpen(false);
        }}
        saveDisabled={vpnSaveDisabled}
        saving={vpnBusy}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Enable qB VPN Routing"
            note="When enabled, only qBittorrent service traffic is routed through VPN. App and IPTV traffic stay on normal network."
          >
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input type="checkbox" checked={vpnEnabled} onChange={(e) => setVpnEnabled(e.target.checked)} />
              <span>{vpnEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>

          <Field label="Provider" note="Current supported provider is PIA WireGuard.">
            <Input value="PIA (WireGuard)" disabled className="opacity-80" />
          </Field>

          <Field
            label="PIA Region"
            hint="Select nearest/fast region"
            note="Choose the VPN exit region used by qBittorrent traffic."
          >
            <div className="flex gap-2">
              <select
                value={vpnRegionId}
                onChange={(e) => {
                  const next = e.target.value;
                  setVpnRegionId(next);
                  const matched = vpnRegions.find((row) => String(row?.id || '') === String(next || ''));
                  setVpnRegionName(matched?.name || '');
                }}
                className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              >
                {vpnRegions.length ? null : <option value={vpnRegionId || 'ph'}>{vpnRegionId || 'ph'}</option>}
                {vpnRegions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {row.country ? ` • ${row.country}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadVpnRegions({ silent: false })}
                disabled={vpnRegionsBusy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
              >
                {vpnRegionsBusy ? '…' : 'Refresh'}
              </button>
            </div>
          </Field>

          <Field
            label="Kill Switch"
            note="Blocks qBittorrent traffic if VPN is down, preventing non-VPN fallback for qB downloads."
          >
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={vpnKillSwitchEnabled}
                onChange={(e) => setVpnKillSwitchEnabled(e.target.checked)}
              />
              <span>{vpnKillSwitchEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>

          <Field
            label="PIA Username"
            hint={vpnInfo?.hasCredentials ? `Saved (${vpnInfo?.usernamePreview || 'hidden'})` : 'Required'}
            note="Use your PIA VPN username from PIA Client Control Panel (not your email). Stored encrypted at rest."
          >
            <Input
              value={vpnUsername}
              onChange={(e) => setVpnUsername(e.target.value)}
              placeholder={vpnInfo?.hasCredentials ? '(leave blank to keep current)' : 'PIA username (e.g. p1234567)'}
            />
          </Field>

          <Field
            label="PIA Password"
            hint={vpnInfo?.hasCredentials ? 'Saved (hidden)' : 'Required'}
            note="PIA account password. Stored encrypted at rest."
          >
            <Input
              value={vpnPassword}
              onChange={(e) => setVpnPassword(e.target.value)}
              placeholder={vpnInfo?.hasCredentials ? '(leave blank to keep current)' : 'PIA password'}
              type="password"
              autoComplete="new-password"
            />
          </Field>

          <Field
            label="Dispatch Guard"
            note="When enabled, scheduler blocks new torrent dispatch if VPN health check fails."
          >
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={vpnRequiredForDispatch}
                onChange={(e) => setVpnRequiredForDispatch(e.target.checked)}
              />
              <span>{vpnRequiredForDispatch ? 'Require healthy VPN' : 'Do not block dispatch'}</span>
            </label>
          </Field>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-xs text-[var(--admin-muted)]">
          Saving this modal only stores settings. Use <span className="font-semibold text-[var(--admin-text)]">Test VPN</span> on the main card
          to validate credentials and run/apply runtime checks.
        </div>
      </EditModal>
    </div>
  );
}
