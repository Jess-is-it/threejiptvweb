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

  const src =
    path?.startsWith('http')
      ? path
      : path
      ? `https://image.tmdb.org/t/p/original${path.startsWith('/') ? path : `/${path}`}`
      : '';

  return (
    <div className="absolute inset-0">
      {src ? (
        <img
          src={src}
          alt={alt}
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
