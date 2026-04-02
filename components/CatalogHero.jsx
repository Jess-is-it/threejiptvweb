'use client';

import { useEffect, useMemo, useState } from 'react';

import HeroCarousel from './HeroCarousel';
import { readJsonSafe } from '../lib/readJsonSafe';
import { persistMoviePlaySeed, persistMovieReturnState } from '../lib/moviePlaySeed';

const HEADER_H = 64;
const SHELL_HEADER_OFFSET = 64;
const SECTION_TOP_GAP = 24;
const HERO_METADATA_MIN_CANDIDATES = 12;
const HERO_METADATA_MAX_CANDIDATES = 30;
const HERO_METADATA_MULTIPLIER = 4;

function normalizeHeroKind(value, pageKey) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'series' || raw === 'tv') return 'series';
  if (raw === 'movie') return 'movie';
  return pageKey === 'seriesPage' ? 'series' : 'movie';
}

function parseYearTimestamp(value) {
  const year = Number(String(value || '').trim());
  if (!Number.isFinite(year) || year <= 0) return 0;
  return Date.UTC(year, 0, 1);
}

function parseDateTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 1e12) return Math.floor(numeric);
    if (numeric >= 1e9) return Math.floor(numeric * 1000);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getHeroItemKey(item, pageKey) {
  const kind = normalizeHeroKind(item?.kind, pageKey);
  const xuiId = Number(item?.xuiId || 0);
  if (Number.isFinite(xuiId) && xuiId > 0) return `${kind}:xui:${xuiId}`;

  const itemId = Number(item?.id || 0);
  if (Number.isFinite(itemId) && itemId > 0) return `${kind}:id:${itemId}`;

  const tmdbId = Number(item?.tmdbId || 0);
  if (Number.isFinite(tmdbId) && tmdbId > 0) return `${kind}:tmdb:${tmdbId}`;

  const title = String(item?.title || '').trim().toLowerCase();
  const year = String(item?.year || '').trim();
  const href = String(item?.href || '').trim();
  return `${kind}:${title}:${year}:${href}`;
}

function normalizeHeroItem(item, pageKey, sourceKey = '') {
  const kind = normalizeHeroKind(item?.kind, pageKey);
  const rawId = Number(item?.id || 0);
  const xuiId = Number(item?.xuiId || 0);
  const playbackId = Number.isFinite(xuiId) && xuiId > 0 ? xuiId : rawId;
  const href = String(item?.href || '').trim();
  const isUpcoming = href.includes('upcoming=1');
  const canDirectPlay = pageKey === 'moviesPage' && kind === 'movie' && Number.isFinite(playbackId) && playbackId > 0 && !isUpcoming;

  return {
    ...item,
    heroKey: getHeroItemKey(item, pageKey),
    kind,
    image: item?.image || '',
    backdrop: item?.backdropImage || item?.backdrop || item?.image || '',
    plot: item?.plot || item?.overview || '',
    genre:
      item?.genre ||
      (Array.isArray(item?.genres) ? item.genres.filter(Boolean).join(', ') : ''),
    heroPrimaryLabel: canDirectPlay ? 'Play' : pageKey === 'moviesPage' ? 'Open Movie' : 'Open Series',
    heroDirectPlayId: canDirectPlay ? playbackId : 0,
    heroSourceKey: String(sourceKey || '').trim(),
    heroHref:
      href ||
      (pageKey === 'seriesPage'
        ? playbackId > 0
          ? `/series/${playbackId}`
          : ''
        : playbackId > 0
          ? `/movies/${playbackId}`
          : ''),
  };
}

function detailsFetchParams(item, pageKey) {
  const tmdbId = Number(item?.tmdbId || 0);
  if (Number.isFinite(tmdbId) && tmdbId > 0) {
    const mediaType =
      String(item?.mediaType || '').trim().toLowerCase() === 'tv' || normalizeHeroKind(item?.kind, pageKey) === 'series'
        ? 'tv'
        : 'movie';
    return { id: String(tmdbId), mediaType };
  }

  const title = String(item?.title || '').trim();
  if (!title) return null;

  return {
    title,
    year: String(item?.year || '').trim(),
    kind: normalizeHeroKind(item?.kind, pageKey) === 'series' ? 'series' : 'movie',
  };
}

