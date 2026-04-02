const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
export const POSTER_FALLBACK_SRC = '/placeholders/poster-fallback.jpg';

function asText(value = '') {
  return String(value || '').trim();
}

function isRelativeAppUrl(value = '') {
  return asText(value).startsWith('/');
}

function isPlaceholderPoster(value = '') {
  return asText(value) === POSTER_FALLBACK_SRC;
}

function resizeTmdbPosterUrl(value = '', size = 'w342') {
  const raw = asText(value);
  if (!raw) return '';
  return raw.replace(/(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)\//i, `$1${size}/`);
}

export function getCardPosterSrc(item = {}) {
  const posterPath = asText(item?.posterPath);
  if (posterPath) return `${TMDB_IMAGE_BASE}/${'w342'}${posterPath}`;

  const image = asText(item?.image);
  const imageFallback = asText(item?.imageFallback);

  if (/^https:\/\/image\.tmdb\.org\/t\/p\//i.test(image)) {
    return resizeTmdbPosterUrl(image, 'w342') || image;
  }
  if (image && !isPlaceholderPoster(image)) return image;
  if (imageFallback && !isPlaceholderPoster(imageFallback)) return imageFallback;
  if (isRelativeAppUrl(image)) return image;
  if (isRelativeAppUrl(imageFallback)) return imageFallback;
  return image || imageFallback || POSTER_FALLBACK_SRC;
}

export function getCardPosterFallbackSrc(item = {}) {
  const imageFallback = asText(item?.imageFallback);
  const image = asText(item?.image);

  if (imageFallback && imageFallback !== image) return imageFallback;
  if (image && !isPlaceholderPoster(image)) return image;
  return imageFallback || POSTER_FALLBACK_SRC;
}
