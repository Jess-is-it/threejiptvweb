import 'server-only';

import { getAdminDb, saveAdminDb } from './adminDb';

export function secretKeys() {
  return {
    tmdbApiKey: 'tmdbApiKey',
    mailFrom: 'mailFrom',
    mailUser: 'mailUser',
    mailPass: 'mailPass',
    firebaseApiKey: 'firebaseApiKey',
    firebaseAuthDomain: 'firebaseAuthDomain',
    firebaseProjectId: 'firebaseProjectId',
    firebaseAppId: 'firebaseAppId',
  };
}

export async function getSecret(key) {
  const db = await getAdminDb();
  return String(db.secrets?.[key] || '').trim();
}

export async function setSecret(key, value) {
  const v = String(value ?? '').trim();
  const db = await getAdminDb();

  if (!v) {
    delete db.secrets[key];
    await saveAdminDb(db);
    return;
  }

  db.secrets[key] = v;
  await saveAdminDb(db);
}

export async function getSecretsStatus() {
  const db = await getAdminDb();
  const keys = secretKeys();
  const out = {};
  for (const k of Object.values(keys)) {
    out[k] = { set: Boolean(db.secrets?.[k]) };
  }
  return out;
}
