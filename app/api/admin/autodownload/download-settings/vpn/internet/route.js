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
import { testQbittorrentVpnInternetConnection } from '../../../../../../../lib/server/autodownload/vpnService';

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

  const job = createVpnDiagnosticJob({
    kind: 'vpn_internet_test',
    title: 'VPN Internet Test',
  });

  updateVpnDiagnosticJob(job.id, {
    phaseKey: 'queued',
    phaseLabel: 'Queued',
    progress: 1,
  });
  appendVpnDiagnosticJobLog(job.id, 'VPN internet test queued.');

  void (async () => {
    try {
      const result = await testQbittorrentVpnInternetConnection({
        report: (patch = {}) => {
          if (patch?.log) appendVpnDiagnosticJobLog(job.id, patch.log);
          updateVpnDiagnosticJob(job.id, {
            phaseKey: patch?.phaseKey || undefined,
            phaseLabel: patch?.phaseLabel || undefined,
            progress: Number.isFinite(Number(patch?.progress)) ? Math.max(0, Math.min(99, Number(patch.progress))) : undefined,
          });
        },
      });
      if (result?.ok) {
        completeVpnDiagnosticJob(job.id, result, result?.summary || 'VPN internet test completed.');
      } else {
        failVpnDiagnosticJob(job.id, result?.summary || 'VPN internet test failed.', result);
      }
    } catch (error) {
      const message = error?.message || 'VPN internet test failed.';
      appendVpnDiagnosticJobLog(job.id, message, 'error');
      failVpnDiagnosticJob(job.id, message);
    }
  })();

  return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
}
