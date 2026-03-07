import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../../lib/server/adminApiAuth';
import { getAdminDb, saveAdminDb } from '../../../../../../lib/server/adminDb';
import { clearDownloadsForType } from '../../../../../../lib/server/autodownload/downloadService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PURGE_CONFIRM_PHRASE = 'PURGE_MOVIES_LIBRARY';
const PURGE_ENV_FLAG = 'ALLOW_MOVIE_LIBRARY_PURGE';

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function sanitizeType(type) {
  return String(type || '').trim().toLowerCase() === 'series' ? 'series' : 'movie';
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  const action = String(body?.action || '').trim().toLowerCase();
  if (action !== 'delete_all') {
    return NextResponse.json({ ok: false, error: 'Unsupported bulk action.' }, { status: 400 });
  }

  const targetType = sanitizeType(body?.type || 'movie');
  const requestedPurgeNas = toBool(body?.purgeNas);
  let purgeNas = false;
  let purgeNasAuthorized = false;

  if (requestedPurgeNas) {
    if (targetType !== 'movie') {
      return NextResponse.json({ ok: false, error: 'NAS purge is only supported for movie type.' }, { status: 400 });
    }

    const purgeEnabled = toBool(process.env[PURGE_ENV_FLAG]);
    if (!purgeEnabled) {
      return NextResponse.json(
        {
          ok: false,
          error: `Movie NAS purge is safety-locked. Set ${PURGE_ENV_FLAG}=true and provide explicit confirmation to allow it.`,
        },
        { status: 403 }
      );
    }

    const explicitUserInstruction = toBool(body?.explicitUserInstruction);
    const confirmPhrase = String(body?.confirmPhrase || '').trim();
    if (!explicitUserInstruction || confirmPhrase !== PURGE_CONFIRM_PHRASE) {
      return NextResponse.json(
        {
          ok: false,
          error: `Movie NAS purge requires explicitUserInstruction=true and confirmPhrase=${PURGE_CONFIRM_PHRASE}.`,
        },
        { status: 400 }
      );
    }

    purgeNas = true;
    purgeNasAuthorized = true;
  }

  try {
    const result = await clearDownloadsForType({
      type: targetType,
      purgeNas,
      purgeNasAuthorized,
    });

    const clearedType = String(result?.type || targetType).toLowerCase() === 'series' ? 'series' : 'movie';
    const shouldClearSelectionLogs =
      clearedType === 'movie' ? body?.clearSelectionLogs !== false : Boolean(body?.clearSelectionLogs);
    let deletedSelectionLogs = 0;
    if (shouldClearSelectionLogs) {
      const db = await getAdminDb();
      const all = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
      const next =
        clearedType === 'series'
          ? all.filter((x) => String(x?.selectionType || 'movie').toLowerCase() !== 'series')
          : all.filter((x) => String(x?.selectionType || 'movie').toLowerCase() !== 'movie');
      deletedSelectionLogs = Math.max(0, all.length - next.length);
      if (deletedSelectionLogs > 0) {
        db.selectionLogs = next;
        await saveAdminDb(db);
      }
    }

    result.deletedSelectionLogs = deletedSelectionLogs;
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Bulk action failed.' }, { status: 400 });
  }
}
