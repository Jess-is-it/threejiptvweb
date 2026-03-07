import 'server-only';

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function applySourceFilters(results, opts = {}) {
  const list = Array.isArray(results) ? results : [];
  const minSeeders = Math.max(0, toNumber(opts.minSeeders, 0));
  const minSizeGb = opts.minSizeGb === null || opts.minSizeGb === undefined ? null : Math.max(0, toNumber(opts.minSizeGb, 0));
  const maxSizeGb = opts.maxSizeGb === null || opts.maxSizeGb === undefined ? null : Math.max(0, toNumber(opts.maxSizeGb, 0));

  const excludeRegexes = [];
  for (const raw of Array.isArray(opts.excludePatterns) ? opts.excludePatterns : []) {
    try {
      const s = String(raw || '').trim();
      if (!s) continue;
      excludeRegexes.push(new RegExp(s, 'i'));
    } catch {}
  }

  return list.filter((item) => {
    const seeders = Math.max(0, toNumber(item?.seeders, 0));
    if (seeders < minSeeders) return false;

    const rawSizeGb = item?.sizeGb;
    const sizeGb = rawSizeGb === null || rawSizeGb === undefined || String(rawSizeGb).trim() === '' ? NaN : Number(rawSizeGb);
    if ((minSizeGb !== null || maxSizeGb !== null) && !Number.isFinite(sizeGb)) return false;
    if (minSizeGb !== null && Number.isFinite(sizeGb) && sizeGb < minSizeGb) return false;
    if (maxSizeGb !== null && Number.isFinite(sizeGb) && sizeGb > maxSizeGb) return false;

    const name = String(item?.name || '');
    for (const rx of excludeRegexes) {
      if (rx.test(name)) return false;
    }

    return true;
  });
}
