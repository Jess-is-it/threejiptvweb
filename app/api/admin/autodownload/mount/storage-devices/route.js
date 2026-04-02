import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getAdminDb } from '../../../../../../lib/server/adminDb';
import { fetchVodStorageDevices } from '../../../../../../lib/server/autodownload/mountService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallbackStorageDevices(db, errorMessage = '') {
  const preferredPath = String(db?.mountSettings?.xuiVodPath || '').trim() || '/home/xui/content/vod';
  const vodState = db?.deletionState?.vodState && typeof db.deletionState.vodState === 'object' ? db.deletionState.vodState : null;
  const logicalSize = Number(vodState?.totalBytes || 0) || 0;
  const logicalUsed = Number(vodState?.usedBytes || 0) || 0;
  const logicalAvail = Number(vodState?.availBytes || 0) || Math.max(0, logicalSize - logicalUsed);
  const usedPct = logicalSize > 0 ? Math.round((logicalUsed / logicalSize) * 100) : null;
  if (logicalSize <= 0 && !String(vodState?.resolvedPath || preferredPath).trim()) return null;
  return {
    checkedAt: Date.now(),
    preferredPath,
    resolvedPath: String(vodState?.resolvedPath || preferredPath).trim() || preferredPath,
    pathExists: logicalSize > 0,
    candidatePaths: [preferredPath].filter(Boolean),
    note: errorMessage
      ? `Live storage probe failed. Showing last known VOD storage snapshot. ${errorMessage}`
      : 'Showing last known VOD storage snapshot.',
    logical: {
      target: String(vodState?.resolvedPath || preferredPath).trim() || preferredPath,
      source: String(vodState?.source || '').trim() || 'last_known',
      fstype: String(vodState?.fstype || '').trim() || 'unknown',
      size: logicalSize,
      used: logicalUsed,
      avail: logicalAvail,
      usedPct,
      poolType: String(vodState?.poolType || '').trim() || 'unknown',
      pooled: ['combined', 'lvm', 'raid', 'encrypted', 'virtual'].includes(String(vodState?.poolType || '').trim().toLowerCase()),
    },
    memberDiskCount: Number(vodState?.memberDiskCount || 0) || 0,
    memberDiskRawTotal: 0,
    rows: [
      {
        role: 'Active volume',
        name: 'VOD volume',
        path: String(vodState?.source || '').trim() || 'last_known',
        type: 'mount',
        fstype: String(vodState?.fstype || '').trim() || 'unknown',
        size: logicalSize,
        available: logicalAvail,
        availableKnown: logicalSize > 0,
        used: logicalUsed,
        usedPct,
        mountpoint: String(vodState?.resolvedPath || preferredPath).trim() || preferredPath,
        note: 'Last known VOD storage state from AutoDelete scheduler.',
      },
    ],
  };
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const storageDevices = await fetchVodStorageDevices();
    return NextResponse.json({ ok: true, storageDevices }, { status: 200 });
  } catch (e) {
    const db = await getAdminDb().catch(() => null);
    const fallback = fallbackStorageDevices(db, e?.message || 'Failed to read storage devices.');
    if (fallback) {
      return NextResponse.json({ ok: true, storageDevices: fallback, fallback: true }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to read storage devices.' }, { status: 400 });
  }
}
