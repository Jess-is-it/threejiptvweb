'use client';

import { useCallback, useEffect, useState } from 'react';

import HelpTooltip from './HelpTooltip';
import EditModal, { EditIconButton } from './EditModal';
import NotesButton from './NotesButton';

function Field({ label, children, hint, note }) {
  return (
    <div>
      <div className="mb-1 flex items-end justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--admin-text)]">
          <span>{label}</span>
          {note ? <HelpTooltip text={note} /> : null}
        </label>
        {hint ? <div className="text-[11px] text-[var(--admin-muted)]">{hint}</div> : null}
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

export default function AdminAutoDownloadXuiPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editTriggerOpen, setEditTriggerOpen] = useState(false);
  const [triggerSaving, setTriggerSaving] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [watchFolderIdMovies, setWatchFolderIdMovies] = useState('');
  const [watchFolderIdSeries, setWatchFolderIdSeries] = useState('');
  const [hasAccessCode, setHasAccessCode] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [scanState, setScanState] = useState(null);
  const [watchfolderAutoTriggerEnabled, setWatchfolderAutoTriggerEnabled] = useState(true);
  const [watchfolderCooldownMinutes, setWatchfolderCooldownMinutes] = useState(10);
  const [watchfolderMode, setWatchfolderMode] = useState('debounced');

  const applyTriggerSettings = useCallback((next) => {
    const trigger = next || {};
    setWatchfolderAutoTriggerEnabled(trigger.enabled !== false);
    setWatchfolderCooldownMinutes(Number(trigger.cooldownMinutes ?? 10) || 10);
    setWatchfolderMode(String(trigger.mode || 'debounced').toLowerCase() === 'immediate' ? 'immediate' : 'debounced');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [r, s] = await Promise.all([
          fetch('/api/admin/autodownload/xui', { cache: 'no-store' }),
          fetch('/api/admin/autodownload/scan-log?limit=1', { cache: 'no-store' }).catch(() => null),
        ]);
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load XUI config.');
        const x = j.xui || {};
        setBaseUrl(x.baseUrl || '');
        setWatchFolderIdMovies(x.watchFolderIdMovies || '');
        setWatchFolderIdSeries(x.watchFolderIdSeries || '');
        setHasAccessCode(Boolean(x.hasAccessCode));
        setHasApiKey(Boolean(x.hasApiKey));
        if (s) {
          const sj = await s.json().catch(() => ({}));
          if (sj?.ok) {
            setScanState(sj.state || null);
            applyTriggerSettings(sj.triggerSettings || null);
          }
        }
      } catch (e) {
        if (alive) setErr(e?.message || 'Failed to load XUI config.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyTriggerSettings]);

  const save = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/xui', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseUrl, accessCode, apiKey, watchFolderIdMovies, watchFolderIdSeries }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save.');
      setOk('Saved.');
      setAccessCode('');
      setApiKey('');
      setHasAccessCode(Boolean(j?.xui?.hasAccessCode));
      setHasApiKey(Boolean(j?.xui?.hasApiKey));
      return true;
    } catch (e) {
      setErr(e?.message || 'Failed to save.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/xui/test', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Test failed.');
      setOk('Connection OK.');
    } catch (e) {
      setErr(e?.message || 'Test failed.');
    } finally {
      setTesting(false);
    }
  };

  const refreshScanState = async () => {
    const r = await fetch('/api/admin/autodownload/scan-log?limit=1', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.ok) {
      setScanState(j.state || null);
      applyTriggerSettings(j.triggerSettings || null);
    }
  };

  const saveTriggerSettings = async () => {
    setTriggerSaving(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/xui/trigger-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: watchfolderAutoTriggerEnabled,
          cooldownMinutes: Number(watchfolderCooldownMinutes),
          mode: watchfolderMode,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save watchfolder trigger settings.');
      applyTriggerSettings(j.triggerSettings || null);
      setOk('Watchfolder trigger settings saved.');
      await refreshScanState();
      return true;
    } catch (e) {
      setErr(e?.message || 'Failed to save watchfolder trigger settings.');
      return false;
    } finally {
      setTriggerSaving(false);
    }
  };

  const triggerScan = async ({ type }) => {
    setScanBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/xui/trigger-scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, force: true, reason: 'manual' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Scan failed.');
      setOk(`${type === 'series' ? 'Series' : 'Movies'} manual scan triggered.`);
      await refreshScanState();
    } catch (e) {
      setErr(e?.message || 'Scan failed.');
    } finally {
      setScanBusy(false);
    }
  };

  const canSave = Boolean(
    baseUrl.trim() &&
      ((accessCode.trim() && apiKey.trim()) || (hasAccessCode && hasApiKey))
  );
  const triggerCooldown = Number(watchfolderCooldownMinutes);
  const triggerMode = String(watchfolderMode || '').trim().toLowerCase();
  const canSaveTrigger =
    Number.isFinite(triggerCooldown) &&
    triggerCooldown >= 0 &&
    triggerCooldown <= 1440 &&
    ['debounced', 'immediate'].includes(triggerMode);

  const notes = [
    {
      title: 'Purpose',
      items: ['Stores XUI One Admin API credentials and watchfolder IDs.', 'The system triggers scans with per-type cooldown (Movies and Series).'],
    },
    {
      title: 'Credentials',
      items: ['Access Code and API Key are stored encrypted at rest.', 'For security, fields are not shown again after save.'],
    },
    {
      title: 'Watch folders',
      items: [
        'WATCH_FOLDER_ID (Movies) and (Series) should be different and must match your XUI watchfolder configuration.',
        'Scans are triggered by the scheduler when items are finalized into Final folders (unless forced).',
      ],
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">XUI Integration</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Stores XUI One Admin API credentials and triggers Watch Folder scans with cooldown.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="XUI Integration — Notes" sections={notes} />
          <button
            onClick={test}
            disabled={loading || testing}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
      </div>

      {!(editOpen || editTriggerOpen) && err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
      {!(editOpen || editTriggerOpen) && ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div> : null}

      <div className="mt-6 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Configuration</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">View current XUI settings. Click Edit to update.</div>
          </div>
          <EditIconButton onClick={() => setEditOpen(true)} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Base URL</div>
            <div className="mt-1 font-mono text-xs">{baseUrl || '—'}</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Credentials</div>
            <div className="mt-1 text-sm font-semibold">{hasAccessCode && hasApiKey ? 'Saved (hidden)' : 'Not set'}</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Watch folders</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Movies: {watchFolderIdMovies || '—'}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Series: {watchFolderIdSeries || '—'}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">XUI Watchfolder Trigger</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">Auto-trigger, cooldown, and scan mode used by scheduler-triggered scans.</div>
          </div>
          <EditIconButton onClick={() => setEditTriggerOpen(true)} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Auto-trigger</div>
            <div className="mt-1 text-sm font-semibold">{watchfolderAutoTriggerEnabled ? 'On' : 'Off'}</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Cooldown</div>
            <div className="mt-1 text-sm font-semibold">{Number(watchfolderCooldownMinutes || 10)} min</div>
          </div>
          <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">Mode</div>
            <div className="mt-1 text-sm font-semibold">{watchfolderMode === 'immediate' ? 'Immediate (debug)' : 'Debounced'}</div>
          </div>
        </div>
      </div>

      <EditModal
        open={editOpen}
        title="Edit XUI Integration"
        description="Update XUI base URL, credentials, and watchfolder IDs. Credentials are encrypted at rest."
        error={err}
        success={ok}
        onCancel={() => {
          setEditOpen(false);
          setAccessCode('');
          setApiKey('');
        }}
        onSave={async () => {
          const saved = await save();
          if (saved) setEditOpen(false);
        }}
        saveDisabled={loading || busy || !canSave}
        saving={busy}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Base URL" hint="Example: https://panel.example.com:port" note="Base URL of your XUI panel (include protocol and port if needed).">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://xui.example.com:25500" />
          </Field>
          <Field label="Access Code" hint="Not displayed after save" note="XUI access_code credential. Stored encrypted at rest.">
            <Input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder={hasAccessCode ? '(already saved)' : 'accesscode'} />
          </Field>
          <Field label="API Key" hint="Not displayed after save" note="XUI api_key credential. Stored encrypted at rest.">
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasApiKey ? '(already saved)' : 'apikey'} />
          </Field>
          <Field label="WATCH_FOLDER_ID (Movies)" note="Watchfolder ID used when triggering Movies scans in XUI.">
            <Input value={watchFolderIdMovies} onChange={(e) => setWatchFolderIdMovies(e.target.value)} placeholder="1" />
          </Field>
          <Field label="WATCH_FOLDER_ID (Series)" note="Watchfolder ID used when triggering Series scans in XUI.">
            <Input value={watchFolderIdSeries} onChange={(e) => setWatchFolderIdSeries(e.target.value)} placeholder="2" />
          </Field>
        </div>
      </EditModal>

      <EditModal
        open={editTriggerOpen}
        title="Edit XUI Watchfolder Trigger"
        description="Controls scheduler scan auto-trigger, cooldown, and mode."
        error={err}
        success={ok}
        onCancel={async () => {
          setEditTriggerOpen(false);
          await refreshScanState();
        }}
        onSave={async () => {
          const saved = await saveTriggerSettings();
          if (saved) setEditTriggerOpen(false);
        }}
        saveDisabled={loading || triggerSaving || !canSaveTrigger}
        saving={triggerSaving}
      >
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Trigger settings</div>
          <div className="mt-2 text-xs text-[var(--admin-muted)]">Triggers scans only after items are moved to the Final folder.</div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Enable auto-trigger scan">
              <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={watchfolderAutoTriggerEnabled}
                  onChange={(e) => setWatchfolderAutoTriggerEnabled(e.target.checked)}
                />
                <span>{watchfolderAutoTriggerEnabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </Field>
            <Field label="Cooldown minutes" hint="0-1440">
              <Input
                type="number"
                min={0}
                max={1440}
                value={watchfolderCooldownMinutes}
                onChange={(e) => setWatchfolderCooldownMinutes(Number(e.target.value || 10))}
              />
            </Field>
            <Field label="Scan mode">
              <select
                value={watchfolderMode}
                onChange={(e) => setWatchfolderMode(e.target.value)}
                className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              >
                <option value="debounced">Debounced</option>
                <option value="immediate">Immediate (debug)</option>
              </select>
            </Field>
          </div>
          <div className="mt-2 text-xs text-[var(--admin-muted)]">Trigger only after moved to Final folder: Enabled (locked).</div>
        </div>
      </EditModal>

      {scanState ? (
        <div className="mt-6 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-sm">
          <div className="font-semibold">Scan state</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Cooldown minutes: {Number(watchfolderCooldownMinutes ?? 10) || 10} • Auto-trigger:{' '}
            {watchfolderAutoTriggerEnabled ? 'On' : 'Off'} • Mode: {watchfolderMode}
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Movies</div>
              <div className="mt-1 font-semibold">Pending: {scanState.moviesScanPending ? 'Yes' : 'No'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Last triggered:{' '}
                {scanState.moviesLastScanAt || scanState.lastMoviesScanTriggerAt
                  ? new Date(scanState.moviesLastScanAt || scanState.lastMoviesScanTriggerAt).toLocaleString()
                  : '—'}
              </div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Cooldown until:{' '}
                {scanState.moviesCooldownUntil ? new Date(scanState.moviesCooldownUntil).toLocaleString() : '—'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => triggerScan({ type: 'movie' })}
                  disabled={loading || scanBusy}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                >
                  Manual Scan
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Series</div>
              <div className="mt-1 font-semibold">Pending: {scanState.seriesScanPending ? 'Yes' : 'No'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Last triggered:{' '}
                {scanState.seriesLastScanAt || scanState.lastSeriesScanTriggerAt
                  ? new Date(scanState.seriesLastScanAt || scanState.lastSeriesScanTriggerAt).toLocaleString()
                  : '—'}
              </div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Cooldown until:{' '}
                {scanState.seriesCooldownUntil ? new Date(scanState.seriesCooldownUntil).toLocaleString() : '—'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => triggerScan({ type: 'series' })}
                  disabled={loading || scanBusy}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
                >
                  Manual Scan
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => triggerScan({ type: 'movie' })}
            disabled={loading || scanBusy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Manual Movies Scan
          </button>
          <button
            onClick={() => triggerScan({ type: 'series' })}
            disabled={loading || scanBusy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Manual Series Scan
          </button>
        </div>
      )}
    </div>
  );
}
