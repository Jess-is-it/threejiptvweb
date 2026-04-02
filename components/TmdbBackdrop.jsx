// components/TmdbBackdrop.jsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { getOptimizedArtworkSrc, isKnownLocalAssetPath, normalizeTmdbImage } from '../lib/catalogImage';

/**
 * Lightweight backdrop renderer.
 * Accepts either a full URL (http…) or a TMDB path (/xyz.jpg).
 * Uses `object-cover` with a slightly top-biased focal point to keep faces framed.
 */
export default function TmdbBackdrop({ path, alt = '' }) {
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

  useEffect(() => {
    // When the slide changes, fade in the new image instead of keeping old `loaded` state.
    setLoaded(false);
  }, [src]);

  return (
    <div className="absolute inset-0">
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ objectPosition: '50% 35%' }}
          draggable={false}
        />
      ) : (
        <div className="h-full w-full bg-neutral-900" />
      )}
    </div>
  );
}
