import 'server-only';

import crypto from 'node:crypto';

import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';

import { getAdminDb, saveAdminDb } from './adminDb';

const ADMIN_COOKIE = '3jtv_admin';

function nowMs() {
  return Date.now();
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function deriveUsernameFromEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return '';
  const u = e.split('@')[0] || '';
  return normalizeUsername(u || e);
}

function adminUsername(admin) {
  const u = normalizeUsername(admin?.username);
  if (u) return u;
  return deriveUsernameFromEmail(admin?.email);
}

export function adminCookieName() {
  return ADMIN_COOKIE;
}

export async function listAdminsSafe() {
  const db = await getAdminDb();
  return db.admins.map((a) => ({
    id: a.id,
    username: adminUsername(a),
    email: a.email,
    createdAt: a.createdAt,
    lastLoginAt: a.lastLoginAt || null,
  }));
}

export async function hasAnyAdmin() {
  const db = await getAdminDb();
  return db.admins.length > 0;
}

export async function createAdmin({ username, email, password }) {
  const db = await getAdminDb();
  const e = normalizeEmail(email);
  if (!e) throw new Error('Email is required.');

  const u = normalizeUsername(username) || deriveUsernameFromEmail(e);
  if (!u) throw new Error('Username is required.');
  if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters.');
  if (db.admins.some((a) => adminUsername(a) === u)) throw new Error('Username already exists.');
  if (db.admins.some((a) => normalizeEmail(a.email) === e)) throw new Error('Admin already exists.');

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(String(password), 12);

  db.admins.unshift({
    id,
    username: u,
    email: e,
    passwordHash,
    createdAt: nowMs(),
    lastLoginAt: null,
  });

  await saveAdminDb(db);
  return { id, username: u, email: e };
}

export async function verifyAdminPassword({ username, password }) {
  const db = await getAdminDb();
  const ident = String(username || '').trim();
  const u = normalizeUsername(ident);
  const e = ident.includes('@') ? normalizeEmail(ident) : '';
  const admin = db.admins.find((a) => (u && adminUsername(a) === u) || (e && normalizeEmail(a.email) === e));
  if (!admin) return null;
  const ok = await bcrypt.compare(String(password || ''), String(admin.passwordHash || ''));
  return ok ? { id: admin.id, username: adminUsername(admin), email: admin.email } : null;
}

export async function createAdminSession(adminId, { ttlMs = 1000 * 60 * 60 * 24 * 7 } = {}) {
  const db = await getAdminDb();

  const token = randomToken();
  const exp = nowMs() + ttlMs;
  db.sessions[token] = { adminId, exp };

  const idx = db.admins.findIndex((a) => a.id === adminId);
  if (idx >= 0) db.admins[idx].lastLoginAt = nowMs();

  await saveAdminDb(db);
  return { token, exp };
}

export async function setAdminPassword(adminId, password) {
  if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters.');
  const db = await getAdminDb();
  const idx = db.admins.findIndex((a) => a.id === adminId);
  if (idx < 0) throw new Error('Admin not found.');
  db.admins[idx].passwordHash = await bcrypt.hash(String(password), 12);
  await saveAdminDb(db);
  return true;
}

export async function findAdminByUsernameOrEmail(identifier) {
  const db = await getAdminDb();
  const ident = String(identifier || '').trim();
  const u = normalizeUsername(ident);
  const e = ident.includes('@') ? normalizeEmail(ident) : '';
  const admin = db.admins.find((a) => (u && adminUsername(a) === u) || (e && normalizeEmail(a.email) === e));
  if (!admin) return null;
  return { id: admin.id, username: adminUsername(admin), email: admin.email };
}

export async function deleteAdminSession(token) {
  const db = await getAdminDb();
  if (token && db.sessions && db.sessions[token]) {
    delete db.sessions[token];
    await saveAdminDb(db);
  }
}

export async function getAdminFromSessionToken(token) {
  if (!token) return null;
  const db = await getAdminDb();
  const sess = db.sessions?.[token] || null;
  if (!sess) return null;

  if (Number(sess.exp || 0) <= nowMs()) {
    delete db.sessions[token];
    await saveAdminDb(db);
    return null;
  }

  const admin = db.admins.find((a) => a.id === sess.adminId);
  if (!admin) return null;
  return { id: admin.id, username: adminUsername(admin), email: admin.email };
}

export async function requireAdmin() {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return null;
  return admin;
}
