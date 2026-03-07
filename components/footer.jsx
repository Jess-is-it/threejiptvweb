// components/Footer.jsx
'use client';

import { usePathname } from 'next/navigation';

export default function Footer() {
  const pathname = usePathname() || '/';
  if (pathname === '/login') return null; // hide on login page

  return (
    <footer className="border-t border-neutral-900 py-6 text-center text-sm text-neutral-400">
      © 2025 3J TV. All rights reserved.
    </footer>
  );
}
