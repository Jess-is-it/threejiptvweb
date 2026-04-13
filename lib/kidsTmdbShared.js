export function normalizeKidsMediaType(mediaType = 'movie') {
  return String(mediaType || '').trim().toLowerCase() === 'tv' ? 'tv' : 'movie';
}

export function normalizeKidsYear(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{4})/);
  return match ? match[1] : '';
}

export function normalizeKidsTitle(value) {
  return String(value || '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s*\[[^\]]+\]\s*$/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019'":,!?()[\].\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTmdbId(value) {
  const id = Number(value || 0);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

export function getKidsSafetyCacheKey(item, { mediaType = 'movie' } = {}) {
  const mt = normalizeKidsMediaType(mediaType || item?.mediaType || item?.kind);
  const tmdbId = normalizeTmdbId(item?.tmdbId);
  if (tmdbId) return `id:${mt}:${tmdbId}`;

  const title = normalizeKidsTitle(item?.title);
  if (!title) return '';
  const year = normalizeKidsYear(item?.year);
  return `q:${mt}:${title}:${year}`;
}

export function readKidsSafetyValue(map, item, { mediaType = 'movie' } = {}) {
  const source = map && typeof map === 'object' ? map : {};
  const key = getKidsSafetyCacheKey(item, { mediaType });
  if (key && typeof source[key] === 'boolean') return source[key];

  const tmdbId = normalizeTmdbId(item?.tmdbId);
  if (tmdbId) {
    const mt = normalizeKidsMediaType(mediaType || item?.mediaType || item?.kind);
    const title = normalizeKidsTitle(item?.title);
    if (title) {
      const year = normalizeKidsYear(item?.year);
      const queryKey = `q:${mt}:${title}:${year}`;
      if (typeof source[queryKey] === 'boolean') return source[queryKey];
    }
  }
  if (tmdbId) {
    if (typeof source[tmdbId] === 'boolean') return source[tmdbId];
    if (typeof source[String(tmdbId)] === 'boolean') return source[String(tmdbId)];
  }
  return null;
}
