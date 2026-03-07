'use client';

import { useEffect, useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const THEME_KEY = '3jtv_theme';

function applyTheme(theme) {
  try {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  } catch {}
}

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState('dark'); // 'dark' | 'light'

  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === 'light' || t === 'dark') {
        setTheme(t);
        applyTheme(t);
      } else {
        applyTheme('dark');
      }
    } catch {
      applyTheme('dark');
    }
  }, []);

  const next = useMemo(() => (theme === 'light' ? 'dark' : 'light'), [theme]);

  const toggle = () => {
    const t = next;
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  };

  const isLight = theme === 'light';
  const Icon = isLight ? Moon : Sun;
  const label = isLight ? 'Dark mode' : 'Light mode';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={
        'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition hover:bg-black/5 ' +
        'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text)] ' +
        className
      }
    >
      <Icon size={16} />
      <span className="hidden sm:inline">{isLight ? 'Dark' : 'Light'}</span>
    </button>
  );
}

