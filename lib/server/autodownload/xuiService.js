import 'server-only';

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

import { Agent } from 'undici';

import { decryptString, encryptString } from '../vault';
import {
  appendXuiScanLog,
  getAutodownloadSettings,
  getXuiIntegration,
  getXuiScanState,
  updateXuiIntegration,
  updateXuiScanState,
} from './autodownloadDb';

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

function now() {
  return Date.now();
}

function isPrivateIp(ip) {
  if (!ip) return false;
  const fam = net.isIP(ip);
  if (!fam) return false;
  if (fam === 4) {
    const [a, b] = ip.split('.').map((x) => Number(x));
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 127) return true;
    return false;
  }
  const s = String(ip).toLowerCase();
  return s === '::1' || s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd');
}

async function allowInsecureTlsFor(urlStr) {
  if (String(process.env.ALLOW_INSECURE_UPSTREAM_TLS || '').toLowerCase() === 'true') return true;
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    const a4 = await dns.lookup(u.hostname, { family: 4 }).catch(() => null);
    if (a4?.address && isPrivateIp(a4.address)) return true;
    const a6 = await dns.lookup(u.hostname, { family: 6 }).catch(() => null);
    if (a6?.address && isPrivateIp(a6.address)) return true;
  } catch {}
  return false;
}

function normalizeBaseUrl(baseUrl) {
  const s = String(baseUrl || '').trim();
  if (!s) return '';
  const u = new URL(s.includes('://') ? s : `https://${s}`);
  return u.origin;
}

function getWatchFolderIdByType(cfg, type) {
  const t = String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
  const primary = t === 'series' ? cfg?.watchFolderIdSeries : cfg?.watchFolderIdMovies;
  const legacyType = t === 'series' ? cfg?.watchFolderIdSerie : cfg?.watchFolderIdMovie;
  const legacyShared = cfg?.watchFolderId;
  return String(primary ?? legacyType ?? legacyShared ?? '').trim();
}

function buildApiUrl({ baseUrl, accessCode, apiKey, action, params = {} }) {
  const origin = normalizeBaseUrl(baseUrl);
  if (!origin) throw new Error('XUI baseUrl is required.');
  const ac = String(accessCode || '').trim();
  if (!ac) throw new Error('XUI access_code is required.');
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('XUI api_key is required.');

  const url = new URL(`${origin.replace(/\/+$/, '')}/${encodeURIComponent(ac)}/`);
  url.searchParams.set('api_key', key);
  url.searchParams.set('action', String(action || '').trim());
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

export async function getXuiIntegrationSafe() {
  const cfg = await getXuiIntegration();
  if (!cfg) return null;
  return {
    baseUrl: cfg.baseUrl || '',
    watchFolderIdMovies: getWatchFolderIdByType(cfg, 'movie'),
    watchFolderIdSeries: getWatchFolderIdByType(cfg, 'series'),
    hasAccessCode: Boolean(cfg.accessCodeEnc),
    hasApiKey: Boolean(cfg.apiKeyEnc),
  };
}

export async function updateXuiIntegrationFromAdminInput(input) {
  const current = await getXuiIntegration();
  const baseUrl = normalizeBaseUrl(input?.baseUrl || current?.baseUrl || '');
  const accessCode = String(input?.accessCode || '').trim();
  const apiKey = String(input?.apiKey || '').trim();
  const watchFolderIdMovies = String(
    input?.watchFolderIdMovies ?? input?.watchFolderIdMovie ?? input?.watchFolderId ?? getWatchFolderIdByType(current, 'movie')
  ).trim();
  const watchFolderIdSeries = String(input?.watchFolderIdSeries ?? input?.watchFolderIdSerie ?? getWatchFolderIdByType(current, 'series')).trim();

  if (!baseUrl) throw new Error('baseUrl is required.');
  if (!accessCode && !current?.accessCodeEnc) throw new Error('access_code is required.');
  if (!apiKey && !current?.apiKeyEnc) throw new Error('api_key is required.');

  const next = {
    baseUrl,
    accessCodeEnc: accessCode ? encryptString(accessCode) : current.accessCodeEnc,
    apiKeyEnc: apiKey ? encryptString(apiKey) : current.apiKeyEnc,
    watchFolderIdMovies,
    watchFolderIdSeries,
  };
  await updateXuiIntegration(next);
  return getXuiIntegrationSafe();
}

export async function xuiApiCall({ action, params = {} }) {
  const cfg = await getXuiIntegration();
  if (!cfg) throw new Error('XUI integration is not configured.');

  const url = buildApiUrl({
    baseUrl: cfg.baseUrl,
    accessCode: decryptString(cfg.accessCodeEnc),
    apiKey: decryptString(cfg.apiKeyEnc),
    action,
    params,
  });

  const insecure = await allowInsecureTlsFor(url.toString());
  const r = await fetch(url.toString(), {
    cache: 'no-store',
    ...(insecure ? { dispatcher: insecureDispatcher } : {}),
  });
  const text = await r.text().catch(() => '');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!r.ok) throw new Error(`XUI ${r.status}: ${text.slice(0, 200)}`);
  return data;
}

export async function testXuiConnection() {
  // Use a harmless call that should exist on most builds.
  const data = await xuiApiCall({ action: 'get_watch_folders' });
  return { ok: true, data };
}

export async function triggerWatchFolderScan({ type }) {
  const t = String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
  const cfg = await getXuiIntegration();
  if (!cfg) throw new Error('XUI integration is not configured.');
  const id = getWatchFolderIdByType(cfg, t);
  if (!id) throw new Error(`Missing WATCH_FOLDER_ID for ${t}.`);

  const data = await xuiApiCall({ action: 'reload_watch_folder', params: { id } });
  return { ok: true, type: t, id, data };
}

