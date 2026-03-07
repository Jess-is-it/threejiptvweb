import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { getStore } from '@netlify/blobs';

const LOCAL_DIR = path.join(process.cwd(), 'data', '.admin');

function hasNetlifyBlobsContext() {
  return Boolean(globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT);
}

async function ensureLocalDir() {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
}

function localPathForKey(key) {
  const safe = String(key).replaceAll('/', '__');
  return path.join(LOCAL_DIR, `${safe}.json`);
}

async function getBackend() {
  if (hasNetlifyBlobsContext()) {
    return { kind: 'blobs', store: getStore('3jtv-admin') };
  }

  await ensureLocalDir();
  return { kind: 'file' };
}

export async function readJSON(key) {
  const backend = await getBackend();

  if (backend.kind === 'blobs') {
    return backend.store.get(key, { type: 'json' });
  }

  try {
    const raw = await fs.readFile(localPathForKey(key), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeJSON(key, value) {
  const backend = await getBackend();

  if (backend.kind === 'blobs') {
    await backend.store.setJSON(key, value);
    return;
  }

  const file = localPathForKey(key);
  await ensureLocalDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}
