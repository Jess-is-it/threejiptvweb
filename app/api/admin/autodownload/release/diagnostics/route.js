import { NextResponse } from 'next/server';

import crypto from 'node:crypto';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getAdminDb, saveAdminDb } from '../../../../../../lib/server/adminDb';
import { decryptString } from '../../../../../../lib/server/vault';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from '../../../../../../lib/server/autodownload/autodownloadDb';
import { SSHService } from '../../../../../../lib/server/autodownload/sshService';
import { resolveTmdbTitle } from '../../../../../../lib/server/autodownload/tmdbService';
import { buildReleaseTagFromDateKey, normalizeReleaseTimezone } from '../../../../../../lib/server/autodownload/releaseSchedule';
import { releaseDueSelections } from '../../../../../../lib/server/autodownload/releaseService';

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

function sanitizeFsName(name) {
  const s = String(name || '').trim();
  const cleaned = s
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned.slice(0, 150) || 'Untitled';
}

function splitRelPath(relPath = '') {
  const parts = String(relPath || '')
    .split('/')
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  return {
    releaseTag: parts[0] || '',
    folderLabel: parts.slice(1).join('/') || '',
  };
}

function parseTitleYearFromFolderLabel(label = '') {
  const raw = String(label || '').trim().replace(/\/+$/, '');
  const base = raw.includes('/') ? raw.split('/').slice(-1)[0] : raw;
  const yearMatch = base.match(/\((\d{4})\)\s*$/);
  const year = yearMatch ? String(yearMatch[1]) : '';
  const title = base.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  return { title, year };
}

