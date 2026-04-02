import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from '../adminDb';

function now() {
  return Date.now();
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function ensureOneEngineHost(db) {
  db.engineHosts = Array.isArray(db.engineHosts) ? db.engineHosts : [];
  if (db.engineHosts.length <= 1) return;
  // Keep the most recently updated one.
  db.engineHosts.sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
  db.engineHosts = db.engineHosts.slice(0, 1);
}

export async function getEngineHost() {
  const db = await getAdminDb();
  ensureOneEngineHost(db);
  return db.engineHosts[0] || null;
}

export async function upsertEngineHost(next) {
  const db = await getAdminDb();
  const prev = db.engineHosts?.[0] || null;
  const host = {
    id: prev?.id || crypto.randomUUID(),
    createdAt: prev?.createdAt || now(),
    updatedAt: now(),
    ...prev,
    ...next,
  };
  db.engineHosts = [host];
  await saveAdminDb(db);
  return host;
}

export async function clearEngineHost() {
  const db = await getAdminDb();
  db.engineHosts = [];
  db.mountSettings = null;
  db.mountStatus = null;
  await saveAdminDb(db);
  return true;
}

export async function getMountSettings() {
  const db = await getAdminDb();
  return db.mountSettings || null;
}

export async function setMountSettings(next) {
  const db = await getAdminDb();
  const prev = db.mountSettings || null;
  db.mountSettings = {
    id: prev?.id || crypto.randomUUID(),
    createdAt: prev?.createdAt || now(),
    updatedAt: now(),
    ...prev,
    ...next,
  };
  await saveAdminDb(db);
  return db.mountSettings;
}

export async function setMountStatus(status) {
  const db = await getAdminDb();
  db.mountStatus = status && typeof status === 'object' ? { ...status, updatedAt: now() } : null;
  await saveAdminDb(db);
  return db.mountStatus;
}

export async function getAutodownloadSettings() {
  const db = await getAdminDb();
  return db.autodownloadSettings || null;
}

export async function updateAutodownloadSettings(patch) {
  const db = await getAdminDb();
  db.autodownloadSettings = deepMerge(db.autodownloadSettings || {}, patch || {});
  await saveAdminDb(db);
  return db.autodownloadSettings;
}

export async function getXuiIntegration() {
  const db = await getAdminDb();
  return db.xuiIntegration || null;
}

export async function updateXuiIntegration(patch) {
  const db = await getAdminDb();
  db.xuiIntegration = { ...(db.xuiIntegration || {}), ...(patch || {}) };
  await saveAdminDb(db);
  return db.xuiIntegration;
}

export async function getXuiScanState() {
  const db = await getAdminDb();
  return db.xuiScanState || null;
}

export async function updateXuiScanState(patch) {
  const db = await getAdminDb();
  db.xuiScanState = { ...(db.xuiScanState || {}), ...(patch || {}) };
  await saveAdminDb(db);
  return db.xuiScanState;
}

export async function appendProcessingLog(entry) {
  const db = await getAdminDb();
  db.processingLogs = Array.isArray(db.processingLogs) ? db.processingLogs : [];
  db.processingLogs.unshift(entry);
  // cap
  db.processingLogs = db.processingLogs.slice(0, 2000);
  await saveAdminDb(db);
  return entry;
}

export async function appendSelectionLog(entry) {
  const db = await getAdminDb();
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];

  const nextEntry = entry && typeof entry === 'object' ? entry : {};
  const nextId = String(nextEntry?.id || '').trim();
  if (nextId) {
    const existingIdx = db.selectionLogs.findIndex((row) => String(row?.id || '').trim() === nextId);
    if (existingIdx >= 0) {
      const existing = db.selectionLogs[existingIdx] || {};

      const preferTrigger = (value) => {
        const s = String(value || '').trim();
        if (!s) return '';
        // A recovered log is a best-effort backfill; prefer real trigger reasons when present.
        if (s.toLowerCase() === 'recovered_reference') return '';
        return s;
      };

      const triggerReason =
        preferTrigger(nextEntry?.triggerReason) ||
        preferTrigger(existing?.triggerReason) ||
        String(nextEntry?.triggerReason || existing?.triggerReason || '').trim() ||
        null;

      // Avoid double-counting when the same selection log id is appended twice (common when a recovered
      // reference exists and the real selection run later persists the same id).
      const merged = {
        ...existing,
        ...nextEntry,
        triggerReason,
        runAt: Math.min(Number(existing?.runAt || 0) || Infinity, Number(nextEntry?.runAt || 0) || Infinity),
        updatedAt: Math.max(Number(existing?.updatedAt || 0) || 0, Number(nextEntry?.updatedAt || 0) || 0),
        totalSelected: Math.max(0, Number(existing?.totalSelected || 0) || 0, Number(nextEntry?.totalSelected || 0) || 0),
        skippedDuplicatesCount: Math.max(0, Number(existing?.skippedDuplicatesCount || 0) || 0, Number(nextEntry?.skippedDuplicatesCount || 0) || 0),
        skippedNoSourceCount: Math.max(0, Number(existing?.skippedNoSourceCount || 0) || 0, Number(nextEntry?.skippedNoSourceCount || 0) || 0),
        skippedStorageLimitCount: Math.max(0, Number(existing?.skippedStorageLimitCount || 0) || 0, Number(nextEntry?.skippedStorageLimitCount || 0) || 0),
      };

      // If either side has selectedItems, keep the longer list. Precise item merge is handled by the
      // selection-log API normalizer for display; this prevents duplicated log rows.
      const existingItems = Array.isArray(existing?.selectedItems) ? existing.selectedItems : [];
      const nextItems = Array.isArray(nextEntry?.selectedItems) ? nextEntry.selectedItems : [];
      merged.selectedItems = nextItems.length >= existingItems.length ? nextItems : existingItems;

      // Ensure we don't keep Infinity if both were missing.
      if (!Number.isFinite(merged.runAt) || merged.runAt === Infinity) merged.runAt = Number(nextEntry?.runAt || existing?.runAt || now()) || now();

      // Move the updated row to the top.
      db.selectionLogs.splice(existingIdx, 1);
      db.selectionLogs.unshift(merged);
      db.selectionLogs = db.selectionLogs.slice(0, 2000);
      await saveAdminDb(db);
      return merged;
    }
  }

  db.selectionLogs.unshift(nextEntry);
  db.selectionLogs = db.selectionLogs.slice(0, 2000);
  await saveAdminDb(db);
  return nextEntry;
}

export async function getAutodownloadHealth() {
  const db = await getAdminDb();
  return db.autodownloadHealth || null;
}

export async function setAutodownloadHealth(next) {
  const db = await getAdminDb();
  db.autodownloadHealth = next && typeof next === 'object' ? { ...next, updatedAt: now() } : null;
  await saveAdminDb(db);
  return db.autodownloadHealth;
}

export async function appendXuiScanLog(entry) {
  const db = await getAdminDb();
  db.xuiScanLogs = Array.isArray(db.xuiScanLogs) ? db.xuiScanLogs : [];
  db.xuiScanLogs.unshift(entry);
  db.xuiScanLogs = db.xuiScanLogs.slice(0, 2000);
  await saveAdminDb(db);
  return entry;
}
