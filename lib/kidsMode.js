function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function isKidsCategoryName(value) {
  const s = normalizeText(value);
  if (!s) return false;
  // Catalog categories vary by provider; keep this reasonably strict but useful.
  return (
    s === 'kids' ||
    s.includes(' kids') ||
    s.startsWith('kids ') ||
    s.includes('children') ||
    s.includes('childrens') ||
    s.includes('family') ||
    s.includes('animation') ||
    s.includes('cartoon') ||
    s.includes('toons') ||
    s.includes('disney') ||
    s.includes('pixar') ||
    s.includes('nick') // nickelodeon/nick jr
  );
}

export function isKidsLiveCategoryName(value) {
  // Live TV should be strict: only show the official KIDS category when kids mode is enabled.
  return normalizeText(value) === 'kids';
}

export function filterKidsCatalogItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((item) => {
    return isKidsCategoryName(item?.genre) || isKidsCategoryName(item?.categoryName) || isKidsCategoryName(item?.category);
  });
}

export function filterKidsUpcomingItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((item) => {
    const genres = Array.isArray(item?.genres) ? item.genres : [];
    const names = genres.map((g) => normalizeText(g?.name || g)).filter(Boolean);
    // TMDB genre naming convention: Family/Animation are the most reliable "kids-safe" signals.
    return names.includes('family') || names.includes('animation') || names.includes('kids') || names.includes('children');
  });
}

export function pickKidsCategoryIds(categories) {
  const list = Array.isArray(categories) ? categories : [];
  const ids = list
    .filter((c) => isKidsLiveCategoryName(c?.name))
    .map((c) => String(c?.id || '').trim())
    .filter(Boolean);
  return new Set(ids);
}
