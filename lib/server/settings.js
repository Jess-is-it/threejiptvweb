import 'server-only';

import { getAdminDb, mergeSettings, saveAdminDb } from './adminDb';
import { defaultPublicSettings } from '../settingsDefaults';

function parseServersFromEnv() {
  const raw =
    process.env.XUIONE_URLS ||
    process.env.XUI_SERVERS ||
    process.env.NEXT_PUBLIC_XUI_SERVERS ||
    '';

  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => (u.endsWith('/') ? u : `${u}/`));

  return list;
}

export async function getPublicSettings() {
  const db = await getAdminDb();
  const s = mergeSettings(defaultPublicSettings(), db.settings || {});

  // Allow env vars to provide servers only if admin settings didn't set any.
  const envServers = parseServersFromEnv();
  if ((!Array.isArray(s.xuione?.servers) || s.xuione.servers.length === 0) && envServers.length) {
    s.xuione.servers = envServers;
  }

  return s;
}

export async function updatePublicSettings(patch) {
  const db = await getAdminDb();
  db.settings = mergeSettings(db.settings || defaultPublicSettings(), patch || {});
  await saveAdminDb(db);
  return db.settings;
}
