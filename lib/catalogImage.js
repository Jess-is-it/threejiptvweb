const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function asText(value = '') {
  return String(value || '').trim();
}

export function isKnownLocalAssetPath(value = '') {
  const raw = asText(value);
  return (
    raw.startsWith('/api/') ||
    raw.startsWith('/placeholders/') ||
    raw.startsWith('/images/') ||
    raw.startsWith('/brand/')
  );
}

export function isRemoteUrl(value = '') {
  return /^https?:\/\//i.test(asText(value));
}

export function isTmdbUrl(value = '') {
  return /^https:\/\/image\.tmdb\.org\/t\/p\//i.test(asText(value));
}

export function normalizeTmdbImage(value = '', size = 'w500') {
  const raw = asText(value);
  if (!raw) return '';
  if (isTmdbUrl(raw)) {
    return raw.replace(/(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)\//i, `$1${size}/`);
  }
  if (raw.startsWith('/') && !isKnownLocalAssetPath(raw)) {
    return `${TMDB_IMAGE_BASE}/${size}${raw.startsWith('/') ? raw : `/${raw}`}`;
  }
  return raw;
}

export function buildArtworkProxyUrl({ source = '', server = '', kind = 'image' } = {}) {
  const raw = asText(source);
  if (!raw) return '';
  if (isKnownLocalAssetPath(raw)) return raw;
  if (raw.startsWith('/api/xuione/image?')) return raw;

  const params = new URLSearchParams();
  params.set('src', raw);
  const origin = asText(server);
  if (origin) params.set('server', origin);
  if (kind) params.set('kind', kind);
  return `/api/xuione/image?${params.toString()}`;
}

export function getOptimizedArtworkSrc(source = '', { kind = 'image', tmdbSize = '' } = {}) {
  const raw = asText(source);
  if (!raw) return '';
  if (isKnownLocalAssetPath(raw) || raw.startsWith('/api/xuione/image?')) return raw;

  const nextSource = tmdbSize ? normalizeTmdbImage(raw, tmdbSize) : raw;
  if (!nextSource) return '';
  if (isKnownLocalAssetPath(nextSource) || nextSource.startsWith('/api/xuione/image?')) return nextSource;
  if (isRemoteUrl(nextSource) || /^\/\//.test(nextSource)) {
    return buildArtworkProxyUrl({ source: nextSource, kind });
  }
  return nextSource;
}
