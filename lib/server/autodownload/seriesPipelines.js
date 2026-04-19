import 'server-only';

const DEFAULT_SERIES_STRATEGY = {
  recentMonthsRange: 12,
  classicYearStart: 2008,
  classicYearEnd: 2020,
  recentAnimationCount: 0,
  recentLiveActionCount: 1,
  classicAnimationCount: 0,
  classicLiveActionCount: 0,
};

export const SERIES_PIPELINE_KEYS = ['newSeries', 'newSeriesEpisode', 'existingSeries', 'deferredRetry'];

export const SERIES_PIPELINE_SIZE_FIELDS = {
  newSeries: { episode: false, season: true },
  newSeriesEpisode: { episode: true, season: false },
  existingSeries: { episode: true, season: false },
  deferredRetry: { episode: true, season: true },
};

export const DEFAULT_SERIES_PIPELINES = {
  newSeries: {
    enabled: true,
    acquisitionMode: 'season_pack',
    minSeeders: 8,
    maxEpisodeGb: 2.5,
    maxSeasonTotalGb: 14,
    timeoutHours: 24,
    strategy: DEFAULT_SERIES_STRATEGY,
  },
  newSeriesEpisode: {
    enabled: false,
    acquisitionMode: 'first_episode',
    minSeeders: 8,
    maxEpisodeGb: 2.5,
    maxSeasonTotalGb: 14,
    timeoutHours: 12,
    strategy: DEFAULT_SERIES_STRATEGY,
  },
  existingSeries: {
    enabled: false,
    acquisitionMode: 'next_episode',
    minSeeders: 5,
    maxEpisodeGb: 2.5,
    maxSeasonTotalGb: 8,
    timeoutHours: 12,
    strategy: DEFAULT_SERIES_STRATEGY,
  },
  deferredRetry: {
    enabled: true,
    acquisitionMode: 'replacement_retry',
    minSeeders: 10,
    maxEpisodeGb: 2,
    maxSeasonTotalGb: 10,
    timeoutHours: 12,
    strategy: DEFAULT_SERIES_STRATEGY,
  },
};

function num(value, fallback, { min = null, max = null } = {}) {
  const n = Number(value);
  let next = Number.isFinite(n) ? n : fallback;
  if (min !== null && next < min) next = min;
  if (max !== null && next > max) next = max;
  return Math.floor(next * 1000) / 1000;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

export function normalizeSeriesStrategy(input = {}, fallback = DEFAULT_SERIES_STRATEGY) {
  const source = input && typeof input === 'object' ? input : {};
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_SERIES_STRATEGY;
  return {
    recentMonthsRange: num(source.recentMonthsRange, base.recentMonthsRange, { min: 1, max: 120 }),
    classicYearStart: num(source.classicYearStart, base.classicYearStart, { min: 1900, max: 2100 }),
    classicYearEnd: num(source.classicYearEnd, base.classicYearEnd, { min: 1900, max: 2100 }),
    recentAnimationCount: num(source.recentAnimationCount, base.recentAnimationCount, { min: 0, max: 100 }),
    recentLiveActionCount: num(source.recentLiveActionCount, base.recentLiveActionCount, { min: 0, max: 100 }),
    classicAnimationCount: num(source.classicAnimationCount, base.classicAnimationCount, { min: 0, max: 100 }),
    classicLiveActionCount: num(source.classicLiveActionCount, base.classicLiveActionCount, { min: 0, max: 100 }),
  };
}

function normalizePipeline(input = {}, fallback = DEFAULT_SERIES_PIPELINES.newSeries, legacyStrategy = null) {
  const source = input && typeof input === 'object' ? input : {};
  const strategyFallback = legacyStrategy && typeof legacyStrategy === 'object' ? legacyStrategy : fallback.strategy;
  return {
    enabled: bool(source.enabled, fallback.enabled),
    acquisitionMode: String(fallback.acquisitionMode || '').trim(),
    minSeeders: Math.floor(num(source.minSeeders, fallback.minSeeders, { min: 0, max: 100000 })),
    maxEpisodeGb: num(source.maxEpisodeGb, fallback.maxEpisodeGb, { min: 0.05, max: 500 }),
    maxSeasonTotalGb: num(source.maxSeasonTotalGb, fallback.maxSeasonTotalGb, { min: 0.1, max: 5000 }),
    timeoutHours: num(source.timeoutHours, fallback.timeoutHours, { min: 1, max: 168 }),
    strategy: normalizeSeriesStrategy(source.strategy, strategyFallback),
  };
}

export function normalizeSeriesPipelines(settings = {}) {
  const existing = settings && typeof settings === 'object' ? settings : {};
  const saved = existing.seriesPipelines && typeof existing.seriesPipelines === 'object' ? existing.seriesPipelines : {};
  const legacyStrategy = normalizeSeriesStrategy(existing.seriesSelectionStrategy || DEFAULT_SERIES_STRATEGY, DEFAULT_SERIES_STRATEGY);
  const legacyMinSeeders = Math.floor(num(existing?.sourceFilters?.minSeriesSeeders, DEFAULT_SERIES_PIPELINES.newSeries.minSeeders, {
    min: 0,
    max: 100000,
  }));
  const legacyMaxEpisodeGb = num(existing?.sizeLimits?.maxEpisodeGb, DEFAULT_SERIES_PIPELINES.newSeries.maxEpisodeGb, {
    min: 0.05,
    max: 500,
  });
  const legacyMaxSeasonTotalGb = num(existing?.sizeLimits?.maxSeasonTotalGb, DEFAULT_SERIES_PIPELINES.newSeries.maxSeasonTotalGb, {
    min: 0.1,
    max: 5000,
  });
  const legacyBootstrapEnabled =
    (existing?.selection?.seriesBootstrapMissingToSeason1 ?? existing?.selection?.seriesBootstrapMissingToS01E01) !== false;

  const newDefaults = {
    ...DEFAULT_SERIES_PIPELINES.newSeries,
    enabled: legacyBootstrapEnabled,
    minSeeders: Math.max(DEFAULT_SERIES_PIPELINES.newSeries.minSeeders, legacyMinSeeders),
    maxEpisodeGb: legacyMaxEpisodeGb,
    maxSeasonTotalGb: legacyMaxSeasonTotalGb,
    strategy: legacyStrategy,
  };
  const newEpisodeDefaults = {
    ...DEFAULT_SERIES_PIPELINES.newSeriesEpisode,
    minSeeders: Math.max(DEFAULT_SERIES_PIPELINES.newSeriesEpisode.minSeeders, legacyMinSeeders),
    maxEpisodeGb: legacyMaxEpisodeGb,
    maxSeasonTotalGb: legacyMaxSeasonTotalGb,
    strategy: legacyStrategy,
  };

  return {
    newSeries: normalizePipeline(saved.newSeries, newDefaults, legacyStrategy),
    newSeriesEpisode: normalizePipeline(saved.newSeriesEpisode, newEpisodeDefaults, legacyStrategy),
    existingSeries: normalizePipeline(saved.existingSeries, DEFAULT_SERIES_PIPELINES.existingSeries, DEFAULT_SERIES_PIPELINES.existingSeries.strategy),
    deferredRetry: normalizePipeline(saved.deferredRetry, DEFAULT_SERIES_PIPELINES.deferredRetry, DEFAULT_SERIES_PIPELINES.deferredRetry.strategy),
  };
}

export function getSeriesPipeline(settings = {}, key = 'newSeries') {
  const pipelines = normalizeSeriesPipelines(settings);
  return pipelines[key] || pipelines.newSeries;
}
