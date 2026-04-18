'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FilterX, Loader2, Plus, RefreshCw, Search, Settings, Trash2, UploadCloud } from 'lucide-react';

import { readJsonSafe } from '../../../lib/readJsonSafe';

const VIDEO_EXTS = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm']);
const SUBTITLE_EXTS = new Set(['srt', 'ass', 'ssa', 'sub', 'vtt']);

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTmdbSearchResults({ query = '', type = 'movie', year = '', page = '1', retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const params = new URLSearchParams({ q: String(query || ''), type: String(type || 'movie'), page: String(page || '1') });
      if (/^\d{4}$/.test(String(year || '').trim())) params.set('year', String(year || '').trim());
      const response = await fetch(`/api/tmdb/search?${params.toString()}`, { cache: 'no-store' });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || `TMDB search failed (${response.status})`);
      return Array.isArray(json?.results) ? json.results : [];
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(350 * (attempt + 1));
    }
  }
  throw lastError || new Error('TMDB search failed.');
}

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
    <div data-admin-ui="1" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 text-[var(--admin-text)]">
      <div className="w-full max-w-7xl max-h-[85vh] overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
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
        <div className="max-h-[calc(85vh-72px)] overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function FolderSettingsModal({ open, onClose, onSaved, type = 'movie' }) {
  const resolvedType = String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const isSeries = resolvedType === 'series';
  const typeLabel = isSeries ? 'Series' : 'Movie';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [rootName, setRootName] = useState('Manual Upload');
  const [moviesProcessing, setMoviesProcessing] = useState('Processing');
  const [moviesCleaned, setMoviesCleaned] = useState('Cleaned and Ready');
  const [seriesProcessing, setSeriesProcessing] = useState('Processing');
  const [seriesCleaned, setSeriesCleaned] = useState('Cleaned and Ready');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr('');
    fetch(`/api/admin/media-library?view=preflight&type=${encodeURIComponent(resolvedType)}`, { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (cancelled) return;
        if (!json?.ok) throw new Error(json?.error || 'Failed to load folder settings.');
        setPreview(json);
        const root = String(json?.manualUploadFolders?.rootName || 'Manual Upload').trim() || 'Manual Upload';
        setRootName(root);
        setMoviesProcessing(String(json?.manualUploadFolders?.movies?.processing || 'Processing'));
        setMoviesCleaned(String(json?.manualUploadFolders?.movies?.cleaned || 'Cleaned and Ready'));
        setSeriesProcessing(String(json?.manualUploadFolders?.series?.processing || 'Processing'));
        setSeriesCleaned(String(json?.manualUploadFolders?.series?.cleaned || 'Cleaned and Ready'));
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
  }, [open, resolvedType]);

  if (!open) return null;
  const processingValue = isSeries ? seriesProcessing : moviesProcessing;
  const cleanedValue = isSeries ? seriesCleaned : moviesCleaned;
  const processingPath = String(preview?.stage?.incomingShareWindows || preview?.stage?.incomingShare || preview?.stage?.incomingDir || '—');
  const cleanedPath = String(preview?.stage?.processingShareWindows || preview?.stage?.processingShare || preview?.stage?.processingDir || '—');
  return (
    <ModalShell
      title="Library Folder Structure (Manual Upload)"
      onClose={() => {
        if (saving) return;
        onClose();
      }}
    >
      {err ? <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-[var(--admin-text)]">{err}</div> : null}
      <div className="text-xs text-[var(--admin-muted)]">
        Manual uploads are stored under <span className="font-mono">{rootName}</span>. Configure the incoming Processing folder and the cleaned-output folder used before release scheduling.
      </div>

      <div className="mt-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">{typeLabel}</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            {typeLabel} Processing path: <span className="font-mono">{processingPath}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            {typeLabel} Cleaned path: <span className="font-mono">{cleanedPath}</span>
          </div>
          <label className="mt-4 block">
            <div className="text-xs font-medium text-[var(--admin-muted)]">Processing folder name</div>
            <input
              value={processingValue}
              onChange={(e) => {
                if (isSeries) setSeriesProcessing(e.target.value);
                else setMoviesProcessing(e.target.value);
              }}
              className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 text-sm text-[var(--admin-text)] outline-none"
              placeholder="Processing"
              disabled={loading || saving}
            />
          </label>
          <label className="mt-4 block">
            <div className="text-xs font-medium text-[var(--admin-muted)]">Cleaned folder name</div>
            <input
              value={cleanedValue}
              onChange={(e) => {
                if (isSeries) setSeriesCleaned(e.target.value);
                else setMoviesCleaned(e.target.value);
              }}
              className="mt-1 h-10 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 text-sm text-[var(--admin-text)] outline-none"
              placeholder="Cleaned and Ready"
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
                  moviesCleaned,
                  seriesProcessing,
                  seriesCleaned,
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
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-[var(--admin-text)] hover:bg-emerald-500/20 disabled:opacity-60"
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
  title = title.replace(/[([{]+$/g, '').trim();
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

function splitRelParts(relPath = '') {
  const s = String(relPath || '').replace(/\\/g, '/').trim();
  return s.split('/').filter(Boolean);
}

function relFolderKey(relPath = '') {
  const parts = splitRelParts(relPath);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/').toLowerCase();
}

function relFolderPath(relPath = '') {
  const parts = splitRelParts(relPath);
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function uniqueRelPath(desired = '', existing = new Set()) {
  const base = String(desired || '').trim().replace(/\\/g, '/');
  if (!base) return '';
  if (!existing.has(base)) return base;
  const idx = base.lastIndexOf('.');
  const stem = idx > 0 ? base.slice(0, idx) : base;
  const ext = idx > 0 ? base.slice(idx) : '';
  let n = 2;
  while (n < 1000) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existing.has(candidate)) return candidate;
    n += 1;
  }
  return `${stem}-${Date.now()}${ext}`;
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

function groupMovieUploads(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const subtitleAssign = opts && typeof opts === 'object' ? opts.subtitleAssign || {} : {};

  const folderKeyFor = (relPath = '') => {
    return relFolderKey(relPath);
  };

  const stemFor = (name = '') => {
    const base = String(name || '').trim().replace(/\.[a-z0-9]{2,4}$/i, '');
    const stripped = base.replace(/\.(en|eng|english|tl|tagalog|fil|filipino)$/i, '');
    return normKey(stripped);
  };

  const videoRows = list.filter((row) => VIDEO_EXTS.has(row.ext));
  const groups = videoRows.map((videoRow) => {
    const leaf = splitRelParts(videoRow.relPath).slice(-1)[0] || videoRow.name;
    const parsed = parseMovieFromName(leaf || videoRow.name);
    const detectedTitle = String(parsed.title || '').trim() || 'Untitled';
    const title = cleanMovieTitleForEdit(detectedTitle) || detectedTitle;
    const year = String(parsed.year || '').trim();
    const key = String(videoRow.relPath || '').trim() || `${title.toLowerCase()}|${year}|${Math.random().toString(16).slice(2)}`;
    return {
      key,
      title,
      year,
      folderKey: folderKeyFor(videoRow.relPath),
      folderPath: relFolderPath(videoRow.relPath),
      videoStem: stemFor(videoRow.name),
      rows: [videoRow],
    };
  });

  // Assign non-video files (subtitles, nfo, etc.) to a specific video entry in the same folder.
  const byFolder = new Map();
  for (const g of groups) {
    const bucket = byFolder.get(g.folderKey) || [];
    bucket.push(g);
    byFolder.set(g.folderKey, bucket);
  }

  const otherRows = list.filter((row) => !VIDEO_EXTS.has(row.ext));
  for (const row of otherRows) {
    const folderKey = folderKeyFor(row.relPath);
    const candidates = byFolder.get(folderKey) || [];
    if (!candidates.length) continue;

    if (SUBTITLE_EXTS.has(row.ext)) {
      const rel = String(row.relPath || '').trim();
      const assignedKey = String(row?.assignedMovieKey || subtitleAssign?.[rel] || '').trim();
      if (assignedKey) {
        const forced = candidates.find((c) => String(c.key || '').trim() === assignedKey);
        if (forced) {
          forced.rows.push(row);
          continue;
        }
      }

      const subStem = stemFor(row.name);
      const exact = candidates.find((c) => c.videoStem && subStem && c.videoStem === subStem);
      if (exact) {
        exact.rows.push(row);
      }
      continue;
    }

    candidates[0].rows.push(row);
  }

  // Stable sort (by detected title/year then relPath key)
  return groups.sort((a, b) => a.title.localeCompare(b.title) || String(a.year || '').localeCompare(String(b.year || '')) || String(a.key || '').localeCompare(String(b.key || '')));
}

function inferDefaultSubtitleAssign(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const out = {};

  const folderKeyFor = (relPath = '') => relFolderKey(relPath);

  const stemFor = (name = '') => {
    const base = String(name || '').trim().replace(/\.[a-z0-9]{2,4}$/i, '');
    const stripped = base.replace(/\.(en|eng|english|tl|tagalog|fil|filipino)$/i, '');
    return normKey(stripped);
  };

  const videosByFolder = new Map();
  for (const row of list) {
    if (!VIDEO_EXTS.has(row.ext)) continue;
    const folder = folderKeyFor(row.relPath);
    if (!videosByFolder.has(folder)) videosByFolder.set(folder, []);
    videosByFolder.get(folder).push({
      key: String(row.relPath || '').trim(),
      stem: stemFor(row.name),
    });
  }

  for (const row of list) {
    if (!SUBTITLE_EXTS.has(row.ext)) continue;
    const rel = String(row.relPath || '').trim();
    if (!rel) continue;
    const folder = folderKeyFor(rel);
    const videos = videosByFolder.get(folder) || [];
    if (!videos.length) continue;
    const stem = stemFor(row.name);
    const best = videos.find((v) => v.stem && stem && v.stem === stem) || null;
    if (best?.key) out[rel] = best.key;
  }

  return out;
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

function inferSubtitleLangTag(name = '') {
  const s = String(name || '').toLowerCase();
  if (/\b(en|eng|english)\b/.test(s) || /[._-](en|eng)(?:[._-]|$)/.test(s)) return 'en';
  if (/\b(tl|tagalog|fil|filipino)\b/.test(s) || /[._-](tl|fil)(?:[._-]|$)/.test(s)) return 'tl';
  return '';
}

function applySubtitleTagToLeaf(leafName = '', langTag = '') {
  const tag = String(langTag || '').trim().toLowerCase();
  if (!tag) return String(leafName || '');
  const name = String(leafName || '');
  const idx = name.lastIndexOf('.');
  if (idx < 0) return name;
  const base = name.slice(0, idx);
  const ext = name.slice(idx + 1);
  const stripped = base.replace(/\.(en|eng|english|tl|tagalog|fil|filipino)$/i, '');
  return `${stripped}.${tag}.${ext}`;
}

function relPathWithLeaf(relPath = '', newLeaf = '') {
  const parts = splitRelParts(relPath);
  if (!parts.length) return String(newLeaf || '').trim();
  parts[parts.length - 1] = String(newLeaf || '').trim() || parts[parts.length - 1];
  return parts.join('/');
}

function pickBestTmdbResult({ results = [], wantedTitle = '', wantedYear = '' } = {}) {
  const wantedKeys = movieTitleCandidateKeys(wantedTitle);
  const y = String(wantedYear || '').trim();
  const list = Array.isArray(results) ? results : [];
  const scored = list
    .map((row) => {
      const rowTitle = normKey(titleFromTmdbResult(row));
      const rowYear = yearFromTmdbResult(row);
      const sameTitle = rowTitle ? wantedKeys.includes(rowTitle) : false;
      const prefixTitle = rowTitle
        ? wantedKeys.some((key) => key.length >= 4 && (rowTitle.startsWith(key) || key.startsWith(rowTitle)))
        : false;
      const containsTitle = rowTitle
        ? wantedKeys.some((key) => key.length >= 6 && (rowTitle.includes(key) || key.includes(rowTitle)))
        : false;
      const yearOk = y ? rowYear === y : false;
      const score = Number(row?.popularity || 0) + (sameTitle ? 120 : 0) + (prefixTitle ? 70 : 0) + (containsTitle ? 35 : 0) + (yearOk ? 50 : 0);
      return { row, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.row || null;
}

function shouldAutoPickMovieTmdbResult(row = {}, wantedTitle = '', wantedYear = '') {
  const rowTitle = normKey(titleFromTmdbResult(row));
  const wantedKeys = movieTitleCandidateKeys(wantedTitle);
  const rowYear = yearFromTmdbResult(row);
  const sameTitle = Boolean(rowTitle) && wantedKeys.includes(rowTitle);
  const compatibleTitle =
    sameTitle ||
    (Boolean(rowTitle) &&
      wantedKeys.some((key) => key.length >= 4 && (rowTitle.startsWith(key) || key.startsWith(rowTitle))));
  if (!compatibleTitle) return false;
  if (!String(wantedYear || '').trim()) return true;
  return rowYear === String(wantedYear || '').trim();
}

function movieTmdbSearchKey(title = '', year = '') {
  return `${normKey(title)}|${String(year || '').trim()}`;
}

function normalizeMovieTmdbSearchTitle(title = '') {
  let value = String(title || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  value = value.replace(/\b(?:part|pt)\.?\s*1\b$/i, '').trim();
  if (/\s+1$/i.test(value)) {
    const candidate = value.replace(/\s+1$/i, '').trim();
    if (candidate.split(/\s+/).length >= 2) return candidate;
  }
  return value;
}

function stripLeadingMovieIndex(title = '') {
  const value = String(title || '').trim();
  const match = value.match(/^(\d{1,2})\s+(.+)$/);
  if (!match) return value;
  const rawIndex = String(match[1] || '');
  const rest = String(match[2] || '').trim();
  const indexValue = Number(rawIndex);
  if (!rest || !Number.isFinite(indexValue) || indexValue <= 0) return value;
  const repeatedIndex = new RegExp(`\\b0*${indexValue}\\b`).test(rest);
  const zeroPaddedIndex = /^0\d$/.test(rawIndex);
  if (repeatedIndex || zeroPaddedIndex) return rest;
  return value;
}

function stripMovieTitleNoise(title = '') {
  let value = normalizeMovieTmdbSearchTitle(title);
  value = stripLeadingMovieIndex(value).trim();
  value = value
    .replace(/\b(?:eng(?:lish)?\s+subs?|subs?|subtitles?|h24[56]|h26[45]|x26[45]|mp4|mkv|avi)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = value
    .replace(
      /\s+[-–—]\s+(?:family\s+)?(?:action|adventure|animation|anime|comedy|crime|documentary|drama|family|fantasy|horror|kids|mystery|romance|sci[- ]?fi|science fiction|thriller|war|western)(?:\s+.*)?$/i,
      ''
    )
    .trim();
  return normalizeMovieTmdbSearchTitle(value);
}

function cleanMovieTitleForEdit(title = '') {
  return stripMovieTitleNoise(title) || normalizeMovieTmdbSearchTitle(title) || String(title || '').trim();
}

function compactMovieSequelTitle(title = '') {
  const value = stripMovieTitleNoise(title);
  const match = value.match(/^(.+?\b(?:[2-9]|1[0-9]|[IVX]{2,6}))\b(?:\s*[:\-–—]\s+|\s+).+$/i);
  return match ? String(match[1] || '').trim() : '';
}

function movieTitleCandidateTexts(title = '') {
  const raw = String(title || '').replace(/\s+/g, ' ').trim();
  const cleaned = stripMovieTitleNoise(raw);
  const compact = compactMovieSequelTitle(cleaned);
  const normalized = normalizeMovieTmdbSearchTitle(raw);
  const out = [];
  const seen = new Set();
  for (const candidate of [compact, cleaned, normalized, raw]) {
    const value = String(candidate || '').replace(/\s+/g, ' ').trim();
    const key = normKey(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function movieTitleCandidateKeys(title = '') {
  return movieTitleCandidateTexts(title).map((value) => normKey(value)).filter(Boolean);
}

function buildMovieTmdbQueries(title = '') {
  const out = [];
  const seen = new Set();
  for (const candidate of movieTitleCandidateTexts(title)) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    const key = normKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function formatManualFilterLabel(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Unknown';
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function manualUploadsHrefForType(type = 'movie') {
  return String(type || '').trim().toLowerCase() === 'series'
    ? '/admin/media-library/series/manual-uploaded'
    : '/admin/media-library/movies/manual-uploaded';
}

export default function AdminMediaLibraryPanel({ type = 'movie', mode = 'library' }) {
  const router = useRouter();
  const resolvedType = String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
  const viewMode = String(mode || '').trim().toLowerCase() === 'manual' ? 'manual' : 'library';
  const isManualView = viewMode === 'manual';
  const isSeries = resolvedType === 'series';
  const itemLabel = isSeries ? 'series' : 'movie';
  const pageTitle = isManualView ? (isSeries ? 'Manual Uploaded Series' : 'Manual Uploaded Movies') : isSeries ? 'Series List' : 'Movie List';
  const pageDescription = isManualView
    ? `Manage manually uploaded ${isSeries ? 'series' : 'movies'}, including release scheduling and direct upload actions.`
    : `Manage the ${isSeries ? 'series' : 'movie'} library across XUI and NAS storage, including direct deletion with per-target result tracking.`;
  const logsHref = isSeries ? '/admin/media-library/series/logs' : '/admin/media-library/movies/logs';
  const manualUploadsHref = manualUploadsHrefForType(resolvedType);

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

  const [manualData, setManualData] = useState(null);
  const [manualLoading, setManualLoading] = useState(true);
  const [manualErr, setManualErr] = useState('');
  const [manualQueryInput, setManualQueryInput] = useState('');
  const [manualQuery, setManualQuery] = useState('');
  const [manualOutcome, setManualOutcome] = useState('successful');
  const [manualStatus, setManualStatus] = useState('all');
  const [manualReleaseState, setManualReleaseState] = useState('all');
  const [manualSort, setManualSort] = useState('uploaded_desc');
  const [manualPage, setManualPage] = useState(1);
  const [manualPageSize, setManualPageSize] = useState(25);
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
  const [manualSubtitleEdits, setManualSubtitleEdits] = useState({});
  const [manualSubtitleAssign, setManualSubtitleAssign] = useState({});
  const [manualSubtitleOpen, setManualSubtitleOpen] = useState({});
  const [manualMovieTmdbResults, setManualMovieTmdbResults] = useState({});
  const [manualMovieTmdbLoading, setManualMovieTmdbLoading] = useState({});
  const [manualMovieTmdbSearchedKey, setManualMovieTmdbSearchedKey] = useState({});
  const [manualMovieTmdbError, setManualMovieTmdbError] = useState({});
  const [manualMovieSuggestKey, setManualMovieSuggestKey] = useState('');
  const manualMovieBlurTimerRef = useRef(null);
  const manualSubtitleInputRefs = useRef({});
  const manualMovieEditsRef = useRef({});
  const manualMovieTmdbLoadingRef = useRef({});
  const manualMovieTmdbResultsRef = useRef({});
  const manualMovieTmdbSearchedKeyRef = useRef({});
  const [manualUploadProgress, setManualUploadProgress] = useState(0);
  const [manualUploadStatus, setManualUploadStatus] = useState('');
  const [manualTmdbResults, setManualTmdbResults] = useState([]);
  const [manualTmdbLoading, setManualTmdbLoading] = useState(false);
  const [manualDuplicateItems, setManualDuplicateItems] = useState([]);
  const [manualDuplicateLoading, setManualDuplicateLoading] = useState(false);
  const [manualDuplicateError, setManualDuplicateError] = useState('');

  useEffect(() => {
    manualMovieEditsRef.current = manualMovieEdits;
  }, [manualMovieEdits]);

  useEffect(() => {
    manualMovieTmdbLoadingRef.current = manualMovieTmdbLoading;
  }, [manualMovieTmdbLoading]);

  useEffect(() => {
    manualMovieTmdbResultsRef.current = manualMovieTmdbResults;
  }, [manualMovieTmdbResults]);

  useEffect(() => {
    manualMovieTmdbSearchedKeyRef.current = manualMovieTmdbSearchedKey;
  }, [manualMovieTmdbSearchedKey]);

  useEffect(() => {
    if (!showManualModal) return;
    // reset derived state whenever modal opens
    setManualSelectedRows([]);
    setManualSeriesPick('');
    setManualResults([]);
    setManualMovieEdits({});
    setManualSubtitleEdits({});
    setManualSubtitleAssign({});
    setManualSubtitleOpen({});
    manualSubtitleInputRefs.current = {};
    setManualMovieTmdbResults({});
    setManualMovieTmdbLoading({});
    setManualMovieTmdbSearchedKey({});
    setManualMovieTmdbError({});
    setManualMovieSuggestKey('');
    setManualTmdbResults([]);
    setManualTmdbLoading(false);
    setManualDuplicateItems([]);
    setManualDuplicateLoading(false);
    setManualDuplicateError('');
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

  useEffect(
    () => () => {
      if (manualMovieBlurTimerRef.current) clearTimeout(manualMovieBlurTimerRef.current);
    },
    []
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(String(queryInput || '').trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setManualPage(1);
      setManualQuery(String(manualQueryInput || '').trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [manualQueryInput]);

  useEffect(() => {
    setPage(1);
  }, [presence, category, genre, sort, pageSize, resolvedType]);

  useEffect(() => {
    setManualPage(1);
  }, [manualOutcome, manualStatus, manualReleaseState, manualSort, manualPageSize, resolvedType]);

  useEffect(() => {
    if (manualOutcome !== 'failed') return;
    setManualStatus('all');
    setManualReleaseState('all');
  }, [manualOutcome]);

  const loadManual = useCallback(async () => {
    setManualLoading(true);
    setManualErr('');
    try {
      const qs = new URLSearchParams();
      qs.set('view', 'manual');
      qs.set('type', resolvedType);
      qs.set('q', manualQuery);
      qs.set('result', manualOutcome);
      if (manualOutcome !== 'failed') qs.set('status', manualStatus);
      if (manualOutcome !== 'failed') qs.set('releaseState', manualReleaseState);
      qs.set('sort', manualSort);
      qs.set('page', String(manualPage));
      qs.set('pageSize', String(manualPageSize));
      qs.set('limit', '5000');
      const response = await fetch(`/api/admin/media-library?${qs.toString()}`, { cache: 'no-store' });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load manual uploads.');
      setManualData(json);
    } catch (error) {
      setManualErr(error?.message || 'Failed to load manual uploads.');
      setManualData(null);
    } finally {
      setManualLoading(false);
    }
  }, [manualOutcome, manualPage, manualPageSize, manualQuery, manualReleaseState, manualSort, manualStatus, resolvedType]);

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
    if (isManualView) {
      setLoading(false);
      return;
    }
    load({ refresh: false });
  }, [isManualView, load]);

  useEffect(() => {
    if (!isManualView) return;
    loadManual();
  }, [isManualView, loadManual]);

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
  const manualItems = Array.isArray(manualData?.items) ? manualData.items : [];
  const manualSummary = manualData?.summary || {};
  const manualPagination = manualData?.pagination || {};
  const manualFilters = manualData?.filters || {};
  const manualFailedView = manualOutcome === 'failed';
  const manualAnyFilters = manualFailedView
    ? Boolean(manualQuery || manualSort !== 'uploaded_desc')
    : Boolean(manualQuery || manualStatus !== 'all' || manualReleaseState !== 'all' || manualSort !== 'uploaded_desc');
  const working = refreshing || deleting;
  const pageBusy = isManualView ? manualLoading || manualSubmitting : working;
  const pageErr = isManualView ? manualErr : err;

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

  const deleteManualItem = async (item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    const title = String(item?.tmdb?.title || item?.title || '').trim() || 'this manual upload';
    const isReleased = String(item?.releaseState || '').trim().toLowerCase() === 'released';
    const isProcessing = String(item?.status || '').trim().toLowerCase() === 'processing';
    if (isProcessing) {
      setManualErr('This manual upload is still cleaning. Delete it after processing finishes.');
      return;
    }
    const confirmText = isReleased
      ? `Delete ${title}?\n\nThis removes the released NAS folder for this manual upload and queues an XUI rescan.`
      : `Delete ${title}?\n\nThis removes the Manual Upload NAS folder and removes the title from Worth to Wait if it is still waiting for release.`;
    if (typeof window !== 'undefined' && !window.confirm(confirmText)) return;

    setOk('');
    setManualErr('');
    try {
      const response = await fetch('/api/admin/media-library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'manual_delete',
          type: resolvedType,
          id,
        }),
      });
      const json = await readJsonSafe(response);
      if (!response.ok || !json?.ok) throw new Error(json?.error || `Request failed (${response.status})`);
      const firstResult = Array.isArray(json?.results) ? json.results[0] || null : null;
      if (Number(json?.summary?.deleted || 0) < 1) {
        throw new Error(firstResult?.error || 'Failed to delete manual upload.');
      }
      setManualReleaseEdits((prev) => {
        const next = { ...(prev || {}) };
        delete next[id];
        return next;
      });
      setOk('Manual upload deleted.');
      await loadManual();
    } catch (error) {
      setManualErr(error?.message || 'Failed to delete manual upload.');
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

  const clearManualFilters = () => {
    setManualQueryInput('');
    setManualQuery('');
    setManualStatus('all');
    setManualReleaseState('all');
    setManualSort('uploaded_desc');
    setManualPage(1);
    setManualPageSize(25);
  };

  const manualCandidates = useMemo(() => {
    if (!manualSelectedRows.length) return [];
    return isSeries ? groupSeriesCandidates(manualSelectedRows) : groupMovieUploads(manualSelectedRows, { subtitleAssign: manualSubtitleAssign });
  }, [isSeries, manualSelectedRows, manualSubtitleAssign]);

  const selectedSeriesCandidate = useMemo(() => {
    if (!isSeries) return null;
    if (!manualCandidates.length) return null;
    const key = manualSeriesPick || manualCandidates[0]?.key || '';
    return manualCandidates.find((c) => c.key === key) || manualCandidates[0] || null;
  }, [isSeries, manualCandidates, manualSeriesPick]);

  const manualDuplicateTargets = useMemo(() => {
    if (!showManualModal || !manualCandidates.length) return [];
    if (isSeries) {
      const candidate = selectedSeriesCandidate;
      const title = String(manualForm.title || candidate?.title || '').trim();
      const year = String(manualForm.year || candidate?.year || '').trim();
      if (!title) return [];
      return [
        {
          key: String(candidate?.key || 'series').trim() || 'series',
          type: resolvedType,
          title,
          year,
          tmdbId: String(manualForm.tmdbId || '').trim(),
          tmdbMediaType: String(manualForm.tmdbMediaType || 'tv').trim() || 'tv',
        },
      ];
    }
    return manualCandidates
      .map((group) => {
        const edit = manualMovieEdits[group.key] || {};
        const title = String(edit.title ?? group.title ?? '').trim();
        const year = String(edit.year ?? group.year ?? '').trim();
        if (!title) return null;
        return {
          key: String(group.key || '').trim(),
          type: resolvedType,
          title,
          year,
          tmdbId: String(edit.tmdbId || '').trim(),
          tmdbMediaType: String(edit.tmdbMediaType || 'movie').trim() || 'movie',
        };
      })
      .filter(Boolean);
  }, [isSeries, manualCandidates, manualForm.title, manualForm.tmdbId, manualForm.tmdbMediaType, manualForm.year, manualMovieEdits, resolvedType, selectedSeriesCandidate, showManualModal]);

  const manualDuplicateMap = useMemo(() => {
    const map = new Map();
    for (const item of manualDuplicateItems) {
      const key = String(item?.key || '').trim();
      if (!key) continue;
      map.set(key, item);
    }
    return map;
  }, [manualDuplicateItems]);

  const manualBlockingDuplicates = useMemo(
    () => manualDuplicateItems.filter((item) => item?.duplicate),
    [manualDuplicateItems]
  );
  const manualHasBlockingDuplicate = manualBlockingDuplicates.length > 0;
  const selectedSeriesDuplicate = isSeries && selectedSeriesCandidate ? manualDuplicateMap.get(String(selectedSeriesCandidate.key || '').trim()) || null : null;

  const removeManualSubtitleRows = useCallback((relPaths = []) => {
    const wanted = new Set((Array.isArray(relPaths) ? relPaths : []).map((value) => String(value || '').trim()).filter(Boolean));
    if (!wanted.size) return;

    setManualSelectedRows((current) => current.filter((row) => !wanted.has(String(row?.relPath || '').trim())));
    setManualResults([]);
    setManualSubmitErr('');
    setManualDuplicateError('');
    setManualSubtitleEdits((current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      for (const rel of wanted) delete next[rel];
      return next;
    });
    setManualSubtitleAssign((current) => {
      const next = { ...(current && typeof current === 'object' ? current : {}) };
      for (const rel of wanted) delete next[rel];
      return next;
    });
  }, []);

  const removeManualCandidateKeys = useCallback(
    (keys = []) => {
      const wantedKeys = new Set((Array.isArray(keys) ? keys : []).map((value) => String(value || '').trim()).filter(Boolean));
      if (!wantedKeys.size) return;

      const removeRelPaths = new Set();
      for (const candidate of manualCandidates) {
        const key = String(candidate?.key || '').trim();
        if (!wantedKeys.has(key)) continue;
        for (const row of Array.isArray(candidate?.rows) ? candidate.rows : []) {
          const relPath = String(row?.relPath || '').trim();
          if (relPath) removeRelPaths.add(relPath);
        }
      }
      if (!removeRelPaths.size) return;

      setManualSelectedRows((current) => current.filter((row) => !removeRelPaths.has(String(row?.relPath || '').trim())));
      setManualResults([]);
      setManualSubmitErr('');
      setManualDuplicateError('');
      setManualSubtitleEdits((current) => {
        const next = { ...(current && typeof current === 'object' ? current : {}) };
        for (const rel of removeRelPaths) delete next[rel];
        return next;
      });
      setManualSubtitleAssign((current) => {
        const next = { ...(current && typeof current === 'object' ? current : {}) };
        for (const rel of removeRelPaths) delete next[rel];
        for (const [rel, target] of Object.entries(next)) {
          if (wantedKeys.has(String(target || '').trim())) delete next[rel];
        }
        return next;
      });
      setManualSubtitleOpen((current) => {
        const next = { ...(current && typeof current === 'object' ? current : {}) };
        for (const key of wantedKeys) delete next[key];
        return next;
      });
      for (const key of wantedKeys) delete manualSubtitleInputRefs.current[key];
      if (wantedKeys.has(String(manualMovieSuggestKey || '').trim())) {
        setManualMovieSuggestKey('');
      }
      if (isSeries) {
        setManualSeriesPick('');
      } else {
        setManualMovieEdits((current) => {
          const next = { ...current };
          for (const key of wantedKeys) delete next[key];
          return next;
        });
        setManualMovieTmdbResults((current) => {
          const next = { ...current };
          for (const key of wantedKeys) delete next[key];
          return next;
        });
        setManualMovieTmdbLoading((current) => {
          const next = { ...current };
          for (const key of wantedKeys) delete next[key];
          return next;
        });
        setManualMovieTmdbSearchedKey((current) => {
          const next = { ...current };
          for (const key of wantedKeys) delete next[key];
          return next;
        });
        setManualMovieTmdbError((current) => {
          const next = { ...current };
          for (const key of wantedKeys) delete next[key];
          return next;
        });
      }
    },
    [isSeries, manualCandidates, manualMovieSuggestKey]
  );

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

  const searchManualMovieTmdb = useCallback(async ({ key = '', title = '', year = '', force = false } = {}) => {
    const cleanKey = String(key || '').trim();
    const cleanTitle = String(title || '').trim();
    const cleanYear = String(year || '').trim();
    const searchKey = movieTmdbSearchKey(cleanTitle, cleanYear);
    if (!cleanKey || !cleanTitle || !searchKey) return;
    if (!force && String(manualMovieTmdbLoadingRef.current[cleanKey] || '') === searchKey) return;

    const previousSearchKey = String(manualMovieTmdbSearchedKeyRef.current[cleanKey] || '');
    const previousResults = Array.isArray(manualMovieTmdbResultsRef.current[cleanKey]) ? manualMovieTmdbResultsRef.current[cleanKey] : [];
    if (!force && previousSearchKey === searchKey && previousResults.length) return;

    setManualMovieTmdbLoading((prev) => ({ ...prev, [cleanKey]: searchKey }));
    setManualMovieTmdbError((prev) => ({ ...prev, [cleanKey]: '' }));

    try {
      const merged = [];
      const seenIds = new Set();
      let lastSearchError = null;
      for (const query of buildMovieTmdbQueries(cleanTitle)) {
        let batch = [];
        try {
          batch = (await fetchTmdbSearchResults({ query, type: 'movie', year: cleanYear })).slice(0, 12);
        } catch (error) {
          lastSearchError = error;
          continue;
        }
        for (const row of batch) {
          const id = String(row?.id || '').trim();
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          merged.push(row);
          if (merged.length >= 12) break;
        }
        if (merged.length >= 12) break;
      }
      if (!merged.length && lastSearchError) throw lastSearchError;

      const latestEdit = manualMovieEditsRef.current[cleanKey] || {};
      const latestSearchKey = movieTmdbSearchKey(String(latestEdit.title || cleanTitle).trim(), String(latestEdit.year || cleanYear).trim());
      if (latestSearchKey !== searchKey) return;

      setManualMovieTmdbResults((prev) => ({ ...prev, [cleanKey]: merged }));
      setManualMovieTmdbSearchedKey((prev) => ({ ...prev, [cleanKey]: searchKey }));

      const best = pickBestTmdbResult({ results: merged, wantedTitle: cleanTitle, wantedYear: cleanYear }) || merged[0] || null;
      if (best && shouldAutoPickMovieTmdbResult(best, cleanTitle, cleanYear)) {
        const bestTitle = titleFromTmdbResult(best) || cleanTitle;
        setManualMovieEdits((prev) => {
          const current = prev[cleanKey] || latestEdit;
          const currentSearchKey = movieTmdbSearchKey(String(current.title || cleanTitle).trim(), String(current.year || cleanYear).trim());
          if (currentSearchKey !== searchKey) return prev;
          return {
            ...prev,
            [cleanKey]: {
              ...current,
              title: bestTitle,
              year: (current.year ? current.year : yearFromTmdbResult(best)) || cleanYear,
              tmdbId: String(best.id || ''),
              tmdbMediaType: 'movie',
            },
          };
        });
      }
    } catch (error) {
      const latestEdit = manualMovieEditsRef.current[cleanKey] || {};
      const latestSearchKey = movieTmdbSearchKey(String(latestEdit.title || cleanTitle).trim(), String(latestEdit.year || cleanYear).trim());
      if (latestSearchKey !== searchKey) return;
      setManualMovieTmdbResults((prev) => ({ ...prev, [cleanKey]: [] }));
      setManualMovieTmdbSearchedKey((prev) => ({ ...prev, [cleanKey]: searchKey }));
      setManualMovieTmdbError((prev) => ({ ...prev, [cleanKey]: error?.message || 'TMDB search failed.' }));
    } finally {
      setManualMovieTmdbLoading((prev) => {
        if (String(prev[cleanKey] || '') !== searchKey) return prev;
        return { ...prev, [cleanKey]: '' };
      });
    }
  }, []);

  useEffect(() => {
    if (!showManualModal || isSeries) return;
    const activeKey = String(manualMovieSuggestKey || '').trim();
    if (!activeKey) return;
    const group = manualCandidates.find((candidate) => String(candidate?.key || '').trim() === activeKey) || null;
    if (!group) return;
    const edit = manualMovieEdits[activeKey] || {};
    const title = String(edit.title ?? group.title ?? '').trim();
    const year = String(edit.year ?? group.year ?? '').trim();
    if (!title) return;
    const handle = setTimeout(() => {
      void searchManualMovieTmdb({ key: activeKey, title, year });
    }, 180);
    return () => clearTimeout(handle);
  }, [isSeries, manualCandidates, manualMovieEdits, manualMovieSuggestKey, searchManualMovieTmdb, showManualModal]);

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

  useEffect(() => {
    if (!showManualModal) return;
    if (!manualDuplicateTargets.length) {
      setManualDuplicateItems([]);
      setManualDuplicateLoading(false);
      setManualDuplicateError('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setManualDuplicateLoading(true);
      setManualDuplicateError('');
      try {
        const response = await fetch('/api/admin/media-library', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'manual_upload_duplicate_check',
            items: manualDuplicateTargets,
          }),
        });
        const json = await readJsonSafe(response);
        if (!response.ok || !json?.ok) throw new Error(json?.error || `Duplicate check failed (${response.status})`);
        if (cancelled) return;
        setManualDuplicateItems(Array.isArray(json?.items) ? json.items : []);
      } catch (error) {
        if (cancelled) return;
        setManualDuplicateItems([]);
        setManualDuplicateError(error?.message || 'Duplicate check failed.');
      } finally {
        if (!cancelled) setManualDuplicateLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [manualDuplicateTargets, showManualModal]);

  if ((isManualView && manualLoading && !manualData) || (!isManualView && loading)) {
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
          <p className="mt-1 text-sm text-[var(--admin-muted)]">{pageDescription}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFolderSettings(true)}
            disabled={pageBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            <Settings size={16} />
            Settings
          </button>
          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            disabled={pageBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            <Plus size={16} />
            Add {isSeries ? 'Series' : 'Movie'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (isManualView) {
                void loadManual();
                return;
              }
              void load({ refresh: true });
            }}
            disabled={pageBusy}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            {isManualView && manualLoading ? <Loader2 size={16} className="animate-spin" /> : null}
            {!isManualView && refreshing ? <Loader2 size={16} className="animate-spin" /> : null}
            {((isManualView && !manualLoading) || (!isManualView && !refreshing)) ? <RefreshCw size={16} /> : null}
            Refresh
          </button>
        </div>
      </div>

      {pageErr ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[var(--admin-text)]">{pageErr}</div>
      ) : null}
      {ok ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-[var(--admin-text)]">{ok}</div>
      ) : null}

      {isManualView ? (
        <>
          <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setManualOutcome('successful')}
                className={
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ' +
                  (manualOutcome === 'successful'
                    ? 'bg-[var(--admin-active-bg)] text-[var(--admin-text)]'
                    : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] hover:text-[var(--admin-text)]')
                }
              >
                Successful Uploads
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs">{kpiLabel(manualSummary.allSuccessful)}</span>
              </button>
              <button
                type="button"
                onClick={() => setManualOutcome('failed')}
                className={
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ' +
                  (manualOutcome === 'failed'
                    ? 'bg-[var(--admin-active-bg)] text-[var(--admin-text)]'
                    : 'text-[var(--admin-muted)] hover:bg-[var(--admin-hover-bg)] hover:text-[var(--admin-text)]')
                }
              >
                Unsuccessful Uploads
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs">{kpiLabel(manualSummary.allFailed)}</span>
              </button>
            </div>
          </div>

          <div className={`grid gap-3 md:grid-cols-2 ${manualFailedView ? 'xl:grid-cols-3' : 'xl:grid-cols-5'}`}>
            <KpiCard label="Filtered" value={manualSummary.filtered} hint={`${kpiLabel(manualSummary.total)} items in this tab`} />
            {manualFailedView ? (
              <>
                <KpiCard label="Failed" value={manualSummary.failed} hint="Review the error and re-upload" />
                <KpiCard label="Successful" value={manualSummary.allSuccessful} hint="Uploads available in the success tab" />
              </>
            ) : (
              <>
                <KpiCard label="Waiting" value={manualSummary.waiting} hint="Queued for release" />
                <KpiCard label="Released" value={manualSummary.released} hint="Already moved to library" />
                <KpiCard label="Processing" value={manualSummary.processing} hint="Cleaner or release still running" />
                <KpiCard label="Cleaned" value={manualSummary.cleaned} hint="Ready inside Manual Upload storage" />
              </>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <label className="flex h-9 w-72 shrink-0 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 text-xs">
                <Search size={14} className="text-[var(--admin-muted)]" />
                <input
                  value={manualQueryInput}
                  onChange={(event) => setManualQueryInput(event.target.value)}
                  placeholder={isSeries ? 'Search title / uploader / path' : 'Search title / uploader / release date'}
                  className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--admin-muted)]"
                />
              </label>

              {!manualFailedView ? (
                <select
                  value={manualStatus}
                  onChange={(event) => setManualStatus(event.target.value)}
                  className="h-9 w-36 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
                >
                  <option value="all">All statuses</option>
                  {(Array.isArray(manualFilters?.statuses) ? manualFilters.statuses : []).map((value) => (
                    <option key={value} value={value}>
                      {formatManualFilterLabel(value)}
                    </option>
                  ))}
                </select>
              ) : null}

              {!manualFailedView ? (
                <select
                  value={manualReleaseState}
                  onChange={(event) => setManualReleaseState(event.target.value)}
                  className="h-9 w-40 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
                >
                  <option value="all">All release states</option>
                  {(Array.isArray(manualFilters?.releaseStates) ? manualFilters.releaseStates : []).map((value) => (
                    <option key={value} value={value}>
                      {formatManualFilterLabel(value)}
                    </option>
                  ))}
                </select>
              ) : null}

              <select
                value={manualSort}
                onChange={(event) => setManualSort(event.target.value)}
                className="h-9 w-40 shrink-0 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
              >
                <option value="uploaded_desc">Uploaded newest</option>
                <option value="uploaded_asc">Uploaded oldest</option>
                {!manualFailedView ? <option value="release_date_asc">Release date oldest</option> : null}
                {!manualFailedView ? <option value="release_date_desc">Release date newest</option> : null}
                <option value="title_asc">Title A–Z</option>
                <option value="title_desc">Title Z–A</option>
              </select>

              <button
                type="button"
                onClick={clearManualFilters}
                disabled={!manualAnyFilters || manualLoading}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 text-xs font-medium hover:bg-black/10 disabled:opacity-50"
              >
                <FilterX size={14} />
                Clear
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)]">
            <div className="overflow-auto">
              <table className={`w-full text-left text-sm ${manualFailedView ? 'min-w-[980px]' : 'min-w-[1080px]'}`}>
                <thead className="bg-[var(--admin-surface-2)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
                  <tr>
                    <th className="px-3 py-3">Title</th>
                    <th className="px-3 py-3">Upload</th>
                    <th className="px-3 py-3">{manualFailedView ? 'Error' : 'Status'}</th>
                    <th className="px-3 py-3">{manualFailedView ? 'Cleanup' : 'Release date'}</th>
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {manualItems.length ? (
                    manualItems.map((item) => {
                      const title = String(item?.tmdb?.title || item?.title || '').trim() || 'Untitled';
                      const year = String(item?.tmdb?.year || item?.year || '').trim();
                      const uploadPath = String(item?.downloadPath || '').trim() || '—';
                      const uploadedBy = String(item?.manualUploadedBy || '').trim() || 'System';
                      const uploadedAt = Number(item?.manualUploadedAt || item?.addedAt || 0) || 0;
                      const displayReleaseDate = String(manualReleaseEdits[item?.id] ?? item?.releaseDate ?? '').trim();
                      const isReleased = String(item?.releaseState || '').trim().toLowerCase() === 'released';
                      const failureMessage = String(item?.error || item?.processingLog?.error || '').trim() || 'Upload failed.';
                      const manualCleanup = item?.manualUploadCleanup || item?.processingLog?.summary?.manualUploadCleanup || null;
                      const cleanupNote = manualCleanup
                        ? `Removed: ${kpiLabel(manualCleanup?.removed)} • Not found: ${kpiLabel(manualCleanup?.notFound)} • Failed: ${kpiLabel(manualCleanup?.failed)}`
                        : 'No cleanup details recorded.';
                      return (
                        <tr key={item.id} className="border-t border-[var(--admin-border)] align-top">
                          <td className="px-3 py-3">
                            <div className="min-w-[240px]">
                              <div className="font-medium">
                                {title} {year ? <span className="text-[var(--admin-muted)]">({year})</span> : null}
                              </div>
                              <div className="mt-1 text-xs text-[var(--admin-muted)] break-all">{uploadPath}</div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                            <div>Uploaded by: {uploadedBy}</div>
                            <div className="mt-1">Uploaded at: {uploadedAt ? fmtDate(uploadedAt) : '—'}</div>
                            {item?.processingLog?.summary ? (
                              <div className="mt-2">
                                Renamed/moved: {kpiLabel(item.processingLog.summary?.movedTotal)} • Deleted:{' '}
                                {kpiLabel(item.processingLog.summary?.deletedTotal)}
                              </div>
                            ) : null}
                          </td>
                          {manualFailedView ? (
                            <>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <ManualStatus item={item} />
                                </div>
                                <div className="mt-2 text-xs text-[var(--admin-text)]">{failureMessage}</div>
                              </td>
                              <td className="px-3 py-3 text-xs text-[var(--admin-muted)]">
                                <div>{cleanupNote}</div>
                                <div className="mt-2">Failed uploads do not keep files in the Manual Upload NAS folders.</div>
                              </td>
                              <td className="px-3 py-3">
                                <button
                                  type="button"
                                  onClick={() => deleteManualItem(item)}
                                  disabled={manualLoading}
                                  title="Delete manual upload"
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-[var(--admin-text)] hover:bg-red-500/20 disabled:opacity-60"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <ManualStatus item={item} />
                                  <StatusPill tone={isReleased ? 'accent' : 'neutral'}>
                                    {formatManualFilterLabel(item?.releaseState || 'waiting')}
                                  </StatusPill>
                                </div>
                                {String(item?.error || '').trim() ? (
                                  <div className="mt-2 text-xs text-[var(--admin-text)]">{String(item.error).trim()}</div>
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
                                  className="h-9 w-44 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 text-xs outline-none"
                                />
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={manualLoading}
                                    onClick={async () => {
                                      setOk('');
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
                                        setOk('Release date updated.');
                                        await loadManual();
                                      } catch (error) {
                                        setManualErr(error?.message || 'Failed to update release date.');
                                      }
                                    }}
                                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs hover:bg-black/10 disabled:opacity-60"
                                  >
                                    Save date
                                  </button>
                                  <button
                                    type="button"
                                    disabled={manualLoading || isReleased}
                                    onClick={async () => {
                                      setOk('');
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
                                        setOk('Release queued.');
                                        await loadManual();
                                      } catch (error) {
                                        setManualErr(error?.message || 'Failed to release now.');
                                      }
                                    }}
                                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-[var(--admin-text)] hover:bg-emerald-500/20 disabled:opacity-60"
                                  >
                                    <UploadCloud size={14} />
                                    {isReleased ? 'Released' : 'Release now'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteManualItem(item)}
                                    disabled={manualLoading}
                                    title="Delete manual upload"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-[var(--admin-text)] hover:bg-red-500/20 disabled:opacity-60"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-[var(--admin-muted)]">
                        {manualFailedView ? 'No unsuccessful uploads match the current filters.' : 'No manual uploads match the current filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--admin-border)] px-4 py-3 text-sm">
              <div className="text-[var(--admin-muted)]">
                Showing {manualPagination?.startIndex || 0}-{manualPagination?.endIndex || 0} of {kpiLabel(manualPagination?.totalItems)}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={manualPageSize}
                  onChange={(event) => setManualPageSize(Number(event.target.value || 25) || 25)}
                  className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm outline-none"
                >
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
                <button
                  type="button"
                  onClick={() => setManualPage((current) => Math.max(1, current - 1))}
                  disabled={(manualPagination?.page || 1) <= 1 || manualLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 disabled:opacity-50"
                >
                  <ChevronLeft size={16} />
                  Prev
                </button>
                <div className="px-2 text-[var(--admin-muted)]">
                  Page {manualPagination?.page || 1} / {manualPagination?.totalPages || 1}
                </div>
                <button
                  type="button"
                  onClick={() => setManualPage((current) => Math.min(Number(manualPagination?.totalPages || 1) || 1, current + 1))}
                  disabled={(manualPagination?.page || 1) >= (manualPagination?.totalPages || 1) || manualLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 disabled:opacity-50"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {!xuiStatus?.available ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-[var(--admin-text)]">
              XUI index unavailable. NAS snapshot rows still load. {xuiStatus?.error ? `Reason: ${xuiStatus.error}` : ''}
            </div>
          ) : null}
          {!nasStatus?.available ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-[var(--admin-text)]">
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
                  className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-[var(--admin-text)] hover:bg-red-500/20 disabled:opacity-60"
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
                              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-[var(--admin-text)] hover:bg-red-500/20 disabled:opacity-60"
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
        </>
      )}

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
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-[var(--admin-text)]">{manualSubmitErr}</div>
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
                if (manualDuplicateLoading) {
                  throw new Error('Duplicate check is still running. Please wait before uploading.');
                }
                if (manualHasBlockingDuplicate) {
                  throw new Error('One or more selected titles already exist in the system. Remove them before uploading.');
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
                      let json = xhr.response || {};
                      if ((!json || typeof json !== 'object' || Array.isArray(json)) && String(xhr.responseText || '').trim()) {
                        try {
                          json = JSON.parse(xhr.responseText);
                        } catch {}
                      }
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
                  let uploadIndex = 0;
                  const appendUploadRow = (row, relPath) => {
                    const index = uploadIndex;
                    uploadIndex += 1;
                    fd.append(`files[${index}]`, row.file, row.name || row.file?.name || `upload-${index}`);
                    fd.append(`filePaths[${index}]`, String(relPath || row.relPath || row.name || `upload-${index}`).trim());
                  };
                  for (const row of rows) {
                    const rel = String(row.relPath || '').trim();
                    if (SUBTITLE_EXTS.has(row.ext)) {
                      const sub = manualSubtitleEdits[rel];
                      const tag = String(sub?.tag || '').trim();
                      if (tag) {
                        const leaf = splitRelParts(rel).slice(-1)[0] || row.name;
                        const renamed = applySubtitleTagToLeaf(leaf, tag);
                        appendUploadRow(row, relPathWithLeaf(rel, renamed));
                        continue;
                      }
                    }
                    appendUploadRow(row, rel);
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
                    const tmdbId = String(edit.tmdbId || '').trim();
                    const tmdbMediaType = String(edit.tmdbMediaType || 'movie').trim() || 'movie';
                    const res = await runUpload({ title, year, rows: group.rows, tmdbId, tmdbMediaType, index: idx, total });
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
                setOk(`${results.length} ${isSeries ? 'series' : 'movie'} upload(s) queued.`);
                setShowManualModal(false);
                if (isManualView) {
                  setManualResults([]);
                  await loadManual();
                } else {
                  router.push(manualUploadsHref);
                }
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
                    const defaultAssign = inferDefaultSubtitleAssign(rows);
                    setManualSelectedRows(rows);
                    setManualSeriesPick('');
                    setManualMovieEdits({});
                    setManualMovieSuggestKey('');
                    setManualSubtitleEdits(() => {
                      const out = {};
                      for (const row of rows) {
                        if (!SUBTITLE_EXTS.has(row.ext)) continue;
                        const rel = String(row.relPath || '').trim();
                        if (!rel) continue;
                        out[rel] = { tag: inferSubtitleLangTag(row.name) };
                      }
                      return out;
                    });
                    setManualSubtitleAssign(defaultAssign);
                    setManualSubtitleOpen({});
                    setManualMovieTmdbResults({});
                    setManualMovieTmdbLoading({});
                    setManualMovieTmdbError({});
                    setManualResults([]);
                    setManualForm((prev) => ({ ...prev, tmdbId: '', tmdbMediaType: isSeries ? 'tv' : 'movie' }));
                    if (!isSeries && rows.length) {
                      const movieGroups = groupMovieUploads(rows, { subtitleAssign: defaultAssign });
                      const edits = {};
                      for (const g of movieGroups) edits[g.key] = { title: g.title, year: g.year, tmdbId: '', tmdbMediaType: 'movie' };
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
                        <div className="mt-2 text-[11px] text-[var(--admin-muted)]">No TMDB matches yet. Enter a clearer title.</div>
                      )}
                    </div>

                    <div
                      className={
                        'mt-3 rounded-lg border px-3 py-2 text-xs ' +
                        (selectedSeriesDuplicate?.duplicate
                          ? 'border-red-500/30 bg-red-500/10 text-[var(--admin-text)]'
                          : manualDuplicateError
                            ? 'border-amber-500/30 bg-amber-500/10 text-[var(--admin-text)]'
                            : 'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text)]')
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">System duplicate check</div>
                        {manualDuplicateLoading ? <StatusPill tone="info">Checking…</StatusPill> : null}
                        {!manualDuplicateLoading && selectedSeriesDuplicate?.duplicate ? <StatusPill tone="danger">Already exists</StatusPill> : null}
                        {!manualDuplicateLoading && !selectedSeriesDuplicate?.duplicate && selectedSeriesDuplicate && !selectedSeriesDuplicate?.error ? (
                          <StatusPill tone="success">Ready to upload</StatusPill>
                        ) : null}
                        {!manualDuplicateLoading && selectedSeriesDuplicate?.error ? <StatusPill tone="warning">Check incomplete</StatusPill> : null}
                      </div>
                      <div className="mt-2">
                        {manualDuplicateLoading
                          ? 'Checking XUI, NAS, Manual Upload Cleaned and Ready, and active queue records for this series.'
                          : selectedSeriesDuplicate?.duplicate
                            ? selectedSeriesDuplicate.message
                            : selectedSeriesDuplicate?.error
                              ? `${selectedSeriesDuplicate.error} The server will still re-check on upload.`
                              : selectedSeriesDuplicate
                                ? 'No existing match found in XUI, NAS, Manual Upload Cleaned and Ready, or active queue records.'
                                : 'Select the series details to run the duplicate check.'}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[1150px] text-xs">
                      <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">
                        <tr>
                          <th className="py-2 pr-3">Movie</th>
                          <th className="py-2 pr-3">Files</th>
                          <th className="py-2 pr-3">Detected year</th>
                          <th className="py-2 pr-3">TMDB</th>
                          <th className="py-2 pr-3">System check</th>
                          <th className="py-2 pr-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualCandidates.map((g) => {
                          const edit = manualMovieEdits[g.key] || { title: g.title, year: g.year };
                          const videoCount = g.rows.filter((row) => VIDEO_EXTS.has(row.ext)).length;
                          const duplicateInfo = manualDuplicateMap.get(String(g.key || '').trim()) || null;
                          const subtitleRows = g.rows.filter(
                            (row) => SUBTITLE_EXTS.has(row.ext) && (!row?.assignedMovieKey || String(row.assignedMovieKey || '').trim() === String(g.key || '').trim())
                          );
                          const tmdbResults = Array.isArray(manualMovieTmdbResults[g.key]) ? manualMovieTmdbResults[g.key] : [];
                          const tmdbLoading = Boolean(manualMovieTmdbLoading[g.key]);
                          const tmdbError = String(manualMovieTmdbError[g.key] || '').trim();
                          const suggestOpen = String(manualMovieSuggestKey || '').trim() === String(g.key || '').trim();
                          return (
                            <Fragment key={g.key}>
                              <tr className="border-t border-[var(--admin-border)] align-top">
                                <td className="py-2 pr-3">
                                  {(() => {
                                    const isOpen = Boolean(manualSubtitleOpen[g.key]);
                                    const subtitleCount = subtitleRows.length;
                                    const subtitleLabel = subtitleCount ? `Subtitles: ${subtitleCount}` : 'No subtitles';
                                    const openSubtitlePicker = () => {
                                      const input = manualSubtitleInputRefs.current[String(g.key || '').trim()];
                                      if (input) input.click();
                                    };

                                    return (
                                      <>
                                        <div className="relative flex items-center gap-2">
                                          <div className="relative min-w-[260px] flex-1">
                                            <div className="flex items-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)]">
                                              <input
                                                value={String(edit.title || '')}
                                                onFocus={() => {
                                                  if (manualMovieBlurTimerRef.current) clearTimeout(manualMovieBlurTimerRef.current);
                                                  setManualMovieSuggestKey(String(g.key || '').trim());
                                                  const nextTitle = String(edit.title || '').trim();
                                                  const nextYear = String(edit.year || '').trim();
                                                  if (nextTitle) void searchManualMovieTmdb({ key: g.key, title: nextTitle, year: nextYear });
                                                }}
                                                onBlur={() => {
                                                  if (manualMovieBlurTimerRef.current) clearTimeout(manualMovieBlurTimerRef.current);
                                                  manualMovieBlurTimerRef.current = setTimeout(() => setManualMovieSuggestKey(''), 140);
                                                }}
                                                onChange={(event) => {
                                                  const nextTitle = event.target.value;
                                                  setManualMovieEdits((prev) => ({
                                                    ...prev,
                                                    [g.key]: { ...edit, title: nextTitle, tmdbId: '', tmdbMediaType: 'movie' },
                                                  }));
                                                  setManualMovieSuggestKey(String(g.key || '').trim());
                                                  setManualMovieTmdbResults((prev) => ({ ...prev, [g.key]: [] }));
                                                  setManualMovieTmdbLoading((prev) => ({ ...prev, [g.key]: '' }));
                                                  setManualMovieTmdbSearchedKey((prev) => ({ ...prev, [g.key]: '' }));
                                                  setManualMovieTmdbError((prev) => ({ ...prev, [g.key]: '' }));
                                                }}
                                                className="h-9 flex-1 rounded-lg bg-transparent px-2 text-xs outline-none"
                                              />
                                            </div>
                                            {suggestOpen ? (
                                              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] shadow-xl">
                                                {tmdbLoading ? (
                                                  <div className="px-3 py-2 text-[11px] text-[var(--admin-muted)]">Searching TMDB…</div>
                                                ) : tmdbResults.length ? (
                                                  <div className="max-h-56 overflow-y-auto py-1">
                                                    {tmdbResults.slice(0, 8).map((row) => {
                                                      const rowId = String(row?.id || '').trim();
                                                      const rowTitle = titleFromTmdbResult(row);
                                                      const rowYear = yearFromTmdbResult(row);
                                                      const selected = rowId && rowId === String(edit.tmdbId || '').trim();
                                                      return (
                                                        <button
                                                          key={`${g.key}-${rowId}`}
                                                          type="button"
                                                          onMouseDown={(event) => {
                                                            event.preventDefault();
                                                            const nextTitle = rowTitle || String(edit.title || '');
                                                            const nextYear = rowYear || String(edit.year || '');
                                                            setManualMovieEdits((prev) => ({
                                                              ...prev,
                                                              [g.key]: {
                                                                ...(prev[g.key] || edit),
                                                                title: nextTitle,
                                                                year: nextYear,
                                                                tmdbId: rowId,
                                                                tmdbMediaType: 'movie',
                                                              },
                                                            }));
                                                            setManualMovieSuggestKey('');
                                                          }}
                                                          className={
                                                            'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-black/10 ' +
                                                            (selected ? 'bg-emerald-500/10' : '')
                                                          }
                                                        >
                                                          <span className="min-w-0 truncate text-[var(--admin-text)]">
                                                            {rowTitle || 'Untitled'} {rowYear ? `(${rowYear})` : ''}
                                                          </span>
                                                          <span className="shrink-0 text-[11px] text-[var(--admin-muted)]">
                                                            {selected ? 'Selected' : `TMDB #${rowId}`}
                                                          </span>
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                ) : (
                                                  <div className="px-3 py-2 text-[11px] text-[var(--admin-muted)]">
                                                    {tmdbError || 'Type a clearer movie title to see TMDB suggestions.'}
                                                  </div>
                                                )}
                                              </div>
                                            ) : null}
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setManualSubtitleOpen((prev) => ({ ...(prev || {}), [g.key]: !isOpen }));
                                              if (!subtitleCount) {
                                                openSubtitlePicker();
                                              }
                                            }}
                                            className="inline-flex items-center rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--admin-text)] hover:bg-black/10"
                                            title="Click to view/assign subtitle files"
                                          >
                                            {subtitleLabel}
                                          </button>
                                          <input
                                            ref={(node) => {
                                              const key = String(g.key || '').trim();
                                              if (!key) return;
                                              if (node) manualSubtitleInputRefs.current[key] = node;
                                              else delete manualSubtitleInputRefs.current[key];
                                            }}
                                            type="file"
                                            multiple
                                            accept=".srt,.ass,.ssa,.sub,.vtt"
                                            className="hidden"
                                            onChange={(event) => {
                                              const picked = event.target.files ? Array.from(event.target.files) : [];
                                              if (!picked.length) return;
                                              const existing = new Set(
                                                (Array.isArray(manualSelectedRows) ? manualSelectedRows : []).map((row) => String(row?.relPath || '').trim()).filter(Boolean)
                                              );
                                              const rowsToAdd = [];
                                              const assignUpdates = {};
                                              const editUpdates = {};
                                              for (const f of picked) {
                                                const ext = fileExt(f?.name || '');
                                                if (!SUBTITLE_EXTS.has(ext)) continue;
                                                const folderPath = String(g.folderPath || '').trim();
                                                const desired = folderPath ? `${folderPath}/${String(f?.name || '').trim()}` : String(f?.name || '').trim();
                                                const relPath = uniqueRelPath(desired, existing);
                                                existing.add(relPath);
                                                rowsToAdd.push({
                                                  file: f,
                                                  relPath,
                                                  name: String(f?.name || '').trim(),
                                                  ext,
                                                  size: Number(f?.size || 0) || 0,
                                                  assignedMovieKey: String(g.key || '').trim(),
                                                });
                                                assignUpdates[relPath] = String(g.key || '').trim();
                                                editUpdates[relPath] = { tag: inferSubtitleLangTag(f?.name || '') };
                                              }
                                              if (!rowsToAdd.length) return;
                                              setManualSelectedRows((prev) => [...(Array.isArray(prev) ? prev : []), ...rowsToAdd]);
                                              setManualSubtitleAssign((prev) => ({ ...(prev || {}), ...assignUpdates }));
                                              setManualSubtitleEdits((prev) => ({ ...(prev || {}), ...editUpdates }));
                                              setManualSubtitleOpen((prev) => ({ ...(prev || {}), [g.key]: true }));
                                              event.target.value = '';
                                            }}
                                          />
                                        </div>

                                        {isOpen ? (
                                          <div className="mt-2 space-y-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2">
                                            {subtitleRows.length ? (
                                              <div className="space-y-2">
                                                {subtitleRows.map((row) => {
                                                  const rel = String(row.relPath || '').trim();
                                                  const current = manualSubtitleEdits[rel] || { tag: inferSubtitleLangTag(row.name) };
                                                  const tag = String(current.tag || '').trim();
                                                  const leaf = splitRelParts(rel).slice(-1)[0] || row.name;
                                                  return (
                                                    <div key={rel} className="flex flex-wrap items-center justify-between gap-2">
                                                      <div className="min-w-[220px] flex-1">
                                                        <div className="text-[11px] text-[var(--admin-text)]">{leaf}</div>
                                                      </div>
                                                      <div className="flex items-center gap-2">
                                                        <select
                                                          value={tag}
                                                          onChange={(event) => {
                                                            const nextTag = String(event.target.value || '').trim();
                                                            setManualSubtitleEdits((prev) => ({
                                                              ...(prev || {}),
                                                              [rel]: { ...(prev?.[rel] || current), tag: nextTag },
                                                            }));
                                                          }}
                                                          className="h-8 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 text-[11px] outline-none"
                                                        >
                                                          <option value="">Keep original</option>
                                                          <option value="en">English (en)</option>
                                                          <option value="tl">Tagalog (tl)</option>
                                                        </select>
                                                        <button
                                                          type="button"
                                                          onClick={() => removeManualSubtitleRows([rel])}
                                                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-[var(--admin-text)] hover:bg-red-500/20"
                                                        >
                                                          Remove
                                                        </button>
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                                <div className="text-[11px] text-[var(--admin-muted)]">These subtitles are attached to this movie only. Adjust the language tag or remove the file.</div>
                                              </div>
                                            ) : (
                                              <div className="text-[11px] text-[var(--admin-muted)]">No subtitle files are currently assigned to this movie.</div>
                                            )}

                                            <div className="border-t border-[var(--admin-border)] pt-2">
                                                <div className="text-[11px] font-semibold text-[var(--admin-text)]">Attach subtitle files to this movie</div>
                                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                                  <div className="text-[11px] text-[var(--admin-muted)]">Selected files are added only to this movie row.</div>
                                                  <button
                                                    type="button"
                                                    onClick={openSubtitlePicker}
                                                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-[var(--admin-text)] hover:bg-emerald-500/20"
                                                  >
                                                    Choose subtitle files…
                                                  </button>
                                              </div>
                                            </div>
                                          </div>
                                        ) : null}
                                      </>
                                    );
                                  })()}
                                </td>
                                <td className="py-2 pr-3 text-[var(--admin-muted)]">
                                  {videoCount} video • {g.rows.length} total
                                </td>
                                <td className="py-2 pr-3">
                                  <input
                                    value={String(edit.year || '')}
                                    onChange={(event) => {
                                      const nextYear = event.target.value;
                                      setManualMovieEdits((prev) => ({
                                        ...prev,
                                        [g.key]: { ...edit, year: nextYear, tmdbId: '', tmdbMediaType: 'movie' },
                                      }));
                                      setManualMovieTmdbResults((prev) => ({ ...prev, [g.key]: [] }));
                                      setManualMovieTmdbLoading((prev) => ({ ...prev, [g.key]: '' }));
                                      setManualMovieTmdbSearchedKey((prev) => ({ ...prev, [g.key]: '' }));
                                      setManualMovieTmdbError((prev) => ({ ...prev, [g.key]: '' }));
                                    }}
                                    className="h-9 w-24 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 text-xs outline-none"
                                    placeholder="YYYY"
                                  />
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {String(edit.tmdbId || '').trim() ? (
                                      <button
                                        type="button"
                                        disabled
                                        title={`TMDB auto selected #${edit.tmdbId}`}
                                        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-[var(--admin-text)] opacity-100"
                                      >
                                        <CheckCircle2 size={13} className="text-emerald-500" />
                                        Auto selected
                                      </button>
                                    ) : (
                                      <StatusPill tone="warning">Not set</StatusPill>
                                    )}
                                    {tmdbLoading ? <StatusPill tone="info">Searching…</StatusPill> : null}
                                    {tmdbError ? <StatusPill tone="danger">TMDB error</StatusPill> : null}
                                  </div>
                                  <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                                    {String(edit.tmdbId || '').trim()
                                      ? `TMDB #${edit.tmdbId} matched from the cleaned movie title.`
                                      : tmdbLoading
                                        ? 'Searching from the movie title field…'
                                        : tmdbError
                                          ? tmdbError
                                          : 'Focus or type in the movie title to search TMDB.'}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    {manualDuplicateLoading ? <StatusPill tone="info">Checking…</StatusPill> : null}
                                    {!manualDuplicateLoading && duplicateInfo?.duplicate ? <StatusPill tone="danger">Already exists</StatusPill> : null}
                                    {!manualDuplicateLoading && !duplicateInfo?.duplicate && duplicateInfo && !duplicateInfo?.error ? <StatusPill tone="success">Ready</StatusPill> : null}
                                    {!manualDuplicateLoading && duplicateInfo?.error ? <StatusPill tone="warning">Check incomplete</StatusPill> : null}
                                  </div>
                                  <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                                    {manualDuplicateLoading
                                      ? 'Checking XUI, NAS, Manual Upload Cleaned and Ready, and active records…'
                                      : duplicateInfo?.duplicate
                                        ? duplicateInfo.message
                                        : duplicateInfo?.error
                                          ? duplicateInfo.error
                                          : duplicateInfo
                                            ? 'No duplicate found in XUI, NAS, Manual Upload Cleaned and Ready, or active records.'
                                            : 'Waiting for title.'}
                                  </div>
                                </td>
                                <td className="py-2 pr-3">
                                  <button
                                    type="button"
                                    onClick={() => removeManualCandidateKeys([g.key])}
                                    aria-label="Remove title"
                                    title="Remove title"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-[var(--admin-text)] hover:bg-red-500/20"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            {manualDuplicateError ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-[var(--admin-text)]">
                Duplicate pre-check failed: {manualDuplicateError}. The server will still enforce the duplicate block on upload.
              </div>
            ) : null}

            {!manualDuplicateLoading && manualHasBlockingDuplicate ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-[var(--admin-text)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-semibold">Existing titles detected</div>
                  {!isSeries ? (
                    <button
                      type="button"
                      onClick={() => removeManualCandidateKeys(manualBlockingDuplicates.map((item) => item?.key))}
                      disabled={manualSubmitting}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-[var(--admin-text)] hover:bg-red-500/20 disabled:opacity-60"
                    >
                      Remove duplicate titles
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1">
                  {manualBlockingDuplicates.map((item) => (
                    <div key={item.key}>
                      {item.title} {item.year ? `(${item.year})` : ''} — {item.reasons?.join('; ') || 'Already exists in the system.'}
                    </div>
                  ))}
                </div>
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
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-[var(--admin-text)]">
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
                        <div className="mt-1 text-[11px] text-[var(--admin-text)]/90">
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
                disabled={manualSubmitting || manualDuplicateLoading || manualHasBlockingDuplicate}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-[var(--admin-text)] hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {manualSubmitting ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                {manualDuplicateLoading ? 'Checking duplicates…' : manualHasBlockingDuplicate ? 'Remove duplicates to upload' : 'Upload'}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}

      <FolderSettingsModal
        open={showFolderSettings}
        type={resolvedType}
        onClose={() => setShowFolderSettings(false)}
        onSaved={() => {
          void load({ refresh: true });
        }}
      />
    </div>
  );
}
