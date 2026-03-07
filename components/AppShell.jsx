'use client';
import { usePathname } from 'next/navigation';
import Header from './Header';
import Footer from './Footer';

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isAuth = pathname.startsWith('/login'); // hide chrome on Sign-in

  return (
    <>
      {!isAuth && <Header />}
      {/* full-bleed page content, keep small side padding */}
      <main className={isAuth ? '' : 'px-4 sm:px-6'}>{children}</main>
      {!isAuth && <Footer />}
    </>
  );
}
