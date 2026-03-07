'use client';

import { useEffect, useMemo, useState } from 'react';

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

function kpiLabel(value) {
  if (typeof value === 'string') return value;
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function dateLabel(ts) {
  const t = Number(ts || 0);
  if (!t) return 'Never';
  try {
    return new Date(t).toLocaleString();
  } catch {
    return 'Never';
  }
}

function deletedByExtSummary(value) {
  if (!value || typeof value !== 'object') return '';
  const entries = Object.entries(value)
    .map(([ext, count]) => [String(ext || 'unknown').toLowerCase(), Number(count || 0)])
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
  if (!entries.length) return '';
  return entries.map(([ext, count]) => `${ext}:${count}`).join(', ');
}

function summaryEntries(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .map(([name, count]) => [String(name || 'unknown'), Number(count || 0)])
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
}

function fileExtFromPath(value) {
  const name = String(value || '').trim();
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return 'unknown';
  return name.slice(idx + 1).toLowerCase();
}

function KpiCard({ label, value, hint = '', onClick = null, disabled = false }) {
  const clickable = typeof onClick === 'function';
  const content = (
    <>
      <div className="text-xs uppercase tracking-wide text-[var(--admin-muted)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{kpiLabel(value)}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{hint}</div> : null}
    </>
  );
  if (!clickable) {
    return <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-left transition hover:border-[--brand]/40 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      {content}
    </button>
  );
}

export default function AdminAutoDownloadLibraryInventoryPanel() {
  const CLEAN_SAMPLE_LIMIT = 20000;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cleanPreviewBusy, setCleanPreviewBusy] = useState(false);
  const [cleanRunBusy, setCleanRunBusy] = useState(false);
  const [cleanModalOpen, setCleanModalOpen] = useState(false);
  const [deleteDetailsOpen, setDeleteDetailsOpen] = useState(false);
  const [renameDetailsOpen, setRenameDetailsOpen] = useState(false);
  const [folderDetailsOpen, setFolderDetailsOpen] = useState(false);
  const [deleteFilterExt, setDeleteFilterExt] = useState('');
  const [deleteFilterReason, setDeleteFilterReason] = useState('');
  const [cleanPreview, setCleanPreview] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [q, setQ] = useState('');
  const [inventory, setInventory] = useState(null);

  const load = async (refresh = false) => {
    if (refresh) setBusy(true);
    else setLoading(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch(
        refresh ? '/api/admin/autodownload/library-inventory?refresh=1' : '/api/admin/autodownload/library-inventory',
        { cache: 'no-store' }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (!j?.ok && !j?.inventory)) throw new Error(j?.error || 'Failed to load inventory.');
      const inv = j?.inventory || null;
      setInventory(inv);
      if (refresh) {
        setOk(j?.ok ? 'Library inventory refreshed.' : `Refresh completed with warning: ${j?.error || 'unknown error'}`);
      }
      if (!j?.ok && j?.error) setErr(j.error);
    } catch (e) {
      setErr(e?.message || 'Failed to load inventory.');
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };

  const openCleanPreview = async () => {
    setCleanPreviewBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/library-inventory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clean_preview', sampleLimit: CLEAN_SAMPLE_LIMIT }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to scan Clean Library preview.');
      setCleanPreview(j);
      setDeleteDetailsOpen(false);
      setRenameDetailsOpen(false);
      setFolderDetailsOpen(false);
      setDeleteFilterExt('');
      setDeleteFilterReason('');
      setCleanModalOpen(true);
    } catch (e) {
      setErr(e?.message || 'Failed to scan Clean Library preview.');
    } finally {
      setCleanPreviewBusy(false);
    }
  };

  const runCleanLibrary = async () => {
    if (!cleanPreview) return;
    setCleanRunBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/library-inventory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clean_run', confirm: true, sampleLimit: CLEAN_SAMPLE_LIMIT }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Clean Library failed.');
      setCleanPreview(j);
      if (j?.inventory) setInventory(j.inventory);
      const affected = Number(j?.summary?.titlesAffected || 0) || 0;
      const filesDeleted = Number(j?.summary?.filesDeleted || 0) || 0;
      const filesChanged = (Number(j?.summary?.filesMoved || 0) || 0) + (Number(j?.summary?.filesRenamed || 0) || 0);
      setOk(
        `Clean Library completed. Affected titles: ${affected}. Changed files: ${filesChanged}. Deleted files: ${filesDeleted}.`
      );
      setDeleteDetailsOpen(false);
      setRenameDetailsOpen(false);
      setFolderDetailsOpen(false);
      setDeleteFilterExt('');
      setDeleteFilterReason('');
      setCleanModalOpen(false);
    } catch (e) {
      setErr(e?.message || 'Clean Library failed.');
    } finally {
      setCleanRunBusy(false);
    }
  };

  useEffect(() => {
    load(false);
  }, []);

  const stats = inventory?.stats || { movies: 0, series: 0, total: 0 };
  const folderCounts = inventory?.folderCounts || {};
  const countReports = inventory?.countReports || {};
  const movieCategoryCounts = Array.isArray(folderCounts?.moviesByCategory) ? folderCounts.moviesByCategory : [];
  const movieCategoryGenreCounts = Array.isArray(folderCounts?.moviesByCategoryGenre)
    ? folderCounts.moviesByCategoryGenre
    : [];
  const seriesGenreCounts = Array.isArray(folderCounts?.seriesByGenre) ? folderCounts.seriesByGenre : [];

  const filtered = useMemo(() => {
    const needle = String(q || '').trim().toLowerCase();
    const movies = Array.isArray(inventory?.movies) ? inventory.movies : [];
    const series = Array.isArray(inventory?.series) ? inventory.series : [];
    if (!needle) return { movies, series };
    const pick = (row) => {
      const hay = `${row?.title || ''} ${row?.year || ''} ${row?.category || ''} ${row?.genre || ''} ${row?.fileName || row?.folder || ''}`.toLowerCase();
      return hay.includes(needle);
    };
    return {
      movies: movies.filter(pick),
      series: series.filter(pick),
    };
  }, [inventory, q]);

  const cleanSummary = cleanPreview?.summary || {};
  const cleanFilesChanged = (Number(cleanSummary?.filesMoved || 0) || 0) + (Number(cleanSummary?.filesRenamed || 0) || 0);
  const cleanFilesDeleted = Number(cleanSummary?.filesDeleted || 0) || 0;
  const cleanFoldersChanged = Number(cleanSummary?.foldersRenamed || 0) || 0;
  const cleanFoldersCreated = Number(cleanSummary?.foldersCreated || 0) || 0;
  const cleanFoldersDeleted = Number(cleanSummary?.foldersDeleted || 0) || 0;
  const cleanAffectedTitles = Number(cleanSummary?.titlesAffected || 0) || 0;
  const cleanWarnings = Number(cleanSummary?.warnings || 0) || 0;
  const cleanDeletedByExt = deletedByExtSummary(cleanSummary?.deletedByExtension);
  const cleanDeleteByExtension = useMemo(() => summaryEntries(cleanSummary?.deletedByExtension), [cleanSummary?.deletedByExtension]);
  const cleanDeleteByReason = useMemo(() => summaryEntries(cleanSummary?.deletedByReason), [cleanSummary?.deletedByReason]);
  const cleanDeleteRows = useMemo(() => {
    const rows = Array.isArray(cleanPreview?.samples?.deletes) ? cleanPreview.samples.deletes : [];
    return rows
      .filter((row) => String(row?.kind || 'file').toLowerCase() !== 'folder')
      .map((row, index) => {
        const path = String(row?.path || '').trim();
        const reasonRaw = String(row?.reason || 'deleted').trim();
        return {
          id: `${path}-${index}`,
          path,
          reason: reasonRaw || 'deleted',
          reasonKey: reasonRaw.toLowerCase() || 'deleted',
          ext: fileExtFromPath(path),
        };
      });
  }, [cleanPreview?.samples?.deletes]);
  const cleanRenameFolderRows = useMemo(() => {
    const rows = Array.isArray(cleanPreview?.samples?.changes) ? cleanPreview.samples.changes : [];
    return rows
      .filter((row) => {
        const action = String(row?.action || '').toLowerCase();
        return action === 'movie_folder' || action === 'series_folder' || action === 'folder_rename';
      })
      .map((row, index) => {
        const from = String(row?.from || '').trim();
        const to = String(row?.to || '').trim();
        const action = String(row?.action || '').trim().toLowerCase();
        return {
          id: `${from}-${to}-${index}`,
          from,
          to,
          action,
        };
      });
  }, [cleanPreview?.samples?.changes]);
  const cleanDeleteFolderRows = useMemo(() => {
    const rows = Array.isArray(cleanPreview?.samples?.deletes) ? cleanPreview.samples.deletes : [];
    return rows
      .filter((row) => String(row?.kind || '').toLowerCase() === 'folder')
      .map((row, index) => {
        const path = String(row?.path || '').trim();
        const reasonRaw = String(row?.reason || 'deleted').trim();
        return {
          id: `${path}-${index}`,
          path,
          reason: reasonRaw || 'deleted',
          reasonKey: reasonRaw.toLowerCase() || 'deleted',
        };
      });
  }, [cleanPreview?.samples?.deletes]);
  const cleanFolderDeleteByReason = useMemo(() => {
    const tally = {};
    for (const row of cleanDeleteFolderRows) {
      const key = String(row?.reasonKey || 'deleted').trim().toLowerCase() || 'deleted';
      tally[key] = Number(tally[key] || 0) + 1;
    }
    return summaryEntries(tally);
  }, [cleanDeleteFolderRows]);
  const cleanDeleteRowsFiltered = useMemo(() => {
    return cleanDeleteRows.filter((row) => {
      if (deleteFilterExt && String(row?.ext || '').toLowerCase() !== deleteFilterExt) return false;
      if (deleteFilterReason && String(row?.reasonKey || '').toLowerCase() !== deleteFilterReason) return false;
      return true;
    });
  }, [cleanDeleteRows, deleteFilterExt, deleteFilterReason]);
  const cleanDeleteListTruncated = cleanFilesDeleted > cleanDeleteRows.length;
  const cleanFolderRenameListTruncated = cleanFoldersChanged > cleanRenameFolderRows.length;
  const cleanFolderDeleteListTruncated = cleanFoldersDeleted > cleanDeleteFolderRows.length;
  const cleanHasWork =
    cleanAffectedTitles > 0 || cleanFilesDeleted > 0 || cleanFilesChanged > 0 || cleanFoldersCreated > 0 || cleanFoldersDeleted > 0;

  return (
    <div className="relative rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Library Inventory</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Snapshot of all final Movies and Series on NAS for duplicate checks and readiness verification.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCleanPreview}
            disabled={loading || busy || cleanPreviewBusy || cleanRunBusy}
            className="admin-btn-tertiary rounded-lg px-3 py-2 text-sm disabled:opacity-60"
          >
            {cleanPreviewBusy ? 'Scanning clean…' : 'Clean Library'}
          </button>
          <button
            type="button"
            onClick={() => load(false)}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || busy}
            className="admin-btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-60"
          >
            {busy ? 'Scanning…' : 'Refresh Scan'}
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

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Titles" value={stats.total} hint="Movies + Series" />
        <KpiCard label="Movies" value={stats.movies} hint="Final library folders" />
        <KpiCard label="Series" value={stats.series} hint="Final series folders" />
        <KpiCard label="Last Sync" value={dateLabel(inventory?.updatedAt)} />
      </div>

      <div className="mt-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, year, category, genre…"
          className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <section className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Movie Category Counts</div>
          <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-auto">
            {movieCategoryCounts.length ? (
              movieCategoryCounts.map((row) => (
                <span
                  key={`movie-category-count-${row?.category}`}
                  className="inline-flex items-center rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs"
                >
                  {row?.category || 'Uncategorized'} ({Number(row?.count || 0).toLocaleString()})
                </span>
              ))
            ) : (
              <span className="text-xs text-[var(--admin-muted)]">No movie categories scanned yet.</span>
            )}
          </div>
        </section>
        <section className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Movie Genre Counts</div>
          <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-auto">
            {movieCategoryGenreCounts.length ? (
              movieCategoryGenreCounts.map((row) => (
                <span
                  key={`movie-genre-count-${row?.category}-${row?.genre}`}
                  className="inline-flex items-center rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs"
                >
                  {(row?.category || 'Uncategorized') + ' / ' + (row?.genre || 'Uncategorized')} (
                  {Number(row?.count || 0).toLocaleString()})
                </span>
              ))
            ) : (
              <span className="text-xs text-[var(--admin-muted)]">No movie genres scanned yet.</span>
            )}
          </div>
        </section>
        <section className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Series Genre Counts</div>
          <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-auto">
            {seriesGenreCounts.length ? (
              seriesGenreCounts.map((row) => (
                <span
                  key={`series-genre-count-${row?.genre}`}
                  className="inline-flex items-center rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs"
                >
                  {row?.genre || 'Uncategorized'} ({Number(row?.count || 0).toLocaleString()})
                </span>
              ))
            ) : (
              <span className="text-xs text-[var(--admin-muted)]">No series genres scanned yet.</span>
            )}
          </div>
        </section>
      </div>
      <div className="mt-2 text-xs text-[var(--admin-muted)]">
        NAS count report files:{' '}
        <code>{countReports?.moviesPath || '/Movies/_folder_counts.txt'}</code> and{' '}
        <code>{countReports?.seriesPath || '/Series/_folder_counts.txt'}</code>
        {countReports?.updatedAt ? ` · Last written: ${dateLabel(countReports.updatedAt)}` : ''}
      </div>
      {countReports?.ok === false && countReports?.error ? (
        <div className="mt-2 rounded-lg border px-3 py-2 text-xs" style={toneVars('warning')}>
          Unable to update NAS count report file: {countReports.error}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-[var(--admin-border)]">
          <div className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm font-semibold">
            Movies ({filtered.movies.length})
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Year</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Genre</th>
                </tr>
              </thead>
              <tbody>
                {filtered.movies.map((row) => (
                  <tr key={row.path || row.key} className="border-t border-[var(--admin-border)]">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.title || 'Untitled'}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-[var(--admin-muted)]">{row.fileName || row.path}</div>
                    </td>
                    <td className="px-3 py-2">{row.year || '—'}</td>
                    <td className="px-3 py-2">{row.category || '—'}</td>
                    <td className="px-3 py-2">{row.genre || '—'}</td>
                  </tr>
                ))}
                {!loading && filtered.movies.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                      No movies found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[var(--admin-border)]">
          <div className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm font-semibold">
            Series ({filtered.series.length})
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Year</th>
                  <th className="px-3 py-2">Genre</th>
                  <th className="px-3 py-2">Folder</th>
                </tr>
              </thead>
              <tbody>
                {filtered.series.map((row) => (
                  <tr key={row.path || row.key} className="border-t border-[var(--admin-border)]">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.title || 'Untitled'}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-[var(--admin-muted)]">{row.path}</div>
                    </td>
                    <td className="px-3 py-2">{row.year || '—'}</td>
                    <td className="px-3 py-2">{row.genre || '—'}</td>
                    <td className={cx('px-3 py-2 text-xs', 'text-[var(--admin-muted)]')}>{row.folder || '—'}</td>
                  </tr>
                ))}
                {!loading && filtered.series.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                      No series found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {cleanModalOpen && cleanPreview ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Clean Library Preview</div>
                <div className="mt-1 text-sm text-[var(--admin-muted)]">
                  Final library only: <code>/Movies</code> and <code>/Series</code>. qBittorrent staging folders are excluded.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteDetailsOpen(false);
                  setRenameDetailsOpen(false);
                  setFolderDetailsOpen(false);
                  setDeleteFilterExt('');
                  setDeleteFilterReason('');
                  setCleanModalOpen(false);
                }}
                disabled={cleanRunBusy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm hover:bg-black/10 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="mt-3 rounded-lg border px-3 py-2" style={toneVars('warning')}>
              <div className="text-sm font-medium">
                Preview only: no files are changed until you click <strong>Confirm Clean Library</strong>.
              </div>
              <div className="mt-1 text-xs">
                Deleted file formats: <code>{cleanDeletedByExt || 'none'}</code>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Affected Titles" value={cleanAffectedTitles} />
              <KpiCard label="Files Changed" value={cleanFilesChanged} hint="Moved + renamed" />
              <KpiCard
                label="Files Deleted"
                value={cleanFilesDeleted}
                hint={cleanFilesDeleted > 0 ? 'Click to review files' : 'No files to delete'}
                onClick={() => setDeleteDetailsOpen(true)}
                disabled={cleanFilesDeleted <= 0}
              />
              <KpiCard label="Warnings" value={cleanWarnings} />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                label="Folders Renamed"
                value={cleanFoldersChanged}
                hint={cleanFoldersChanged > 0 ? 'Click to review renames' : 'No renamed folders'}
                onClick={() => setRenameDetailsOpen(true)}
                disabled={cleanFoldersChanged <= 0}
              />
              <KpiCard label="Folders Created" value={cleanFoldersCreated} />
              <KpiCard
                label="Folders Deleted"
                value={cleanFoldersDeleted}
                hint={cleanFoldersDeleted > 0 ? 'Click to review folders' : 'No folders to delete'}
                onClick={() => setFolderDetailsOpen(true)}
                disabled={cleanFoldersDeleted <= 0}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {!cleanHasWork ? (
                <div className="mr-auto text-sm text-[var(--admin-muted)]">Nothing to clean based on current preview.</div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setDeleteDetailsOpen(false);
                  setRenameDetailsOpen(false);
                  setFolderDetailsOpen(false);
                  setDeleteFilterExt('');
                  setDeleteFilterReason('');
                  setCleanModalOpen(false);
                }}
                disabled={cleanRunBusy}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runCleanLibrary}
                disabled={cleanRunBusy || !cleanHasWork}
                className="admin-btn-tertiary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                {cleanRunBusy ? 'Cleaning…' : 'Confirm Clean Library'}
              </button>
            </div>
          </div>

          {deleteDetailsOpen ? (
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4">
              <div className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">Files To Be Deleted</div>
                    <div className="mt-1 text-sm text-[var(--admin-muted)]">
                      Review file list and grouped summaries before confirming clean.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteDetailsOpen(false)}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm hover:bg-black/10"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <KpiCard label="Files To Delete" value={cleanFilesDeleted} />
                  <KpiCard label="Matching Rows" value={cleanDeleteRowsFiltered.length} hint={`of ${cleanDeleteRows.length.toLocaleString()}`} />
                  <KpiCard label="Category Groups" value={cleanDeleteByReason.length + cleanDeleteByExtension.length} />
                </div>

                {cleanDeleteListTruncated ? (
                  <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={toneVars('warning')}>
                    Showing {cleanDeleteRows.length.toLocaleString()} entries from preview data, but total files to delete is{' '}
                    {cleanFilesDeleted.toLocaleString()}.
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">By File Format</div>
                      {deleteFilterExt || deleteFilterReason ? (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteFilterExt('');
                            setDeleteFilterReason('');
                          }}
                          className="rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs hover:bg-black/10"
                        >
                          Clear filters
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {cleanDeleteByExtension.length ? (
                        cleanDeleteByExtension.map(([name, count]) => (
                          <button
                            type="button"
                            key={`ext-${name}`}
                            onClick={() => setDeleteFilterExt((prev) => (prev === String(name).toLowerCase() ? '' : String(name).toLowerCase()))}
                            className={cx(
                              'inline-flex items-center rounded-md border px-2 py-1 text-xs',
                              deleteFilterExt === String(name).toLowerCase()
                                ? 'border-[--brand]/50 bg-[--brand]/10 text-[var(--admin-text)]'
                                : 'border-[var(--admin-border)] bg-[var(--admin-surface)] hover:bg-black/10'
                            )}
                          >
                            {String(name).toLowerCase()}: {Number(count).toLocaleString()}
                          </button>
                        ))
                      ) : (
                        <span className="text-xs text-[var(--admin-muted)]">No file-format deletions detected.</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                    <div className="text-sm font-semibold">By Delete Category</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {cleanDeleteByReason.length ? (
                        cleanDeleteByReason.map(([name, count]) => (
                          <button
                            type="button"
                            key={`reason-${name}`}
                            onClick={() => setDeleteFilterReason((prev) => (prev === String(name).toLowerCase() ? '' : String(name).toLowerCase()))}
                            className={cx(
                              'inline-flex items-center rounded-md border px-2 py-1 text-xs',
                              deleteFilterReason === String(name).toLowerCase()
                                ? 'border-[--brand]/50 bg-[--brand]/10 text-[var(--admin-text)]'
                                : 'border-[var(--admin-border)] bg-[var(--admin-surface)] hover:bg-black/10'
                            )}
                          >
                            {name}: {Number(count).toLocaleString()}
                          </button>
                        ))
                      ) : (
                        <span className="text-xs text-[var(--admin-muted)]">No category data available.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
                  <div className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm font-semibold">
                    Files ({cleanDeleteRowsFiltered.length.toLocaleString()})
                  </div>
                  <div className="max-h-[45vh] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                        <tr>
                          <th className="px-3 py-2">File</th>
                          <th className="px-3 py-2">Format</th>
                          <th className="px-3 py-2">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cleanDeleteRowsFiltered.map((row) => (
                          <tr key={row.id} className="border-t border-[var(--admin-border)]">
                            <td className="px-3 py-2 text-xs">{row.path || '—'}</td>
                            <td className="px-3 py-2 text-xs">{row.ext || 'unknown'}</td>
                            <td className="px-3 py-2 text-xs">{row.reason || 'deleted'}</td>
                          </tr>
                        ))}
                        {!cleanDeleteRowsFiltered.length ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                              No files match the selected filters.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {renameDetailsOpen ? (
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4">
              <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">Folders To Be Renamed</div>
                    <div className="mt-1 text-sm text-[var(--admin-muted)]">
                      Review folder name/path updates before confirming clean.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRenameDetailsOpen(false)}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm hover:bg-black/10"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={toneVars('warning')}>
                  <div className="font-medium">Guide</div>
                  <div className="mt-1 text-xs">
                    Folder renames are generated from your cleaning templates (for movie/series folder naming consistency).
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <KpiCard label="Folders Renamed" value={cleanFoldersChanged} />
                  <KpiCard label="Matching Rows" value={cleanRenameFolderRows.length} />
                  <KpiCard
                    label="Actions"
                    value={new Set(cleanRenameFolderRows.map((row) => row.action || 'folder_rename')).size}
                  />
                </div>

                {cleanFolderRenameListTruncated ? (
                  <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={toneVars('warning')}>
                    Showing {cleanRenameFolderRows.length.toLocaleString()} entries from preview data, but total folders renamed is{' '}
                    {cleanFoldersChanged.toLocaleString()}.
                  </div>
                ) : null}

                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
                  <div className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm font-semibold">
                    Renamed Folders ({cleanRenameFolderRows.length.toLocaleString()})
                  </div>
                  <div className="max-h-[45vh] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                        <tr>
                          <th className="px-3 py-2">From</th>
                          <th className="px-3 py-2">To</th>
                          <th className="px-3 py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cleanRenameFolderRows.map((row) => (
                          <tr key={row.id} className="border-t border-[var(--admin-border)]">
                            <td className="px-3 py-2 text-xs">{row.from || '—'}</td>
                            <td className="px-3 py-2 text-xs">{row.to || '—'}</td>
                            <td className="px-3 py-2 text-xs">{row.action || 'folder_rename'}</td>
                          </tr>
                        ))}
                        {!cleanRenameFolderRows.length ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                              No folder rename rows were captured in this preview.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {folderDetailsOpen ? (
            <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4">
              <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">Folders To Be Deleted</div>
                    <div className="mt-1 text-sm text-[var(--admin-muted)]">
                      These folders are deleted only when they are empty after cleanup, so leftovers do not stay in the library.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFolderDetailsOpen(false)}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-1.5 text-sm hover:bg-black/10"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={toneVars('warning')}>
                  <div className="font-medium">Guide</div>
                  <div className="mt-1 text-xs">
                    Folder deletion reasons show why each folder is being removed. Most rows are <code>empty folder</code> after files were moved/renamed.
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <KpiCard label="Folders To Delete" value={cleanFoldersDeleted} />
                  <KpiCard label="Matching Rows" value={cleanDeleteFolderRows.length} />
                  <KpiCard label="Reason Groups" value={cleanFolderDeleteByReason.length} />
                </div>

                {cleanFolderDeleteListTruncated ? (
                  <div className="mt-3 rounded-lg border px-3 py-2 text-sm" style={toneVars('warning')}>
                    Showing {cleanDeleteFolderRows.length.toLocaleString()} entries from preview data, but total folders to delete is{' '}
                    {cleanFoldersDeleted.toLocaleString()}.
                  </div>
                ) : null}

                <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                  <div className="text-sm font-semibold">By Delete Category</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {cleanFolderDeleteByReason.length ? (
                      cleanFolderDeleteByReason.map(([name, count]) => (
                        <span
                          key={`folder-reason-${name}`}
                          className="inline-flex items-center rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs"
                        >
                          {name}: {Number(count).toLocaleString()}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-[var(--admin-muted)]">No category data available.</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--admin-border)]">
                  <div className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm font-semibold">
                    Folders ({cleanDeleteFolderRows.length.toLocaleString()})
                  </div>
                  <div className="max-h-[45vh] overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[var(--admin-surface-2)] text-xs text-[var(--admin-muted)]">
                        <tr>
                          <th className="px-3 py-2">Folder</th>
                          <th className="px-3 py-2">Delete Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cleanDeleteFolderRows.map((row) => (
                          <tr key={row.id} className="border-t border-[var(--admin-border)]">
                            <td className="px-3 py-2 text-xs">{row.path || '—'}</td>
                            <td className="px-3 py-2 text-xs">{row.reason || 'deleted'}</td>
                          </tr>
                        ))}
                        {!cleanDeleteFolderRows.length ? (
                          <tr>
                            <td colSpan={2} className="px-3 py-6 text-center text-sm text-[var(--admin-muted)]">
                              No folders are queued for deletion in this preview.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
