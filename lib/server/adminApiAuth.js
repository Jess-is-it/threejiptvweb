import 'server-only';

import { adminCookieName, getAdminFromSessionToken } from './adminAuth';

export async function requireAdminFromRequest(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  return admin || null;
}

