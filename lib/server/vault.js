import 'server-only';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEY_ENV = 'ADMIN_DATA_KEY';
const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const LOCAL_KEY_FILE = path.join(process.cwd(), 'data', '.admin', 'admin_data_key.txt');

function hasNetlifyBlobsContext() {
  return Boolean(globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT);
}

function parseKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  // Prefer base64 (32 bytes -> 44 chars incl padding), but accept hex too.
  const isHex = /^[0-9a-f]{64}$/i.test(s);
  if (isHex) return Buffer.from(s, 'hex');

  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32) return b;
  } catch {}

  // Derive a stable 32-byte key from any passphrase-like value.
  return crypto.createHash('sha256').update(s, 'utf8').digest();
}

function ensureLocalKeyFile() {
  const dir = path.dirname(LOCAL_KEY_FILE);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}

  try {
    if (fs.existsSync(LOCAL_KEY_FILE)) return;
    const key = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(LOCAL_KEY_FILE, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(LOCAL_KEY_FILE, 0o600);
    } catch {}
  } catch {}
}

function getLocalKey() {
  if (hasNetlifyBlobsContext()) return null;
  ensureLocalKeyFile();
  try {
    const raw = fs.readFileSync(LOCAL_KEY_FILE, 'utf8');
    return parseKey(raw);
  } catch {
    return null;
  }
}

function getKey() {
  const key = parseKey(process.env[KEY_ENV]) || getLocalKey();
  if (!key || key.length !== 32) {
    throw new Error(
      `Missing/invalid ${KEY_ENV}. Set a 32-byte base64/hex key (or any passphrase) in the environment (recommended). ` +
        `For local installs, a key file is created at ${LOCAL_KEY_FILE}.`
    );
  }
  return key;
}

export function vaultKeyEnv() {
  return KEY_ENV;
}

export function isEncryptedPayload(v) {
  return Boolean(v && typeof v === 'object' && v.v === 1 && v.alg === ALG && v.iv && v.tag && v.data);
}

export function encryptString(plain) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const data = Buffer.concat([cipher.update(String(plain ?? ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptString(payload) {
  if (!isEncryptedPayload(payload)) return String(payload ?? '');
  const key = getKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');

  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString('utf8');
}

export function encryptJson(obj) {
  return encryptString(JSON.stringify(obj ?? null));
}

export function decryptJson(payload) {
  const s = decryptString(payload);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
