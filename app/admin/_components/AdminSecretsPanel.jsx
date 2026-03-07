'use client';

import { useEffect, useState } from 'react';

function RowShell({ label, desc, children, stored, actions }) {
  return (
    <tr className="border-t border-[var(--admin-border)] align-top">
      <td className="px-3 py-3">
        <div className="font-medium text-[var(--admin-text)]">{label}</div>
        {desc ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{desc}</div> : null}
      </td>
      <td className="px-3 py-3">{children}</td>
      <td className="px-3 py-3 text-[var(--admin-muted)]">{stored}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-2">{actions}</div>
      </td>
    </tr>
  );
}

function Input({ disabled, value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      type={type}
      className={
        'w-full rounded-lg border bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none ' +
        (disabled
          ? 'border-[var(--admin-border)] opacity-80'
          : 'border-[var(--admin-border)] focus:ring-2 focus:ring-[--brand]/30')
      }
      placeholder={placeholder}
    />
  );
}

function Textarea({ disabled, value, onChange, placeholder, rows = 5 }) {
  return (
    <textarea
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className={
        'w-full rounded-lg border bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none ' +
        (disabled
          ? 'border-[var(--admin-border)] opacity-80'
          : 'border-[var(--admin-border)] focus:ring-2 focus:ring-[--brand]/30')
      }
      placeholder={placeholder}
    />
  );
}

function normalizeServersFromText(text) {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => (u.endsWith('/') ? u : `${u}/`));
}

