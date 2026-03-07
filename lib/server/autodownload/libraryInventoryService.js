import 'server-only';

import { getAdminDb, saveAdminDb } from '../adminDb';
import { decryptString } from '../vault';
import { getEngineHost, getMountSettings } from './autodownloadDb';
import { SSHService } from './sshService';

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function shQuote(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
}

function normalizeCountSuffix(name) {
  return String(name || '').replace(/\(\d+\)\s*$/, '').trim();
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseTitleYear(folderName) {
  const base = String(folderName || '').trim();
  if (!base) return { title: '', year: null };
  const m = base.match(/^(.*?)(?:\s*\((\d{4})\))?$/);
  const rawTitle = normalizeCountSuffix(m?.[1] || base);
  const yearNum = Number(m?.[2] || 0);
  const year = Number.isFinite(yearNum) && yearNum >= 1900 && yearNum <= 2100 ? yearNum : null;
  return { title: rawTitle || base, year };
}

export function makeLibraryInventoryKey(title, year = null) {
  const t = normalizeTitle(title);
  const y = Number(year || 0);
  return `${t}::${Number.isFinite(y) && y > 0 ? y : ''}`;
}

function defaultInventory() {
  return {
    updatedAt: null,
    mountDir: '',
    source: 'mount_scan',
    movies: [],
    series: [],
    folderCounts: {
      moviesByCategory: [],
      moviesByCategoryGenre: [],
      seriesByGenre: [],
    },
    countReports: {
      updatedAt: null,
      moviesPath: '',
      seriesPath: '',
      ok: true,
      error: '',
    },
    stats: {
      movies: 0,
      series: 0,
      total: 0,
    },
    lastError: '',
  };
}

function normalizeInventory(raw) {
  const base = defaultInventory();
  const next = raw && typeof raw === 'object' ? { ...base, ...raw } : base;
  next.movies = Array.isArray(next.movies) ? next.movies : [];
  next.series = Array.isArray(next.series) ? next.series : [];
  next.folderCounts = next.folderCounts && typeof next.folderCounts === 'object' ? { ...base.folderCounts, ...next.folderCounts } : base.folderCounts;
  next.folderCounts.moviesByCategory = Array.isArray(next.folderCounts.moviesByCategory)
    ? next.folderCounts.moviesByCategory
    : [];
  next.folderCounts.moviesByCategoryGenre = Array.isArray(next.folderCounts.moviesByCategoryGenre)
    ? next.folderCounts.moviesByCategoryGenre
    : [];
  next.folderCounts.seriesByGenre = Array.isArray(next.folderCounts.seriesByGenre) ? next.folderCounts.seriesByGenre : [];
  next.countReports = next.countReports && typeof next.countReports === 'object' ? { ...base.countReports, ...next.countReports } : base.countReports;
  next.stats = next.stats && typeof next.stats === 'object' ? { ...base.stats, ...next.stats } : base.stats;
  return next;
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

function stripExtension(fileName) {
  return String(fileName || '').replace(/\.[a-z0-9]{2,4}$/i, '').trim();
}

async function listPaths(ssh, rootDir, minDepth, maxDepth, kind = 'd') {
  const nodeType = String(kind || 'd').toLowerCase() === 'f' ? 'f' : 'd';
  const cmd = [
    'set -e',
    `ROOT=${shQuote(rootDir)}`,
    'if [ ! -d "$ROOT" ]; then exit 0; fi',
    `find "$ROOT" -mindepth ${Number(minDepth)} -maxdepth ${Number(maxDepth)} -type ${nodeType} -print 2>/dev/null || true`,
  ].join('\n');
  const r = await ssh.exec(cmd, { timeoutMs: 120000 });
  if (Number(r?.code || 0) !== 0) {
    const msg = String(r?.stderr || r?.stdout || '').trim();
    throw new Error(msg || `Failed to scan ${rootDir}`);
  }
  return String(r?.stdout || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function uniqBy(items, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(keyFn(item) || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function stripPrefix(path, prefix) {
  const p = String(path || '').trim();
  const x = String(prefix || '').replace(/\/+$/, '');
  if (!p) return '';
  if (p === x) return '';
  if (p.startsWith(`${x}/`)) return p.slice(x.length + 1);
  return p.replace(/^\/+/, '');
}

function buildMovieInventory(paths, moviesRoot) {
  const rows = [];
  for (const absPathRaw of paths) {
    const absPath = String(absPathRaw || '').trim();
    const rel = stripPrefix(absPath, moviesRoot);
    const parts = rel.split('/').filter(Boolean);
    if (parts.length < 3) continue;
    const category = normalizeCountSuffix(parts[0]);
    const genre = normalizeCountSuffix(parts[1]);
    const fileName = parts.slice(2).join('/');
    const leaf = stripExtension(parts[parts.length - 1] || fileName);
    const { title, year } = parseTitleYear(leaf);
    const key = makeLibraryInventoryKey(title, year);
    rows.push({
      title,
      year,
      key,
      normalizedTitle: normalizeTitle(title),
      category,
      genre,
      fileName,
      path: absPath,
    });
  }
  return uniqBy(rows, (x) => x.key || `${x.path}`).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

function buildSeriesInventory(paths, seriesRoot) {
  const rows = [];
  for (const absPath of paths) {
    const rel = stripPrefix(absPath, seriesRoot);
    const parts = rel.split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const genre = normalizeCountSuffix(parts[0]);
    const folder = parts.slice(1).join('/');
    const leaf = parts[parts.length - 1] || folder;
    const { title, year } = parseTitleYear(leaf);
    const key = makeLibraryInventoryKey(title, year);
    rows.push({
      title,
      year,
      key,
      normalizedTitle: normalizeTitle(title),
      genre,
      folder,
      path: absPath,
    });
  }
  return uniqBy(rows, (x) => x.key || `${x.path}`).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

function buildFolderCounts({ movies = [], series = [] } = {}) {
  const movieCategory = new Map();
  const movieCategoryGenre = new Map();
  const seriesGenre = new Map();

  for (const row of Array.isArray(movies) ? movies : []) {
    const category = String(row?.category || 'Uncategorized').trim() || 'Uncategorized';
    const genre = String(row?.genre || 'Uncategorized').trim() || 'Uncategorized';
    movieCategory.set(category, (movieCategory.get(category) || 0) + 1);
    const key = `${category}::${genre}`;
    const prev = movieCategoryGenre.get(key) || { category, genre, count: 0 };
    prev.count += 1;
    movieCategoryGenre.set(key, prev);
  }

  for (const row of Array.isArray(series) ? series : []) {
    const genre = String(row?.genre || 'Uncategorized').trim() || 'Uncategorized';
    seriesGenre.set(genre, (seriesGenre.get(genre) || 0) + 1);
  }

  return {
    moviesByCategory: [...movieCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.category || '').localeCompare(String(b.category || ''))),
    moviesByCategoryGenre: [...movieCategoryGenre.values()].sort(
      (a, b) =>
        Number(b?.count || 0) - Number(a?.count || 0) ||
        String(a?.category || '').localeCompare(String(b?.category || '')) ||
        String(a?.genre || '').localeCompare(String(b?.genre || ''))
    ),
    seriesByGenre: [...seriesGenre.entries()]
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.genre || '').localeCompare(String(b.genre || ''))),
  };
}

function toCountLine(name, count) {
  return `- ${String(name || 'Uncategorized')}: ${Number(count || 0).toLocaleString()}`;
}

function buildCountReports({ mountDir, folderCounts, stats }) {
  const generatedAt = new Date().toISOString();
  const moviesByCategory = Array.isArray(folderCounts?.moviesByCategory) ? folderCounts.moviesByCategory : [];
  const moviesByCategoryGenre = Array.isArray(folderCounts?.moviesByCategoryGenre) ? folderCounts.moviesByCategoryGenre : [];
  const seriesByGenre = Array.isArray(folderCounts?.seriesByGenre) ? folderCounts.seriesByGenre : [];

  const movieLines = [
    '3J TV Folder Counts',
    `Generated: ${generatedAt}`,
    `Root: ${mountDir}/Movies`,
    `Total Movies: ${Number(stats?.movies || 0).toLocaleString()}`,
    '',
    'Category Totals',
    ...(moviesByCategory.length
      ? moviesByCategory.map((row) => toCountLine(row?.category || 'Uncategorized', row?.count || 0))
      : ['- (no movie folders found)']),
    '',
    'Category / Genre Totals',
    ...(moviesByCategoryGenre.length
      ? moviesByCategoryGenre.map((row) =>
          toCountLine(`${row?.category || 'Uncategorized'} / ${row?.genre || 'Uncategorized'}`, row?.count || 0)
        )
      : ['- (no movie genre folders found)']),
    '',
  ];

  const seriesLines = [
    '3J TV Folder Counts',
    `Generated: ${generatedAt}`,
    `Root: ${mountDir}/Series`,
    `Total Series: ${Number(stats?.series || 0).toLocaleString()}`,
    '',
    'Genre Totals',
    ...(seriesByGenre.length
      ? seriesByGenre.map((row) => toCountLine(row?.genre || 'Uncategorized', row?.count || 0))
      : ['- (no series genre folders found)']),
    '',
  ];

  return {
    generatedAt,
    moviesReport: movieLines.join('\n'),
    seriesReport: seriesLines.join('\n'),
  };
}

async function writeCountReportFile({ ssh, targetPath, content }) {
  const payload = Buffer.from(String(content || ''), 'utf8').toString('base64');
  const script = [
    'set -euo pipefail',
    `TARGET=${shQuote(targetPath)}`,
    `PAYLOAD=${shQuote(payload)}`,
    'DIR="$(dirname "$TARGET")"',
    'mkdir -p "$DIR"',
    'TMP="$TARGET.tmp.$$"',
    'if command -v base64 >/dev/null 2>&1; then',
    '  printf "%s" "$PAYLOAD" | base64 -d > "$TMP"',
    'elif command -v python3 >/dev/null 2>&1; then',
    '  export TMP PAYLOAD',
    '  python3 - <<PY',
    'import base64, os',
    'payload = os.environ.get("PAYLOAD", "")',
    'with open(os.environ["TMP"], "wb") as f:',
    '  f.write(base64.b64decode(payload.encode("utf-8")))',
    'PY',
    'else',
    '  echo "base64 decoder is required" >&2',
    '  exit 2',
    'fi',
    'chmod 664 "$TMP" >/dev/null 2>&1 || true',
    'mv -f "$TMP" "$TARGET"',
  ].join('\n');
  const r = await ssh.exec(script, { timeoutMs: 45000, sudo: true });
  if (Number(r?.code || 0) !== 0) {
    throw new Error(String(r?.stderr || r?.stdout || 'Failed to write count report').trim() || 'Failed to write count report');
  }
}

export async function getLibraryInventorySnapshot() {
  const db = await getAdminDb();
  return normalizeInventory(db.libraryInventory);
}

export async function syncLibraryInventory() {
  const engineHost = await getEngineHost();
  if (!engineHost?.host) throw new Error('No Engine Host configured.');
  const mount = await getMountSettings();
  const mountDir = String(mount?.mountDir || '').trim();
  if (!mountDir) throw new Error('Storage & Mount is not configured.');

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 15000 });
    const moviesRoot = `${mountDir.replace(/\/+$/, '')}/Movies`;
    const seriesRoot = `${mountDir.replace(/\/+$/, '')}/Series`;

    const [movieFiles, seriesDirs] = await Promise.all([
      listPaths(ssh, moviesRoot, 3, 5, 'f'),
      listPaths(ssh, seriesRoot, 2, 2, 'd'),
    ]);

    const movies = buildMovieInventory(movieFiles, moviesRoot);
    const series = buildSeriesInventory(seriesDirs, seriesRoot);
    const folderCounts = buildFolderCounts({ movies, series });
    const stats = {
      movies: movies.length,
      series: series.length,
      total: movies.length + series.length,
    };

    const reports = buildCountReports({ mountDir: mountDir.replace(/\/+$/, ''), folderCounts, stats });
    const moviesReportPath = `${moviesRoot}/_folder_counts.txt`;
    const seriesReportPath = `${seriesRoot}/_folder_counts.txt`;
    const countReports = {
      updatedAt: now(),
      moviesPath: moviesReportPath,
      seriesPath: seriesReportPath,
      ok: true,
      error: '',
    };
    try {
      await writeCountReportFile({ ssh, targetPath: moviesReportPath, content: reports.moviesReport });
      await writeCountReportFile({ ssh, targetPath: seriesReportPath, content: reports.seriesReport });
    } catch (e) {
      countReports.ok = false;
      countReports.error = e?.message || 'Failed to write NAS folder-count reports.';
    }

    const db = await getAdminDb();
    db.libraryInventory = {
      updatedAt: now(),
      mountDir,
      source: 'mount_scan',
      movies,
      series,
      folderCounts,
      countReports,
      stats,
      lastError: countReports.ok ? '' : countReports.error,
    };
    await saveAdminDb(db);
    return normalizeInventory(db.libraryInventory);
  } finally {
    await ssh.close();
  }
}

export async function getOrRefreshLibraryInventory({ maxAgeMs = DEFAULT_MAX_AGE_MS, force = false } = {}) {
  const current = await getLibraryInventorySnapshot();
  const ageMs = current.updatedAt ? Math.max(0, now() - Number(current.updatedAt || 0)) : null;
  const fresh = ageMs !== null && ageMs <= Math.max(0, Number(maxAgeMs || 0));

  if (!force && fresh) {
    return {
      ok: true,
      refreshed: false,
      stale: false,
      ageMs,
      inventory: current,
    };
  }

  try {
    const inventory = await syncLibraryInventory();
    return {
      ok: true,
      refreshed: true,
      stale: false,
      ageMs: 0,
      inventory,
    };
  } catch (e) {
    const msg = e?.message || 'Library inventory scan failed.';
    const db = await getAdminDb();
    const prev = normalizeInventory(db.libraryInventory);
    db.libraryInventory = { ...prev, lastError: msg };
    await saveAdminDb(db);
    return {
      ok: false,
      refreshed: false,
      stale: true,
      ageMs,
      error: msg,
      inventory: normalizeInventory(db.libraryInventory),
    };
  }
}

export function hasInventoryMatch({ inventory, type = 'movie', title, year = null } = {}) {
  const t = String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
  const keyExact = makeLibraryInventoryKey(title, year);
  const keyNoYear = makeLibraryInventoryKey(title, null);
  const rows = Array.isArray(inventory?.[t === 'series' ? 'series' : 'movies']) ? inventory[t === 'series' ? 'series' : 'movies'] : [];
  if (!rows.length) return false;
  for (const row of rows) {
    const rk = String(row?.key || '').trim();
    if (!rk) continue;
    if (rk === keyExact) return true;
    if (keyNoYear.endsWith('::') && rk.startsWith(keyNoYear)) return true;
  }
  return false;
}
