// components/TmdbBackdrop.jsx
'use client';

import { useState } from 'react';

/**
 * Lightweight backdrop renderer.
 * Accepts either a full URL (http…) or a TMDB path (/xyz.jpg).
 * Uses object-cover and a subtle zoom to keep faces framed.
 */
export default function TmdbBackdrop({ path, alt = '' }) {
  const [loaded, setLoaded] = useState(false);

  const raw = String(path || '').trim();
  const src =
    raw.startsWith('http')
      ? raw
      : raw.startsWith('/api/') ||
        raw.startsWith('/placeholders/') ||
        raw.startsWith('/images/') ||
        raw.startsWith('/brand/')
      ? raw
      : raw
      ? `https://image.tmdb.org/t/p/original${raw.startsWith('/') ? raw : `/${raw}`}`
      : '';

  return (
    <div className="absolute inset-0">
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
          // default focal point a bit higher than center to keep heads visible
          style={{ objectPosition: '50% 35%' }}
          draggable={false}
        />
      ) : (
        <div className="h-full w-full bg-neutral-900" />
      )}
    </div>
  );
}
