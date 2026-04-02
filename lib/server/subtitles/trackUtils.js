import 'server-only';

function normalizeLanguageCode(value = '') {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (raw.includes('tagalog') || raw.includes('filipino')) return 'tl';
  if (raw.includes('english')) return 'en';
  if (raw === 'eng') return 'en';
  if (raw === 'fil') return 'tl';
  if (raw === 'tgl') return 'tl';
  return raw.slice(0, 2);
}

export function normalizeSubtitleTrack(track) {
  if (!track || typeof track !== 'object') return null;
  const url = String(track?.url || track?.path || '').trim();
  if (!url) return null;
  const label = String(track?.label || track?.lang || track?.language || 'Subtitle').trim() || 'Subtitle';
  const srclang = normalizeLanguageCode(track?.srclang || track?.lang || track?.language || '');
  return {
    ...track,
    lang: label,
    label,
    srclang,
    url,
  };
}

export function mergeSubtitleTrackLists(...groups) {
  const merged = [];
  const seen = new Set();

  for (const group of groups) {
    for (const track of Array.isArray(group) ? group : []) {
      const normalized = normalizeSubtitleTrack(track);
      if (!normalized) continue;
      const key = `${normalized.source || 'subtitle'}::${normalized.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(normalized);
    }
  }

  return merged;
}
