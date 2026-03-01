import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from './adminDb';

function nowMs() {
  return Date.now();
}

export async function createUserNotification({
  username,
  title,
  message,
  reportId,
  requestId,
  type = 'report',
  meta = null,
}) {
  const u = String(username || '').trim();
  if (!u) throw new Error('Missing username');

  const db = await getAdminDb();
  db.notifications = db.notifications && typeof db.notifications === 'object' ? db.notifications : {};
  const list = Array.isArray(db.notifications[u]) ? db.notifications[u] : [];

  list.unshift({
    id: crypto.randomUUID(),
    createdAt: nowMs(),
    readAt: null,
    type: String(type || 'report'),
    title: String(title || 'Update'),
    message: String(message || ''),
    reportId: reportId ? String(reportId) : null,
    requestId: requestId ? String(requestId) : null,
    meta: meta && typeof meta === 'object' ? meta : null,
  });

  db.notifications[u] = list.slice(0, 200);
  await saveAdminDb(db);
}
