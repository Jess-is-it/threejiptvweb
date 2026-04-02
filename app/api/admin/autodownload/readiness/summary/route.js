import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../../lib/server/adminDb';
import { buildAutodownloadReadinessModel } from '../../../../../../lib/autodownload/readinessModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildSummary(db) {
  const engine = Array.isArray(db?.engineHosts) ? db.engineHosts[0] || null : null;
  const model = buildAutodownloadReadinessModel({
    settings: db?.autodownloadSettings || null,
    engineHost: engine,
    mount: db?.mountSettings || null,
    mountStatus: db?.mountStatus || null,
    qb: db?.autodownloadSettings?.downloadClient || null,
    xui: db?.xuiIntegration || null,
    providers: Array.isArray(db?.sourceProviders) ? db.sourceProviders : [],
  });

  return {
    passed: model.passed,
    total: model.total,
    status: model.status,
    checks: model.items.map((item) => ({ key: item.key, ok: item.ok })),
    model: {
      coreReady: model.coreReady,
      connectivityReady: model.connectivityReady,
      e2eReady: model.e2eReady,
      passed: model.passed,
      total: model.total,
      status: model.status,
      items: model.items,
    },
  };
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const db = await getAdminDb();
  const summary = buildSummary(db);
  return NextResponse.json({ ok: true, summary }, { status: 200 });
}
