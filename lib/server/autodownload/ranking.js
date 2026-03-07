import 'server-only';

const QUALITY_SCORES = {
  '2160p': 40,
  '4k': 40,
  '1080p': 30,
  '720p': 20,
  '480p': 10,
};

function normalizeQuality(q) {
  return String(q || '').trim().toLowerCase();
}

function qualityScore(q) {
  const norm = normalizeQuality(q);
  for (const [k, v] of Object.entries(QUALITY_SCORES)) {
    if (norm.includes(k)) return v;
  }
  return 0;
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function scoreSource(src) {
  const seeders = Math.max(0, toNumber(src?.seeders, 0));
  const sizeGb = Math.max(0, toNumber(src?.sizeGb, 0));
  const qScore = qualityScore(src?.quality);

  // Keep scoring simple and explainable: quality first, then seeders, then size signal.
  return qScore * 100000 + seeders * 100 + Math.min(200, sizeGb * 10);
}

export function rankSources(results) {
  const list = Array.isArray(results) ? [...results] : [];
  list.sort((a, b) => {
    const sa = scoreSource(a);
    const sb = scoreSource(b);
    if (sb !== sa) return sb - sa;
    const aa = String(a?.name || '').toLowerCase();
    const bb = String(b?.name || '').toLowerCase();
    return aa.localeCompare(bb);
  });
  return list;
}

export function dedupeSourcesByHash(results) {
  const list = Array.isArray(results) ? results : [];
  const out = [];
  const seen = new Set();

  for (const item of list) {
    const hash = String(item?.hash || '').trim().toLowerCase();
    const magnet = String(item?.magnet || '').trim();
    const key = hash || magnet;
    if (!key) {
      out.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}
