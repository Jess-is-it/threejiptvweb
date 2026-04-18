import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import Busboy from 'busboy';
import { NextResponse } from 'next/server';

import { requireAdminFromRequest } from '../../../../lib/server/adminApiAuth';
import { deleteMediaLibraryItems, listMediaLibrary, listMediaLibraryLogs } from '../../../../lib/server/autodownload/mediaLibraryService';
import {
  checkManualUploadDuplicateItems,
  createManualUpload,
  deleteManualUploads,
  getManualUploadPreflight,
  listManualUploads,
  manualReleaseNow,
  saveManualUploadFolderSettings,
  updateManualReleaseDate,
} from '../../../../lib/server/autodownload/manualUploadService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MANUAL_UPLOAD_TMP_PREFIX = '3j-tv-manual-upload-';
let manualUploadTempCleanupLastRun = 0;

function sanitizeUploadFileName(name = '', fallback = 'upload.bin') {
  const base = path.basename(String(name || '').trim()) || fallback;
  const cleaned = base.replace(/[^\w.\-() ]+/g, '_').trim();
  return cleaned || fallback;
}

async function cleanupStaleManualUploadTemps({ maxAgeMs = 6 * 60 * 60 * 1000, throttleMs = 10 * 60 * 1000 } = {}) {
  const ts = Date.now();
  if (ts - manualUploadTempCleanupLastRun < throttleMs) return;
  manualUploadTempCleanupLastRun = ts;

  const tmpDir = os.tmpdir();
  const entries = await fsp.readdir(tmpDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(MANUAL_UPLOAD_TMP_PREFIX))
      .map(async (entry) => {
        const fullPath = path.join(tmpDir, entry.name);
        const stat = await fsp.stat(fullPath).catch(() => null);
        const mtime = Number(stat?.mtimeMs || 0) || 0;
        if (!mtime || ts - mtime < maxAgeMs) return;
        await fsp.rm(fullPath, { recursive: true, force: true }).catch(() => null);
      })
  );
}