function parseReleaseDateFromTag(tag = '') {
  const raw = String(tag || '').trim();
  const m = raw.match(/^reldate(\d{1,2})-(\d{1,2})-(\d{2})$/i);
  if (!m) return '';
  const month = String(m[1]).padStart(2, '0');
  const day = String(m[2]).padStart(2, '0');
  const yy = Number(m[3]);
  const year = 2000 + (Number.isFinite(yy) ? yy : 0);
  if (year < 2000 || year > 2100) return '';
  return `${year}-${month}-${day}`;
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

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  const schedulerAuthed = !admin && hasSchedulerToken(req);
  if (!admin && !schedulerAuthed) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {}
  const action = String(body?.action || '').trim().toLowerCase();
  if (action !== 'adopt_orphans') {
    return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
  }

  const dryRun = body?.dryRun === true;
  const runRelease = body?.runRelease !== false;

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
  db.downloadsSeries = Array.isArray(db.downloadsSeries) ? db.downloadsSeries : [];
  const dbRows = db.downloadsSeries.filter((row) => String(row?.holdDir || '').startsWith(`${processingDir}/`));
  const dbRelPaths = new Set(
    dbRows
      .map((row) => String(row?.holdDir || '').slice((`${processingDir}/`).length))
      .map((p) => p.replace(/^\/+/, '').replace(/\/+$/, ''))
      .filter(Boolean)
  );

  let diskRelPaths = [];
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
      'find "$PROC" -mindepth 2 -maxdepth 2 -type d -printf "%P\\n" 2>/dev/null || true',
    ].join('\n');
    const r = await ssh.exec(cmd, { sudo: false, timeoutMs: 90000 });
    const out = String(r?.stdout || '');
    if (!out.includes('__MISSING_PROC__')) {
      diskRelPaths = out
        .split(/\r?\n/)
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .map((p) => p.replace(/^\/+/, '').replace(/\/+$/, ''))
        .filter(Boolean);
    }
  } finally {
    await ssh.close();
  }

  const diskSet = new Set(diskRelPaths);
  const missingInDb = [];
  for (const rel of diskSet) {
    if (!dbRelPaths.has(rel)) missingInDb.push(rel);
  }

  const tz = normalizeReleaseTimezone(settings?.release?.timezone || settings?.schedule?.timezone || 'Asia/Manila');
  const delayDays = Math.max(0, Math.min(30, Math.floor(Number(settings?.release?.delayDays ?? 3))));
  const adopted = [];
  const skipped = [];
  const failed = [];
  const nowTs = Date.now();

  for (const relPath of missingInDb.slice(0, 200)) {
    const { releaseTag, folderLabel } = splitRelPath(relPath);
    const releaseDateFromTag = parseReleaseDateFromTag(releaseTag);
    const releaseDate = String(releaseDateFromTag || '').trim();
    const { title, year } = parseTitleYearFromFolderLabel(folderLabel);
    if (!title) {
      skipped.push({ relPath, reason: 'missing_title' });
      continue;
    }

    let tmdb = null;
    try {
      tmdb = await resolveTmdbTitle({ kind: 'series', title, year });
    } catch (e) {
      failed.push({ relPath, error: e?.message || 'TMDB resolve failed.' });
      continue;
    }
    if (!tmdb?.ok || !Number(tmdb?.id || 0)) {
      failed.push({ relPath, error: 'TMDB match not found.' });
      continue;
    }

    const existing = db.downloadsSeries.find(
      (row) => Number(row?.tmdb?.id || 0) === Number(tmdb.id) && String(row?.status || '').toLowerCase() !== 'deleted'
    );
    if (existing) {
      skipped.push({ relPath, reason: 'already_in_queue', tmdbId: tmdb.id, id: existing.id });
      continue;
    }

    const genre = sanitizeFsName(String((tmdb.genres || [])[0] || 'Uncategorized').trim() || 'Uncategorized');
    const seriesFolder = sanitizeFsName(`${tmdb.title}${tmdb.year ? ` (${tmdb.year})` : ''}`);
    const finalTargetDir = `${mountDir}/Series/${genre}/${seriesFolder}`;
    const baseFolder = sanitizeFsName(folderLabel.split('/').slice(-1)[0] || seriesFolder);
    const holdDir = `${processingDir}/${sanitizeFsName(releaseTag)}/${baseFolder}`;

    const record = {
      id: crypto.randomUUID(),
      type: 'series',
      title: tmdb.title || title,
      year: String(tmdb.year || year || '').trim(),
      tmdb: {
        id: Number(tmdb.id),
        mediaType: 'tv',
        title: tmdb.title || title,
        year: String(tmdb.year || year || '').trim(),
        imdbId: '',
        originalLanguage: tmdb.originalLanguage || '',
        genres: Array.isArray(tmdb.genres) ? tmdb.genres : [],
        rating: tmdb.rating ?? null,
        runtime: tmdb.runtime ?? null,
        overview: tmdb.overview || '',
        posterPath: tmdb.posterPath || '',
        backdropPath: tmdb.backdropPath || '',
      },
      targetCategory: null,
      targetGenre: genre,
      url: null,
      qbHash: null,
      qbName: null,
      status: 'Cleaned',
      progress: 1,
      sizeBytes: null,
      addedAt: nowTs,
      completedAt: nowTs,
      cleanedAt: nowTs,
      error: '',
      savePath: null,
      sourceCleanupPath: '',
      category: null,
      source: null,
      sourceAttempts: 0,
      sourceLastAttemptAt: null,
      nextSourceRetryAt: null,
      seriesMeta: {
        mode: 'adopted_orphan',
        pipelineKey: 'adopted',
        acquisitionMode: 'adopt_orphan',
      },
      selectionLogId: null,
      releaseDate: releaseDate || '',
      releaseTag: releaseDate ? buildReleaseTagFromDateKey(releaseDate) : String(releaseTag || '').trim(),
      releaseTimezone: tz,
      releaseDelayDays: delayDays,
      releaseState: 'waiting',
      releasedAt: null,
      holdDir,
      finalTargetDir,
      finalDir: holdDir,
      adoptedFromDisk: true,
      adoptedRelPath: relPath,
      adoptedAt: nowTs,
    };

    adopted.push({
      relPath,
      tmdbId: tmdb.id,
      title: record.title,
      year: record.year,
      releaseDate: record.releaseDate,
      genre,
    });
    if (!dryRun) db.downloadsSeries.unshift(record);
  }

  if (!dryRun && adopted.length) {
    db.downloadsSeries = db.downloadsSeries.slice(0, 5000);
    await saveAdminDb(db);
  }

  let release = null;
  if (!dryRun && runRelease) {
    release = await releaseDueSelections({ type: 'series' }).catch((e) => ({ ok: false, error: e?.message || 'release failed' }));
  }

  return NextResponse.json(
    {
      ok: true,
      dryRun,
      runRelease,
      processingDir,
      missingInDbCount: missingInDb.length,
      adoptedCount: adopted.length,
      adoptedSample: adopted.slice(0, 40),
      skippedCount: skipped.length,
      skippedSample: skipped.slice(0, 40),
      failedCount: failed.length,
      failedSample: failed.slice(0, 40),
      release,
    },
    { status: 200 }
  );
}
