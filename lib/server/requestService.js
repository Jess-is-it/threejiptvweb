import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from './adminDb';

const REQUEST_TZ = 'Asia/Manila';

export const REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  AVAILABLE_NOW: 'available_now',
  REJECTED: 'rejected',
  ARCHIVED: 'archived',
};

const VALID_STATUSES = new Set(Object.values(REQUEST_STATUS));

const DEFAULT_REQUEST_SETTINGS = {
  dailyLimitDefault: 3,
  dailyLimitsByUsername: {},
  defaultLandingCategory: 'popular',
  statusTags: {
    pending: 'Pending',
    approved: 'Approved',
    availableNow: 'Available Now',
    rejected: 'Rejected',
    archived: 'Archived',
  },
};

function nowMs() {
  return Date.now();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.floor(n);
  return Math.max(min, Math.min(max, v));
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMediaType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'tv' || raw === 'series') return 'tv';
  return 'movie';
}

function normalizeRequestScope(value, mediaType) {
  if (normalizeMediaType(mediaType) !== 'tv') return 'title';
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'whole' || raw === 'whole_series' || raw === 'full' || raw === 'all') return 'series';
  if (raw === 'season') return 'season';
  if (raw === 'episode') return 'episode';
  return 'series';
}

function parsePositiveInt(value, min = 1, max = 999) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < min || v > max) return null;
  return v;
}

function buildRequestDetailLabel(mediaType, requestScope, seasonNumber, episodeNumber) {
  if (normalizeMediaType(mediaType) !== 'tv') return '';
  const scope = normalizeRequestScope(requestScope, 'tv');
  if (scope === 'season') return `Season ${seasonNumber}`;
  if (scope === 'episode') return `Season ${seasonNumber} · Episode ${episodeNumber}`;
  return 'Whole Series';
}

function normalizeRequestTarget(raw, mediaType, { strict = false } = {}) {
  const mt = normalizeMediaType(mediaType);
  if (mt !== 'tv') {
    return {
      requestScope: 'title',
      seasonNumber: null,
      episodeNumber: null,
      requestDetailLabel: '',
    };
  }

  const scope = normalizeRequestScope(raw?.requestScope, mt);
  const seasonNumber = parsePositiveInt(raw?.seasonNumber, 1, 99);
  const episodeNumber = parsePositiveInt(raw?.episodeNumber, 1, 999);

  if (scope === 'season') {
    if (!seasonNumber) {
      if (strict) throw new Error('Season number is required for season requests.');
      return {
        requestScope: 'series',
        seasonNumber: null,
        episodeNumber: null,
        requestDetailLabel: 'Whole Series',
      };
    }
    return {
      requestScope: 'season',
      seasonNumber,
      episodeNumber: null,
      requestDetailLabel: buildRequestDetailLabel(mt, 'season', seasonNumber, null),
    };
  }

  if (scope === 'episode') {
    if (!seasonNumber || !episodeNumber) {
      if (strict) throw new Error('Season and episode numbers are required for episode requests.');
      return {
        requestScope: 'series',
        seasonNumber: null,
        episodeNumber: null,
        requestDetailLabel: 'Whole Series',
      };
    }
    return {
      requestScope: 'episode',
      seasonNumber,
      episodeNumber,
      requestDetailLabel: buildRequestDetailLabel(mt, 'episode', seasonNumber, episodeNumber),
    };
  }

  return {
    requestScope: 'series',
    seasonNumber: null,
    episodeNumber: null,
    requestDetailLabel: 'Whole Series',
  };
}

function normalizeStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.has(s) ? s : REQUEST_STATUS.PENDING;
}

function isArchived(row) {
  return normalizeStatus(row?.status) === REQUEST_STATUS.ARCHIVED;
}

function mediaKey(tmdbId, mediaType) {
  return `${normalizeMediaType(mediaType)}:${Number(tmdbId || 0)}`;
}

function uniqueItems(items, { strictSeriesTarget = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(items) ? items : []) {
    const tmdbId = Number(raw?.tmdbId || 0);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    const mediaType = normalizeMediaType(raw?.mediaType);
    const key = mediaKey(tmdbId, mediaType);
    if (seen.has(key)) continue;
    seen.add(key);
    const target = normalizeRequestTarget(raw || {}, mediaType, { strict: strictSeriesTarget });
    out.push({
      tmdbId,
      mediaType,
      title: String(raw?.title || '').trim(),
      posterPath: String(raw?.posterPath || '').trim(),
      backdropPath: String(raw?.backdropPath || '').trim(),
      overview: String(raw?.overview || '').trim(),
      releaseDate: String(raw?.releaseDate || '').trim(),
      requestScope: target.requestScope,
      seasonNumber: target.seasonNumber,
      episodeNumber: target.episodeNumber,
      requestDetailLabel: target.requestDetailLabel,
    });
  }
  return out;
}

