'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Globe2, Info, Play, RefreshCw, RotateCcw, ShieldCheck, Square } from 'lucide-react';

import {
  defaultTelegramMessageTemplates,
  normalizeTelegramMessageTemplates,
  renderTelegramTemplatePreview,
  TELEGRAM_MESSAGE_STAMP_EXAMPLES,
  TELEGRAM_MESSAGE_STAMP_GROUPS,
  TELEGRAM_MESSAGE_TEMPLATE_FIELDS,
} from '../../../lib/telegramMessageTemplates';
import AdminA2PSettingsPanel from './AdminA2PSettingsPanel';

const SAVED_TOKEN_TEXT = 'Saved token configured - leave blank to keep it';
const SAVED_TURNSTILE_SECRET_TEXT = 'Saved secret configured - leave blank to keep it';
const SAVED_SSH_SECRET_TEXT = 'Saved secret configured - leave blank to keep it';

const TABS = [
  { key: 'branding', label: 'Branding' },
  { key: 'player', label: 'Player' },
  { key: 'login', label: 'Login' },
  { key: 'security', label: 'Security' },
  { key: 'publicHttps', label: 'Public HTTPS' },
  { key: 'xuiHttps', label: 'XUI HTTPS' },
  { key: 'a2p', label: 'A2P Messaging' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'messages', label: 'Messages' },
];

const TEST_MESSAGES = {
  general: 'Telegram test notification sent.',
  live_channels: 'Live TV Channels Up/down test notification sent.',
  user_reports: 'User Reports test notification sent.',
  nas_trigger: 'NAS Size Report test notification sent.',
  vod_trigger: '/home/xui/content/vod Size Report test notification sent.',
  daily_monitor_report: 'Daily monitor report test notification sent.',
};


function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-lg px-4 py-2 text-sm font-medium transition ' +
        (active
          ? 'bg-[var(--admin-surface-solid)] text-[var(--admin-text)] shadow-sm'
          : 'text-[var(--admin-muted)] hover:bg-black/5 hover:text-[var(--admin-text)] data-[theme=dark]:hover:bg-white/5')
      }
    >
      {children}
    </button>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-[var(--admin-muted)]">{description}</p> : null}
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--admin-muted)]">{label}</label>
      {children}
      {help ? <div className="mt-2 text-xs text-[var(--admin-muted)]">{help}</div> : null}
    </div>
  );
}

function TextInput({ value, onChange, onFocus, placeholder, type = 'text', min, max, step }) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
      placeholder={placeholder}
    />
  );
}

function TextAreaInput({ value, onChange, onFocus, placeholder, rows = 6, noWrap = false }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={onFocus}
      rows={rows}
      wrap={noWrap ? 'off' : undefined}
      className={
        'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30 ' +
        (noWrap ? 'resize-y overflow-x-auto whitespace-pre font-mono text-xs leading-5' : '')
      }
      placeholder={placeholder}
      spellCheck={false}
    />
  );
}

function TemplatePreview({ value }) {
  const preview = renderTelegramTemplatePreview(value);
  if (!preview) return null;

  return (
    <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <div className="text-xs font-semibold text-[var(--admin-text)]">Telegram preview</div>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm leading-5 text-[var(--admin-text)]">{preview}</pre>
    </div>
  );
}

function TestActionButton({ visible, busy, disabled, onClick, children }) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs font-medium hover:bg-black/10 disabled:opacity-60"
    >
      {busy ? 'Sending…' : children}
    </button>
  );
}

function serviceStatusLabel(meta = {}, key = '') {
  const row = meta?.serviceStatuses?.[key];
  if (!row || (row.isUp !== true && row.isUp !== false)) return 'Last known status: not checked yet.';
  const status = row.isUp ? 'UP' : 'DOWN';
  const summary = String(row.summary || '').trim();
  return `Last known status: ${status}${summary ? ` — ${summary}` : ''}`;
}

function MessageStampsModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95]">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close message stamps" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(1040px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--admin-border)] p-5">
          <div>
            <div className="text-lg font-semibold text-[var(--admin-text)]">Message Stamps</div>
            <div className="mt-1 text-sm text-[var(--admin-muted)]">
              Use these stamps inside the Telegram message templates. Blank sections automatically collapse after rendering.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
          >
            Close
          </button>
        </div>

        <div className="max-h-[76vh] overflow-auto p-5">
          <div className="grid gap-4 xl:grid-cols-2">
            {TELEGRAM_MESSAGE_STAMP_GROUPS.map((group) => (
              <div key={group.title} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="text-sm font-semibold text-[var(--admin-text)]">{group.title}</div>
                <div className="mt-3 space-y-3">
                  {group.items.map((item) => (
                    <div key={item.stamp} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                      <div className="font-mono text-xs text-[var(--admin-text)]">{item.stamp}</div>
                      <div className="mt-1 text-xs text-[var(--admin-muted)]">{item.description}</div>
                      <div className="mt-2 text-xs text-[var(--admin-text)]">
                        Example:
                        <span className="mt-1 block font-mono whitespace-pre-wrap">{item.example}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {TELEGRAM_MESSAGE_STAMP_EXAMPLES.map((example) => (
              <div key={example.title} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="text-sm font-semibold text-[var(--admin-text)]">{example.title}</div>
                <pre className="mt-3 overflow-auto rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs text-[var(--admin-text)] whitespace-pre-wrap">
                  {example.text}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function statusTone(status) {
  if (status === 'SUCCESS') return 'text-emerald-500';
  if (status === 'WARNING') return 'text-amber-500';
  if (status === 'FAILED') return 'text-red-500';
  return 'text-[var(--admin-muted)]';
}

function StatusPill({ ok, label }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ' +
        (ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 data-[theme=dark]:text-emerald-200'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-600 data-[theme=dark]:text-amber-200')
      }
    >
      {label}
    </span>
  );
}

function PublicHttpsPanel() {
  const defaultForm = {
    enabled: false,
    domain: '3jhotspot.com',
    publicHostname: 'tv.3jhotspot.com',
    publicUrl: 'https://tv.3jhotspot.com',
    localServiceUrl: 'http://127.0.0.1:3000',
    connectorCommand: '',
    notes: '',
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function hydrate(data) {
    const settings = data?.settings || {};
    setStatus(data || null);
    setForm((current) => ({
      ...current,
      enabled: settings.enabled === true,
      domain: settings.domain || defaultForm.domain,
      publicHostname: settings.publicHostname || defaultForm.publicHostname,
      publicUrl: settings.publicUrl || defaultForm.publicUrl,
      localServiceUrl: settings.localServiceUrl || defaultForm.localServiceUrl,
      connectorCommand: data?.tokenTextAreaValue || (data?.tokenConfigured ? SAVED_TOKEN_TEXT : ''),
      notes: settings.notes || '',
    }));
  }

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/public-https', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load Public HTTPS status.');
      hydrate(json);
    } catch (err) {
      setError(err?.message || 'Failed to load Public HTTPS status.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateField(key, value) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'publicHostname' && value) next.publicUrl = `https://${String(value).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
      return next;
    });
  }

  async function savePublicHttps() {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/public-https', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          connectorCommand: form.connectorCommand === SAVED_TOKEN_TEXT ? '' : form.connectorCommand,
          tokenSavedIndicator: form.connectorCommand === SAVED_TOKEN_TEXT,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to save Public HTTPS settings.');
      hydrate(json);
      setMessage('Public HTTPS settings saved.');
    } catch (err) {
      setError(err?.message || 'Failed to save Public HTTPS settings.');
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action) {
    setActionLoading(action);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/public-https', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Public HTTPS action failed.');
      hydrate(json);
      const labels = { start: 'Cloudflare connector started.', restart: 'Cloudflare connector restarted.', stop: 'Cloudflare connector stopped.', check: 'Public HTTPS status refreshed.' };
      setMessage(labels[action] || 'Public HTTPS action completed.');
    } catch (err) {
      setError(err?.message || 'Public HTTPS action failed.');
    } finally {
      setActionLoading('');
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard?.writeText(text);
      setMessage('Copied.');
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  if (loading) return <Section title="Public HTTPS" description="Loading Cloudflare Tunnel status."><div className="text-sm text-[var(--admin-muted)]">Loading…</div></Section>;

  const running = status?.cloudflaredRunning === true;
  const guide = status?.publicHostnameGuide || {};
  const localCheck = status?.localServiceCheck || {};
  const publicCheck = status?.publicServiceCheck || {};
  const canStart = status?.tokenConfigured === true;

  return (
    <Section
      title="Public HTTPS"
      description="Run a dedicated Cloudflare Tunnel connector on this IPTV web server so tv.3jhotspot.com routes directly to the local IPTV app."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} />Tunnel Token</div>
          <div className="mt-3"><StatusPill ok={status?.tokenConfigured} label={status?.tokenConfigured ? `Saved ${status?.tokenHint || ''}` : 'Missing'} /></div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Globe2 size={18} />cloudflared</div>
          <div className="mt-3"><StatusPill ok={status?.cloudflaredInstalled} label={status?.cloudflaredInstalled ? 'Installed' : 'Missing'} /></div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Play size={18} />Connector</div>
          <div className="mt-3"><StatusPill ok={running} label={running ? `Running PID ${status?.cloudflaredPid || ''}` : 'Stopped'} /></div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><ExternalLink size={18} />Public URL</div>
          <div className={`mt-3 text-xs font-semibold ${statusTone(publicCheck.status)}`}>{publicCheck.httpStatus || publicCheck.status || 'Not checked'}</div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="text-sm font-semibold text-[var(--admin-text)]">Cloudflare Public Hostname</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><div className="text-xs text-[var(--admin-muted)]">Subdomain</div><div className="font-mono text-sm">{guide.subdomain || 'tv'}</div></div>
          <div><div className="text-xs text-[var(--admin-muted)]">Domain</div><div className="font-mono text-sm">{guide.domain || form.domain}</div></div>
          <div><div className="text-xs text-[var(--admin-muted)]">Type</div><div className="font-mono text-sm">{guide.type || 'HTTP'}</div></div>
          <div><div className="text-xs text-[var(--admin-muted)]">URL</div><div className="font-mono text-sm">{guide.url || form.localServiceUrl}</div></div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Domain">
          <TextInput value={form.domain} onChange={(value) => updateField('domain', value)} placeholder="3jhotspot.com" />
        </Field>
        <Field label="Public hostname">
          <TextInput value={form.publicHostname} onChange={(value) => updateField('publicHostname', value)} placeholder="tv.3jhotspot.com" />
        </Field>
        <Field label="Public IPTV URL">
          <TextInput value={form.publicUrl} onChange={(value) => updateField('publicUrl', value)} placeholder="https://tv.3jhotspot.com" />
        </Field>
        <Field label="Local IPTV service URL" help="Because the connector runs on this IPTV server, use localhost/127.0.0.1 rather than the LAN IP.">
          <TextInput value={form.localServiceUrl} onChange={(value) => updateField('localServiceUrl', value)} placeholder="http://127.0.0.1:3000" />
        </Field>
        <div className="lg:col-span-2">
          <Field label="Cloudflare connector command / token" help="Paste the connector command from Cloudflare or the raw tunnel token. It is stored as a secret and never shown again.">
            <TextAreaInput
              value={form.connectorCommand}
              onChange={(value) => updateField('connectorCommand', value)}
              onFocus={() => {
                if (form.connectorCommand === SAVED_TOKEN_TEXT) updateField('connectorCommand', '');
              }}
              rows={3}
              noWrap
              placeholder={status?.tokenConfigured ? SAVED_TOKEN_TEXT : 'cloudflared tunnel run --token ey...'}
            />
            {status?.tokenConfigured && <div className="mt-2 text-xs font-semibold text-emerald-600">Token is saved{status?.tokenUpdatedAt ? ` · ${new Date(status.tokenUpdatedAt).toLocaleString()}` : ''}. Leave the field as-is or blank to keep it, or paste a new command to replace it.</div>}
          </Field>
        </div>
        <div className="lg:col-span-2">
          <Field label="Notes">
            <TextAreaInput value={form.notes} onChange={(value) => updateField('notes', value)} rows={3} placeholder="Cloudflare tunnel name, DNS notes, or maintenance reminders." />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={saving} onClick={savePublicHttps} className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: 'var(--brand)' }}>
          {saving ? 'Saving…' : 'Save Public HTTPS'}
        </button>
        <button type="button" disabled={Boolean(actionLoading) || !canStart} onClick={() => runAction('start')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <Play size={16} />{actionLoading === 'start' ? 'Starting…' : 'Start'}
        </button>
        <button type="button" disabled={Boolean(actionLoading) || !canStart} onClick={() => runAction('restart')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <RotateCcw size={16} />{actionLoading === 'restart' ? 'Restarting…' : 'Restart'}
        </button>
        <button type="button" disabled={Boolean(actionLoading) || !running} onClick={() => runAction('stop')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <Square size={16} />{actionLoading === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
        <button type="button" disabled={Boolean(actionLoading)} onClick={() => runAction('check')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <RefreshCw size={16} />Refresh Status
        </button>
        <button type="button" onClick={() => copyText(`${guide.subdomain || 'tv'}\\n${guide.domain || form.domain}\\n${guide.type || 'HTTP'}\\n${guide.url || form.localServiceUrl}`)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10">
          <Copy size={16} />Copy Hostname Guide
        </button>
      </div>

      {message ? <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
      {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Service Checks</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><span className="text-[var(--admin-muted)]">Local IPTV app</span><span className={statusTone(localCheck.status)}>{localCheck.httpStatus || localCheck.status || 'Not checked'}</span></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--admin-muted)]">Public HTTPS</span><span className={statusTone(publicCheck.status)}>{publicCheck.httpStatus || publicCheck.status || 'Not checked'}</span></div>
            {publicCheck.error ? <div className="text-xs text-red-300">{publicCheck.error}</div> : null}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Connector Logs</div>
          {Array.isArray(status?.logs) && status.logs.length ? (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">{status.logs.join('\n')}</pre>
          ) : (
            <div className="mt-3 text-sm text-[var(--admin-muted)]">No cloudflared logs yet.</div>
          )}
        </div>
      </div>
    </Section>
  );
}


function XuiHttpsPanel() {
  const defaultForm = {
    enabled: false,
    domain: '3jhotspot.com',
    publicHostname: 'xui.3jhotspot.com',
    publicUrl: 'https://xui.3jhotspot.com',
    originServiceUrl: 'http://127.0.0.1',
    sshHost: '10.100.100.100',
    sshPort: '22',
    sshUsername: 'root',
    sshAuthType: 'password',
    sshPassword: '',
    sshPrivateKey: '',
    sshPassphrase: '',
    sudoPassword: '',
    connectorCommand: '',
    notes: '',
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function hydrate(data) {
    const settings = data?.settings || {};
    setStatus(data || null);
    setForm((current) => ({
      ...current,
      enabled: settings.enabled === true,
      domain: settings.domain || defaultForm.domain,
      publicHostname: settings.publicHostname || defaultForm.publicHostname,
      publicUrl: settings.publicUrl || defaultForm.publicUrl,
      originServiceUrl: settings.originServiceUrl || defaultForm.originServiceUrl,
      sshHost: settings.sshHost || defaultForm.sshHost,
      sshPort: String(settings.sshPort || defaultForm.sshPort),
      sshUsername: settings.sshUsername || defaultForm.sshUsername,
      sshAuthType: settings.sshAuthType === 'privateKey' ? 'privateKey' : 'password',
      sshPassword: data?.sshPasswordTextAreaValue || (data?.sshPasswordConfigured ? SAVED_SSH_SECRET_TEXT : ''),
      sshPrivateKey: data?.sshPrivateKeyTextAreaValue || (data?.sshPrivateKeyConfigured ? SAVED_SSH_SECRET_TEXT : ''),
      sshPassphrase: data?.sshPassphraseTextAreaValue || (data?.sshPassphraseConfigured ? SAVED_SSH_SECRET_TEXT : ''),
      sudoPassword: data?.sudoPasswordTextAreaValue || (data?.sudoPasswordConfigured ? SAVED_SSH_SECRET_TEXT : ''),
      connectorCommand: data?.tokenTextAreaValue || (data?.tokenConfigured ? SAVED_TOKEN_TEXT : ''),
      notes: settings.notes || '',
    }));
  }

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/xui-https', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load XUI HTTPS status.');
      hydrate(json);
    } catch (err) {
      setError(err?.message || 'Failed to load XUI HTTPS status.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateField(key, value) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'publicHostname' && value) next.publicUrl = `https://${String(value).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
      return next;
    });
  }

  function cleanedPayload() {
    const stripSecret = (value, placeholder) => (value === placeholder ? '' : value);
    return {
      ...form,
      connectorCommand: stripSecret(form.connectorCommand, SAVED_TOKEN_TEXT),
      sshPassword: stripSecret(form.sshPassword, SAVED_SSH_SECRET_TEXT),
      sshPrivateKey: stripSecret(form.sshPrivateKey, SAVED_SSH_SECRET_TEXT),
      sshPassphrase: stripSecret(form.sshPassphrase, SAVED_SSH_SECRET_TEXT),
      sudoPassword: stripSecret(form.sudoPassword, SAVED_SSH_SECRET_TEXT),
    };
  }

  async function saveXuiHttps() {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/xui-https', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cleanedPayload()),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to save XUI HTTPS settings.');
      hydrate(json);
      setMessage('XUI HTTPS settings saved. The XUI browser URL was synced to the XUI integration.');
    } catch (err) {
      setError(err?.message || 'Failed to save XUI HTTPS settings.');
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action) {
    setActionLoading(action);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/xui-https', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'XUI HTTPS action failed.');
      hydrate(json);
      const labels = {
        'test-ssh': 'XUI SSH connection verified.',
        install: 'XUI Cloudflare connector installed or updated.',
        start: 'XUI Cloudflare connector started.',
        restart: 'XUI Cloudflare connector restarted.',
        stop: 'XUI Cloudflare connector stopped.',
        check: 'XUI HTTPS status refreshed.',
      };
      setMessage(labels[action] || 'XUI HTTPS action completed.');
    } catch (err) {
      setError(err?.message || 'XUI HTTPS action failed.');
    } finally {
      setActionLoading('');
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard?.writeText(text);
      setMessage('Copied.');
    } catch {
      setError('Could not copy to clipboard.');
    }
  }

  if (loading) return <Section title="XUI HTTPS" description="Loading XUI Cloudflare Tunnel status."><div className="text-sm text-[var(--admin-muted)]">Loading…</div></Section>;

  const guide = status?.publicHostnameGuide || {};
  const remoteStatus = status?.lastRemoteStatus || {};
  const publicCheck = status?.publicServiceCheck || {};
  const remoteRunning = remoteStatus.serviceActive === 'active';
  const canInstall = status?.tokenConfigured === true && status?.sshConfigured === true;

  return (
    <Section
      title="XUI HTTPS"
      description="Deploy and manage the Cloudflare Tunnel connector on the XUI One server so xui.3jhotspot.com is reachable by the IPTV web app without exposing private LAN addresses."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} />Tunnel Token</div>
          <div className="mt-3"><StatusPill ok={status?.tokenConfigured} label={status?.tokenConfigured ? `Saved ${status?.tokenHint || ''}` : 'Missing'} /></div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Globe2 size={18} />XUI SSH</div>
          <div className="mt-3"><StatusPill ok={status?.sshConfigured} label={status?.sshConfigured ? `${form.sshUsername}@${form.sshHost}` : 'Needs credentials'} /></div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Play size={18} />Remote Connector</div>
          <div className="mt-3"><StatusPill ok={remoteRunning} label={remoteRunning ? `Running PID ${remoteStatus.servicePid || ''}` : remoteStatus.serviceActive || 'Not checked'} /></div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><ExternalLink size={18} />Public XUI URL</div>
          <div className={`mt-3 text-xs font-semibold ${statusTone(publicCheck.status)}`}>{publicCheck.httpStatus || publicCheck.status || 'Not checked'}</div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="text-sm font-semibold text-[var(--admin-text)]">Cloudflare Public Hostname</div>
        <div className="mt-2 text-xs text-[var(--admin-muted)]">Create this hostname inside the Cloudflare tunnel for the XUI One server, then paste that tunnel connector command/token below.</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><div className="text-xs text-[var(--admin-muted)]">Subdomain</div><div className="font-mono text-sm">{guide.subdomain || 'xui'}</div></div>
          <div><div className="text-xs text-[var(--admin-muted)]">Domain</div><div className="font-mono text-sm">{guide.domain || form.domain}</div></div>
          <div><div className="text-xs text-[var(--admin-muted)]">Type</div><div className="font-mono text-sm">{guide.type || 'HTTP'}</div></div>
          <div><div className="text-xs text-[var(--admin-muted)]">URL</div><div className="font-mono text-sm">{guide.url || form.originServiceUrl}</div></div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Domain">
          <TextInput value={form.domain} onChange={(value) => updateField('domain', value)} placeholder="3jhotspot.com" />
        </Field>
        <Field label="Public hostname">
          <TextInput value={form.publicHostname} onChange={(value) => updateField('publicHostname', value)} placeholder="xui.3jhotspot.com" />
        </Field>
        <Field label="Public XUI URL" help="This value is also used by the IPTV web token-login flow for outside-network playback.">
          <TextInput value={form.publicUrl} onChange={(value) => updateField('publicUrl', value)} placeholder="https://xui.3jhotspot.com" />
        </Field>
        <Field label="XUI origin service URL" help="Because this connector runs on the XUI One server, use its local service address, usually http://127.0.0.1.">
          <TextInput value={form.originServiceUrl} onChange={(value) => updateField('originServiceUrl', value)} placeholder="http://127.0.0.1" />
        </Field>
      </div>

      <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="text-sm font-semibold text-[var(--admin-text)]">XUI One Server SSH</div>
        <div className="mt-1 text-xs text-[var(--admin-muted)]">Used only when you test SSH or install/start/stop the XUI Cloudflare connector.</div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Field label="SSH host">
            <TextInput value={form.sshHost} onChange={(value) => updateField('sshHost', value)} placeholder="10.100.100.100" />
          </Field>
          <Field label="SSH port">
            <TextInput value={form.sshPort} onChange={(value) => updateField('sshPort', value)} type="number" min={1} max={65535} step={1} />
          </Field>
          <Field label="SSH username">
            <TextInput value={form.sshUsername} onChange={(value) => updateField('sshUsername', value)} placeholder="root" />
          </Field>
          <Field label="Authentication">
            <select
              value={form.sshAuthType}
              onChange={(event) => updateField('sshAuthType', event.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
              <option value="password">Password</option>
              <option value="privateKey">Private key</option>
            </select>
          </Field>
          {form.sshAuthType === 'privateKey' ? (
            <>
              <div className="lg:col-span-2">
                <Field label="SSH private key">
                  <TextAreaInput
                    value={form.sshPrivateKey}
                    onChange={(value) => updateField('sshPrivateKey', value)}
                    onFocus={() => {
                      if (form.sshPrivateKey === SAVED_SSH_SECRET_TEXT) updateField('sshPrivateKey', '');
                    }}
                    rows={4}
                    noWrap
                    placeholder={status?.sshPrivateKeyConfigured ? SAVED_SSH_SECRET_TEXT : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                  />
                </Field>
              </div>
              <Field label="Private key passphrase">
                <TextInput
                  value={form.sshPassphrase}
                  onChange={(value) => updateField('sshPassphrase', value)}
                  onFocus={() => {
                    if (form.sshPassphrase === SAVED_SSH_SECRET_TEXT) updateField('sshPassphrase', '');
                  }}
                  type="password"
                  placeholder={status?.sshPassphraseConfigured ? SAVED_SSH_SECRET_TEXT : 'Optional'}
                />
              </Field>
            </>
          ) : (
            <Field label="SSH password">
              <TextInput
                value={form.sshPassword}
                onChange={(value) => updateField('sshPassword', value)}
                onFocus={() => {
                  if (form.sshPassword === SAVED_SSH_SECRET_TEXT) updateField('sshPassword', '');
                }}
                type="password"
                placeholder={status?.sshPasswordConfigured ? SAVED_SSH_SECRET_TEXT : 'Password'}
              />
            </Field>
          )}
          <Field label="Sudo password" help="Required only when SSH username is not root and systemd/cloudflared install needs sudo.">
            <TextInput
              value={form.sudoPassword}
              onChange={(value) => updateField('sudoPassword', value)}
              onFocus={() => {
                if (form.sudoPassword === SAVED_SSH_SECRET_TEXT) updateField('sudoPassword', '');
              }}
              type="password"
              placeholder={status?.sudoPasswordConfigured ? SAVED_SSH_SECRET_TEXT : 'Optional'}
            />
          </Field>
        </div>
      </div>

      <div className="grid gap-4">
        <Field label="Cloudflare connector command / token" help="Paste the connector command for the XUI tunnel or the raw token. It is encrypted and never shown again.">
          <TextAreaInput
            value={form.connectorCommand}
            onChange={(value) => updateField('connectorCommand', value)}
            onFocus={() => {
              if (form.connectorCommand === SAVED_TOKEN_TEXT) updateField('connectorCommand', '');
            }}
            rows={3}
            noWrap
            placeholder={status?.tokenConfigured ? SAVED_TOKEN_TEXT : 'cloudflared tunnel run --token ey...'}
          />
          {status?.tokenConfigured && <div className="mt-2 text-xs font-semibold text-emerald-600">Token is saved{status?.tokenUpdatedAt ? ` · ${new Date(status.tokenUpdatedAt).toLocaleString()}` : ''}. Leave the field as-is or blank to keep it, or paste a new command to replace it.</div>}
        </Field>
        <Field label="Notes">
          <TextAreaInput value={form.notes} onChange={(value) => updateField('notes', value)} rows={3} placeholder="Tunnel name, XUI hostname notes, or maintenance reminders." />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={saving} onClick={saveXuiHttps} className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: 'var(--brand)' }}>
          {saving ? 'Saving…' : 'Save XUI HTTPS'}
        </button>
        <button type="button" disabled={Boolean(actionLoading)} onClick={() => runAction('test-ssh')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <ShieldCheck size={16} />{actionLoading === 'test-ssh' ? 'Testing…' : 'Test SSH'}
        </button>
        <button type="button" disabled={Boolean(actionLoading) || !canInstall} onClick={() => runAction('install')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <Play size={16} />{actionLoading === 'install' ? 'Installing…' : 'Install/Update Tunnel'}
        </button>
        <button type="button" disabled={Boolean(actionLoading) || !canInstall} onClick={() => runAction('start')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <Play size={16} />{actionLoading === 'start' ? 'Starting…' : 'Start'}
        </button>
        <button type="button" disabled={Boolean(actionLoading) || !canInstall} onClick={() => runAction('restart')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <RotateCcw size={16} />{actionLoading === 'restart' ? 'Restarting…' : 'Restart'}
        </button>
        <button type="button" disabled={Boolean(actionLoading) || !canInstall} onClick={() => runAction('stop')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <Square size={16} />{actionLoading === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
        <button type="button" disabled={Boolean(actionLoading)} onClick={() => runAction('check')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
          <RefreshCw size={16} />Refresh Status
        </button>
        <button type="button" onClick={() => copyText(`${guide.subdomain || 'xui'}\n${guide.domain || form.domain}\n${guide.type || 'HTTP'}\n${guide.url || form.originServiceUrl}`)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10">
          <Copy size={16} />Copy Hostname Guide
        </button>
      </div>

      {message ? <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div> : null}
      {error ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Service Checks</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3"><span className="text-[var(--admin-muted)]">XUI origin from XUI server</span><span className={statusTone(remoteStatus.originCheck ? 'SUCCESS' : remoteStatus.status)}>{remoteStatus.originCheck || remoteStatus.status || 'Not checked'}</span></div>
            <div className="flex justify-between gap-3"><span className="text-[var(--admin-muted)]">Public XUI HTTPS</span><span className={statusTone(publicCheck.status)}>{publicCheck.httpStatus || publicCheck.status || 'Not checked'}</span></div>
            {publicCheck.error ? <div className="text-xs text-red-300">{publicCheck.error}</div> : null}
            {remoteStatus.error ? <div className="text-xs text-red-300">{remoteStatus.error}</div> : null}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Remote Connector Logs</div>
          {Array.isArray(remoteStatus.logs) && remoteStatus.logs.length ? (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs">{remoteStatus.logs.join('\n')}</pre>
          ) : (
            <div className="mt-3 text-sm text-[var(--admin-muted)]">No remote cloudflared logs yet. Use Refresh Status after installing the connector.</div>
          )}
        </div>
      </div>
    </Section>
  );
}

function ToggleRow({ label, description, checked, onChange, actions = null }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--admin-text)]">{label}</div>
        {description ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{description}</div> : null}
        {actions ? <div className="mt-3">{actions}</div> : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          'inline-flex items-center gap-3 rounded-full border px-2 py-1 text-sm transition ' +
          (checked
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 data-[theme=dark]:text-emerald-200'
            : 'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text)]')
        }
      >
        <span
          className={
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' +
            (checked ? 'bg-emerald-500/70' : 'bg-slate-400/60')
          }
        >
          <span
            className={
              'h-5 w-5 rounded-full bg-white shadow transition-transform ' +
              (checked ? 'translate-x-5' : 'translate-x-0.5')
            }
          />
        </span>
        <span className="min-w-[72px] text-left font-medium">{checked ? 'Enabled' : 'Disabled'}</span>
      </button>
    </div>
  );
}

export default function AdminSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingTelegramTarget, setTestingTelegramTarget] = useState('');
  const [activeTab, setActiveTab] = useState('branding');
  const [showMessageStamps, setShowMessageStamps] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [testErr, setTestErr] = useState('');
  const [testOkMsg, setTestOkMsg] = useState('');
  const [showTestActions, setShowTestActions] = useState(false);

  const [brandName, setBrandName] = useState('');
  const [brandColor, setBrandColor] = useState('#FA5252');
  const [logoUrl, setLogoUrl] = useState('');
  const [defaultMovieClick, setDefaultMovieClick] = useState('play');
  const [bgDesktop, setBgDesktop] = useState('');
  const [bgMobile, setBgMobile] = useState('');
  const [helpUrl, setHelpUrl] = useState('');
  const [helpText, setHelpText] = useState('');
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileSecretKey, setTurnstileSecretKey] = useState('');
  const [turnstileProtectPublicLogin, setTurnstileProtectPublicLogin] = useState(true);
  const [turnstileProtectAdminLogin, setTurnstileProtectAdminLogin] = useState(true);
  const [turnstileProtectAdminForgotPassword, setTurnstileProtectAdminForgotPassword] = useState(true);
  const [turnstilePublicHostOnly, setTurnstilePublicHostOnly] = useState(true);

  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [notifyLiveChannels, setNotifyLiveChannels] = useState(false);
  const [liveChannelAlertDelayMinutes, setLiveChannelAlertDelayMinutes] = useState('15');
  const [liveChannelDownReminderHours, setLiveChannelDownReminderHours] = useState('12');
  const [notifyUserReports, setNotifyUserReports] = useState(false);
  const [reportNasSize, setReportNasSize] = useState(false);
  const [reportVodSize, setReportVodSize] = useState(false);
  const [notifyNasStatus, setNotifyNasStatus] = useState(false);
  const [notifyVpnStatus, setNotifyVpnStatus] = useState(false);
  const [notifySystemHttpsStatus, setNotifySystemHttpsStatus] = useState(false);
  const [notifyXuiHttpsStatus, setNotifyXuiHttpsStatus] = useState(false);
  const [dailyReportTime, setDailyReportTime] = useState('07:00');
  const [messageTemplates, setMessageTemplates] = useState(defaultTelegramMessageTemplates());
  const [notificationTimeZone, setNotificationTimeZone] = useState('Asia/Manila');
  const [notificationMeta, setNotificationMeta] = useState({
    liveChannelsTracked: 0,
    liveChannelsUp: 0,
    liveChannelsDown: 0,
    dailyMonitorReportLastSentDate: '',
    autoDeleteThreshold: {
      triggerUsedGb: 0,
      limitUsedGb: 0,
    },
    serviceStatuses: {},
    serviceStatusLastCheckedAt: null,
  });
  const [telegramMeta, setTelegramMeta] = useState({
    hasBotToken: false,
    hasChatId: false,
    configured: false,
  });
  const [turnstileMeta, setTurnstileMeta] = useState({
    secretConfigured: false,
    envConfigured: false,
  });

  const load = async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    setTestErr('');
    setTestOkMsg('');

    try {
      const response = await fetch('/api/admin/settings', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load settings.');

      const settings = json.settings || {};
      const notificationSettings = json.notificationSettings || {};
      const telegram = json.telegram || {};

      setBrandName(settings?.brand?.name || '3J TV');
      setBrandColor(settings?.brand?.color || '#FA5252');
      setLogoUrl(settings?.brand?.logoUrl || '/brand/logo.svg');
      setDefaultMovieClick(String(settings?.ui?.defaultMovieCardClickAction || 'play'));
      setBgDesktop(settings?.login?.backgroundDesktopUrl || '/auth/login-bg.jpg');
      setBgMobile(settings?.login?.backgroundMobileUrl || '/auth/login-bg-mobile.jpg');
      setHelpUrl(settings?.login?.helpLinkUrl || 'https://www.facebook.com/threejfiberwifi');
      setHelpText(settings?.login?.helpLinkText || 'FB Page');
      const turnstile = settings?.security?.turnstile || {};
      setTurnstileEnabled(turnstile.enabled === true);
      setTurnstileSiteKey(String(turnstile.siteKey || '').trim());
      setTurnstileProtectPublicLogin(turnstile.protectPublicLogin !== false);
      setTurnstileProtectAdminLogin(turnstile.protectAdminLogin !== false);
      setTurnstileProtectAdminForgotPassword(turnstile.protectAdminForgotPassword !== false);
      setTurnstilePublicHostOnly(turnstile.enforcePublicHostOnly !== false);
      setTurnstileSecretKey(json?.turnstile?.secretConfigured ? SAVED_TURNSTILE_SECRET_TEXT : '');

      setTelegramBotToken(telegram?.botToken || '');
      setTelegramChatId(telegram?.chatId || '');
      setNotifyLiveChannels(notificationSettings?.telegram?.liveChannelsEnabled === true);
      setLiveChannelAlertDelayMinutes(String(notificationSettings?.telegram?.liveChannelAlertDelayMinutes ?? 15));
      setLiveChannelDownReminderHours(String(notificationSettings?.telegram?.liveChannelDownReminderHours ?? 12));
      setNotifyUserReports(notificationSettings?.telegram?.userReportsEnabled === true);
      setReportNasSize(notificationSettings?.telegram?.nasSizeReportEnabled === true);
      setReportVodSize(notificationSettings?.telegram?.vodSizeReportEnabled === true);
      setNotifyNasStatus(notificationSettings?.telegram?.nasStatusEnabled === true);
      setNotifyVpnStatus(notificationSettings?.telegram?.vpnStatusEnabled === true);
      setNotifySystemHttpsStatus(notificationSettings?.telegram?.systemHttpsStatusEnabled === true);
      setNotifyXuiHttpsStatus(notificationSettings?.telegram?.xuiHttpsStatusEnabled === true);
      setDailyReportTime(String(notificationSettings?.telegram?.dailyReportTime || '07:00').trim() || '07:00');
      setMessageTemplates(normalizeTelegramMessageTemplates(notificationSettings?.telegram?.messageTemplates));
      setNotificationTimeZone(String(json?.notificationTimeZone || 'Asia/Manila').trim() || 'Asia/Manila');
      setNotificationMeta({
        liveChannelsTracked: Number(json?.notificationMeta?.liveChannelsTracked || 0) || 0,
        liveChannelsUp: Number(json?.notificationMeta?.liveChannelsUp || 0) || 0,
        liveChannelsDown: Number(json?.notificationMeta?.liveChannelsDown || 0) || 0,
        dailyMonitorReportLastSentDate: String(json?.notificationMeta?.dailyMonitorReportLastSentDate || '').trim(),
        autoDeleteThreshold: {
          triggerUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.triggerUsedGb || 0) || 0,
          limitUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.limitUsedGb || 0) || 0,
        },
        serviceStatuses: json?.notificationMeta?.serviceStatuses || {},
        serviceStatusLastCheckedAt: Number(json?.notificationMeta?.serviceStatusLastCheckedAt || 0) || null,
      });
      setTelegramMeta({
        hasBotToken: telegram?.hasBotToken === true,
        hasChatId: telegram?.hasChatId === true,
        configured: telegram?.configured === true,
      });
      setTurnstileMeta({
        secretConfigured: json?.turnstile?.secretConfigured === true,
        envConfigured: json?.turnstile?.envConfigured === true,
      });
    } catch (error) {
      setErr(error?.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const payload = useMemo(
    () => ({
      settings: {
        brand: {
          name: brandName,
          color: brandColor,
          logoUrl,
        },
        ui: {
          defaultMovieCardClickAction: defaultMovieClick === 'preview' ? 'preview' : 'play',
        },
        login: {
          backgroundDesktopUrl: bgDesktop,
          backgroundMobileUrl: bgMobile,
          helpLinkUrl: helpUrl,
          helpLinkText: helpText,
        },
        security: {
          turnstile: {
            enabled: turnstileEnabled,
            siteKey: turnstileSiteKey,
            protectPublicLogin: turnstileProtectPublicLogin,
            protectAdminLogin: turnstileProtectAdminLogin,
            protectAdminForgotPassword: turnstileProtectAdminForgotPassword,
            enforcePublicHostOnly: turnstilePublicHostOnly,
          },
        },
      },
      notificationSettings: {
        telegram: {
          liveChannelsEnabled: notifyLiveChannels,
          liveChannelAlertDelayMinutes: liveChannelAlertDelayMinutes,
          liveChannelDownReminderHours: liveChannelDownReminderHours,
          userReportsEnabled: notifyUserReports,
          nasSizeReportEnabled: reportNasSize,
          vodSizeReportEnabled: reportVodSize,
          nasStatusEnabled: notifyNasStatus,
          vpnStatusEnabled: notifyVpnStatus,
          systemHttpsStatusEnabled: notifySystemHttpsStatus,
          xuiHttpsStatusEnabled: notifyXuiHttpsStatus,
          dailyReportTime: dailyReportTime || '07:00',
          messageTemplates,
        },
      },
      telegram: {
        botToken: telegramBotToken,
        chatId: telegramChatId,
      },
      turnstile: {
        secretKey: turnstileSecretKey,
      },
    }),
    [
      bgDesktop,
      bgMobile,
      brandColor,
      brandName,
      dailyReportTime,
      defaultMovieClick,
      helpText,
      helpUrl,
      liveChannelAlertDelayMinutes,
      liveChannelDownReminderHours,
      logoUrl,
      messageTemplates,
      notifyLiveChannels,
      notifyNasStatus,
      notifyUserReports,
      notifyVpnStatus,
      notifySystemHttpsStatus,
      notifyXuiHttpsStatus,
      reportNasSize,
      reportVodSize,
      telegramBotToken,
      telegramChatId,
      turnstileEnabled,
      turnstileProtectAdminForgotPassword,
      turnstileProtectAdminLogin,
      turnstileProtectPublicLogin,
      turnstilePublicHostOnly,
      turnstileSecretKey,
      turnstileSiteKey,
    ]
  );

  const save = async () => {
    setSaving(true);
    setErr('');
    setOkMsg('');

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to save settings.');

      setOkMsg('Saved settings.');
      setLiveChannelAlertDelayMinutes(String(json?.notificationSettings?.telegram?.liveChannelAlertDelayMinutes ?? 15));
      setLiveChannelDownReminderHours(String(json?.notificationSettings?.telegram?.liveChannelDownReminderHours ?? 12));
      setDailyReportTime(String(json?.notificationSettings?.telegram?.dailyReportTime || '07:00').trim() || '07:00');
      setMessageTemplates(normalizeTelegramMessageTemplates(json?.notificationSettings?.telegram?.messageTemplates));
      setNotificationTimeZone(String(json?.notificationTimeZone || notificationTimeZone).trim() || notificationTimeZone);
      setNotificationMeta({
        liveChannelsTracked: Number(json?.notificationMeta?.liveChannelsTracked || 0) || 0,
        liveChannelsUp: Number(json?.notificationMeta?.liveChannelsUp || 0) || 0,
        liveChannelsDown: Number(json?.notificationMeta?.liveChannelsDown || 0) || 0,
        dailyMonitorReportLastSentDate: String(json?.notificationMeta?.dailyMonitorReportLastSentDate || '').trim(),
        autoDeleteThreshold: {
          triggerUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.triggerUsedGb || 0) || 0,
          limitUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.limitUsedGb || 0) || 0,
        },
        serviceStatuses: json?.notificationMeta?.serviceStatuses || {},
        serviceStatusLastCheckedAt: Number(json?.notificationMeta?.serviceStatusLastCheckedAt || 0) || null,
      });
      setTelegramMeta({
        hasBotToken: json?.telegram?.hasBotToken === true,
        hasChatId: json?.telegram?.hasChatId === true,
        configured: json?.telegram?.configured === true,
      });
      setTurnstileMeta({
        secretConfigured: json?.turnstile?.secretConfigured === true,
        envConfigured: json?.turnstile?.envConfigured === true,
      });
      setTurnstileSecretKey(json?.turnstile?.secretConfigured ? SAVED_TURNSTILE_SECRET_TEXT : '');
    } catch (error) {
      setErr(error?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const setShowTestNotifications = (nextValue) => {
    setShowTestActions(nextValue);
    if (!nextValue) {
      setTestingTelegramTarget('');
      setTestErr('');
      setTestOkMsg('');
    }
  };

  const runTelegramTest = async (scenario = 'general') => {
    setTestingTelegramTarget(scenario);
    setTestErr('');
    setTestOkMsg('');

    try {
      const response = await fetch('/api/admin/settings/telegram/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          telegram: payload.telegram,
          notificationSettings: payload.notificationSettings,
          scenario,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to send Telegram test notification.');
      setTestOkMsg(TEST_MESSAGES[scenario] || TEST_MESSAGES.general);
    } catch (error) {
      setTestErr(error?.message || 'Failed to send Telegram test notification.');
    } finally {
      setTestingTelegramTarget('');
    }
  };

  const testTelegram = async () => runTelegramTest('general');
  const updateMessageTemplate = (key, value) => {
    setMessageTemplates((current) => ({
      ...current,
      [key]: value,
    }));
  };

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading…</div>;

  const notificationsEnabled =
    notifyLiveChannels ||
    notifyUserReports ||
    reportNasSize ||
    reportVodSize ||
    notifyNasStatus ||
    notifyVpnStatus ||
    notifySystemHttpsStatus ||
    notifyXuiHttpsStatus;
  const testingTelegram = Boolean(testingTelegramTarget);
  const liveDelayMinutes = Math.max(0, Number(liveChannelAlertDelayMinutes || 0) || 0);
  const liveReminderHours = Math.max(0, Number(liveChannelDownReminderHours || 0) || 0);
  const autoDeleteTriggerNote =
    notificationMeta.autoDeleteThreshold.triggerUsedGb > 0 && notificationMeta.autoDeleteThreshold.limitUsedGb > 0
      ? `Immediate alert also sends when AutoDelete reaches Trigger ${notificationMeta.autoDeleteThreshold.triggerUsedGb.toFixed(1)} GB / Limit ${notificationMeta.autoDeleteThreshold.limitUsedGb.toFixed(1)} GB.`
      : 'Immediate alert also sends when the configured AutoDelete trigger state is reached.';
  const turnstileCanEnable = Boolean(
    String(turnstileSiteKey || '').trim() &&
      (turnstileMeta.secretConfigured || turnstileMeta.envConfigured || (String(turnstileSecretKey || '').trim() && turnstileSecretKey !== SAVED_TURNSTILE_SECRET_TEXT))
  );
  const saveBlocked = activeTab === 'security' && turnstileEnabled && !turnstileCanEnable;

  let content = null;
  if (activeTab === 'branding') {
    content = (
      <Section
        title="Branding"
        description="Manage the public brand identity used across the header, logo assets, and colors."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name">
            <TextInput value={brandName} onChange={setBrandName} placeholder="3J TV" />
          </Field>
          <Field label="Brand color">
            <TextInput value={brandColor} onChange={setBrandColor} placeholder="#FA5252" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Logo URL" help="Use `/brand/logo.svg` or a hosted image URL.">
              <TextInput value={logoUrl} onChange={setLogoUrl} placeholder="/brand/logo.svg" />
            </Field>
          </div>
        </div>
      </Section>
    );
  } else if (activeTab === 'player') {
    content = (
      <Section
        title="Player"
        description="Control how movie cards behave when a user taps them in the catalog."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Default movie card click behavior"
            help="Users can still override this in their Profile preferences."
          >
            <select
              value={defaultMovieClick}
              onChange={(event) => setDefaultMovieClick(event.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
              <option value="play">Play immediately</option>
              <option value="preview">Open trailer preview</option>
            </select>
          </Field>
        </div>
      </Section>
    );
  } else if (activeTab === 'login') {
    content = (
      <Section
        title="Login"
        description="Configure login-screen backgrounds and the support/help link shown to users."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Login background (desktop)">
            <TextInput value={bgDesktop} onChange={setBgDesktop} placeholder="/auth/login-bg.jpg" />
          </Field>
          <Field label="Login background (mobile)">
            <TextInput value={bgMobile} onChange={setBgMobile} placeholder="/auth/login-bg-mobile.jpg" />
          </Field>
          <Field label="Help link URL">
            <TextInput value={helpUrl} onChange={setHelpUrl} placeholder="https://…" />
          </Field>
          <Field label="Help link text">
            <TextInput value={helpText} onChange={setHelpText} placeholder="FB Page" />
          </Field>
        </div>
      </Section>
    );
  } else if (activeTab === 'security') {
    content = (
      <Section
        title="Security"
        description="Add a Cloudflare Turnstile challenge to exposed public/admin login surfaces. This blocks bot form submissions before expensive auth work runs."
      >
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--admin-text)]">
                <ShieldCheck size={18} />
                Cloudflare Turnstile
              </div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Create a Turnstile widget in Cloudflare, then paste the Site Key and Secret Key here. The Secret Key is saved server-side and hidden after save.
              </div>
            </div>
            <StatusPill
              ok={turnstileEnabled && turnstileCanEnable}
              label={turnstileEnabled ? (turnstileCanEnable ? 'Enabled' : 'Needs keys') : 'Disabled'}
            />
          </div>

          <div className="mt-4">
            <ToggleRow
              label="Enable Turnstile protection"
              description="When enabled, selected login flows require a successful Cloudflare Turnstile token before authentication runs."
              checked={turnstileEnabled}
              onChange={setTurnstileEnabled}
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Turnstile Site Key" help="Public key used by the browser widget. Safe to expose in page HTML.">
            <TextInput value={turnstileSiteKey} onChange={setTurnstileSiteKey} placeholder="0x4AAAA..." />
          </Field>
          <Field
            label="Turnstile Secret Key"
            help="Private verification key used only by the server. Leave the saved placeholder unchanged to keep the current key."
          >
            <TextInput
              value={turnstileSecretKey}
              onChange={setTurnstileSecretKey}
              onFocus={() => {
                if (turnstileSecretKey === SAVED_TURNSTILE_SECRET_TEXT) setTurnstileSecretKey('');
              }}
              type="password"
              placeholder={turnstileMeta.secretConfigured || turnstileMeta.envConfigured ? SAVED_TURNSTILE_SECRET_TEXT : '0x4AAAA...'}
            />
            {(turnstileMeta.secretConfigured || turnstileMeta.envConfigured) ? (
              <div className="mt-2 text-xs font-semibold text-emerald-600">
                Secret key is configured{turnstileMeta.envConfigured ? ' from environment' : ' in admin settings'}.
              </div>
            ) : null}
          </Field>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Protected Surfaces</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Keep all three enabled for best protection. Existing IP throttles and failed-login lockouts still run even when Turnstile is disabled.
          </div>
          <div className="mt-4 space-y-3">
            <ToggleRow
              label="Public user login"
              description="Protects `/login` submissions to `/api/auth/login` before Xuione/Xtream validation is called."
              checked={turnstileProtectPublicLogin}
              onChange={setTurnstileProtectPublicLogin}
            />
            <ToggleRow
              label="Admin login"
              description="Protects `/admin/login` submissions before admin password verification runs."
              checked={turnstileProtectAdminLogin}
              onChange={setTurnstileProtectAdminLogin}
            />
            <ToggleRow
              label="Admin forgot password"
              description="Protects password email/reset requests before mailer work runs."
              checked={turnstileProtectAdminForgotPassword}
              onChange={setTurnstileProtectAdminForgotPassword}
            />
            <ToggleRow
              label="Only enforce on Public HTTPS hostname"
              description="Recommended. Protects `tv.3jhotspot.com` while leaving LAN/local access usable if Cloudflare keys are restricted to the public domain."
              checked={turnstilePublicHostOnly}
              onChange={setTurnstilePublicHostOnly}
            />
          </div>
        </div>

        {saveBlocked ? (
          <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-black dark:text-amber-200">
            Turnstile cannot be enabled until both Site Key and Secret Key are configured.
          </div>
        ) : null}
      </Section>
    );
  } else if (activeTab === 'publicHttps') {
    content = <PublicHttpsPanel />;
  } else if (activeTab === 'xuiHttps') {
    content = <XuiHttpsPanel />;
  } else if (activeTab === 'a2p') {
    content = <AdminA2PSettingsPanel />;
  } else if (activeTab === 'messages') {
    content = (
      <Section
        title="Telegram Messages"
        description="Edit the Telegram message templates for each monitor area. Use Message Stamps to insert live values like time, counts, channel details, and storage sections."
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div>
            <div className="text-sm font-semibold text-[var(--admin-text)]">Template Editor</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              The editor does not wrap long stamp lines, so inline `*-part` stamps stay on the same editable sentence. Use the preview under each editor to see the Telegram-rendered message.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowMessageStamps(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10"
          >
            <Info size={16} />
            Message Stamps
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {TELEGRAM_MESSAGE_TEMPLATE_FIELDS.map((field) => (
            <div key={field.key} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
              <Field
                label={field.label}
                help={`${field.description} Leave the textarea blank if you want Save to restore the default template.`}
              >
                <TextAreaInput
                  value={messageTemplates[field.key] || ''}
                  onChange={(value) => updateMessageTemplate(field.key, value)}
                  rows={field.rows}
                  noWrap
                />
                <TemplatePreview value={messageTemplates[field.key] || ''} />
              </Field>
            </div>
          ))}
        </div>
      </Section>
    );
  } else {
    content = (
      <Section
        title="Notifications"
        description="Configure Telegram delivery, immediate monitor alerts, and the daily 7:00 AM Manila report. Use the Messages tab to customize the Telegram body format."
      >
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Telegram Delivery</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Telegram is {telegramMeta.configured ? 'configured' : 'not configured'}.
            {telegramMeta.hasBotToken || telegramMeta.hasChatId
              ? ` Bot token: ${telegramMeta.hasBotToken ? 'saved' : 'missing'} • Chat ID: ${telegramMeta.hasChatId ? 'saved' : 'missing'}.`
              : ' Save a bot token and chat ID to start sending alerts.'}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
            <div className="grid gap-4">
              <Field label="Telegram bot token">
                <TextInput value={telegramBotToken} onChange={setTelegramBotToken} type="password" placeholder="123456789:AA..." />
              </Field>
              <Field label="Telegram chat ID">
                <TextInput value={telegramChatId} onChange={setTelegramChatId} placeholder="e.g. 123456789 or -100..." />
              </Field>
            </div>

            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="text-sm font-medium text-[var(--admin-text)]">Test Telegram</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Turn on test notifications to reveal realistic test sends for each monitor area and the daily report.
              </div>
              <div className="mt-4">
                <ToggleRow
                  label="Test notifications"
                  description="Show realistic test buttons for general Telegram delivery, each monitor area, and the daily monitor report."
                  checked={showTestActions}
                  onChange={setShowTestNotifications}
                />
              </div>
              <div className="mt-4">
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'general'}
                  disabled={testingTelegram}
                  onClick={testTelegram}
                >
                  Send Test Notification
                </TestActionButton>
              </div>
              {testErr ? (
                <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{testErr}</div>
              ) : null}
              {testOkMsg ? (
                <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{testOkMsg}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Monitor Areas</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            These switches control immediate alerts. The daily report always includes all monitor areas at the scheduled Manila time, even when an immediate switch is off.
          </div>

          <div className="mt-4 space-y-3">
            <ToggleRow
              label="Live TV Channels Up/down"
              description={
                notificationMeta.liveChannelsTracked > 0
                  ? `Currently tracking ${notificationMeta.liveChannelsTracked} live channels from XUI (${notificationMeta.liveChannelsUp} up, ${notificationMeta.liveChannelsDown} down). Immediate alerts wait ${liveDelayMinutes} minute(s) before sending, include friendly UP/DOWN status, and send down reminders every ${liveReminderHours} hour(s)${liveReminderHours === 0 ? ' (disabled)' : ''}.`
                  : `Sends an alert when a live channel changes between up and down states after ${liveDelayMinutes} minute(s) of stability. Down reminders repeat every ${liveReminderHours} hour(s)${liveReminderHours === 0 ? ' (disabled)' : ''}.`
              }
              checked={notifyLiveChannels}
              onChange={setNotifyLiveChannels}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'live_channels'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('live_channels')}
                >
                  Test Live TV Alert
                </TestActionButton>
              }
            />
            <ToggleRow
              label="User Reports"
              description="Sends an alert when a viewer submits a new report from the player."
              checked={notifyUserReports}
              onChange={setNotifyUserReports}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'user_reports'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('user_reports')}
                >
                  Test User Report Alert
                </TestActionButton>
              }
            />
            <ToggleRow
              label="NAS Size Report"
              description={
                reportNasSize
                  ? `Includes current NAS usage in the daily Telegram report. ${autoDeleteTriggerNote}`
                  : 'Includes current NAS usage in the daily Telegram report.'
              }
              checked={reportNasSize}
              onChange={setReportNasSize}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'nas_trigger'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('nas_trigger')}
                >
                  Test NAS Alert
                </TestActionButton>
              }
            />
            <ToggleRow
              label="/home/xui/content/vod Size Report"
              description={
                reportVodSize
                  ? `Includes the XUI VOD volume usage in the daily Telegram report. ${autoDeleteTriggerNote}`
                  : 'Includes the XUI VOD volume usage in the daily Telegram report.'
              }
              checked={reportVodSize}
              onChange={setReportVodSize}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'vod_trigger'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('vod_trigger')}
                >
                  Test VOD Alert
                </TestActionButton>
              }
            />
            <div className="pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Service Up/down Alerts</div>
              <div className="mt-2 space-y-3">
                <ToggleRow
                  label="NAS Up/down"
                  description={`Sends Telegram when the NAS mount changes between writable and unavailable. ${serviceStatusLabel(notificationMeta, 'nas')}`}
                  checked={notifyNasStatus}
                  onChange={setNotifyNasStatus}
                />
                <ToggleRow
                  label="VPN Up/down"
                  description={`Sends Telegram when VPN routing changes between ready and not ready. ${serviceStatusLabel(notificationMeta, 'vpn')}`}
                  checked={notifyVpnStatus}
                  onChange={setNotifyVpnStatus}
                />
                <ToggleRow
                  label="3JTV HTTPS Up/down"
                  description={`Sends Telegram when Public HTTPS changes between reachable and unavailable. ${serviceStatusLabel(notificationMeta, 'systemHttps')}`}
                  checked={notifySystemHttpsStatus}
                  onChange={setNotifySystemHttpsStatus}
                />
                <ToggleRow
                  label="XUI HTTPS Up/down"
                  description={`Sends Telegram when the XUI Cloudflare HTTPS tunnel changes between reachable and unavailable. ${serviceStatusLabel(notificationMeta, 'xuiHttps')}`}
                  checked={notifyXuiHttpsStatus}
                  onChange={setNotifyXuiHttpsStatus}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,320px)_minmax(0,1fr)]">
          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <Field
              label="Live alert delay (minutes)"
              help="How long a channel must stay up or down before Telegram sends the Live TV status alert. Use 0 for immediate delivery."
            >
              <TextInput
                value={liveChannelAlertDelayMinutes}
                onChange={setLiveChannelAlertDelayMinutes}
                type="number"
                min={0}
                max={1440}
                step={1}
              />
            </Field>
            <Field
              label="Live down reminder (hours)"
              help="While a stream stays down, Telegram repeats the reminder at this interval. Use 0 to disable down reminders."
            >
              <TextInput
                value={liveChannelDownReminderHours}
                onChange={setLiveChannelDownReminderHours}
                type="number"
                min={0}
                max={720}
                step={1}
              />
            </Field>
          </div>

          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <Field
              label="Daily report time"
              help={`Runs once per day after this time using timezone ${notificationTimeZone} (GMT+8 Manila). This daily report always includes Live TV, User Reports, NAS usage, and VOD usage regardless of the immediate-alert switches.`}
            >
              <TextInput value={dailyReportTime} onChange={setDailyReportTime} type="time" />
            </Field>
            <div className="mt-4">
              <TestActionButton
                visible={showTestActions}
                busy={testingTelegramTarget === 'daily_monitor_report'}
                disabled={testingTelegram}
                onClick={() => runTelegramTest('daily_monitor_report')}
              >
                Test Daily Report
              </TestActionButton>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="text-sm font-medium text-[var(--admin-text)]">Schedule Status</div>
            <div className="mt-2 text-sm text-[var(--admin-text)]">
              {notificationsEnabled
                ? 'Immediate Telegram alerts are enabled for at least one monitor area.'
                : 'Immediate Telegram alerts are disabled, but the daily Manila report still includes all monitor areas.'}
            </div>
            <div className="mt-2 text-xs text-[var(--admin-muted)]">
              {notificationMeta.dailyMonitorReportLastSentDate
                ? `Last daily monitor report sent on ${notificationMeta.dailyMonitorReportLastSentDate}.`
                : 'No daily monitor report has been sent yet.'}
            </div>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Public brand settings, player defaults, IPTV public HTTPS, XUI HTTPS, A2P SMS, Telegram notifications, and message templates.
        </p>

        <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-1">
          <div className="flex min-w-max gap-1">
            {TABS.map((tab) => (
              <TabButton key={tab.key} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
                {tab.label}
              </TabButton>
            ))}
          </div>
        </div>
      </div>

      {content}

      {activeTab !== 'publicHttps' && activeTab !== 'xuiHttps' && activeTab !== 'a2p' ? (
        <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          {err ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
          {okMsg ? <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div> : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving || saveBlocked}
              onClick={save}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={load}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              Reload
            </button>
          </div>
        </div>
      ) : null}

      {activeTab !== 'notifications' && activeTab !== 'messages' && activeTab !== 'xuiHttps' && activeTab !== 'a2p' ? (
        <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-lg font-semibold">Secrets</h2>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Manage TMDb, OpenSubtitles, XUI Admin, and other secret values in the Admin Secrets page.
          </p>

          <a
            href="/admin/secrets"
            className="mt-4 inline-flex rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10"
          >
            Open Secrets
          </a>
        </div>
      ) : null}

      <MessageStampsModal open={showMessageStamps} onClose={() => setShowMessageStamps(false)} />
    </div>
  );
}
