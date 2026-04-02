import 'server-only';

import crypto from 'node:crypto';

const MAX_LOG_ROWS = 200;

function getStore() {
  if (!globalThis.__THREEJ_TV_VPN_DIAGNOSTIC_JOBS__) {
    globalThis.__THREEJ_TV_VPN_DIAGNOSTIC_JOBS__ = new Map();
  }
  return globalThis.__THREEJ_TV_VPN_DIAGNOSTIC_JOBS__;
}

function cloneJob(job = null) {
  if (!job || typeof job !== 'object') return null;
  return JSON.parse(JSON.stringify(job));
}

export function createVpnDiagnosticJob({ kind = 'generic', title = '' } = {}) {
  const now = Date.now();
  const id = crypto.randomUUID();
  const job = {
    id,
    kind: String(kind || 'generic').trim(),
    title: String(title || '').trim(),
    status: 'running',
    progress: 0,
    phaseKey: 'queued',
    phaseLabel: 'Queued',
    summary: '',
    error: '',
    logs: [],
    result: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
  };
  getStore().set(id, job);
  return cloneJob(job);
}

export function getVpnDiagnosticJob(jobId = '') {
  const job = getStore().get(String(jobId || '').trim());
  return cloneJob(job);
}

export function updateVpnDiagnosticJob(jobId = '', patch = {}) {
  const id = String(jobId || '').trim();
  const store = getStore();
  const current = store.get(id);
  if (!current) return null;
  const sanitizedPatch = Object.fromEntries(
    Object.entries(patch && typeof patch === 'object' ? patch : {}).filter(([, value]) => value !== undefined)
  );
  const next = {
    ...current,
    ...sanitizedPatch,
    updatedAt: Date.now(),
  };
  store.set(id, next);
  return cloneJob(next);
}

export function appendVpnDiagnosticJobLog(jobId = '', message = '', level = 'info') {
  const id = String(jobId || '').trim();
  const store = getStore();
  const current = store.get(id);
  if (!current) return null;
  const row = {
    at: Date.now(),
    level: String(level || 'info').trim() || 'info',
    message: String(message || '').trim(),
  };
  const next = {
    ...current,
    logs: [...(Array.isArray(current.logs) ? current.logs : []), row].slice(-MAX_LOG_ROWS),
    updatedAt: Date.now(),
  };
  store.set(id, next);
  return cloneJob(next);
}

export function completeVpnDiagnosticJob(jobId = '', result = null, summary = '') {
  return updateVpnDiagnosticJob(jobId, {
    status: 'completed',
    progress: 100,
    phaseKey: 'completed',
    phaseLabel: 'Completed',
    summary: String(summary || '').trim(),
    error: '',
    result,
    finishedAt: Date.now(),
  });
}

export function failVpnDiagnosticJob(jobId = '', error = '', result = null) {
  return updateVpnDiagnosticJob(jobId, {
    status: 'failed',
    progress: 100,
    phaseKey: 'failed',
    phaseLabel: 'Failed',
    summary: '',
    error: String(error || '').trim(),
    result,
    finishedAt: Date.now(),
  });
}