async function parseManualUploadMultipart(req) {
  const contentType = String(req.headers.get('content-type') || '');
  if (!contentType) throw new Error('Missing content type.');
  if (!req.body) throw new Error('Upload body is empty.');

  cleanupStaleManualUploadTemps().catch(() => null);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), MANUAL_UPLOAD_TMP_PREFIX));
  const fields = {};
  const legacyFilePaths = [];
  const indexedFilePaths = new Map();
  const legacyFileEntries = [];
  const indexedFileEntries = new Map();
  const fileJobs = [];
  let legacyFileIndex = 0;
  let physicalFileIndex = 0;

  const parseIndexedField = (name, base) => {
    const match = String(name || '').match(new RegExp(`^${base}(?:\\[(\\d+)\\])?$`));
    if (!match) return null;
    const index = match[1] === undefined ? null : Number(match[1]);
    return Number.isInteger(index) && index >= 0 ? { index } : { index: null };
  };

  const busboy = Busboy({
    headers: { 'content-type': contentType },
    limits: {
      fieldSize: 64 * 1024,
      fields: 2000,
      files: 2000,
      parts: 4000,
    },
  });

  const parserDone = new Promise((resolve, reject) => {
    busboy.on('field', (name, value) => {
      const filePathField = parseIndexedField(name, 'filePaths');
      if (filePathField) {
        const pathValue = String(value || '').trim();
        if (filePathField.index === null) legacyFilePaths.push(pathValue);
        else indexedFilePaths.set(filePathField.index, pathValue);
        return;
      }
      fields[name] = String(value || '');
    });

    busboy.on('file', (name, stream, info = {}) => {
      const fileField = parseIndexedField(name, 'files');
      if (!fileField) {
        stream.resume();
        return;
      }

      const logicalIndex = fileField.index;
      const legacyIndex = logicalIndex === null ? legacyFileIndex++ : null;
      const physicalIndex = physicalFileIndex++;
      const safeName = sanitizeUploadFileName(info?.filename, `upload-${physicalIndex}`);
      const tempPath = path.join(tempRoot, `${String(physicalIndex).padStart(6, '0')}-${safeName}`);
      let size = 0;

      const fileJob = new Promise((jobResolve, jobReject) => {
        const out = fs.createWriteStream(tempPath);
        stream.on('data', (chunk) => {
          size += chunk.length;
        });
        stream.on('error', jobReject);
        out.on('error', jobReject);
        out.on('finish', () => {
          const entry = {
            name: safeName,
            size,
            localPath: tempPath,
            uploadIndex: logicalIndex === null ? legacyIndex : logicalIndex,
            stream() {
              return Readable.toWeb(fs.createReadStream(tempPath));
            },
          };
          if (logicalIndex === null) legacyFileEntries[legacyIndex] = entry;
          else indexedFileEntries.set(logicalIndex, entry);
          jobResolve();
        });
        stream.pipe(out);
      });

      fileJobs.push(fileJob);
    });

    busboy.on('error', reject);
    busboy.on('fieldsLimit', () => reject(new Error('Too many upload fields.')));
    busboy.on('filesLimit', () => reject(new Error('Too many upload files.')));
    busboy.on('partsLimit', () => reject(new Error('Too many upload parts.')));
    busboy.on('close', async () => {
      try {
        await Promise.all(fileJobs);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  try {
    const bodyStream = Readable.fromWeb(req.body);
    bodyStream.on('error', (error) => {
      busboy.destroy(error);
    });
    bodyStream.pipe(busboy);
    await parserDone;

    const indexedKeys = Array.from(indexedFileEntries.keys()).sort((a, b) => a - b);
    const indexedFiles = [];
    const indexedPaths = [];
    for (const index of indexedKeys) {
      const entry = indexedFileEntries.get(index);
      if (!entry) continue;
      indexedFiles.push(entry);
      indexedPaths.push(indexedFilePaths.get(index) || entry.name || '');
    }

    return {
      fields,
      filePaths: [...indexedPaths, ...legacyFilePaths],
      files: [...indexedFiles, ...legacyFileEntries.filter(Boolean)],
      async cleanup() {
        await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
      },
    };
  } catch (error) {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export async function GET(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const view = String(searchParams.get('view') || '').trim().toLowerCase();
    if (view === 'logs') {
      const out = await listMediaLibraryLogs({
        type: searchParams.get('type') || 'movie',
        limit: searchParams.get('limit') || 100,
      });
      return NextResponse.json(out, { status: 200 });
    }
    if (view === 'manual') {
      const out = await listManualUploads({
        type: searchParams.get('type') || 'movie',
        q: searchParams.get('q') || '',
        result: searchParams.get('result') || 'all',
        status: searchParams.get('status') || '',
        releaseState: searchParams.get('releaseState') || '',
        sort: searchParams.get('sort') || 'uploaded_desc',
        page: searchParams.get('page') || 1,
        pageSize: searchParams.get('pageSize') || 25,
        limit: searchParams.get('limit') || 5000,
      });
      return NextResponse.json(out, { status: 200 });
    }
    if (view === 'preflight') {
      const out = await getManualUploadPreflight({
        type: searchParams.get('type') || 'movie',
      });
      return NextResponse.json(out, { status: 200 });
    }
    const out = await listMediaLibrary({
      type: searchParams.get('type') || 'movie',
      q: searchParams.get('q') || '',
      presence: searchParams.get('presence') || 'all',
      category: searchParams.get('category') || '',
      genre: searchParams.get('genre') || '',
      sort: searchParams.get('sort') || 'title_asc',
      page: searchParams.get('page') || 1,
      pageSize: searchParams.get('pageSize') || 25,
      refresh: isTruthy(searchParams.get('refresh')),
    });
    return NextResponse.json(out, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to load media library.' }, { status: 400 });
  }
}

export async function POST(req) {
  const admin = await requireAdminFromRequest(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const contentType = String(req.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      const parsed = await parseManualUploadMultipart(req);
      try {
        const action = String(parsed.fields?.action || '').trim().toLowerCase();
        if (action !== 'manual_upload') {
          return NextResponse.json({ ok: false, error: 'Unsupported form action.' }, { status: 400 });
        }
        const type = String(parsed.fields?.type || 'movie').trim();
        const title = String(parsed.fields?.title || '').trim();
        const year = String(parsed.fields?.year || '').trim();
        const tmdbId = String(parsed.fields?.tmdbId || '').trim();
        const tmdbMediaType = String(parsed.fields?.tmdbMediaType || '').trim();
        const releaseDate = String(parsed.fields?.releaseDate || '').trim();
        const processNow = String(parsed.fields?.processNow || '1').trim();
        const releaseNow = String(parsed.fields?.releaseNow || '0').trim();
        const out = await createManualUpload({
          type,
          title,
          year,
          tmdbId,
          tmdbMediaType,
          releaseDate,
          processNow: isTruthy(processNow),
          releaseNow: isTruthy(releaseNow),
          files: parsed.files,
          filePaths: parsed.filePaths,
          actor: admin?.username || admin?.email || 'admin',
        });
        return NextResponse.json(out, { status: 200 });
      } finally {
        await parsed.cleanup();
      }
    }

    let body = {};
    try {
      body = await req.json();
    } catch {}

    const action = String(body?.action || '').trim().toLowerCase();
    if (action === 'delete') {
      const out = await deleteMediaLibraryItems({
        type: body?.type || 'movie',
        ids: Array.isArray(body?.ids) ? body.ids : [],
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_update_release_date') {
      const out = await updateManualReleaseDate({
        type: body?.type || 'movie',
        id: body?.id || '',
        releaseDate: body?.releaseDate || '',
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_release_now') {
      const out = await manualReleaseNow({
        type: body?.type || 'movie',
        id: body?.id || '',
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_delete') {
      const out = await deleteManualUploads({
        type: body?.type || 'movie',
        ids: Array.isArray(body?.ids) ? body.ids : [body?.id || ''],
        actor: admin?.username || admin?.email || 'admin',
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_upload_duplicate_check') {
      const out = await checkManualUploadDuplicateItems({
        items: Array.isArray(body?.items) ? body.items : [],
      });
      return NextResponse.json(out, { status: 200 });
    }

    if (action === 'manual_upload_folders_save') {
      const out = await saveManualUploadFolderSettings({
        rootName: body?.rootName,
        moviesProcessing: body?.moviesProcessing,
        moviesCleaned: body?.moviesCleaned,
        seriesProcessing: body?.seriesProcessing,
        seriesCleaned: body?.seriesCleaned,
      });
      return NextResponse.json(out, { status: 200 });
    }

    return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Request failed.' }, { status: 400 });
  }
}
