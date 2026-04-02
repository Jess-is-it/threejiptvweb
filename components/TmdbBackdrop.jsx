// components/TmdbBackdrop.jsx
'use client';

import { useMemo, useState } from 'react';
import { getOptimizedArtworkSrc, isKnownLocalAssetPath, normalizeTmdbImage } from '../lib/catalogImage';

/**
 * Lightweight backdrop renderer.
 * Accepts either a full URL (http…) or a TMDB path (/xyz.jpg).
 * Always renders as wide backdrop artwork.
 */
export default function TmdbBackdrop({ path, placeholderPath = '', alt = '' }) {
  const [loaded, setLoaded] = useState(false);
  const src = useMemo(() => {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (isKnownLocalAssetPath(raw)) return raw;
    if (raw.startsWith('http')) {
      return getOptimizedArtworkSrc(normalizeTmdbImage(raw, 'w1280'), { kind: 'backdrop' }) || raw;
    }
    const tmdbSrc = normalizeTmdbImage(raw, 'w1280');
    return getOptimizedArtworkSrc(tmdbSrc, { kind: 'backdrop' }) || tmdbSrc;
  }, [path]);
  const placeholderSrc = useMemo(() => {
    const raw = String(placeholderPath || '').trim();
    if (!raw) return '';
    if (isKnownLocalAssetPath(raw)) return raw;
    if (raw.startsWith('http')) {
      return getOptimizedArtworkSrc(normalizeTmdbImage(raw, 'w780'), { kind: 'backdrop' }) || raw;
    }
    const tmdbSrc = normalizeTmdbImage(raw, 'w780');
    return getOptimizedArtworkSrc(tmdbSrc, { kind: 'backdrop' }) || tmdbSrc;
  }, [placeholderPath]);
  const showPlaceholder = Boolean(placeholderSrc && (!src || !loaded));

  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-900">
      {showPlaceholder ? (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-105 object-cover opacity-45 blur-xl"
          style={{ objectPosition: '50% 18%' }}
          draggable={false}
        />
      ) : null}
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ objectPosition: '50% 20%' }}
          draggable={false}
        />
      ) : null}
    </div>
  );
}
