'use client';

import { useEffect, useState } from 'react';
import { getCatalogSettings } from '../../../lib/catalogSettings';

function clampInt(value, fallback, { min = 1, max = 500 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function coerceCatalogForSave(catalog) {
  const normalized = getCatalogSettings({ catalog: catalog || {} });
  return {
    labels: {
      moviesPage: {
        top: String(normalized.labels.moviesPage.top || '').trim(),
        recentlyAdded: String(normalized.labels.moviesPage.recentlyAdded || '').trim(),
        recommended: String(normalized.labels.moviesPage.recommended || '').trim(),
        worthToWait: String(normalized.labels.moviesPage.worthToWait || '').trim(),
        allMovies: String(normalized.labels.moviesPage.allMovies || '').trim(),
      },
      seriesPage: {
        top: String(normalized.labels.seriesPage.top || '').trim(),
        recentlyAdded: String(normalized.labels.seriesPage.recentlyAdded || '').trim(),
        worthToWait: String(normalized.labels.seriesPage.worthToWait || '').trim(),
      },
      homePage: {
        topMovies: String(normalized.labels.homePage.topMovies || '').trim(),
        worthToWait: String(normalized.labels.homePage.worthToWait || '').trim(),
        recentlyAdded: String(normalized.labels.homePage.recentlyAdded || '').trim(),
        recentMixed: String(normalized.labels.homePage.recentMixed || '').trim(),
        top10: String(normalized.labels.homePage.top10 || '').trim(),
        recommendedMovies: String(normalized.labels.homePage.recommendedMovies || '').trim(),
        topSeries: String(normalized.labels.homePage.topSeries || '').trim(),
        recentMovies: String(normalized.labels.homePage.recentMovies || '').trim(),
      },
    },
    categories: {
      topMovies: {
        enabled: Boolean(normalized.categories.topMovies.enabled),
        replaceEveryDays: clampInt(normalized.categories.topMovies.replaceEveryDays, 3, { min: 1, max: 30 }),
        displayCount: clampInt(normalized.categories.topMovies.displayCount, 60, { min: 1, max: 200 }),
        candidatePoolSize: clampInt(normalized.categories.topMovies.candidatePoolSize, 240, { min: 1, max: 500 }),
      },
      topSeries: {
        enabled: Boolean(normalized.categories.topSeries.enabled),
        replaceEveryDays: clampInt(normalized.categories.topSeries.replaceEveryDays, 3, { min: 1, max: 30 }),
        displayCount: clampInt(normalized.categories.topSeries.displayCount, 30, { min: 1, max: 200 }),
        candidatePoolSize: clampInt(normalized.categories.topSeries.candidatePoolSize, 120, { min: 1, max: 500 }),
      },
      recentlyAddedMovies: {
        displayCount: clampInt(normalized.categories.recentlyAddedMovies.displayCount, 20, { min: 1, max: 200 }),
      },
      recommendedMovies: {
        displayCount: clampInt(normalized.categories.recommendedMovies.displayCount, 20, { min: 1, max: 200 }),
      },
      movieGenreRows: {
        maxCategories: clampInt(normalized.categories.movieGenreRows.maxCategories, 5, { min: 1, max: 25 }),
        displayCount: clampInt(normalized.categories.movieGenreRows.displayCount, 20, { min: 1, max: 200 }),
      },
      recentlyAddedSeries: {
        displayCount: clampInt(normalized.categories.recentlyAddedSeries.displayCount, 20, { min: 1, max: 200 }),
      },
      seriesGenreRows: {
        maxCategories: clampInt(normalized.categories.seriesGenreRows.maxCategories, 5, { min: 1, max: 25 }),
        displayCount: clampInt(normalized.categories.seriesGenreRows.displayCount, 20, { min: 1, max: 200 }),
      },
    },
  };
}

export default function AdminCategorySettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [catalog, setCatalog] = useState(() => getCatalogSettings());

  const load = async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    try {
      const response = await fetch('/api/admin/settings', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load category settings.');
      setCatalog(getCatalogSettings(json.settings || {}));
    } catch (error) {
      setErr(error?.message || 'Failed to load category settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateLabel = (sectionKey, fieldKey, value) => {
    setCatalog((prev) => ({
      ...prev,
      labels: {
        ...prev.labels,
        [sectionKey]: {
          ...prev.labels[sectionKey],
          [fieldKey]: value,
        },
      },
    }));
  };

  const updateCategory = (sectionKey, fieldKey, value) => {
    setCatalog((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [sectionKey]: {
          ...prev.categories[sectionKey],
          [fieldKey]: value,
        },
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    setErr('');
    setOkMsg('');
    try {
      const payload = {
        settings: {
          catalog: coerceCatalogForSave(catalog),
        },
      };
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to save category settings.');
      setCatalog(getCatalogSettings(json.settings || {}));
      setOkMsg('Saved category settings.');
    } catch (error) {
      setErr(error?.message || 'Failed to save category settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading…</div>;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">Category Names</h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Rename the category titles shown on public Home, Movies, and Series pages.
        </p>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="mb-3 text-sm font-semibold">Movies page</div>
            <div className="space-y-3">
              <label className="block text-xs text-[var(--admin-muted)]">
                Top row
                <input
                  value={catalog.labels.moviesPage.top}
                  onChange={(event) => updateLabel('moviesPage', 'top', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Recently added
                <input
                  value={catalog.labels.moviesPage.recentlyAdded}
                  onChange={(event) => updateLabel('moviesPage', 'recentlyAdded', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Recommended
                <input
                  value={catalog.labels.moviesPage.recommended}
                  onChange={(event) => updateLabel('moviesPage', 'recommended', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Worth to wait
                <input
                  value={catalog.labels.moviesPage.worthToWait}
                  onChange={(event) => updateLabel('moviesPage', 'worthToWait', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                All movies
                <input
                  value={catalog.labels.moviesPage.allMovies}
                  onChange={(event) => updateLabel('moviesPage', 'allMovies', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="mb-3 text-sm font-semibold">Series page</div>
            <div className="space-y-3">
              <label className="block text-xs text-[var(--admin-muted)]">
                Top row
                <input
                  value={catalog.labels.seriesPage.top}
                  onChange={(event) => updateLabel('seriesPage', 'top', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Recently added
                <input
                  value={catalog.labels.seriesPage.recentlyAdded}
                  onChange={(event) => updateLabel('seriesPage', 'recentlyAdded', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Worth to wait
                <input
                  value={catalog.labels.seriesPage.worthToWait}
                  onChange={(event) => updateLabel('seriesPage', 'worthToWait', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="mb-3 text-sm font-semibold">Home page</div>
            <div className="space-y-3">
              <label className="block text-xs text-[var(--admin-muted)]">
                Top movies
                <input
                  value={catalog.labels.homePage.topMovies}
                  onChange={(event) => updateLabel('homePage', 'topMovies', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Worth to wait
                <input
                  value={catalog.labels.homePage.worthToWait}
                  onChange={(event) => updateLabel('homePage', 'worthToWait', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Recently added
                <input
                  value={catalog.labels.homePage.recentlyAdded}
                  onChange={(event) => updateLabel('homePage', 'recentlyAdded', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Recently mixed
                <input
                  value={catalog.labels.homePage.recentMixed}
                  onChange={(event) => updateLabel('homePage', 'recentMixed', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Top 10 row
                <input
                  value={catalog.labels.homePage.top10}
                  onChange={(event) => updateLabel('homePage', 'top10', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Recommended movies
                <input
                  value={catalog.labels.homePage.recommendedMovies}
                  onChange={(event) => updateLabel('homePage', 'recommendedMovies', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Top series
                <input
                  value={catalog.labels.homePage.topSeries}
                  onChange={(event) => updateLabel('homePage', 'topSeries', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="block text-xs text-[var(--admin-muted)]">
                Recently added movies
                <input
                  value={catalog.labels.homePage.recentMovies}
                  onChange={(event) => updateLabel('homePage', 'recentMovies', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">Category Settings</h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Control how many cards are shown per row and how often rotating categories refresh.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="mb-3 text-sm font-semibold">Top Movies</div>
            <label className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--admin-muted)]">
              <input
                type="checkbox"
                checked={Boolean(catalog.categories.topMovies.enabled)}
                onChange={(event) => updateCategory('topMovies', 'enabled', event.target.checked)}
              />
              Rotate this row
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-[var(--admin-muted)]">
                Replace every (days)
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={catalog.categories.topMovies.replaceEveryDays}
                  onChange={(event) =>
                    updateCategory('topMovies', 'replaceEveryDays', clampInt(event.target.value, 3, { min: 1, max: 30 }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="text-xs text-[var(--admin-muted)]">
                Cards shown
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={catalog.categories.topMovies.displayCount}
                  onChange={(event) =>
                    updateCategory('topMovies', 'displayCount', clampInt(event.target.value, 60, { min: 1, max: 200 }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="text-xs text-[var(--admin-muted)]">
                Candidate pool size
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={catalog.categories.topMovies.candidatePoolSize}
                  onChange={(event) =>
                    updateCategory('topMovies', 'candidatePoolSize', clampInt(event.target.value, 240, { min: 1, max: 500 }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="mb-3 text-sm font-semibold">Top Series</div>
            <label className="mb-3 inline-flex items-center gap-2 text-xs text-[var(--admin-muted)]">
              <input
                type="checkbox"
                checked={Boolean(catalog.categories.topSeries.enabled)}
                onChange={(event) => updateCategory('topSeries', 'enabled', event.target.checked)}
              />
              Rotate this row
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-[var(--admin-muted)]">
                Replace every (days)
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={catalog.categories.topSeries.replaceEveryDays}
                  onChange={(event) =>
                    updateCategory('topSeries', 'replaceEveryDays', clampInt(event.target.value, 3, { min: 1, max: 30 }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="text-xs text-[var(--admin-muted)]">
                Cards shown
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={catalog.categories.topSeries.displayCount}
                  onChange={(event) =>
                    updateCategory('topSeries', 'displayCount', clampInt(event.target.value, 30, { min: 1, max: 200 }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
              <label className="text-xs text-[var(--admin-muted)]">
                Candidate pool size
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={catalog.categories.topSeries.candidatePoolSize}
                  onChange={(event) =>
                    updateCategory('topSeries', 'candidatePoolSize', clampInt(event.target.value, 120, { min: 1, max: 500 }))
                  }
                  className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-[var(--admin-muted)]">
            Movies recently added cards
            <input
              type="number"
              min={1}
              max={200}
              value={catalog.categories.recentlyAddedMovies.displayCount}
              onChange={(event) =>
                updateCategory(
                  'recentlyAddedMovies',
                  'displayCount',
                  clampInt(event.target.value, 20, { min: 1, max: 200 })
                )
              }
              className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </label>
          <label className="text-xs text-[var(--admin-muted)]">
            Recommended movies cards
            <input
              type="number"
              min={1}
              max={200}
              value={catalog.categories.recommendedMovies.displayCount}
              onChange={(event) =>
                updateCategory(
                  'recommendedMovies',
                  'displayCount',
                  clampInt(event.target.value, 20, { min: 1, max: 200 })
                )
              }
              className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </label>
          <label className="text-xs text-[var(--admin-muted)]">
            Movie genre rows shown
            <input
              type="number"
              min={1}
              max={25}
              value={catalog.categories.movieGenreRows.maxCategories}
              onChange={(event) =>
                updateCategory(
                  'movieGenreRows',
                  'maxCategories',
                  clampInt(event.target.value, 5, { min: 1, max: 25 })
                )
              }
              className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </label>
          <label className="text-xs text-[var(--admin-muted)]">
            Movie genre cards per row
            <input
              type="number"
              min={1}
              max={200}
              value={catalog.categories.movieGenreRows.displayCount}
              onChange={(event) =>
                updateCategory(
                  'movieGenreRows',
                  'displayCount',
                  clampInt(event.target.value, 20, { min: 1, max: 200 })
                )
              }
              className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </label>
          <label className="text-xs text-[var(--admin-muted)]">
            Series recently added cards
            <input
              type="number"
              min={1}
              max={200}
              value={catalog.categories.recentlyAddedSeries.displayCount}
              onChange={(event) =>
                updateCategory(
                  'recentlyAddedSeries',
                  'displayCount',
                  clampInt(event.target.value, 20, { min: 1, max: 200 })
                )
              }
              className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </label>
          <label className="text-xs text-[var(--admin-muted)]">
            Series genre rows shown
            <input
              type="number"
              min={1}
              max={25}
              value={catalog.categories.seriesGenreRows.maxCategories}
              onChange={(event) =>
                updateCategory(
                  'seriesGenreRows',
                  'maxCategories',
                  clampInt(event.target.value, 5, { min: 1, max: 25 })
                )
              }
              className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </label>
          <label className="text-xs text-[var(--admin-muted)]">
            Series genre cards per row
            <input
              type="number"
              min={1}
              max={200}
              value={catalog.categories.seriesGenreRows.displayCount}
              onChange={(event) =>
                updateCategory(
                  'seriesGenreRows',
                  'displayCount',
                  clampInt(event.target.value, 20, { min: 1, max: 200 })
                )
              }
              className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </label>
        </div>

        {err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
        {okMsg ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div> : null}

        <div className="mt-5 flex gap-3">
          <button
            disabled={saving}
            onClick={save}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            disabled={saving}
            onClick={load}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Reload
          </button>
        </div>
      </section>
    </div>
  );
}
