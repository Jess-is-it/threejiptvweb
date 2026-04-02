'use client';

import { useEffect, useState } from 'react';
import {
  CATALOG_HERO_SORT_OPTIONS,
  CATALOG_HERO_SOURCE_OPTIONS,
  CATALOG_LAYOUT_BUILTINS,
  getCatalogSettings,
  makeCatalogBuiltinRowToken,
  makeCatalogGenreRowToken,
  normalizeCatalogGenreName,
  parseCatalogRowToken,
} from '../../../lib/catalogSettings';

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
        leavingSoon: String(normalized.labels.moviesPage.leavingSoon || '').trim(),
        recommended: String(normalized.labels.moviesPage.recommended || '').trim(),
        worthToWait: String(normalized.labels.moviesPage.worthToWait || '').trim(),
        allMovies: String(normalized.labels.moviesPage.allMovies || '').trim(),
      },
      seriesPage: {
        top: String(normalized.labels.seriesPage.top || '').trim(),
        recentlyAdded: String(normalized.labels.seriesPage.recentlyAdded || '').trim(),
        leavingSoon: String(normalized.labels.seriesPage.leavingSoon || '').trim(),
        worthToWait: String(normalized.labels.seriesPage.worthToWait || '').trim(),
      },
    },
    layouts: {
      moviesPage: {
        rows: Array.isArray(normalized.layouts?.moviesPage?.rows) ? normalized.layouts.moviesPage.rows : [],
      },
      seriesPage: {
        rows: Array.isArray(normalized.layouts?.seriesPage?.rows) ? normalized.layouts.seriesPage.rows : [],
      },
    },
    hero: {
      moviesPage: {
        rules: Array.isArray(normalized.hero?.moviesPage?.rules)
          ? normalized.hero.moviesPage.rules.map((rule) => ({
              source: String(rule?.source || '').trim(),
              count: clampInt(rule?.count, 0, { min: 0, max: 30 }),
              sort: String(rule?.sort || '').trim(),
            }))
          : [],
      },
      seriesPage: {
        rules: Array.isArray(normalized.hero?.seriesPage?.rules)
          ? normalized.hero.seriesPage.rules.map((rule) => ({
              source: String(rule?.source || '').trim(),
              count: clampInt(rule?.count, 0, { min: 0, max: 30 }),
              sort: String(rule?.sort || '').trim(),
            }))
          : [],
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

function layoutRowLabel(catalog, pageKey, row) {
  if (!row) return '';
  if (row.kind === 'genre') return row.name;

  if (pageKey === 'moviesPage') {
    if (row.key === 'top') return catalog.labels.moviesPage.top;
    if (row.key === 'recentlyAdded') return catalog.labels.moviesPage.recentlyAdded;
    if (row.key === 'leavingSoon') return catalog.labels.moviesPage.leavingSoon;
    if (row.key === 'recommended') return catalog.labels.moviesPage.recommended;
    if (row.key === 'worthToWait') return catalog.labels.moviesPage.worthToWait;
    if (row.key === 'allMovies') return catalog.labels.moviesPage.allMovies;
  }

  if (pageKey === 'seriesPage') {
    if (row.key === 'top') return catalog.labels.seriesPage.top;
    if (row.key === 'recentlyAdded') return catalog.labels.seriesPage.recentlyAdded;
    if (row.key === 'leavingSoon') return catalog.labels.seriesPage.leavingSoon;
    if (row.key === 'worthToWait') return catalog.labels.seriesPage.worthToWait;
  }

  return row.key || '';
}

function heroSourceLabel(catalog, pageKey, sourceKey) {
  const key = String(sourceKey || '').trim();
  if (!key) return '';

  if (pageKey === 'moviesPage') {
    if (key === 'top') return catalog.labels.moviesPage.top;
    if (key === 'recentlyAdded') return catalog.labels.moviesPage.recentlyAdded;
    if (key === 'leavingSoon') return catalog.labels.moviesPage.leavingSoon;
    if (key === 'recommended') return catalog.labels.moviesPage.recommended;
    if (key === 'worthToWait') return catalog.labels.moviesPage.worthToWait;
  }

  if (pageKey === 'seriesPage') {
    if (key === 'top') return catalog.labels.seriesPage.top;
    if (key === 'recentlyAdded') return catalog.labels.seriesPage.recentlyAdded;
    if (key === 'leavingSoon') return catalog.labels.seriesPage.leavingSoon;
    if (key === 'worthToWait') return catalog.labels.seriesPage.worthToWait;
  }

  return CATALOG_HERO_SOURCE_OPTIONS[pageKey]?.find((entry) => entry.key === key)?.label || key;
}

export default function AdminCategorySettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [catalog, setCatalog] = useState(() => getCatalogSettings());
  const [genreOptions, setGenreOptions] = useState({ moviesPage: [], seriesPage: [] });
  const [draggingRow, setDraggingRow] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    try {
      const [response, genresResponse] = await Promise.all([
        fetch('/api/admin/settings', { cache: 'no-store' }),
        fetch('/api/admin/autodownload/tmdb/genres', { cache: 'no-store' }),
      ]);
      const json = await response.json().catch(() => ({}));
      const genresJson = await genresResponse.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load category settings.');
      setCatalog(getCatalogSettings(json.settings || {}));
      setGenreOptions({
        moviesPage: Array.isArray(genresJson?.movie)
          ? genresJson.movie.map((genre) => String(genre?.name || '').trim()).filter(Boolean)
          : [],
        seriesPage: Array.isArray(genresJson?.tv)
          ? genresJson.tv.map((genre) => String(genre?.name || '').trim()).filter(Boolean)
          : [],
      });
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

  const updateLayoutRows = (pageKey, rows) => {
    setCatalog((prev) => ({
      ...prev,
      layouts: {
        ...(prev.layouts || {}),
        [pageKey]: {
          ...(prev.layouts?.[pageKey] || {}),
          rows,
        },
      },
    }));
  };

  const updateHeroRules = (pageKey, rules) => {
    setCatalog((prev) => ({
      ...prev,
      hero: {
        ...(prev.hero || {}),
        [pageKey]: {
          ...(prev.hero?.[pageKey] || {}),
          rules,
        },
      },
    }));
  };

  const updateHeroRule = (pageKey, index, fieldKey, value) => {
    const currentRules = Array.isArray(catalog.hero?.[pageKey]?.rules) ? catalog.hero[pageKey].rules : [];
    updateHeroRules(
      pageKey,
      currentRules.map((rule, ruleIndex) =>
        ruleIndex === index
          ? {
              ...rule,
              [fieldKey]: value,
            }
          : rule
      )
    );
  };

  const addHeroRule = (pageKey) => {
    const currentRules = Array.isArray(catalog.hero?.[pageKey]?.rules) ? catalog.hero[pageKey].rules : [];
    const options = Array.isArray(CATALOG_HERO_SOURCE_OPTIONS[pageKey]) ? CATALOG_HERO_SOURCE_OPTIONS[pageKey] : [];
    const usedSources = new Set(currentRules.map((rule) => String(rule?.source || '').trim()).filter(Boolean));
    const nextSource =
      options.find((entry) => !usedSources.has(entry.key))?.key ||
      options[0]?.key ||
      'recentlyAdded';

    updateHeroRules(pageKey, [
      ...currentRules,
      {
        source: nextSource,
        count: 1,
        sort: 'latest',
      },
    ]);
  };

  const removeHeroRule = (pageKey, index) => {
    const currentRules = Array.isArray(catalog.hero?.[pageKey]?.rules) ? catalog.hero[pageKey].rules : [];
    updateHeroRules(
      pageKey,
      currentRules.filter((_, ruleIndex) => ruleIndex !== index)
    );
  };

  const moveHeroRule = (pageKey, index, delta) => {
    const currentRules = Array.isArray(catalog.hero?.[pageKey]?.rules) ? [...catalog.hero[pageKey].rules] : [];
    const nextIndex = index + delta;
    if (index < 0 || index >= currentRules.length || nextIndex < 0 || nextIndex >= currentRules.length) return;
    const [moved] = currentRules.splice(index, 1);
    currentRules.splice(nextIndex, 0, moved);
    updateHeroRules(pageKey, currentRules);
  };

  const toggleGenreRow = (pageKey, genreName, checked) => {
    const token = makeCatalogGenreRowToken(genreName);
    if (!token) return;

    const currentRows = Array.isArray(catalog.layouts?.[pageKey]?.rows) ? catalog.layouts[pageKey].rows : [];
    const filtered = currentRows.filter((rowToken) => rowToken !== token);
    if (!checked) {
      updateLayoutRows(pageKey, filtered);
      return;
    }

    if (pageKey === 'moviesPage') {
      const allMoviesToken = makeCatalogBuiltinRowToken('allMovies');
      const allMoviesIndex = filtered.indexOf(allMoviesToken);
      if (allMoviesIndex >= 0) {
        filtered.splice(allMoviesIndex, 0, token);
      } else {
        filtered.push(token);
      }
      updateLayoutRows(pageKey, filtered);
      return;
    }

    filtered.push(token);
    updateLayoutRows(pageKey, filtered);
  };

  const moveLayoutRow = (pageKey, fromToken, toToken) => {
    if (!fromToken || !toToken || fromToken === toToken) return;
    const currentRows = Array.isArray(catalog.layouts?.[pageKey]?.rows) ? [...catalog.layouts[pageKey].rows] : [];
    const fromIndex = currentRows.indexOf(fromToken);
    const toIndex = currentRows.indexOf(toToken);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const [moved] = currentRows.splice(fromIndex, 1);
    currentRows.splice(toIndex, 0, moved);
    updateLayoutRows(pageKey, currentRows);
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
          Rename the category titles shown on the public Movies and Series pages.
        </p>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
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
                Leaving soon
                <input
                  value={catalog.labels.moviesPage.leavingSoon}
                  onChange={(event) => updateLabel('moviesPage', 'leavingSoon', event.target.value)}
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
                Leaving soon
                <input
                  value={catalog.labels.seriesPage.leavingSoon}
                  onChange={(event) => updateLabel('seriesPage', 'leavingSoon', event.target.value)}
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
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">Page Layout</h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Movies is now the landing page. Choose which genres appear and drag rows to reorder built-in categories and selected genres.
        </p>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {['moviesPage', 'seriesPage'].map((pageKey) => {
            const title = pageKey === 'moviesPage' ? 'Landing / Movies page' : 'Series page';
            const rows = Array.isArray(catalog.layouts?.[pageKey]?.rows) ? catalog.layouts[pageKey].rows : [];
            const selectedGenreKeys = new Set(
              rows
                .map((token) => parseCatalogRowToken(token))
                .filter((row) => row?.kind === 'genre')
                .map((row) => normalizeCatalogGenreName(row.name))
                .filter(Boolean)
            );
            const options = Array.isArray(genreOptions?.[pageKey]) ? genreOptions[pageKey] : [];

            return (
              <div key={pageKey} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="mb-3 text-sm font-semibold">{title}</div>

                <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] p-3">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                    Row Order
                  </div>
                  <div className="space-y-2">
                    {rows.map((token) => {
                      const row = parseCatalogRowToken(token);
                      if (!row) return null;
                      const isBuiltin = row.kind === 'builtin';
                      const builtinLabel =
                        isBuiltin
                          ? CATALOG_LAYOUT_BUILTINS[pageKey]?.find((entry) => entry.key === row.key)?.label || row.key
                          : '';
                      return (
                        <div
                          key={`${pageKey}-${token}`}
                          draggable
                          onDragStart={() => setDraggingRow({ pageKey, token })}
                          onDragEnd={() => setDraggingRow(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (draggingRow?.pageKey !== pageKey) return;
                            moveLayoutRow(pageKey, draggingRow?.token, token);
                            setDraggingRow(null);
                          }}
                          className={
                            'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ' +
                            (draggingRow?.pageKey === pageKey && draggingRow?.token === token
                              ? 'border-[var(--brand)] bg-[var(--brand)]/10'
                              : 'border-[var(--admin-border)] bg-[var(--admin-surface)]')
                          }
                        >
                          <div className="flex items-center gap-3">
                            <span className="cursor-grab text-base text-[var(--admin-muted)] active:cursor-grabbing">⋮⋮</span>
                            <div>
                              <div className="font-medium text-[var(--admin-text)]">
                                {layoutRowLabel(catalog, pageKey, row)}
                              </div>
                              <div className="text-xs text-[var(--admin-muted)]">
                                {isBuiltin ? `Built-in: ${builtinLabel}` : 'Genre row'}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] p-3">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                    Genres To Display
                  </div>
                  {!options.length ? (
                    <div className="text-sm text-[var(--admin-muted)]">No genres available right now.</div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {options.map((genreName) => {
                        const normalizedName = normalizeCatalogGenreName(genreName);
                        const checked = selectedGenreKeys.has(normalizedName);
                        return (
                          <label
                            key={`${pageKey}-genre-${normalizedName}`}
                            className="flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => toggleGenreRow(pageKey, genreName, event.target.checked)}
                            />
                            <span>{genreName}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">Hero Section</h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Build the public hero slider from category sources. Set how many titles each source contributes and how each source is sorted before it is featured.
        </p>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {['moviesPage', 'seriesPage'].map((pageKey) => {
            const title = pageKey === 'moviesPage' ? 'Landing / Movies page hero' : 'Series page hero';
            const rules = Array.isArray(catalog.hero?.[pageKey]?.rules) ? catalog.hero[pageKey].rules : [];
            const totalSlides = rules.reduce(
              (sum, rule) => sum + Math.max(0, Number(rule?.count || 0) || 0),
              0
            );
            const sourceOptions = Array.isArray(CATALOG_HERO_SOURCE_OPTIONS[pageKey])
              ? CATALOG_HERO_SOURCE_OPTIONS[pageKey]
              : [];

            return (
              <div key={`hero-${pageKey}`} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">{title}</div>
                    <div className="mt-1 text-xs text-[var(--admin-muted)]">
                      Total featured slides: {totalSlides}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addHeroRule(pageKey)}
                    className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-xs font-medium text-[var(--admin-text)] hover:bg-black/10"
                  >
                    Add source
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {rules.map((rule, index) => (
                    <div
                      key={`${pageKey}-hero-rule-${index}`}
                      className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-[var(--admin-text)]">
                            Rule {index + 1}: {heroSourceLabel(catalog, pageKey, rule?.source)}
                          </div>
                          <div className="mt-1 text-xs text-[var(--admin-muted)]">
                            Source order controls the hero slide order after each rule is sorted.
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => moveHeroRule(pageKey, index, -1)}
                            disabled={index === 0}
                            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs disabled:opacity-40"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => moveHeroRule(pageKey, index, 1)}
                            disabled={index === rules.length - 1}
                            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-xs disabled:opacity-40"
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            onClick={() => removeHeroRule(pageKey, index)}
                            className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <label className="text-xs text-[var(--admin-muted)]">
                          Retrieve from
                          <select
                            value={rule?.source || ''}
                            onChange={(event) => updateHeroRule(pageKey, index, 'source', event.target.value)}
                            className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                          >
                            {sourceOptions.map((option) => (
                              <option key={`${pageKey}-hero-source-${option.key}`} value={option.key}>
                                {heroSourceLabel(catalog, pageKey, option.key)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-xs text-[var(--admin-muted)]">
                          Featured items
                          <input
                            type="number"
                            min={0}
                            max={30}
                            value={Number(rule?.count || 0)}
                            onChange={(event) =>
                              updateHeroRule(
                                pageKey,
                                index,
                                'count',
                                clampInt(event.target.value, 0, { min: 0, max: 30 })
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                          />
                        </label>

                        <label className="text-xs text-[var(--admin-muted)]">
                          Sort by
                          <select
                            value={rule?.sort || 'latest'}
                            onChange={(event) => updateHeroRule(pageKey, index, 'sort', event.target.value)}
                            className="mt-1 w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:ring-2 focus:ring-[--brand]/30"
                          >
                            {CATALOG_HERO_SORT_OPTIONS.map((option) => (
                              <option key={`${pageKey}-hero-sort-${option.key}`} value={option.key}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
