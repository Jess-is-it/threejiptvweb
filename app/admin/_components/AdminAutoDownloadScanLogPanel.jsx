'use client';

import { useEffect, useState } from 'react';

import NotesButton from './NotesButton';

function StatusPill({ status }) {
  const s = String(status || '').toLowerCase();
  const cls =
    s === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : s === 'skipped'
        ? 'border-amber-500/30 bg-amber-500/10 text-black data-[theme=dark]:text-amber-100'
        : 'border-red-500/30 bg-red-500/10 text-red-200';
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${cls}`}>{status || '—'}</span>;
}

export default function AdminAutoDownloadScanLogPanel() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [logs, setLogs] = useState([]);
  const [state, setState] = useState(null);
  const [triggerSettings, setTriggerSettings] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/autodownload/scan-log?limit=200', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load scan log.');
      setLogs(Array.isArray(j.logs) ? j.logs : []);
      setState(j.state || null);
      setTriggerSettings(j.triggerSettings || null);
    } catch (e) {
      setErr(e?.message || 'Failed to load scan log.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const notes = [
    {
      title: 'What this is',
      items: [
        'This is the history of XUI watchfolder scan triggers (Movies and Series).',
        'Scanning is debounced per type and obeys cooldown to prevent spam.',
      ],
    },
    {
      title: 'Cooldown state',
      items: [
        'Pending becomes Yes when an item is finalized into the Final folders.',
        'The scheduler triggers a scan only when pending and cooldown time has passed.',
      ],
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">XUI Scan Log</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">Shows scan triggers + cooldown state.</div>
        </div>
        <div className="flex items-center gap-2">
          <NotesButton title="XUI Scan Log — Notes" sections={notes} />
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}

      {state ? (
        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-sm">
          <div className="font-semibold">Cooldown state</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Cooldown minutes: {Number(triggerSettings?.cooldownMinutes ?? 10) || 10} • Auto-trigger:{' '}
            {triggerSettings?.enabled === false ? 'Off' : 'On'} • Mode:{' '}
            {String(triggerSettings?.mode || 'debounced')}
          </div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Movies pending</div>
              <div className="mt-1 font-semibold">{state.moviesScanPending ? 'Yes' : 'No'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Last triggered:{' '}
                {state.moviesLastScanAt || state.lastMoviesScanTriggerAt
                  ? new Date(state.moviesLastScanAt || state.lastMoviesScanTriggerAt).toLocaleString()
                  : '—'}
              </div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Cooldown until:{' '}
                {state.moviesCooldownUntil ? new Date(state.moviesCooldownUntil).toLocaleString() : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Series pending</div>
              <div className="mt-1 font-semibold">{state.seriesScanPending ? 'Yes' : 'No'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Last triggered:{' '}
                {state.seriesLastScanAt || state.lastSeriesScanTriggerAt
                  ? new Date(state.seriesLastScanAt || state.lastSeriesScanTriggerAt).toLocaleString()
                  : '—'}
              </div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Cooldown until:{' '}
                {state.seriesCooldownUntil ? new Date(state.seriesCooldownUntil).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">WatchFolder</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Cooldown Until</th>
              <th className="px-3 py-2">Error / Response</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((x) => (
              <tr key={x.id} className="border-t border-[var(--admin-border)]">
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.createdAt ? new Date(x.createdAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2">{x.type}</td>
                <td className="px-3 py-2 font-mono text-xs">{x.watchFolderId || '—'}</td>
                <td className="px-3 py-2">
                  <StatusPill status={x.status} />
                </td>
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                  {x.cooldownUntil ? new Date(x.cooldownUntil).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {x.error ? <div className="text-red-200">{x.error}</div> : null}
                  {x.result ? (
                    <div className="mt-1 text-[var(--admin-muted)]">
                      {(() => {
                        try {
                          const s = JSON.stringify(x.result);
                          return s.length > 160 ? `${s.slice(0, 160)}…` : s;
                        } catch {
                          return String(x.result);
                        }
                      })()}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!loading && logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                  No scan triggers yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
