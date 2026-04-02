import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../../lib/server/adminApiAuth';
import {
  appendVpnDiagnosticJobLog,
  completeVpnDiagnosticJob,
  createVpnDiagnosticJob,
  failVpnDiagnosticJob,
  getVpnDiagnosticJob,
  updateVpnDiagnosticJob,
} from '../../../../../../../lib/server/autodownload/vpnDiagnosticsStore';
import { runQbittorrentVpnDownloadTest } from '../../../../../../../lib/server/autodownload/vpnService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = String(searchParams.get('jobId') || '').trim();
  if (!jobId) return NextResponse.json({ ok: false, error: 'Missing jobId.' }, { status: 400 });

  const job = getVpnDiagnosticJob(jobId);
  if (!job) return NextResponse.json({ ok: false, error: 'Job not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, job }, { status: 200 });
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const job = createVpnDiagnosticJob({
    kind: 'vpn_download_test',
    title: 'VPN qB Download Test',
  });

  updateVpnDiagnosticJob(job.id, {
    phaseKey: 'queued',
    phaseLabel: 'Queued',
    progress: 1,
  });
  appendVpnDiagnosticJobLog(job.id, 'VPN-only qB download test queued.');

  void (async () => {
    try {
      const result = await runQbittorrentVpnDownloadTest({
        maxRunMinutes: body?.maxRunMinutes,
        minSeeders: body?.minSeeders,
        report: (patch = {}) => {
          if (patch?.log) appendVpnDiagnosticJobLog(job.id, patch.log);
          updateVpnDiagnosticJob(job.id, {
            phaseKey: patch?.phaseKey || undefined,
            phaseLabel: patch?.phaseLabel || undefined,
            progress: Number.isFinite(Number(patch?.progress)) ? Math.max(0, Math.min(99, Number(patch.progress))) : undefined,
            result: patch?.meta ? { live: patch.meta } : undefined,
          });
        },
      });
      completeVpnDiagnosticJob(job.id, result, result?.summary || 'VPN-only qB download test completed.');
    } catch (error) {
      const message = error?.message || 'VPN-only qB download test failed.';
      appendVpnDiagnosticJobLog(job.id, message, 'error');
      failVpnDiagnosticJob(job.id, message);
    }
  })();

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
