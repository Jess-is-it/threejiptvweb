// components/Protected.jsx
'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from './SessionProvider';

export default function Protected({ children }) {
  const { ready, session } = useSession();
  const router = useRouter();

  const status = useMemo(() => {
    if (!ready) return 'loading';
    return session?.user ? 'authenticated' : 'unauthenticated';
  }, [ready, session?.user]);

  // As soon as we know it's not authenticated, go to /login
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24 text-neutral-300">
        Checking session…
      </div>
    );
  }

  if (status === 'unauthenticated') return null; // wait for redirect
  return children;
}
