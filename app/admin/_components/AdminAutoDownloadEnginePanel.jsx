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

function Textarea(props) {
  return (
    <textarea
      {...props}
      className={
        'min-h-[120px] w-full resize-y rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30 ' +
        (props.className || '')
      }
    />
  );
}

export default function AdminAutoDownloadEnginePanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [sudoPassword, setSudoPassword] = useState('');

  const [lastTest, setLastTest] = useState(null);

  const notes = [
    {
      title: 'What is the Engine Host?',
      items: [
        'The Engine Host is the Ubuntu server that mounts the NAS and runs automation (downloads, processing, health checks).',
        'The Admin Portal connects to it via SSH to execute commands safely and idempotently.',
      ],
    },
    {
      title: 'Test SSH',
      items: ['Checks reachability, OS basics, and sudo capability.', 'Run this before saving to avoid broken automation.'],
    },
    {
      title: 'Secrets',
      items: ['SSH credentials are encrypted at rest.', 'Secrets are never logged.'],
    },
  ];

  const canSave = useMemo(() => {
    if (!host.trim() || !username.trim()) return false;
    if (authType === 'password') return Boolean(password);
    return Boolean(privateKey.trim());
  }, [authType, host, username, password, privateKey]);

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/autodownload/engine-host', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load Engine Host.');
      const h = j.engineHost || null;
      if (h) {
        setHost(h.host || '');
        setPort(Number(h.port || 22));
        setUsername(h.username || '');
        setAuthType(h.authType || 'password');
        setLastTest({
          at: h.lastTestAt || null,
          ok: h.lastTestOk ?? null,
          summary: h.lastTestSummary || '',
          error: h.lastError || '',
        });
      } else {
        setHost('');
        setPort(22);
        setUsername('');
        setAuthType('password');
        setLastTest(null);
      }
    } catch (e) {
      setErr(e?.message || 'Failed to load Engine Host.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const payload = {
        host,
        port: Number(port || 22),
        username,
        authType,
        password: authType === 'password' ? password : '',
        privateKey: authType === 'privateKey' ? privateKey : '',
        passphrase: authType === 'privateKey' ? passphrase : '',
        sudoPassword: sudoPassword || '',
      };

      const r = await fetch('/api/admin/autodownload/engine-host', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save Engine Host.');
      setOk('Saved.');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
      setSudoPassword('');
      const h = j.engineHost;
      setLastTest({
        at: h?.lastTestAt || null,
        ok: h?.lastTestOk ?? null,
        summary: h?.lastTestSummary || '',
        error: h?.lastError || '',
      });
    } catch (e) {
      setErr(e?.message || 'Failed to save Engine Host.');
    } finally {
      setBusy(false);
    }
  };

  const testSsh = async () => {
    setTesting(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/engine-host/test', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'SSH test failed.');
      setOk(j?.result?.summary || 'SSH test OK.');
      await load({ silent: true });
    } catch (e) {
      setErr(e?.message || 'SSH test failed.');
    } finally {
      setTesting(false);
    }
  };

  const clearHost = async () => {
    if (!confirm('Clear Engine Host configuration?')) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/engine-host', { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to clear.');
      setHost('');
      setPort(22);
      setUsername('');
      setAuthType('password');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
      setSudoPassword('');
      setLastTest(null);
      setOk('Cleared.');
    } catch (e) {
      setErr(e?.message || 'Failed to clear.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">Engine Host</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Connect to your Ubuntu Engine Host over SSH. Credentials are encrypted at rest.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotesButton title="Engine Host — Notes" sections={notes} />
          <button
            onClick={testSsh}
            disabled={loading || testing}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {testing ? 'Testing…' : 'Test SSH'}
          </button>
        </div>
      </div>

      {!editOpen && err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {!editOpen && ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 md:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Connection</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Saved SSH target + auth type (credentials are hidden).</div>
            </div>
            <EditIconButton onClick={() => setEditOpen(true)} />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Host</div>
              <div className="mt-1 font-mono text-xs">{host || '—'}</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Port</div>
              <div className="mt-1 text-sm font-semibold">{port || 22}</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Username</div>
              <div className="mt-1 text-sm font-semibold">{username || '—'}</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Auth</div>
              <div className="mt-1 text-sm font-semibold">{authType === 'privateKey' ? 'SSH Key' : 'Password'}</div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={clearHost}
              disabled={loading || busy}
              className="rounded-lg border border-[var(--admin-border)] bg-transparent px-3 py-2 text-sm text-[var(--admin-muted)] hover:bg-black/5 disabled:opacity-60"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Status</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Latest SSH test result.</div>
          <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-[var(--admin-muted)]">Last test</div>
              <div className="text-xs text-[var(--admin-muted)]">{lastTest?.at ? new Date(lastTest.at).toLocaleString() : '—'}</div>
            </div>
            <div className="mt-2 text-[var(--admin-muted)]">
              {lastTest?.summary || (lastTest?.ok ? 'OK' : lastTest?.ok === false ? 'Failed' : 'Not tested')}
              {lastTest?.error ? <span className="ml-2 text-red-300">({lastTest.error})</span> : null}
            </div>
          </div>
        </div>
      </div>

      <EditModal
        open={editOpen}
        title="Edit Engine Host"
        description="Update SSH connection details for the Ubuntu Engine Host. Credentials are encrypted at rest and not shown after saving."
        error={err}
        success={ok}
        onCancel={async () => {
          setEditOpen(false);
          await load({ silent: true });
          setPassword('');
          setPrivateKey('');
          setPassphrase('');
          setSudoPassword('');
        }}
        onSave={async () => {
          await save();
          setEditOpen(false);
        }}
        saveDisabled={loading || !canSave}
        saving={busy}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Host" hint="IP or hostname" note="Ubuntu server hostname/IP. This is where mount + processing happens via SSH.">
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.100.100.200" />
          </Field>
          <Field label="Port" note="SSH port on the Engine Host (default 22).">
            <Input
              value={port}
              onChange={(e) => setPort(Number(e.target.value || 22))}
              type="number"
              min={1}
              max={65535}
            />
          </Field>
          <Field label="Username" note="SSH username on the Engine Host. Should have sudo privileges for mounts/installs.">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ubuntu" autoComplete="username" />
          </Field>
          <Field label="Auth Type" note="Password or SSH private key. Key is recommended for stable automation.">
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
              <option value="password">Password</option>
              <option value="privateKey">Private key</option>
            </select>
          </Field>

          {authType === 'password' ? (
            <div className="md:col-span-2">
              <Field label="SSH Password" hint="Not displayed after save" note="Stored encrypted at rest. Not shown after saving.">
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
            </div>
          ) : (
            <>
              <div className="md:col-span-2">
                <Field label="Private Key" hint="Paste full key (BEGIN/END)" note="Paste OpenSSH/PEM private key. Stored encrypted at rest.">
                  <Textarea
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  />
                </Field>
              </div>
              <Field label="Passphrase (optional)" note="Only needed if your private key is encrypted.">
                <Input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} type="password" placeholder="(optional)" />
              </Field>
            </>
          )}

          <Field
            label="Sudo Password (optional)"
            hint="Only needed if sudo prompts"
            note="Prefer passwordless sudo. Set only if sudo prompts for a password."
          >
            <Input
              value={sudoPassword}
              onChange={(e) => setSudoPassword(e.target.value)}
              type="password"
              placeholder="(optional)"
              autoComplete="new-password"
            />
          </Field>
        </div>
      </EditModal>
    </div>
  );
}
