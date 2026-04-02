'use client';

import { useEffect, useMemo, useState } from 'react';

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

function normalizeSeriesEpisodeSize(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'null') return '';
  return raw;
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
  const [maxEpisodeGb, setMaxEpisodeGb] = useState('');
  const [minMovieSeeders, setMinMovieSeeders] = useState('1');
  const [minSeriesSeeders, setMinSeriesSeeders] = useState('1');
  const [strictSeriesReplacement, setStrictSeriesReplacement] = useState(true);
  const [deletePartialSeriesOnReplacementFailure, setDeletePartialSeriesOnReplacementFailure] = useState(true);
  const [recentMonthsRange, setRecentMonthsRange] = useState(String(strategyDefaults.recentMonthsRange));
  const [classicYearStart, setClassicYearStart] = useState(String(strategyDefaults.classicYearStart));
  const [classicYearEnd, setClassicYearEnd] = useState(String(strategyDefaults.classicYearEnd));
  const [recentAnimationCount, setRecentAnimationCount] = useState(String(strategyDefaults.recentAnimationCount));
  const [recentLiveActionCount, setRecentLiveActionCount] = useState(String(strategyDefaults.recentLiveActionCount));
  const [classicAnimationCount, setClassicAnimationCount] = useState(String(strategyDefaults.classicAnimationCount));
  const [classicLiveActionCount, setClassicLiveActionCount] = useState(String(strategyDefaults.classicLiveActionCount));

  const load = async () => {
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
      setMaxEpisodeGb(normalizeSeriesEpisodeSize(settings?.sizeLimits?.maxEpisodeGb));
      setMinMovieSeeders(String(Math.max(0, Number(settings?.sourceFilters?.minMovieSeeders ?? 1) || 0)));
      setMinSeriesSeeders(String(Math.max(0, Number(settings?.sourceFilters?.minSeriesSeeders ?? 1) || 0)));
      setStrictSeriesReplacement(settings?.timeoutChecker?.strictSeriesReplacement !== false);
      setDeletePartialSeriesOnReplacementFailure(settings?.timeoutChecker?.deletePartialSeriesOnReplacementFailure !== false);
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
  };

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, selectionType]);

  const validationErrors = useMemo(() => {
    const nextErrors = [];
    const parsedRecentMonthsRange = Number(recentMonthsRange);
    const parsedClassicYearStart = Number(classicYearStart);
    const parsedClassicYearEnd = Number(classicYearEnd);
    const parsedRecentAnimationCount = Number(recentAnimationCount);
    const parsedRecentLiveActionCount = Number(recentLiveActionCount);
    const parsedClassicAnimationCount = Number(classicAnimationCount);
    const parsedClassicLiveActionCount = Number(classicLiveActionCount);
    if (selectionType === 'movie') {
      const parsedMaxMovieGb = Number(maxMovieGb);
      const parsedMinMovieSeeders = Number(minMovieSeeders);
      if (!Number.isFinite(parsedMaxMovieGb) || parsedMaxMovieGb <= 0) nextErrors.push('Max movie size must be greater than 0.');
      if (!Number.isFinite(parsedMinMovieSeeders) || parsedMinMovieSeeders < 0) nextErrors.push('Min movie seeders must be 0 or greater.');
    } else {
      const parsedMinSeriesSeeders = Number(minSeriesSeeders);
      const rawMaxEpisodeGb = String(maxEpisodeGb || '').trim();
      if (rawMaxEpisodeGb) {
        const parsedMaxEpisodeGb = Number(rawMaxEpisodeGb);
        if (!Number.isFinite(parsedMaxEpisodeGb) || parsedMaxEpisodeGb <= 0) nextErrors.push('Max episode size must be greater than 0 when set.');
      }
      if (!Number.isFinite(parsedMinSeriesSeeders) || parsedMinSeriesSeeders < 0) nextErrors.push('Min series seeders must be 0 or greater.');
    }
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
    } else {
      if (parsedRecentAnimationCount < 0) nextErrors.push('Recent animation count must be 0 or greater.');
      if (parsedRecentLiveActionCount < 0) nextErrors.push('Recent live action count must be 0 or greater.');
      if (parsedClassicAnimationCount < 0) nextErrors.push('Classic animation count must be 0 or greater.');
      if (parsedClassicLiveActionCount < 0) nextErrors.push('Classic live action count must be 0 or greater.');
      if (
        parsedRecentAnimationCount +
          parsedRecentLiveActionCount +
          parsedClassicAnimationCount +
          parsedClassicLiveActionCount <=
        0
      ) {
        nextErrors.push('At least one selection count must be greater than 0.');
      }
    }
    return nextErrors;
  }, [
    classicAnimationCount,
    classicLiveActionCount,
    classicYearEnd,
    classicYearStart,
    maxEpisodeGb,
    maxMovieGb,
    minMovieSeeders,
    minSeriesSeeders,
    recentAnimationCount,
    recentLiveActionCount,
    recentMonthsRange,
    selectionType,
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
              sizeLimits: {
                maxEpisodeGb: String(maxEpisodeGb || '').trim() ? Number(maxEpisodeGb) : null,
              },
              sourceFilters: {
                minSeriesSeeders: Math.max(0, Math.floor(Number(minSeriesSeeders) || 0)),
              },
              timeoutChecker: {
                strictSeriesReplacement,
                deletePartialSeriesOnReplacementFailure,
              },
              selectionStrategy,
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
            : 'Series episode size/seeder gates, replacement behavior, and Series Selection Strategy buckets used during automatic series selection.'
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

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="grid gap-4 md:grid-cols-2">
            {selectionType === 'movie' ? (
              <>
                <Field label="Max movie size (GB)">
                  <Input
                    type="number"
                    min={0.1}
                    step="0.1"
                    value={maxMovieGb}
                    onChange={(event) => setMaxMovieGb(event.target.value)}
                    disabled={loading}
                  />
                </Field>
                <Field label="Min movie seeders">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={minMovieSeeders}
                    onChange={(event) => setMinMovieSeeders(event.target.value)}
                    disabled={loading}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Max episode size (GB)" hint="Optional">
                  <Input
                    type="number"
                    min={0.05}
                    step="0.05"
                    value={maxEpisodeGb}
                    onChange={(event) => setMaxEpisodeGb(event.target.value)}
                    placeholder="(optional)"
                    disabled={loading}
                  />
                </Field>
                <Field label="Min series seeders">
                  <Input
                    type="number"
                    min={0}
                    step="1"
                    value={minSeriesSeeders}
                    onChange={(event) => setMinSeriesSeeders(event.target.value)}
                    disabled={loading}
                  />
                </Field>
                <Field label="Strict series replacement" hint="Require a full replacement set">
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
                <Field label="Delete partial series on failed replacement" hint="Delete partial downloads when no full replacement is found">
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
              </>
            )}
          </div>

          <div className="mt-6 border-t border-[var(--admin-border)] pt-4">
            <div className="text-sm font-semibold text-[var(--admin-text)]">Selection strategy</div>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <Field label="Recent months range">
                <Input
                  type="number"
                  min={1}
                  max={120}
                  step="1"
                  value={recentMonthsRange}
                  onChange={(event) => setRecentMonthsRange(event.target.value)}
                  disabled={loading}
                />
              </Field>
              <Field label="Classic year start">
                <Input
                  type="number"
                  min={1900}
                  max={2100}
                  step="1"
                  value={classicYearStart}
                  onChange={(event) => setClassicYearStart(event.target.value)}
                  disabled={loading}
                />
              </Field>
              <Field label="Classic year end">
                <Input
                  type="number"
                  min={1900}
                  max={2100}
                  step="1"
                  value={classicYearEnd}
                  onChange={(event) => setClassicYearEnd(event.target.value)}
                  disabled={loading}
                />
              </Field>
            </div>

            <div className="mt-4 text-sm font-medium text-[var(--admin-text)]">Counts per cycle</div>
            <div className="mt-3 grid gap-4 md:grid-cols-4">
              <Field label="Recent Animation">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={recentAnimationCount}
                  onChange={(event) => setRecentAnimationCount(event.target.value)}
                  disabled={loading}
                />
              </Field>
              <Field label="Recent Live Action">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={recentLiveActionCount}
                  onChange={(event) => setRecentLiveActionCount(event.target.value)}
                  disabled={loading}
                />
              </Field>
              <Field label="Classic Animation">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={classicAnimationCount}
                  onChange={(event) => setClassicAnimationCount(event.target.value)}
                  disabled={loading}
                />
              </Field>
              <Field label="Classic Live Action">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={classicLiveActionCount}
                  onChange={(event) => setClassicLiveActionCount(event.target.value)}
                  disabled={loading}
                />
              </Field>
            </div>
          </div>
        </div>
      </EditModal>
    </>
  );
}