function normalizeStatusTags(input) {
  const inTags = input && typeof input === 'object' ? input : {};
  const base = DEFAULT_REQUEST_SETTINGS.statusTags;
  return {
    pending: String(inTags?.pending || base.pending).trim() || base.pending,
    approved: String(inTags?.approved || base.approved).trim() || base.approved,
    availableNow: String(inTags?.availableNow || base.availableNow).trim() || base.availableNow,
    rejected: String(inTags?.rejected || base.rejected).trim() || base.rejected,
    archived: String(inTags?.archived || base.archived).trim() || base.archived,
  };
}

function normalizeRequestSettings(settings) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const limitsRaw = src?.dailyLimitsByUsername && typeof src.dailyLimitsByUsername === 'object' ? src.dailyLimitsByUsername : {};
  const dailyLimitsByUsername = {};
  for (const [k, v] of Object.entries(limitsRaw)) {
    const username = normalizeUsername(k);
    if (!username) continue;
    dailyLimitsByUsername[username] = clampInt(v, 1, 20, DEFAULT_REQUEST_SETTINGS.dailyLimitDefault);
  }
  return {
    dailyLimitDefault: clampInt(src?.dailyLimitDefault, 1, 20, DEFAULT_REQUEST_SETTINGS.dailyLimitDefault),
    dailyLimitsByUsername,
    defaultLandingCategory: String(src?.defaultLandingCategory || DEFAULT_REQUEST_SETTINGS.defaultLandingCategory).trim() || DEFAULT_REQUEST_SETTINGS.defaultLandingCategory,
    statusTags: normalizeStatusTags(src?.statusTags),
  };
}

function applySettingsPatch(current, patch) {
  const base = normalizeRequestSettings(current);
  const inPatch = patch && typeof patch === 'object' ? patch : {};
  const next = { ...base };

  if (Object.prototype.hasOwnProperty.call(inPatch, 'dailyLimitDefault')) {
    next.dailyLimitDefault = clampInt(inPatch.dailyLimitDefault, 1, 20, base.dailyLimitDefault);
  }
  if (Object.prototype.hasOwnProperty.call(inPatch, 'dailyLimitsByUsername')) {
    const mapIn = inPatch?.dailyLimitsByUsername && typeof inPatch.dailyLimitsByUsername === 'object' ? inPatch.dailyLimitsByUsername : {};
    const out = {};
    for (const [k, v] of Object.entries(mapIn)) {
      const u = normalizeUsername(k);
      if (!u) continue;
      out[u] = clampInt(v, 1, 20, next.dailyLimitDefault);
    }
    next.dailyLimitsByUsername = out;
  }
  if (Object.prototype.hasOwnProperty.call(inPatch, 'defaultLandingCategory')) {
    next.defaultLandingCategory =
      String(inPatch?.defaultLandingCategory || '').trim() || base.defaultLandingCategory;
  }
  if (Object.prototype.hasOwnProperty.call(inPatch, 'statusTags')) {
    next.statusTags = normalizeStatusTags({ ...base.statusTags, ...(inPatch?.statusTags || {}) });
  }

  return next;
}

function dayKey(ts, timeZone = REQUEST_TZ) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Number(ts || 0)));
  } catch {
    const d = new Date(Number(ts || 0));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

function countUserRequestsToday(rows, username) {
  const u = normalizeUsername(username);
  if (!u) return 0;
  const today = dayKey(nowMs());
  let total = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const requestedBy = Array.isArray(row?.requestedBy) ? row.requestedBy : [];
    for (const req of requestedBy) {
      const ru = normalizeUsername(req?.username);
      if (ru !== u) continue;
      if (dayKey(req?.requestedAt || 0) === today) total += 1;
    }
  }
  return total;
}

function requestLimitForUser(settings, username) {
  const u = normalizeUsername(username);
  if (!u) return settings.dailyLimitDefault;
  const n = Number(settings?.dailyLimitsByUsername?.[u]);
  if (!Number.isFinite(n) || n <= 0) return settings.dailyLimitDefault;
  return Math.max(1, Math.floor(n));
}

function findActiveRequest(rows, tmdbId, mediaType) {
  const id = Number(tmdbId || 0);
  const mt = normalizeMediaType(mediaType);
  return (Array.isArray(rows) ? rows : []).find((row) => {
    if (isArchived(row)) return false;
    return Number(row?.tmdbId || 0) === id && normalizeMediaType(row?.mediaType) === mt;
  });
}

function normalizeQueueRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const requestedBy = Array.isArray(row?.requestedBy) ? row.requestedBy : [];
    const reminderSubscribers = Array.isArray(row?.reminderSubscribers) ? row.reminderSubscribers : [];
    const mediaType = normalizeMediaType(row?.mediaType);
    const target = normalizeRequestTarget(
      {
        requestScope: row?.requestScope,
        seasonNumber: row?.seasonNumber,
        episodeNumber: row?.episodeNumber,
      },
      mediaType
    );
    return {
      ...row,
      mediaType,
      status: normalizeStatus(row?.status),
      requestCount: Math.max(0, Number(row?.requestCount || requestedBy.length || 0)),
      requestScope: target.requestScope,
      seasonNumber: target.seasonNumber,
      episodeNumber: target.episodeNumber,
      requestDetailLabel: String(row?.requestDetailLabel || target.requestDetailLabel || '').trim(),
      requestedBy,
      reminderSubscribers,
    };
  });
}

function sortQueue(rows) {
  return [...rows].sort((a, b) => {
    const c = Number(b?.requestCount || 0) - Number(a?.requestCount || 0);
    if (c !== 0) return c;
    return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
  });
}

export async function getRequestSettings() {
  const db = await getAdminDb();
  const settings = normalizeRequestSettings(db.requestSettings || DEFAULT_REQUEST_SETTINGS);
  return settings;
}

export async function updateRequestSettings(patch) {
  const db = await getAdminDb();
  const current = normalizeRequestSettings(db.requestSettings || DEFAULT_REQUEST_SETTINGS);
  const next = applySettingsPatch(current, patch || {});
  db.requestSettings = next;
  await saveAdminDb(db);
  return next;
}

export async function listRequestQueue({ status = 'active', includeArchived = false } = {}) {
  const db = await getAdminDb();
  const settings = normalizeRequestSettings(db.requestSettings || DEFAULT_REQUEST_SETTINGS);
  const all = normalizeQueueRows(db.requests || []);
  const statusFilter = String(status || '').trim().toLowerCase();

  let rows = all;
  if (!includeArchived && statusFilter === 'active') {
    rows = rows.filter((row) => !isArchived(row));
  } else if (statusFilter && statusFilter !== 'all') {
    rows = rows.filter((row) => row.status === statusFilter);
  }

  return {
    settings,
    items: sortQueue(rows),
  };
}

