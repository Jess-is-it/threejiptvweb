// lib/tmdb.js
export function chooseBestBackdropUrlPathOnly(path) {
  // helper: ensure we only pass TMDb *paths* like "/abc.jpg"
  if (!path) return null;
  return path.startsWith('/') ? path : null;
}

export async function chooseBestBackdrop(_streamBaseIgnored, item = {}) {
  // Always resolve via our API route (keeps API key server-side)
  const title = item?.title || '';
  const year = item?.year ? String(item.year) : '';
  const kind = (item?.kind || '').toLowerCase() === 'series' ? 'series' : 'movie';

  const q = new URLSearchParams({ title, year, kind }).toString();
  const r = await fetch(`/api/tmdb/resolve-backdrop?${q}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!j?.ok) return null;

  // Return TMDb path (e.g., "/xYz.jpg"); caller will convert to full URL
  return chooseBestBackdropUrlPathOnly(j.path);
}