export async function schedulerMaybeTriggerXuiScans() {
  const state = await getXuiScanState();
  const cfg = await getXuiIntegration();
  if (!cfg?.baseUrl || !cfg?.accessCodeEnc || !cfg?.apiKeyEnc) return { ok: true, skipped: true };

  const settings = await getAutodownloadSettings();
  const trig = settings?.watchfolderTrigger || {};
  if (trig.enabled === false) return { ok: true, skipped: true, reason: 'disabled' };
  const cooldownMinutes = Number(trig.cooldownMinutes ?? 10);
  const cooldownMs = Math.max(0, cooldownMinutes) * 60 * 1000;
  const mode = String(trig.mode || 'debounced').toLowerCase();
  const effectiveCooldownMs = mode === 'immediate' ? 0 : cooldownMs;
  const out = { movies: null, series: null };

  const tryType = async (t) => {
    const pendingKey = t === 'series' ? 'seriesScanPending' : 'moviesScanPending';
    const lastKey = t === 'series' ? 'seriesLastScanAt' : 'moviesLastScanAt';
    const lastCompatKey = t === 'series' ? 'lastSeriesScanTriggerAt' : 'lastMoviesScanTriggerAt';
    const cdKey = t === 'series' ? 'seriesCooldownUntil' : 'moviesCooldownUntil';
    const pending = Boolean(state?.[pendingKey]);
    if (!pending) return null;
    const last = Number(state?.[lastKey] || state?.[lastCompatKey] || 0);
    const nowMs = now();
    const cooldownUntil = last ? last + effectiveCooldownMs : 0;
    if (nowMs < cooldownUntil) {
      await updateXuiScanState({ [cdKey]: cooldownUntil });
      return { skipped: true, cooldownUntil };
    }

    let result = null;
    let error = '';
    try {
      result = await triggerWatchFolderScan({ type: t });
    } catch (e) {
      error = e?.message || 'Scan failed';
    }

    const trigAt = now();
    await updateXuiScanState({
      [lastKey]: trigAt,
      [lastCompatKey]: trigAt,
      [pendingKey]: error ? true : false,
      [cdKey]: trigAt + cooldownMs,
    });

    await appendXuiScanLog({
      id: crypto.randomUUID(),
      createdAt: trigAt,
      type: t,
      watchFolderId: getWatchFolderIdByType(cfg, t),
      status: error ? 'error' : 'ok',
      error: error || null,
      cooldownUntil: trigAt + cooldownMs,
      result,
    });

    return { ok: !error, error: error || null, triggeredAt: trigAt };
  };

  out.movies = await tryType('movie');
  out.series = await tryType('series');

  return { ok: true, out };
}

export async function triggerXuiScanNow({ type, force = false, reason = 'manual' } = {}) {
  const t = String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
  const cfg = await getXuiIntegration();
  if (!cfg?.baseUrl || !cfg?.accessCodeEnc || !cfg?.apiKeyEnc) throw new Error('XUI integration is not configured.');

  const watchFolderId = getWatchFolderIdByType(cfg, t);
  if (!String(watchFolderId || '').trim()) throw new Error(`Missing WATCH_FOLDER_ID for ${t}.`);

  const state = await getXuiScanState();
  const settings = await getAutodownloadSettings();
  const trig = settings?.watchfolderTrigger || {};
  const cooldownMinutes = Number(trig.cooldownMinutes ?? 10);
  const cooldownMs = Math.max(0, cooldownMinutes) * 60 * 1000;

  const pendingKey = t === 'series' ? 'seriesScanPending' : 'moviesScanPending';
  const lastKey = t === 'series' ? 'seriesLastScanAt' : 'moviesLastScanAt';
  const lastCompatKey = t === 'series' ? 'lastSeriesScanTriggerAt' : 'lastMoviesScanTriggerAt';
  const cdKey = t === 'series' ? 'seriesCooldownUntil' : 'moviesCooldownUntil';

  const last = Number(state?.[lastKey] || state?.[lastCompatKey] || 0);
  const nowMs = now();
  const cooldownUntil = last ? last + cooldownMs : 0;
  if (!force && cooldownUntil && nowMs < cooldownUntil) {
    await updateXuiScanState({ [cdKey]: cooldownUntil });
    await appendXuiScanLog({
      id: crypto.randomUUID(),
      createdAt: nowMs,
      type: t,
      watchFolderId,
      status: 'skipped',
      error: `Cooldown active until ${new Date(cooldownUntil).toISOString()}`,
      cooldownUntil,
      result: { skipped: true, cooldownUntil },
      reason,
    });
    return { ok: true, skipped: true, cooldownUntil };
  }

  let result = null;
  let error = '';
  try {
    result = await triggerWatchFolderScan({ type: t });
  } catch (e) {
    error = e?.message || 'Scan failed';
  }

  const trigAt = now();
  await updateXuiScanState({
    [lastKey]: trigAt,
    [lastCompatKey]: trigAt,
    [pendingKey]: error ? true : false,
    [cdKey]: trigAt + cooldownMs,
  });

  await appendXuiScanLog({
    id: crypto.randomUUID(),
    createdAt: trigAt,
    type: t,
    watchFolderId,
    status: error ? 'error' : 'ok',
    error: error || null,
    cooldownUntil: trigAt + cooldownMs,
    result: result || null,
    reason,
  });

  return { ok: !error, error: error || null, result, triggeredAt: trigAt, cooldownUntil: trigAt + cooldownMs };
}
