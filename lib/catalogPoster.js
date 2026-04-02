import {
  getOptimizedArtworkSrc,
  normalizeTmdbImage,
} from './catalogImage';

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

function optimizePosterSource(value = '') {
  const normalized = normalizeTmdbImage(value, 'w500');
  return getOptimizedArtworkSrc(normalized, { kind: 'poster' });
}

export function getCardPosterSrc(item = {}) {
  const posterPath = asText(item?.posterPath);
  if (posterPath) {
    return optimizePosterSource(posterPath) || POSTER_FALLBACK_SRC;
  }

  const image = asText(item?.image);
  const imageFallback = asText(item?.imageFallback);

  if (image && !isPlaceholderPoster(image)) return optimizePosterSource(image) || image;
  if (imageFallback && !isPlaceholderPoster(imageFallback)) return optimizePosterSource(imageFallback) || imageFallback;
  if (isRelativeAppUrl(image)) return image;
  if (isRelativeAppUrl(imageFallback)) return imageFallback;
  return image || imageFallback || POSTER_FALLBACK_SRC;
}

export function getCardPosterFallbackSrc(item = {}) {
  const imageFallback = asText(item?.imageFallback);
  const image = asText(item?.image);

  if (imageFallback && imageFallback !== image) return optimizePosterSource(imageFallback) || imageFallback;
  if (image && !isPlaceholderPoster(image)) return optimizePosterSource(image) || image;
  return imageFallback || POSTER_FALLBACK_SRC;
}