function latestRank(item, details) {
  const added = Number(item?.added || 0);
  if (Number.isFinite(added) && added > 0) return added;

  const releasedAt = Number(item?.releasedAt || 0);
  if (Number.isFinite(releasedAt) && releasedAt > 0) return releasedAt;

  const releaseDateValue = parseDateTimestamp(item?.releaseDate || details?.releaseDate);
  if (releaseDateValue > 0) return releaseDateValue;

  const deleteAt = Number(item?.deleteAt || 0);
  if (Number.isFinite(deleteAt) && deleteAt > 0) return deleteAt;

  return parseYearTimestamp(item?.year);
}

function compareByTitle(a, b) {
  return String(a?.title || '').localeCompare(String(b?.title || ''));
}

function sortItemsForRule(items, rule, detailsMap) {
  const sortMode = String(rule?.sort || 'latest').trim();
  return [...items].sort((left, right) => {
    const leftDetails = detailsMap[left.heroKey] || {};
    const rightDetails = detailsMap[right.heroKey] || {};

    if (sortMode === 'tmdbPopularity') {
      const popularityDiff = Number(rightDetails?.popularity || 0) - Number(leftDetails?.popularity || 0);
      if (popularityDiff !== 0) return popularityDiff;
    } else if (sortMode === 'reviews') {
      const reviewsDiff = Number(rightDetails?.voteCount || 0) - Number(leftDetails?.voteCount || 0);
      if (reviewsDiff !== 0) return reviewsDiff;
      const ratingDiff = Number(rightDetails?.rating || right?.rating || 0) - Number(leftDetails?.rating || left?.rating || 0);
      if (ratingDiff !== 0) return ratingDiff;
    }

    const latestDiff = latestRank(right, rightDetails) - latestRank(left, leftDetails);
    if (latestDiff !== 0) return latestDiff;

    const ratingDiff = Number(right?.rating || 0) - Number(left?.rating || 0);
    if (ratingDiff !== 0) return ratingDiff;

    return compareByTitle(left, right);
  });
}

function metadataWindowSize(count) {
  const requested = Math.max(0, Number(count || 0) || 0);
  return Math.min(
    HERO_METADATA_MAX_CANDIDATES,
    Math.max(HERO_METADATA_MIN_CANDIDATES, requested * HERO_METADATA_MULTIPLIER)
  );
}

function HeroSkeleton({ headerH = HEADER_H }) {
  return (
    <div
      className="-mx-4 sm:-mx-6 lg:-mx-10 mb-6 min-h-[58vh] md:min-h-[62vh] overflow-hidden bg-neutral-950"
      style={{
        marginTop: `-${headerH + SHELL_HEADER_OFFSET + SECTION_TOP_GAP}px`,
        paddingTop: `${headerH}px`,
      }}
    >
      <div className="h-full w-full animate-pulse bg-gradient-to-br from-neutral-900 via-neutral-800/30 to-neutral-900" />
    </div>
  );
}

