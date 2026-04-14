import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const baseUrl = String(process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const configuredUsername = String(process.env.SMOKE_ADMIN_USERNAME || '').trim();
const configuredPassword = String(process.env.SMOKE_ADMIN_PASSWORD || '').trim();

function randSuffix() {
  return crypto.randomBytes(4).toString('hex');
}

async function maybeCreateAdmin(page) {
  await page.goto(`${baseUrl}/admin/setup`, { waitUntil: 'domcontentloaded' });
  if (!/admin setup/i.test(await page.textContent('body'))) return { created: false, reason: 'setup_page_missing' };

  const username = configuredUsername || `smoke_${randSuffix()}`;
  const email = `smoke_${randSuffix()}@example.com`;
  const password = configuredPassword || `SmokePass_${randSuffix()}!`;

  await page.fill('input[autocomplete="username"]', username);
  await page.fill('input[autocomplete="email"]', email);
  await page.fill('input[autocomplete="new-password"]', password);
  await page.click('button[type="submit"]');

  const body = await page.textContent('body');
  if (/admin created/i.test(body)) return { created: true, username, password };
  if (/already/i.test(body) || /setup failed/i.test(body)) return { created: false, reason: 'admin_exists_or_setup_failed' };
  return { created: false, reason: 'unknown' };
}

async function injectLocalAdminSession(page) {
  const u = new URL(baseUrl);
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error('Session injection is only supported for localhost smoke testing.');
  }

  const dbPath = path.join(process.cwd(), 'data', '.admin', 'db.json');
  const raw = await fs.readFile(dbPath, 'utf8');
  const db = JSON.parse(raw);
  const adminId = String(db?.admins?.[0]?.id || '').trim();
  if (!adminId) throw new Error('No admin found in local db.json to inject a session for.');

  const token = crypto.randomBytes(32).toString('base64url');
  const exp = Date.now() + 1000 * 60 * 30; // 30 minutes
  db.sessions = db.sessions && typeof db.sessions === 'object' ? db.sessions : {};
  db.sessions[token] = { adminId, exp };
  db.updatedAt = Date.now();

  const tmp = `${dbPath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, dbPath);

  await page.context().addCookies([
    {
      name: '3jtv_admin',
      value: token,
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function ensureAdminSession(page) {
  const r = await page.request.get(`${baseUrl}/api/admin/me`, { timeout: 15000 });
  const j = await r.json().catch(() => ({}));
  if (!r.ok() || !j?.ok) throw new Error('Admin session not established.');
}

async function login(page, { username, password }) {
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#admin-username', username);
  await page.fill('#admin-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin**', { timeout: 15000 });
}

async function assertMediaLibrary(page) {
  await page.goto(`${baseUrl}/admin/media-library/movies`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Movie List' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Settings' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Add Movie' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Library Folder Structure (Manual Upload)').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Close' }).first().click();

  await page.goto(`${baseUrl}/admin/media-library/series`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Series List' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Settings' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Add Series' }).waitFor({ timeout: 15000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

let username = configuredUsername;
let password = configuredPassword;

try {
  await page.goto(`${baseUrl}/admin`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/admin/login') && (!username || !password)) {
    const created = await maybeCreateAdmin(page);
    if (created.created) {
      username = created.username;
      password = created.password;
    } else {
      await injectLocalAdminSession(page);
    }
  }

  if (page.url().includes('/admin/login')) {
    if (username && password) await login(page, { username, password });
    else {
      await injectLocalAdminSession(page);
      await page.goto(`${baseUrl}/admin`, { waitUntil: 'domcontentloaded' });
      if (page.url().includes('/admin/login')) throw new Error('Failed to inject admin session (still on login page).');
    }
  }
  await ensureAdminSession(page);

  try {
    await assertMediaLibrary(page);
  } catch (e) {
    const failPath = 'data/.admin/smoke-admin-failed.png';
    await page.screenshot({ path: failPath, fullPage: true }).catch(() => null);
    throw e;
  }

  const outPath = 'data/.admin/smoke-admin.png';
  await page.screenshot({ path: outPath, fullPage: true });
  // eslint-disable-next-line no-console
  console.log(`OK: media library smoke test passed. Screenshot: ${outPath}`);
} finally {
  await browser.close();
}
