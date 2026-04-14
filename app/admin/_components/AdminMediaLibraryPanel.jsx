'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, FilterX, Loader2, Plus, RefreshCw, Search, Settings, Trash2, UploadCloud } from 'lucide-react';

import { readJsonSafe } from '../../../lib/readJsonSafe';

const VIDEO_EXTS = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm']);

function fmtDate(value) {
  const ts = Number(value || 0);
  if (!(ts > 0)) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

function fmtAge(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value < 0) return 'Unknown';
  if (value < 60 * 1000) return 'Just now';
  const minutes = Math.floor(value / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function kpiLabel(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : '0';
}

function toneStyle(tone = 'neutral') {
  const normalized = String(tone || 'neutral').trim().toLowerCase();
  return {
    borderColor: `var(--admin-pill-${normalized}-border)`,
    backgroundColor: `var(--admin-pill-${normalized}-bg)`,
    color: `var(--admin-pill-${normalized}-text)`,
  };
}

function StatusPill({ tone = 'neutral', children }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium" style={toneStyle(tone)}>
      {children}
    </span>
  );
}

function presenceTone(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'both') return 'success';
  if (normalized === 'xui_only') return 'warning';
  if (normalized === 'nas_only') return 'info';
  return 'neutral';
}

function presenceLabel(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'both') return 'XUI + NAS';
  if (normalized === 'xui_only') return 'XUI only';
  if (normalized === 'nas_only') return 'NAS only';
  return 'Unknown';
}

function KpiCard({ label, value, hint = '', actionHint = '', href = '' }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-[var(--admin-muted)]">{label}</div>
        {href ? <ExternalLink size={14} className="mt-0.5 text-[var(--admin-muted)]" /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold">{kpiLabel(value)}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{hint}</div> : null}
      {actionHint ? <div className="mt-1 text-[11px] font-medium text-[var(--admin-text)]">{actionHint}</div> : null}
    </>
  );

  if (!href) {
    return <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">{content}</div>;
  }

  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      prefetch={false}
      title="Open recent deletion logs in a new tab"
      className="block rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 transition hover:bg-black/10"
    >
      {content}
    </Link>
  );
}

function manualStatusTone(status = '', releaseState = '') {
  const st = String(status || '').trim().toLowerCase();
  const rs = String(releaseState || '').trim().toLowerCase();
  if (rs === 'released') return 'accent';
  if (st === 'cleaned') return 'success';
  if (st === 'processing') return 'processing';
  if (st === 'completed') return 'warning';
  if (st === 'failed') return 'danger';
  if (st === 'deleted') return 'neutral';
  return 'neutral';
}

function ManualStatus({ item }) {
  const st = String(item?.status || '').trim();
  const rs = String(item?.releaseState || '').trim();
  const label = rs && rs.toLowerCase() === 'released' ? 'Released' : st || 'Queued';
  return <StatusPill tone={manualStatusTone(st, rs)}>{label}</StatusPill>;
}

