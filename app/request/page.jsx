'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import Protected from '../../components/Protected';
import { useSession } from '../../components/SessionProvider';
import { readJsonSafe } from '../../lib/readJsonSafe';

const FILTERS = [
  { id: 'popular', label: 'Popular' },
  { id: 'tagalog', label: 'Tagalog' },
  { id: 'anime', label: 'Anime' },
  { id: 'action', label: 'Action' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'horror', label: 'Horror' },
  { id: 'romance', label: 'Romance' },
  { id: 'drama', label: 'Drama' },
  { id: 'scifi', label: 'Sci-fi' },
];

function normalizeType(value) {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'movie') return 'movie';
  if (s === 'tv' || s === 'series') return 'tv';
  return 'all';
}

function normalizeFilter(value) {
  const s = String(value || '').trim().toLowerCase();
  if (FILTERS.find((x) => x.id === s)) return s;
  return 'popular';
}

function mediaKey(item) {
  const type = String(item?.mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  return `${type}:${Number(item?.tmdbId || 0)}`;
}

function mediaKeyFromPair(tmdbId, mediaType) {
  const type = String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  return `${type}:${Number(tmdbId || 0)}`;
}

function tmdbImage(path, size = 'w500') {
  const p = String(path || '').trim();
  if (!p) return '/images/placeholder.png';
  if (p.startsWith('http')) return p;
  return `https://image.tmdb.org/t/p/${size}${p}`;
}

function yearFromDate(date) {
  const s = String(date || '').trim();
  const m = s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

function fmtDateTime(ts) {
  const n = Number(ts || 0);
  if (!n) return '—';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '—';
  }
}

function requestStatusLabel(tags, status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return String(tags?.pending || 'Pending');
  if (s === 'approved') return String(tags?.approved || 'Approved');
  if (s === 'available_now') return String(tags?.availableNow || 'Available Now');
  if (s === 'rejected') return String(tags?.rejected || 'Rejected');
  if (s === 'archived') return String(tags?.archived || 'Archived');
  return s ? s.replaceAll('_', ' ') : '';
}

function requestStatusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pending') return 'border-yellow-500/30 bg-yellow-500/15 text-yellow-100';
  if (s === 'approved') return 'border-blue-500/30 bg-blue-500/15 text-blue-100';
  if (s === 'available_now') return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100';
  if (s === 'rejected') return 'border-red-500/30 bg-red-500/15 text-red-100';
  if (s === 'archived') return 'border-neutral-700 bg-neutral-800/40 text-neutral-200';
  return 'border-neutral-700 bg-neutral-800/40 text-neutral-200';
}

function clampPositiveInt(value, min = 1, max = 999) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < min || v > max) return null;
  return v;
}

