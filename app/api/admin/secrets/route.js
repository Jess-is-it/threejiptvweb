import { NextResponse } from 'next/server';

import { adminCookieName, getAdminFromSessionToken } from '../../../../lib/server/adminAuth';
import { getSecret, getSecretsStatus, setSecret, secretKeys } from '../../../../lib/server/secrets';
import { getPublicSettings, updatePublicSettings } from '../../../../lib/server/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireAdmin(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return null;
  return admin;
}

function envStatus() {
  return {};
}

async function storedSecrets() {
  const keys = secretKeys();
  return {
    [keys.tmdbApiKey]: await getSecret(keys.tmdbApiKey),
    [keys.mailFrom]: await getSecret(keys.mailFrom),
    [keys.mailUser]: await getSecret(keys.mailUser),
    [keys.mailPass]: await getSecret(keys.mailPass),
    [keys.firebaseApiKey]: await getSecret(keys.firebaseApiKey),
    [keys.firebaseAuthDomain]: await getSecret(keys.firebaseAuthDomain),
    [keys.firebaseProjectId]: await getSecret(keys.firebaseProjectId),
    [keys.firebaseAppId]: await getSecret(keys.firebaseAppId),
  };
}

async function effectiveSecrets() {
  const keys = secretKeys();
  // Prefer admin-store values; fall back to env vars for convenience.
  const get = async (k, envName) => (await getSecret(k)) || String(process.env[envName] || '').trim();

  return {
    [keys.tmdbApiKey]: await get(keys.tmdbApiKey, 'TMDB_API_KEY'),
    [keys.mailFrom]: await get(keys.mailFrom, 'MAIL_FROM'),
    [keys.mailUser]: await get(keys.mailUser, 'MAIL_USER'),
    [keys.mailPass]: await get(keys.mailPass, 'MAIL_PASS'),
    [keys.firebaseApiKey]: await get(keys.firebaseApiKey, 'NEXT_PUBLIC_FIREBASE_API_KEY'),
    [keys.firebaseAuthDomain]: await get(keys.firebaseAuthDomain, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    [keys.firebaseProjectId]: await get(keys.firebaseProjectId, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    [keys.firebaseAppId]: await get(keys.firebaseAppId, 'NEXT_PUBLIC_FIREBASE_APP_ID'),
  };
}

async function xuioneServersEffective() {
  const s = await getPublicSettings();
  const list = Array.isArray(s?.xuione?.servers) ? s.xuione.servers : [];
  return list;
}

function xuiApiInfo() {
  return {
    base: '/api/xuione',
    endpoints: [
      { path: '/api/xuione/live', desc: 'Live channels' },
      { path: '/api/xuione/vod', desc: 'Movies list' },
      { path: '/api/xuione/vod/categories', desc: 'Movie categories' },
      { path: '/api/xuione/vod/[id]', desc: 'Movie details/subtitles' },
      { path: '/api/xuione/series', desc: 'Series list' },
      { path: '/api/xuione/series/categories', desc: 'Series categories' },
      { path: '/api/xuione/series/[id]', desc: 'Series details/episodes' },
    ],
    upstream: 'Xtream/XUI (player_api.php) via streamBase credentials',
  };
}

export async function GET(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const status = await getSecretsStatus();
  const secrets = await effectiveSecrets();
  const xuioneServers = await xuioneServersEffective();
  return NextResponse.json(
    {
      ok: true,
      env: envStatus(),
      status,
      secrets,
      xuioneServers,
      xuiApi: xuiApiInfo(),
      keys: secretKeys(),
    },
    { status: 200 }
  );
}

export async function PUT(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const patch = body?.secrets || body || {};
  const serversPatch = body?.xuioneServers;

  const keys = secretKeys();
  const allowed = new Set(Object.values(keys));

  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) continue;
    await setSecret(k, v);
  }

  if (Array.isArray(serversPatch)) {
    await updatePublicSettings({ xuione: { servers: serversPatch } });
  }

  const status = await getSecretsStatus();
  const secrets = await storedSecrets();
  const xuioneServers = await xuioneServersEffective();
  return NextResponse.json(
    {
      ok: true,
      env: envStatus(),
      status,
      secrets,
      xuioneServers,
      xuiApi: xuiApiInfo(),
      keys,
    },
    { status: 200 }
  );
}
