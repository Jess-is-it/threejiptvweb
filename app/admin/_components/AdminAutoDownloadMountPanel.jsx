'use client';

import { useEffect, useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';

import HelpTooltip from './HelpTooltip';
import EditModal from './EditModal';
import NotesButton from './NotesButton';

function Field({ label, children, hint, note }) {
  const infoText = [hint, note].map((item) => String(item || '').trim()).filter(Boolean).join(' • ');
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--admin-text)]">
          <span>{label}</span>
          {infoText ? <HelpTooltip text={infoText} /> : null}
        </label>
      </div>
      {children}
    </div>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className={
        'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30 ' +
        (props.className || '')
      }
    />
  );
}

function fmtBytes(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtPct(n) {
  const value = Number(n);
  return Number.isFinite(value) ? `${Math.round(value)}%` : '—';
}

function normalizeFolderBase(value) {
  return String(value || '')
    .trim()
    .replace(/\(\d+\)\s*$/, '')
    .trim()
    .toLowerCase();
}

function relativeSegments(fullPath, rootPrefix) {
  const source = String(fullPath || '');
  if (!source.startsWith(rootPrefix)) return [];
  const rel = source.slice(rootPrefix.length).replace(/^\/+/, '');
  if (!rel) return [];
  return rel.split('/').filter(Boolean);
}

function CreatedBadge({
  ready,
  checking = false,
  readyLabel = 'Ready',
  failLabel = 'Not Ready',
  checkingLabel = 'Checking',
}) {
  if (checking) {
    return (
      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 data-[theme=dark]:text-amber-200">
        {checkingLabel}
      </span>
    );
  }
  return (
    <span
      className={
        'rounded-full border px-2 py-0.5 text-[11px] font-medium ' +
        (ready
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 data-[theme=dark]:text-emerald-200'
          : 'border-red-500/40 bg-red-500/10 text-red-700 data-[theme=dark]:text-red-200')
      }
    >
      {ready ? readyLabel : failLabel}
    </span>
  );
}

function SettingsIconButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-[var(--admin-muted)] hover:bg-black/10 hover:text-[var(--admin-text)]"
      title="Settings"
      aria-label="Settings"
    >
      <Settings2 size={16} />
    </button>
  );
}

export default function AdminAutoDownloadMountPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [mounting, setMounting] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [unmounting, setUnmounting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [windowsHost, setWindowsHost] = useState('');
  const [shareName, setShareName] = useState('');
  const [mountDir, setMountDir] = useState('/mnt/windows_vod');
  const [xuiVodPath, setXuiVodPath] = useState('/home/xui/content/vod');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [smbVersion, setSmbVersion] = useState('');
  const [uid, setUid] = useState('xui');
  const [gid, setGid] = useState('xui');

  const [status, setStatus] = useState(null);
  const [storageDevices, setStorageDevices] = useState(null);
  const [storageDevicesError, setStorageDevicesError] = useState('');
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(true);
  const [folderSummary, setFolderSummary] = useState(null);

  const [folderCfgOk, setFolderCfgOk] = useState('');
  const [folderCfgErr, setFolderCfgErr] = useState('');
  const [savingFolders, setSavingFolders] = useState(false);
  const [folderWarnings, setFolderWarnings] = useState([]);

  const [moviesDownloadingFolder, setMoviesDownloadingFolder] = useState('Downloading');
  const [moviesDownloadedFolder, setMoviesDownloadedFolder] = useState('Downloaded and Processing');
  const [moviesProcessingFolder, setMoviesProcessingFolder] = useState('Cleaned and Ready');

  const [seriesDownloadingFolder, setSeriesDownloadingFolder] = useState('Downloading');
  const [seriesDownloadedFolder, setSeriesDownloadedFolder] = useState('Downloaded and Processing');
  const [seriesProcessingFolder, setSeriesProcessingFolder] = useState('Cleaned and Ready');
  const [savedFolderConfig, setSavedFolderConfig] = useState({
    movies: { downloading: 'Downloading', downloaded: 'Downloaded and Processing', processing: 'Cleaned and Ready' },
    series: { downloading: 'Downloading', downloaded: 'Downloaded and Processing', processing: 'Cleaned and Ready' },
  });

  const [tmdbMovieGenres, setTmdbMovieGenres] = useState([]);
  const [tmdbTvGenres, setTmdbTvGenres] = useState([]);

  const notes = [
    {
      title: 'What this tab does',
      items: [
        'Shows mount health, folder readiness, categories/genres folder readiness, and the auto-detected XUI VOD storage volume.',
        'All actions and edits are in Settings: mount operations, SMB/CIFS config, folder structure, and XUI VOD path override.',
      ],
    },
    {
      title: 'Mount behavior',
      items: [
        'Mount adds and maintains a managed /etc/fstab entry with marker # 3JTV_CIFS_AUTOMOUNT.',
        'Unmount removes the managed fstab entry and unmounts all active mounts for this mount path.',
        'Repair remounts and refreshes mount health only.',
      ],
    },
  ];

  const baseMountDir = useMemo(() => String(mountDir || '/mnt/windows_vod').replace(/\/+$/, ''), [mountDir]);
  const qBittorrentBaseDir = useMemo(() => `${baseMountDir}/qBittorrent`, [baseMountDir]);
  const moviesStageBaseDir = useMemo(() => `${qBittorrentBaseDir}/Movies`, [qBittorrentBaseDir]);
  const seriesStageBaseDir = useMemo(() => `${qBittorrentBaseDir}/Series`, [qBittorrentBaseDir]);

  const canAuthAction = useMemo(() => {
    return Boolean(
      windowsHost.trim() &&
        shareName.trim() &&
        mountDir.trim() &&
        (hasSavedCredentials || (username.trim() && password))
    );
  }, [windowsHost, shareName, mountDir, hasSavedCredentials, username, password]);

  const syncFolderSummary = async ({ silent = true } = {}) => {
    setValidating(true);
    if (!silent) {
      setErr('');
      setOk('');
    }
    try {
      const r = await fetch('/api/admin/autodownload/mount/validate-folders', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Folder validation failed.');
      setFolderSummary(j?.result || null);
      if (!silent) {
        setOk(j?.result?.ok ? 'Library folders are ready.' : 'Folders created, but some issues need attention.');
      }
      return true;
    } catch (e) {
      if (!silent) setErr(e?.message || 'Folder validation failed.');
      return false;
    } finally {
      setValidating(false);
    }
  };

  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      const [mountRes, storageRes] = await Promise.all([
        fetch('/api/admin/autodownload/mount/status', { cache: 'no-store' }),
        fetch('/api/admin/autodownload/mount/storage-devices', { cache: 'no-store' }).catch(() => null),
      ]);

      const mountJson = await mountRes.json().catch(() => ({}));
      if (mountRes.ok && mountJson?.ok) {
        const next = mountJson.status || null;
        setStatus(next);
        if (next?.mounted) await syncFolderSummary({ silent: true });
        else setFolderSummary(null);
      }

      if (storageRes) {
        const storageJson = await storageRes.json().catch(() => ({}));
        if (storageRes.ok && storageJson?.ok) {
          setStorageDevices(storageJson.storageDevices || null);
          setStorageDevicesError('');
        } else {
          setStorageDevices(null);
          setStorageDevicesError(storageJson?.error || 'Failed to read storage devices.');
        }
      }
      return true;
    } catch {
      return false;
    } finally {
      setRefreshing(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const [r1, r2, r3, r4, r5] = await Promise.all([
        fetch('/api/admin/autodownload/mount', { cache: 'no-store' }),
        fetch('/api/admin/autodownload/mount/status', { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/autodownload/library-folders', { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/autodownload/tmdb/genres', { cache: 'no-store' }).catch(() => null),
        fetch('/api/admin/autodownload/mount/storage-devices', { cache: 'no-store' }).catch(() => null),
      ]);

      const j1 = await r1.json().catch(() => ({}));
      if (!r1.ok || !j1?.ok) throw new Error(j1?.error || 'Failed to load mount settings.');
      const mount = j1.mount || null;
      if (mount) {
        setWindowsHost(mount.windowsHost || '');
        setShareName(mount.shareName || '');
        setMountDir(mount.mountDir || '/mnt/windows_vod');
        setXuiVodPath(mount.xuiVodPath || '/home/xui/content/vod');
        setDomain(mount.domain || '');
        setSmbVersion(mount.smbVersion || '');
        setUid(mount.uid || 'xui');
        setGid(mount.gid || 'xui');
        setHasSavedCredentials(Boolean(mount.hasCredentials));
        setNeedsVerification(!mount.hasCredentials);
      }

      let loadedStatus = null;
      if (r2) {
        const j2 = await r2.json().catch(() => ({}));
        if (j2?.ok) {
          loadedStatus = j2.status || null;
          setStatus(loadedStatus);
          if (loadedStatus?.ok) setNeedsVerification(false);
        }
      }

      if (r3) {
        const j3 = await r3.json().catch(() => ({}));
        if (j3?.ok) {
          const lf = j3.libraryFolders || {};
          const nextFolderConfig = {
            movies: {
              downloading: lf?.movies?.downloading || 'Downloading',
              downloaded: lf?.movies?.downloaded || 'Downloaded and Processing',
              processing: lf?.movies?.processing || 'Cleaned and Ready',
            },
            series: {
              downloading: lf?.series?.downloading || 'Downloading',
              downloaded: lf?.series?.downloaded || 'Downloaded and Processing',
              processing: lf?.series?.processing || 'Cleaned and Ready',
            },
          };
          setMoviesDownloadingFolder(nextFolderConfig.movies.downloading);
          setMoviesDownloadedFolder(nextFolderConfig.movies.downloaded);
          setMoviesProcessingFolder(nextFolderConfig.movies.processing);
          setSeriesDownloadingFolder(nextFolderConfig.series.downloading);
          setSeriesDownloadedFolder(nextFolderConfig.series.downloaded);
          setSeriesProcessingFolder(nextFolderConfig.series.processing);
          setSavedFolderConfig(nextFolderConfig);
        }
      }

      if (r4) {
        const j4 = await r4.json().catch(() => ({}));
        if (j4?.ok) {
          setTmdbMovieGenres(Array.isArray(j4.movie) ? j4.movie : []);
          setTmdbTvGenres(Array.isArray(j4.tv) ? j4.tv : []);
        }
      }

      if (r5) {
        const j5 = await r5.json().catch(() => ({}));
        if (j5?.ok) {
          const nextStorageDevices = j5.storageDevices || null;
          setStorageDevices(nextStorageDevices);
          setStorageDevicesError('');
          if (!j1?.mount?.xuiVodPath && nextStorageDevices?.resolvedPath) {
            setXuiVodPath(nextStorageDevices.resolvedPath);
          }
        } else {
          setStorageDevices(null);
          setStorageDevicesError(j5?.error || 'Failed to read storage devices.');
        }
      }

      if (loadedStatus?.mounted) {
        await syncFolderSummary({ silent: true });
      } else {
        setFolderSummary(null);
      }
    } catch (e) {
      setErr(e?.message || 'Failed to load mount settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (needsVerification) {
      setErr('Run Test SMB or Mount first before saving NAS settings.');
      return false;
    }
    if (!canAuthAction) {
      setErr('Provide NAS host/share/mount and credentials (or keep saved credentials).');
      return false;
    }

    setBusy(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/mount', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          windowsHost,
          shareName,
          mountDir,
          xuiVodPath,
          username,
          password,
          domain,
          smbVersion,
          uid,
          gid,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save NAS settings.');
      setOk('NAS settings saved.');
      setPassword('');
      setHasSavedCredentials(true);
      await refreshStatus();
      return true;
    } catch (e) {
      setErr(e?.message || 'Failed to save NAS settings.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/mount/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          windowsHost,
          shareName,
          mountDir,
          xuiVodPath,
          username,
          password,
          domain,
          smbVersion,
          uid,
          gid,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'SMB test failed.');
      setOk(j?.result?.message || 'SMB OK.');
      setNeedsVerification(false);
      return true;
    } catch (e) {
      setErr(e?.message || 'SMB test failed.');
      return false;
    } finally {
      setTesting(false);
    }
  };

  const mountNow = async () => {
    setMounting(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/mount/mount-now', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          windowsHost,
          shareName,
          mountDir,
          xuiVodPath,
          username,
          password,
          domain,
          smbVersion,
          uid,
          gid,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Mount failed.');
      setOk('Mounted and configured.');
      const nextStatus = j?.result?.status || null;
      if (nextStatus) setStatus(nextStatus);
      setHasSavedCredentials(true);
      setNeedsVerification(false);
      setPassword('');
      await refreshStatus();
      return true;
    } catch (e) {
      setErr(e?.message || 'Mount failed.');
      return false;
    } finally {
      setMounting(false);
    }
  };

  const repair = async () => {
    setRepairing(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/mount/repair', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Repair failed.');
      setOk('Repair completed.');
      setStatus(j?.result?.status || null);
      setNeedsVerification(false);
      await refreshStatus();
      return true;
    } catch (e) {
      setErr(e?.message || 'Repair failed.');
      return false;
    } finally {
      setRepairing(false);
    }
  };

  const unmount = async () => {
    setUnmounting(true);
    setErr('');
    setOk('');
    try {
      const r = await fetch('/api/admin/autodownload/mount/unmount', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Unmount failed.');
      setOk('Unmounted.');
      const nextStatus = j?.result?.status || null;
      if (nextStatus) setStatus(nextStatus);
      else setStatus((prev) => ({ ...(prev || {}), mounted: false, writable: false, fstabPresent: false }));
      setFolderSummary(null);
      await refreshStatus();
      return true;
    } catch (e) {
      setErr(e?.message || 'Unmount failed.');
      return false;
    } finally {
      setUnmounting(false);
    }
  };

  const validateFolderName = (s) => {
    const v = String(s || '').trim();
    if (!v) return 'Required.';
    if (v.includes('/') || v.includes('\\')) return 'No slashes allowed.';
    if (v.includes('..')) return 'Must not contain "..".';
    if (!/^[A-Za-z0-9 _-]+$/.test(v)) return 'Use letters, numbers, spaces, hyphen, underscore only.';
    return '';
  };

  const folderCfgValidation = useMemo(() => {
    const errors = [];

    const m1 = validateFolderName(moviesDownloadingFolder);
    const m2 = validateFolderName(moviesDownloadedFolder);
    const m3 = validateFolderName(moviesProcessingFolder);
    if (m1) errors.push(`Movies Downloading: ${m1}`);
    if (m2) errors.push(`Movies Downloaded: ${m2}`);
    if (m3) errors.push(`Movies Processing: ${m3}`);
    const ms = [moviesDownloadingFolder, moviesDownloadedFolder, moviesProcessingFolder].map((x) =>
      String(x || '').trim().toLowerCase()
    );
    if (new Set(ms).size !== ms.length) errors.push('Movies stage folders must be unique.');

    const s1 = validateFolderName(seriesDownloadingFolder);
    const s2 = validateFolderName(seriesDownloadedFolder);
    const s3 = validateFolderName(seriesProcessingFolder);
    if (s1) errors.push(`Series Downloading: ${s1}`);
    if (s2) errors.push(`Series Downloaded: ${s2}`);
    if (s3) errors.push(`Series Processing: ${s3}`);
    const ss = [seriesDownloadingFolder, seriesDownloadedFolder, seriesProcessingFolder].map((x) =>
      String(x || '').trim().toLowerCase()
    );
    if (new Set(ss).size !== ss.length) errors.push('Series stage folders must be unique.');

    return errors;
  }, [
    moviesDownloadingFolder,
    moviesDownloadedFolder,
    moviesProcessingFolder,
    seriesDownloadingFolder,
    seriesDownloadedFolder,
    seriesProcessingFolder,
  ]);

  const saveFolderConfig = async () => {
    if (folderCfgValidation.length) {
      setFolderCfgErr('Fix folder validation errors before saving.');
      return false;
    }

    setSavingFolders(true);
    setFolderCfgErr('');
    setFolderCfgOk('');
    setFolderWarnings([]);
    try {
      const r = await fetch('/api/admin/autodownload/library-folders', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          movies: {
            downloading: moviesDownloadingFolder,
            downloaded: moviesDownloadedFolder,
            processing: moviesProcessingFolder,
          },
          series: {
            downloading: seriesDownloadingFolder,
            downloaded: seriesDownloadedFolder,
            processing: seriesProcessingFolder,
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Failed to save folder configuration.');

      const lf = j.libraryFolders || {};
      setMoviesDownloadingFolder(lf?.movies?.downloading || moviesDownloadingFolder);
      setMoviesDownloadedFolder(lf?.movies?.downloaded || moviesDownloadedFolder);
      setMoviesProcessingFolder(lf?.movies?.processing || moviesProcessingFolder);
      setSeriesDownloadingFolder(lf?.series?.downloading || seriesDownloadingFolder);
      setSeriesDownloadedFolder(lf?.series?.downloaded || seriesDownloadedFolder);
      setSeriesProcessingFolder(lf?.series?.processing || seriesProcessingFolder);
      setSavedFolderConfig({
        movies: {
          downloading: lf?.movies?.downloading || moviesDownloadingFolder,
          downloaded: lf?.movies?.downloaded || moviesDownloadedFolder,
          processing: lf?.movies?.processing || moviesProcessingFolder,
        },
        series: {
          downloading: lf?.series?.downloading || seriesDownloadingFolder,
          downloaded: lf?.series?.downloaded || seriesDownloadedFolder,
          processing: lf?.series?.processing || seriesProcessingFolder,
        },
      });
      const responseWarnings = Array.isArray(j.warnings) ? j.warnings : [];
      const migrated = Array.isArray(j.migrated) ? j.migrated : [];
      setFolderWarnings([
        ...responseWarnings,
        ...migrated.map((x) => `Auto-migrated: ${x}`),
      ]);
      setFolderCfgOk(migrated.length ? `Folder structure saved. Migrated ${migrated.length} folder(s).` : 'Folder structure saved.');
      await syncFolderSummary({ silent: true });
      return true;
    } catch (e) {
      setFolderCfgErr(e?.message || 'Failed to save folder configuration.');
      return false;
    } finally {
      setSavingFolders(false);
    }
  };

  const okMount = status?.ok;
  const used = status?.space?.used || 0;
  const total = status?.space?.total || 0;
  const usedPct = total ? Math.round((used / total) * 100) : null;

  const folderConfigDirty = useMemo(() => {
    return (
      savedFolderConfig?.movies?.downloading !== moviesDownloadingFolder ||
      savedFolderConfig?.movies?.downloaded !== moviesDownloadedFolder ||
      savedFolderConfig?.movies?.processing !== moviesProcessingFolder ||
      savedFolderConfig?.series?.downloading !== seriesDownloadingFolder ||
      savedFolderConfig?.series?.downloaded !== seriesDownloadedFolder ||
      savedFolderConfig?.series?.processing !== seriesProcessingFolder
    );
  }, [
    savedFolderConfig,
    moviesDownloadingFolder,
    moviesDownloadedFolder,
    moviesProcessingFolder,
    seriesDownloadingFolder,
    seriesDownloadedFolder,
    seriesProcessingFolder,
  ]);

  const settingsSaveDisabled = loading || busy || savingFolders || (folderConfigDirty && folderCfgValidation.length > 0);

  const saveAndCloseSettings = async () => {
    if (folderConfigDirty) {
      const saved = await saveFolderConfig();
      if (!saved) return;
      setOk('Folder structure saved.');
    }
    setSettingsOpen(false);
    setPassword('');
    setFolderCfgErr('');
    setFolderCfgOk('');
  };

  const testDisabled = loading || testing || !canAuthAction;
  const mountDisabled = loading || mounting || (needsVerification && !canAuthAction);
  const saveMountDisabled = loading || busy || needsVerification || !canAuthAction;

  const fstabPresent = Boolean(status?.fstabPresent);
  const mounted = Boolean(status?.mounted);
  const switchOn = Boolean(fstabPresent || mounted);
  const mountSwitchDisabled = switchOn ? loading || unmounting : mountDisabled;
  const mountSwitchLabel = unmounting
    ? 'Unmounting…'
    : mounting
      ? 'Mounting…'
      : switchOn
        ? mounted
          ? 'Mounted'
          : 'Auto-mount On'
        : 'Mount';
  const mountSwitchTitle = switchOn ? 'Click to unmount' : 'Click to mount';

  const summaryPaths = useMemo(() => {
    return [...(folderSummary?.created || []), ...(folderSummary?.existing || [])];
  }, [folderSummary]);

  const movieStagePaths = useMemo(
    () => [
      `${moviesStageBaseDir}/${moviesDownloadingFolder}`,
      `${moviesStageBaseDir}/${moviesDownloadedFolder}`,
      `${moviesStageBaseDir}/${moviesProcessingFolder}`,
    ],
    [moviesStageBaseDir, moviesDownloadingFolder, moviesDownloadedFolder, moviesProcessingFolder]
  );

  const seriesStagePaths = useMemo(
    () => [
      `${seriesStageBaseDir}/${seriesDownloadingFolder}`,
      `${seriesStageBaseDir}/${seriesDownloadedFolder}`,
      `${seriesStageBaseDir}/${seriesProcessingFolder}`,
    ],
    [seriesStageBaseDir, seriesDownloadingFolder, seriesDownloadedFolder, seriesProcessingFolder]
  );

  const pathExistsInSummary = (path) => summaryPaths.includes(path);
  const moviesStageCreated = movieStagePaths.every(pathExistsInSummary);
  const seriesStageCreated = seriesStagePaths.every(pathExistsInSummary);
  const mountReady = Boolean(status?.mounted && status?.writable);
  const folderStructureCreated = Boolean(mountReady && folderSummary && !folderSummary?.errors?.length && moviesStageCreated && seriesStageCreated);

  const moviesRootPrefix = `${baseMountDir}/Movies/`;
  const seriesRootPrefix = `${baseMountDir}/Series/`;

  const movieStageNames = useMemo(
    () =>
      new Set(
        [moviesDownloadingFolder, moviesDownloadedFolder, moviesProcessingFolder]
          .map((x) => normalizeFolderBase(x))
          .filter(Boolean)
      ),
    [moviesDownloadingFolder, moviesDownloadedFolder, moviesProcessingFolder]
  );
  const seriesStageNames = useMemo(
    () =>
      new Set(
        [seriesDownloadingFolder, seriesDownloadedFolder, seriesProcessingFolder]
          .map((x) => normalizeFolderBase(x))
          .filter(Boolean)
      ),
    [seriesDownloadingFolder, seriesDownloadedFolder, seriesProcessingFolder]
  );

  const moviePathSegments = useMemo(
    () =>
      summaryPaths
        .map((x) => relativeSegments(x, moviesRootPrefix))
        .filter((segments) => segments.length > 0),
    [summaryPaths, moviesRootPrefix]
  );
  const seriesPathSegments = useMemo(
    () =>
      summaryPaths
        .map((x) => relativeSegments(x, seriesRootPrefix))
        .filter((segments) => segments.length > 0),
    [summaryPaths, seriesRootPrefix]
  );

  const movieCategoryBases = useMemo(() => {
    const out = new Set();
    for (const segments of moviePathSegments) {
      const categoryBase = normalizeFolderBase(segments[0]);
      if (!categoryBase || movieStageNames.has(categoryBase)) continue;
      out.add(categoryBase);
    }
    return out;
  }, [moviePathSegments, movieStageNames]);

  const categoriesCreated = movieCategoryBases.has('english') && movieCategoryBases.has('asian');

  const movieGenreByCategory = useMemo(() => {
    const out = { english: new Set(), asian: new Set() };
    for (const segments of moviePathSegments) {
      if (segments.length < 2) continue;
      const categoryBase = normalizeFolderBase(segments[0]);
      if (!(categoryBase in out)) continue;
      const genreBase = normalizeFolderBase(segments[1]);
      if (!genreBase) continue;
      out[categoryBase].add(genreBase);
    }
    return out;
  }, [moviePathSegments]);

  const expectedMovieGenres = useMemo(
    () =>
      Array.from(
        new Set(
          tmdbMovieGenres
            .map((x) => normalizeFolderBase(x?.name))
            .filter(Boolean)
        )
      ),
    [tmdbMovieGenres]
  );

  const expectedSeriesGenres = useMemo(
    () =>
      Array.from(
        new Set(
          tmdbTvGenres
            .map((x) => normalizeFolderBase(x?.name))
            .filter(Boolean)
        )
      ),
    [tmdbTvGenres]
  );

  const movieGenresCreated = Boolean(
    expectedMovieGenres.length > 0 &&
      ['english', 'asian'].every((categoryKey) =>
        expectedMovieGenres.every((genreKey) => movieGenreByCategory[categoryKey]?.has(genreKey))
      )
  );

  const seriesGenreBases = useMemo(() => {
    const out = new Set();
    for (const segments of seriesPathSegments) {
      const genreBase = normalizeFolderBase(segments[0]);
      if (!genreBase || seriesStageNames.has(genreBase)) continue;
      out.add(genreBase);
    }
    return out;
  }, [seriesPathSegments, seriesStageNames]);

  const seriesGenresCreated = Boolean(
    expectedSeriesGenres.length > 0 && expectedSeriesGenres.every((genreKey) => seriesGenreBases.has(genreKey))
  );

  const categoriesGenresCreated = Boolean(
    mountReady && folderSummary && !folderSummary?.errors?.length && categoriesCreated && movieGenresCreated && seriesGenresCreated
  );

  const storageRows = Array.isArray(storageDevices?.rows) ? storageDevices.rows : [];

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">Storage & Mount</div>
          <div className="mt-1 text-sm text-[var(--admin-muted)]">
            Dashboard view of NAS mount state, folder structure readiness, and categories/genres readiness.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NotesButton title="Storage & Mount — Notes" sections={notes} />
          <SettingsIconButton onClick={() => setSettingsOpen(true)} />
        </div>
      </div>

      {!settingsOpen && err ? <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 data-[theme=dark]:text-red-300">{err}</div> : null}
      {!settingsOpen && ok ? <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 data-[theme=dark]:text-emerald-200">{ok}</div> : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.8fr,1.2fr]">
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold">NAS</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Mount health, library folder structure, and categories/genres readiness for the NAS workflow.
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">1. Mount Status</div>
                <CreatedBadge ready={Boolean(status?.mounted && status?.writable)} checking={loading || refreshing} />
              </div>
              <div className="mt-2 text-xs text-[var(--admin-muted)]">
                {status?.checkedAt ? `Last checked: ${new Date(status.checkedAt).toLocaleString()}` : 'Not checked yet'}
              </div>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Mounted</span>
                  <span className="font-semibold">{status ? (status.mounted ? 'Yes' : 'No') : '—'}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Writable</span>
                  <span className="font-semibold">{status ? (status.writable ? 'Yes' : 'No') : '—'}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Persisted (fstab)</span>
                  <span className="font-semibold">{status ? (fstabPresent ? 'Yes' : 'No') : '—'}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Space</span>
                  <span className="font-semibold text-right">
                    {total
                      ? `${fmtBytes(used)} / ${fmtBytes(total)}${usedPct !== null ? ` (${usedPct}%)` : ''}`
                      : '—'}
                  </span>
                </div>
              </div>
              {status?.error ? (
                <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 data-[theme=dark]:text-red-300">{status.error}</div>
              ) : null}
            </div>

            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">2. Folder Structure</div>
                <CreatedBadge ready={folderStructureCreated} checking={validating || (Boolean(status?.mounted) && !folderSummary)} />
              </div>
              <div className="mt-2 text-xs text-[var(--admin-muted)]">Staging folders are checked/created from current settings.</div>

              <div className="mt-3 grid gap-3 text-sm">
                <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="font-medium">Movies</div>
                    <CreatedBadge ready={moviesStageCreated} checking={validating || (Boolean(status?.mounted) && !folderSummary)} />
                  </div>
                  <div className="text-[11px] text-[var(--admin-muted)]">{`${moviesStageBaseDir}/${moviesDownloadingFolder}`}</div>
                  <div className="text-[11px] text-[var(--admin-muted)]">{`${moviesStageBaseDir}/${moviesDownloadedFolder}`}</div>
                  <div className="text-[11px] text-[var(--admin-muted)]">{`${moviesStageBaseDir}/${moviesProcessingFolder}`}</div>
                </div>
                <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="font-medium">Series</div>
                    <CreatedBadge ready={seriesStageCreated} checking={validating || (Boolean(status?.mounted) && !folderSummary)} />
                  </div>
                  <div className="text-[11px] text-[var(--admin-muted)]">{`${seriesStageBaseDir}/${seriesDownloadingFolder}`}</div>
                  <div className="text-[11px] text-[var(--admin-muted)]">{`${seriesStageBaseDir}/${seriesDownloadedFolder}`}</div>
                  <div className="text-[11px] text-[var(--admin-muted)]">{`${seriesStageBaseDir}/${seriesProcessingFolder}`}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">3. Categories / Genres</div>
                <CreatedBadge ready={categoriesGenresCreated} checking={validating || (Boolean(status?.mounted) && !folderSummary)} />
              </div>
              <div className="mt-2 text-xs text-[var(--admin-muted)]">
                Final folders are auto-created from fixed categories and TMDB genres.
              </div>

              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Movies categories</span>
                  <span className="font-semibold">English, Asian</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Movie genres (TMDB)</span>
                  <span className="font-semibold">{tmdbMovieGenres.length || 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Series genres (TMDB)</span>
                  <span className="font-semibold">{tmdbTvGenres.length || 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
                  <span className="text-xs text-[var(--admin-muted)]">Folders present on NAS</span>
                  <span className="font-semibold">{categoriesGenresCreated ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">Storage Devices</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Auto-detected XUI VOD volume and its backing devices on the engine host.
              </div>
            </div>
            <CreatedBadge
              ready={Boolean(storageDevices?.logical?.source || storageDevices?.resolvedPath || Number(storageDevices?.logical?.size || 0) > 0)}
              checking={loading || refreshing}
              readyLabel="Detected"
              failLabel="Not Detected"
            />
          </div>

          {storageDevicesError ? (
            <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 data-[theme=dark]:text-red-300">{storageDevicesError}</div>
          ) : null}

          {storageDevices?.note ? (
            <div className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 data-[theme=dark]:text-amber-100">{storageDevices.note}</div>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">Resolved VOD path</div>
              <div className="mt-1 text-sm font-semibold break-all">{storageDevices?.resolvedPath || '—'}</div>
              <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                Preferred: {storageDevices?.preferredPath || '/home/xui/content/vod'}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">Mounted source</div>
              <div className="mt-1 text-sm font-semibold break-all">{storageDevices?.logical?.source || '—'}</div>
              <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                FS: {storageDevices?.logical?.fstype || '—'} · Pool: {storageDevices?.logical?.poolType || '—'}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">Volume capacity</div>
              <div className="mt-1 text-sm font-semibold">
                {storageDevices?.logical?.size
                  ? `${fmtBytes(storageDevices.logical.used)} / ${fmtBytes(storageDevices.logical.size)}`
                  : '—'}
              </div>
              <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                Free: {fmtBytes(storageDevices?.logical?.avail)} · Used: {fmtPct(storageDevices?.logical?.usedPct)}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">Physical member disks</div>
              <div className="mt-1 text-sm font-semibold">{storageDevices?.memberDiskCount ?? 0}</div>
              <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                Raw size total: {fmtBytes(storageDevices?.memberDiskRawTotal)}
              </div>
            </div>
          </div>

          {Array.isArray(storageDevices?.candidatePaths) && storageDevices.candidatePaths.length ? (
            <div className="mt-4">
              <div className="text-xs font-medium text-[var(--admin-text)]">Detected VOD path candidates</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {storageDevices.candidatePaths.map((path) => (
                  <span
                    key={path}
                    className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2.5 py-1 text-[11px] text-[var(--admin-muted)]"
                  >
                    {path}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--admin-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--admin-surface)] text-[var(--admin-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Raw Size</th>
                  <th className="px-3 py-2 font-medium">Available</th>
                  <th className="px-3 py-2 font-medium">Mount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)] bg-[var(--admin-surface-2)]">
                {storageRows.length ? (
                  storageRows.map((row) => (
                    <tr key={`${row.role}:${row.path || row.name}`}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{row.role}</div>
                        {row.note ? <div className="mt-1 text-[11px] text-[var(--admin-muted)]">{row.note}</div> : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{row.name || '—'}</div>
                        <div className="mt-1 text-[11px] text-[var(--admin-muted)] break-all">{row.path || '—'}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div>{row.type || '—'}</div>
                        {row.fstype ? <div className="mt-1 text-[11px] text-[var(--admin-muted)]">{row.fstype}</div> : null}
                      </td>
                      <td className="px-3 py-2 align-top">{fmtBytes(row.size)}</td>
                      <td className="px-3 py-2 align-top">
                        {row.availableKnown ? (
                          <div>
                            <div>{fmtBytes(row.available)}</div>
                            <div className="mt-1 text-[11px] text-[var(--admin-muted)]">Used {fmtPct(row.usedPct)}</div>
                          </div>
                        ) : storageDevices?.logical?.pooled ? (
                          <span className="text-[var(--admin-muted)]">Combined pool</span>
                        ) : (
                          <span className="text-[var(--admin-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="break-all">{row.mountpoint || '—'}</div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-[var(--admin-muted)]">
                      No storage device details detected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <EditModal
        open={settingsOpen}
        title="Storage & Mount Settings"
        description="All mount operations and edits are managed here."
        error={folderCfgErr || err}
        success={folderCfgOk || ok}
        saveLabel={folderConfigDirty ? 'Save & Close' : 'Done'}
        saveDisabled={settingsSaveDisabled}
        saving={savingFolders}
        onCancel={async () => {
          setSettingsOpen(false);
          setPassword('');
          setFolderCfgErr('');
          setFolderCfgOk('');
          await load();
        }}
        onSave={saveAndCloseSettings}
      >
        {needsVerification ? (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-black data-[theme=dark]:text-amber-100">
            Run <span className="font-semibold">Test SMB</span> or <span className="font-semibold">Mount</span> before saving NAS settings.
          </div>
        ) : null}

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div>
            <div className="text-sm font-semibold">XUI Local VOD Volume</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Auto-detect the XUI VOD folder for storage reporting. If detection is wrong or missing on another server, override it here.
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  XUI VOD Path <HelpTooltip text="Engine Host path used to detect the local XUI VOD volume and its backing storage devices." />
                </span>
              }
              hint="Editable override"
            >
              <Input
                value={xuiVodPath}
                onChange={(e) => {
                  setXuiVodPath(e.target.value);
                }}
                placeholder="/home/xui/content/vod"
              />
              <div className="mt-1 text-[11px] text-[var(--admin-muted)]">
                Detected now: {storageDevices?.resolvedPath || '/home/xui/content/vod'}
              </div>
            </Field>

            <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--admin-muted)]">Status</div>
              <div className="mt-2">
                <CreatedBadge
                  ready={Boolean(storageDevices?.logical?.source || storageDevices?.resolvedPath || Number(storageDevices?.logical?.size || 0) > 0)}
                  checking={loading || refreshing}
                  readyLabel="Detected"
                  failLabel="Not Detected"
                />
              </div>
              <div className="mt-2 text-[11px] text-[var(--admin-muted)] break-all">
                Preferred path: {storageDevices?.preferredPath || xuiVodPath || '/home/xui/content/vod'}
              </div>
            </div>
          </div>

          {Array.isArray(storageDevices?.candidatePaths) && storageDevices.candidatePaths.length ? (
            <div className="mt-3">
              <div className="text-xs font-medium text-[var(--admin-text)]">Detected candidates</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {storageDevices.candidatePaths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setXuiVodPath(path)}
                    className="rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2.5 py-1 text-[11px] text-[var(--admin-muted)] hover:bg-black/10"
                  >
                    Use {path}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold">Mount Operations</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">Mount/Unmount, repair, and folder validation controls.</div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={test}
              disabled={testDisabled}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {testing ? 'Testing…' : 'Test SMB'}
            </button>

            <button
              type="button"
              onClick={() => {
                if (switchOn) unmount();
                else mountNow();
              }}
              title={mountSwitchTitle}
              aria-label={mountSwitchTitle}
              role="switch"
              aria-checked={switchOn}
              disabled={mountSwitchDisabled}
              className={
                'inline-flex items-center gap-3 rounded-full border px-2 py-1 text-sm disabled:opacity-60 ' +
                (switchOn
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 data-[theme=dark]:text-emerald-200'
                  : 'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text)]')
              }
            >
              <span
                className={
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' +
                  (switchOn ? 'bg-emerald-500/70' : 'bg-slate-400/60')
                }
              >
                <span
                  className={
                    'h-5 w-5 rounded-full bg-white shadow transition-transform ' +
                    (switchOn ? 'translate-x-5' : 'translate-x-0.5')
                  }
                />
              </span>
              <span className="min-w-[96px] text-left font-medium">{mountSwitchLabel}</span>
            </button>

            <button
              type="button"
              onClick={repair}
              disabled={loading || repairing}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {repairing ? 'Repairing…' : 'Repair Mount'}
            </button>

            <button
              type="button"
              onClick={() => syncFolderSummary({ silent: false })}
              disabled={loading || validating}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {validating ? 'Validating…' : 'Scan & Validate Library'}
            </button>

            <button
              type="button"
              onClick={refreshStatus}
              disabled={loading || refreshing}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {refreshing ? 'Refreshing…' : 'Refresh Status'}
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Windows NAS SMB/CIFS</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Mount source and credential settings.</div>
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saveMountDisabled}
              className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save NAS Settings'}
            </button>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  Windows Host <HelpTooltip text="Windows/NAS host IP or hostname that provides the SMB share." />
                </span>
              }
              hint="IP or hostname"
            >
              <Input
                value={windowsHost}
                onChange={(e) => {
                  setWindowsHost(e.target.value);
                  setNeedsVerification(true);
                }}
                placeholder="10.100.100.10"
              />
            </Field>

            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  Share Name <HelpTooltip text="SMB share name (not a disk path). Mount source is //WindowsHost/ShareName." />
                </span>
              }
              hint="Example: VOD"
            >
              <Input
                value={shareName}
                onChange={(e) => {
                  setShareName(e.target.value);
                  setNeedsVerification(true);
                }}
                placeholder="VOD"
              />
            </Field>

            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  Mount Directory <HelpTooltip text="Absolute Engine Host path where SMB share is mounted." />
                </span>
              }
              hint="Engine Host path"
            >
              <Input
                value={mountDir}
                onChange={(e) => {
                  setMountDir(e.target.value);
                  setNeedsVerification(true);
                }}
                placeholder="/mnt/windows_vod"
              />
            </Field>

            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  Domain (optional) <HelpTooltip text="Optional Windows domain/workgroup." />
                </span>
              }
            >
              <Input
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setNeedsVerification(true);
                }}
                placeholder="WORKGROUP"
              />
            </Field>

            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  SMB Username <HelpTooltip text="SMB username for the NAS share." />
                </span>
              }
              hint="Not displayed after save"
            >
              <Input
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setNeedsVerification(true);
                }}
                placeholder={hasSavedCredentials ? '(already saved)' : 'nasuser'}
                autoComplete="username"
              />
            </Field>

            <Field
              label={
                <span className="inline-flex items-center gap-2">
                  SMB Password <HelpTooltip text="SMB password for the NAS share." />
                </span>
              }
              hint="Not displayed after save"
            >
              <Input
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setNeedsVerification(true);
                }}
                placeholder={hasSavedCredentials ? '(already saved)' : '••••••••'}
                type="password"
                autoComplete="new-password"
              />
            </Field>
          </div>

          <details className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
            <summary className="cursor-pointer text-sm font-semibold">Advanced options</summary>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field
                label="SMB Version (optional)"
                hint="Example: 3.0"
                note="Override SMB protocol version if your NAS requires it."
              >
                <Input
                  value={smbVersion}
                  onChange={(e) => {
                    setSmbVersion(e.target.value);
                    setNeedsVerification(true);
                  }}
                  placeholder="3.0"
                />
              </Field>

              <Field label="uid" hint="Default: xui" note="Optional local uid override for mounted files.">
                <Input
                  value={uid}
                  onChange={(e) => {
                    setUid(e.target.value);
                    setNeedsVerification(true);
                  }}
                  placeholder="xui"
                />
              </Field>

              <Field label="gid" hint="Default: xui" note="Optional local gid override for mounted files.">
                <Input
                  value={gid}
                  onChange={(e) => {
                    setGid(e.target.value);
                    setNeedsVerification(true);
                  }}
                  placeholder="xui"
                />
              </Field>
            </div>
          </details>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div>
            <div className="text-sm font-semibold">Library Folder Structure</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              Edit staging folder names for Movies and Series. Click <span className="font-medium">Save & Close</span> below to apply changes.
            </div>
          </div>

          {folderCfgValidation.length ? (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-black data-[theme=dark]:text-red-200">
              <div className="font-semibold">Fix these before saving:</div>
              <ul className="mt-2 list-disc pl-5">
                {folderCfgValidation.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {folderWarnings.length ? (
            <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-black data-[theme=dark]:text-yellow-200">
              <div className="font-semibold">Warnings</div>
              <ul className="mt-2 list-disc pl-5">
                {folderWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="text-sm font-semibold">Movies</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Base path: <span className="font-mono">{moviesStageBaseDir}</span></div>
              <div className="mt-4 grid gap-3">
                <Field label="Downloading folder name">
                  <Input value={moviesDownloadingFolder} onChange={(e) => setMoviesDownloadingFolder(e.target.value)} />
                </Field>
                <Field label="Downloaded folder name">
                  <Input value={moviesDownloadedFolder} onChange={(e) => setMoviesDownloadedFolder(e.target.value)} />
                </Field>
                <Field label="Processing folder name">
                  <Input value={moviesProcessingFolder} onChange={(e) => setMoviesProcessingFolder(e.target.value)} />
                </Field>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="text-sm font-semibold">Series</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">Base path: <span className="font-mono">{seriesStageBaseDir}</span></div>
              <div className="mt-4 grid gap-3">
                <Field label="Downloading folder name">
                  <Input value={seriesDownloadingFolder} onChange={(e) => setSeriesDownloadingFolder(e.target.value)} />
                </Field>
                <Field label="Downloaded folder name">
                  <Input value={seriesDownloadedFolder} onChange={(e) => setSeriesDownloadedFolder(e.target.value)} />
                </Field>
                <Field label="Processing folder name">
                  <Input value={seriesProcessingFolder} onChange={(e) => setSeriesProcessingFolder(e.target.value)} />
                </Field>
              </div>
            </div>
          </div>
        </div>
      </EditModal>
    </div>
  );
}
