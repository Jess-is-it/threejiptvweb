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
