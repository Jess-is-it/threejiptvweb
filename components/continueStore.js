// components/continueStore.js
const KEY = '3jtv.continue';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(arr) {
  try {
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {}
}

export function getContinueList() {
  return readAll()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 30);
}

// item: { id, type, title, image, href, progress?, position?, duration? }
export function upsertContinue(item) {
  if (!item || !item.id) return;
  const list = readAll();
  const key = `${item.type || 'movie'}:${item.id}`;
  const idx = list.findIndex((x) => `${x.type}:${x.id}` === key);
  const updated = { ...(idx >= 0 ? list[idx] : {}), ...item, updatedAt: Date.now() };
  if (idx >= 0) list[idx] = updated;
  else list.unshift(updated);
  writeAll(list.slice(0, 30));
}

export function removeContinue(type, id) {
  const list = readAll().filter((x) => !(x.type === type && String(x.id) === String(id)));
  writeAll(list);
}
