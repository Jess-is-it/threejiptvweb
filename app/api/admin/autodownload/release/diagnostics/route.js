import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../../lib/server/adminDb';
import { decryptString } from '../../../../../../lib/server/vault';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from '../../../../../../lib/server/autodownload/autodownloadDb';
import { SSHService } from '../../../../../../lib/server/autodownload/sshService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasSchedulerToken(req) {
  const token = String(process.env.SCHEDULER_TOKEN || '').trim();
  if (!token) return false;
  const q = new URL(req.url).searchParams.get('token') || '';
  const h = req.headers.get('x-scheduler-token') || '';
  return q === token || h === token;
}

function shQuote(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
}

function normalizeMountDir(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function processingDirFromSettings({ mountDir, settings } = {}) {
  const root = normalizeMountDir(mountDir);
  if (!root) return '';
  const seriesProcessing = String(settings?.libraryFolders?.series?.processing || 'Cleaned and Ready').trim() || 'Cleaned and Ready';
  return `${root}/qBittorrent/Series/${seriesProcessing}`.replace(/\/+$/, '');
}

function sshFromEngineHost(engineHost) {
  return new SSHService({
    host: engineHost.host,
    port: engineHost.port,
    username: engineHost.username,
    authType: engineHost.authType,
    password: engineHost.passwordEnc ? decryptString(engineHost.passwordEnc) : '',
    privateKey: engineHost.privateKeyEnc ? decryptString(engineHost.privateKeyEnc) : '',
    passphrase: engineHost.passphraseEnc ? decryptString(engineHost.passphraseEnc) : '',
    sudoPassword: engineHost.sudoPasswordEnc ? decryptString(engineHost.sudoPasswordEnc) : '',
  });
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  const schedulerAuthed = !admin && hasSchedulerToken(req);
  if (!admin && !schedulerAuthed) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await getAutodownloadSettings().catch(() => null);
  const mount = await getMountSettings().catch(() => null);
  const mountDir = normalizeMountDir(mount?.mountDir || '');
  const processingDir = processingDirFromSettings({ mountDir, settings });
  const engineHost = await getEngineHost().catch(() => null);
  if (!engineHost?.host) {
    return NextResponse.json({ ok: false, error: 'Engine host not configured.' }, { status: 400 });
  }
  if (!processingDir) {
    return NextResponse.json({ ok: false, error: 'Missing mountDir/processingDir.' }, { status: 400 });
  }

  const db = await getAdminDb();
  const dbRows = (Array.isArray(db?.downloadsSeries) ? db.downloadsSeries : []).filter((row) =>
    String(row?.holdDir || '').startsWith(`${processingDir}/`)
  );
  const dbRelPaths = new Set(
    dbRows
      .map((row) => String(row?.holdDir || '').slice((`${processingDir}/`).length))
      .map((p) => p.replace(/^\/+/, '').replace(/\/+$/, ''))
      .filter(Boolean)
  );

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    const cmd = [
      'set -euo pipefail',
      `PROC=${shQuote(processingDir)}`,
      'if [ ! -d "$PROC" ]; then',
      '  echo "__MISSING_PROC__"',
      '  exit 0',
      'fi',
      'count="$(find "$PROC" -mindepth 2 -maxdepth 2 -type d -print 2>/dev/null | wc -l | tr -d \' \')"',
      'echo "__COUNT__:$count"',
      'find "$PROC" -mindepth 2 -maxdepth 2 -type d -printf "%P\\n" 2>/dev/null || true',
    ].join('\n');
    const r = await ssh.exec(cmd, { sudo: false, timeoutMs: 60000 });
    const out = String(r?.stdout || '');
    if (out.includes('__MISSING_PROC__')) {
      return NextResponse.json(
        {
          ok: true,
          processingDir,
          disk: { missing: true, count: 0, relPaths: [] },
          db: { count: dbRows.length },
        },
        { status: 200 }
      );
    }
    const countMatch = out.match(/__COUNT__:(\d+)/);
    const diskCount = countMatch ? Number(countMatch[1] || 0) : 0;
    const relPaths = out
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter((line) => Boolean(line) && !line.startsWith('__COUNT__'));

    const diskSet = new Set(relPaths.map((p) => p.replace(/^\/+/, '').replace(/\/+$/, '')).filter(Boolean));
    const missingOnDisk = [];
    for (const p of dbRelPaths) {
      if (!diskSet.has(p)) missingOnDisk.push(p);
    }
    const missingInDb = [];
    for (const p of diskSet) {
      if (!dbRelPaths.has(p)) missingInDb.push(p);
    }

    return NextResponse.json(
      {
        ok: true,
        processingDir,
        disk: {
          count: diskCount,
          sample: relPaths.slice(0, 40),
        },
        db: {
          count: dbRows.length,
          missingOnDiskCount: missingOnDisk.length,
          missingOnDiskSample: missingOnDisk.slice(0, 40),
          missingInDbCount: missingInDb.length,
          missingInDbSample: missingInDb.slice(0, 40),
        },
      },
      { status: 200 }
    );
  } finally {
    await ssh.close();
  }
}

