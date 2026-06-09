import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const LOCAL_DIR = process.env.IPTV_ADMIN_DATA_DIR || path.join(process.cwd(), 'data', '.admin');

async function ensureLocalDir() {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
}

function localPathForKey(key) {
  const safe = String(key).replaceAll('/', '__');
  return path.join(LOCAL_DIR, `${safe}.json`);
}

async function getBackend() {
  await ensureLocalDir();
  return { kind: 'file' };
}

export async function readJSON(key) {
  await getBackend();

  try {
    const raw = await fs.readFile(localPathForKey(key), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeJSON(key, value) {
  await getBackend();

  const file = localPathForKey(key);
  await ensureLocalDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}
