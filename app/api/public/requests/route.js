import { NextResponse } from 'next/server';

import {
  getRequestSettings,
  getRequestStatesForItems,
  getUserRequestQuota,
  listRequestQueue,
  submitRequests,
  subscribeToRequestReminder,
} from '../../../../lib/server/requestService';
import { parseStreamBase, xtreamWithFallback } from '../../xuione/_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XUI_CACHE_TTL_MS = 5 * 60 * 1000;
const xuiCatalogCache = new Map();

function publicSettingsShape(settings) {
  return {
    dailyLimitDefault: Number(settings?.dailyLimitDefault || 3),
    defaultLandingCategory: String(settings?.defaultLandingCategory || 'popular'),
    statusTags: settings?.statusTags || {},
  };
}

function compactActiveStates(items) {
  const out = {};
  for (const row of Array.isArray(items) ? items : []) {
    const tmdbId = Number(row?.tmdbId || 0);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    const mediaType = String(row?.mediaType || 'movie').toLowerCase() === 'tv' ? 'tv' : 'movie';
    const key = `${mediaType}:${tmdbId}`;
    out[key] = {
      requestId: row?.id || '',
      status: row?.status || 'pending',
      requestCount: Number(row?.requestCount || 0),
    };
  }
  return out;
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYear(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

function mediaTypeNorm(value) {
  const s = String(value || '').trim().toLowerCase();
  return s === 'tv' || s === 'series' ? 'tv' : 'movie';
}

function dedupeItems(items) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(items) ? items : []) {
    const tmdbId = Number(raw?.tmdbId || 0);
    const mediaType = mediaTypeNorm(raw?.mediaType);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    const key = `${mediaType}:${tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      tmdbId,
      mediaType,
      title: String(raw?.title || '').trim(),
      releaseDate: String(raw?.releaseDate || '').trim(),
      posterPath: String(raw?.posterPath || '').trim(),
      backdropPath: String(raw?.backdropPath || '').trim(),
      overview: String(raw?.overview || '').trim(),
    });
  }
  return out;
}

function stateKey(tmdbId, mediaType) {
  return `${mediaTypeNorm(mediaType)}:${Number(tmdbId || 0)}`;
}

async function loadXuiCatalog(streamBase) {
  const s = String(streamBase || '').trim();
  if (!s) return null;

  const now = Date.now();
  const cached = xuiCatalogCache.get(s);
  if (cached && now - Number(cached?.at || 0) < XUI_CACHE_TTL_MS) return cached.data;

  const { server, username, password } = parseStreamBase(s);
  const [vod, series] = await Promise.all([
    xtreamWithFallback({ server, username, password, action: 'get_vod_streams' }),
    xtreamWithFallback({ server, username, password, action: 'get_series' }),
  ]);

  const movieExact = new Set();
  const movieTitleOnly = new Set();
  const seriesExact = new Set();
  const seriesTitleOnly = new Set();

  for (const row of Array.isArray(vod) ? vod : []) {
    const title = normalizeTitle(row?.name || row?.title || '');
    if (!title) continue;
    const year = parseYear(row?.year || row?.releaseDate || row?.release_date);
    movieTitleOnly.add(title);
    if (year) movieExact.add(`${title}::${year}`);
  }

  for (const row of Array.isArray(series) ? series : []) {
    const title = normalizeTitle(row?.name || row?.title || '');
    if (!title) continue;
    const year = parseYear(row?.year || row?.releaseDate || row?.release_date);
    seriesTitleOnly.add(title);
    if (year) seriesExact.add(`${title}::${year}`);
  }

  const data = {
    movieExact,
    movieTitleOnly,
    seriesExact,
    seriesTitleOnly,
  };
  xuiCatalogCache.set(s, { at: now, data });
  return data;
}

function isAvailableInXui(item, catalog) {
  if (!catalog || !item) return false;
  const mediaType = mediaTypeNorm(item.mediaType);
  const title = normalizeTitle(item.title);
  if (!title) return false;
  const year = parseYear(item.releaseDate);
  const exact = year ? `${title}::${year}` : '';

  if (mediaType === 'tv') {
    if (exact && catalog.seriesExact.has(exact)) return true;
    return catalog.seriesTitleOnly.has(title);
  }
  if (exact && catalog.movieExact.has(exact)) return true;
  return catalog.movieTitleOnly.has(title);
}

function mergeRequestAndAvailabilityStates({ items, requestStates, catalog }) {
  const out = { ...(requestStates || {}) };
  for (const item of dedupeItems(items)) {
    const key = stateKey(item.tmdbId, item.mediaType);
    if (!isAvailableInXui(item, catalog)) continue;
    out[key] = {
      state: 'available',
      availableNow: true,
    };
  }
  return out;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const username = String(searchParams.get('username') || '').trim();
    if (!username) return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });

    const [queue, quota, settings] = await Promise.all([
      listRequestQueue({ status: 'active', includeArchived: false }),
      getUserRequestQuota(username),
      getRequestSettings(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        quota,
        settings: publicSettingsShape(settings),
        activeStates: compactActiveStates(queue.items),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to load request data' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim().toLowerCase();
    const username = String(body?.username || '').trim();

    if (action === 'submit') {
      if (!username) return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });
      const streamBase = String(body?.streamBase || '').trim();
      if (!streamBase) return NextResponse.json({ ok: false, error: 'Missing streamBase' }, { status: 400 });

      const inputItems = dedupeItems(body?.items);
      const catalog = await loadXuiCatalog(streamBase);

      const availableAlready = [];
      const requestable = [];
      for (const item of inputItems) {
        if (isAvailableInXui(item, catalog)) {
          availableAlready.push({
            tmdbId: item.tmdbId,
            mediaType: item.mediaType,
            reason: 'available_now',
          });
        } else {
          requestable.push(item);
        }
      }

      const result = await submitRequests({
        username,
        items: requestable,
      });

      return NextResponse.json(
        {
          ok: true,
          ...result,
          rejected: [...(result?.rejected || []), ...availableAlready],
        },
        { status: 200 }
      );
    }

    if (action === 'state') {
      if (!username) return NextResponse.json({ ok: false, error: 'Missing username' }, { status: 400 });
      const streamBase = String(body?.streamBase || '').trim();
      if (!streamBase) return NextResponse.json({ ok: false, error: 'Missing streamBase' }, { status: 400 });

      const items = dedupeItems(body?.items);
      const [requestStateResult, catalog] = await Promise.all([
        getRequestStatesForItems({
          username,
          items,
        }),
        loadXuiCatalog(streamBase),
      ]);

      const states = mergeRequestAndAvailabilityStates({
        items,
        requestStates: requestStateResult?.states || {},
        catalog,
      });

      return NextResponse.json(
        {
          ok: true,
          quota: requestStateResult?.quota || null,
          states,
        },
        { status: 200 }
      );
    }

    if (action === 'remind') {
      const result = await subscribeToRequestReminder({
        username,
        tmdbId: body?.tmdbId,
        mediaType: body?.mediaType,
      });
      return NextResponse.json({ ok: true, ...result }, { status: 200 });
    }

    return NextResponse.json(
      { ok: false, error: 'Invalid action. Use submit, state, or remind.' },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Request action failed' }, { status: 400 });
  }
}