function ModalShell({ title, children, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--admin-border)] px-5 py-4">
          <div className="text-base font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs hover:bg-black/10"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function FolderSettingsModal({ open, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rootName, setRootName] = useState('Manual Upload');
  const [moviesProcessing, setMoviesProcessing] = useState('Processing');
  const [seriesProcessing, setSeriesProcessing] = useState('Processing');
  const [moviePreview, setMoviePreview] = useState(null);
  const [seriesPreview, setSeriesPreview] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    Promise.all([
      fetch('/api/admin/media-library?view=preflight&type=movie', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))),
      fetch('/api/admin/media-library?view=preflight&type=series', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))),
    ])
      .then(([m, s]) => {
        if (cancelled) return;
        if (m?.ok) setMoviePreview(m);
        if (s?.ok) setSeriesPreview(s);
        const root = String(m?.manualUploadFolders?.rootName || s?.manualUploadFolders?.rootName || 'Manual Upload').trim() || 'Manual Upload';
        setRootName(root);
        setMoviesProcessing(String(m?.manualUploadFolders?.movies?.processing || 'Processing'));
        setSeriesProcessing(String(s?.manualUploadFolders?.series?.processing || 'Processing'));
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e?.message || 'Failed to load folder settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;
  return (
    <ModalShell
      title="Library Folder Structure (Manual Upload)"
      onClose={() => {
        if (saving) return;
        onClose();
      }}
    >
      {err ? <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</div> : null}
      <div className="text-xs text-[var(--admin-muted)]">
        Manual uploads are stored under <span className="font-mono">{rootName}</span>. The Processing folder name controls where raw uploads land. Cleaned output always goes to{' '}
        <span className="font-mono">Cleaned and Ready/&lt;release_date&gt;/…</span>.
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Movies</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Processing path: <span className="font-mono">{String(moviePreview?.stage?.incomingShare || moviePreview?.stage?.incomingDir || '—')}</span>
          </div>
          <label className="mt-4 block">
            <div className="text-xs font-medium text-[var(--admin-muted)]">Processing folder name</div>
            <input
              value={moviesProcessing}
              onChange={(e) => setMoviesProcessing(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-sm outline-none"
              placeholder="Processing"
              disabled={loading || saving}
            />
          </label>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Series</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Processing path: <span className="font-mono">{String(seriesPreview?.stage?.incomingShare || seriesPreview?.stage?.incomingDir || '—')}</span>
          </div>
          <label className="mt-4 block">
            <div className="text-xs font-medium text-[var(--admin-muted)]">Processing folder name</div>
            <input
              value={seriesProcessing}
              onChange={(e) => setSeriesProcessing(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-sm outline-none"
              placeholder="Processing"
              disabled={loading || saving}
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
        >
          Close
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setErr('');
            try {
              const response = await fetch('/api/admin/media-library', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  action: 'manual_upload_folders_save',
                  rootName,
                  moviesProcessing,
                  seriesProcessing,
                }),
              });
              const json = await readJsonSafe(response);
              if (!response.ok || !json?.ok) throw new Error(json?.error || `Save failed (${response.status})`);
              onSaved?.(json);
              onClose();
            } catch (e) {
              setErr(e?.message || 'Failed to save folder settings.');
            } finally {
              setSaving(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : null}
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function buildDeleteSummary(summary = {}) {
  const requested = Number(summary?.requested || 0) || 0;
  const completed = Number(summary?.completed || 0) || 0;
  const partial = Number(summary?.partial || 0) || 0;
  const failed = Number(summary?.failed || 0) || 0;
  const notFound = Number(summary?.notFound || 0) || 0;
  return `Processed ${requested} title(s) — completed: ${completed}, partial: ${partial}, failed: ${failed}, not found: ${notFound}.`;
}

function fileExt(name = '') {
  const s = String(name || '').trim();
  const idx = s.lastIndexOf('.');
  if (idx < 0) return '';
  return s.slice(idx + 1).toLowerCase();
}

function normalizeForTitle(raw = '') {
  let s = String(raw || '').trim();
  s = s.replace(/\.[a-z0-9]{2,4}$/i, '');
  s = s.replace(/[._]/g, ' ');
  s = s.replace(/\[[^\]]+\]/g, ' ');
  s = s.replace(/\b(2160p|1080p|720p|480p|4k|hdr|hevc|x265|x264|h265|h264|bluray|web[- ]?dl|webrip|dvdrip|brrip|proper|repack)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function detectYear(text = '') {
  const m = String(text || '').match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : '';
}

function parseMovieFromName(name = '') {
  const normalized = normalizeForTitle(name);
  const year = detectYear(normalized);
  let title = normalized;
  if (year) {
    const idx = normalized.indexOf(year);
    title = idx > 0 ? normalized.slice(0, idx).trim() : normalized;
  }
  title = title.replace(/[-–—]+$/g, '').trim();
  return { title, year };
}

function parseEpisodeFromName(name = '') {
  const s = String(name || '');
  const m1 = s.match(/\bS(\d{1,2})\s*E(\d{1,2})\b/i);
  if (m1) return { season: Number(m1[1]), episode: Number(m1[2]) };
  const m2 = s.match(/\b(\d{1,2})x(\d{1,2})\b/i);
  if (m2) return { season: Number(m2[1]), episode: Number(m2[2]) };
  return { season: null, episode: null };
}

function inferSeriesTitleFromName(name = '') {
  let s = normalizeForTitle(name);
  s = s.replace(/\bS\d{1,2}\s*E\d{1,2}\b/gi, ' ');
  s = s.replace(/\b\d{1,2}x\d{1,2}\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  const year = detectYear(s);
  let title = s;
  if (year) {
    const idx = s.indexOf(year);
    title = idx > 0 ? s.slice(0, idx).trim() : s;
  }
  return { title, year };
}

function splitTopFolder(relPath = '') {
  const s = String(relPath || '').replace(/\\/g, '/').trim();
  const parts = s.split('/').filter(Boolean);
  if (parts.length >= 2) return { top: parts[0], rest: parts.slice(1).join('/') };
  return { top: '', rest: s };
}

function buildSelectedFileRows(fileList) {
  const rows = [];
  const files = fileList ? Array.from(fileList) : [];
  for (const f of files) {
    const relPath = String(f?.webkitRelativePath || f?.name || '').trim();
    if (!relPath) continue;
    rows.push({ file: f, relPath, name: String(f?.name || '').trim(), ext: fileExt(f?.name || ''), size: Number(f?.size || 0) || 0 });
  }
  return rows;
}

function groupMovieUploads(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const top = splitTopFolder(row.relPath).top;
    const parsed = parseMovieFromName(top || row.name);
    const title = String(parsed.title || '').trim() || 'Untitled';
    const year = String(parsed.year || '').trim();
    const key = `${title.toLowerCase()}|${year}`;
    if (!groups.has(key)) groups.set(key, { key, title, year, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function groupSeriesCandidates(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const { top } = splitTopFolder(row.relPath);
    const guess = inferSeriesTitleFromName(top || row.name);
    const title = String(guess.title || '').trim() || 'Untitled';
    const year = String(guess.year || '').trim();
    const key = `${title.toLowerCase()}|${year}`; // year is optional
    if (!groups.has(key)) groups.set(key, { key, title, year, rows: [], seasons: new Set(), episodes: new Set() });
    const g = groups.get(key);
    g.rows.push(row);
    if (VIDEO_EXTS.has(row.ext)) {
      const ep = parseEpisodeFromName(row.name);
      if (Number.isFinite(ep.season) && ep.season !== null) g.seasons.add(ep.season);
      if (Number.isFinite(ep.episode) && ep.episode !== null && Number.isFinite(ep.season) && ep.season !== null) g.episodes.add(`${ep.season}:${ep.episode}`);
    }
  }
  const out = [...groups.values()].map((g) => ({
    key: g.key,
    title: g.title,
    year: g.year,
    rows: g.rows,
    seasons: g.seasons.size,
    episodes: g.episodes.size,
  }));
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

function normKey(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function yearFromTmdbResult(row = {}) {
  const d = String(row?.first_air_date || row?.release_date || '').trim();
  const m = d.match(/^(\d{4})-/);
  return m ? m[1] : '';
}

function titleFromTmdbResult(row = {}) {
  return String(row?.name || row?.title || '').trim();
}

export default function AdminMediaLibraryPanel({ type = 'movie' }) {
  const resolvedType = String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const isSeries = resolvedType === 'series';
  const itemLabel = isSeries ? 'series' : 'movie';
  const pageTitle = isSeries ? 'Series List' : 'Movie List';
  const logsHref = isSeries ? '/admin/media-library/series/logs' : '/admin/media-library/movies/logs';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [data, setData] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [presence, setPresence] = useState('all');
  const [category, setCategory] = useState('');
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState('title_asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showFolderSettings, setShowFolderSettings] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualItems, setManualItems] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualErr, setManualErr] = useState('');
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({
    title: '',
    year: '',
    releaseDate: '',
    tmdbId: '',
    tmdbMediaType: '',
    files: null,
    processNow: true,
    releaseNow: false,
  });
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualSubmitErr, setManualSubmitErr] = useState('');
  const [manualReleaseEdits, setManualReleaseEdits] = useState({});
  const [manualSelectedRows, setManualSelectedRows] = useState([]);
  const [manualSeriesPick, setManualSeriesPick] = useState('');
  const [manualResults, setManualResults] = useState([]);
  const [manualMovieEdits, setManualMovieEdits] = useState({});
  const [manualUploadProgress, setManualUploadProgress] = useState(0);
  const [manualUploadStatus, setManualUploadStatus] = useState('');
  const [manualTmdbResults, setManualTmdbResults] = useState([]);
  const [manualTmdbLoading, setManualTmdbLoading] = useState(false);

  useEffect(() => {
    if (!showManualModal) return;
    // reset derived state whenever modal opens
    setManualSelectedRows([]);
    setManualSeriesPick('');
    setManualResults([]);
    setManualMovieEdits({});
    setManualTmdbResults([]);
    setManualTmdbLoading(false);
    setManualUploadProgress(0);
    setManualUploadStatus('');
    setManualSubmitErr('');
    setManualForm({
      title: '',
      year: '',
      releaseDate: '',
      tmdbId: '',
      tmdbMediaType: '',
      files: null,
      processNow: true,
      releaseNow: false,
    });
  }, [showManualModal]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(String(queryInput || '').trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    setPage(1);
  }, [presence, category, genre, sort, pageSize, resolvedType]);

  const loadManual = useCallback(async () => {
    setManualLoading(true);
    setManualErr('');
    try {
      const qs = new URLSearchParams();
      qs.set('view', 'manual');
      qs.set('type', resolvedType);
      qs.set('limit', '50');
      const response = await fetch(`/api/admin/media-library?${qs.toString()}`, { cache: 'no-store' });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load manual uploads.');
      setManualItems(Array.isArray(json?.items) ? json.items : []);
    } catch (error) {
      setManualErr(error?.message || 'Failed to load manual uploads.');
      setManualItems([]);
    } finally {
      setManualLoading(false);
    }
  }, [resolvedType]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams();
      qs.set('type', resolvedType);
      qs.set('q', query);
      qs.set('presence', presence);
      if (!isSeries && category) qs.set('category', category);
      if (genre) qs.set('genre', genre);
      qs.set('sort', sort);
      qs.set('page', String(page));
      qs.set('pageSize', String(pageSize));
      if (refresh) qs.set('refresh', '1');

      const response = await fetch(`/api/admin/media-library?${qs.toString()}`, { cache: 'no-store' });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || `Failed to load ${itemLabel} library.`);
      setData(json);
    } catch (error) {
      setErr(error?.message || `Failed to load ${itemLabel} library.`);
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [resolvedType, query, presence, isSeries, category, genre, sort, page, pageSize, itemLabel]);

  useEffect(() => {
    load({ refresh: false });
  }, [load]);

  useEffect(() => {
    loadManual();
  }, [loadManual]);

  useEffect(() => {
    setSelectedIds([]);
  }, [data?.items]);

  useEffect(() => {
    const categories = Array.isArray(data?.filters?.categories) ? data.filters.categories : [];
    if (category && !categories.includes(category)) setCategory('');
  }, [data?.filters?.categories, category]);

  useEffect(() => {
    const genres = Array.isArray(data?.filters?.genres) ? data.filters.genres : [];
    if (genre && !genres.includes(genre)) setGenre('');
  }, [data?.filters?.genres, genre]);

  const visibleIds = useMemo(() => (Array.isArray(data?.items) ? data.items.map((row) => String(row?.id || '')).filter(Boolean) : []), [data?.items]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const anyFilters = Boolean(query || presence !== 'all' || category || genre || sort !== 'title_asc');
  const working = refreshing || deleting;

  const toggleSelectOne = (id) => {
    const resolvedId = String(id || '').trim();
    if (!resolvedId) return;
    setSelectedIds((current) => (current.includes(resolvedId) ? current.filter((value) => value !== resolvedId) : [...current, resolvedId]));
  };

  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((value) => !visibleIds.includes(value));
      return [...new Set([...current, ...visibleIds])];
    });
  };

  const runDelete = async (ids) => {
    const targetIds = (Array.isArray(ids) ? ids : []).map((value) => String(value || '').trim()).filter(Boolean);
    if (!targetIds.length) return;

    const label = targetIds.length === 1 ? `Delete this ${itemLabel}?` : `Delete ${targetIds.length} ${isSeries ? 'series' : 'movies'}?`;
    const confirmText = `${label}\n\nThis removes matching entries from XUI and the NAS snapshot/path when available. Missing targets are reported as not existing.`;
    if (typeof window !== 'undefined' && !window.confirm(confirmText)) return;

    setDeleting(true);
    setErr('');
    setOk('');
    try {
      const response = await fetch('/api/admin/media-library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          type: resolvedType,
          ids: targetIds,
        }),
      });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || `Failed to delete ${itemLabel}.`);
      setOk(buildDeleteSummary(json?.summary));
      setSelectedIds([]);
      await load({ refresh: false });
    } catch (error) {
      setErr(error?.message || `Failed to delete ${itemLabel}.`);
    } finally {
      setDeleting(false);
    }
  };

  const clearFilters = () => {
    setQueryInput('');
    setQuery('');
    setPresence('all');
    setCategory('');
    setGenre('');
    setSort('title_asc');
    setPage(1);
    setPageSize(25);
  };

  const manualCandidates = useMemo(() => {
    if (!manualSelectedRows.length) return [];
    return isSeries ? groupSeriesCandidates(manualSelectedRows) : groupMovieUploads(manualSelectedRows);
  }, [isSeries, manualSelectedRows]);

  const selectedSeriesCandidate = useMemo(() => {
    if (!isSeries) return null;
    if (!manualCandidates.length) return null;
    const key = manualSeriesPick || manualCandidates[0]?.key || '';
    return manualCandidates.find((c) => c.key === key) || manualCandidates[0] || null;
  }, [isSeries, manualCandidates, manualSeriesPick]);

  useEffect(() => {
    if (!showManualModal || !isSeries) return;
    if (!selectedSeriesCandidate) return;
    setManualSeriesPick(selectedSeriesCandidate.key);
    setManualForm((prev) => ({
      ...prev,
      title: prev.title ? prev.title : selectedSeriesCandidate.title,
      year: prev.year ? prev.year : selectedSeriesCandidate.year,
      tmdbId: prev.tmdbId || '',
      tmdbMediaType: prev.tmdbMediaType || 'tv',
    }));
  }, [isSeries, selectedSeriesCandidate, showManualModal]);

  useEffect(() => {
    if (!showManualModal || !isSeries) return;
    const title = String(manualForm.title || '').trim();
    if (!title) {
      setManualTmdbResults([]);
      setManualForm((prev) => ({ ...prev, tmdbId: '', tmdbMediaType: 'tv' }));
      return;
    }
    let cancelled = false;
    setManualTmdbLoading(true);
    fetch(`/api/tmdb/search?q=${encodeURIComponent(title)}&type=tv&page=1`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})).then((j) => ({ r, j })))
      .then(({ r, j }) => {
        if (cancelled) return;
        if (!r.ok || !j?.ok) throw new Error(j?.error || `TMDB search failed (${r.status})`);
        const results = Array.isArray(j?.results) ? j.results : [];
        setManualTmdbResults(results.slice(0, 8));

        const wantedYear = String(manualForm.year || '').trim();
        const wantedTitle = normKey(title);
        const scored = results
          .map((row) => {
            const rowTitle = normKey(titleFromTmdbResult(row));
            const rowYear = yearFromTmdbResult(row);
            const sameTitle = rowTitle === wantedTitle;
            const yearOk = wantedYear ? rowYear === wantedYear : false;
            const score = Number(row?.popularity || 0) + (sameTitle ? 100 : 0) + (yearOk ? 50 : 0);
            return { row, score };
          })
          .sort((a, b) => b.score - a.score);
        const best = scored[0]?.row || null;
        if (best && !String(manualForm.tmdbId || '').trim()) {
          setManualForm((prev) => ({
            ...prev,
            tmdbId: String(best.id || ''),
            tmdbMediaType: 'tv',
            year: prev.year ? prev.year : yearFromTmdbResult(best),
          }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setManualTmdbResults([]);
        setManualForm((prev) => ({ ...prev, tmdbId: '', tmdbMediaType: 'tv' }));
      })
      .finally(() => {
        if (!cancelled) setManualTmdbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSeries, manualForm.title, manualForm.year, manualForm.tmdbId, showManualModal]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="flex items-center gap-3 text-sm text-[var(--admin-muted)]">
          <Loader2 size={18} className="animate-spin" />
          Loading {pageTitle.toLowerCase()}…
        </div>
      </div>
    );
  }

  const summary = data?.summary || {};
  const pagination = data?.pagination || {};
  const xuiStatus = data?.sourceStatus?.xui || {};
  const nasStatus = data?.sourceStatus?.nas || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Manage the {isSeries ? 'series' : 'movie'} library across XUI and NAS storage, including direct deletion with per-target result tracking.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFolderSettings(true)}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            <Settings size={16} />
            Settings
          </button>
          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            <Plus size={16} />
            Add {isSeries ? 'Series' : 'Movie'}
          </button>
          <button
            type="button"
            onClick={() => load({ refresh: true })}
            disabled={working}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
      ) : null}
      {ok ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{ok}</div>
      ) : null}

      {!xuiStatus?.available ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          XUI index unavailable. NAS snapshot rows still load. {xuiStatus?.error ? `Reason: ${xuiStatus.error}` : ''}
        </div>
      ) : null}
      {!nasStatus?.available ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          NAS is offline or not writable. Deletion can still remove existing XUI entries, but NAS deletions will be marked unavailable until the mount is back.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="XUI + NAS" value={summary.both} hint="Present in both sources" />
        <KpiCard label="XUI Only" value={summary.xuiOnly} hint="Present only in XUI" />
        <KpiCard label="NAS Only" value={summary.nasOnly} hint="Present only in NAS snapshot" />
        <KpiCard label="Filtered" value={summary.filtered} hint={`Page ${pagination.page || 1} of ${pagination.totalPages || 1}`} />
        <KpiCard
          label="Recent Deletes"
          value={summary.recentDeletes}
          hint="Last 7 days"
          actionHint="Click to open logs in a new tab"
          href={logsHref}
        />
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <label className="flex h-9 w-72 shrink-0 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 text-xs">
            <Search size={14} className="text-[var(--admin-muted)]" />
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder={isSeries ? 'Search title / genre / path' : 'Search title / category / genre / path'}
              className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--admin-muted)]"
            />
          </label>

          <select
            value={presence}
            onChange={(event) => setPresence(event.target.value)}
            className="h-9 w-36 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
          >
            <option value="all">All sources</option>
            <option value="both">XUI + NAS</option>
            <option value="xui_only">XUI only</option>
            <option value="nas_only">NAS only</option>
          </select>

          {!isSeries ? (
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-9 w-40 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
            >
              <option value="">All categories</option>
              {(Array.isArray(data?.filters?.categories) ? data.filters.categories : []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}

          <select
            value={genre}
            onChange={(event) => setGenre(event.target.value)}
            className="h-9 w-40 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
          >
            <option value="">All genres</option>
            {(Array.isArray(data?.filters?.genres) ? data.filters.genres : []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="h-9 w-36 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
          >
            <option value="title_asc">Title A–Z</option>
            <option value="title_desc">Title Z–A</option>
            <option value="year_desc">Year newest</option>
            <option value="year_asc">Year oldest</option>
            <option value="presence">Presence</option>
          </select>

          <button
            type="button"
            onClick={clearFilters}
            disabled={!anyFilters || working}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 text-xs font-medium hover:bg-black/10 disabled:opacity-50"
          >
            <FilterX size={14} />
            Clear
          </button>
        </div>

        <div className="mt-2 text-[11px] text-[var(--admin-muted)]">
          XUI rows: {kpiLabel(xuiStatus?.count)} • NAS snapshot rows: {kpiLabel(nasStatus?.count)} • NAS snapshot:{' '}
          {nasStatus?.updatedAt ? `${fmtDate(nasStatus.updatedAt)} (${fmtAge(nasStatus.ageMs)})` : 'never'}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Manual uploads</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Uploads are stored under the Manual Upload folder tree and cleaned using the same rules as AutoDownload.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs hover:bg-black/10"
            >
              {manualOpen ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={loadManual}
              disabled={manualLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs hover:bg-black/10 disabled:opacity-60"
            >
              {manualLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>
        </div>

        {manualErr ? (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{manualErr}</div>
        ) : null}

        {manualOpen ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-y-2 text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[var(--admin-muted)]">
                <tr>
                  <th className="px-3">Title</th>
                  <th className="px-3">Status</th>
                  <th className="px-3">Release date</th>
                  <th className="px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {manualItems.length ? (
                  manualItems.map((item) => {
                    const title = String(item?.tmdb?.title || item?.title || '').trim() || 'Untitled';
                    const year = String(item?.tmdb?.year || item?.year || '').trim();
                    const displayReleaseDate = String(manualReleaseEdits[item?.id] ?? item?.releaseDate ?? '').trim();
                    return (
                      <tr key={item.id} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)]">
                        <td className="px-3 py-3">
                          <div className="font-medium">
                            {title} {year ? <span className="text-[var(--admin-muted)]">({year})</span> : null}
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--admin-muted)]">{String(item?.downloadPath || '').trim() || '—'}</div>
                        </td>
                        <td className="px-3 py-3">
                          <ManualStatus item={item} />
                          {item?.processingLog?.summary ? (
                            <div className="mt-2 text-[11px] text-[var(--admin-muted)]">
                              Renamed/moved: {kpiLabel(item.processingLog.summary?.movedTotal)} • Deleted:{' '}
                              {kpiLabel(item.processingLog.summary?.deletedTotal)}
                            </div>
                          ) : null}
                          {String(item?.error || '').trim() ? (
                            <div className="mt-2 text-[11px] text-red-200">{String(item.error).trim()}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="date"
                            value={displayReleaseDate}
                            onChange={(event) =>
                              setManualReleaseEdits((prev) => ({
                                ...prev,
                                [item.id]: event.target.value,
                              }))
                            }
                            className="h-9 w-44 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 text-xs outline-none"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={manualLoading}
                              onClick={async () => {
                                setManualErr('');
                                try {
                                  const response = await fetch('/api/admin/media-library', {
                                    method: 'POST',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({
                                      action: 'manual_update_release_date',
                                      type: resolvedType,
                                      id: item.id,
                                      releaseDate: displayReleaseDate,
                                    }),
                                  });
                                  const json = await readJsonSafe(response);
                                  if (!response.ok || !json?.ok) throw new Error(json?.error || `Request failed (${response.status})`);
                                  await loadManual();
                                } catch (error) {
                                  setManualErr(error?.message || 'Failed to update release date.');
                                }
                              }}
                              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs hover:bg-black/10 disabled:opacity-60"
                            >
                              Save date
                            </button>
                            <button
                              type="button"
                              disabled={manualLoading}
                              onClick={async () => {
                                setManualErr('');
                                try {
                                  const response = await fetch('/api/admin/media-library', {
                                    method: 'POST',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({
                                      action: 'manual_release_now',
                                      type: resolvedType,
                                      id: item.id,
                                    }),
                                  });
                                  const json = await readJsonSafe(response);
                                  if (!response.ok || !json?.ok) throw new Error(json?.error || `Request failed (${response.status})`);
                                  await Promise.all([loadManual(), load({ refresh: true })]);
                                } catch (error) {
                                  setManualErr(error?.message || 'Failed to release now.');
                                }
                              }}
                              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                            >
                              <UploadCloud size={14} />
                              Release now
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-xs text-[var(--admin-muted)]">
                      No manual uploads found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {selectedIds.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3">
          <div className="text-sm">
            <span className="font-medium">{selectedIds.length}</span> {selectedIds.length === 1 ? itemLabel : `${itemLabel}s`} selected on this page.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={working}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => runDelete(selectedIds)}
              disabled={working}
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-60"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete selected
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
        <div className="overflow-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-3">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Select all rows" />
                </th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3">IDs</th>
                <th className="px-3 py-3">Library</th>
                <th className="px-3 py-3">Sources</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(data?.items) ? data.items : []).length ? (
                data.items.map((row) => {
                  const checked = selectedIds.includes(String(row?.id || ''));
                  return (
                    <tr key={row?.id} className="border-t border-[var(--admin-border)] align-top">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={checked} onChange={() => toggleSelectOne(row?.id)} aria-label={`Select ${row?.title}`} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="min-w-[220px]">
                          <div className="font-medium">{row?.title || 'Untitled'}</div>
                          <div className="mt-1 text-xs text-[var(--admin-muted)]">
                            {row?.year || '—'} {row?.tmdbId ? `• TMDb ${row.tmdbId}` : ''} {row?.originalTitle ? `• ${row.originalTitle}` : ''}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <StatusPill tone={presenceTone(row?.presence)}>{presenceLabel(row?.presence)}</StatusPill>
                            {Number(row?.xuiCount || 0) > 1 ? <StatusPill tone="warning">{row.xuiCount} XUI entries</StatusPill> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                        <div>XUI: {Number(row?.xuiCount || 0) ? row.xuiIds.join(', ') : 'Not existing'}</div>
                        <div className="mt-1">TMDb: {row?.tmdbId || '—'}</div>
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                        {!isSeries ? (
                          <>
                            <div>Category: {row?.category || '—'}</div>
                            <div className="mt-1">Genre: {row?.genre || '—'}</div>
                            <div className="mt-1 break-all">Path: {row?.nasPath || 'Not existing in NAS snapshot'}</div>
                          </>
                        ) : (
                          <>
                            <div>Genre: {row?.genre || '—'}</div>
                            <div className="mt-1">Folder: {row?.folder || '—'}</div>
                            <div className="mt-1 break-all">Path: {row?.nasPath || 'Not existing in NAS snapshot'}</div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <StatusPill tone={Number(row?.xuiCount || 0) > 0 ? 'success' : 'neutral'}>
                            {Number(row?.xuiCount || 0) > 0 ? 'XUI tracked' : 'XUI not existing'}
                          </StatusPill>
                          <StatusPill tone={row?.nasPath ? 'info' : 'neutral'}>{row?.nasPath ? 'NAS tracked' : 'NAS not existing'}</StatusPill>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => runDelete([row?.id])}
                          disabled={working}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                        >
                          {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--admin-muted)]">
                    No {isSeries ? 'series' : 'movies'} match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--admin-border)] px-4 py-3 text-sm">
          <div className="text-[var(--admin-muted)]">
            Showing {pagination?.startIndex || 0}-{pagination?.endIndex || 0} of {kpiLabel(pagination?.totalItems)}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value || 25) || 25)}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm outline-none"
            >
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={(pagination?.page || 1) <= 1 || working}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 disabled:opacity-50"
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <div className="px-2 text-[var(--admin-muted)]">
              Page {pagination?.page || 1} / {pagination?.totalPages || 1}
            </div>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(Number(pagination?.totalPages || 1) || 1, current + 1))}
              disabled={(pagination?.page || 1) >= (pagination?.totalPages || 1) || working}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 disabled:opacity-50"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {showManualModal ? (
        <ModalShell
          title={`Add ${isSeries ? 'Series' : 'Movie'} (manual upload)`}
          onClose={() => {
            if (manualSubmitting) return;
            setManualSubmitErr('');
            setShowManualModal(false);
          }}
        >
          {manualSubmitErr ? (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{manualSubmitErr}</div>
          ) : null}

          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setManualSubmitting(true);
              setManualSubmitErr('');
              setManualResults([]);
              try {
                if (manualForm.releaseNow && !manualForm.processNow) {
                  throw new Error('Release now requires Clean now. The system will not release without cleaning first.');
                }
                if (!manualSelectedRows.length) throw new Error('Select a folder (or files) first.');
                if (!manualCandidates.length) throw new Error('No media files detected in the selection.');

                const xhrUpload = (formData, { onProgress } = {}) =>
                  new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/api/admin/media-library', true);
                    xhr.responseType = 'json';
                    xhr.timeout = 20 * 60 * 1000; // allow long server-side cleaning/release
                    xhr.upload.onprogress = (event2) => {
                      if (!event2.lengthComputable) return;
                      const pct = Math.max(0, Math.min(1, event2.loaded / event2.total));
                      if (typeof onProgress === 'function') onProgress(pct);
                    };
                    xhr.ontimeout = () => reject(new Error('Upload timed out. The server may still be processing; check Manual Uploads and logs.'));
                    xhr.onabort = () => reject(new Error('Upload aborted.'));
                    xhr.onerror = () => reject(new Error('Upload failed (network error).'));
                    xhr.onload = () => {
                      const json = xhr.response || {};
                      if (xhr.status >= 200 && xhr.status < 300 && json?.ok) return resolve(json);
                      reject(new Error(json?.error || `Upload failed (${xhr.status})`));
                    };
                    xhr.send(formData);
                  });

                const runUpload = async ({ title, year, rows, tmdbId, tmdbMediaType, index, total }) => {
                  const fd = new FormData();
                  fd.set('action', 'manual_upload');
                  fd.set('type', resolvedType);
                  fd.set('title', title);
                  fd.set('year', year || '');
                  if (tmdbId) fd.set('tmdbId', String(tmdbId));
                  if (tmdbMediaType) fd.set('tmdbMediaType', String(tmdbMediaType));
                  fd.set('releaseDate', manualForm.releaseDate);
                  fd.set('processNow', manualForm.processNow ? '1' : '0');
                  fd.set('releaseNow', manualForm.releaseNow ? '1' : '0');
                  for (const row of rows) {
                    fd.append('files', row.file);
                    fd.append('filePaths', row.relPath);
                  }
                  const label = total > 1 ? `${index + 1}/${total}` : '';
                  setManualUploadStatus(`Uploading ${isSeries ? 'series' : 'movie'} ${label}…`);
                      const json = await xhrUpload(fd, {
                        onProgress: (pct) => {
                      const overall = total > 1 ? (index + pct) / total : pct;
                      // Reserve the final 10% for the server-side processing time (cleaning, release checks).
                      setManualUploadProgress(Math.round(overall * 90));
                        },
                      });
                  setManualUploadStatus(`Processing${label ? ` (${label})` : ''}…`);
                  return json;
                };

                const results = [];
                if (isSeries) {
                  if (!selectedSeriesCandidate) throw new Error('Select the series to upload.');
                  if (!String(manualForm.tmdbId || '').trim()) {
                    throw new Error('No TMDB match selected. Please choose the correct TMDB series before uploading.');
                  }
                  const videoCount = selectedSeriesCandidate.rows.filter((row) => VIDEO_EXTS.has(row.ext)).length;
                  if (!videoCount) throw new Error('No episode video files detected for the selected series.');
                  const res = await runUpload({
                    title: String(manualForm.title || selectedSeriesCandidate.title).trim(),
                    year: String(manualForm.year || selectedSeriesCandidate.year).trim(),
                    tmdbId: manualForm.tmdbId,
                    tmdbMediaType: 'tv',
                    rows: selectedSeriesCandidate.rows,
                    index: 0,
                    total: 1,
                  });
                  results.push({
                    kind: 'series',
                    title: String(manualForm.title || selectedSeriesCandidate.title).trim(),
                    year: String(manualForm.year || selectedSeriesCandidate.year).trim(),
                    seasons: selectedSeriesCandidate.seasons,
                    episodes: selectedSeriesCandidate.episodes,
                    uploadedFiles: selectedSeriesCandidate.rows.length,
                    response: res,
                  });
                } else {
                  // movies: allow multiple movies in one folder selection
                  const total = manualCandidates.length;
                  let idx = 0;
                  for (const group of manualCandidates) {
                    const edit = manualMovieEdits[group.key] || {};
                    const title = String(edit.title ?? group.title ?? '').trim();
                    const year = String(edit.year ?? group.year ?? '').trim();
                    if (!title) continue;
                    const res = await runUpload({ title, year, rows: group.rows, index: idx, total });
                    const videoCount = group.rows.filter((row) => VIDEO_EXTS.has(row.ext)).length;
                    results.push({
                      kind: 'movie',
                      title,
                      year,
                      uploadedFiles: group.rows.length,
                      videoFiles: videoCount,
                      response: res,
                    });
                    idx += 1;
                  }
                  if (!results.length) throw new Error('No movies were queued. Check detected titles.');
                }

                setManualResults(results);
                setManualUploadProgress(100);
                setManualUploadStatus('Done.');
                void Promise.allSettled([loadManual(), load({ refresh: true })]);
                setOk(`${results.length} ${isSeries ? 'series' : 'movie'} upload(s) queued.`);
              } catch (error) {
                setManualSubmitErr(error?.message || 'Manual upload failed.');
              } finally {
                setManualSubmitting(false);
              }
            }}
            className="space-y-4"
          >
            {manualSubmitting ? (
              <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{manualUploadStatus || 'Uploading…'}</div>
                  <div className="tabular-nums text-[var(--admin-muted)]">{manualUploadProgress}%</div>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/20">
                  <div
                    className="h-2 rounded-full bg-emerald-400/80"
                    style={{ width: `${Math.max(0, Math.min(100, Number(manualUploadProgress || 0)))}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <div className="text-xs font-medium text-[var(--admin-muted)]">Release date (optional)</div>
                <input
                  type="date"
                  value={manualForm.releaseDate}
                  onChange={(event) => setManualForm((prev) => ({ ...prev, releaseDate: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 text-sm outline-none"
                />
                <div className="mt-1 text-[11px] text-[var(--admin-muted)]">Leave blank to use the system release schedule defaults.</div>
              </label>
              <div>
                <div className="text-xs font-medium text-[var(--admin-muted)]">Choose folder</div>
                <input
                  type="file"
                  // eslint-disable-next-line react/no-unknown-property
                  webkitdirectory=""
                  // eslint-disable-next-line react/no-unknown-property
                  directory=""
                  multiple
                  onChange={(event) => {
                    const rows = buildSelectedFileRows(event.target.files);
                    setManualSelectedRows(rows);
                    setManualSeriesPick('');
                    setManualMovieEdits({});
                    setManualResults([]);
                    setManualForm((prev) => ({ ...prev, tmdbId: '', tmdbMediaType: isSeries ? 'tv' : 'movie' }));
                    if (!isSeries && rows.length) {
                      const movieGroups = groupMovieUploads(rows);
                      const edits = {};
                      for (const g of movieGroups) edits[g.key] = { title: g.title, year: g.year };
                      setManualMovieEdits(edits);
                    }
                  }}
                  className="mt-1 block w-full text-xs text-[var(--admin-muted)] file:mr-3 file:rounded-lg file:border file:border-[var(--admin-border)] file:bg-[var(--admin-surface-2)] file:px-3 file:py-2 file:text-xs file:text-[var(--admin-text)]"
                />
                <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                  {isSeries ? 'Upload one series at a time. If the folder contains multiple series, you must pick which one to upload.' : 'You can upload multiple movies at once.'}
                </div>
              </div>
            </div>

            {manualSelectedRows.length ? (
              <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">Detected from folder</div>
                  <div className="text-[var(--admin-muted)]">
                    {manualSelectedRows.length.toLocaleString()} file(s) •{' '}
                    {manualSelectedRows.filter((row) => VIDEO_EXTS.has(row.ext)).length.toLocaleString()} video file(s)
                  </div>
                </div>

                {isSeries ? (
                  <>
                    <div className="mt-3 text-[11px] text-[var(--admin-muted)]">
                      Note: only one series can be uploaded per action. If multiple series are detected, choose one.
                    </div>
                    {manualCandidates.length > 1 ? (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <div className="text-xs font-medium text-[var(--admin-muted)]">Detected series</div>
                          <select
                            value={manualSeriesPick || manualCandidates[0]?.key || ''}
                            onChange={(event) => {
                              const key = event.target.value;
                              setManualSeriesPick(key);
                              const picked = manualCandidates.find((c) => c.key === key) || manualCandidates[0] || null;
                              if (picked) {
                                setManualForm((prev) => ({ ...prev, title: picked.title, year: picked.year }));
                              }
                            }}
                            className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-sm outline-none"
                          >
                            {manualCandidates.map((c) => (
                              <option key={c.key} value={c.key}>
                                {c.title} {c.year ? `(${c.year})` : ''} — {c.seasons} season(s), {c.episodes} episode(s)
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <div className="text-xs font-medium text-[var(--admin-muted)]">Title</div>
                        <input
                          value={manualForm.title}
                          onChange={(event) => setManualForm((prev) => ({ ...prev, title: event.target.value }))}
                          required
                          className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-sm outline-none"
                          placeholder="Series title"
                        />
                      </label>
                      <label className="block">
                        <div className="text-xs font-medium text-[var(--admin-muted)]">Year (optional)</div>
                        <input
                          value={manualForm.year}
                          onChange={(event) => setManualForm((prev) => ({ ...prev, year: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-sm outline-none"
                          placeholder="YYYY"
                        />
                      </label>
                    </div>

                    <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">TMDB match (required)</div>
                        {manualTmdbLoading ? (
                          <div className="inline-flex items-center gap-2 text-[11px] text-[var(--admin-muted)]">
                            <Loader2 size={14} className="animate-spin" />
                            Searching…
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusPill tone={String(manualForm.tmdbId || '').trim() ? 'success' : 'danger'}>
                          {String(manualForm.tmdbId || '').trim() ? `Selected: #${manualForm.tmdbId}` : 'Not selected'}
                        </StatusPill>
                        <div className="text-[11px] text-[var(--admin-muted)]">
                          If the wrong title is selected, cleaning may proceed but the library name will be wrong.
                        </div>
                      </div>
                      {manualTmdbResults.length ? (
                        <select
                          value={String(manualForm.tmdbId || '').trim()}
                          onChange={(event) => {
                            const id = String(event.target.value || '').trim();
                            const picked = manualTmdbResults.find((x) => String(x?.id || '') === id) || null;
                            setManualForm((prev) => ({
                              ...prev,
                              tmdbId: id,
                              tmdbMediaType: 'tv',
                              year: prev.year ? prev.year : (picked ? yearFromTmdbResult(picked) : prev.year),
                            }));
                          }}
                          className="mt-2 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 text-sm outline-none"
                        >
                          <option value="">Select TMDB result…</option>
                          {manualTmdbResults.map((row) => {
                            const t = titleFromTmdbResult(row);
                            const y = yearFromTmdbResult(row);
                            return (
                              <option key={row.id} value={String(row.id)}>
                                {t} {y ? `(${y})` : ''} — popularity {Math.round(Number(row?.popularity || 0))}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <div className="mt-2 text-[11px] text-[var(--admin-muted)]">No TMDB suggestions yet. Enter a clearer title.</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-xs">
                      <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">
                        <tr>
                          <th className="py-2 pr-3">Movie</th>
                          <th className="py-2 pr-3">Files</th>
                          <th className="py-2 pr-3">Detected year</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualCandidates.map((g) => {
                          const edit = manualMovieEdits[g.key] || { title: g.title, year: g.year };
                          const videoCount = g.rows.filter((row) => VIDEO_EXTS.has(row.ext)).length;
                          return (
                            <tr key={g.key} className="border-t border-[var(--admin-border)]">
                              <td className="py-2 pr-3">
                                <input
                                  value={String(edit.title || '')}
                                  onChange={(event) =>
                                    setManualMovieEdits((prev) => ({
                                      ...prev,
                                      [g.key]: { ...edit, title: event.target.value },
                                    }))
                                  }
                                  className="h-9 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 text-xs outline-none"
                                />
                              </td>
                              <td className="py-2 pr-3 text-[var(--admin-muted)]">
                                {videoCount} video • {g.rows.length} total
                              </td>
                              <td className="py-2 pr-3">
                                <input
                                  value={String(edit.year || '')}
                                  onChange={(event) =>
                                    setManualMovieEdits((prev) => ({
                                      ...prev,
                                      [g.key]: { ...edit, year: event.target.value },
                                    }))
                                  }
                                  className="h-9 w-28 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 text-xs outline-none"
                                  placeholder="YYYY"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={manualForm.processNow}
                  disabled={manualForm.releaseNow}
                  onChange={(event) => {
                    if (manualForm.releaseNow) return;
                    setManualForm((prev) => ({ ...prev, processNow: event.target.checked }));
                  }}
                />
                Clean now
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={manualForm.releaseNow}
                  onChange={(event) =>
                    setManualForm((prev) => ({
                      ...prev,
                      releaseNow: event.target.checked,
                      processNow: event.target.checked ? true : prev.processNow,
                    }))
                  }
                />
                Release now (move to NAS + trigger XUI)
              </label>
              {manualForm.releaseNow ? (
                <div className="text-[11px] font-medium text-[var(--admin-muted)]">Release now forces cleaning first.</div>
              ) : null}
            </div>

            {manualResults.length ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100">
                <div className="font-semibold">Upload report</div>
                <div className="mt-2 space-y-2">
                  {manualResults.map((r) => {
                    const movedTotal = Number(r?.response?.processingLog?.summary?.movedTotal || 0) || 0;
                    const deletedTotal = Number(r?.response?.processingLog?.summary?.deletedTotal || 0) || 0;
                    return (
                      <div key={`${r.kind}:${r.title}:${r.year}`} className="rounded-lg border border-emerald-500/20 bg-black/10 px-3 py-2">
                        <div className="font-medium">
                          {r.kind === 'series' ? 'Series' : 'Movie'}: {r.title} {r.year ? `(${r.year})` : ''}
                        </div>
                        <div className="mt-1 text-[11px] text-emerald-100/90">
                          Uploaded: {Number(r.uploadedFiles || 0)} file(s)
                          {r.kind === 'series' ? ` • ${r.seasons} season(s) • ${r.episodes} episode(s)` : ''}
                          {manualForm.processNow ? ` • Renamed/moved: ${movedTotal} • Deleted: ${deletedTotal}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={manualSubmitting}
                onClick={() => {
                  setManualSubmitErr('');
                  setShowManualModal(false);
                }}
                className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={manualSubmitting}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {manualSubmitting ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                Upload
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      <FolderSettingsModal
        open={showFolderSettings}
        onClose={() => setShowFolderSettings(false)}
        onSaved={() => {
          void load({ refresh: true });
        }}
      />
    </div>
  );
}
