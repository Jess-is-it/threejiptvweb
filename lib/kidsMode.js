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
  // Keep this strict to avoid false positives: category labels are usually explicit in XUI.
  return s === 'kids' || s.includes(' kids') || s.startsWith('kids ') || s.includes('children');
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
    .filter((c) => isKidsCategoryName(c?.name))
    .map((c) => String(c?.id || '').trim())
    .filter(Boolean);
  return new Set(ids);
}

