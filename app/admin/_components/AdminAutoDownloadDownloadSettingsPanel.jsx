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

const VPN_TEST_PHASES = ['Checking Engine Host access', 'Checking VPN route rules', 'Checking WireGuard session', 'Validating VPN public IP'];

function provisionPhaseForProgress(progress, mode = 'install') {
  if (progress < 20) return 'Connecting to Engine Host…';
  if (progress < 45) return mode === 'reconfigure' ? 'Validating existing qBittorrent setup…' : 'Checking system requirements…';
  if (progress < 70) return mode === 'reconfigure' ? 'Applying updated qBittorrent configuration…' : 'Installing/configuring qBittorrent…';
  if (progress < 92) return 'Restarting service and applying settings…';
  return 'Finalizing…';
}

export default function AdminAutoDownloadDownloadSettingsPanel({ showVpnSection = true } = {}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [vpnBusy, setVpnBusy] = useState(false);
  const [vpnApplying, setVpnApplying] = useState(false);
  const [vpnTesting, setVpnTesting] = useState(false);
  const [vpnRegionsBusy, setVpnRegionsBusy] = useState(false);
  const [qbRevealBusy, setQbRevealBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [optionsEditOpen, setOptionsEditOpen] = useState(false);
  const [vpnEditOpen, setVpnEditOpen] = useState(false);
  const [qbPasswordVisible, setQbPasswordVisible] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState(0);
  const [provisionPhase, setProvisionPhase] = useState('');
  const [provisionOutput, setProvisionOutput] = useState('');

  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState(8080);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [connectionMode, setConnectionMode] = useState('ssh');
  const [autoDeleteCompletedTorrents, setAutoDeleteCompletedTorrents] = useState(true);
  const [autoDeleteCompletedDelayMinutes, setAutoDeleteCompletedDelayMinutes] = useState(30);
  const [lanAddress, setLanAddress] = useState('0.0.0.0');
  const [authSubnetAllowlist, setAuthSubnetAllowlist] = useState('127.0.0.1/32');
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

  const [info, setInfo] = useState(null);
  const [vpnInfo, setVpnInfo] = useState(null);
  const serviceUserDisplay = info?.serviceUser || 'qbvpn';
  const vpnRuntimeChecks = useMemo(() => {
    if (!vpnTestRuntime || typeof vpnTestRuntime !== 'object') return [];
    return [
      { key: 'iface', label: 'Interface up', ok: vpnTestRuntime.ifaceUp === true },
      { key: 'rule', label: 'Policy route rule', ok: vpnTestRuntime.ruleOk === true },
      { key: 'mark', label: 'Owner mark rule', ok: vpnTestRuntime.markOk === true },
      {
        key: 'kill',
        label: 'Kill switch',
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

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Provisions qBittorrent-nox on the Engine Host and configures it as the managed job runner for authorized content.',
        'Movies/Series downloads use different save paths (configured from Storage & Mount).',
      ],
    },
    {
      title: 'Connection mode',
      items: [
        'SSH Tunnel: backend talks to qBittorrent bound to 127.0.0.1 on the Engine Host (recommended).',
        'LAN Bind: qBittorrent listens on LAN; secure it with firewall + allowlist.',
      ],
    },
  ];

  const canSave = useMemo(() => {
    const portOk = Number(port) > 0 && Number(port) < 65536;
    const userOk = Boolean(username.trim());
    const passOk = Boolean(password) || Boolean(info?.hasCredentials);
    const lanOk = connectionMode !== 'lan' || Boolean(String(lanAddress || '').trim());
    return Boolean(portOk && userOk && passOk && lanOk);
  }, [port, username, password, connectionMode, lanAddress, info?.hasCredentials]);

  const optionsCanSave = useMemo(() => {
    const delayOk = Number.isFinite(Number(autoDeleteCompletedDelayMinutes)) && Number(autoDeleteCompletedDelayMinutes) >= 0;
    return Boolean(delayOk);
  }, [autoDeleteCompletedDelayMinutes]);

  const vpnCanSave = useMemo(() => {
    if (!vpnEnabled) return true;
    const regionOk = Boolean(String(vpnRegionId || '').trim());
    const usernameOk = Boolean(String(vpnUsername || '').trim()) || Boolean(vpnInfo?.hasCredentials);
    const passwordOk = Boolean(vpnPassword) || Boolean(vpnInfo?.hasCredentials);
    return Boolean(regionOk && usernameOk && passwordOk);
  }, [vpnEnabled, vpnRegionId, vpnUsername, vpnPassword, vpnInfo?.hasCredentials]);

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
        fetch('/api/admin/autodownload/download-settings/vpn', { cache: 'no-store' }).catch(() => null),
      ]);
      const qbJson = await qbResp.json().catch(() => ({}));
      if (!qbResp.ok || !qbJson?.ok) throw new Error(qbJson?.error || 'Failed to load qBittorrent settings.');
      const qb = qbJson.qb || {};
      setEnabled(Boolean(qb.enabled));
      setPort(Number(qb.port || 8080));
      setConnectionMode(qb.connectionMode === 'lan' ? 'lan' : 'ssh');
      setPassword('');
      setQbPasswordVisible(false);
      setAutoDeleteCompletedTorrents(qb.autoDeleteCompletedTorrents !== false);
      setAutoDeleteCompletedDelayMinutes(Number(qb.autoDeleteCompletedDelayMinutes ?? 30));
      setLanAddress(String(qb?.lanBind?.address || '0.0.0.0'));
      setAuthSubnetAllowlist(String(qb?.lanBind?.authSubnetAllowlist || '127.0.0.1/32'));
      setInfo(qb);

      if (vpnResp) {
        const vpnJson = await vpnResp.json().catch(() => ({}));
        if (vpnResp.ok && vpnJson?.ok) {
          const vpn = vpnJson?.vpn || {};
          setVpnEnabled(Boolean(vpn?.enabled));
          setVpnRegionId(String(vpn?.regionId || 'ph'));
          setVpnRegionName(String(vpn?.regionName || ''));
          setVpnKillSwitchEnabled(vpn?.killSwitchEnabled !== false);
          setVpnRequiredForDispatch(vpn?.requiredForDispatch !== false);
          setVpnUsername('');
          setVpnPassword('');
          setVpnInfo(vpn);
        }
      }

      await loadVpnRegions({ silent: true });
    } catch (e) {
      setErr(e?.message || 'Failed to load qBittorrent settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveConnection = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/download-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          port: Number(port),
          username,
          password,
          connectionMode,
          lanBind: {
            address: lanAddress,
            authSubnetAllowlist,
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save.');
      setOk('Saved.');
      setPassword('');
      setInfo(j.qb || null);
      return true;
    } catch (e) {
      setErr(e?.message || 'Failed to save.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const revealSavedQbPassword = async () => {
    if (qbPasswordVisible) {
      setQbPasswordVisible(false);
      return;
    }
    const adminPassword = window.prompt('Enter your admin password to show qBittorrent WebUI password:');
    if (!adminPassword) return;
    setQbRevealBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/download-settings/reveal-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adminPassword }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to verify admin password.');
      setPassword(String(j?.password || ''));
      setQbPasswordVisible(true);
      setOk('qBittorrent password is now visible in this form.');
    } catch (e) {
      setErr(e?.message || 'Failed to reveal qBittorrent password.');
    } finally {
      setQbRevealBusy(false);
    }
  };

  const saveOptions = async () => {
    setOptionsBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/download-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoDeleteCompletedTorrents,
          autoDeleteCompletedDelayMinutes: Number(autoDeleteCompletedDelayMinutes || 0),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save qBittorrent options.');
      setOk('qBittorrent options saved.');
      setInfo(j.qb || null);
      return true;
    } catch (e) {
      setErr(e?.message || 'Failed to save qBittorrent options.');
      return false;
    } finally {
      setOptionsBusy(false);
    }
  };

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
      setVpnPassword('');
      setVpnUsername('');
      const savedVpn = j?.vpn || null;
      setVpnInfo(savedVpn);
      setVpnEnabled(savedVpn?.enabled === true);
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
      setVpnInfo(result?.vpn || vpnInfo || null);
      setVpnEnabled(result?.vpn?.enabled === true);
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
      if (result?.runtime) setVpnTestRuntime(result.runtime);
      else setVpnTestRuntime(null);
      if (result?.vpn) setVpnInfo(result.vpn);
      const passed = Boolean(r.ok && j?.ok);
      setVpnTestResult({
        ok: passed,
        summary: result?.summary || (passed ? 'VPN check passed.' : j?.error || 'VPN test failed.'),
        runtime: result?.runtime || null,
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

  const testApi = async () => {
    setTesting(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/download-settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port: Number(port) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Test failed.');
      setOk(j?.result?.summary || 'qBittorrent OK.');
      await load();
    } catch (e) {
      setErr(e?.message || 'Test failed.');
    } finally {
      setTesting(false);
    }
  };

  const provision = async () => {
    if (!confirm('Install and configure qBittorrent-nox on the Engine Host now?')) return;
    const progressMode = info?.lastTestOk === true ? 'reconfigure' : 'install';
    setProvisioning(true);
    setErr('');
    setOk('');
    setProvisionOutput('');
    setProvisionProgress(6);
    setProvisionPhase('Preparing provisioning…');
    let progressTimer = null;
    try {
      progressTimer = setInterval(() => {
        setProvisionProgress((prev) => {
          const step = prev < 40 ? 6 : prev < 70 ? 4 : 2;
          const next = Math.min(prev + step, 92);
          setProvisionPhase(provisionPhaseForProgress(next, progressMode));
          return next;
        });
      }, 900);

      const r = await fetch('/api/admin/autodownload/download-settings/provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          port: Number(port),
          username,
          password,
          connectionMode,
          lanBind: {
            address: lanAddress,
            authSubnetAllowlist,
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Provisioning failed.');
      setProvisionProgress(100);
      setProvisionPhase('Provisioning complete.');
      setOk(j?.result?.message || 'Provisioned.');
      const output = [j?.result?.output, j?.result?.warnings].filter(Boolean).join('\n').trim();
      setProvisionOutput(output);
      setPassword('');
      await load();
    } catch (e) {
      setProvisionProgress(0);
      setProvisionPhase('');
      setErr(e?.message || 'Provisioning failed.');
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setProvisioning(false);
    }
  };

  const svc = async (action) => {
    setServiceBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/download-settings/service', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Service action failed.');
      setOk(`Service: ${j?.result?.serviceStatus || 'ok'}`);
      await load();
    } catch (e) {
      setErr(e?.message || 'Service action failed.');
    } finally {
      setServiceBusy(false);
    }
  };

  const saveDisabled = loading || busy || !canSave;
  const optionsSaveDisabled = loading || optionsBusy || !optionsCanSave;
  const vpnSaveDisabled = loading || vpnBusy || vpnApplying || !vpnCanSave;

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">qBittorrent Settings (qBittorrent-nox)</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Installs qBittorrent on the Engine Host and uses it as the managed download client. Use{' '}
            <span className="font-semibold">SSH</span> mode to keep WebUI bound to <code>127.0.0.1</code> (recommended), or{' '}
            <span className="font-semibold">LAN</span> mode to bind to your LAN interface.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="qBittorrent Settings — Notes" sections={notes} />
          <button
            onClick={testApi}
            disabled={loading || testing}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {testing ? 'Testing…' : 'Test qBittorrent API'}
          </button>
          <button
            onClick={provision}
            disabled={loading || provisioning}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {provisioning ? 'Provisioning…' : 'Provision qBittorrent'}
          </button>
        </div>
      </div>

      {!editOpen && !optionsEditOpen && !vpnEditOpen && err ? (
        <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
      ) : null}
      {!editOpen && !optionsEditOpen && !vpnEditOpen && ok ? (
        <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div>
      ) : null}
      {info?.lastTestOk !== true ? (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-black data-[theme=dark]:text-amber-100">
          Save credentials first, then run <span className="font-semibold">Provision qBittorrent</span> and{' '}
          <span className="font-semibold">Test qBittorrent API</span>.
        </div>
      ) : null}
      {provisioning ? (
        <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-black data-[theme=dark]:text-sky-100">{provisionPhase || 'Provisioning…'}</span>
            <span className="font-semibold text-black data-[theme=dark]:text-sky-100">{Math.round(provisionProgress)}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-sky-950/15">
            <div
              className="h-full rounded-full bg-sky-600 transition-all duration-500"
              style={{ width: `${Math.max(6, Math.min(100, provisionProgress))}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-black/80 data-[theme=dark]:text-sky-100/90">
            Estimated progress while remote install/config commands are running.
          </div>
        </div>
      ) : null}
      {provisionOutput ? (
        <details className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
          <summary className="cursor-pointer font-semibold">Last Provision Output</summary>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2 text-[11px]">
            {provisionOutput}
          </pre>
        </details>
      ) : null}

      <div className="mt-5 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Configuration</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">View current settings. Click Edit to update.</div>
          </div>
          <EditIconButton onClick={() => setEditOpen(true)} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Enabled</div>
            <div className="mt-1 text-sm font-semibold">{enabled ? 'Yes' : 'No'}</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">WebUI</div>
            <div className="mt-1 font-mono text-xs">{`${info?.host || '127.0.0.1'}:${info?.port || port}`}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Mode: {connectionMode === 'lan' ? 'LAN Bind' : 'SSH Tunnel'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Credentials</div>
            <div className="mt-1 text-sm font-semibold">{info?.hasCredentials ? 'Saved (hidden)' : password ? 'Entered (not saved)' : 'Not set'}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Username: {username || '—'}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Service user: {serviceUserDisplay}</div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => revealSavedQbPassword()}
                disabled={loading || qbRevealBusy || (!qbPasswordVisible && !info?.hasCredentials)}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2.5 py-1.5 text-xs hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {qbRevealBusy ? 'Checking…' : qbPasswordVisible ? 'Hide Password' : 'Show Password'}
              </button>
              {qbPasswordVisible ? (
                <code className="max-w-[180px] truncate rounded bg-black/5 px-2 py-1 text-[11px] text-[var(--admin-text)] data-[theme=dark]:bg-white/10">
                  {password || '—'}
                </code>
              ) : null}
            </div>
          </div>
        </div>

        {info?.moviesSavePath || info?.seriesSavePath ? (
          <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 text-sm">
            <div className="font-semibold">Default save paths</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>
                <div className="text-xs text-[var(--admin-muted)]">Movies</div>
                <div className="mt-1 font-mono text-xs">{info.moviesSavePath || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--admin-muted)]">Series</div>
                <div className="mt-1 font-mono text-xs">{info.seriesSavePath || '—'}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">qBittorrent Options</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Configure torrent lifecycle and queue behavior independently from connection/network settings.
            </div>
          </div>
          <EditIconButton onClick={() => setOptionsEditOpen(true)} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Auto-delete completed</div>
            <div className="mt-1 text-sm font-semibold">{autoDeleteCompletedTorrents ? 'Enabled' : 'Disabled'}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Delay: {Number(autoDeleteCompletedDelayMinutes || 0)} minute(s)</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Queue management</div>
            <div className="mt-1 text-sm font-semibold">Managed in qBittorrent WebUI</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Use qB Options directly if you want to change active downloads/uploads/torrents.</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Last options apply</div>
            <div className={'mt-1 text-sm font-semibold ' + (info?.lastOptionsAppliedOk ? 'text-emerald-300' : 'text-red-300')}>
              {info?.lastOptionsSummary || (info?.lastOptionsAppliedOk ? 'Applied' : info?.lastOptionsError || 'Not applied yet')}
            </div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              {info?.lastOptionsAppliedAt ? new Date(info.lastOptionsAppliedAt).toLocaleString() : '—'}
            </div>
          </div>
        </div>
      </div>

      {showVpnSection ? (
        <div className="mt-5 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">VPN Options (qB-only)</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Routes only qBittorrent service traffic (dedicated Linux user <code>{serviceUserDisplay}</code>) through VPN. Web/app traffic stays on normal network.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => testVpn()}
              disabled={loading || vpnTesting}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {vpnTesting ? 'Testing VPN…' : 'Test VPN'}
            </button>
            <EditIconButton onClick={() => setVpnEditOpen(true)} />
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Status</div>
            <div className="mt-1 text-sm font-semibold">{vpnEnabled ? 'Enabled' : 'Disabled'}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Region: {vpnInfo?.regionName || vpnRegionName || vpnRegionId || '—'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Safety</div>
            <div className="mt-1 text-sm font-semibold">Kill switch: {vpnInfo?.killSwitchEnabled !== false ? 'On' : 'Off'}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Dispatch guard: {vpnInfo?.requiredForDispatch !== false ? 'Require healthy VPN' : 'Disabled'}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Last VPN Test</div>
            <div className="mt-1 text-sm font-semibold">{vpnInfo?.lastTestSummary || 'Not tested yet'}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              {vpnInfo?.lastTestAt ? new Date(vpnInfo.lastTestAt).toLocaleString() : '—'}
            </div>
          </div>
        </div>
        {vpnTestRuntime ? (
          <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs font-semibold text-[var(--admin-muted)]">Last Test Breakdown</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {vpnRuntimeChecks.map((item) => (
                <div key={item.key} className="flex items-center justify-between rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-xs">
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
              Host IP: <span className="font-mono text-[var(--admin-text)]">{vpnTestRuntime.hostIp || '—'}</span> · VPN IP:{' '}
              <span className="font-mono text-[var(--admin-text)]">{vpnTestRuntime.vpnIp || '—'}</span>
            </div>
          </div>
        ) : null}
        </div>
      ) : null}

      <div className="mt-5 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">Status</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Last test: {info?.lastTestAt ? new Date(info.lastTestAt).toLocaleString() : 'Not tested yet'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => svc('start')}
              disabled={loading || serviceBusy}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              Start
            </button>
            <button
              onClick={() => svc('stop')}
              disabled={loading || serviceBusy}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              Stop
            </button>
            <button
              onClick={() => svc('restart')}
              disabled={loading || serviceBusy}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              Restart
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">WebUI host</div>
            <div className="mt-1 text-xs font-mono">{info?.host || '—'}</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Port</div>
            <div className="mt-1 text-sm font-semibold">{info?.port || port}</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Last test</div>
            <div className={'mt-1 text-sm font-semibold ' + (info?.lastTestOk ? 'text-emerald-300' : 'text-red-300')}>
              {info?.lastTestSummary || (info?.lastTestOk ? 'OK' : 'Not tested')}
            </div>
          </div>
        </div>
      </div>

      {showVpnSection && vpnTestModalOpen ? (
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
                  {!vpnEnabled ? (
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      VPN is currently disabled. Enable it in VPN settings and save to run full tunnel checks.
                    </div>
                  ) : null}
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

      <EditModal
        open={editOpen}
        title="Edit qBittorrent Settings"
        description="Update qBittorrent-nox connection and credentials. Save credentials first, then provision/test from this page."
        error={err}
        success={ok}
        onCancel={async () => {
          setEditOpen(false);
          await load();
          setPassword('');
          setQbPasswordVisible(false);
        }}
        onSave={async () => {
          const okSaved = await saveConnection();
          if (okSaved) setEditOpen(false);
        }}
        saveDisabled={saveDisabled}
        saving={busy}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Enable qBittorrent Integration"
            hint="v1 single Engine Host"
            note="Turns qBittorrent managed-client integration on/off for AutoDownload jobs. This does not enable movie/series scheduling by itself."
          >
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>{enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>

          <Field label="WebUI Port" note="Port used by qBittorrent WebUI on the Engine Host (default 8080).">
            <Input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value || 8080))} />
          </Field>

          <Field
            label="Connection mode"
            hint="SSH is recommended"
            note="SSH Tunnel keeps qBittorrent bound to 127.0.0.1 on the Engine Host (safer). LAN Bind exposes it on your LAN (use firewall + allowlist)."
          >
            <select
              value={connectionMode}
              onChange={(e) => setConnectionMode(e.target.value === 'lan' ? 'lan' : 'ssh')}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
              <option value="ssh">SSH Tunnel (bind 127.0.0.1)</option>
              <option value="lan">LAN Bind (bind to LAN)</option>
            </select>
          </Field>

          <Field label="WebUI Username" hint="Not displayed after save" note="Username for qBittorrent WebUI. Stored encrypted at rest.">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="username" />
          </Field>

          <Field label="WebUI Password" hint="Not displayed after save" note="Password for qBittorrent WebUI. Stored encrypted at rest.">
            <div className="flex items-center gap-2">
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={info?.hasCredentials ? '(already saved)' : '••••••••'}
                type={qbPasswordVisible ? 'text' : 'password'}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => revealSavedQbPassword()}
                disabled={loading || qbRevealBusy || (!qbPasswordVisible && !info?.hasCredentials)}
                className="shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {qbRevealBusy ? 'Checking…' : qbPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
        </div>

        {connectionMode === 'lan' ? (
          <details className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <summary className="cursor-pointer text-sm font-semibold">LAN bind options</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Bind address" hint="Example: 0.0.0.0" note="Network interface to listen on (use a LAN-only IP when possible).">
                <Input value={lanAddress} onChange={(e) => setLanAddress(e.target.value)} placeholder="0.0.0.0" />
              </Field>
              <Field
                label="Auth subnet allowlist"
                hint="Comma-separated CIDR list"
                note="Allow requests only from these subnets. Example: 192.168.0.0/16. Use with firewall for best protection."
              >
                <Input
                  value={authSubnetAllowlist}
                  onChange={(e) => setAuthSubnetAllowlist(e.target.value)}
                  placeholder="127.0.0.1/32,192.168.0.0/16"
                />
              </Field>
            </div>
            <div className="mt-2 text-xs text-[var(--admin-muted)]">
              Keep qBittorrent WebUI restricted to LAN only. Avoid exposing it to the public internet.
            </div>
          </details>
        ) : null}

        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-sm">
          <div className="font-semibold">Tip</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Save first, then click <span className="font-semibold">Provision qBittorrent</span> and{' '}
            <span className="font-semibold">Test qBittorrent API</span>.
          </div>
        </div>
      </EditModal>

      <EditModal
        open={optionsEditOpen}
        title="Edit qBittorrent Options"
        description="Control torrent lifecycle behavior managed by this app."
        error={err}
        success={ok}
        onCancel={async () => {
          setOptionsEditOpen(false);
          await load();
        }}
        onSave={async () => {
          const okSaved = await saveOptions();
          if (okSaved) setOptionsEditOpen(false);
        }}
        saveDisabled={optionsSaveDisabled}
        saving={optionsBusy}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Auto-delete Completed Torrents"
            note="Deletes torrent entries from qBittorrent after completion delay. Media files remain for cleaning/release."
          >
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={autoDeleteCompletedTorrents}
                onChange={(e) => setAutoDeleteCompletedTorrents(e.target.checked)}
              />
              <span>{autoDeleteCompletedTorrents ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>
          <Field
            label="Delete Delay (minutes)"
            note="How long completed torrents stay in qBittorrent before auto-delete."
          >
            <Input
              type="number"
              min={0}
              max={4320}
              value={autoDeleteCompletedDelayMinutes}
              onChange={(e) => setAutoDeleteCompletedDelayMinutes(Number(e.target.value || 0))}
            />
          </Field>
        </div>
        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-sm">
          <div className="font-semibold">Queue limits</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Maximum active downloads/uploads/torrents are no longer managed here. Edit them directly in qBittorrent WebUI if needed.
          </div>
        </div>
      </EditModal>

      {showVpnSection ? (
        <EditModal
        open={vpnEditOpen}
        title="Edit qBittorrent VPN Options"
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
            note="When enabled and applied, only qBittorrent service traffic is routed through VPN. App and IPTV traffic stay on normal network."
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
      ) : null}
    </div>
  );
}
