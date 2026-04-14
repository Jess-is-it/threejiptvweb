import 'server-only';

function safeName(v, fallback) {
  const s = String(v || '').trim();
  if (!s) return fallback;
  return s;
}

export function getLibraryFolderConfig(settings) {
  const lf = settings?.libraryFolders || {};
  return {
    movies: {
      downloading: safeName(lf?.movies?.downloading, 'Downloading'),
      downloaded: safeName(lf?.movies?.downloaded, 'Downloaded and Processing'),
      processing: safeName(lf?.movies?.processing, 'Cleaned and Ready'),
    },
    series: {
      downloading: safeName(lf?.series?.downloading, 'Downloading'),
      downloaded: safeName(lf?.series?.downloaded, 'Downloaded and Processing'),
      processing: safeName(lf?.series?.processing, 'Cleaned and Ready'),
    },
  };
}

export function getManualUploadFolderConfig(settings) {
  const mu = settings?.manualUploadFolders || {};
  const rootName = safeName(mu?.rootName, 'Manual Upload');
  // "processing" here refers to the incoming folder name for manual uploads.
  // Cleaned output always lands under `Cleaned and Ready/<release_date>/...`.
  const movieProcessing = safeName(mu?.movies?.processing, 'Processing');
  const seriesProcessing = safeName(mu?.series?.processing, 'Processing');
  return {
    rootName,
    movies: { processing: movieProcessing },
    series: { processing: seriesProcessing },
  };
}

export function buildLibraryPaths({ mountDir, type, settings } = {}) {
  const baseRoot = String(mountDir || '').replace(/\/+$/, '');
  const t = String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
  const cfg = getLibraryFolderConfig(settings);
  const root = t === 'series' ? `${baseRoot}/Series` : `${baseRoot}/Movies`;
  const qBittorrentRoot = `${baseRoot}/qBittorrent`;
  const stageRoot = t === 'series' ? `${qBittorrentRoot}/Series` : `${qBittorrentRoot}/Movies`;
  const stage = t === 'series' ? cfg.series : cfg.movies;
  return {
    root,
    qBittorrentRoot,
    stageRoot,
    downloadingDir: `${stageRoot}/${stage.downloading}`,
    downloadedDir: `${stageRoot}/${stage.downloaded}`,
    processingDir: `${stageRoot}/${stage.processing}`,
  };
}

export function buildManualUploadPaths({ mountDir, type, settings } = {}) {
  const baseRoot = String(mountDir || '').replace(/\/+$/, '');
  const t = String(type || '').toLowerCase() === 'series' ? 'series' : 'movie';
  const cfg = getManualUploadFolderConfig(settings);
  const root = `${baseRoot}/${cfg.rootName}`;
  const typeRoot = t === 'series' ? `${root}/Series` : `${root}/Movies`;
  const processingName = t === 'series' ? cfg.series.processing : cfg.movies.processing;
  // Raw uploads land in a configurable "Processing" folder; cleaned output lands in `Cleaned and Ready/<release_date>/...`.
  const incomingDir = `${typeRoot}/${processingName}`;
  const cleanedFolderName = 'Cleaned and Ready';
  const processingDir = `${typeRoot}/${cleanedFolderName}`;
  return {
    root,
    typeRoot,
    incomingDir,
    processingDir,
    processingName, // incoming folder name
    cleanedFolderName,
    rootName: cfg.rootName,
  };
}
