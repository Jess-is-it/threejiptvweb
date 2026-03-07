import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../../lib/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isObject(v) {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v));
}

function toBool(v) {
  return v === true;
}

function buildSummary(db) {
  const settings = isObject(db?.autodownloadSettings) ? db.autodownloadSettings : {};
  const schedule = isObject(settings?.schedule) ? settings.schedule : {};
  const engine = Array.isArray(db?.engineHosts) ? db.engineHosts[0] || null : null;
  const mount = isObject(db?.mountSettings) ? db.mountSettings : {};
  const mountStatus = isObject(db?.mountStatus) ? db.mountStatus : {};
  const qb = isObject(settings?.downloadClient) ? settings.downloadClient : {};
  const xui = isObject(db?.xuiIntegration) ? db.xuiIntegration : {};
  const providers = Array.isArray(db?.sourceProviders) ? db.sourceProviders : [];

  const moviesEnabled = toBool(settings?.moviesEnabled);
  const seriesEnabled = toBool(settings?.seriesEnabled);
  const coreEnabled = toBool(settings?.enabled) && (moviesEnabled || seriesEnabled);
  const scheduleConfigured = Boolean(
    String(schedule?.timezone || '').trim() &&
      Array.isArray(schedule?.days) &&
      schedule.days.length > 0 &&
      String(schedule?.startTime || '').trim() &&
      String(schedule?.endTime || '').trim()
  );

  const engineConfigured = Boolean(
    String(engine?.host || '').trim() &&
      String(engine?.username || '').trim() &&
      String(engine?.authType || '').trim() &&
      (String(engine?.passwordEnc || '').trim() || String(engine?.privateKeyEnc || '').trim())
  );

  const mountConfigured = Boolean(
    String(mount?.windowsHost || '').trim() &&
      String(mount?.shareName || '').trim() &&
      String(mount?.mountDir || '').trim() &&
      String(mount?.usernameEnc || '').trim() &&
      String(mount?.passwordEnc || '').trim()
  );

  const mountHealthy = toBool(mountStatus?.ok);

  const qbConfigured = Boolean(
    String(qb?.type || 'qbittorrent').trim().toLowerCase() === 'qbittorrent' &&
      String(qb?.usernameEnc || '').trim() &&
      String(qb?.passwordEnc || '').trim() &&
      String(qb?.moviesSavePath || '').trim() &&
      String(qb?.seriesSavePath || '').trim()
  );

  const enabledProviders = providers.filter((p) => p?.enabled !== false);
  const healthyProviders = enabledProviders.filter((p) =>
    ['healthy', 'degraded'].includes(String(p?.status || '').toLowerCase())
  );
  const providersHealthy = healthyProviders.length > 0;

  const strategiesConfigured = Boolean(
    isObject(settings?.movieSelectionStrategy) && isObject(settings?.seriesSelectionStrategy)
  );

  const xuiConfigured = Boolean(
    String(xui?.baseUrl || '').trim() &&
      String(xui?.accessCodeEnc || '').trim() &&
      String(xui?.apiKeyEnc || '').trim() &&
      (!moviesEnabled || String(xui?.watchFolderIdMovies || '').trim()) &&
      (!seriesEnabled || String(xui?.watchFolderIdSeries || '').trim())
  );

  const checks = [
    { key: 'policy', ok: coreEnabled && scheduleConfigured },
    { key: 'engine', ok: engineConfigured },
    { key: 'mount_config', ok: mountConfigured },
    { key: 'mount_state', ok: mountHealthy },
    { key: 'qb', ok: qbConfigured },
    { key: 'providers', ok: providersHealthy },
    { key: 'strategies', ok: strategiesConfigured },
    { key: 'xui', ok: xuiConfigured },
  ];

  const total = checks.length;
  const passed = checks.filter((x) => x.ok).length;
  const status = passed === total ? 'good' : passed >= Math.ceil(total / 2) ? 'warn' : 'bad';

  return {
    passed,
    total,
    status,
    checks,
  };
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const db = await getAdminDb();
  const summary = buildSummary(db);
  return NextResponse.json({ ok: true, summary }, { status: 200 });
}