export async function getUserRequestQuota(username) {
  const db = await getAdminDb();
  const settings = normalizeRequestSettings(db.requestSettings || DEFAULT_REQUEST_SETTINGS);
  const used = countUserRequestsToday(db.requests || [], username);
  const limit = requestLimitForUser(settings, username);
  return {
    username: normalizeUsername(username),
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export async function getRequestStatesForItems({ username, items = [] } = {}) {
  const db = await getAdminDb();
  const rows = normalizeQueueRows(db.requests || []);
  const quota = await getUserRequestQuota(username);

  const states = {};
  for (const item of uniqueItems(items)) {
    const key = mediaKey(item.tmdbId, item.mediaType);
    const existing = findActiveRequest(rows, item.tmdbId, item.mediaType);
    if (existing) {
      states[key] = {
        state: 'requested',
        requestId: existing.id,
        status: existing.status,
        requestCount: Number(existing.requestCount || 0),
        requestScope: existing.requestScope,
        seasonNumber: existing.seasonNumber,
        episodeNumber: existing.episodeNumber,
        requestDetailLabel: existing.requestDetailLabel || '',
      };
      continue;
    }
    states[key] = { state: 'requestable' };
  }
  return { quota, states };
}

export async function submitRequests({ username, items = [] } = {}) {
  const u = normalizeUsername(username);
  if (!u) throw new Error('Username is required.');

  const entries = uniqueItems(items, { strictSeriesTarget: true });
  if (!entries.length) throw new Error('No valid titles selected.');

  const db = await getAdminDb();
  const settings = normalizeRequestSettings(db.requestSettings || DEFAULT_REQUEST_SETTINGS);
  db.requests = normalizeQueueRows(db.requests || []);

  const used = countUserRequestsToday(db.requests, u);
  const limit = requestLimitForUser(settings, u);

  const created = [];
  const duplicates = [];
  const rejected = [];
  let available = Math.max(0, limit - used);

  for (const item of entries) {
    const existing = findActiveRequest(db.requests, item.tmdbId, item.mediaType);
    if (existing) {
      duplicates.push({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        requestId: existing.id,
        status: existing.status,
        requestScope: existing.requestScope,
        seasonNumber: existing.seasonNumber,
        episodeNumber: existing.episodeNumber,
        requestDetailLabel: existing.requestDetailLabel || '',
      });
      continue;
    }

    if (available <= 0) {
      rejected.push({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        reason: 'daily_limit_exceeded',
      });
      continue;
    }

    const at = nowMs();
    const row = {
      id: crypto.randomUUID(),
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title || '',
      posterPath: item.posterPath || '',
      backdropPath: item.backdropPath || '',
      overview: item.overview || '',
      releaseDate: item.releaseDate || '',
      requestScope: item.requestScope,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      requestDetailLabel: item.requestDetailLabel || '',
      status: REQUEST_STATUS.PENDING,
      requestCount: 1,
      requestedAt: at,
      updatedAt: at,
      statusUpdatedAt: at,
      archivedAt: null,
      requestedBy: [
        {
          username: u,
          requestedAt: at,
        },
      ],
      reminderSubscribers: [
        {
          username: u,
          subscribedAt: at,
        },
      ],
    };
    db.requests.unshift(row);
    created.push(row);
    available -= 1;
  }

  if (created.length) await saveAdminDb(db);

  return {
    created,
    duplicates,
    rejected,
    quota: {
      username: u,
      limit,
      used,
      remaining: Math.max(0, available),
    },
  };
}

export async function subscribeToRequestReminder({ username, tmdbId, mediaType } = {}) {
  const u = normalizeUsername(username);
  if (!u) throw new Error('Username is required.');

  const id = Number(tmdbId || 0);
  if (!Number.isFinite(id) || id <= 0) throw new Error('TMDB id is required.');

  const db = await getAdminDb();
  db.requests = normalizeQueueRows(db.requests || []);
  const row = findActiveRequest(db.requests, id, mediaType);
  if (!row) throw new Error('Request not found.');

  row.reminderSubscribers = Array.isArray(row.reminderSubscribers) ? row.reminderSubscribers : [];
  const exists = row.reminderSubscribers.some((r) => normalizeUsername(r?.username) === u);
  if (!exists) {
    row.reminderSubscribers.push({
      username: u,
      subscribedAt: nowMs(),
    });
    row.updatedAt = nowMs();
    await saveAdminDb(db);
  }

  return {
    requestId: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType,
    subscribed: !exists,
    subscriberCount: row.reminderSubscribers.length,
  };
}

export async function updateRequestStatus({ id, status } = {}) {
  const requestId = String(id || '').trim();
  if (!requestId) throw new Error('Request id is required.');

  const nextStatus = normalizeStatus(status);
  if (!VALID_STATUSES.has(nextStatus)) throw new Error('Invalid status.');

  const db = await getAdminDb();
  db.requests = normalizeQueueRows(db.requests || []);
  const idx = db.requests.findIndex((row) => String(row?.id || '') === requestId);
  if (idx < 0) throw new Error('Request not found.');

  const prev = db.requests[idx];
  const at = nowMs();
  const next = {
    ...prev,
    status: nextStatus,
    statusUpdatedAt: at,
    updatedAt: at,
    archivedAt: nextStatus === REQUEST_STATUS.ARCHIVED ? at : prev?.archivedAt || null,
  };
  db.requests[idx] = next;
  await saveAdminDb(db);

  return {
    item: next,
    changedToAvailableNow: prev.status !== REQUEST_STATUS.AVAILABLE_NOW && next.status === REQUEST_STATUS.AVAILABLE_NOW,
  };
}

export async function archiveRequestById(id) {
  return updateRequestStatus({ id, status: REQUEST_STATUS.ARCHIVED });
}

export async function archiveRequestsByStatus(statuses = [REQUEST_STATUS.AVAILABLE_NOW, REQUEST_STATUS.REJECTED]) {
  const allowed = new Set(Array.isArray(statuses) ? statuses.map((s) => normalizeStatus(s)) : []);
  if (!allowed.size) throw new Error('No statuses provided.');

  const db = await getAdminDb();
  db.requests = normalizeQueueRows(db.requests || []);

  const at = nowMs();
  let archived = 0;
  db.requests = db.requests.map((row) => {
    if (isArchived(row)) return row;
    if (!allowed.has(normalizeStatus(row?.status))) return row;
    archived += 1;
    return {
      ...row,
      status: REQUEST_STATUS.ARCHIVED,
      archivedAt: at,
      statusUpdatedAt: at,
      updatedAt: at,
    };
  });

  if (archived > 0) await saveAdminDb(db);

  return { archived };
}
