// components/useElementSize.js
'use client';
import { useEffect, useState } from 'react';

// Observe an element's current {width,height}. Works with SSR.
export default function useElementSize(ref) {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;

    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ width: Math.round(r.width), height: Math.round(r.height) });
    };

    update(); // initial
    const ro = new ResizeObserver(update);
    ro.observe(el);

    // update on orientation / DPR changes
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, [ref]);

  return box;
}
