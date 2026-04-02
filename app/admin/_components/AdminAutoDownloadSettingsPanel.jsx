'use client';

import { useEffect, useMemo, useState } from 'react';

import HelpTooltip from './HelpTooltip';
import EditModal, { EditIconButton } from './EditModal';
import NotesButton from './NotesButton';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function Field({ label, hint, children, note }) {
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
      className={cx(
        'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30',
        props.className
      )}
    />
  );
}

function Textarea(props) {
  return (
    <textarea
      {...props}
      className={cx(
        'min-h-[88px] w-full resize-y rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30',
        props.className
      )}
    />
  );
}

function Pill({ ok, label }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium',
        ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'
      )}
    >
      {label}
    </span>
  );
}

function fmtBytes(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function parseExtList(s) {
  const parts = String(s || '')
    .split(/[,\n\r\t ]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^\./, '').toLowerCase());
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function isValidTimeHHMM(s) {
  const v = String(s || '').trim();
  if (!/^\d{2}:\d{2}$/.test(v)) return false;
  const [hh, mm] = v.split(':').map((x) => Number(x));
  return Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function isValidTimezone(tz) {
  const s = String(tz || '').trim();
  if (!s) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const dayItems = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

const FIXED_CATEGORIES = ['English', 'Asian'];
const DEFAULT_TIMEZONE = 'Asia/Manila';
const DEFAULT_CLEANING_TEMPLATES = {
  movieFolder: '{title} ({year})-{quality}',
  movieFile: '{title} ({year})-{quality}',
  movieSubtitle: '{title} ({year})-{quality}.{lang}',
  seriesFolder: '{title} ({year})',
  seriesSeasonFolder: 'Season {season}',
  seriesEpisode: '{title} - S{season}E{episode}',
  seriesSubtitle: '{title} - S{season}E{episode}.{lang}',
};

function renderTemplatePreview(template, tokenValues, fallback = 'Untitled') {
  const raw = String(template || '').trim();
  if (!raw) return fallback;
  const rendered = raw.replace(/\{([a-z_]+)\}/gi, (_, key) => String(tokenValues?.[String(key || '').toLowerCase()] ?? ''));
  const collapsed = rendered
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/-+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .trim();
  return collapsed || fallback;
}

function useTimezones() {
  return useMemo(() => {
    const fallback = [DEFAULT_TIMEZONE, 'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
    try {
      // Most modern browsers support this; keep list but avoid rendering thousands if not needed.
      // eslint-disable-next-line no-undef
      const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : null;
      if (Array.isArray(all) && all.length) return [DEFAULT_TIMEZONE, ...all.filter((x) => x !== DEFAULT_TIMEZONE)];
    } catch {}
    return fallback;
  }, []);
}

function clampNumber(v, { min = null, max = null, fallback = null } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  let x = n;
  if (min !== null && x < min) x = min;
  if (max !== null && x > max) x = max;
  return x;
}

export default function AdminAutoDownloadSettingsPanel() {
  const timezones = useTimezones();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [editCoreOpen, setEditCoreOpen] = useState(false);
  const [editLimitsOpen, setEditLimitsOpen] = useState(false);
  const [editFileRulesOpen, setEditFileRulesOpen] = useState(false);

  const [mountStatus, setMountStatus] = useState(null);

  const [enabled, setEnabled] = useState(false);
  const [moviesEnabled, setMoviesEnabled] = useState(false);
  const [seriesEnabled, setSeriesEnabled] = useState(false);

  const [tz, setTz] = useState(DEFAULT_TIMEZONE);
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 0]);
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');

  const [storageLimitGb, setStorageLimitGb] = useState(0);
  const [maxMovieGb, setMaxMovieGb] = useState(2.5);
  const [maxEpisodeGb, setMaxEpisodeGb] = useState('');
  const [minMovieSeeders, setMinMovieSeeders] = useState(1);
  const [minSeriesSeeders, setMinSeriesSeeders] = useState(1);

  const [timeoutEnabled, setTimeoutEnabled] = useState(false);
  const [maxWaitHours, setMaxWaitHours] = useState(6);
  const [strictSeriesReplacement, setStrictSeriesReplacement] = useState(true);
  const [deletePartialSeriesOnReplacementFailure, setDeletePartialSeriesOnReplacementFailure] = useState(true);
  const [cleaningEnabled, setCleaningEnabled] = useState(true);
  const [createMovieFolderIfMissing, setCreateMovieFolderIfMissing] = useState(true);
  const [movieFolderTemplate, setMovieFolderTemplate] = useState(DEFAULT_CLEANING_TEMPLATES.movieFolder);
  const [movieFileTemplate, setMovieFileTemplate] = useState(DEFAULT_CLEANING_TEMPLATES.movieFile);
  const [movieSubtitleTemplate, setMovieSubtitleTemplate] = useState(DEFAULT_CLEANING_TEMPLATES.movieSubtitle);
  const [seriesFolderTemplate, setSeriesFolderTemplate] = useState(DEFAULT_CLEANING_TEMPLATES.seriesFolder);
  const [seriesSeasonFolderTemplate, setSeriesSeasonFolderTemplate] = useState(DEFAULT_CLEANING_TEMPLATES.seriesSeasonFolder);
  const [seriesEpisodeTemplate, setSeriesEpisodeTemplate] = useState(DEFAULT_CLEANING_TEMPLATES.seriesEpisode);
  const [seriesSubtitleTemplate, setSeriesSubtitleTemplate] = useState(DEFAULT_CLEANING_TEMPLATES.seriesSubtitle);
  const [releaseDelayDays, setReleaseDelayDays] = useState(3);

  const [videoExtsText, setVideoExtsText] = useState('mkv, mp4, avi, mov, wmv, m4v, mpg, mpeg, ts, webm');
  const [subExtsText, setSubExtsText] = useState('srt, ass, ssa, sub, vtt');
  const [skipSample, setSkipSample] = useState(true);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/autodownload/settings', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load settings.');

      const s = j.settings || {};
      setEnabled(Boolean(s.enabled));
      setMoviesEnabled(Boolean(s.moviesEnabled));
      setSeriesEnabled(Boolean(s.seriesEnabled));

      const scheduleTimezone = String(s?.schedule?.timezone || '').trim();
      setTz(scheduleTimezone && scheduleTimezone !== 'UTC' ? scheduleTimezone : DEFAULT_TIMEZONE);
      setDays(Array.isArray(s?.schedule?.days) ? s.schedule.days : [1, 2, 3, 4, 5, 6, 0]);
      setStartTime(s?.schedule?.startTime || '00:00');
      setEndTime(s?.schedule?.endTime || '23:59');

      const totalGb = Number(j?.mountStatus?.space?.total || 0) > 0 ? Number(j.mountStatus.space.total) / (1024 * 1024 * 1024) : 0;
      const legacyLimitPercent = Number(s?.storage?.limitPercent ?? 95) || 95;
      const resolvedLimitGb = Number(s?.storage?.limitGb ?? (totalGb > 0 ? (legacyLimitPercent / 100) * totalGb : 0)) || 0;
      setStorageLimitGb(Math.round(resolvedLimitGb * 1000) / 1000);
      setMaxMovieGb(Number(s?.sizeLimits?.maxMovieGb ?? 2.5) || 2.5);
      setMaxEpisodeGb(s?.sizeLimits?.maxEpisodeGb === null || s?.sizeLimits?.maxEpisodeGb === undefined ? '' : String(s.sizeLimits.maxEpisodeGb));
      setMinMovieSeeders(Math.max(0, Number(s?.sourceFilters?.minMovieSeeders ?? 1) || 0));
      setMinSeriesSeeders(Math.max(0, Number(s?.sourceFilters?.minSeriesSeeders ?? 1) || 0));

      setTimeoutEnabled(Boolean(s?.timeoutChecker?.enabled));
      setMaxWaitHours(Number(s?.timeoutChecker?.maxWaitHours ?? 6) || 6);
      setStrictSeriesReplacement(s?.timeoutChecker?.strictSeriesReplacement !== false);
      setDeletePartialSeriesOnReplacementFailure(s?.timeoutChecker?.deletePartialSeriesOnReplacementFailure !== false);
      setCleaningEnabled(s?.cleaning?.enabled !== false);
      setCreateMovieFolderIfMissing(s?.cleaning?.createMovieFolderIfMissing !== false);
      const tpl = s?.cleaning?.templates || {};
      setMovieFolderTemplate(String(tpl?.movieFolder || DEFAULT_CLEANING_TEMPLATES.movieFolder));
      setMovieFileTemplate(String(tpl?.movieFile || DEFAULT_CLEANING_TEMPLATES.movieFile));
      setMovieSubtitleTemplate(String(tpl?.movieSubtitle || DEFAULT_CLEANING_TEMPLATES.movieSubtitle));
      setSeriesFolderTemplate(String(tpl?.seriesFolder || DEFAULT_CLEANING_TEMPLATES.seriesFolder));
      setSeriesSeasonFolderTemplate(String(tpl?.seriesSeasonFolder || DEFAULT_CLEANING_TEMPLATES.seriesSeasonFolder));
      setSeriesEpisodeTemplate(String(tpl?.seriesEpisode || DEFAULT_CLEANING_TEMPLATES.seriesEpisode));
      setSeriesSubtitleTemplate(String(tpl?.seriesSubtitle || DEFAULT_CLEANING_TEMPLATES.seriesSubtitle));
      setReleaseDelayDays(Math.max(0, Number(s?.release?.delayDays ?? 3) || 3));

      setVideoExtsText((Array.isArray(s?.fileRules?.videoExtensions) ? s.fileRules.videoExtensions : []).join(', ') || videoExtsText);
      setSubExtsText((Array.isArray(s?.fileRules?.subtitleExtensions) ? s.fileRules.subtitleExtensions : []).join(', ') || subExtsText);
      setSkipSample(s?.fileRules?.skipSample !== false);

      setMountStatus(j.mountStatus || null);
    } catch (e) {
      setErr(e?.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validationErrors = useMemo(() => {
    const errors = [];
    if (!isValidTimezone(tz)) errors.push('Timezone is invalid.');
    const d = Array.isArray(days) ? days : [];
    if (!d.length) errors.push('Select at least one day.');
    if (!isValidTimeHHMM(startTime)) errors.push('Start time is invalid.');
    if (!isValidTimeHHMM(endTime)) errors.push('End time is invalid.');
    const sl = Number(storageLimitGb);
    if (!Number.isFinite(sl) || sl <= 0) errors.push('Storage limit must be greater than 0 GB.');
    const mm = Number(maxMovieGb);
    if (!Number.isFinite(mm) || mm <= 0) errors.push('Max movie size must be > 0.');
    if (!Number.isFinite(Number(minMovieSeeders)) || Number(minMovieSeeders) < 0) errors.push('Min movie seeders must be >= 0.');
    if (!Number.isFinite(Number(minSeriesSeeders)) || Number(minSeriesSeeders) < 0) errors.push('Min series seeders must be >= 0.');
    if (!String(movieFolderTemplate || '').trim()) errors.push('Movie folder template is required.');
    if (!String(movieFileTemplate || '').trim()) errors.push('Movie file template is required.');
    if (!String(movieSubtitleTemplate || '').trim()) errors.push('Movie subtitle template is required.');
    if (!String(seriesFolderTemplate || '').trim()) errors.push('Series folder template is required.');
    if (!String(seriesSeasonFolderTemplate || '').trim()) errors.push('Series season folder template is required.');
    if (!String(seriesEpisodeTemplate || '').trim()) errors.push('Series episode template is required.');
    if (!String(seriesSubtitleTemplate || '').trim()) errors.push('Series subtitle template is required.');
    const hasInvalidPathSep = [
      movieFolderTemplate,
      movieFileTemplate,
      movieSubtitleTemplate,
      seriesFolderTemplate,
      seriesSeasonFolderTemplate,
      seriesEpisodeTemplate,
      seriesSubtitleTemplate,
    ].some((x) => /[\\/]/.test(String(x || '')));
    if (hasInvalidPathSep) {
      errors.push('Cleaning templates must not contain path separators.');
    }
    if (!Number.isFinite(Number(releaseDelayDays)) || Number(releaseDelayDays) < 0 || Number(releaseDelayDays) > 30) {
      errors.push('Release delay days must be 0–30.');
    }

    const ve = parseExtList(videoExtsText);
    const se = parseExtList(subExtsText);
    if (!ve.length) errors.push('Allowed video extensions must not be empty.');
    if (!se.length) errors.push('Allowed subtitle extensions must not be empty.');

    return errors;
  }, [
    tz,
    days,
    startTime,
    endTime,
    storageLimitGb,
    maxMovieGb,
    minMovieSeeders,
    minSeriesSeeders,
    movieFolderTemplate,
    movieFileTemplate,
    movieSubtitleTemplate,
    seriesFolderTemplate,
    seriesSeasonFolderTemplate,
    seriesEpisodeTemplate,
    seriesSubtitleTemplate,
    releaseDelayDays,
    videoExtsText,
    subExtsText,
  ]);

  const canSave = validationErrors.length === 0;

  const toggleDay = (id) => {
    setDays((prev) => {
      const cur = Array.isArray(prev) ? prev : [];
      const has = cur.includes(id);
      const next = has ? cur.filter((x) => x !== id) : [...cur, id];
      next.sort((a, b) => a - b);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const payload = {
        enabled,
        moviesEnabled,
        seriesEnabled,
        schedule: { timezone: tz, days, startTime, endTime },
        storage: { limitGb: Number(storageLimitGb) },
        sizeLimits: {
          maxMovieGb: Number(maxMovieGb),
          maxEpisodeGb: maxEpisodeGb.trim() ? Number(maxEpisodeGb) : null,
        },
        sourceFilters: {
          minMovieSeeders: Math.max(0, Math.floor(Number(minMovieSeeders) || 0)),
          minSeriesSeeders: Math.max(0, Math.floor(Number(minSeriesSeeders) || 0)),
        },
        timeoutChecker: {
          enabled: timeoutEnabled,
          maxWaitHours: Number(maxWaitHours),
          intervalMinutes: 15,
          strictSeriesReplacement,
          deletePartialSeriesOnReplacementFailure,
        },
        cleaning: {
          enabled: cleaningEnabled,
          createMovieFolderIfMissing,
          templates: {
            movieFolder: String(movieFolderTemplate || DEFAULT_CLEANING_TEMPLATES.movieFolder).trim(),
            movieFile: String(movieFileTemplate || DEFAULT_CLEANING_TEMPLATES.movieFile).trim(),
            movieSubtitle: String(movieSubtitleTemplate || DEFAULT_CLEANING_TEMPLATES.movieSubtitle).trim(),
            seriesFolder: String(seriesFolderTemplate || DEFAULT_CLEANING_TEMPLATES.seriesFolder).trim(),
            seriesSeasonFolder: String(seriesSeasonFolderTemplate || DEFAULT_CLEANING_TEMPLATES.seriesSeasonFolder).trim(),
            seriesEpisode: String(seriesEpisodeTemplate || DEFAULT_CLEANING_TEMPLATES.seriesEpisode).trim(),
            seriesSubtitle: String(seriesSubtitleTemplate || DEFAULT_CLEANING_TEMPLATES.seriesSubtitle).trim(),
          },
        },
        release: {
          delayDays: Math.max(0, Math.min(30, Math.floor(Number(releaseDelayDays) || 3))),
          timezone: DEFAULT_TIMEZONE,
        },
        fileRules: {
          videoExtensions: parseExtList(videoExtsText),
          subtitleExtensions: parseExtList(subExtsText),
          skipSample,
        },
        categories: {
          categories: FIXED_CATEGORIES,
        },
      };

      const r = await fetch('/api/admin/autodownload/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        const list = Array.isArray(j?.errors) ? j.errors.join(' ') : '';
        throw new Error(j?.error ? `${j.error}${list ? ` ${list}` : ''}` : 'Failed to save.');
      }
      setOk('Saved.');
      setMountStatus(j.mountStatus || null);
    } catch (e) {
      setErr(e?.message || 'Failed to save.');
    } finally {
      setBusy(false);
    }
  };

  const used = mountStatus?.space?.used || 0;
  const total = mountStatus?.space?.total || 0;
  const avail = mountStatus?.space?.avail || 0;
  const usedPct = total ? Math.round((used / total) * 100) : null;
  const totalGb = total ? total / (1024 * 1024 * 1024) : 0;
  const availableGb = avail ? Math.round((avail / (1024 * 1024 * 1024)) * 1000) / 1000 : 0;
  const bufferBeforeLimitGb = Number(storageLimitGb) > 0 ? Math.max(0, Math.round((totalGb - Number(storageLimitGb)) * 1000) / 1000) : 0;
  const sampleMovieTokens = {
    title: 'Run Ronnie Run',
    year: '2002',
    quality: '1080p',
    resolution: '1080p',
    lang: 'en',
    type: 'movie',
  };
  const sampleSeriesTokens = {
    title: 'Breaking Bad',
    year: '2008',
    quality: '1080p',
    resolution: '1080p',
    season: '01',
    episode: '03',
    lang: 'en',
    type: 'series',
  };

  const notes = [
    {
      title: 'Purpose',
      items: [
        'Controls AutoDownload policy and safety rules (schedule, size limits, storage guardrail, file cleanup rules).',
        'Does not include torrent search or piracy features; jobs are managed/authorized sources only.',
      ],
    },
    {
      title: 'Schedule',
      items: ['AutoDownload runs only on the selected days/time window in the chosen timezone.', 'Keep the window small to reduce load.'],
    },
    {
      title: 'Watchfolder scanning',
      items: [
        'After items are moved to Final folders, the system sets a pending flag (Movies/Series).',
        'A scheduler triggers XUI scans only when pending and cooldown is satisfied.',
      ],
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">AutoDownload Settings</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Policy, schedule, and rules for the ingestion pipeline. No torrent search/downloader is included.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="AutoDownload Settings — Notes" sections={notes} />
          <button
            onClick={load}
            disabled={loading || busy}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {!(editCoreOpen || editLimitsOpen || editFileRulesOpen) && err ? (
        <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
      ) : null}
      {!(editCoreOpen || editLimitsOpen || editFileRulesOpen) && ok ? (
        <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{ok}</div>
      ) : null}

      {validationErrors.length ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-black data-[theme=dark]:text-red-200">
          <div className="font-semibold">Fix these before saving:</div>
          <ul className="mt-2 list-disc pl-5">
            {validationErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Enable & Schedule</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Master switches + schedule window.</div>
            </div>
            <EditIconButton onClick={() => setEditCoreOpen(true)} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Enabled</div>
              <div className="mt-1 text-sm font-semibold">{enabled ? 'Yes' : 'No'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Movies: {moviesEnabled ? 'On' : 'Off'} • Series: {seriesEnabled ? 'On' : 'Off'}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Schedule</div>
              <div className="mt-1 text-sm font-semibold">{`${startTime}–${endTime}`}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                TZ: {tz || '—'} • Days: {Array.isArray(days) ? days.length : 0}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Limits & Timeouts</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Storage guardrail, timeout checker, cleaning, and release hold.</div>
            </div>
            <EditIconButton onClick={() => setEditLimitsOpen(true)} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Storage limit</div>
              <div className="mt-1 text-sm font-semibold">{storageLimitGb ? `${storageLimitGb} GB used` : '—'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Current: {usedPct === null ? '—' : `${usedPct}%`} • Free before limit: {bufferBeforeLimitGb.toFixed(1)} GB
              </div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Download checker</div>
              <div className="mt-1 text-sm font-semibold">{timeoutEnabled ? `Enabled (${maxWaitHours}h max)` : 'Disabled'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Deletes stalled jobs that exceed the timeout window.</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">AutoDelete</div>
              <div className="mt-1 text-sm font-semibold">Moved to AutoDelete Settings</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Use the AutoDelete navigation to edit deletion trigger, delay, and protection windows.</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Cleaning</div>
              <div className="mt-1 text-sm font-semibold">{cleaningEnabled ? 'Enabled' : 'Disabled'}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Completed items are cleaned sequentially on every scheduler tick.</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Release delay</div>
              <div className="mt-1 text-sm font-semibold">{releaseDelayDays} day(s)</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Timezone: {DEFAULT_TIMEZONE}</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 sm:col-span-2">
              <div className="text-xs text-[var(--admin-muted)]">Selection rules + strategies</div>
              <div className="mt-1 text-sm font-semibold">Moved to Selection Log Settings</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Movie size/seeders and Movie Selection Strategy now live on Movie Selection Log Settings. Series episode size/seeders, replacement rules, and Series Selection Strategy now live on Series Selection Log Settings.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">File Rules</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Extensions, subtitle policy, and sample skipping.</div>
            </div>
            <EditIconButton onClick={() => setEditFileRulesOpen(true)} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Video extensions</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">{parseExtList(videoExtsText).join(', ') || '—'}</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">Subtitle extensions</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">{parseExtList(subExtsText).join(', ') || '—'}</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 sm:col-span-2">
              <div className="text-xs text-[var(--admin-muted)]">Skip sample content</div>
              <div className="mt-1 text-sm font-semibold">{skipSample ? 'Enabled' : 'Disabled'}</div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 sm:col-span-2">
              <div className="text-xs text-[var(--admin-muted)]">Create movie folder if missing</div>
              <div className="mt-1 text-sm font-semibold">{createMovieFolderIfMissing ? 'Enabled' : 'Disabled'}</div>
            </div>
          </div>
        </div>

      </div>

      <EditModal
        open={editCoreOpen}
        title="Edit Enable & Schedule"
        description="Master switches and schedule window."
        error={err}
        success={ok}
        onCancel={async () => {
          setEditCoreOpen(false);
          await load();
        }}
        onSave={async () => {
          await save();
          setEditCoreOpen(false);
        }}
        saveDisabled={loading || busy || !canSave}
        saving={busy}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Enable AutoDownload">
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>{enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>
          <Field label="Enable Movies">
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input type="checkbox" checked={moviesEnabled} onChange={(e) => setMoviesEnabled(e.target.checked)} />
              <span>{moviesEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>
          <Field label="Enable Series">
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input type="checkbox" checked={seriesEnabled} onChange={(e) => setSeriesEnabled(e.target.checked)} />
              <span>{seriesEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Schedule</div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Timezone" hint="IANA timezone name">
              <Input list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Asia/Manila" />
              <datalist id="tz-list">
                {timezones.slice(0, 600).map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
            <Field label="Start time">
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End time">
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>

          <div className="mt-4">
            <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-[var(--admin-text)]">
              Days of week
              <HelpTooltip text="AutoDownload runs only on these days (in the selected timezone)." />
            </div>
            <div className="flex flex-wrap gap-2">
              {dayItems.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDay(d.id)}
                  className={cx(
                    'rounded-lg border px-3 py-2 text-sm transition',
                    days.includes(d.id)
                      ? 'border-[--brand]/30 bg-[var(--admin-active-bg)] text-[var(--admin-text)]'
                      : 'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-muted)] hover:bg-black/10 hover:text-[var(--admin-text)]'
                  )}
                  style={days.includes(d.id) ? { borderColor: 'color-mix(in srgb, var(--brand) 30%, transparent)' } : undefined}
                >
                  <span className="inline-flex items-center gap-2">
                    {days.includes(d.id) ? (
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="opacity-90">
                        <path
                          fillRule="evenodd"
                          d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : null}
                    {d.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </EditModal>

      <EditModal
        open={editLimitsOpen}
        title="Edit Limits & Timeouts"
        description="Storage guardrail, timeout checker, cleaning, and release hold."
        error={err}
        success={ok}
        onCancel={async () => {
          setEditLimitsOpen(false);
          await load();
        }}
        onSave={async () => {
          await save();
          setEditLimitsOpen(false);
        }}
        saveDisabled={loading || busy || !canSave}
        saving={busy}
      >
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Storage guardrail</div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Storage limit (GB used)" hint="Pause new jobs when NAS usage reaches this amount">
              <Input
                type="number"
                min={1}
                value={storageLimitGb}
                onChange={(e) => setStorageLimitGb(Number(e.target.value || 0))}
              />
            </Field>
            <div className="md:col-span-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">Current NAS usage</div>
                <Pill ok={Boolean(mountStatus?.ok)} label={mountStatus?.ok ? 'Mounted & writable' : 'Not ready'} />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-[var(--admin-muted)]">Used</div>
                  <div className="mt-1 font-mono text-xs">{fmtBytes(used)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--admin-muted)]">Total</div>
                  <div className="mt-1 font-mono text-xs">{fmtBytes(total)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--admin-muted)]">Used %</div>
                  <div className="mt-1 font-mono text-xs">{usedPct === null ? '—' : `${usedPct}%`}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--admin-muted)]">Available</div>
                  <div className="mt-1 font-mono text-xs">{availableGb ? `${availableGb.toFixed(1)} GB` : '—'}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-[var(--admin-muted)]">
                Last checked: {mountStatus?.checkedAt ? new Date(mountStatus.checkedAt).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="text-sm font-semibold">Download checker</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Enable Download Checker" hint="Deletes jobs that exceed max hours">
                <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                  <input type="checkbox" checked={timeoutEnabled} onChange={(e) => setTimeoutEnabled(e.target.checked)} />
                  <span>{timeoutEnabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </Field>
              <Field label="Max time before delete (hours)">
                <Input type="number" min={1} max={168} value={maxWaitHours} onChange={(e) => setMaxWaitHours(Number(e.target.value || 6))} />
              </Field>
            </div>
            <div className="mt-2 text-xs text-[var(--admin-muted)]">On timeout: delete job and delete files (fixed behavior).</div>
            <div className="mt-4 text-sm font-semibold">Cleaning</div>
            <div className="mt-4 grid gap-4 md:grid-cols-1">
              <Field label="Enable Cleaning" hint="If disabled, completed items wait until manual process">
                <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                  <input type="checkbox" checked={cleaningEnabled} onChange={(e) => setCleaningEnabled(e.target.checked)} />
                  <span>{cleaningEnabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </Field>
            </div>
            <div className="mt-2 text-xs text-[var(--admin-muted)]">Cleaner runs on every scheduler tick and processes all completed items sequentially.</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Release delay (days)" hint="Default release date offset from selection run">
                <Input
                  type="number"
                  min={0}
                  max={30}
                  value={releaseDelayDays}
                  onChange={(e) => setReleaseDelayDays(Number(e.target.value || 3))}
                />
              </Field>
              <Field label="Release timezone">
                <Input value={DEFAULT_TIMEZONE} disabled />
              </Field>
            </div>
          </div>
        </div>
      </EditModal>

      <EditModal
        open={editFileRulesOpen}
        title="Edit File Rules"
        description="Cleanup rules applied during processing."
        error={err}
        success={ok}
        onCancel={async () => {
          setEditFileRulesOpen(false);
          await load();
        }}
        onSave={async () => {
          await save();
          setEditFileRulesOpen(false);
        }}
        saveDisabled={loading || busy || !canSave}
        saving={busy}
      >
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">File rules</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Allowed video extensions" hint="Comma or space separated (no dots)">
              <Textarea value={videoExtsText} onChange={(e) => setVideoExtsText(e.target.value)} />
            </Field>
            <Field label="Allowed subtitle extensions" hint="Comma or space separated (no dots)">
              <Textarea value={subExtsText} onChange={(e) => setSubExtsText(e.target.value)} />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm">
              <div className="font-medium">Subtitle languages</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Keep only English (<code>eng|english|en</code>) and Tagalog/Filipino (<code>tag|fil|filipino|tl</code>).
              </div>
            </div>
            <Field label="Skip sample content" hint='Filename/folder contains "sample"'>
              <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                <input type="checkbox" checked={skipSample} onChange={(e) => setSkipSample(e.target.checked)} />
                <span>{skipSample ? 'Enabled' : 'Disabled'}</span>
              </label>
            </Field>
            <Field label="Create movie folder if missing" hint="Wrap loose movie files into a folder during cleaning">
              <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={createMovieFolderIfMissing}
                  onChange={(e) => setCreateMovieFolderIfMissing(e.target.checked)}
                />
                <span>{createMovieFolderIfMissing ? 'Enabled' : 'Disabled'}</span>
              </label>
            </Field>
          </div>
          <div className="mt-6 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <div className="text-sm font-semibold">Cleaning templates</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Tokens you can use: <code>{'{title}'}</code>, <code>{'{year}'}</code>, <code>{'{quality}'}</code>, <code>{'{resolution}'}</code>, <code>{'{type}'}</code>, <code>{'{lang}'}</code>, <code>{'{season}'}</code>, <code>{'{episode}'}</code>.
            </div>
            <div className="mt-3 text-xs text-[var(--admin-muted)]">
              Tips: avoid <code>/</code> and <code>\</code> in templates; preview updates instantly.
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="text-sm font-semibold">Movie templates</div>
                <div className="mt-3 grid gap-4">
                  <Field label="Movie folder template" hint="Used under Cleaned and Ready/Reldate...">
                    <Input value={movieFolderTemplate} onChange={(e) => setMovieFolderTemplate(e.target.value)} />
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Sample: <code>{renderTemplatePreview(movieFolderTemplate, sampleMovieTokens, 'Run Ronnie Run (2002)-1080p')}</code>
                    </div>
                  </Field>
                  <Field label="Movie file template" hint="Video filename (extension appended automatically)">
                    <Input value={movieFileTemplate} onChange={(e) => setMovieFileTemplate(e.target.value)} />
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Sample: <code>{renderTemplatePreview(movieFileTemplate, sampleMovieTokens, 'Run Ronnie Run (2002)-1080p')}.mkv</code>
                    </div>
                  </Field>
                  <Field label="Movie subtitle template" hint="Subtitle filename (extension appended automatically)">
                    <Input value={movieSubtitleTemplate} onChange={(e) => setMovieSubtitleTemplate(e.target.value)} />
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Sample: <code>{renderTemplatePreview(movieSubtitleTemplate, sampleMovieTokens, 'Run Ronnie Run (2002)-1080p.en')}.srt</code>
                    </div>
                  </Field>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="text-sm font-semibold">Series templates</div>
                <div className="mt-3 grid gap-4">
                  <Field label="Series folder template" hint="Used under Cleaned and Ready/Reldate...">
                    <Input value={seriesFolderTemplate} onChange={(e) => setSeriesFolderTemplate(e.target.value)} />
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Sample: <code>{renderTemplatePreview(seriesFolderTemplate, sampleSeriesTokens, 'Breaking Bad (2008)')}</code>
                    </div>
                  </Field>
                  <Field label="Series season folder template" hint="Season folder inside series folder">
                    <Input value={seriesSeasonFolderTemplate} onChange={(e) => setSeriesSeasonFolderTemplate(e.target.value)} />
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Sample: <code>{renderTemplatePreview(seriesSeasonFolderTemplate, sampleSeriesTokens, 'Season 01')}</code>
                    </div>
                  </Field>
                  <Field label="Series episode template" hint="Video filename for episodes">
                    <Input value={seriesEpisodeTemplate} onChange={(e) => setSeriesEpisodeTemplate(e.target.value)} />
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Sample: <code>{renderTemplatePreview(seriesEpisodeTemplate, sampleSeriesTokens, 'Breaking Bad - S01E03')}.mkv</code>
                    </div>
                  </Field>
                  <Field label="Series subtitle template" hint="Subtitle filename for episodes">
                    <Input value={seriesSubtitleTemplate} onChange={(e) => setSeriesSubtitleTemplate(e.target.value)} />
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Sample: <code>{renderTemplatePreview(seriesSubtitleTemplate, sampleSeriesTokens, 'Breaking Bad - S01E03.en')}.srt</code>
                    </div>
                  </Field>
                </div>
              </div>
            </div>
          </div>
        </div>
      </EditModal>

    </div>
  );
}
