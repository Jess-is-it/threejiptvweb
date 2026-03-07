const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_CATALOG_SETTINGS = {
  labels: {
    moviesPage: {
      top: 'Top Movies',
      recentlyAdded: 'Recently Added',
      recommended: 'Recommended Movies',
      worthToWait: 'Worth to wait',
      allMovies: 'All Movies',
    },
    seriesPage: {
      top: 'Top Series',
      recentlyAdded: 'Recently Added',
      worthToWait: 'Worth to wait',
    },
    homePage: {
      topMovies: 'Top Movies',
      worthToWait: 'Worth to wait',
      recentlyAdded: 'Recently Added',
      recentMixed: 'Recently added (Movies & Series)',
      top10: 'Top 10 in 3J TV',
      recommendedMovies: 'Recommended Movies',
      topSeries: 'Top Series',
      recentMovies: 'Recently added movies',
    },
  },
  categories: {
    topMovies: {
      enabled: true,
      replaceEveryDays: 3,
      displayCount: 60,
      candidatePoolSize: 240,
    },
    topSeries: {
      enabled: true,
      replaceEveryDays: 3,
      displayCount: 30,
      candidatePoolSize: 120,
    },
    recentlyAddedMovies: {
      displayCount: 20,
    },
    recommendedMovies: {
      displayCount: 20,
    },
    movieGenreRows: {
      maxCategories: 5,
      displayCount: 20,
    },
    recentlyAddedSeries: {
      displayCount: 20,
    },
    seriesGenreRows: {
      maxCategories: 5,
      displayCount: 20,
    },
  },
};

function asPositiveInt(value, { fallback, min = 1, max = 1000 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function asText(value, fallback) {
  const next = String(value || '').trim();
  return next || fallback;
}

function asBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true;
    if (lowered === 'false' || lowered === '0' || lowered === 'no') return false;
  }
  return fallback;
}