function seasonRows(input) {
  return (Array.isArray(input) ? input : [])
    .map((x) => ({
      seasonNumber: clampPositiveInt(x?.seasonNumber ?? x?.season_number, 1, 99),
      episodeCount: clampPositiveInt(x?.episodeCount ?? x?.episode_count, 1, 500),
      name: String(x?.name || '').trim(),
      airDate: String(x?.airDate || x?.air_date || '').trim(),
      posterPath: String((x?.posterPath ?? x?.poster_path) || '').trim(),
      episodes: (Array.isArray(x?.episodes) ? x.episodes : [])
        .map((ep) => ({
          episodeNumber: clampPositiveInt(ep?.episodeNumber ?? ep?.episode_number, 1, 999),
          name: String(ep?.name || '').trim(),
          stillPath: String((ep?.stillPath ?? ep?.still_path) || '').trim(),
          overview: String(ep?.overview || '').trim(),
          airDate: String((ep?.airDate ?? ep?.air_date) || '').trim(),
          runtime: clampPositiveInt(ep?.runtime, 1, 500),
          availableNow: Boolean(ep?.availableNow),
        }))
        .filter((ep) => Number(ep.episodeNumber) > 0)
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    }))
    .filter((x) => Number(x.seasonNumber) > 0 && Number(x.episodeCount) > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

function findSeasonMeta(seasons, seasonNumber) {
  const rows = seasonRows(seasons);
  const target = clampPositiveInt(seasonNumber, 1, 99);
  const found = rows.find((x) => x.seasonNumber === target);
  return found || rows[0] || null;
}

function episodeRowsForSeason(seasons, seasonNumber) {
  const meta = findSeasonMeta(seasons, seasonNumber);
  if (!meta?.episodeCount) return [];
  if (Array.isArray(meta?.episodes) && meta.episodes.length) return meta.episodes;
  return Array.from({ length: meta.episodeCount }, (_, i) => {
    const episodeNumber = i + 1;
    return {
      episodeNumber,
      name: `Episode ${episodeNumber}`,
      stillPath: '',
      overview: '',
      airDate: '',
      runtime: null,
      availableNow: false,
    };
  });
}

function seriesAvailabilityCounts(seasons) {
  const rows = seasonRows(seasons);
  let total = 0;
  let available = 0;
  for (const season of rows) {
    const episodes = episodeRowsForSeason(rows, season.seasonNumber);
    total += episodes.length;
    available += episodes.filter((episode) => episode.availableNow).length;
  }
  return {
    total,
    available,
    allAvailable: total > 0 && available >= total,
  };
}

function normalizeEpisodeNumbers(input, maxEpisode = 999) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const value = clampPositiveInt(raw, 1, maxEpisode);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.sort((a, b) => a - b);
}

function formatEpisodeListLabel(episodes) {
  const rows = normalizeEpisodeNumbers(episodes, 999);
  if (!rows.length) return '';
  if (rows.length <= 6) return rows.join(', ');
  return `${rows.slice(0, 6).join(', ')} +${rows.length - 6} more`;
}

function normalizeSeasonEpisodePairs(input, seasons = []) {
  const rows = seasonRows(seasons);
  const seasonMap = new Map(rows.map((season) => [season.seasonNumber, season]));
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const seasonNumber = clampPositiveInt(raw?.seasonNumber ?? raw?.season, 1, 99);
    if (!seasonNumber) continue;
    const season = seasonMap.get(seasonNumber);
    const seasonEpisodeMax = Math.max(1, Number(season?.episodeCount || 999));
    const episodeNumber = clampPositiveInt(raw?.episodeNumber ?? raw?.episode, 1, seasonEpisodeMax);
    if (!episodeNumber) continue;
    const key = `${seasonNumber}:${episodeNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ seasonNumber, episodeNumber });
  }
  return out.sort((a, b) => (a.seasonNumber === b.seasonNumber ? a.episodeNumber - b.episodeNumber : a.seasonNumber - b.seasonNumber));
}

function seasonEpisodePairKey(seasonNumber, episodeNumber) {
  return `${Number(seasonNumber || 0)}:${Number(episodeNumber || 0)}`;
}

function sameNumberList(left, right) {
  const a = normalizeEpisodeNumbers(left, 999);
  const b = normalizeEpisodeNumbers(right, 999);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameSeasonEpisodePairList(left, right) {
  const a = normalizeSeasonEpisodePairs(left, []);
  const b = normalizeSeasonEpisodePairs(right, []);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].seasonNumber !== b[i].seasonNumber) return false;
    if (a[i].episodeNumber !== b[i].episodeNumber) return false;
  }
  return true;
}

function normalizeSeriesSelection(input, mediaType, seasons = [], options = {}) {
  const allowEmpty = Boolean(options?.allowEmpty);
  const mt = String(mediaType || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
  if (mt !== 'tv') {
    return {
      requestScope: 'title',
      seasonNumber: null,
      episodeNumber: null,
      requestDetailLabel: '',
      requestUnits: 1,
      episodeNumbers: [],
    };
  }

  const requestScope =
    String(input?.requestScope || input?.scope || 'episode').trim().toLowerCase() === 'season'
      ? 'season'
      : 'episode';
  const rawSeasonNumber = clampPositiveInt(input?.seasonNumber ?? input?.season, 1, 99);
  const season = findSeasonMeta(seasons, rawSeasonNumber);
  const seasonNumber = season?.seasonNumber || rawSeasonNumber || 1;
  const seasonEpisodeCount = Math.max(1, Number(season?.episodeCount || 1));
  const seasonEpisodePairsInput = normalizeSeasonEpisodePairs(
    input?.seasonEpisodePairs ?? input?.requestedSeasonEpisodes,
    seasons
  );
  const requestUnitsInput =
    clampPositiveInt(input?.requestUnits ?? input?.seasonEpisodeCount ?? input?.requestedEpisodes, 1, 500) || null;
  const episodeNumbersInput = normalizeEpisodeNumbers(
    input?.episodeNumbers ?? input?.requestedEpisodeNumbers ?? input?.episodes,
    seasonEpisodeCount
  );
  const candidateEpisode = clampPositiveInt(input?.episodeNumber ?? input?.episode, 1, seasonEpisodeCount);

  if (seasonEpisodePairsInput.length > 0) {
    const seasonSet = new Set(seasonEpisodePairsInput.map((pair) => pair.seasonNumber));
    if (seasonEpisodePairsInput.length === 1) {
      const only = seasonEpisodePairsInput[0];
      return {
        requestScope: 'episode',
        seasonNumber: only.seasonNumber,
        episodeNumber: only.episodeNumber,
        requestDetailLabel: `Season ${only.seasonNumber} · Episode ${only.episodeNumber}`,
        requestUnits: 1,
        episodeNumbers: [only.episodeNumber],
        seasonEpisodePairs: seasonEpisodePairsInput,
      };
    }
    if (seasonSet.size === 1) {
      const onlySeason = seasonEpisodePairsInput[0].seasonNumber;
      const episodes = seasonEpisodePairsInput.map((pair) => pair.episodeNumber);
      return {
        requestScope: 'season',
        seasonNumber: onlySeason,
        episodeNumber: null,
        requestDetailLabel: `Season ${onlySeason} · Episodes ${formatEpisodeListLabel(episodes)}`,
        requestUnits: seasonEpisodePairsInput.length,
        episodeNumbers: episodes,
        seasonEpisodePairs: seasonEpisodePairsInput,
      };
    }
    return {
      requestScope: 'season',
      seasonNumber: seasonEpisodePairsInput[0]?.seasonNumber || null,
      episodeNumber: null,
      requestDetailLabel: `${seasonEpisodePairsInput.length} episodes across ${seasonSet.size} seasons`,
      requestUnits: seasonEpisodePairsInput.length,
      episodeNumbers: [],
      seasonEpisodePairs: seasonEpisodePairsInput,
    };
  }

  const hasNoEpisodeInput =
    !episodeNumbersInput.length &&
    !candidateEpisode &&
    !clampPositiveInt(input?.requestUnits ?? input?.seasonEpisodeCount ?? input?.requestedEpisodes, 1, 500);
  if (allowEmpty && hasNoEpisodeInput) {
    return {
      requestScope: 'season',
      seasonNumber: null,
      episodeNumber: null,
      requestDetailLabel: '',
      requestUnits: 0,
      episodeNumbers: [],
      seasonEpisodePairs: [],
    };
  }

  let episodeNumbers = episodeNumbersInput;
  if (!episodeNumbers.length && candidateEpisode) episodeNumbers = [candidateEpisode];
  if (!episodeNumbers.length && requestScope === 'season') {
    const requestedUnits = requestUnitsInput ? Math.min(seasonEpisodeCount, requestUnitsInput) : seasonEpisodeCount;
    episodeNumbers = Array.from({ length: requestedUnits }, (_, i) => i + 1);
  }
  if (!episodeNumbers.length) episodeNumbers = [1];

  const requestUnits = Math.max(1, episodeNumbers.length);
  const seasonEpisodePairs = episodeNumbers.map((episodeNumber) => ({ seasonNumber, episodeNumber }));
  if (requestUnits > 1 || requestScope === 'season') {
    return {
      requestScope: 'season',
      seasonNumber,
      episodeNumber: null,
      requestDetailLabel: `Season ${seasonNumber} · Episodes ${formatEpisodeListLabel(episodeNumbers)}`,
      requestUnits,
      episodeNumbers,
      seasonEpisodePairs,
    };
  }

  const episodeNumber = episodeNumbers[0] || 1;
  return {
    requestScope: 'episode',
    seasonNumber,
    episodeNumber,
    requestDetailLabel: `Season ${seasonNumber} · Episode ${episodeNumber}`,
    requestUnits: 1,
    episodeNumbers: [episodeNumber],
    seasonEpisodePairs,
  };
}

function selectedDetailLabel(item) {
  const mt = String(item?.mediaType || '').toLowerCase();
  if (mt !== 'tv') return '';
  if (String(item?.requestDetailLabel || '').trim()) return String(item.requestDetailLabel).trim();
  return normalizeSeriesSelection(item, mt, []).requestDetailLabel;
}

function selectedCardChip(item) {
  const mt = String(item?.mediaType || '').toLowerCase();
  if (mt !== 'tv') return '';
  if (String(item?.requestScope || '').toLowerCase() === 'season' && String(item?.requestDetailLabel || '').trim()) {
    const units = Math.max(1, Number(item?.requestUnits || 1));
    const seasonCount = new Set(
      normalizeSeasonEpisodePairs(item?.seasonEpisodePairs, []).map((pair) => pair.seasonNumber)
    ).size;
    if (seasonCount > 1 && units > 1) return `${units} eps`;
    const seasonNumber = Number(item?.seasonNumber || 0);
    if (seasonNumber > 0 && units > 1) return `S${seasonNumber} • ${units} eps`;
    return String(item.requestDetailLabel).trim();
  }
  const normalized = normalizeSeriesSelection(item, mt);
  if (normalized.requestScope === 'episode') {
    return `S${normalized.seasonNumber}E${normalized.episodeNumber}`;
  }
  return normalized.requestDetailLabel;
}

function useToasts() {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), 2600);
  }, []);
  const View = () => (
    <div className="pointer-events-none fixed inset-0 z-[120] flex flex-col items-center justify-end gap-2 px-4 pb-5 sm:justify-start sm:pt-20">
      {items.map((x) => (
        <div
          key={x.id}
          className={
            'pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ' +
            (x.tone === 'error'
              ? 'border-red-500/35 bg-red-500/15 text-red-100'
              : x.tone === 'success'
                ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                : 'border-white/15 bg-black/60 text-neutral-100')
          }
        >
          {x.text}
        </div>
      ))}
    </div>
  );
  return { push, View };
}

export default function RequestPage() {
  const { session } = useSession();
  const username = String(session?.user?.username || '').trim();
  const streamBase = String(session?.streamBase || '').trim();
  const searchParams = useSearchParams();
  const { push, View: Toasts } = useToasts();

  const initialType = normalizeType(searchParams?.get('type'));
  const initialFilter = normalizeFilter(searchParams?.get('filter'));

  const [viewMode, setViewMode] = useState('browse');
  const [type, setType] = useState(initialType);
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [catalog, setCatalog] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErr, setCatalogErr] = useState('');

  const [stateMap, setStateMap] = useState({});
  const [quota, setQuota] = useState({
    limit: 3,
    used: 0,
    remaining: 3,
    seriesEpisodeLimit: 8,
    seriesEpisodesUsed: 0,
    seriesEpisodesRemaining: 8,
  });
  const [settings, setSettings] = useState({
    enabled: true,
    dailyLimitDefault: 3,
    seriesEpisodeLimitDefault: 8,
    defaultLandingCategory: 'popular',
    statusTags: {},
  });
  const [baseDataReady, setBaseDataReady] = useState(false);
  const [myRequests, setMyRequests] = useState([]);

  const [selected, setSelected] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [requestedModal, setRequestedModal] = useState(null);
  const [remindBusy, setRemindBusy] = useState(false);
  const [seriesPicker, setSeriesPicker] = useState(null);
  const [seriesPickerMeta, setSeriesPickerMeta] = useState({
    key: '',
    loading: false,
    error: '',
    seasons: [],
  });
  const [seriesExpandedSeason, setSeriesExpandedSeason] = useState(null);

  const didApplyDefaultFilter = useRef(false);
  const sentinelRef = useRef(null);

  useEffect(() => setType(initialType), [initialType]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  const selectedByKey = useMemo(() => {
    const out = new Map();
    for (const item of selected) out.set(mediaKey(item), item);
    return out;
  }, [selected]);
  const selectedKeys = useMemo(() => new Set(selectedByKey.keys()), [selectedByKey]);

  const resolveCardState = useCallback(
    (item) => {
      const key = mediaKey(item);
      const row = stateMap[key];
      if (row?.state === 'available') return { state: 'available', meta: row };
      if (row?.state === 'requested' || row?.requestId) return { state: 'requested', meta: row };
      return { state: 'requestable', meta: row || null };
    },
    [stateMap]
  );

  const hydrateBaseData = useCallback(async () => {
    if (!username) return;
    setBaseDataReady(false);
    const params = new URLSearchParams();
    params.set('username', username);
    if (streamBase) params.set('streamBase', streamBase);
    const r = await fetch(`/api/public/requests?${params.toString()}`, { cache: 'no-store' });
    const j = await readJsonSafe(r);
    if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load request settings');

    const active = j?.activeStates && typeof j.activeStates === 'object' ? j.activeStates : {};
    const mapped = {};
    for (const [k, v] of Object.entries(active)) {
      mapped[k] = { state: 'requested', ...v };
    }

    setStateMap((prev) => ({ ...prev, ...mapped }));
    setSettings(j?.settings || {});
    setMyRequests(Array.isArray(j?.myRequests) ? j.myRequests : []);
    if (j?.quota) setQuota(j.quota);
    setBaseDataReady(true);

    if (!didApplyDefaultFilter.current && !searchParams?.get('filter')) {
      setFilter(normalizeFilter(j?.settings?.defaultLandingCategory));
      didApplyDefaultFilter.current = true;
    }
  }, [username, streamBase, searchParams]);

  const updateStatesForItems = useCallback(
    async (items) => {
      if (!username || !streamBase) return;
      if (!Array.isArray(items) || !items.length) return;
      const r = await fetch('/api/public/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'state',
          username,
          streamBase,
          items: items.map((x) => ({
            tmdbId: x.tmdbId,
            mediaType: x.mediaType,
            title: x.title,
            originalTitle: x.originalTitle,
            releaseDate: x.releaseDate,
            posterPath: x.posterPath,
            backdropPath: x.backdropPath,
            overview: x.overview,
            requestScope: x.requestScope,
            seasonNumber: x.seasonNumber,
            episodeNumber: x.episodeNumber,
            requestDetailLabel: x.requestDetailLabel,
            requestUnits: x.requestUnits,
            episodeNumbers: normalizeEpisodeNumbers(x.episodeNumbers, 999),
            seasonEpisodePairs: normalizeSeasonEpisodePairs(x.seasonEpisodePairs, []),
          })),
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) return;
      const states = j?.states && typeof j.states === 'object' ? j.states : {};
      setStateMap((prev) => ({ ...prev, ...states }));
      if (j?.quota) setQuota(j.quota);
    },
    [username, streamBase]
  );

  const fetchCatalogPage = useCallback(
    async ({ targetPage, reset }) => {
      const params = new URLSearchParams();
      params.set('type', type);
      params.set('filter', filter);
      params.set('page', String(targetPage));
      if (debouncedQuery) params.set('q', debouncedQuery);

      setCatalogLoading(true);
      setCatalogErr('');
      try {
        const r = await fetch(`/api/public/requests/catalog?${params.toString()}`, { cache: 'no-store' });
        const j = await readJsonSafe(r);
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load catalog');
        const rows = Array.isArray(j?.items) ? j.items : [];
        setTotalPages(Number(j?.totalPages || 1) || 1);
        setCatalog((prev) => {
          if (reset) return rows;
          const next = [...prev];
          const seen = new Set(next.map((x) => mediaKey(x)));
          for (const row of rows) {
            const key = mediaKey(row);
            if (seen.has(key)) continue;
            seen.add(key);
            next.push(row);
          }
          return next;
        });
        updateStatesForItems(rows);
      } catch (e) {
        setCatalogErr(e?.message || 'Failed to load catalog');
      } finally {
        setCatalogLoading(false);
      }
    },
    [type, filter, debouncedQuery, updateStatesForItems]
  );

  useEffect(() => {
    hydrateBaseData().catch((e) => {
      push(e?.message || 'Failed to load request data', 'error');
    });
  }, [hydrateBaseData, push]);

  useEffect(() => {
    if (!baseDataReady || settings?.enabled === false) return;
    if (!username || !streamBase) return;
    setPage(1);
    fetchCatalogPage({ targetPage: 1, reset: true });
  }, [baseDataReady, settings?.enabled, username, streamBase, type, filter, debouncedQuery, fetchCatalogPage]);

  useEffect(() => {
    if (!baseDataReady || settings?.enabled === false) return;
    if (!username || !streamBase) return;
    if (page <= 1) return;
    fetchCatalogPage({ targetPage: page, reset: false });
  }, [baseDataReady, settings?.enabled, page, username, streamBase, fetchCatalogPage]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    if (catalogLoading) return;
    if (page >= totalPages) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        setPage((p) => (p < totalPages ? p + 1 : p));
      },
      { rootMargin: '800px 0px' }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [catalogLoading, page, totalPages]);

  useEffect(() => {
    if (!seriesPicker?.item?.tmdbId) {
      setSeriesPickerMeta({ key: '', loading: false, error: '', seasons: [] });
      setSeriesExpandedSeason(null);
      return;
    }

    const key = `${seriesPicker.item.tmdbId}`;
    let alive = true;
    setSeriesPickerMeta((prev) => ({
      key,
      loading: true,
      error: '',
      seasons: prev.key === key ? prev.seasons : [],
    }));

    const run = async () => {
      const r = await fetch('/api/public/requests/series-options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          tmdbId: seriesPicker.item.tmdbId,
          title: seriesPicker.item.title,
          originalTitle: seriesPicker.item.originalTitle,
          releaseDate: seriesPicker.item.releaseDate,
          streamBase,
        }),
      });
      const j = await readJsonSafe(r);
      if (!alive) return;
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load series options.');
      setSeriesPickerMeta({
        key,
        loading: false,
        error: '',
        seasons: seasonRows(j?.seasons),
      });
    };

    run().catch((e) => {
      if (!alive) return;
      setSeriesPickerMeta((prev) => ({
        ...prev,
        key,
        loading: false,
        error: e?.message || 'Failed to load series options.',
      }));
    });

    return () => {
      alive = false;
    };
  }, [
    seriesPicker?.item?.tmdbId,
    seriesPicker?.item?.title,
    seriesPicker?.item?.originalTitle,
    seriesPicker?.item?.releaseDate,
    streamBase,
  ]);

  useEffect(() => {
    if (!seriesPicker || !seriesPickerMeta.seasons.length) return;
    const normalized = normalizeSeriesSelection(seriesPicker, 'tv', seriesPickerMeta.seasons, {
      allowEmpty: true,
    });
    if (
      normalized.requestScope === seriesPicker.requestScope &&
      normalized.seasonNumber === seriesPicker.seasonNumber &&
      normalized.episodeNumber === seriesPicker.episodeNumber &&
      normalized.requestUnits === seriesPicker.requestUnits &&
      sameNumberList(normalized.episodeNumbers, seriesPicker.episodeNumbers) &&
      sameSeasonEpisodePairList(normalized.seasonEpisodePairs, seriesPicker.seasonEpisodePairs)
    ) {
      setSeriesExpandedSeason((prev) => prev || normalized.seasonNumber || null);
      return;
    }
    setSeriesPicker((prev) =>
      prev
        ? {
            ...prev,
            requestScope: normalized.requestScope,
            seasonNumber: normalized.seasonNumber,
            episodeNumber: normalized.episodeNumber,
            requestUnits: normalized.requestUnits,
            episodeNumbers: normalized.episodeNumbers,
            seasonEpisodePairs: normalized.seasonEpisodePairs,
          }
        : prev
    );
    setSeriesExpandedSeason((prev) => prev || normalized.seasonNumber || null);
  }, [
    seriesPicker,
    seriesPickerMeta.seasons,
  ]);

  const closeSeriesPicker = useCallback(() => {
    setSeriesPicker(null);
    setSeriesExpandedSeason(null);
  }, []);

  useEffect(() => {
    if (!seriesPicker?.item) return;
    if (seriesPickerMeta.loading || seriesPickerMeta.error) return;
    const summary = seriesAvailabilityCounts(seriesPickerMeta.seasons);
    if (!summary.allAvailable) return;
    const key = mediaKey(seriesPicker.item);
    setStateMap((prev) => ({
      ...prev,
      [key]: {
        state: 'available',
        availableNow: true,
      },
    }));
    setSelected((prev) => prev.filter((item) => mediaKey(item) !== key));
    push('This series is already fully available on your server.', 'info');
    closeSeriesPicker();
  }, [
    seriesPicker,
    seriesPickerMeta.loading,
    seriesPickerMeta.error,
    seriesPickerMeta.seasons,
    closeSeriesPicker,
    push,
  ]);

  const removeSelectedItem = useCallback((item) => {
    const key = mediaKey(item);
    setSelected((prev) => prev.filter((x) => mediaKey(x) !== key));
  }, []);

  const upsertSelectedItem = useCallback(
    (item) => {
      const key = mediaKey(item);
      setSelected((prev) => {
        const nextItem =
          String(item?.mediaType || '').toLowerCase() === 'tv'
            ? { ...item, ...normalizeSeriesSelection(item, 'tv', seriesPickerMeta.seasons) }
            : item;
        const idx = prev.findIndex((x) => mediaKey(x) === key);
        const currentSeriesUnits = prev.reduce((sum, row) => {
          if (String(row?.mediaType || '').toLowerCase() !== 'tv') return sum;
          return sum + Math.max(1, Number(row?.requestUnits || 1));
        }, 0);
        const nextSeriesUnits = Math.max(1, Number(nextItem?.requestUnits || 1));
        const seriesRemaining = Math.max(
          0,
          Number(
            quota?.seriesEpisodesRemaining ??
              quota?.series?.remaining ??
              quota?.seriesEpisodeLimit ??
              settings?.seriesEpisodeLimitDefault ??
              8
          )
        );

        if (String(nextItem?.mediaType || '').toLowerCase() === 'tv') {
          const withoutCurrent =
            idx >= 0 && String(prev[idx]?.mediaType || '').toLowerCase() === 'tv'
              ? currentSeriesUnits - Math.max(1, Number(prev[idx]?.requestUnits || 1))
              : currentSeriesUnits;
          if (withoutCurrent + nextSeriesUnits > seriesRemaining) {
            push(`Series limit reached (${seriesRemaining} episodes remaining today).`, 'error');
            return prev;
          }
        }

        if (idx >= 0) {
          const next = [...prev];
          next[idx] = nextItem;
          return next;
        }
        const remaining = Math.max(0, Number(quota?.remaining ?? quota?.limit ?? 3));
        if (prev.length >= remaining) {
          push(`Daily request limit reached (${Number(quota?.limit || 3)} max).`, 'error');
          return prev;
        }
        return [...prev, nextItem];
      });
    },
    [push, quota, settings?.seriesEpisodeLimitDefault, seriesPickerMeta.seasons]
  );

  const toggleSelect = useCallback(
    (item) => {
      const key = mediaKey(item);
      if (selectedByKey.has(key)) {
        removeSelectedItem(item);
        return;
      }
      upsertSelectedItem(item);
    },
    [selectedByKey, removeSelectedItem, upsertSelectedItem]
  );

  const openSeriesPicker = useCallback(
    (item) => {
      const key = mediaKey(item);
      const existing = selectedByKey.get(key);
      const normalized = existing
        ? normalizeSeriesSelection(existing, 'tv', [])
        : {
            requestScope: 'season',
            seasonNumber: null,
            episodeNumber: null,
            requestDetailLabel: '',
            requestUnits: 0,
            episodeNumbers: [],
            seasonEpisodePairs: [],
          };
      setSeriesPicker({
        item,
        requestScope: normalized.requestScope || 'season',
        seasonNumber: normalized.seasonNumber || null,
        episodeNumber: normalized.episodeNumber || null,
        requestUnits: Math.max(0, Number(existing?.requestUnits ?? normalized.requestUnits ?? 0)),
        episodeNumbers: normalizeEpisodeNumbers(existing?.episodeNumbers || normalized.episodeNumbers, 999),
        seasonEpisodePairs: normalizeSeasonEpisodePairs(
          existing?.seasonEpisodePairs || normalized.seasonEpisodePairs,
          seriesPickerMeta.seasons
        ),
        editing: Boolean(existing),
      });
    },
    [selectedByKey, seriesPickerMeta.seasons]
  );

  const applySeriesPicker = useCallback(() => {
    if (!seriesPicker?.item) return;
    if (!seriesPickerMeta.seasons.length) {
      push('Series details are still loading. Please wait.', 'error');
      return;
    }
    const normalized = normalizeSeriesSelection(seriesPicker, 'tv', seriesPickerMeta.seasons, {
      allowEmpty: true,
    });
    if (Number(normalized?.requestUnits || 0) <= 0) {
      push('Select at least one episode first.', 'error');
      return;
    }
    upsertSelectedItem({
      ...seriesPicker.item,
      requestScope: normalized.requestScope,
      seasonNumber: normalized.seasonNumber,
      episodeNumber: normalized.episodeNumber,
      requestDetailLabel: normalized.requestDetailLabel,
      requestUnits: normalized.requestUnits,
      episodeNumbers: normalized.episodeNumbers,
      seasonEpisodePairs: normalized.seasonEpisodePairs,
    });
    closeSeriesPicker();
  }, [seriesPicker, seriesPickerMeta.seasons, push, upsertSelectedItem, closeSeriesPicker]);

  const removeSeriesPickerSelection = useCallback(() => {
    if (!seriesPicker?.item) return;
    removeSelectedItem(seriesPicker.item);
    closeSeriesPicker();
  }, [seriesPicker, removeSelectedItem, closeSeriesPicker]);

  const onCardClick = useCallback(
    (item) => {
      const resolved = resolveCardState(item);
      if (resolved.state === 'available') return;
      if (resolved.state === 'requested') {
        setRequestedModal({ item, meta: resolved.meta || {} });
        return;
      }
      if (String(item?.mediaType || '').toLowerCase() === 'tv') {
        openSeriesPicker(item);
        return;
      }
      toggleSelect(item);
    },
    [resolveCardState, toggleSelect, openSeriesPicker]
  );

  const sendRemind = useCallback(async () => {
    if (!requestedModal?.item || !username) return;
    setRemindBusy(true);
    try {
      const r = await fetch('/api/public/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'remind',
          username,
          tmdbId: requestedModal.item.tmdbId,
          mediaType: requestedModal.item.mediaType,
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to subscribe reminder');
      push(j?.subscribed ? 'Reminder added.' : 'You are already subscribed.', 'success');
      setRequestedModal(null);
    } catch (e) {
      push(e?.message || 'Failed to subscribe reminder', 'error');
    } finally {
      setRemindBusy(false);
    }
  }, [requestedModal, username, push]);

  const submitSelected = useCallback(async () => {
    if (!selected.length || !username || !streamBase) return;
    setSubmitting(true);
    try {
      const r = await fetch('/api/public/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          username,
          streamBase,
          items: selected.map((x) => ({
            tmdbId: x.tmdbId,
            mediaType: x.mediaType,
            title: x.title,
            originalTitle: x.originalTitle,
            releaseDate: x.releaseDate,
            posterPath: x.posterPath,
            backdropPath: x.backdropPath,
            overview: x.overview,
            requestScope: x.requestScope,
            seasonNumber: x.seasonNumber,
            episodeNumber: x.episodeNumber,
            requestDetailLabel: x.requestDetailLabel,
            requestUnits: x.requestUnits,
            episodeNumbers: normalizeEpisodeNumbers(x.episodeNumbers, 999),
            seasonEpisodePairs: normalizeSeasonEpisodePairs(x.seasonEpisodePairs, []),
          })),
        }),
      });
      const j = await readJsonSafe(r);
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to submit requests');

      if (j?.quota) setQuota(j.quota);
      await updateStatesForItems(selected);
      await hydrateBaseData().catch(() => {});

      const created = Number(Array.isArray(j?.created) ? j.created.length : 0);
      const duplicates = Number(Array.isArray(j?.duplicates) ? j.duplicates.length : 0);
      const rejectedList = Array.isArray(j?.rejected) ? j.rejected : [];
      const rejectedByLimit = rejectedList.filter((x) => String(x?.reason || '') === 'daily_limit_exceeded');
      const rejectedBySeriesEpisodeLimit = rejectedList.filter(
        (x) => String(x?.reason || '') === 'series_episode_limit_exceeded'
      );
      const rejectedByAvailable = rejectedList.filter((x) => String(x?.reason || '') === 'available_now');
      const rejectedOther = rejectedList.filter((x) => {
        const reason = String(x?.reason || '');
        return (
          reason !== 'daily_limit_exceeded' &&
          reason !== 'series_episode_limit_exceeded' &&
          reason !== 'available_now'
        );
      });

      const keepSelection = new Set(
        [...rejectedByLimit, ...rejectedBySeriesEpisodeLimit].map((x) =>
          mediaKeyFromPair(x?.tmdbId, x?.mediaType)
        )
      );
      setSelected((prev) => prev.filter((x) => keepSelection.has(mediaKey(x))));

      if (created > 0) {
        push(`Submitted ${created} request${created > 1 ? 's' : ''}.`, 'success');
      }
      if (duplicates > 0) {
        push(
          `${duplicates} title${duplicates > 1 ? 's were' : ' was'} already requested.`,
          'info'
        );
      }
      if (rejectedByAvailable.length > 0) {
        push(
          `${rejectedByAvailable.length} title${
            rejectedByAvailable.length > 1 ? 's are' : ' is'
          } already available now.`,
          'info'
        );
      }
      if (rejectedByLimit.length > 0) {
        push(
          `Daily limit reached. ${rejectedByLimit.length} title${
            rejectedByLimit.length > 1 ? 's were' : ' was'
          } kept in your cart.`,
          'error'
        );
      }
      if (rejectedBySeriesEpisodeLimit.length > 0) {
        push(
          `Series episode limit reached. ${rejectedBySeriesEpisodeLimit.length} item${
            rejectedBySeriesEpisodeLimit.length > 1 ? 's were' : ' was'
          } kept in your cart.`,
          'error'
        );
      }
      if (rejectedOther.length > 0) {
        push(
          `Skipped ${rejectedOther.length} title${
            rejectedOther.length > 1 ? 's' : ''
          } due to validation.`,
          'info'
        );
      }
      if (created === 0 && duplicates === 0 && rejectedList.length === 0) {
        push('No new requests were submitted.', 'info');
      }
    } catch (e) {
      push(e?.message || 'Failed to submit requests', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [selected, username, streamBase, updateStatesForItems, hydrateBaseData, push]);

  const maxLimit = Number(quota?.limit || settings?.dailyLimitDefault || 3) || 3;
  const maxSeriesEpisodeLimit =
    Number(
      (quota?.seriesEpisodeLimit ?? quota?.series?.limit ?? settings?.seriesEpisodeLimitDefault) || 8
    ) || 8;
  const seriesQuotaRemaining = Math.max(
    0,
    Number(quota?.seriesEpisodesRemaining ?? quota?.series?.remaining ?? maxSeriesEpisodeLimit)
  );
  const seriesPickerItemKey = seriesPicker?.item ? mediaKey(seriesPicker.item) : '';
  const seriesUnitsInOtherSelections = selected.reduce((sum, row) => {
    if (String(row?.mediaType || '').toLowerCase() !== 'tv') return sum;
    if (seriesPickerItemKey && mediaKey(row) === seriesPickerItemKey) return sum;
    return sum + Math.max(1, Number(row?.requestUnits || 1));
  }, 0);
  const seriesPickerEpisodeLimit = Math.max(0, seriesQuotaRemaining - seriesUnitsInOtherSelections);
  const normalizedSeriesPickerSelection = seriesPicker
    ? normalizeSeriesSelection(seriesPicker, 'tv', seriesPickerMeta.seasons, {
        allowEmpty: true,
      })
    : null;

  const toggleSeriesEpisode = useCallback(
    (seasonNumber, episodeNumber) => {
      if (!seriesPicker) return;
      const season = findSeasonMeta(seriesPickerMeta.seasons, seasonNumber);
      if (!season) return;
      const episode = episodeRowsForSeason(seriesPickerMeta.seasons, seasonNumber).find(
        (row) => Number(row.episodeNumber) === Number(episodeNumber)
      );
      if (!episode) return;
      if (episode.availableNow) {
        push('This episode is already available on your server.', 'info');
        return;
      }

      const basePairs = normalizeSeasonEpisodePairs(
        normalizedSeriesPickerSelection?.seasonEpisodePairs,
        seriesPickerMeta.seasons
      );
      const key = seasonEpisodePairKey(seasonNumber, episodeNumber);
      const exists = basePairs.some(
        (pair) => seasonEpisodePairKey(pair.seasonNumber, pair.episodeNumber) === key
      );
      const nextPairs = exists
        ? basePairs.filter((pair) => seasonEpisodePairKey(pair.seasonNumber, pair.episodeNumber) !== key)
        : [...basePairs, { seasonNumber, episodeNumber }];
      const uniquePairs = normalizeSeasonEpisodePairs(nextPairs, seriesPickerMeta.seasons);
      if (!exists && uniquePairs.length > seriesPickerEpisodeLimit) {
        push(`Series episode limit reached (${seriesPickerEpisodeLimit} left for cart).`, 'error');
        return;
      }
      if (!uniquePairs.length) return;

      const normalized = normalizeSeriesSelection(
        {
          requestScope: uniquePairs.length > 1 ? 'season' : 'episode',
          seasonEpisodePairs: uniquePairs,
          seasonNumber: uniquePairs[0]?.seasonNumber || seasonNumber,
          episodeNumber: uniquePairs[0]?.episodeNumber || episodeNumber,
          requestUnits: uniquePairs.length,
        },
        'tv',
        seriesPickerMeta.seasons
      );
      setSeriesPicker((prev) => (prev ? { ...prev, ...normalized } : prev));
      setSeriesExpandedSeason(seasonNumber);
    },
    [
      seriesPicker,
      seriesPickerMeta.seasons,
      seriesPickerEpisodeLimit,
      normalizedSeriesPickerSelection?.seasonEpisodePairs,
      push,
    ]
  );

  const requestAllUnavailableInSeason = useCallback(
    (seasonNumber) => {
      if (!seriesPicker) return;
      const episodes = episodeRowsForSeason(seriesPickerMeta.seasons, seasonNumber);
      const unavailable = episodes.filter((ep) => !ep.availableNow).map((ep) => ep.episodeNumber);
      if (!unavailable.length) {
        push('All episodes in this season are already available.', 'info');
        return;
      }

      const basePairs = normalizeSeasonEpisodePairs(
        normalizedSeriesPickerSelection?.seasonEpisodePairs,
        seriesPickerMeta.seasons
      );
      const keepPairs = basePairs.filter((pair) => Number(pair.seasonNumber) !== Number(seasonNumber));
      const remainingSlots = Math.max(0, seriesPickerEpisodeLimit - keepPairs.length);
      const cap = Math.max(0, Math.min(remainingSlots, unavailable.length));
      if (cap <= 0) {
        push(`Series episode limit reached (${seriesPickerEpisodeLimit} left for cart).`, 'error');
        return;
      }

      const seasonPairs = unavailable
        .slice(0, cap)
        .map((episodeNumber) => ({ seasonNumber, episodeNumber }));
      const mergedPairs = normalizeSeasonEpisodePairs([...keepPairs, ...seasonPairs], seriesPickerMeta.seasons);
      const normalized = normalizeSeriesSelection(
        {
          requestScope: mergedPairs.length > 1 ? 'season' : 'episode',
          seasonEpisodePairs: mergedPairs,
          seasonNumber: mergedPairs[0]?.seasonNumber || seasonNumber,
          episodeNumber: mergedPairs[0]?.episodeNumber || null,
          requestUnits: mergedPairs.length,
        },
        'tv',
        seriesPickerMeta.seasons
      );
      if (seasonPairs.length < unavailable.length) {
        push(
          `Selected ${seasonPairs.length}/${unavailable.length} missing episodes for this season due to quota.`,
          'info'
        );
      }
      setSeriesPicker((prev) => (prev ? { ...prev, ...normalized } : prev));
      setSeriesExpandedSeason(seasonNumber);
    },
    [
      seriesPicker,
      seriesPickerMeta.seasons,
      seriesPickerEpisodeLimit,
      normalizedSeriesPickerSelection?.seasonEpisodePairs,
      push,
    ]
  );

  if (baseDataReady && settings?.enabled === false) {
    return (
      <Protected>
        <section className="relative px-4 py-6 sm:px-6 lg:px-10">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
            <h1 className="text-2xl font-bold">Request</h1>
            <p className="mt-2 text-sm text-neutral-300">
              Requests are currently disabled by the administrator.
            </p>
          </div>
        </section>
      </Protected>
    );
  }

  return (
    <Protected>
      <section className="relative py-6 px-4 sm:px-6 lg:px-10">
        <div className="mb-5">
          <h1 className="text-2xl font-bold">Request</h1>
          <p className="mt-1 text-sm text-neutral-300">
            Choose titles to request. Daily titles: {maxLimit} (used {Number(quota?.used || 0)}). Series episodes:
            {' '}
            {maxSeriesEpisodeLimit} (used {Number(quota?.seriesEpisodesUsed || quota?.series?.used || 0)}).
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[
            { id: 'all', label: 'All' },
            { id: 'movie', label: 'Movies' },
            { id: 'tv', label: 'Series' },
          ].map((x) => (
            <button
              key={x.id}
              onClick={() => {
                setViewMode('browse');
                setType(x.id);
              }}
              className={
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition ' +
                (viewMode === 'browse' && type === x.id
                  ? 'border-[var(--brand)] bg-[var(--brand)]/20 text-white'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500')
              }
            >
              {x.label}
            </button>
          ))}
          <span className="px-1 text-sm text-neutral-600">|</span>
          <button
            onClick={() => setViewMode('mine')}
            className={
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition ' +
              (viewMode === 'mine'
                ? 'border-[var(--brand)] bg-[var(--brand)]/20 text-white'
                : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500')
            }
          >
            My Requests{myRequests.length ? ` (${myRequests.length})` : ''}
          </button>
        </div>

        {viewMode === 'mine' ? (
          <div className="space-y-3">
            {!myRequests.length ? (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-5 text-sm text-neutral-300">
                You have no requests yet.
              </div>
            ) : null}
            {myRequests.map((row) => {
              const status = String(row?.status || '').toLowerCase();
              const statusLabel = requestStatusLabel(settings?.statusTags, status);
              const availableNow = Boolean(row?.availableNow);
              const detail = String(row?.requestDetailLabel || '').trim();
              return (
                <div
                  key={String(row?.id || `${row?.mediaType || 'movie'}:${row?.tmdbId || 0}`)}
                  className="flex gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3"
                >
                  <img
                    src={tmdbImage(row?.posterPath, 'w342')}
                    alt={String(row?.title || 'Requested title')}
                    className="h-24 w-16 rounded-lg border border-neutral-800 object-cover sm:h-28 sm:w-20"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="line-clamp-1 text-sm font-semibold text-neutral-100">
                        {String(row?.title || 'Untitled')}
                      </div>
                      <span className={'rounded-full border px-2 py-0.5 text-[10px] font-semibold ' + requestStatusTone(status)}>
                        {statusLabel || 'Pending'}
                      </span>
                      <span
                        className={
                          'rounded-full border px-2 py-0.5 text-[10px] font-semibold ' +
                          (availableNow
                            ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                            : 'border-neutral-700 bg-neutral-800/40 text-neutral-200')
                        }
                      >
                        {availableNow ? 'Available Now' : 'Awaiting Download'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">
                      {String(row?.mediaType || '').toLowerCase() === 'tv' ? 'Series' : 'Movie'}
                      {yearFromDate(row?.releaseDate) ? ` • ${yearFromDate(row.releaseDate)}` : ''}
                      {detail ? ` • ${detail}` : ''}
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-neutral-300 sm:grid-cols-2">
                      <div>Requested: {fmtDateTime(row?.requestedAt)}</div>
                      <div>Status Updated: {fmtDateTime(row?.statusUpdatedAt || row?.updatedAt)}</div>
                      <div>State: {availableNow ? 'Downloaded/Available' : 'Pending'}</div>
                      <div>
                        Requested Units:{' '}
                        {Math.max(
                          1,
                          Number(
                            row?.requestUnits ||
                              (String(row?.mediaType || '').toLowerCase() === 'tv' ? 1 : 1)
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div className="relative mb-4">
              <div className="flex items-center overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                <Search size={16} className="ml-3 text-neutral-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title..."
                  className="w-full bg-transparent px-3 py-3 text-sm outline-none"
                />
                {query ? (
                  <button
                    onClick={() => {
                      setQuery('');
                    }}
                    className="mr-2 rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
                    aria-label="Clear search"
                    title="Clear"
                  >
                    <X size={16} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mb-6 -mx-1 overflow-x-auto px-1">
              <div className="flex w-max gap-2">
                {FILTERS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setFilter(g.id)}
                    className={
                      'rounded-full border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ' +
                      (filter === g.id
                        ? 'border-[var(--brand)] bg-[var(--brand)]/20 text-white'
                        : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500')
                    }
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {catalogErr ? <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{catalogErr}</div> : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {catalog.map((item) => {
                const key = mediaKey(item);
                const resolved = resolveCardState(item);
                const isSelected = selectedKeys.has(key);
                const selectedItem = selectedByKey.get(key);
                const selectedChip = selectedCardChip(selectedItem);
                const statusText = String(resolved?.meta?.status || '').toLowerCase();
                const statusDisplay = requestStatusLabel(settings?.statusTags, statusText);
                return (
                  <button
                    key={key}
                    onClick={() => onCardClick(item)}
                    disabled={resolved.state === 'available'}
                    className={
                      'group relative overflow-hidden rounded-xl border bg-neutral-900 text-left transition ' +
                      (resolved.state === 'available'
                        ? 'cursor-default border-emerald-500/40'
                        : resolved.state === 'requested'
                          ? 'border-amber-500/35 hover:border-amber-400/60'
                          : isSelected
                            ? 'border-[var(--brand)] shadow-[0_0_0_1px_var(--brand)]'
                            : 'border-neutral-800 hover:border-neutral-600')
                    }
                    title={item.title || ''}
                  >
                    <div className="aspect-[2/3] overflow-hidden bg-neutral-800">
                      <img
                        src={tmdbImage(item.posterPath)}
                        alt={item.title || ''}
                        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-2">
                      <div className="line-clamp-1 text-sm font-semibold text-neutral-100">{item.title || 'Untitled'}</div>
                      <div className="mt-0.5 text-xs text-neutral-400">
                        {item.mediaType === 'tv' ? 'Series' : 'Movie'}
                        {yearFromDate(item.releaseDate) ? ` • ${yearFromDate(item.releaseDate)}` : ''}
                      </div>
                    </div>

                    {(resolved.state === 'available' || resolved.state === 'requested') ? (
                      <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 bg-gradient-to-b from-black/80 via-black/35 to-transparent" />
                    ) : null}
                    {resolved.state === 'available' ? (
                      <span className="absolute left-2 top-2 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                        Available Now
                      </span>
                    ) : null}
                    {resolved.state === 'requested' ? (
                      <span className="absolute left-2 top-2 rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                        Requested
                      </span>
                    ) : null}
                    {resolved.state === 'requested' && statusText && statusText !== 'pending' ? (
                      <span className="absolute left-2 top-7 rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] text-neutral-200">
                        {statusDisplay}
                      </span>
                    ) : null}
                    {resolved.state === 'requestable' && isSelected ? (
                      <>
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/65 via-black/15 to-black/45" />
                        <span className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-white/35 bg-[var(--brand)] text-lg font-black text-white shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_8px_20px_rgba(0,0,0,0.35)]">
                          ✓
                        </span>
                        {selectedChip ? (
                          <span className="absolute bottom-2 left-2 rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-neutral-100">
                            {selectedChip}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </button>
                );
              })}

              {!catalog.length && catalogLoading
                ? Array.from({ length: 12 }, (_, i) => (
                    <div key={`rq-sk-${i}`} className="aspect-[2/3] animate-pulse rounded-xl bg-neutral-800/70" />
                  ))
                : null}
            </div>

            <div ref={sentinelRef} className="h-10" />
            {catalogLoading && catalog.length ? <div className="text-sm text-neutral-400">Loading more...</div> : null}
            {!catalogLoading && page >= totalPages && catalog.length ? (
              <div className="text-sm text-neutral-500">You have reached the end.</div>
            ) : null}
          </>
        )}

        {requestedModal ? (
          <div className="fixed inset-0 z-[110]">
            <button className="absolute inset-0 bg-black/70" onClick={() => setRequestedModal(null)} aria-label="Close" />
            <div className="absolute left-1/2 top-1/2 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-neutral-100">{requestedModal.item?.title || 'Requested title'}</div>
                  <p className="mt-2 text-sm text-neutral-300">
                    This title has already been requested and is awaiting download today.
                  </p>
                  {String(requestedModal?.meta?.requestDetailLabel || '').trim() ? (
                    <p className="mt-2 text-xs text-neutral-400">
                      Requested as: {String(requestedModal.meta.requestDetailLabel).trim()}
                    </p>
                  ) : null}
                </div>
                <button
                  onClick={() => setRequestedModal(null)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setRequestedModal(null)}
                  className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500"
                >
                  Close
                </button>
                <button
                  disabled={remindBusy}
                  onClick={sendRemind}
                  className="rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {remindBusy ? 'Saving...' : 'Remind Me'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {seriesPicker ? (
          <div className="fixed inset-0 z-[111]">
            <button
              className="absolute inset-0 bg-black/70"
              onClick={closeSeriesPicker}
              aria-label="Close"
            />
            <div className="absolute left-1/2 top-1/2 w-[min(1240px,96vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-neutral-100">
                    Request: {seriesPicker?.item?.title || 'Series'}
                  </div>
                  <p className="mt-1 text-sm text-neutral-300">
                    Expand a season to select episodes. Episodes already in XUI are marked Available.
                  </p>
                </div>
                <button
                  onClick={closeSeriesPicker}
                  className="rounded-md p-1 text-neutral-400 hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {seriesPickerMeta.loading ? (
                <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-300">
                  Loading seasons and episodes…
                </div>
              ) : null}
              {!seriesPickerMeta.loading && seriesPickerMeta.error ? (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {seriesPickerMeta.error}
                </div>
              ) : null}
              {!seriesPickerMeta.loading && !seriesPickerMeta.error && !seasonRows(seriesPickerMeta.seasons).length ? (
                <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-300">
                  No season data found for this series.
                </div>
              ) : null}

              <div className="mt-4 max-h-[72vh] space-y-2 overflow-auto pr-1">
                {seasonRows(seriesPickerMeta.seasons).map((season) => {
                  const expanded = Number(seriesExpandedSeason || 0) === season.seasonNumber;
                  const episodes = episodeRowsForSeason(seriesPickerMeta.seasons, season.seasonNumber);
                  const unavailableEpisodes = episodes.filter((ep) => !ep.availableNow);
                  const autoPickCap = Math.max(0, Math.min(seriesPickerEpisodeLimit, unavailableEpisodes.length));
                  const selectedPairs = normalizeSeasonEpisodePairs(
                    normalizedSeriesPickerSelection?.seasonEpisodePairs,
                    seriesPickerMeta.seasons
                  );
                  const selectedEpisodeNumbers = selectedPairs
                    .filter((pair) => Number(pair.seasonNumber) === Number(season.seasonNumber))
                    .map((pair) => pair.episodeNumber);
                  const selectedSet = new Set(selectedEpisodeNumbers);
                  const activeSeason = selectedEpisodeNumbers.length > 0;
                  return (
                    <div key={season.seasonNumber} className="rounded-xl border border-neutral-800 bg-neutral-900/60">
                      <button
                        type="button"
                        onClick={() =>
                          setSeriesExpandedSeason((prev) =>
                            Number(prev || 0) === season.seasonNumber ? null : season.seasonNumber
                          )
                        }
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-neutral-100">
                            {season.name || `Season ${season.seasonNumber}`}
                          </div>
                          <div className="text-xs text-neutral-400">
                            {season.episodeCount} episodes
                            {selectedEpisodeNumbers.length > 0 ? ` • ${selectedEpisodeNumbers.length} selected` : ''}
                          </div>
                        </div>
                        <div className="text-xs text-neutral-400">{expanded ? 'Hide' : 'Show'}</div>
                      </button>

                      {expanded ? (
                        <div className="border-t border-neutral-800 px-3 py-3">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              disabled={autoPickCap <= 0}
                              onClick={() => requestAllUnavailableInSeason(season.seasonNumber)}
                              className={
                                'rounded-lg border px-3 py-1.5 text-xs font-semibold transition ' +
                                (activeSeason && selectedEpisodeNumbers.length > 1
                                  ? 'border-[var(--brand)] bg-[var(--brand)]/15 text-white'
                                  : 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500') +
                                (autoPickCap <= 0 ? ' opacity-60' : '')
                              }
                            >
                              Request all missing episodes (max {autoPickCap})
                            </button>
                            <div className="text-[11px] text-neutral-400">
                              Episodes left for cart: {seriesPickerEpisodeLimit}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {episodes.map((episode) => {
                              const isAvailableEpisode = Boolean(episode.availableNow);
                              const isSelectedEpisode = activeSeason && selectedSet.has(episode.episodeNumber);
                              const posterFallback =
                                episode.stillPath ||
                                season.posterPath ||
                                seriesPicker?.item?.backdropPath ||
                                seriesPicker?.item?.posterPath;
                              return (
                                <button
                                  key={`${season.seasonNumber}-${episode.episodeNumber}`}
                                  type="button"
                                  disabled={isAvailableEpisode}
                                  onClick={() => toggleSeriesEpisode(season.seasonNumber, episode.episodeNumber)}
                                  className={
                                    'group relative w-[180px] overflow-hidden rounded-xl border text-left transition sm:w-[190px] ' +
                                    (isSelectedEpisode
                                      ? 'border-[var(--brand)] shadow-[0_0_0_1px_var(--brand)]'
                                      : isAvailableEpisode
                                        ? 'cursor-default border-emerald-500/30 bg-neutral-900/70'
                                        : 'border-neutral-700 bg-neutral-900/70 hover:border-neutral-500')
                                  }
                                >
                                  <div className="relative aspect-video overflow-hidden bg-neutral-800">
                                    <img
                                      src={tmdbImage(posterFallback, 'w500')}
                                      alt={`${seriesPicker?.item?.title || 'Series'} Episode ${episode.episodeNumber}`}
                                      className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                                      loading="lazy"
                                    />
                                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/75" />
                                    {isAvailableEpisode ? (
                                      <span className="absolute left-2 top-2 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                                        Available
                                      </span>
                                    ) : null}
                                    {isSelectedEpisode ? (
                                      <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-white/35 bg-[var(--brand)] text-sm font-black text-white shadow-[0_8px_18px_rgba(0,0,0,0.35)]">
                                        ✓
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="px-2 py-2">
                                    <div className="line-clamp-1 text-xs font-semibold text-neutral-100">
                                      Ep {episode.episodeNumber}
                                      {episode.name ? ` · ${episode.name}` : ''}
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-neutral-400">
                                      {episode.airDate || 'No air date'}
                                      {episode.runtime ? ` • ${episode.runtime}m` : ''}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-300">
                Selected request: {normalizedSeriesPickerSelection?.requestDetailLabel || 'None'}
                {normalizedSeriesPickerSelection?.requestScope === 'season'
                  ? ` (${normalizedSeriesPickerSelection?.requestUnits || 0} episodes)`
                  : ''}
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {seriesPicker.editing ? (
                  <button
                    onClick={removeSeriesPickerSelection}
                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20"
                  >
                    Remove from Cart
                  </button>
                ) : null}
                <button
                  onClick={closeSeriesPicker}
                  className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500"
                >
                  Cancel
                </button>
                <button
                  onClick={applySeriesPicker}
                  disabled={
                    seriesPickerMeta.loading ||
                    Boolean(seriesPickerMeta.error) ||
                    !seasonRows(seriesPickerMeta.seasons).length ||
                    !Number(normalizedSeriesPickerSelection?.requestUnits || 0)
                  }
                  className="rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {seriesPicker.editing ? 'Update Selection' : 'Add to Request Cart'}
                  {Number(normalizedSeriesPickerSelection?.requestUnits || 0) > 0
                    ? ` (${Number(normalizedSeriesPickerSelection?.requestUnits || 0)})`
                    : ''}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {selected.length ? (
          <div className="fixed bottom-3 left-3 right-3 z-[105] rounded-2xl border border-neutral-700 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:right-4 sm:w-[min(420px,92vw)]">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-neutral-100">
                Your Requests ({selected.length}/{maxLimit})
              </div>
              <div className="text-right text-xs text-neutral-400">
                <div>Movies left: {Math.max(0, Number(quota?.remaining || 0))}</div>
                <div>
                  Series episodes left:{' '}
                  {Math.max(0, Number(quota?.seriesEpisodesRemaining ?? quota?.series?.remaining ?? 0))}
                </div>
              </div>
            </div>
            <div className="max-h-44 space-y-1 overflow-auto pr-1">
              {selected.map((item) => (
                <div key={mediaKey(item)} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate text-neutral-100">{item.title || 'Untitled'}</div>
                    <div className="text-neutral-400">
                      {item.mediaType === 'tv' ? 'Series' : 'Movie'}
                      {item.mediaType === 'tv' && selectedDetailLabel(item) ? ` • ${selectedDetailLabel(item)}` : ''}
                      {yearFromDate(item.releaseDate) ? ` • ${yearFromDate(item.releaseDate)}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleSelect(item)}
                    className="rounded-md border border-neutral-700 px-2 py-1 text-neutral-200 hover:border-neutral-500"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              disabled={submitting || !selected.length}
              onClick={submitSelected}
              className="mt-3 w-full rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        ) : null}
      </section>
      <Toasts />
    </Protected>
  );
}
