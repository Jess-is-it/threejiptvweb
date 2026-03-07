'use client';

import { useEffect, useMemo, useState } from 'react';

function normalizeServers(text) {
  const lines = String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((u) => (u.endsWith('/') ? u : `${u}/`));
}

export default function AdminSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const [brandName, setBrandName] = useState('');
  const [brandColor, setBrandColor] = useState('#FA5252');
  const [logoUrl, setLogoUrl] = useState('');
  const [defaultMovieClick, setDefaultMovieClick] = useState('play'); // 'play' | 'preview'
  const [bgDesktop, setBgDesktop] = useState('');
  const [bgMobile, setBgMobile] = useState('');
  const [helpUrl, setHelpUrl] = useState('');
  const [helpText, setHelpText] = useState('');
  const [serversText, setServersText] = useState('');

  const load = async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/settings', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to load settings.');
      const s = j.settings || {};
      setBrandName(s?.brand?.name || '3J TV');
      setBrandColor(s?.brand?.color || '#FA5252');
      setLogoUrl(s?.brand?.logoUrl || '/brand/logo.svg');
      setDefaultMovieClick(String(s?.ui?.defaultMovieCardClickAction || 'play'));
      setBgDesktop(s?.login?.backgroundDesktopUrl || '/auth/login-bg.jpg');
      setBgMobile(s?.login?.backgroundMobileUrl || '/auth/login-bg-mobile.jpg');
      setHelpUrl(s?.login?.helpLinkUrl || 'https://www.facebook.com/threejfiberwifi');
      setHelpText(s?.login?.helpLinkText || 'FB Page');
      setServersText((s?.xuione?.servers || []).join('\n'));
    } catch (e) {
      setErr(e?.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const payload = useMemo(
    () => ({
      settings: {
        brand: { name: brandName, color: brandColor, logoUrl },
        ui: { defaultMovieCardClickAction: defaultMovieClick === 'preview' ? 'preview' : 'play' },
        login: {
          backgroundDesktopUrl: bgDesktop,
          backgroundMobileUrl: bgMobile,
          helpLinkUrl: helpUrl,
          helpLinkText: helpText,
        },
        xuione: { servers: normalizeServers(serversText) },
      },
    }),
    [brandName, brandColor, logoUrl, defaultMovieClick, bgDesktop, bgMobile, helpUrl, helpText, serversText]
  );

  const save = async () => {
    setSaving(true);
    setErr('');
    setOkMsg('');
    try {
      const r = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save settings.');
      setOkMsg('Saved settings.');
      // refresh env + normalized settings
      const s = j.settings || {};
      setServersText((s?.xuione?.servers || []).join('\n'));
    } catch (e) {
      setErr(e?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-lg font-semibold">UI settings</h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          These values replace hard-coded assets like logo, login backgrounds, and brand color.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Brand name</label>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Brand color</label>
            <input
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="#FA5252"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Logo URL</label>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="/brand/logo.svg"
            />
            <div className="mt-2 text-xs text-[var(--admin-muted)]">
              Tip: use <code>/brand/logo.svg</code> or a hosted URL.
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Default movie card click behavior</label>
            <select
              value={defaultMovieClick}
              onChange={(e) => setDefaultMovieClick(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
              <option value="play">Play immediately</option>
              <option value="preview">Open trailer preview</option>
            </select>
            <div className="mt-2 text-xs text-[var(--admin-muted)]">
              Users can still override this in their Profile preferences.
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Login background (desktop)</label>
            <input
              value={bgDesktop}
              onChange={(e) => setBgDesktop(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="/auth/login-bg.jpg"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Login background (mobile)</label>
            <input
              value={bgMobile}
              onChange={(e) => setBgMobile(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="/auth/login-bg-mobile.jpg"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Help link URL</label>
            <input
              value={helpUrl}
              onChange={(e) => setHelpUrl(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="https://…"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--admin-muted)]">Help link text</label>
            <input
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
              placeholder="FB Page"
            />
          </div>
        </div>

        <div className="mt-6">
          <label className="mb-1 block text-xs text-[var(--admin-muted)]">Xuione servers (one per line)</label>
          <textarea
            value={serversText}
            onChange={(e) => setServersText(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            placeholder="https://tv1.example.com/\nhttps://tv2.example.com/"
          />
          <div className="mt-2 text-xs text-[var(--admin-muted)]">
            Note: env vars `XUIONE_URLS`/`XUI_SERVERS` override this list if set.
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div>
        ) : null}
        {okMsg ? (
          <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div>
        ) : null}

        <div className="mt-5 flex gap-3">
          <button
            disabled={saving}
            onClick={save}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            disabled={saving}
            onClick={load}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Reload
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h3 className="text-lg font-semibold">Secrets</h3>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Manage API keys and other secrets in the Admin Secrets page.
        </p>

        <a
          href="/admin/secrets"
          className="mt-4 inline-flex rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10"
        >
          Open Secrets
        </a>
      </div>
    </div>
  );
}