export default function AdminSecretsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [meta, setMeta] = useState(null); // { secrets, status, xuioneServers, xuiApi }
  const [edit, setEdit] = useState({}); // key -> boolean

  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [xuiServersText, setXuiServersText] = useState('');

  const [mailFrom, setMailFrom] = useState('');
  const [mailUser, setMailUser] = useState('');
  const [mailPass, setMailPass] = useState('');

  const [fbApiKey, setFbApiKey] = useState('');
  const [fbAuthDomain, setFbAuthDomain] = useState('');
  const [fbProjectId, setFbProjectId] = useState('');
  const [fbAppId, setFbAppId] = useState('');

  const load = async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/secrets', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load secrets.');
      setMeta(j);
      setEdit({});

      setTmdbApiKey(j?.secrets?.tmdbApiKey || '');
      setXuiServersText((j?.xuioneServers || []).join('\n'));

      setMailFrom(j?.secrets?.mailFrom || '');
      setMailUser(j?.secrets?.mailUser || '');
      setMailPass(j?.secrets?.mailPass || '');

      setFbApiKey(j?.secrets?.firebaseApiKey || '');
      setFbAuthDomain(j?.secrets?.firebaseAuthDomain || '');
      setFbProjectId(j?.secrets?.firebaseProjectId || '');
      setFbAppId(j?.secrets?.firebaseAppId || '');
    } catch (e) {
      setErr(e?.message || 'Failed to load secrets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const status = meta?.status || {};
  const xuiApi = meta?.xuiApi || null;
  const isEditing = (k) => Boolean(edit?.[k]);

  const beginEdit = (k) => {
    setErr('');
    setOkMsg('');
    setEdit((m) => ({ ...m, [k]: true }));
  };

  const cancelEdit = (k) => {
    setErr('');
    setOkMsg('');
    if (!meta) return;

    if (k === 'tmdb') setTmdbApiKey(meta?.secrets?.tmdbApiKey || '');
    if (k === 'xuione') setXuiServersText((meta?.xuioneServers || []).join('\n'));
    if (k === 'mailer') {
      setMailFrom(meta?.secrets?.mailFrom || '');
      setMailUser(meta?.secrets?.mailUser || '');
      setMailPass(meta?.secrets?.mailPass || '');
    }
    if (k === 'firebase') {
      setFbApiKey(meta?.secrets?.firebaseApiKey || '');
      setFbAuthDomain(meta?.secrets?.firebaseAuthDomain || '');
      setFbProjectId(meta?.secrets?.firebaseProjectId || '');
      setFbAppId(meta?.secrets?.firebaseAppId || '');
    }

    setEdit((m) => ({ ...m, [k]: false }));
  };

  const saveRow = async (k) => {
    setSaving(k);
    setErr('');
    setOkMsg('');
    try {
      let payload = {};

      if (k === 'tmdb') payload = { secrets: { tmdbApiKey } };
      if (k === 'xuione') payload = { xuioneServers: normalizeServersFromText(xuiServersText) };
      if (k === 'mailer') payload = { secrets: { mailFrom, mailUser, mailPass } };
      if (k === 'firebase') {
        payload = {
          secrets: {
            firebaseApiKey: fbApiKey,
            firebaseAuthDomain: fbAuthDomain,
            firebaseProjectId: fbProjectId,
            firebaseAppId: fbAppId,
          },
        };
      }

      const r = await fetch('/api/admin/secrets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save.');
      setMeta(j);
      setEdit((m) => ({ ...m, [k]: false }));
      setOkMsg('Saved.');

      // Sync inputs to returned values
      if (k === 'tmdb') setTmdbApiKey(j?.secrets?.tmdbApiKey || '');
      if (k === 'xuione') setXuiServersText((j?.xuioneServers || []).join('\n'));
      if (k === 'mailer') {
        setMailFrom(j?.secrets?.mailFrom || '');
        setMailUser(j?.secrets?.mailUser || '');
        setMailPass(j?.secrets?.mailPass || '');
      }
      if (k === 'firebase') {
        setFbApiKey(j?.secrets?.firebaseApiKey || '');
        setFbAuthDomain(j?.secrets?.firebaseAuthDomain || '');
        setFbProjectId(j?.secrets?.firebaseProjectId || '');
        setFbAppId(j?.secrets?.firebaseAppId || '');
      }
    } catch (e) {
      setErr(e?.message || 'Failed to save.');
    } finally {
      setSaving('');
    }
  };

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Secrets</h2>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            XUI/Xuione API lives under <code>/api/xuione/*</code> and uses these settings/secrets.
          </p>
          {xuiApi?.endpoints?.length ? (
            <div className="mt-2 text-xs text-[var(--admin-muted)]">
              {xuiApi.endpoints.map((e) => e.path).join(' · ')}
            </div>
          ) : null}
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
        >
          Refresh
        </button>
      </div>

      {err ? (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
      ) : null}
      {okMsg ? (
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-[var(--admin-text)]">
            <tr>
              <th className="px-3 py-2">Secret</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Stored</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <RowShell
              label="TMDb"
              desc="Used by /api/tmdb/*"
              stored={status?.tmdbApiKey?.set ? 'Yes' : 'No'}
              actions={
                !isEditing('tmdb') ? (
                  <button
                    onClick={() => beginEdit('tmdb')}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      disabled={saving === 'tmdb'}
                      onClick={() => cancelEdit('tmdb')}
                      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={saving === 'tmdb'}
                      onClick={() => saveRow('tmdb')}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: 'var(--brand)' }}
                    >
                      {saving === 'tmdb' ? 'Saving…' : 'Save'}
                    </button>
                  </>
                )
              }
            >
              <Input
                disabled={!isEditing('tmdb') || saving === 'tmdb'}
                value={tmdbApiKey}
                onChange={setTmdbApiKey}
                placeholder="TMDB_API_KEY"
                type="text"
              />
            </RowShell>

            <RowShell
              label="Xuione (XUI)"
              desc="Servers list used by /api/auth/login and /api/xuione/*"
              stored={(meta?.xuioneServers || []).length ? 'Yes' : 'No'}
              actions={
                !isEditing('xuione') ? (
                  <button
                    onClick={() => beginEdit('xuione')}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      disabled={saving === 'xuione'}
                      onClick={() => cancelEdit('xuione')}
                      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={saving === 'xuione'}
                      onClick={() => saveRow('xuione')}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: 'var(--brand)' }}
                    >
                      {saving === 'xuione' ? 'Saving…' : 'Save'}
                    </button>
                  </>
                )
              }
            >
              <Textarea
                disabled={!isEditing('xuione') || saving === 'xuione'}
                value={xuiServersText}
                onChange={setXuiServersText}
                placeholder="https://tv1.example.com/\nhttps://tv2.example.com/"
                rows={5}
              />
            </RowShell>

            <RowShell
              label="Mailer"
              desc="Gmail/from config used by mail functions"
              stored={status?.mailFrom?.set || status?.mailUser?.set || status?.mailPass?.set ? 'Yes' : 'No'}
              actions={
                !isEditing('mailer') ? (
                  <button
                    onClick={() => beginEdit('mailer')}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      disabled={saving === 'mailer'}
                      onClick={() => cancelEdit('mailer')}
                      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={saving === 'mailer'}
                      onClick={() => saveRow('mailer')}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: 'var(--brand)' }}
                    >
                      {saving === 'mailer' ? 'Saving…' : 'Save'}
                    </button>
                  </>
                )
              }
            >
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  disabled={!isEditing('mailer') || saving === 'mailer'}
                  value={mailFrom}
                  onChange={setMailFrom}
                  placeholder="MAIL_FROM"
                />
                <Input
                  disabled={!isEditing('mailer') || saving === 'mailer'}
                  value={mailUser}
                  onChange={setMailUser}
                  placeholder="MAIL_USER"
                />
                <Input
                  disabled={!isEditing('mailer') || saving === 'mailer'}
                  value={mailPass}
                  onChange={setMailPass}
                  placeholder="MAIL_PASS"
                />
              </div>
            </RowShell>

            <RowShell
              label="Firebase"
              desc="Firebase web config"
              stored={
                status?.firebaseApiKey?.set ||
                status?.firebaseAuthDomain?.set ||
                status?.firebaseProjectId?.set ||
                status?.firebaseAppId?.set
                  ? 'Yes'
                  : 'No'
              }
              actions={
                !isEditing('firebase') ? (
                  <button
                    onClick={() => beginEdit('firebase')}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      disabled={saving === 'firebase'}
                      onClick={() => cancelEdit('firebase')}
                      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={saving === 'firebase'}
                      onClick={() => saveRow('firebase')}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      style={{ backgroundColor: 'var(--brand)' }}
                    >
                      {saving === 'firebase' ? 'Saving…' : 'Save'}
                    </button>
                  </>
                )
              }
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  disabled={!isEditing('firebase') || saving === 'firebase'}
                  value={fbApiKey}
                  onChange={setFbApiKey}
                  placeholder="NEXT_PUBLIC_FIREBASE_API_KEY"
                />
                <Input
                  disabled={!isEditing('firebase') || saving === 'firebase'}
                  value={fbAuthDomain}
                  onChange={setFbAuthDomain}
                  placeholder="NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
                />
                <Input
                  disabled={!isEditing('firebase') || saving === 'firebase'}
                  value={fbProjectId}
                  onChange={setFbProjectId}
                  placeholder="NEXT_PUBLIC_FIREBASE_PROJECT_ID"
                />
                <Input
                  disabled={!isEditing('firebase') || saving === 'firebase'}
                  value={fbAppId}
                  onChange={setFbAppId}
                  placeholder="NEXT_PUBLIC_FIREBASE_APP_ID"
                />
              </div>
            </RowShell>
          </tbody>
        </table>
      </div>
    </div>
  );
}
