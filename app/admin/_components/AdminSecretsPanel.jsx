'use client';

import { useCallback, useEffect, useState } from 'react';

import EditModal from './EditModal';
import HelpTooltip from './HelpTooltip';

function Input({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={type}
      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
      placeholder={placeholder}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 5 }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
      placeholder={placeholder}
    />
  );
}

function Field({ label, help, children }) {
  const infoText = String(help || '').trim();
  return (
    <label className="block space-y-1.5">
      <div className="inline-flex items-center gap-2 text-sm font-medium text-[var(--admin-text)]">
        <span>{label}</span>
        {infoText ? <HelpTooltip text={infoText} /> : null}
      </div>
      {children}
    </label>
  );
}

function SummaryCard({ title, status, detail }) {
  return (
    <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="text-sm font-medium text-[var(--admin-text)]">{title}</div>
      <div className="mt-2 text-lg font-semibold text-[var(--admin-text)]">{status}</div>
      {detail ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{detail}</div> : null}
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
      <div className="text-sm font-semibold text-[var(--admin-text)]">{title}</div>
      {description ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{description}</div> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

const EMPTY_OBJECT = {};

function normalizeServersFromText(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => (u.endsWith('/') ? u : `${u}/`));
}

export default function AdminSecretsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [meta, setMeta] = useState(null);

  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [opensubtitlesApiKey, setOpensubtitlesApiKey] = useState('');
  const [opensubtitlesUsername, setOpensubtitlesUsername] = useState('');
  const [opensubtitlesPassword, setOpensubtitlesPassword] = useState('');
  const [xuiServersText, setXuiServersText] = useState('');
  const [xuiAdminBaseUrl, setXuiAdminBaseUrl] = useState('');
  const [xuiAdminAccessCode, setXuiAdminAccessCode] = useState('');
  const [xuiAdminApiKey, setXuiAdminApiKey] = useState('');
  const [xuiAdminUsername, setXuiAdminUsername] = useState('');
  const [xuiAdminPassword, setXuiAdminPassword] = useState('');
  const [mailFrom, setMailFrom] = useState('');
  const [mailUser, setMailUser] = useState('');
  const [mailPass, setMailPass] = useState('');
  const [fbApiKey, setFbApiKey] = useState('');
  const [fbAuthDomain, setFbAuthDomain] = useState('');
  const [fbProjectId, setFbProjectId] = useState('');
  const [fbAppId, setFbAppId] = useState('');

  const applyMetaToForm = useCallback((payload) => {
    setTmdbApiKey(payload?.secrets?.tmdbApiKey || '');
    setOpensubtitlesApiKey(payload?.secrets?.opensubtitlesApiKey || '');
    setOpensubtitlesUsername(payload?.secrets?.opensubtitlesUsername || '');
    setOpensubtitlesPassword(payload?.secrets?.opensubtitlesPassword || '');
    setXuiServersText((payload?.xuioneServers || []).join('\n'));
    setXuiAdminBaseUrl(payload?.secrets?.xuiAdminBaseUrl || '');
    setXuiAdminAccessCode(payload?.secrets?.xuiAdminAccessCode || '');
    setXuiAdminApiKey(payload?.secrets?.xuiAdminApiKey || '');
    setXuiAdminUsername(payload?.secrets?.xuiAdminUsername || '');
    setXuiAdminPassword(payload?.secrets?.xuiAdminPassword || '');
    setMailFrom(payload?.secrets?.mailFrom || '');
    setMailUser(payload?.secrets?.mailUser || '');
    setMailPass(payload?.secrets?.mailPass || '');
    setFbApiKey(payload?.secrets?.firebaseApiKey || '');
    setFbAuthDomain(payload?.secrets?.firebaseAuthDomain || '');
    setFbProjectId(payload?.secrets?.firebaseProjectId || '');
    setFbAppId(payload?.secrets?.firebaseAppId || '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    try {
      const response = await fetch('/api/admin/secrets', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load secrets.');
      setMeta(json);
      applyMetaToForm(json);
    } catch (error) {
      setErr(error?.message || 'Failed to load secrets.');
    } finally {
      setLoading(false);
    }
  }, [applyMetaToForm]);

  useEffect(() => {
    load();
  }, [load]);

  const status = meta?.status ?? EMPTY_OBJECT;
  const secrets = meta?.secrets ?? EMPTY_OBJECT;
  const xuiApi = meta?.xuiApi || null;
  const hasSecretValue = (key) => Boolean(String(secrets?.[key] || '').trim());
  const isStoredSecret = (key) => Boolean(status?.[key]?.set);

  const openSubtitlesReady = Boolean(
    hasSecretValue('opensubtitlesApiKey') &&
      hasSecretValue('opensubtitlesUsername') &&
      hasSecretValue('opensubtitlesPassword')
  );
  const openSubtitlesPartial = Boolean(
    hasSecretValue('opensubtitlesApiKey') ||
      hasSecretValue('opensubtitlesUsername') ||
      hasSecretValue('opensubtitlesPassword')
  );

  const summary = [
    {
      title: 'TMDb',
      status: hasSecretValue('tmdbApiKey') ? 'Configured' : 'Not set',
      detail: hasSecretValue('tmdbApiKey')
        ? isStoredSecret('tmdbApiKey')
          ? 'Movie and series metadata'
          : 'Movie and series metadata · from env'
        : 'Movie and series metadata',
    },
    {
      title: 'OpenSubtitles',
      status: openSubtitlesReady ? 'Configured' : openSubtitlesPartial ? 'Partial' : 'Not set',
      detail:
        openSubtitlesReady || openSubtitlesPartial
          ? isStoredSecret('opensubtitlesApiKey') ||
            isStoredSecret('opensubtitlesUsername') ||
            isStoredSecret('opensubtitlesPassword')
            ? 'Fallback subtitles in player'
            : 'Fallback subtitles in player · from env'
          : 'Fallback subtitles in player',
    },
    {
      title: 'Xuione Servers',
      status: `${Array.isArray(meta?.xuioneServers) ? meta.xuioneServers.length : 0} server(s)`,
      detail: 'Used by auth and playback APIs',
    },
    {
      title: 'XUI Admin API',
      status:
        hasSecretValue('xuiAdminBaseUrl') && hasSecretValue('xuiAdminAccessCode') && hasSecretValue('xuiAdminApiKey')
          ? 'Configured'
          : hasSecretValue('xuiAdminBaseUrl') || hasSecretValue('xuiAdminAccessCode') || hasSecretValue('xuiAdminApiKey')
            ? 'Partial'
            : 'Not set',
      detail: 'Used by Live channel online detection',
    },
    {
      title: 'Mailer',
      status: hasSecretValue('mailFrom') || hasSecretValue('mailUser') || hasSecretValue('mailPass') ? 'Configured' : 'Not set',
      detail:
        hasSecretValue('mailFrom') || hasSecretValue('mailUser') || hasSecretValue('mailPass')
          ? isStoredSecret('mailFrom') || isStoredSecret('mailUser') || isStoredSecret('mailPass')
            ? 'Email notifications'
            : 'Email notifications · from env'
          : 'Email notifications',
    },
    {
      title: 'Firebase',
      status:
        hasSecretValue('firebaseApiKey') ||
        hasSecretValue('firebaseAuthDomain') ||
        hasSecretValue('firebaseProjectId') ||
        hasSecretValue('firebaseAppId')
          ? 'Configured'
          : 'Not set',
      detail:
        hasSecretValue('firebaseApiKey') ||
        hasSecretValue('firebaseAuthDomain') ||
        hasSecretValue('firebaseProjectId') ||
        hasSecretValue('firebaseAppId')
          ? isStoredSecret('firebaseApiKey') ||
            isStoredSecret('firebaseAuthDomain') ||
            isStoredSecret('firebaseProjectId') ||
            isStoredSecret('firebaseAppId')
            ? 'Client auth/web config'
            : 'Client auth/web config · from env'
          : 'Client auth/web config',
    },
  ];

  const openEditor = () => {
    setErr('');
    setOkMsg('');
    applyMetaToForm(meta || {});
    setModalOpen(true);
  };

  const closeEditor = () => {
    if (saving) return;
    applyMetaToForm(meta || {});
    setModalOpen(false);
  };

  const saveAll = async () => {
    setSaving(true);
    setErr('');
    setOkMsg('');
    try {
      const payload = {
        secrets: {
          tmdbApiKey,
          opensubtitlesApiKey,
          opensubtitlesUsername,
          opensubtitlesPassword,
          xuiAdminBaseUrl,
          xuiAdminAccessCode,
          xuiAdminApiKey,
          xuiAdminUsername,
          xuiAdminPassword,
          mailFrom,
          mailUser,
          mailPass,
          firebaseApiKey: fbApiKey,
          firebaseAuthDomain: fbAuthDomain,
          firebaseProjectId: fbProjectId,
          firebaseAppId: fbAppId,
        },
        xuioneServers: normalizeServersFromText(xuiServersText),
      };

      const response = await fetch('/api/admin/secrets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to save.');
      setMeta(json);
      applyMetaToForm(json);
      setOkMsg('Secrets saved.');
      setModalOpen(false);
    } catch (error) {
      setErr(error?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--admin-text)]">Secrets</h2>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Store API keys, credentials, and Xuione server origins used by the admin and public playback APIs.
          </p>
          {xuiApi?.endpoints?.length ? (
            <div className="mt-2 text-xs text-[var(--admin-muted)]">{xuiApi.endpoints.map((item) => item.path).join(' · ')}</div>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
          >
            Refresh
          </button>
          <button
            onClick={openEditor}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            Edit Secrets
          </button>
        </div>
      </div>

      {err ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{err}</div> : null}
      {okMsg ? (
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{okMsg}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {summary.map((item) => (
          <SummaryCard key={item.title} title={item.title} status={item.status} detail={item.detail} />
        ))}
      </div>

      <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <div className="text-sm font-semibold text-[var(--admin-text)]">Current Setup</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">OpenSubtitles</div>
            <div className="mt-2 text-sm text-[var(--admin-text)]">
              {openSubtitlesReady ? 'Ready for subtitle fallback' : openSubtitlesPartial ? 'Partially configured' : 'Not configured'}
            </div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Uses API key plus account username/password. User-Agent is automatic.</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Xuione Servers</div>
            <div className="mt-2 text-sm text-[var(--admin-text)]">
              {Array.isArray(meta?.xuioneServers) && meta.xuioneServers.length
                ? meta.xuioneServers.join(' · ')
                : 'No Xuione servers configured'}
            </div>
          </div>
        </div>
      </div>

      <EditModal
        open={modalOpen}
        title="Edit Secrets"
        description="Edit all API keys, credentials, and Xuione servers in one form."
        error={err}
        success=""
        onCancel={closeEditor}
        onSave={saveAll}
        saveLabel="Save Secrets"
        saveDisabled={saving}
        saving={saving}
      >
        <div className="space-y-4">
          <Section title="TMDb" description="Used for metadata, posters, trailers, and request catalog APIs.">
            <Field label="TMDb API Key" help="Used by `/api/tmdb/*` and metadata enrichment.">
              <Input value={tmdbApiKey} onChange={setTmdbApiKey} placeholder="TMDB_API_KEY" />
            </Field>
          </Section>

          <Section
            title="OpenSubtitles"
            description="Used as fallback movie subtitles when XUI does not already provide subtitle tracks."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="OpenSubtitles API Key"
                help="Create this in your OpenSubtitles account dashboard."
              >
                <Input value={opensubtitlesApiKey} onChange={setOpensubtitlesApiKey} placeholder="OPENSUBTITLES_API_KEY" />
              </Field>
              <Field
                label="OpenSubtitles Username"
                help="Use your OpenSubtitles account username."
              >
                <Input value={opensubtitlesUsername} onChange={setOpensubtitlesUsername} placeholder="OPENSUBTITLES_USERNAME" />
              </Field>
              <Field
                label="OpenSubtitles Password"
                help="Used only by the server to fetch subtitle downloads."
              >
                <Input
                  value={opensubtitlesPassword}
                  onChange={setOpensubtitlesPassword}
                  placeholder="OPENSUBTITLES_PASSWORD"
                  type="password"
                />
              </Field>
            </div>
          </Section>

          <Section title="Xuione / XUI" description="One server URL per line. These are used by auth, catalog, and playback APIs.">
            <Field label="Xuione Servers" help="Example: `https://tv1.example.com/`">
              <Textarea
                value={xuiServersText}
                onChange={setXuiServersText}
                placeholder="https://tv1.example.com/\nhttps://tv2.example.com/"
                rows={5}
              />
            </Field>
          </Section>

          <Section
            title="XUI Admin API"
            description="Used for admin-side Live stream listing so the app can hide down/stopped channels."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Base URL" help="Example: `https://panel.example.com:2053` (no path).">
                <Input value={xuiAdminBaseUrl} onChange={setXuiAdminBaseUrl} placeholder="XUI_ADMIN_BASE_URL" />
              </Field>
              <Field label="Access Code" help="The XUI panel access code used in the API URL path.">
                <Input value={xuiAdminAccessCode} onChange={setXuiAdminAccessCode} placeholder="XUI_ADMIN_ACCESS_CODE" />
              </Field>
              <Field label="API Key" help="The XUI API key used as `api_key` for panel actions (e.g. `get_streams`).">
                <Input value={xuiAdminApiKey} onChange={setXuiAdminApiKey} placeholder="XUI_ADMIN_API_KEY" type="password" />
              </Field>
              <Field label="Username (optional)" help="Stored for future admin-side API calls if needed.">
                <Input value={xuiAdminUsername} onChange={setXuiAdminUsername} placeholder="XUI_ADMIN_USERNAME" />
              </Field>
              <Field label="Password (optional)" help="Stored for future admin-side API calls if needed.">
                <Input value={xuiAdminPassword} onChange={setXuiAdminPassword} placeholder="XUI_ADMIN_PASSWORD" type="password" />
              </Field>
            </div>
          </Section>

          <Section title="Mailer" description="Used for account and notification emails.">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Mail From" help="Displayed as sender address.">
                <Input value={mailFrom} onChange={setMailFrom} placeholder="MAIL_FROM" />
              </Field>
              <Field label="Mail User" help="SMTP or Gmail username.">
                <Input value={mailUser} onChange={setMailUser} placeholder="MAIL_USER" />
              </Field>
              <Field label="Mail Password" help="SMTP or Gmail app password.">
                <Input value={mailPass} onChange={setMailPass} placeholder="MAIL_PASS" type="password" />
              </Field>
            </div>
          </Section>

          <Section title="Firebase" description="Web client configuration for Firebase-based flows.">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Firebase API Key">
                <Input value={fbApiKey} onChange={setFbApiKey} placeholder="NEXT_PUBLIC_FIREBASE_API_KEY" />
              </Field>
              <Field label="Firebase Auth Domain">
                <Input value={fbAuthDomain} onChange={setFbAuthDomain} placeholder="NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" />
              </Field>
              <Field label="Firebase Project ID">
                <Input value={fbProjectId} onChange={setFbProjectId} placeholder="NEXT_PUBLIC_FIREBASE_PROJECT_ID" />
              </Field>
              <Field label="Firebase App ID">
                <Input value={fbAppId} onChange={setFbAppId} placeholder="NEXT_PUBLIC_FIREBASE_APP_ID" />
              </Field>
            </div>
          </Section>
        </div>
      </EditModal>
    </div>
  );
}
