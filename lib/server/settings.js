import 'server-only';

import { getAdminDb, mergeSettings, saveAdminDb } from './adminDb';
import { defaultPublicSettings } from '../settingsDefaults';


export async function getPublicSettings() {
  const db = await getAdminDb();
  const defaults = defaultPublicSettings();
  const s = mergeSettings(defaults, db.settings || {});

  // XUI playback origins are now sourced from XUI Integration. Keep the
  // legacy settings shape empty so old tv1/tv2 values cannot leak into sessions.
  s.xuione = {
    ...(s.xuione || {}),
    servers: [],
  };

  return s;
}

export async function updatePublicSettings(patch) {
  const db = await getAdminDb();
  db.settings = mergeSettings(db.settings || defaultPublicSettings(), patch || {});
  await saveAdminDb(db);
  return db.settings;
}