export default function CatalogHero({
  pageKey,
  catalog,
  sourceItems = {},
  loading = false,
}) {
  const rules = useMemo(
    () => (Array.isArray(catalog?.hero?.[pageKey]?.rules) ? catalog.hero[pageKey].rules : []),
    [catalog, pageKey]
  );
  const [headerH, setHeaderH] = useState(HEADER_H);

  useEffect(() => {
    const measure = () => {
      const el = document.getElementById('site-header');
      setHeaderH(el ? el.offsetHeight : HEADER_H);
    };

    measure();
    window.addEventListener('resize', measure);
    const timer = setTimeout(measure, 100);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(timer);
    };
  }, []);

  const normalizedSources = useMemo(() => {
    const out = {};
    for (const [sourceKey, items] of Object.entries(sourceItems || {})) {
      out[sourceKey] = (Array.isArray(items) ? items : [])
        .filter(Boolean)
        .map((item) => normalizeHeroItem(item, pageKey, sourceKey));
    }
    return out;
  }, [sourceItems, pageKey]);

  const metadataCandidates = useMemo(() => {
    const out = [];
    const seen = new Set();

    for (const rule of rules) {
      if (!rule || String(rule?.sort || 'latest') === 'latest') continue;
      const sourceKey = String(rule?.source || '').trim();
      const items = Array.isArray(normalizedSources[sourceKey]) ? normalizedSources[sourceKey] : [];
      const windowSize = metadataWindowSize(rule?.count);
      for (const item of items.slice(0, windowSize)) {
        if (!item?.heroKey || seen.has(item.heroKey)) continue;
        seen.add(item.heroKey);
        out.push(item);
      }
    }

    return out;
  }, [rules, normalizedSources]);

  const [detailsMap, setDetailsMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    const pendingItems = metadataCandidates.filter(
      (item) => !Object.prototype.hasOwnProperty.call(detailsMap, item.heroKey)
    );
    if (!pendingItems.length) return undefined;

    (async () => {
      const results = await Promise.allSettled(
        pendingItems.map(async (item) => {
          const params = detailsFetchParams(item, pageKey);
          if (!params) return null;

          const search = new URLSearchParams();
          Object.entries(params).forEach(([key, value]) => {
            if (value) search.set(key, value);
          });

          const response = await fetch(`/api/tmdb/details?${search.toString()}`, { cache: 'no-store' });
          if (!response.ok) {
            return { key: item.heroKey, data: null };
          }
          const json = await readJsonSafe(response);
          if (!json?.ok) {
            return { key: item.heroKey, data: null };
          }

          return {
            key: item.heroKey,
            data: {
              overview: json.overview || '',
              rating: json.rating ?? null,
              genres: Array.isArray(json.genres) ? json.genres : [],
              runtime: json.runtime ?? null,
              popularity: json.popularity ?? null,
              voteCount: json.voteCount ?? null,
              releaseDate: json.releaseDate || '',
              posterPath: json.posterPath || '',
              backdropPath: json.backdropPath || '',
            },
          };
        })
      );

      if (cancelled) return;

      setDetailsMap((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (result.status !== 'fulfilled' || !result.value?.key) continue;
          next[result.value.key] = result.value.data;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [metadataCandidates, pageKey, detailsMap]);

  const heroSlides = useMemo(() => {
    const out = [];
    const seen = new Set();

    for (const rule of rules) {
      const sourceKey = String(rule?.source || '').trim();
      const requestedCount = Math.max(0, Number(rule?.count || 0) || 0);
      if (!sourceKey || requestedCount <= 0) continue;

      const sourceList = Array.isArray(normalizedSources[sourceKey]) ? normalizedSources[sourceKey] : [];
      const sorted = sortItemsForRule(sourceList, rule, detailsMap);

      let addedForRule = 0;
      for (const item of sorted) {
        if (!item?.heroKey || seen.has(item.heroKey)) continue;
        seen.add(item.heroKey);
        out.push(item);
        addedForRule += 1;
        if (addedForRule >= requestedCount) break;
      }
    }

    return out;
  }, [rules, normalizedSources, detailsMap]);

  const handlePrimaryAction = (item) => {
    if (!item) return;

    if (Number(item?.heroDirectPlayId || 0) > 0) {
      try {
        const currentHref =
          typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search}${window.location.hash}`
            : '/movies';
        sessionStorage.setItem('3jtv.playIntent', String(Date.now()));
        persistMovieReturnState({
          href: currentHref,
          movieId: Number(item.heroDirectPlayId),
          scrollY: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
        });
        persistMoviePlaySeed(
          {
            id: Number(item.heroDirectPlayId),
            title: item?.title,
            image: item?.image,
            plot: item?.plot,
            year: item?.year,
            genre: item?.genre,
            duration: item?.duration,
            rating: item?.rating,
            ext: item?.ext,
          },
          { backHref: currentHref }
        );
      } catch {}
      window.location.href = `/watch/movie/${Number(item.heroDirectPlayId)}?auto=1`;
      return;
    }

    const href = String(item?.heroHref || item?.href || '').trim();
    if (href) window.location.href = href;
  };

  const handleDetails = (item) => {
    const href = String(item?.heroHref || item?.href || '').trim();
    if (href) window.location.href = href;
  };

  if (!heroSlides.length) {
    return loading ? <HeroSkeleton headerH={headerH} /> : null;
  }

  return (
    <HeroCarousel
      items={heroSlides}
      initialDetailsMap={detailsMap}
      onPlay={handlePrimaryAction}
      onDetails={handleDetails}
    />
  );
}
