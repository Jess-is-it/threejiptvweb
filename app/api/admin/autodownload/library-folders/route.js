import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../../lib/server/adminApiAuth';
import { getAdminDb, saveAdminDb } from '../../../../../lib/server/adminDb';
import { decryptString } from '../../../../../lib/server/vault';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from '../../../../../lib/server/autodownload/autodownloadDb';
import { fetchMountStatus } from '../../../../../lib/server/autodownload/mountService';
import { SSHService } from '../../../../../lib/server/autodownload/sshService';
import { buildLibraryPaths, getLibraryFolderConfig } from '../../../../../lib/server/autodownload/libraryFolders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function now() {
  return Date.now();
}

function normalizeFolderName(v, label) {
  const s = String(v || '').trim();
  if (!s) throw new Error(`${label} is required.`);
  if (s.includes('/') || s.includes('\\')) throw new Error(`${label} must not contain slashes.`);
  if (s.includes('..')) throw new Error(`${label} must not contain "..".`);
  if (!/^[A-Za-z0-9 _-]+$/.test(s)) throw new Error(`${label} may only contain letters, numbers, spaces, hyphen, and underscore.`);
  return s;
}

function assertUnique(names, label) {
  const keys = Object.values(names).map((x) => String(x).trim().toLowerCase());
  const set = new Set(keys);
  if (set.size !== keys.length) throw new Error(`${label}: Downloading/Downloaded/Processing folders must be unique.`);
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

function parseSectionBlock(out, name) {
  const start = out.indexOf(`__${name}__`);
  if (start < 0) return [];
  const rest = out.slice(start + name.length + 4);
  const end = rest.indexOf('__');
  const block = end >= 0 ? rest.slice(0, end) : rest;
  return block
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function migrateStageFolders({ mountDir, previousFolders, nextFolders }) {
  const prevSettings = { libraryFolders: previousFolders || {} };
  const nextSettings = { libraryFolders: nextFolders || {} };
  const prevMovie = buildLibraryPaths({ mountDir, type: 'movie', settings: prevSettings });
  const prevSeries = buildLibraryPaths({ mountDir, type: 'series', settings: prevSettings });
  const nextMovie = buildLibraryPaths({ mountDir, type: 'movie', settings: nextSettings });
  const nextSeries = buildLibraryPaths({ mountDir, type: 'series', settings: nextSettings });

  const pathPairs = [
    { oldPath: prevMovie.downloadingDir, newPath: nextMovie.downloadingDir },
    { oldPath: prevMovie.downloadedDir, newPath: nextMovie.downloadedDir },
    { oldPath: prevMovie.processingDir, newPath: nextMovie.processingDir },
    { oldPath: prevSeries.downloadingDir, newPath: nextSeries.downloadingDir },
    { oldPath: prevSeries.downloadedDir, newPath: nextSeries.downloadedDir },
    { oldPath: prevSeries.processingDir, newPath: nextSeries.processingDir },
  ];

  const changed = pathPairs.some((p) => String(p.oldPath || '') !== String(p.newPath || ''));

  if (!changed) {
    return { migrated: [], conflicts: [], errors: [], skippedReason: '' };
  }

  const status = await fetchMountStatus().catch(() => null);
  if (!status?.mounted || !status?.writable) {
    return {
      migrated: [],
      conflicts: [],
      errors: [],
      skippedReason: 'NAS is not mounted/writable, so existing folders were not renamed. Mount first, then save folder structure again.',
    };
  }

  const engineHost = await getEngineHost();
  if (!engineHost) {
    return {
      migrated: [],
      conflicts: [],
      errors: [],
      skippedReason: 'Engine Host is not configured, so existing folders were not renamed.',
    };
  }

  const ssh = sshFromEngineHost(engineHost);
  try {
    const script = `
set -euo pipefail

OLD_0=${JSON.stringify(pathPairs[0].oldPath)}
NEW_0=${JSON.stringify(pathPairs[0].newPath)}
OLD_1=${JSON.stringify(pathPairs[1].oldPath)}
NEW_1=${JSON.stringify(pathPairs[1].newPath)}
OLD_2=${JSON.stringify(pathPairs[2].oldPath)}
NEW_2=${JSON.stringify(pathPairs[2].newPath)}
OLD_3=${JSON.stringify(pathPairs[3].oldPath)}
NEW_3=${JSON.stringify(pathPairs[3].newPath)}
OLD_4=${JSON.stringify(pathPairs[4].oldPath)}
NEW_4=${JSON.stringify(pathPairs[4].newPath)}
OLD_5=${JSON.stringify(pathPairs[5].oldPath)}
NEW_5=${JSON.stringify(pathPairs[5].newPath)}

migrated=()
conflicts=()
errors=()

migrate_path() {
  local old_path="$1"
  local new_path="$2"
  if [ -z "$old_path" ] || [ -z "$new_path" ] || [ "$old_path" = "$new_path" ]; then
    return 0
  fi

  if [ ! -e "$old_path" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$new_path")" >/dev/null 2>&1 || true

  if [ ! -e "$new_path" ]; then
    if mv "$old_path" "$new_path" >/dev/null 2>&1; then
      migrated+=("$old_path -> $new_path")
    else
      errors+=("rename failed: $old_path -> $new_path")
    fi
    return 0
  fi

  if [ ! -d "$old_path" ] || [ ! -d "$new_path" ]; then
    conflicts+=("path conflict: $old_path and $new_path")
    return 0
  fi

  shopt -s dotglob nullglob
  local collision=""
  local item=""
  for item in "$old_path"/*; do
    [ -e "$item" ] || continue
    local bn
    bn="$(basename "$item")"
    if [ -e "$new_path/$bn" ]; then
      collision="$bn"
      break
    fi
  done

  if [ -n "$collision" ]; then
    conflicts+=("cannot merge $old_path into $new_path (existing: $collision)")
    shopt -u dotglob nullglob
    return 0
  fi

  for item in "$old_path"/*; do
    [ -e "$item" ] || continue
    if ! mv "$item" "$new_path/" >/dev/null 2>&1; then
      errors+=("move failed: $item -> $new_path")
      shopt -u dotglob nullglob
      return 0
    fi
  done
  shopt -u dotglob nullglob

  rmdir "$old_path" >/dev/null 2>&1 || true
  migrated+=("$old_path -> $new_path (merged)")
}

migrate_path "$OLD_0" "$NEW_0"
migrate_path "$OLD_1" "$NEW_1"
migrate_path "$OLD_2" "$NEW_2"
migrate_path "$OLD_3" "$NEW_3"
migrate_path "$OLD_4" "$NEW_4"
migrate_path "$OLD_5" "$NEW_5"

echo "__MIGRATED__"
printf "%s\\n" "\${migrated[@]}"
echo "__CONFLICTS__"
printf "%s\\n" "\${conflicts[@]}"
echo "__ERRORS__"
printf "%s\\n" "\${errors[@]}"
echo "__END__"
`;

    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 120000 });
    if (r.code !== 0) {
      return {
        migrated: [],
        conflicts: [],
        errors: [r.stderr || r.stdout || 'Folder migration failed.'],
        skippedReason: '',
      };
    }

    const out = String(r.stdout || '');
    return {
      migrated: parseSectionBlock(out, 'MIGRATED'),
      conflicts: parseSectionBlock(out, 'CONFLICTS'),
      errors: parseSectionBlock(out, 'ERRORS'),
      skippedReason: '',
    };
  } catch (e) {
    return {
      migrated: [],
      conflicts: [],
      errors: [e?.message || 'Folder migration failed.'],
      skippedReason: '',
    };
  } finally {
    await ssh.close();
  }
}

