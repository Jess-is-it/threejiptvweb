// components/TmdbBackdrop.jsx
'use client';

import { useMemo, useState } from 'react';
import { getOptimizedArtworkSrc, isKnownLocalAssetPath, normalizeTmdbImage } from '../lib/catalogImage';

/**
 * Lightweight backdrop renderer.
 * Accepts either a full URL (http…) or a TMDB path (/xyz.jpg).
 * Uses object-cover and a subtle zoom to keep faces framed.
 */
export default function TmdbBackdrop({ path, alt = '', preferContain = false }) {
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

  return (
    <div className="absolute inset-0 overflow-hidden">
      {src ? (
        <>
          {preferContain ? (
            <img
              src={src}
              alt=""
              aria-hidden="true"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className={`absolute inset-0 h-full w-full scale-110 object-cover blur-2xl transition-opacity duration-300 ${
                loaded ? 'opacity-45' : 'opacity-0'
              }`}
              style={{ objectPosition: '50% 18%' }}
              draggable={false}
            />
          ) : null}

          <img
            src={src}
            alt={alt}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`absolute inset-0 h-full w-full transition-opacity duration-300 ${
              loaded ? 'opacity-100' : 'opacity-0'
            } ${preferContain ? 'object-contain' : 'object-cover'}`}
            style={{ objectPosition: preferContain ? '50% 10%' : '50% 22%' }}
            draggable={false}
          />
        </>
      ) : (
        <div className="h-full w-full bg-neutral-900" />
      )}
    </div>
  );
}
