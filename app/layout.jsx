// app/layout.jsx
import '../styles/globals.css';              // tailwind + resets
import PublicSettingsProvider from '../components/PublicSettingsProvider';
import UserPreferencesProvider from '../components/UserPreferencesProvider';
import SessionProvider from '../components/SessionProvider';
import ClientShell from './shell';          // client wrapper that shows/hides header/footer

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'THRE3J TV',
  description: '3J TV streaming UI',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <PublicSettingsProvider>
          <UserPreferencesProvider>
            <SessionProvider>
              <ClientShell>{children}</ClientShell>
            </SessionProvider>
          </UserPreferencesProvider>
        </PublicSettingsProvider>
      </body>
    </html>
  );
}
