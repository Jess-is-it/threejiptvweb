// lib/utils.js

// ---- SSR-safe localStorage helpers ----------------------------------------
function canUseLS() {
  try {
    if (typeof window === 'undefined') return false;
    const k = '__ls_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function readLS(key, fallback) {
  if (!canUseLS()) return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  if (!canUseLS()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ---- CONTINUE WATCHING -----------------------------------------------------
const LS_CONTINUE = '3jtv_continue_v1';

/**
 * Save progress for a movie or episode.
 * @param {{ id:string|number, type:'movie'|'series', title?:string, image?:string, sid?:string|number, ts?:number }} entry
 */
export function saveContinue(entry = {}) {
  const now = Date.now();
  const rec = {
    id: String(entry.id ?? ''),
    type: entry.type === 'series' ? 'series' : 'movie',
    title: entry.title || '',
    image: entry.image || '',
    sid: entry.sid ? String(entry.sid) : undefined, // series id when episode progress
    ts: entry.ts || now,
  };
  if (!rec.id) return;

  const list = readLS(LS_CONTINUE, []);
  const idx = list.findIndex((x) => x.id == rec.id && x.type === rec.type && (x.sid || '') === (rec.sid || ''));
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(rec);
  // keep last 50
  writeLS(LS_CONTINUE, list.slice(0, 50));
}

/** Get continue-watching list (newest first). */
export function getContinueList() {
  const list = readLS(LS_CONTINUE, []);
  return Array.isArray(list)
    ? list
        .slice()
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .map((x) => ({
          id: x.id,
          type: x.type,
          title: x.title || '',
          image: x.image || '',
          sid: x.sid,
        }))
    : [];
}

export function clearContinue() {
  writeLS(LS_CONTINUE, []);
}

// ---- WATCHLIST -------------------------------------------------------------
const LS_WATCHLIST = '3jtv_watchlist_v1';

function emitWatchlistChanged(items = []) {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('3jtv:watchlist-changed', { detail: { items } }));
  } catch {}
}

function normalizeWatchlistEntry(item = {}, { fresh = false } = {}) {
  const id = String(item.id ?? '').trim();
  if (!id) return null;
  const type = item.type === 'series' ? 'series' : 'movie';
  const href = String(item.href || '').trim() || (type === 'series' ? `/series/${id}` : `/movies/${id}`);

  return {
    id,
    type,
    title: String(item.title || '').trim(),
    image: item.image || '',
    imageFallback: item.imageFallback || '',
    posterPath: item.posterPath || '',
    backdrop: item.backdrop || '',
    plot: item.plot || item.overview || '',
    year: item.year || '',
    rating: item.rating || '',
    duration: item.duration || '',
    genre: item.genre || '',
    tmdbId: item.tmdbId || '',
    ext: item.ext || '',
    href,
    added: Number(item.added || 0) || (fresh ? Date.now() : 0),
  };
}

/** Return array of watchlist items. */
export function getWatchlist() {
  const list = readLS(LS_WATCHLIST, []);
  return Array.isArray(list) ? list.map((item) => normalizeWatchlistEntry(item)).filter(Boolean) : [];
}

/**
 * Add an item to the watchlist.
 * @param {{ id:string|number, type:'movie'|'series', title?:string, image?:string, href?:string, year?:string|number, rating?:string|number, duration?:string, genre?:string, plot?:string, ext?:string }} item
 */
export function addToWatchlist(item = {}) {
  const rec = normalizeWatchlistEntry(item, { fresh: true });
  if (!rec) return null;

  const list = getWatchlist();
  const key = (x) => `${x.type}:${x.id}`;
  const idx = list.findIndex((x) => key(x) === key(rec));
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(rec);
  // keep last 200
  const next = list.slice(0, 200);
  writeLS(LS_WATCHLIST, next);
  emitWatchlistChanged(next);
  return rec;
}

/** Remove an item from the watchlist. */
export function removeFromWatchlist(id, type = 'movie') {
  const list = getWatchlist().filter((x) => !(String(x.id) === String(id) && x.type === type));
  writeLS(LS_WATCHLIST, list);
  emitWatchlistChanged(list);
  return list;
}

/** Clear all saved watchlist entries. */
export function clearWatchlist() {
  writeLS(LS_WATCHLIST, []);
  emitWatchlistChanged([]);
}

/** Check if an item is in the watchlist. */
export function isInWatchlist(id, type = 'movie') {
  return getWatchlist().some((x) => String(x.id) === String(id) && x.type === type);
}
