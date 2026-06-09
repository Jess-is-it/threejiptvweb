'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CircleCheck, Clock, Database, RefreshCw, Search, Send, ShieldCheck } from 'lucide-react';

const EMPTY_SETTINGS = {
  enabled: false,
  provider: 'SMART_MESSAGING_SUITE',
  baseUrl: 'https://enterprise.messagingsuite.smart.com.ph',
  sendPath: '/cgphttp/servlet/sendmsg',
  queryPath: '/cgphttp/servlet/querymsg',
  cancelPath: '/cgphttp/servlet/cancelmsg',
  startBatchPath: '/cgphttp/servlet/startbatch',
  sendBatchPath: '/cgphttp/servlet/sendbatch',
  creditsPath: '/cgpapi/service1/credits',
  authMethod: 'API_KEY_HEADERS',
  apiId: '',
  apiKey: '',
  username: '',
  password: '',
  defaultSource: '',
  sourceAddresses: [],
  registeredDelivery: true,
  monthlyCreditLimit: '',
  monthlyResetDay: 1,
  notes: '',
};

function Section({ title, description, children }) {
  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--admin-text)]">{title}</h2>
      {description ? <p className="mt-1 text-sm text-[var(--admin-muted)]">{description}</p> : null}
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function Card({ title, description, children }) {
  return (
    <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
      <div className="text-sm font-semibold text-[var(--admin-text)]">{title}</div>
      {description ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{description}</div> : null}
      <div className="mt-4">{children}</div>
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

function TextInput({ value, onChange, placeholder, type = 'text', min, max }) {
  return (
    <input
      type={type}
      min={min}
      max={max}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
      placeholder={placeholder}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
      placeholder={placeholder}
    />
  );
}

function Alert({ tone = 'info', children }) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-500/30 bg-red-500/10 text-red-700 data-[theme=dark]:text-red-200'
      : tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 data-[theme=dark]:text-emerald-200'
        : tone === 'warning'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 data-[theme=dark]:text-amber-100'
          : 'border-blue-500/30 bg-blue-500/10 text-blue-700 data-[theme=dark]:text-blue-200';
  return <div className={`rounded-lg border px-3 py-2 text-sm ${toneClass}`}>{children}</div>;
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div>
        <div className="text-sm font-medium text-[var(--admin-text)]">{label}</div>
        {description ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{description}</div> : null}
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
            : 'border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text)]')
        }
      >
        <span className={`relative inline-flex h-6 w-11 items-center rounded-full ${checked ? 'bg-emerald-500/70' : 'bg-slate-400/60'}`}>
          <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </span>
        <span className="min-w-[72px] text-left font-medium">{checked ? 'Enabled' : 'Disabled'}</span>
      </button>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = 'blue' }) {
  const colors = {
    blue: 'text-blue-500',
    green: 'text-emerald-500',
    red: 'text-red-500',
    purple: 'text-violet-500',
  };
  return (
    <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
      <div className="flex items-center gap-3">
        <Icon className={colors[tone] || colors.blue} size={22} />
        <div>
          <div className="text-xs text-[var(--admin-muted)]">{label}</div>
          <div className="text-xl font-semibold text-[var(--admin-text)]">{value ?? 0}</div>
        </div>
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function statusClass(status) {
  if (status === 'SUCCESS') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 data-[theme=dark]:text-emerald-200';
  if (status === 'FAILED') return 'border-red-500/30 bg-red-500/10 text-red-700 data-[theme=dark]:text-red-200';
  return 'border-amber-500/30 bg-amber-500/10 text-amber-800 data-[theme=dark]:text-amber-100';
}

export default function AdminA2PSettingsPanel() {
  const [activeSection, setActiveSection] = useState('settings');
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingCredits, setCheckingCredits] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testForm, setTestForm] = useState({
    destination: '',
    messageText: '3J TV A2P test message.',
    source: '',
    registeredDelivery: true,
  });

  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState({});
  const [purposes, setPurposes] = useState([]);
  const [logStatus, setLogStatus] = useState('ALL');
  const [logPurpose, setLogPurpose] = useState('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');

  function hydrate(nextSettings) {
    setSettings(nextSettings || null);
    setForm({
      ...EMPTY_SETTINGS,
      enabled: nextSettings?.enabled === true,
      provider: nextSettings?.provider || EMPTY_SETTINGS.provider,
      baseUrl: nextSettings?.baseUrl || EMPTY_SETTINGS.baseUrl,
      sendPath: nextSettings?.sendPath || EMPTY_SETTINGS.sendPath,
      queryPath: nextSettings?.queryPath || EMPTY_SETTINGS.queryPath,
      cancelPath: nextSettings?.cancelPath || EMPTY_SETTINGS.cancelPath,
      startBatchPath: nextSettings?.startBatchPath || EMPTY_SETTINGS.startBatchPath,
      sendBatchPath: nextSettings?.sendBatchPath || EMPTY_SETTINGS.sendBatchPath,
      creditsPath: nextSettings?.creditsPath || EMPTY_SETTINGS.creditsPath,
      authMethod: nextSettings?.authMethod || EMPTY_SETTINGS.authMethod,
      apiId: nextSettings?.apiId || '',
      apiKey: '',
      username: nextSettings?.username || '',
      password: '',
      defaultSource: nextSettings?.defaultSource || '',
      sourceAddresses: nextSettings?.sourceAddresses || [],
      registeredDelivery: nextSettings?.registeredDelivery !== false,
      monthlyCreditLimit: nextSettings?.monthlyCreditLimit ?? '',
      monthlyResetDay: nextSettings?.monthlyResetDay || 1,
      notes: nextSettings?.notes || '',
    });
  }

  async function loadSettings() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/a2p-messaging', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load A2P messaging settings.');
      hydrate(json.settings);
    } catch (loadError) {
      setError(loadError?.message || 'Failed to load A2P messaging settings.');
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs(nextPage = page) {
    setLogsLoading(true);
    setLogsError('');
    try {
      const params = new URLSearchParams({
        status: logStatus,
        purpose: logPurpose,
        search: logSearch,
        page: String(nextPage),
        pageSize: String(pageSize),
      });
      const response = await fetch(`/api/admin/a2p-messaging/messages?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load A2P messages.');
      setLogs(json.items || []);
      setSummary(json.summary || {});
      setPurposes(json.purposes || []);
      setTotal(Number(json.total || 0));
      setPage(Number(json.page || nextPage));
    } catch (loadError) {
      setLogsError(loadError?.message || 'Failed to load A2P messages.');
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (activeSection !== 'messages') return undefined;
    const timer = window.setTimeout(() => loadLogs(1), 250);
    return () => window.clearTimeout(timer);
  }, [activeSection, logStatus, logPurpose, logSearch, pageSize]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        enabled: form.enabled,
        provider: form.provider,
        baseUrl: form.baseUrl,
        sendPath: form.sendPath,
        queryPath: form.queryPath,
        cancelPath: form.cancelPath,
        startBatchPath: form.startBatchPath,
        sendBatchPath: form.sendBatchPath,
        creditsPath: form.creditsPath,
        authMethod: form.authMethod,
        apiId: form.apiId,
        username: form.username,
        defaultSource: form.defaultSource,
        sourceAddresses: form.sourceAddresses,
        registeredDelivery: form.registeredDelivery,
        monthlyCreditLimit: form.monthlyCreditLimit === '' ? null : Number(form.monthlyCreditLimit),
        monthlyResetDay: Number(form.monthlyResetDay) || 1,
        notes: form.notes,
      };
      if (String(form.apiKey || '').trim()) payload.apiKey = String(form.apiKey).trim();
      if (String(form.password || '').trim()) payload.password = String(form.password).trim();

      const response = await fetch('/api/admin/a2p-messaging', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to save A2P settings.');
      hydrate(json.settings);
      setMessage('A2P messaging settings saved.');
    } catch (saveError) {
      setError(saveError?.message || 'Failed to save A2P settings.');
    } finally {
      setSaving(false);
    }
  }

  async function clearSecret(secret) {
    const label = secret === 'apiKey' ? 'API key' : 'password';
    if (!window.confirm(`Remove the saved A2P ${label}?`)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/a2p-messaging', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(secret === 'apiKey' ? { clearApiKey: true } : { clearPassword: true }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || `Failed to clear A2P ${label}.`);
      hydrate(json.settings);
      setMessage(`A2P ${label} removed.`);
    } catch (clearError) {
      setError(clearError?.message || `Failed to clear A2P ${label}.`);
    } finally {
      setSaving(false);
    }
  }

  async function checkCredits() {
    setCheckingCredits(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/a2p-messaging/check-credits', { method: 'POST' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to check A2P credits.');
      hydrate(json.settings);
      const credit = json.settings?.creditCheck?.available ?? json.settings?.lastCreditAvailable;
      setMessage(credit === null || credit === undefined ? 'Credits check completed, but Smart did not return a parsable available value.' : `Credits check completed. Available credits: ${credit}.`);
    } catch (creditError) {
      setError(creditError?.message || 'Failed to check A2P credits.');
      await loadSettings();
    } finally {
      setCheckingCredits(false);
    }
  }

  async function sendTest(event) {
    event.preventDefault();
    setSendingTest(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/a2p-messaging/test-send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(testForm),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to send A2P test SMS.');
      hydrate(json.settings);
      setMessage(`Test SMS accepted by Smart${json.settings?.testSend?.messageId ? ` · Message-ID ${json.settings.testSend.messageId}` : ''}.`);
      if (activeSection === 'messages') await loadLogs(1);
    } catch (sendError) {
      setError(sendError?.message || 'Failed to send A2P test SMS.');
      await loadSettings();
    } finally {
      setSendingTest(false);
    }
  }

  const senderOptions = useMemo(() => {
    const items = new Set([...(form.sourceAddresses || []), form.defaultSource].filter(Boolean));
    return Array.from(items);
  }, [form.sourceAddresses, form.defaultSource]);

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading A2P messaging settings…</div>;

  const hasApiKey = settings?.apiKeyConfigured === true;
  const hasPassword = settings?.passwordConfigured === true;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <Section
        title="A2P Messaging"
        description="Smart Messaging Suite settings, credit checks, real test sends, and SMS delivery logs."
      >
        <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-1">
          <button
            type="button"
            onClick={() => setActiveSection('settings')}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${activeSection === 'settings' ? 'bg-[var(--admin-surface-solid)] text-[var(--admin-text)] shadow-sm' : 'text-[var(--admin-muted)] hover:text-[var(--admin-text)]'}`}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('messages')}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${activeSection === 'messages' ? 'bg-[var(--admin-surface-solid)] text-[var(--admin-text)] shadow-sm' : 'text-[var(--admin-muted)] hover:text-[var(--admin-text)]'}`}
          >
            Messages
          </button>
        </div>

        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {activeSection === 'settings' ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
            <div className="space-y-5">
              <Card title="1. Integration Status" description="Enable A2P only after Smart/Soprano provisions HTTP API access for this account.">
                <ToggleRow
                  label="Enable A2P messaging integration"
                  description="Saving settings does not send SMS. Test Send is the only action on this page that sends a real SMS."
                  checked={form.enabled}
                  onChange={(value) => updateField('enabled', value)}
                />
              </Card>

              <Card title="2. Provider and Account" description="Defaults match the Smart Messaging Suite HTTP API guide.">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Provider">
                    <TextInput value={form.provider} onChange={(value) => updateField('provider', value)} />
                  </Field>
                  <Field label="Base URL">
                    <TextInput value={form.baseUrl} onChange={(value) => updateField('baseUrl', value)} />
                  </Field>
                </div>
              </Card>

              <Card title="3. Authentication" description="API key headers are recommended for SMS sending. Credits check still requires username/password.">
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Auth Method">
                    <select
                      value={form.authMethod}
                      onChange={(event) => updateField('authMethod', event.target.value)}
                      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                    >
                      <option value="API_KEY_HEADERS">API key headers</option>
                      <option value="BASIC_AUTH">Basic authentication</option>
                      <option value="BODY_CREDENTIALS">Username/password body fields</option>
                    </select>
                  </Field>
                  <Field label="API ID">
                    <TextInput value={form.apiId} onChange={(value) => updateField('apiId', value)} />
                  </Field>
                  <Field label="API Key" help={hasApiKey ? `Saved: ${settings.apiKeyHint}` : 'Stored encrypted at rest after save.'}>
                    <TextInput value={form.apiKey} onChange={(value) => updateField('apiKey', value)} type="password" placeholder={hasApiKey ? 'Leave blank to keep saved API key' : ''} />
                    {hasApiKey ? (
                      <button type="button" onClick={() => clearSecret('apiKey')} className="mt-2 text-xs font-medium text-red-500 hover:underline">
                        Clear saved API key
                      </button>
                    ) : null}
                  </Field>
                  <Field label="Username">
                    <TextInput value={form.username} onChange={(value) => updateField('username', value)} />
                  </Field>
                  <Field label="Password" help={hasPassword ? `Saved: ${settings.passwordHint}` : 'Required for credits check and Basic Auth modes.'}>
                    <TextInput value={form.password} onChange={(value) => updateField('password', value)} type="password" placeholder={hasPassword ? 'Leave blank to keep saved password' : ''} />
                    {hasPassword ? (
                      <button type="button" onClick={() => clearSecret('password')} className="mt-2 text-xs font-medium text-red-500 hover:underline">
                        Clear saved password
                      </button>
                    ) : null}
                  </Field>
                </div>
              </Card>

              <Card title="4. API Endpoint Paths" description="Keep these paths unless Smart provides tenant-specific endpoints.">
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Send SMS"><TextInput value={form.sendPath} onChange={(value) => updateField('sendPath', value)} /></Field>
                  <Field label="Query Message"><TextInput value={form.queryPath} onChange={(value) => updateField('queryPath', value)} /></Field>
                  <Field label="Cancel Message"><TextInput value={form.cancelPath} onChange={(value) => updateField('cancelPath', value)} /></Field>
                  <Field label="Start Batch"><TextInput value={form.startBatchPath} onChange={(value) => updateField('startBatchPath', value)} /></Field>
                  <Field label="Send Batch"><TextInput value={form.sendBatchPath} onChange={(value) => updateField('sendBatchPath', value)} /></Field>
                  <Field label="Current Credits"><TextInput value={form.creditsPath} onChange={(value) => updateField('creditsPath', value)} /></Field>
                </div>
              </Card>

              <Card title="5. Sender IDs and Delivery Receipts" description="Sender IDs must match values provisioned on the Smart account.">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Default Sender ID / Source Address">
                    <TextInput value={form.defaultSource} onChange={(value) => updateField('defaultSource', value)} placeholder="3JXENTRONET" />
                  </Field>
                  <Field label="Registered Sender IDs" help="One sender ID per line. Test Send only allows values in this list.">
                    <TextArea
                      value={(form.sourceAddresses || []).join('\n')}
                      onChange={(value) => updateField('sourceAddresses', value.split(/\n|,/).map((item) => item.trim()).filter(Boolean))}
                      rows={5}
                    />
                  </Field>
                </div>
                <div className="mt-4">
                  <ToggleRow
                    label="Request delivery receipts by default"
                    description="Adds registered=1 to Smart sendmsg requests unless overridden by the test send form."
                    checked={form.registeredDelivery}
                    onChange={(value) => updateField('registeredDelivery', value)}
                  />
                </div>
              </Card>

              <Card title="6. Local Credit Rules" description="Direct credit checks use Smart's prepaid credits endpoint; monthly usage is tracked from local SMS logs.">
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Monthly Credit Limit">
                    <TextInput value={form.monthlyCreditLimit} onChange={(value) => updateField('monthlyCreditLimit', value)} type="number" min={0} placeholder="Optional" />
                  </Field>
                  <Field label="Monthly Reset Day">
                    <TextInput value={form.monthlyResetDay} onChange={(value) => updateField('monthlyResetDay', value)} type="number" min={1} max={31} />
                  </Field>
                  <Field label="Notes">
                    <TextArea value={form.notes} onChange={(value) => updateField('notes', value)} rows={3} placeholder="Provisioning notes, support tickets, IP whitelist details..." />
                  </Field>
                </div>
              </Card>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={saving}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ backgroundColor: 'var(--brand)' }}
                >
                  {saving ? 'Saving…' : 'Save A2P Settings'}
                </button>
                <button
                  type="button"
                  onClick={loadSettings}
                  disabled={saving}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                >
                  Reload
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <Card title="Smart API Summary">
                <div className="space-y-4 text-sm">
                  <div className="flex gap-3"><Bell className="mt-0.5 text-blue-500" size={20} /><div><strong>SMS sending</strong><div className="text-xs text-[var(--admin-muted)]">sendmsg supports one or more destinations, up to {settings?.capabilities?.maxDestinationsPerSendmsg || 300} per request.</div></div></div>
                  <div className="flex gap-3"><Database className="mt-0.5 text-blue-500" size={20} /><div><strong>Message lifecycle</strong><div className="text-xs text-[var(--admin-muted)]">querymsg checks status by Message-ID. cancelmsg can cancel eligible queued messages.</div></div></div>
                  <div className="flex gap-3"><ShieldCheck className="mt-0.5 text-blue-500" size={20} /><div><strong>Provisioning</strong><div className="text-xs text-[var(--admin-muted)]">HTTP API and any source IP whitelist must be enabled by Smart/Soprano.</div></div></div>
                </div>
              </Card>

              <Card title="Credits Tracking">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(settings?.lastCreditCheckStatus)}`}>
                    {settings?.lastCreditCheckStatus || 'NOT CHECKED'}
                  </span>
                  <button
                    type="button"
                    onClick={checkCredits}
                    disabled={checkingCredits}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs font-medium hover:bg-black/10 disabled:opacity-60"
                  >
                    <RefreshCw size={14} className={checkingCredits ? 'animate-spin' : ''} />
                    {checkingCredits ? 'Checking…' : 'Retrieve Credits'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-[var(--admin-muted)]">Available credits</div>
                    <div className="text-2xl font-semibold text-[var(--admin-text)]">{settings?.lastCreditAvailable ?? '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--admin-muted)]">Last checked</div>
                    <div className="text-sm text-[var(--admin-text)]">{formatDate(settings?.lastCreditCheckAt)}</div>
                  </div>
                </div>
                {settings?.lastCreditError ? <div className="mt-3"><Alert tone="warning">{settings.lastCreditError}</Alert></div> : null}
                {settings?.lastCreditResponse ? (
                  <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                    <div className="text-xs text-[var(--admin-muted)]">Last Smart response</div>
                    <code className="mt-1 block break-words text-xs text-[var(--admin-text)]">{settings.lastCreditResponse}</code>
                  </div>
                ) : null}
              </Card>

              <Card title="Test Send SMS" description="Sends one real SMS through Smart and can consume credits.">
                <form onSubmit={sendTest} className="space-y-4">
                  <Alert tone="warning">Use this only when you want to send a real SMS through the Smart account.</Alert>
                  <Field label="Contact #">
                    <TextInput value={testForm.destination} onChange={(value) => setTestForm((current) => ({ ...current, destination: value }))} placeholder="639171234567" />
                  </Field>
                  <Field label="Message">
                    <TextArea value={testForm.messageText} onChange={(value) => setTestForm((current) => ({ ...current, messageText: value }))} rows={3} />
                  </Field>
                  <Field label="Sender ID / Source Address">
                    <select
                      value={testForm.source}
                      onChange={(event) => setTestForm((current) => ({ ...current, source: event.target.value }))}
                      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                    >
                      <option value="">{form.defaultSource ? `Use default sender (${form.defaultSource})` : 'Use account default sender'}</option>
                      {senderOptions.map((source) => <option key={source} value={source}>{source}</option>)}
                    </select>
                  </Field>
                  <ToggleRow
                    label="Request delivery receipt"
                    checked={testForm.registeredDelivery}
                    onChange={(value) => setTestForm((current) => ({ ...current, registeredDelivery: value }))}
                  />
                  <button
                    type="submit"
                    disabled={sendingTest || !testForm.destination.trim() || !testForm.messageText.trim()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    style={{ backgroundColor: 'var(--brand)' }}
                  >
                    <Send size={16} />
                    {sendingTest ? 'Sending…' : 'Send Test SMS'}
                  </button>
                  {(settings?.lastTestSendStatus || settings?.lastTestSendResponse || settings?.lastTestSendError) ? (
                    <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm">
                      <div className="mb-2 flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(settings?.lastTestSendStatus)}`}>
                          {settings?.lastTestSendStatus || 'UNKNOWN'}
                        </span>
                        <span className="text-xs text-[var(--admin-muted)]">{formatDate(settings?.lastTestSendAt)}</span>
                      </div>
                      <div><strong>Destination:</strong> {settings?.lastTestSendDestination || '-'}</div>
                      <div><strong>Message ID:</strong> {settings?.lastTestSendMessageId || '-'}</div>
                      <div className="mt-2 text-xs text-[var(--admin-muted)]">{settings?.lastTestSendError || settings?.lastTestSendResponse}</div>
                    </div>
                  ) : null}
                </form>
              </Card>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {logsError ? <Alert tone="danger">{logsError}</Alert> : null}
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard icon={Send} label="Total SMS Logs" value={summary.total || 0} />
              <StatCard icon={CircleCheck} label="Successful" value={summary.success || 0} tone="green" />
              <StatCard icon={AlertTriangle} label="Failed" value={summary.failed || 0} tone="red" />
              <StatCard icon={Clock} label="This Month" value={summary.thisMonth || 0} tone="purple" />
            </div>

            <Card title="A2P Messages" description="Every Smart Messaging Suite SMS attempt is tracked here, including accepted and failed sends.">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_180px_140px_120px]">
                <Field label="Search">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 text-[var(--admin-muted)]" size={16} />
                    <input
                      value={logSearch}
                      onChange={(event) => setLogSearch(event.target.value)}
                      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
                      placeholder="Phone, sender, message ID, text..."
                    />
                  </div>
                </Field>
                <Field label="Status">
                  <select value={logStatus} onChange={(event) => setLogStatus(event.target.value)} className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                    <option value="ALL">All</option>
                    <option value="SUCCESS">Success</option>
                    <option value="FAILED">Failed</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </Field>
                <Field label="Purpose">
                  <select value={logPurpose} onChange={(event) => setLogPurpose(event.target.value)} className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                    <option value="ALL">All purposes</option>
                    {purposes.map((item) => <option key={item.purpose} value={item.purpose}>{item.purpose} ({item.count})</option>)}
                  </select>
                </Field>
                <Field label="Show entries">
                  <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                    {[10, 20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </Field>
                <div className="flex items-end">
                  <button type="button" onClick={() => loadLogs(page)} disabled={logsLoading} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60">
                    <RefreshCw size={16} className={logsLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--admin-border)]">
                <table className="min-w-[1080px] w-full text-left text-sm">
                  <thead className="bg-[var(--admin-surface)] text-xs uppercase text-[var(--admin-muted)]">
                    <tr>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Purpose</th>
                      <th className="px-3 py-3">To</th>
                      <th className="px-3 py-3">Sender ID</th>
                      <th className="px-3 py-3">Message</th>
                      <th className="px-3 py-3">Smart / Message ID</th>
                      <th className="px-3 py-3">Result</th>
                      <th className="px-3 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((item) => (
                      <tr key={item.id} className="border-t border-[var(--admin-border)]">
                        <td className="px-3 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span></td>
                        <td className="px-3 py-3">{item.purpose || 'GENERAL'}</td>
                        <td className="px-3 py-3">{item.destinationMasked || '-'}</td>
                        <td className="px-3 py-3">{item.source || '-'}</td>
                        <td className="px-3 py-3"><div className="max-w-[260px] whitespace-normal">{item.messagePreview || '-'}</div></td>
                        <td className="px-3 py-3"><div>{item.smartStatus || '-'}</div><div className="text-xs text-[var(--admin-muted)]">{item.messageId || '-'}</div></td>
                        <td className="px-3 py-3"><div className="max-w-[280px] whitespace-normal text-xs">{item.errorMessage || item.responseSummary || '-'}</div>{item.httpStatus ? <div className="text-xs text-[var(--admin-muted)]">HTTP {item.httpStatus}</div> : null}</td>
                        <td className="px-3 py-3">{formatDate(item.createdAt)}</td>
                      </tr>
                    ))}
                    {!logs.length ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-[var(--admin-muted)]">No A2P messages found.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-[var(--admin-muted)]">
                  Showing {logs.length ? (page - 1) * pageSize + 1 : 0}-{Math.min(total, page * pageSize)} of {total}
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={page <= 1 || logsLoading} onClick={() => { const next = Math.max(1, page - 1); setPage(next); loadLogs(next); }} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm disabled:opacity-60">Previous</button>
                  <span className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm">Page {page} of {maxPage}</span>
                  <button type="button" disabled={page >= maxPage || logsLoading} onClick={() => { const next = Math.min(maxPage, page + 1); setPage(next); loadLogs(next); }} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm disabled:opacity-60">Next</button>
                </div>
              </div>
            </Card>
          </div>
        )}
      </Section>
    </div>
  );
}
