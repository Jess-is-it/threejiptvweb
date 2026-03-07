// app/login/page.jsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '../../components/SessionProvider';
import { usePublicSettings } from '../../components/PublicSettingsProvider';

export default function LoginPage() {
  const { session, ready, login } = useSession();
  const { settings } = usePublicSettings();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (session?.user) router.replace('/');
  }, [ready, session, router]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const brandColor = settings?.brand?.color || '#FA5252';
  const logoUrl = settings?.brand?.logoUrl || '/brand/logo.svg';
  const bgDesktop = settings?.login?.backgroundDesktopUrl || '/auth/login-bg.jpg';
  const bgMobile = settings?.login?.backgroundMobileUrl || '/auth/login-bg-mobile.jpg';
  const helpUrl = settings?.login?.helpLinkUrl || 'https://www.facebook.com/threejfiberwifi';
  const helpText = settings?.login?.helpLinkText || 'FB Page';

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { ok, error } = await login({ username, password, remember });
      if (!ok) throw new Error(error || 'Login failed.');
      router.replace('/');
    } catch (e) {
      setErr(e.message || 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-dvh">
      <img src={bgDesktop} alt="" className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover md:block" />
      <img src={bgMobile} alt="" className="pointer-events-none absolute inset-0 block h-full w-full object-cover md:hidden" />
      <div className="absolute inset-0 bg-black/70" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-7xl flex-col items-center justify-center px-4">
        <img
          src={logoUrl}
          onError={(e) => (e.currentTarget.src = '/brand/logo.png')}
          alt="3J TV"
          className="mb-6 h-16"
        />

        <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950/85 p-6 shadow-2xl backdrop-blur">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-neutral-400">
            Use your <span className="font-medium text-white">3J TV</span> account.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm text-neutral-300">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-2 ring-transparent focus:border-neutral-700 focus:ring-[--ring]"
                placeholder="Enter username"
                style={{ ['--ring']: `${brandColor}33` }}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm text-neutral-300">Password</label>
              <div className="relative">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 pr-10 text-neutral-100 outline-none ring-2 ring-transparent focus:border-neutral-700 focus:ring-[--ring]"
                  placeholder="Enter password"
                  style={{ ['--ring']: `${brandColor}33` }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 px-3 text-sm text-neutral-300 hover:text-white"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <label className="flex select-none items-center gap-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4"
                style={{ accentColor: brandColor }}
              />
              Remember me
            </label>

            {err ? (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg px-4 py-4 font-medium text-white transition disabled:opacity-60"
              style={{ backgroundColor: brandColor }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-neutral-400">
            If you don&apos;t have an account, or you forgot your password, message us on our{' '}
            <Link
              href={helpUrl}
              target="_blank"
              className="font-medium underline"
              style={{ color: brandColor }}
            >
              {helpText}
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
