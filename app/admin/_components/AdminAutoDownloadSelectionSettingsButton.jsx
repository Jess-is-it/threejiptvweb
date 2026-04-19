'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Settings2 } from 'lucide-react';

import EditModal from './EditModal';
import HelpTooltip from './HelpTooltip';

function cx(...cls) {
  return cls.filter(Boolean).join(' ');
}

function Field({ label, hint, children }) {
  const infoText = String(hint || '').trim();
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-sm font-medium text-[var(--admin-text)]">{label}</label>
        {infoText ? <HelpTooltip text={infoText} /> : null}
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

function NoteBox({ title = 'Notes', items = [] }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-[var(--admin-text)]">
      <div className="font-semibold">{title}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--admin-muted)]">
        {list.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const STRATEGY_DEFAULTS = {
  movie: {
    recentMonthsRange: 5,
    classicYearStart: 1996,
    classicYearEnd: 2012,
    recentAnimationCount: 1,
    recentLiveActionCount: 3,
    classicAnimationCount: 1,
    classicLiveActionCount: 3,
  },
  series: {
    recentMonthsRange: 12,
    classicYearStart: 1990,
    classicYearEnd: 2018,
    recentAnimationCount: 1,
    recentLiveActionCount: 2,
    classicAnimationCount: 1,
    classicLiveActionCount: 2,
  },
};

const SERIES_PIPELINE_KEYS = ['newSeries', 'newSeriesEpisode', 'existingSeries', 'deferredRetry'];

const SERIES_PIPELINE_SIZE_FIELDS = {
  newSeries: { episode: false, season: true },
  newSeriesEpisode: { episode: true, season: false },
  existingSeries: { episode: true, season: false },
  deferredRetry: { episode: true, season: true },
};

const SERIES_PIPELINE_LABELS = {
  newSeries: {
    title: 'New Series Season Pack',
    tabLabel: 'New S1 Pack',
    modeLabel: 'Season 1 pack',
    description: 'For shows not yet found in the NAS library. Downloads a healthy Season 1 pack.',
    notes: [
      'Use this for shows that do not exist yet in the final NAS series library.',
      'The selector searches enabled series sources by IMDb id and accepts Season 1 packs only.',
      'Max season size is enforced against the selected pack. Episode size is not used by this pipeline.',
      'If large season packs keep stalling, raise min seeders or lower max season size before increasing counts.',
    ],
  },
  newSeriesEpisode: {
    title: 'New Series Episode Bootstrap',
    tabLabel: 'New Episode',
    modeLabel: 'First Season 1 episode',
    description: 'For shows not yet found in the NAS library. Downloads one Season 1 episode only.',
    notes: [
      'Use this when Season 1 packs are too large, weakly seeded, or frequently unfinished.',
      'The selector targets the first aired Season 1 episode and applies the max episode size limit.',
      'After that first episode reaches the NAS, Existing Series Continuation controls whether future missing episodes are added.',
      'Keep this enabled and disable New S1 Pack if you prefer slow, episode-by-episode onboarding.',
    ],
  },
  existingSeries: {
    title: 'Existing Series Continuation',
    tabLabel: 'Existing Series',
    modeLabel: 'Next missing episode',
    description: 'For shows already in the NAS library. Downloads the next missing episode only.',
    notes: [
      'Use this only when you want AutoDownload to continue shows already present in the final NAS series library.',
      'The selector scans existing files for SxxEyy or 1x02 tags and compares them against aired TMDB episodes.',
      'Only one next missing episode is queued per selected show, which avoids oversized season packs for weakly seeded shows.',
      'Max episode size is enforced. Season-pack size is not used by this pipeline.',
      'Keep this disabled if the Series Selection Log should only bootstrap brand-new shows.',
    ],
  },
  deferredRetry: {
    title: 'Deferred / Replacement Retry',
    tabLabel: 'Retry',
    modeLabel: 'Replacement retry',
    description: 'Used by timeout and replacement flows with stricter source gates.',
    notes: [
      'Used when timeout, replacement, deferred, or retry selection runs are triggered.',
      'Defaults are stricter so failed downloads do not immediately recycle another weak source.',
      'Disabling this prevents automatic retry selections after failed replacement flows.',
      'Timeout and size limits here are captured onto new retry queue rows when they are created.',
    ],
  },
};

const SERIES_SETTINGS_TABS = [
  { key: 'overview', label: 'Overview' },
  ...SERIES_PIPELINE_KEYS.map((key) => ({ key, label: SERIES_PIPELINE_LABELS[key].tabLabel })),
];

const SERIES_OVERVIEW_NOTES = [
  'At least one normal pipeline must stay enabled: New S1 Pack, New Episode, or Existing Series.',
  'Each pipeline has its own selection strategy, source gates, relevant max size, and timeout.',
  'Season-pack pipelines show max season size. Episode pipelines show max episode size.',
  'Selection counts decide how many TMDB titles a pipeline tries per cycle; source gates decide whether a title is actually queued.',
  'Pipeline timeout values are saved onto new queue rows. Existing queued rows keep the timeout captured when they were created.',
  'Strict replacement settings affect failed replacement cleanup only; they do not change normal pipeline selection counts.',
];

const SERIES_PIPELINE_DEFAULTS = {
  newSeries: {
    enabled: true,
    minSeeders: 8,
    maxEpisodeGb: 2.5,
    maxSeasonTotalGb: 14,
    timeoutHours: 24,
    strategy: STRATEGY_DEFAULTS.series,
  },
  newSeriesEpisode: {
    enabled: false,
    minSeeders: 8,
    maxEpisodeGb: 2.5,
    maxSeasonTotalGb: 14,
    timeoutHours: 12,
    strategy: STRATEGY_DEFAULTS.series,
  },
  existingSeries: {
    enabled: false,
    minSeeders: 5,
    maxEpisodeGb: 2.5,
    maxSeasonTotalGb: 8,
    timeoutHours: 12,
    strategy: STRATEGY_DEFAULTS.series,
  },
  deferredRetry: {
    enabled: true,
    minSeeders: 10,
    maxEpisodeGb: 2,
    maxSeasonTotalGb: 10,
    timeoutHours: 12,
    strategy: STRATEGY_DEFAULTS.series,
  },
};

function normalizeSeriesPipelines(value, fallbackStrategy = STRATEGY_DEFAULTS.series) {
  const source = value && typeof value === 'object' ? value : {};
  return SERIES_PIPELINE_KEYS.reduce((acc, key) => {
    const defaults = SERIES_PIPELINE_DEFAULTS[key];
    const incoming = source?.[key] && typeof source[key] === 'object' ? source[key] : {};
    const strategy = incoming.strategy && typeof incoming.strategy === 'object' ? incoming.strategy : fallbackStrategy;
    acc[key] = {
      enabled: incoming.enabled === undefined ? defaults.enabled : Boolean(incoming.enabled),
      minSeeders: String(incoming.minSeeders ?? defaults.minSeeders),
      maxEpisodeGb: String(incoming.maxEpisodeGb ?? defaults.maxEpisodeGb),
      maxSeasonTotalGb: String(incoming.maxSeasonTotalGb ?? defaults.maxSeasonTotalGb),
      timeoutHours: String(incoming.timeoutHours ?? defaults.timeoutHours),
      strategy: {
        recentMonthsRange: String(strategy.recentMonthsRange ?? defaults.strategy.recentMonthsRange),
        classicYearStart: String(strategy.classicYearStart ?? defaults.strategy.classicYearStart),
        classicYearEnd: String(strategy.classicYearEnd ?? defaults.strategy.classicYearEnd),
        recentAnimationCount: String(strategy.recentAnimationCount ?? defaults.strategy.recentAnimationCount),
        recentLiveActionCount: String(strategy.recentLiveActionCount ?? defaults.strategy.recentLiveActionCount),
        classicAnimationCount: String(strategy.classicAnimationCount ?? defaults.strategy.classicAnimationCount),
        classicLiveActionCount: String(strategy.classicLiveActionCount ?? defaults.strategy.classicLiveActionCount),
      },
    };
    return acc;
  }, {});
}

function pipelineUsesEpisodeSize(key) {
  return SERIES_PIPELINE_SIZE_FIELDS[key]?.episode !== false;
}

function pipelineUsesSeasonSize(key) {
  return SERIES_PIPELINE_SIZE_FIELDS[key]?.season !== false;
}

export default function AdminAutoDownloadSelectionSettingsButton({ type = 'movie', onSaved = null }) {
  const selectionType = type === 'series' ? 'series' : 'movie';
  const titleLabel = selectionType === 'series' ? 'Series Selection Log Settings' : 'Movie Selection Log Settings';
  const buttonTitle = selectionType === 'series' ? 'Edit Series Selection Log settings' : 'Edit Movie Selection Log settings';
  const strategyDefaults = STRATEGY_DEFAULTS[selectionType];

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [maxMovieGb, setMaxMovieGb] = useState('2.5');
  const [minMovieSeeders, setMinMovieSeeders] = useState('1');
  const [strictSeriesReplacement, setStrictSeriesReplacement] = useState(true);
  const [deletePartialSeriesOnReplacementFailure, setDeletePartialSeriesOnReplacementFailure] = useState(true);
  const [recentMonthsRange, setRecentMonthsRange] = useState(String(strategyDefaults.recentMonthsRange));
  const [classicYearStart, setClassicYearStart] = useState(String(strategyDefaults.classicYearStart));
  const [classicYearEnd, setClassicYearEnd] = useState(String(strategyDefaults.classicYearEnd));
  const [recentAnimationCount, setRecentAnimationCount] = useState(String(strategyDefaults.recentAnimationCount));
  const [recentLiveActionCount, setRecentLiveActionCount] = useState(String(strategyDefaults.recentLiveActionCount));
  const [classicAnimationCount, setClassicAnimationCount] = useState(String(strategyDefaults.classicAnimationCount));
  const [classicLiveActionCount, setClassicLiveActionCount] = useState(String(strategyDefaults.classicLiveActionCount));
  const [seriesPipelines, setSeriesPipelines] = useState(() => normalizeSeriesPipelines(null, STRATEGY_DEFAULTS.series));
  const [activeSeriesTab, setActiveSeriesTab] = useState('overview');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/admin/autodownload/settings', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Failed to load selection settings.');
      const settings = payload?.settings || {};
      const strategy =
        selectionType === 'movie'
          ? settings?.movieSelectionStrategy || STRATEGY_DEFAULTS.movie
          : settings?.seriesSelectionStrategy || STRATEGY_DEFAULTS.series;
      setMaxMovieGb(String(settings?.sizeLimits?.maxMovieGb ?? 2.5));
      setMinMovieSeeders(String(Math.max(0, Number(settings?.sourceFilters?.minMovieSeeders ?? 1) || 0)));
      setStrictSeriesReplacement(settings?.timeoutChecker?.strictSeriesReplacement !== false);
      setDeletePartialSeriesOnReplacementFailure(settings?.timeoutChecker?.deletePartialSeriesOnReplacementFailure !== false);
      setSeriesPipelines(normalizeSeriesPipelines(settings?.seriesPipelines, strategy));
      setRecentMonthsRange(String(strategy?.recentMonthsRange ?? strategyDefaults.recentMonthsRange));
      setClassicYearStart(String(strategy?.classicYearStart ?? strategyDefaults.classicYearStart));
      setClassicYearEnd(String(strategy?.classicYearEnd ?? strategyDefaults.classicYearEnd));
      setRecentAnimationCount(String(strategy?.recentAnimationCount ?? strategyDefaults.recentAnimationCount));
      setRecentLiveActionCount(String(strategy?.recentLiveActionCount ?? strategyDefaults.recentLiveActionCount));
      setClassicAnimationCount(String(strategy?.classicAnimationCount ?? strategyDefaults.classicAnimationCount));
      setClassicLiveActionCount(String(strategy?.classicLiveActionCount ?? strategyDefaults.classicLiveActionCount));
    } catch (nextError) {
      setError(nextError?.message || 'Failed to load selection settings.');
    } finally {
      setLoading(false);
    }
  }, [selectionType, strategyDefaults]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  useEffect(() => {
    if (open && selectionType === 'series') setActiveSeriesTab('overview');
  }, [open, selectionType]);

  const updateSeriesPipeline = (key, patch) => {
    setSeriesPipelines((prev) => ({
      ...prev,
      [key]: {
        ...(prev?.[key] || SERIES_PIPELINE_DEFAULTS[key]),
        ...patch,
      },
    }));
  };

  const updateSeriesPipelineStrategy = (key, field, value) => {
    setSeriesPipelines((prev) => ({
      ...prev,
      [key]: {
        ...(prev?.[key] || SERIES_PIPELINE_DEFAULTS[key]),
        strategy: {
          ...((prev?.[key] || SERIES_PIPELINE_DEFAULTS[key]).strategy || {}),
          [field]: value,
        },
      },
    }));
  };

  const validationErrors = useMemo(() => {
    const nextErrors = [];
    if (selectionType === 'movie') {
      const parsedMaxMovieGb = Number(maxMovieGb);
      const parsedMinMovieSeeders = Number(minMovieSeeders);
      const parsedRecentMonthsRange = Number(recentMonthsRange);
      const parsedClassicYearStart = Number(classicYearStart);
      const parsedClassicYearEnd = Number(classicYearEnd);
      const parsedRecentAnimationCount = Number(recentAnimationCount);
      const parsedRecentLiveActionCount = Number(recentLiveActionCount);
      const parsedClassicAnimationCount = Number(classicAnimationCount);
      const parsedClassicLiveActionCount = Number(classicLiveActionCount);
      if (!Number.isFinite(parsedMaxMovieGb) || parsedMaxMovieGb <= 0) nextErrors.push('Max movie size must be greater than 0.');
      if (!Number.isFinite(parsedMinMovieSeeders) || parsedMinMovieSeeders < 0) nextErrors.push('Min movie seeders must be 0 or greater.');
      if (!Number.isFinite(parsedRecentMonthsRange) || parsedRecentMonthsRange < 1) {
        nextErrors.push('Recent months range must be 1 or greater.');
      }
      if (!Number.isFinite(parsedClassicYearStart) || parsedClassicYearStart < 1900 || parsedClassicYearStart > 2100) {
        nextErrors.push('Classic year start must be between 1900 and 2100.');
      }
      if (!Number.isFinite(parsedClassicYearEnd) || parsedClassicYearEnd < 1900 || parsedClassicYearEnd > 2100) {
        nextErrors.push('Classic year end must be between 1900 and 2100.');
      }
      if (Number.isFinite(parsedClassicYearStart) && Number.isFinite(parsedClassicYearEnd) && parsedClassicYearStart >= parsedClassicYearEnd) {
        nextErrors.push('Classic year start must be less than classic year end.');
      }
      if (
        !Number.isFinite(parsedRecentAnimationCount) ||
        !Number.isFinite(parsedRecentLiveActionCount) ||
        !Number.isFinite(parsedClassicAnimationCount) ||
        !Number.isFinite(parsedClassicLiveActionCount)
      ) {
        nextErrors.push('Selection counts must be valid numbers.');
      } else if (
        parsedRecentAnimationCount +
          parsedRecentLiveActionCount +
          parsedClassicAnimationCount +
          parsedClassicLiveActionCount <=
        0
      ) {
        nextErrors.push('At least one selection count must be greater than 0.');
      }
    } else {
      const activeNormal = ['newSeries', 'newSeriesEpisode', 'existingSeries'].filter((key) => seriesPipelines?.[key]?.enabled);
      if (!activeNormal.length) nextErrors.push('Enable at least one normal series pipeline.');
      for (const key of SERIES_PIPELINE_KEYS) {
        const label = SERIES_PIPELINE_LABELS[key].title;
        const pipe = seriesPipelines?.[key] || {};
        const strategy = pipe.strategy || {};
        const minSeedersValue = Number(pipe.minSeeders);
        const maxEpisodeValue = Number(pipe.maxEpisodeGb);
        const maxSeasonValue = Number(pipe.maxSeasonTotalGb);
        const timeoutValue = Number(pipe.timeoutHours);
        const recentMonthsValue = Number(strategy.recentMonthsRange);
        const classicStartValue = Number(strategy.classicYearStart);
        const classicEndValue = Number(strategy.classicYearEnd);
        const counts = [
          Number(strategy.recentAnimationCount),
          Number(strategy.recentLiveActionCount),
          Number(strategy.classicAnimationCount),
          Number(strategy.classicLiveActionCount),
        ];
        if (!Number.isFinite(minSeedersValue) || minSeedersValue < 0) nextErrors.push(`${label}: min seeders must be 0 or greater.`);
        if (pipelineUsesEpisodeSize(key) && (!Number.isFinite(maxEpisodeValue) || maxEpisodeValue <= 0)) {
          nextErrors.push(`${label}: max episode size must be greater than 0.`);
        }
        if (pipelineUsesSeasonSize(key) && (!Number.isFinite(maxSeasonValue) || maxSeasonValue <= 0)) {
          nextErrors.push(`${label}: max season total size must be greater than 0.`);
        }
        if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) nextErrors.push(`${label}: timeout hours must be greater than 0.`);
        if (!Number.isFinite(recentMonthsValue) || recentMonthsValue < 1) nextErrors.push(`${label}: recent months range must be 1 or greater.`);
        if (!Number.isFinite(classicStartValue) || !Number.isFinite(classicEndValue) || classicStartValue >= classicEndValue) {
          nextErrors.push(`${label}: classic year start must be less than classic year end.`);
        }
        if (counts.some((value) => !Number.isFinite(value) || value < 0)) {
          nextErrors.push(`${label}: selection counts must be 0 or greater.`);
        } else if (counts.reduce((sum, value) => sum + value, 0) <= 0) {
          nextErrors.push(`${label}: at least one selection count must be greater than 0.`);
        }
      }
    }
    return nextErrors;
  }, [
    classicAnimationCount,
    classicLiveActionCount,
    classicYearEnd,
    classicYearStart,
    maxMovieGb,
    minMovieSeeders,
    recentAnimationCount,
    recentLiveActionCount,
    recentMonthsRange,
    selectionType,
    seriesPipelines,
  ]);

  const save = async () => {
    if (validationErrors.length) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const selectionStrategy = {
        recentMonthsRange: Math.max(1, Math.floor(Number(recentMonthsRange) || strategyDefaults.recentMonthsRange)),
        classicYearStart: Math.max(1900, Math.min(2100, Math.floor(Number(classicYearStart) || strategyDefaults.classicYearStart))),
        classicYearEnd: Math.max(1900, Math.min(2100, Math.floor(Number(classicYearEnd) || strategyDefaults.classicYearEnd))),
        recentAnimationCount: Math.max(0, Math.floor(Number(recentAnimationCount) || 0)),
        recentLiveActionCount: Math.max(0, Math.floor(Number(recentLiveActionCount) || 0)),
        classicAnimationCount: Math.max(0, Math.floor(Number(classicAnimationCount) || 0)),
        classicLiveActionCount: Math.max(0, Math.floor(Number(classicLiveActionCount) || 0)),
      };
      const normalizedSeriesPipelines = SERIES_PIPELINE_KEYS.reduce((acc, key) => {
        const pipe = seriesPipelines?.[key] || SERIES_PIPELINE_DEFAULTS[key];
        const strategy = pipe.strategy || SERIES_PIPELINE_DEFAULTS[key].strategy;
        const maxEpisodeGb = Number(pipe.maxEpisodeGb);
        const maxSeasonTotalGb = Number(pipe.maxSeasonTotalGb);
        acc[key] = {
          enabled: Boolean(pipe.enabled),
          minSeeders: Math.max(0, Math.floor(Number(pipe.minSeeders) || 0)),
          maxEpisodeGb:
            Number.isFinite(maxEpisodeGb) && maxEpisodeGb > 0 ? maxEpisodeGb : SERIES_PIPELINE_DEFAULTS[key].maxEpisodeGb,
          maxSeasonTotalGb:
            Number.isFinite(maxSeasonTotalGb) && maxSeasonTotalGb > 0
              ? maxSeasonTotalGb
              : SERIES_PIPELINE_DEFAULTS[key].maxSeasonTotalGb,
          timeoutHours: Number(pipe.timeoutHours),
          strategy: {
            recentMonthsRange: Math.max(1, Math.floor(Number(strategy.recentMonthsRange) || SERIES_PIPELINE_DEFAULTS[key].strategy.recentMonthsRange)),
            classicYearStart: Math.max(1900, Math.min(2100, Math.floor(Number(strategy.classicYearStart) || SERIES_PIPELINE_DEFAULTS[key].strategy.classicYearStart))),
            classicYearEnd: Math.max(1900, Math.min(2100, Math.floor(Number(strategy.classicYearEnd) || SERIES_PIPELINE_DEFAULTS[key].strategy.classicYearEnd))),
            recentAnimationCount: Math.max(0, Math.floor(Number(strategy.recentAnimationCount) || 0)),
            recentLiveActionCount: Math.max(0, Math.floor(Number(strategy.recentLiveActionCount) || 0)),
            classicAnimationCount: Math.max(0, Math.floor(Number(strategy.classicAnimationCount) || 0)),
            classicLiveActionCount: Math.max(0, Math.floor(Number(strategy.classicLiveActionCount) || 0)),
          },
        };
        return acc;
      }, {});
      const body =
        selectionType === 'movie'
          ? {
              section: 'selection_rules',
              type: 'movie',
              sizeLimits: {
                maxMovieGb: Number(maxMovieGb),
              },
              sourceFilters: {
                minMovieSeeders: Math.max(0, Math.floor(Number(minMovieSeeders) || 0)),
              },
              selectionStrategy,
            }
          : {
              section: 'selection_rules',
              type: 'series',
              seriesPipelines: normalizedSeriesPipelines,
              timeoutChecker: {
                strictSeriesReplacement,
                deletePartialSeriesOnReplacementFailure,
              },
            };

      const response = await fetch('/api/admin/autodownload/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        const list = Array.isArray(payload?.errors) ? payload.errors.join(' ') : '';
        throw new Error(payload?.error ? `${payload.error}${list ? ` ${list}` : ''}` : 'Failed to save selection settings.');
      }
      setSuccess('Saved.');
      await onSaved?.(payload?.settings || null);
      setOpen(false);
    } catch (nextError) {
      setError(nextError?.message || 'Failed to save selection settings.');
    } finally {
      setSaving(false);
    }
  };

  const renderSeriesPipelineSummary = (key) => {
    const meta = SERIES_PIPELINE_LABELS[key];
    const pipe = seriesPipelines?.[key] || SERIES_PIPELINE_DEFAULTS[key];
    const strategy = pipe.strategy || SERIES_PIPELINE_DEFAULTS[key].strategy;
    const totalCount =
      Number(strategy.recentAnimationCount || 0) +
      Number(strategy.recentLiveActionCount || 0) +
      Number(strategy.classicAnimationCount || 0) +
      Number(strategy.classicLiveActionCount || 0);
    return (
      <button
        key={key}
        type="button"
        onClick={() => setActiveSeriesTab(key)}
        className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-left transition hover:border-[--brand]/50"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--admin-text)]">{meta.tabLabel}</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">{meta.modeLabel}</div>
          </div>
          <span
            className={cx(
              'rounded-full px-2 py-1 text-[11px] font-semibold',
              pipe.enabled ? 'bg-emerald-500/15 text-emerald-600 data-[theme=dark]:text-emerald-300' : 'bg-zinc-500/15 text-[var(--admin-muted)]'
            )}
          >
            {pipe.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--admin-muted)]">
          <div>Min seeders: {pipe.minSeeders}</div>
          <div>Timeout: {pipe.timeoutHours}h</div>
          {pipelineUsesEpisodeSize(key) ? <div>Episode max: {pipe.maxEpisodeGb} GB</div> : null}
          {pipelineUsesSeasonSize(key) ? <div>Season max: {pipe.maxSeasonTotalGb} GB</div> : null}
          <div className="col-span-2">Cycle target: {Number.isFinite(totalCount) ? totalCount : 0} title(s)</div>
        </div>
      </button>
    );
  };

  const renderSeriesOverview = () => (
    <div className="space-y-4">
      <NoteBox title="Process notes" items={SERIES_OVERVIEW_NOTES} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {SERIES_PIPELINE_KEYS.map((key) => renderSeriesPipelineSummary(key))}
      </div>

      <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Replacement cleanup rules</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            These settings are global for series replacement failures. Pipeline tabs control source selection and timeout behavior.
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Strict series replacement" hint="Require a full replacement set before accepting replacement cleanup">
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={strictSeriesReplacement}
                onChange={(event) => setStrictSeriesReplacement(event.target.checked)}
                disabled={loading}
              />
              <span>{strictSeriesReplacement ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>
          <Field label="Delete partial series on failed replacement" hint="Delete partial downloads when no full replacement source is found">
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={deletePartialSeriesOnReplacementFailure}
                onChange={(event) => setDeletePartialSeriesOnReplacementFailure(event.target.checked)}
                disabled={loading}
              />
              <span>{deletePartialSeriesOnReplacementFailure ? 'Enabled' : 'Disabled'}</span>
            </label>
          </Field>
        </div>
      </div>
    </div>
  );

  const renderSeriesPipelineCard = (key) => {
    const meta = SERIES_PIPELINE_LABELS[key];
    const pipe = seriesPipelines?.[key] || SERIES_PIPELINE_DEFAULTS[key];
    const strategy = pipe.strategy || SERIES_PIPELINE_DEFAULTS[key].strategy;
    return (
      <div key={key} className="space-y-4">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold text-[var(--admin-text)]">{meta.title}</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">{meta.description}</div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(pipe.enabled)}
                onChange={(event) => updateSeriesPipeline(key, { enabled: event.target.checked })}
                disabled={loading}
              />
              <span>{pipe.enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
        </div>

        <NoteBox title={`${meta.tabLabel} notes`} items={meta.notes} />

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Source gates and timeout</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            These limits apply only to rows created by this pipeline. Only the size limit used by this pipeline is shown.
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Field label="Min seeders" hint="Reject sources below this seeder count">
              <Input
                type="number"
                min={0}
                step="1"
                value={pipe.minSeeders}
                onChange={(event) => updateSeriesPipeline(key, { minSeeders: event.target.value })}
                disabled={loading}
              />
            </Field>
            {pipelineUsesEpisodeSize(key) ? (
              <Field label="Max episode size (GB)" hint="Used for individual episode sources">
                <Input
                  type="number"
                  min={0.05}
                  step="0.05"
                  value={pipe.maxEpisodeGb}
                  onChange={(event) => updateSeriesPipeline(key, { maxEpisodeGb: event.target.value })}
                  disabled={loading}
                />
              </Field>
            ) : null}
            {pipelineUsesSeasonSize(key) ? (
              <Field label="Max season size (GB)" hint="Used for Season 1 pack sources">
                <Input
                  type="number"
                  min={0.1}
                  step="0.1"
                  value={pipe.maxSeasonTotalGb}
                  onChange={(event) => updateSeriesPipeline(key, { maxSeasonTotalGb: event.target.value })}
                  disabled={loading}
                />
              </Field>
            ) : null}
            <Field label="Timeout hours" hint="Rows from this pipeline time out after this many hours">
              <Input
                type="number"
                min={1}
                max={168}
                step="1"
                value={pipe.timeoutHours}
                onChange={(event) => updateSeriesPipeline(key, { timeoutHours: event.target.value })}
                disabled={loading}
              />
            </Field>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Selection strategy</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Counts are per scheduler cycle for this pipeline. Set all unwanted buckets to 0.
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Recent months" hint="TMDB titles released within this many months are recent">
              <Input
                type="number"
                min={1}
                max={120}
                step="1"
                value={strategy.recentMonthsRange}
                onChange={(event) => updateSeriesPipelineStrategy(key, 'recentMonthsRange', event.target.value)}
                disabled={loading}
              />
            </Field>
            <Field label="Classic start" hint="Oldest release year allowed for classic buckets">
              <Input
                type="number"
                min={1900}
                max={2100}
                step="1"
                value={strategy.classicYearStart}
                onChange={(event) => updateSeriesPipelineStrategy(key, 'classicYearStart', event.target.value)}
                disabled={loading}
              />
            </Field>
            <Field label="Classic end" hint="Newest release year allowed for classic buckets">
              <Input
                type="number"
                min={1900}
                max={2100}
                step="1"
                value={strategy.classicYearEnd}
                onChange={(event) => updateSeriesPipelineStrategy(key, 'classicYearEnd', event.target.value)}
                disabled={loading}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Field label="Recent Animation">
              <Input type="number" min={0} step="1" value={strategy.recentAnimationCount} onChange={(event) => updateSeriesPipelineStrategy(key, 'recentAnimationCount', event.target.value)} disabled={loading} />
            </Field>
            <Field label="Recent Live">
              <Input type="number" min={0} step="1" value={strategy.recentLiveActionCount} onChange={(event) => updateSeriesPipelineStrategy(key, 'recentLiveActionCount', event.target.value)} disabled={loading} />
            </Field>
            <Field label="Classic Animation">
              <Input type="number" min={0} step="1" value={strategy.classicAnimationCount} onChange={(event) => updateSeriesPipelineStrategy(key, 'classicAnimationCount', event.target.value)} disabled={loading} />
            </Field>
            <Field label="Classic Live">
              <Input type="number" min={0} step="1" value={strategy.classicLiveActionCount} onChange={(event) => updateSeriesPipelineStrategy(key, 'classicLiveActionCount', event.target.value)} disabled={loading} />
            </Field>
          </div>
        </div>
      </div>
    );
  };

  const renderSeriesSettingsTabs = () => {
    const activeKey = SERIES_SETTINGS_TABS.some((tab) => tab.key === activeSeriesTab) ? activeSeriesTab : 'overview';
    return (
      <div className="space-y-4">
        <div className="-mx-5 sticky top-0 z-10 bg-[var(--admin-surface)] px-5 pb-4 pt-1">
          <div className="overflow-x-auto rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-1">
            <div className="flex min-w-max gap-1">
              {SERIES_SETTINGS_TABS.map((tab) => {
                const active = tab.key === activeKey;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveSeriesTab(tab.key)}
                    className={cx(
                      'rounded-lg px-4 py-2 text-sm font-medium transition',
                      active
                        ? 'bg-[var(--admin-surface-solid)] text-[var(--admin-text)] shadow-sm'
                        : 'text-[var(--admin-muted)] hover:bg-black/5 hover:text-[var(--admin-text)] data-[theme=dark]:hover:bg-white/5'
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-2 text-[11px] text-[var(--admin-muted)]">
            Tip: Scroll horizontally if tabs are clipped on mobile.
          </div>
        </div>
        {activeKey === 'overview' ? renderSeriesOverview() : renderSeriesPipelineCard(activeKey)}
      </div>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-[var(--admin-muted)] hover:bg-black/10 hover:text-[var(--admin-text)]"
        title={buttonTitle}
        aria-label={buttonTitle}
      >
        <Settings2 size={16} />
      </button>

      <EditModal
        open={open}
        title={titleLabel}
        description={
          selectionType === 'movie'
            ? 'Movie size/seeder gates and Movie Selection Strategy buckets used when building movie selection runs.'
            : 'Series pipeline gates, replacement behavior, and Series Selection Strategy buckets used during automatic series selection.'
        }
        error={error}
        success={success}
        onCancel={() => setOpen(false)}
        onSave={save}
        saveDisabled={loading || saving || validationErrors.length > 0}
        saving={saving}
      >
        {validationErrors.length ? (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-black data-[theme=dark]:text-red-200">
            <div className="font-semibold">Fix these before saving:</div>
            <ul className="mt-2 list-disc pl-5">
              {validationErrors.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {selectionType === 'series' ? (
          renderSeriesSettingsTabs()
        ) : (
          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Max movie size (GB)">
                <Input type="number" min={0.1} step="0.1" value={maxMovieGb} onChange={(event) => setMaxMovieGb(event.target.value)} disabled={loading} />
              </Field>
              <Field label="Min movie seeders">
                <Input type="number" min={0} step="1" value={minMovieSeeders} onChange={(event) => setMinMovieSeeders(event.target.value)} disabled={loading} />
              </Field>
            </div>

            <div className="mt-6 border-t border-[var(--admin-border)] pt-4">
              <div className="text-sm font-semibold text-[var(--admin-text)]">Selection strategy</div>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <Field label="Recent months range">
                  <Input type="number" min={1} max={120} step="1" value={recentMonthsRange} onChange={(event) => setRecentMonthsRange(event.target.value)} disabled={loading} />
                </Field>
                <Field label="Classic year start">
                  <Input type="number" min={1900} max={2100} step="1" value={classicYearStart} onChange={(event) => setClassicYearStart(event.target.value)} disabled={loading} />
                </Field>
                <Field label="Classic year end">
                  <Input type="number" min={1900} max={2100} step="1" value={classicYearEnd} onChange={(event) => setClassicYearEnd(event.target.value)} disabled={loading} />
                </Field>
              </div>

              <div className="mt-4 text-sm font-medium text-[var(--admin-text)]">Counts per cycle</div>
              <div className="mt-3 grid gap-4 md:grid-cols-4">
                <Field label="Recent Animation">
                  <Input type="number" min={0} max={100} step="1" value={recentAnimationCount} onChange={(event) => setRecentAnimationCount(event.target.value)} disabled={loading} />
                </Field>
                <Field label="Recent Live Action">
                  <Input type="number" min={0} max={100} step="1" value={recentLiveActionCount} onChange={(event) => setRecentLiveActionCount(event.target.value)} disabled={loading} />
                </Field>
                <Field label="Classic Animation">
                  <Input type="number" min={0} max={100} step="1" value={classicAnimationCount} onChange={(event) => setClassicAnimationCount(event.target.value)} disabled={loading} />
                </Field>
                <Field label="Classic Live Action">
                  <Input type="number" min={0} max={100} step="1" value={classicLiveActionCount} onChange={(event) => setClassicLiveActionCount(event.target.value)} disabled={loading} />
                </Field>
              </div>
            </div>
          </div>
        )}
      </EditModal>
    </>
  );
}