export function getCatalogSettings(settings) {
  const source = settings?.catalog || {};
  const defaults = DEFAULT_CATALOG_SETTINGS;

  return {
    labels: {
      moviesPage: {
        top: asText(source?.labels?.moviesPage?.top, defaults.labels.moviesPage.top),
        recentlyAdded: asText(
          source?.labels?.moviesPage?.recentlyAdded,
          defaults.labels.moviesPage.recentlyAdded
        ),
        recommended: asText(source?.labels?.moviesPage?.recommended, defaults.labels.moviesPage.recommended),
        worthToWait: asText(source?.labels?.moviesPage?.worthToWait, defaults.labels.moviesPage.worthToWait),
        allMovies: asText(source?.labels?.moviesPage?.allMovies, defaults.labels.moviesPage.allMovies),
      },
      seriesPage: {
        top: asText(source?.labels?.seriesPage?.top, defaults.labels.seriesPage.top),
        recentlyAdded: asText(
          source?.labels?.seriesPage?.recentlyAdded,
          defaults.labels.seriesPage.recentlyAdded
        ),
        worthToWait: asText(source?.labels?.seriesPage?.worthToWait, defaults.labels.seriesPage.worthToWait),
      },
      homePage: {
        topMovies: asText(source?.labels?.homePage?.topMovies, defaults.labels.homePage.topMovies),
        worthToWait: asText(source?.labels?.homePage?.worthToWait, defaults.labels.homePage.worthToWait),
        recentlyAdded: asText(source?.labels?.homePage?.recentlyAdded, defaults.labels.homePage.recentlyAdded),
        recentMixed: asText(source?.labels?.homePage?.recentMixed, defaults.labels.homePage.recentMixed),
        top10: asText(source?.labels?.homePage?.top10, defaults.labels.homePage.top10),
        recommendedMovies: asText(
          source?.labels?.homePage?.recommendedMovies,
          defaults.labels.homePage.recommendedMovies
        ),
        topSeries: asText(source?.labels?.homePage?.topSeries, defaults.labels.homePage.topSeries),
        recentMovies: asText(source?.labels?.homePage?.recentMovies, defaults.labels.homePage.recentMovies),
      },
    },
    categories: {
      topMovies: {
        enabled: asBool(source?.categories?.topMovies?.enabled, defaults.categories.topMovies.enabled),
        replaceEveryDays: asPositiveInt(source?.categories?.topMovies?.replaceEveryDays, {
          fallback: defaults.categories.topMovies.replaceEveryDays,
          min: 1,
          max: 30,
        }),
        displayCount: asPositiveInt(source?.categories?.topMovies?.displayCount, {
          fallback: defaults.categories.topMovies.displayCount,
          min: 1,
          max: 200,
        }),
        candidatePoolSize: asPositiveInt(source?.categories?.topMovies?.candidatePoolSize, {
          fallback: defaults.categories.topMovies.candidatePoolSize,
          min: 1,
          max: 500,
        }),
      },
      topSeries: {
        enabled: asBool(source?.categories?.topSeries?.enabled, defaults.categories.topSeries.enabled),
        replaceEveryDays: asPositiveInt(source?.categories?.topSeries?.replaceEveryDays, {
          fallback: defaults.categories.topSeries.replaceEveryDays,
          min: 1,
          max: 30,
        }),
        displayCount: asPositiveInt(source?.categories?.topSeries?.displayCount, {
          fallback: defaults.categories.topSeries.displayCount,
          min: 1,
          max: 200,
        }),
        candidatePoolSize: asPositiveInt(source?.categories?.topSeries?.candidatePoolSize, {
          fallback: defaults.categories.topSeries.candidatePoolSize,
          min: 1,
          max: 500,
        }),
      },
      recentlyAddedMovies: {
        displayCount: asPositiveInt(source?.categories?.recentlyAddedMovies?.displayCount, {
          fallback: defaults.categories.recentlyAddedMovies.displayCount,
          min: 1,
          max: 200,
        }),
      },
      recommendedMovies: {
        displayCount: asPositiveInt(source?.categories?.recommendedMovies?.displayCount, {
          fallback: defaults.categories.recommendedMovies.displayCount,
          min: 1,
          max: 200,
        }),
      },
      movieGenreRows: {
        maxCategories: asPositiveInt(source?.categories?.movieGenreRows?.maxCategories, {
          fallback: defaults.categories.movieGenreRows.maxCategories,
          min: 1,
          max: 25,
        }),
        displayCount: asPositiveInt(source?.categories?.movieGenreRows?.displayCount, {
          fallback: defaults.categories.movieGenreRows.displayCount,
          min: 1,
          max: 200,
        }),
      },
      recentlyAddedSeries: {
        displayCount: asPositiveInt(source?.categories?.recentlyAddedSeries?.displayCount, {
          fallback: defaults.categories.recentlyAddedSeries.displayCount,
          min: 1,
          max: 200,
        }),
      },
      seriesGenreRows: {
        maxCategories: asPositiveInt(source?.categories?.seriesGenreRows?.maxCategories, {
          fallback: defaults.categories.seriesGenreRows.maxCategories,
          min: 1,
          max: 25,
        }),
        displayCount: asPositiveInt(source?.categories?.seriesGenreRows?.displayCount, {
          fallback: defaults.categories.seriesGenreRows.displayCount,
          min: 1,
          max: 200,
        }),
      },
    },
  };
}

export function selectRotatingCategory(items, config) {
  const source = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!source.length) return [];

  const displayCount = asPositiveInt(config?.displayCount, { fallback: 20, min: 1, max: 500 });
  if (source.length <= displayCount) return source.slice(0, displayCount);

  const enabled = asBool(config?.enabled, true);
  if (!enabled) return source.slice(0, displayCount);

  const poolTarget = asPositiveInt(config?.candidatePoolSize, {
    fallback: Math.max(displayCount, 120),
    min: displayCount,
    max: 1000,
  });
  const pool = source.slice(0, Math.max(displayCount, poolTarget));
  if (pool.length <= displayCount) return pool;

  const replaceEveryDays = asPositiveInt(config?.replaceEveryDays, { fallback: 3, min: 1, max: 30 });
  const intervalMs = replaceEveryDays * DAY_MS;
  const cycle = Math.floor(Date.now() / Math.max(DAY_MS, intervalMs));
  const start = (cycle * displayCount) % pool.length;
  const out = [];
  for (let index = 0; index < displayCount; index += 1) {
    out.push(pool[(start + index) % pool.length]);
  }
  return out;
}