async function checkMismatchWarnings({ mountDir, settings }) {
  const engineHost = await getEngineHost();
  if (!engineHost) return [];

  const movies = buildLibraryPaths({ mountDir, type: 'movie', settings });
  const series = buildLibraryPaths({ mountDir, type: 'series', settings });

  const expected = [
    movies.downloadingDir,
    movies.downloadedDir,
    movies.processingDir,
    series.downloadingDir,
    series.downloadedDir,
    series.processingDir,
  ];

  const oldDefaults = [
    `${String(mountDir).replace(/\/+$/, '')}/Movies/Downloading`,
    `${String(mountDir).replace(/\/+$/, '')}/Movies/Downloaded`,
    `${String(mountDir).replace(/\/+$/, '')}/Movies/Processing`,
    `${String(mountDir).replace(/\/+$/, '')}/Series/Downloading`,
    `${String(mountDir).replace(/\/+$/, '')}/Series/Downloaded`,
    `${String(mountDir).replace(/\/+$/, '')}/Series/Processing`,
  ];

  const ssh = sshFromEngineHost(engineHost);
  try {
    const script = `
set -euo pipefail
paths=(${expected.map((p) => JSON.stringify(p)).join(' ')})
old=(${oldDefaults.map((p) => JSON.stringify(p)).join(' ')})

missing=()
oldpresent=()

for p in "\${paths[@]}"; do
  if [ ! -d "$p" ]; then missing+=("$p"); fi
done
for p in "\${old[@]}"; do
  if [ -d "$p" ]; then oldpresent+=("$p"); fi
done

echo "__MISSING__"
printf "%s\\n" "\${missing[@]}"
echo "__OLD__"
printf "%s\\n" "\${oldpresent[@]}"
echo "__END__"
`;

    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 30000 });
    if (r.code !== 0) return [];
    const out = String(r.stdout || '');

    const missing = parseSectionBlock(out, 'MISSING');
    const old = parseSectionBlock(out, 'OLD');

    const warnings = [];
    if (missing.length) {
      warnings.push(`Configured folders are missing on NAS. Run “Scan & Validate Library”: ${missing.join(', ')}`);
    }
    if (old.length) {
      warnings.push(
        `Legacy stage folders still exist under Movies/Series (${old.join(', ')}). They were replaced by /qBittorrent/... and can be removed once empty.`
      );
    }
    return warnings;
  } catch {
    return [];
  } finally {
    await ssh.close();
  }
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const settings = await getAutodownloadSettings();
  const lf = getLibraryFolderConfig(settings);
  return NextResponse.json({ ok: true, libraryFolders: lf }, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const movies = {
      downloading: normalizeFolderName(body?.movies?.downloading ?? body?.movies_downloading_folder, 'Movies downloading folder name'),
      downloaded: normalizeFolderName(body?.movies?.downloaded ?? body?.movies_downloaded_folder, 'Movies downloaded folder name'),
      processing: normalizeFolderName(body?.movies?.processing ?? body?.movies_processing_folder, 'Movies processing folder name'),
    };
    const series = {
      downloading: normalizeFolderName(body?.series?.downloading ?? body?.series_downloading_folder, 'Series downloading folder name'),
      downloaded: normalizeFolderName(body?.series?.downloaded ?? body?.series_downloaded_folder, 'Series downloaded folder name'),
      processing: normalizeFolderName(body?.series?.processing ?? body?.series_processing_folder, 'Series processing folder name'),
    };

    assertUnique(movies, 'Movies');
    assertUnique(series, 'Series');

    const mount = await getMountSettings();
    const mountDir = String(mount?.mountDir || '').trim();

    const db = await getAdminDb();
    db.autodownloadSettings = db.autodownloadSettings || {};
    const previousFolders = getLibraryFolderConfig(db.autodownloadSettings);
    db.autodownloadSettings.libraryFolders = { movies, series };

    // Keep download client save paths in sync (does not reconfigure remote qB automatically).
    const curSettings = db.autodownloadSettings;
    const moviesPaths = mountDir ? buildLibraryPaths({ mountDir, type: 'movie', settings: curSettings }) : null;
    const seriesPaths = mountDir ? buildLibraryPaths({ mountDir, type: 'series', settings: curSettings }) : null;
    db.autodownloadSettings.downloadClient = db.autodownloadSettings.downloadClient || {};
    if (moviesPaths?.downloadingDir) db.autodownloadSettings.downloadClient.moviesSavePath = moviesPaths.downloadingDir;
    if (seriesPaths?.downloadingDir) db.autodownloadSettings.downloadClient.seriesSavePath = seriesPaths.downloadingDir;

    await saveAdminDb(db);

    const saved = await getAutodownloadSettings();
    const savedFolders = getLibraryFolderConfig(saved);
    const migration = mountDir
      ? await migrateStageFolders({ mountDir, previousFolders, nextFolders: savedFolders })
      : { migrated: [], conflicts: [], errors: [], skippedReason: '' };

    const warnings = [];
    if (migration.skippedReason) warnings.push(migration.skippedReason);
    if (migration.conflicts.length) warnings.push(`Some folders were not auto-migrated: ${migration.conflicts.join('; ')}`);
    if (migration.errors.length) warnings.push(`Folder migration issues: ${migration.errors.join('; ')}`);
    if (mountDir) warnings.push(...(await checkMismatchWarnings({ mountDir, settings: saved })));

    return NextResponse.json(
      { ok: true, libraryFolders: savedFolders, warnings, migrated: migration.migrated, updatedAt: now() },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to save library folder configuration.' }, { status: 400 });
  }
}
