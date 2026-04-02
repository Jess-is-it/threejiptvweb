'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCardPosterFallbackSrc,
  getCardPosterSrc,
  POSTER_FALLBACK_SRC,
} from '../lib/catalogPoster';

const loadedPosterSrcs = globalThis.__threejLoadedPosterSrcs || new Set();
if (!globalThis.__threejLoadedPosterSrcs) {
  globalThis.__threejLoadedPosterSrcs = loadedPosterSrcs;
}

export default function CatalogPosterImage({
  item,
  alt = '',
  className = '',
  eager = false,
  defer = false,
}) {
  const primarySrc = useMemo(
    () => getCardPosterSrc(item),
    [item]
  );
  const fallbackSrc = useMemo(
    () => getCardPosterFallbackSrc(item),
    [item]
  );
  const imgRef = useRef(null);
  const [src, setSrc] = useState(defer ? '' : (primarySrc || POSTER_FALLBACK_SRC));
  const [loaded, setLoaded] = useState(() => {
    const initialSrc = defer ? '' : (primarySrc || POSTER_FALLBACK_SRC);
    return initialSrc ? loadedPosterSrcs.has(initialSrc) : false;
  });
  const fallbackStepRef = useRef(0);

  const fallbacks = useMemo(() => {
    const out = [];
    for (const candidate of [fallbackSrc, POSTER_FALLBACK_SRC]) {
      const normalized = String(candidate || '').trim();
      if (!normalized || normalized === primarySrc || out.includes(normalized)) continue;
      out.push(normalized);
    }
    return out;
  }, [fallbackSrc, primarySrc]);

  useEffect(() => {
    fallbackStepRef.current = 0;
    const nextSrc = defer ? '' : (primarySrc || POSTER_FALLBACK_SRC);
    setLoaded(nextSrc ? loadedPosterSrcs.has(nextSrc) : false);
    setSrc(nextSrc);
  }, [primarySrc, fallbackSrc, defer]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el || !src || loaded) return;
    if (el.complete && el.naturalWidth > 0) {
      loadedPosterSrcs.add(src);
      setLoaded(true);
    }
  }, [loaded, src]);

  return (
    <div className="relative h-full w-full">
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br from-neutral-800 via-neutral-700/40 to-neutral-800 transition-opacity duration-300 ${
          loaded ? 'opacity-0' : 'animate-pulse opacity-100'
        }`}
      />
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => {
            loadedPosterSrcs.add(src);
            setLoaded(true);
          }}
          onError={() => {
            const nextSrc = fallbacks[fallbackStepRef.current];
            if (!nextSrc || nextSrc === src) return;
            fallbackStepRef.current += 1;
            setLoaded(false);
            setSrc(nextSrc);
          }}
        />
      ) : null}
    </div>
  );
}
