import 'server-only';

import crypto from 'node:crypto';

import { decryptString, encryptString } from '../vault';
import { getAdminDb, saveAdminDb } from '../adminDb';
import { getAutodownloadSettings, getEngineHost, getMountSettings } from './autodownloadDb';
import { SSHService } from './sshService';
import { buildLibraryPaths } from './libraryFolders';

function now() {
  return Date.now();
}

function sanitizePort(p) {
  const n = Number(p || 0);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return 8080;
  return Math.floor(n);
}

function sanitizePath(p) {
  const s = String(p || '').trim();
  if (!s.startsWith('/')) throw new Error('Path must be absolute.');
  return s.replace(/\/+$/, '');
}

function sanitizeConnectionMode(v) {
  return String(v || '').toLowerCase() === 'lan' ? 'lan' : 'ssh';
}

function shQuote(s) {
  return `'${String(s || '').replace(/'/g, `'\\''`)}'`;
}

function clampInt(value, { min = 0, max = 9999, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeHostCandidate(value) {
  const host = String(value || '').trim();
  if (!host) return '';
  const normalized = host.toLowerCase();
  if (normalized === '0.0.0.0' || normalized === '::' || normalized === '::0' || normalized === '*') return '';
  return host;
}

function formatHostForUrl(host) {
  const value = String(host || '').trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) return value;
  if (value.includes(':')) return `[${value}]`;
  return value;
}

function buildQbApiBaseUrls({ port, connectionMode = 'ssh', lanAddress = '', fallbackHost = '' } = {}) {
  const mode = sanitizeConnectionMode(connectionMode);
  const webuiPort = sanitizePort(port);
  const hostMap = new Map();
  const addHost = (candidate) => {
    const host = normalizeHostCandidate(candidate);
    if (!host) return;
    const key = host.toLowerCase();
    if (!hostMap.has(key)) hostMap.set(key, host);
  };

  if (mode === 'lan') {
    addHost(lanAddress);
    addHost(fallbackHost);
    addHost('127.0.0.1');
  } else {
    addHost('127.0.0.1');
    addHost(fallbackHost);
  }

  if (!hostMap.size) addHost('127.0.0.1');
  return Array.from(hostMap.values()).map((host) => `http://${formatHostForUrl(host)}:${webuiPort}`);
}

function extractQbRuntimeQueueOptionsFromBody(body = '') {
  const parsed = parseJsonObjectLoose(body, null);
  if (!parsed || typeof parsed !== 'object') return null;
  const hasQueueKey =
    parsed?.max_active_downloads !== undefined ||
    parsed?.max_active_uploads !== undefined ||
    parsed?.max_active_torrents !== undefined;
  if (!hasQueueKey) return null;
  return {
    queueingEnabled: parsed?.queueing_enabled !== false,
    maxActiveDownloads: clampInt(parsed?.max_active_downloads, { min: 1, max: 999, fallback: 3 }),
    maxActiveUploads: clampInt(parsed?.max_active_uploads, { min: 1, max: 999, fallback: 3 }),
    maxActiveTorrents: clampInt(parsed?.max_active_torrents, { min: 1, max: 2000, fallback: 5 }),
  };
}

function extractQbRuntimeQueueOptionsFromConfigText(raw = '') {
  const text = String(raw || '');
  const readInt = (patterns, fallback) => {
    for (const re of patterns) {
      const match = text.match(re);
      if (!match) continue;
      return clampInt(match[1], { min: 1, max: 9999, fallback });
    }
    return fallback;
  };
  const readBool = (patterns, fallback) => {
    for (const re of patterns) {
      const match = text.match(re);
      if (!match) continue;
      const v = String(match[1] || '').trim().toLowerCase();
      if (v === '1' || v === 'true' || v === 'yes') return true;
      if (v === '0' || v === 'false' || v === 'no') return false;
    }
    return fallback;
  };

  const maxActiveDownloads = readInt(
    [/(?:^|\n)\s*Bittorrent\\+MaxActiveDownloads\s*=\s*(-?\d+)/i, /(?:^|\n)\s*max_active_downloads\s*=\s*(-?\d+)/i],
    3
  );
  const maxActiveUploads = readInt(
    [/(?:^|\n)\s*Bittorrent\\+MaxActiveUploads\s*=\s*(-?\d+)/i, /(?:^|\n)\s*max_active_uploads\s*=\s*(-?\d+)/i],
    3
  );
  const maxActiveTorrents = readInt(
    [/(?:^|\n)\s*Bittorrent\\+MaxActiveTorrents\s*=\s*(-?\d+)/i, /(?:^|\n)\s*max_active_torrents\s*=\s*(-?\d+)/i],
    5
  );
  const queueingEnabled = readBool(
    [/(?:^|\n)\s*Bittorrent\\+QueueingSystemEnabled\s*=\s*([A-Za-z0-9]+)/i, /(?:^|\n)\s*queueing_enabled\s*=\s*([A-Za-z0-9]+)/i],
    true
  );

  return {
    queueingEnabled,
    maxActiveDownloads: clampInt(maxActiveDownloads, { min: 1, max: 999, fallback: 3 }),
    maxActiveUploads: clampInt(maxActiveUploads, { min: 1, max: 999, fallback: 3 }),
    maxActiveTorrents: clampInt(maxActiveTorrents, { min: 1, max: 2000, fallback: 5 }),
  };
}

function normalizeQbBehaviorOptions(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const prev = fallback && typeof fallback === 'object' ? fallback : {};
  return {
    autoDeleteCompletedTorrents:
      source.autoDeleteCompletedTorrents === undefined
        ? prev.autoDeleteCompletedTorrents !== false
        : Boolean(source.autoDeleteCompletedTorrents),
    autoDeleteCompletedDelayMinutes: clampInt(source.autoDeleteCompletedDelayMinutes ?? prev.autoDeleteCompletedDelayMinutes, {
      min: 0,
      max: 4320,
      fallback: 30,
    }),
    maxActiveDownloads: clampInt(source.maxActiveDownloads ?? prev.maxActiveDownloads, {
      min: 1,
      max: 999,
      fallback: 3,
    }),
    maxActiveUploads: clampInt(source.maxActiveUploads ?? prev.maxActiveUploads, {
      min: 1,
      max: 999,
      fallback: 3,
    }),
    maxActiveTorrents: clampInt(source.maxActiveTorrents ?? prev.maxActiveTorrents, {
      min: 1,
      max: 2000,
      fallback: 5,
    }),
  };
}

function buildQbRuntimePreferences(options = {}) {
  const normalized = normalizeQbBehaviorOptions(options);
  return {
    auto_tmm_enabled: false,
    add_trackers_enabled: false,
    queueing_enabled: true,
    max_active_downloads: normalized.maxActiveDownloads,
    max_active_uploads: normalized.maxActiveUploads,
    max_active_torrents: normalized.maxActiveTorrents,
  };
}

function parseJsonObjectLoose(text, fallback = {}) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        return parsed && typeof parsed === 'object' ? parsed : fallback;
      } catch {}
    }
  }
  return fallback;
}

function qbCredentialsFromClientSettings(downloadClient = {}) {
  const dc = downloadClient && typeof downloadClient === 'object' ? downloadClient : {};
  const username = dc?.usernameEnc ? decryptString(dc.usernameEnc) : String(dc?.username || '').trim();
  const password = dc?.passwordEnc ? decryptString(dc.passwordEnc) : String(dc?.password || '');
  return {
    username: String(username || '').trim(),
    password: String(password || ''),
  };
}

async function applyQbRuntimePreferences({
  ssh,
  port,
  username,
  password,
  preferences,
  connectionMode = 'ssh',
  lanAddress = '',
  fallbackHost = '',
} = {}) {
  const webuiPort = sanitizePort(port);
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) throw new Error('Missing qBittorrent credentials.');
  const prefJson = JSON.stringify(preferences || {});
  const baseUrls = buildQbApiBaseUrls({
    port: webuiPort,
    connectionMode,
    lanAddress,
    fallbackHost,
  });
  let lastError = '';
  for (const baseUrl of baseUrls) {
    const cookieJar = `/tmp/3jtv_qb_opts_${crypto.randomUUID().replace(/-/g, '')}.txt`;
    try {
      const referer = `Referer: ${baseUrl}`;
      const loginCmd =
        `curl -sS -m 25 -H ${shQuote(referer)} -c ${shQuote(cookieJar)} ` +
        `--data-urlencode ${shQuote(`username=${user}`)} ` +
        `--data-urlencode ${shQuote(`password=${pass}`)} ` +
        `${shQuote(`${baseUrl}/api/v2/auth/login`)}`;
      const login = await ssh.exec(loginCmd, { timeoutMs: 30000 });
      if (Number(login?.code) !== 0 || !/^ok\.?$/i.test(String(login?.stdout || '').trim())) {
        const msg = String(login?.stderr || login?.stdout || '').trim();
        throw new Error(msg || 'qBittorrent login failed while applying options.');
      }

      const prefCmd =
        `curl -sS -m 25 -H ${shQuote(referer)} -b ${shQuote(cookieJar)} ` +
        `--data-urlencode ${shQuote(`json=${prefJson}`)} ` +
        `${shQuote(`${baseUrl}/api/v2/app/setPreferences`)}`;
      const pref = await ssh.exec(prefCmd, { timeoutMs: 30000 });
      if (Number(pref?.code) !== 0) {
        const msg = String(pref?.stderr || pref?.stdout || '').trim();
        throw new Error(msg || 'Failed to apply qBittorrent preferences.');
      }
      return { ok: true, summary: 'Applied runtime options to qBittorrent.' };
    } catch (e) {
      lastError = e?.message || String(e || '');
    } finally {
      await ssh.exec(`rm -f ${shQuote(cookieJar)} >/dev/null 2>&1 || true`, { timeoutMs: 10000 }).catch(() => null);
    }
  }
  throw new Error(lastError || 'Failed to apply qBittorrent preferences.');
}

async function fetchQbRuntimeQueueOptions({ ssh, port, username, password, connectionMode = 'ssh', lanAddress = '', fallbackHost = '' } = {}) {
  const webuiPort = sanitizePort(port);
  const user = String(username || '').trim();
  const pass = String(password || '');
  const baseUrls = buildQbApiBaseUrls({
    port: webuiPort,
    connectionMode,
    lanAddress,
    fallbackHost,
  });
  let lastError = '';

  for (const baseUrl of baseUrls) {
    const referer = `Referer: ${baseUrl}`;
    const cookieJar = `/tmp/3jtv_qb_opts_${crypto.randomUUID().replace(/-/g, '')}.txt`;
    try {
      if (user && pass) {
        const loginCmd =
          `curl -sS -m 15 -H ${shQuote(referer)} -c ${shQuote(cookieJar)} ` +
          `--data-urlencode ${shQuote(`username=${user}`)} ` +
          `--data-urlencode ${shQuote(`password=${pass}`)} ` +
          `${shQuote(`${baseUrl}/api/v2/auth/login`)}`;
        const login = await ssh.exec(loginCmd, { timeoutMs: 20000 });
        if (Number(login?.code) === 0 && /^ok\.?$/i.test(String(login?.stdout || '').trim())) {
          const prefCmd = `curl -sS -m 15 -H ${shQuote(referer)} -b ${shQuote(cookieJar)} ${shQuote(`${baseUrl}/api/v2/app/preferences`)}`;
          const pref = await ssh.exec(prefCmd, { timeoutMs: 20000 });
          if (Number(pref?.code) === 0) {
            const parsed = extractQbRuntimeQueueOptionsFromBody(pref?.stdout);
            if (parsed) return parsed;
          }
        } else {
          lastError = String(login?.stderr || login?.stdout || '').trim() || 'qBittorrent login failed while reading runtime options.';
        }
      }

      const unauthPrefCmd = `curl -sS -m 15 -H ${shQuote(referer)} ${shQuote(`${baseUrl}/api/v2/app/preferences`)}`;
      const unauthPref = await ssh.exec(unauthPrefCmd, { timeoutMs: 20000 });
      if (Number(unauthPref?.code) === 0) {
        const parsed = extractQbRuntimeQueueOptionsFromBody(unauthPref?.stdout);
        if (parsed) return parsed;
      }
      const msg = String(unauthPref?.stderr || unauthPref?.stdout || '').trim();
      if (msg) lastError = msg;
    } catch (e) {
      lastError = e?.message || String(e || '');
    } finally {
      await ssh.exec(`rm -f ${shQuote(cookieJar)} >/dev/null 2>&1 || true`, { timeoutMs: 10000 }).catch(() => null);
    }
  }
  throw new Error(lastError || 'Failed to query qBittorrent runtime preferences.');
}

async function fetchQbRuntimeQueueOptionsFromConfig({ ssh } = {}) {
  const cmd = `
CONF_A="/home/xui/qBittorrent/config/qBittorrent.conf"
CONF_B="/home/xui/.config/qBittorrent/qBittorrent.conf"
if [ -f "$CONF_A" ]; then
  cat "$CONF_A"
elif [ -f "$CONF_B" ]; then
  cat "$CONF_B"
else
  exit 3
fi
`;
  const r = await ssh.exec(cmd, { timeoutMs: 20000 });
  if (Number(r?.code) !== 0) throw new Error('Unable to read qBittorrent config file for runtime sync.');
  return extractQbRuntimeQueueOptionsFromConfigText(r?.stdout || '');
}

function sanitizeCidrList(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // qBittorrent expects a comma-separated list; keep it permissive but basic-safe.
  const parts = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (!/^[0-9a-f:.]+\/\d{1,3}$/i.test(p)) throw new Error('Auth subnet allowlist must be a comma-separated CIDR list.');
  }
  return parts.join(',');
}

function ensureLocalhostCidr(v) {
  const base = sanitizeCidrList(v);
  const parts = base
    ? base.split(',').map((x) => x.trim()).filter(Boolean)
    : [];
  const hasLocal = parts.some((x) => x.toLowerCase() === '127.0.0.1/32');
  if (!hasLocal) parts.unshift('127.0.0.1/32');
  return parts.join(',');
}

function sshFromEngineHost(engineHost) {
  return new SSHService({
    host: engineHost.host,
    port: engineHost.port,
    username: engineHost.username,
    authType: engineHost.authType,
    password: engineHost.passwordEnc ? decryptString(engineHost.passwordEnc) : '',
    privateKey: engineHost.privateKeyEnc ? decryptString(engineHost.privateKeyEnc) : '',
    passphrase: engineHost.passphraseEnc ? decryptString(engineHost.passphraseEnc) : '',
    sudoPassword: engineHost.sudoPasswordEnc ? decryptString(engineHost.sudoPasswordEnc) : '',
  });
}

export async function getQbittorrentSettingsSafe({ syncRuntime = false } = {}) {
  const db = await getAdminDb();
  let dc = db.autodownloadSettings?.downloadClient || {};

  if (syncRuntime) {
    const { username, password } = qbCredentialsFromClientSettings(dc);
    const engineHost = await getEngineHost().catch(() => null);
    if (engineHost) {
      const ssh = sshFromEngineHost(engineHost);
      try {
        let runtime = null;
        try {
          runtime = await fetchQbRuntimeQueueOptions({
            ssh,
            port: dc?.port || 8080,
            username,
            password,
            connectionMode: dc?.connectionMode || 'ssh',
            lanAddress: dc?.lanBind?.address || '',
            fallbackHost: engineHost?.host || '',
          });
        } catch {
          runtime = await fetchQbRuntimeQueueOptionsFromConfig({ ssh });
        }
        const merged = {
          ...dc,
          maxActiveDownloads: runtime.maxActiveDownloads,
          maxActiveUploads: runtime.maxActiveUploads,
          maxActiveTorrents: runtime.maxActiveTorrents,
        };
        const changed =
          Number(dc?.maxActiveDownloads || 0) !== Number(merged.maxActiveDownloads || 0) ||
          Number(dc?.maxActiveUploads || 0) !== Number(merged.maxActiveUploads || 0) ||
          Number(dc?.maxActiveTorrents || 0) !== Number(merged.maxActiveTorrents || 0);
        if (changed) {
          db.autodownloadSettings = db.autodownloadSettings || {};
          db.autodownloadSettings.downloadClient = merged;
          await saveAdminDb(db);
          dc = merged;
        } else {
          dc = merged;
        }
      } catch {
        // Runtime sync is best-effort; fall back to DB values.
      } finally {
        await ssh.close();
      }
    }
  }

  return {
    enabled: Boolean(db.autodownloadSettings?.enabled),
    type: dc.type || 'qbittorrent',
    host: dc.host || '',
    port: dc.port || 8080,
    autoDeleteCompletedTorrents: dc.autoDeleteCompletedTorrents !== false,
    autoDeleteCompletedDelayMinutes: clampInt(dc.autoDeleteCompletedDelayMinutes, { min: 0, max: 4320, fallback: 30 }),
    maxActiveDownloads: clampInt(dc.maxActiveDownloads, { min: 1, max: 999, fallback: 3 }),
    maxActiveUploads: clampInt(dc.maxActiveUploads, { min: 1, max: 999, fallback: 3 }),
    maxActiveTorrents: clampInt(dc.maxActiveTorrents, { min: 1, max: 2000, fallback: 5 }),
    moviesSavePath: dc.moviesSavePath || '',
    seriesSavePath: dc.seriesSavePath || '',
    hasCredentials: Boolean(dc.usernameEnc && dc.passwordEnc),
    credentialsPendingProvision: Boolean(dc.credentialsPendingProvision),
    connectionMode: dc.connectionMode || 'ssh',
    lanBind: dc.lanBind || { address: '127.0.0.1', authSubnetAllowlist: '127.0.0.1/32' },
    lastOptionsAppliedAt: dc.lastOptionsAppliedAt || null,
    lastOptionsAppliedOk: dc.lastOptionsAppliedOk ?? null,
    lastOptionsSummary: dc.lastOptionsSummary || '',
    lastOptionsError: dc.lastOptionsError || '',
    lastTestAt: dc.lastTestAt || null,
    lastTestOk: dc.lastTestOk ?? null,
    lastTestSummary: dc.lastTestSummary || '',
    lastError: dc.lastError || '',
  };
}

export async function updateQbittorrentSettingsFromAdminInput(input) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const mount = await getMountSettings();
  if (!mount?.mountDir) throw new Error('Configure Storage & Mount first.');

  const mountDir = sanitizePath(mount.mountDir);
  const settings = await getAutodownloadSettings();
  const moviesSavePath = sanitizePath(buildLibraryPaths({ mountDir, type: 'movie', settings }).downloadingDir);
  const seriesSavePath = sanitizePath(buildLibraryPaths({ mountDir, type: 'series', settings }).downloadingDir);

  const db = await getAdminDb();
  const prev = db.autodownloadSettings?.downloadClient || {};
  const prevUsername = prev?.usernameEnc ? decryptString(prev.usernameEnc) : '';
  const prevPassword = prev?.passwordEnc ? decryptString(prev.passwordEnc) : '';
  const webuiPort = input?.port === undefined ? sanitizePort(prev?.port || 8080) : sanitizePort(input?.port);
  const webuiUsername = String(input?.username ?? '').trim() || String(prevUsername || '').trim();
  const webuiPassword = String(input?.password || '');
  const connectionMode =
    input?.connectionMode === undefined
      ? sanitizeConnectionMode(prev?.connectionMode || 'ssh')
      : sanitizeConnectionMode(input?.connectionMode);
  const lanAddress =
    input?.lanBind?.address !== undefined || input?.lanAddress !== undefined
      ? String(input?.lanBind?.address || input?.lanAddress || '').trim()
      : String(prev?.lanBind?.address || '127.0.0.1').trim();
  const lanAllowlist =
    input?.lanBind?.authSubnetAllowlist !== undefined || input?.authSubnetAllowlist !== undefined
      ? ensureLocalhostCidr(input?.lanBind?.authSubnetAllowlist || input?.authSubnetAllowlist || '')
      : ensureLocalhostCidr(prev?.lanBind?.authSubnetAllowlist || '127.0.0.1/32');
  const behaviorOptions = normalizeQbBehaviorOptions(input, prev);

  if (!webuiUsername) throw new Error('WebUI username is required.');
  if (!webuiPassword && !prev?.passwordEnc) throw new Error('WebUI password is required.');

  const nextUsernameEnc = encryptString(webuiUsername);
  const nextPasswordEnc = webuiPassword ? encryptString(webuiPassword) : prev.passwordEnc;
  const credentialsChanged =
    String(webuiUsername || '') !== String(prevUsername || '') ||
    (webuiPassword ? String(webuiPassword) !== String(prevPassword || '') : false);
  db.autodownloadSettings = db.autodownloadSettings || {};
  db.autodownloadSettings.downloadClient = {
    ...(db.autodownloadSettings.downloadClient || {}),
    type: 'qbittorrent',
    host: engineHost.host,
    port: webuiPort,
    usernameEnc: nextUsernameEnc,
    passwordEnc: nextPasswordEnc,
    autoDeleteCompletedTorrents: behaviorOptions.autoDeleteCompletedTorrents,
    autoDeleteCompletedDelayMinutes: behaviorOptions.autoDeleteCompletedDelayMinutes,
    maxActiveDownloads: behaviorOptions.maxActiveDownloads,
    maxActiveUploads: behaviorOptions.maxActiveUploads,
    maxActiveTorrents: behaviorOptions.maxActiveTorrents,
    credentialsPendingProvision: credentialsChanged || Boolean(prev?.credentialsPendingProvision),
    moviesSavePath,
    seriesSavePath,
    connectionMode,
    lanBind: {
      ...(prev?.lanBind || {}),
      address: lanAddress || prev?.lanBind?.address || '127.0.0.1',
      authSubnetAllowlist: lanAllowlist || prev?.lanBind?.authSubnetAllowlist || '127.0.0.1/32',
    },
  };
  await saveAdminDb(db);

  let optionsApply = {
    attempted: false,
    ok: false,
    summary: '',
    error: '',
  };
  const runtimePassword = webuiPassword || prevPassword;
  const runtimePreferences = buildQbRuntimePreferences(behaviorOptions);
  if (webuiUsername && runtimePassword) {
    optionsApply.attempted = true;
    const ssh = sshFromEngineHost(engineHost);
    try {
      const applied = await applyQbRuntimePreferences({
        ssh,
        port: webuiPort,
        username: webuiUsername,
        password: runtimePassword,
        preferences: runtimePreferences,
        connectionMode,
        lanAddress,
        fallbackHost: engineHost?.host || '',
      });
      optionsApply = {
        attempted: true,
        ok: true,
        summary: applied?.summary || 'Applied runtime options to qBittorrent.',
        error: '',
      };
    } catch (e) {
      optionsApply = {
        attempted: true,
        ok: false,
        summary: '',
        error: e?.message || 'Unable to apply runtime options to qBittorrent.',
      };
    } finally {
      await ssh.close();
    }
  }

  const dbAfterApply = await getAdminDb();
  dbAfterApply.autodownloadSettings = dbAfterApply.autodownloadSettings || {};
  dbAfterApply.autodownloadSettings.downloadClient = {
    ...(dbAfterApply.autodownloadSettings.downloadClient || {}),
    lastOptionsAppliedAt: optionsApply.attempted ? now() : dbAfterApply?.autodownloadSettings?.downloadClient?.lastOptionsAppliedAt || null,
    lastOptionsAppliedOk: optionsApply.attempted ? Boolean(optionsApply.ok) : dbAfterApply?.autodownloadSettings?.downloadClient?.lastOptionsAppliedOk ?? null,
    lastOptionsSummary: optionsApply.ok ? optionsApply.summary : '',
    lastOptionsError: optionsApply.ok ? '' : optionsApply.error || '',
  };
  await saveAdminDb(dbAfterApply);

  return getQbittorrentSettingsSafe({ syncRuntime: true });
}

export async function provisionQbittorrentNox({ port = 8080, username = '', password = '', connectionMode = null, lanBind = null } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const mount = await getMountSettings();
  if (!mount?.mountDir) throw new Error('Configure Storage & Mount first.');

  const db = await getAdminDb();
  const dc = db.autodownloadSettings?.downloadClient || {};
  const mode = sanitizeConnectionMode(connectionMode ?? dc.connectionMode);
  const behaviorOptions = normalizeQbBehaviorOptions({}, dc);
  const runtimePreferences = buildQbRuntimePreferences(behaviorOptions);

  const webuiUser = String(username || '').trim() || (dc.usernameEnc ? decryptString(dc.usernameEnc) : '');
  const webuiPass = String(password || '') || (dc.passwordEnc ? decryptString(dc.passwordEnc) : '');
  const prevWebuiUser = dc.lastAppliedUsernameEnc ? decryptString(dc.lastAppliedUsernameEnc) : '';
  const prevWebuiPass = dc.lastAppliedPasswordEnc ? decryptString(dc.lastAppliedPasswordEnc) : '';
  if (!webuiUser || !webuiPass) throw new Error('WebUI credentials are required.');

  const webuiPort = sanitizePort(port || dc.port || 8080);

  const mountDir = sanitizePath(mount.mountDir);
  const settings = await getAutodownloadSettings();
  const moviesSavePath = sanitizePath(buildLibraryPaths({ mountDir, type: 'movie', settings }).downloadingDir);
  const seriesSavePath = sanitizePath(buildLibraryPaths({ mountDir, type: 'series', settings }).downloadingDir);

  const lanAddress = String(lanBind?.address || dc?.lanBind?.address || '').trim();
  const lanAllowlist = ensureLocalhostCidr(lanBind?.authSubnetAllowlist || dc?.lanBind?.authSubnetAllowlist || '');
  const webuiAddress = mode === 'lan' ? lanAddress || '0.0.0.0' : '127.0.0.1';
  const authWhitelist = mode === 'lan' ? lanAllowlist : '127.0.0.1/32';

  const script = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

QBIT_PORT=${JSON.stringify(String(webuiPort))}
QBIT_USER=${JSON.stringify(webuiUser)}
QBIT_PASS=${JSON.stringify(webuiPass)}
QBIT_OLD_USER=${JSON.stringify(prevWebuiUser)}
QBIT_OLD_PASS=${JSON.stringify(prevWebuiPass)}
QBIT_PASS_MD5="$(printf '%s' "$QBIT_PASS" | md5sum | awk '{print $1}')"
MOVIES_SAVE=${JSON.stringify(moviesSavePath)}
SERIES_SAVE=${JSON.stringify(seriesSavePath)}
QBIT_ADDR=${JSON.stringify(webuiAddress)}
QBIT_WHITELIST=${JSON.stringify(authWhitelist)}
QBIT_MAX_ACTIVE_DOWNLOADS=${JSON.stringify(String(runtimePreferences.max_active_downloads))}
QBIT_MAX_ACTIVE_UPLOADS=${JSON.stringify(String(runtimePreferences.max_active_uploads))}
QBIT_MAX_ACTIVE_TORRENTS=${JSON.stringify(String(runtimePreferences.max_active_torrents))}
QBIT_QUEUEING_ENABLED=${JSON.stringify(runtimePreferences.queueing_enabled ? 'true' : 'false')}

ensure_user() {
  if ! getent group xui >/dev/null 2>&1; then
    groupadd --system xui
  fi
  if ! id -u xui >/dev/null 2>&1; then
    useradd --system --home /home/xui --create-home --shell /usr/sbin/nologin -g xui xui
  fi
}

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get -y -o Dpkg::Use-Pty=0 update
    apt-get -y -o Dpkg::Use-Pty=0 install qbittorrent-nox curl
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y qbittorrent-nox curl
  elif command -v yum >/dev/null 2>&1; then
    yum install -y qbittorrent-nox curl
  else
    echo "No supported package manager found"
    exit 2
  fi
}

ensure_user
command -v qbittorrent-nox >/dev/null 2>&1 || pkg_install
command -v curl >/dev/null 2>&1 || pkg_install

# qBittorrent uses this config path when running with --profile=/home/xui.
CONF_DIR="/home/xui/qBittorrent/config"
# Legacy path from earlier builds (kept for migration).
LEGACY_CONF_DIR="/home/xui/.config/qBittorrent"
CONF_FILE="$CONF_DIR/qBittorrent.conf"
install -d -m 0755 -o xui -g xui "$CONF_DIR"

# Migrate old config location if needed.
if [ ! -f "$CONF_FILE" ] && [ -f "$LEGACY_CONF_DIR/qBittorrent.conf" ]; then
  cp "$LEGACY_CONF_DIR/qBittorrent.conf" "$CONF_FILE" >/dev/null 2>&1 || true
fi

if [ ! -f "$CONF_FILE" ]; then
  cat > "$CONF_FILE" <<'EOF'
[Preferences]
WebUI\\Address=${webuiAddress}
WebUI\\Port=${webuiPort}
WebUI\\LocalHostAuth=true
WebUI\\AuthSubnetWhitelist=${authWhitelist}
WebUI\\AuthSubnetWhitelistEnabled=false
EOF
  chown xui:xui "$CONF_FILE"
fi

rewrite_webui_base() {
  awk '
    index($0, "WebUI\\\\Address=") == 1 { next }
    index($0, "WebUI\\\\Port=") == 1 { next }
    index($0, "WebUI\\\\LocalHostAuth=") == 1 { next }
    index($0, "WebUI\\\\AuthSubnetWhitelist=") == 1 { next }
    index($0, "WebUI\\\\AuthSubnetWhitelistEnabled=") == 1 { next }
    index($0, "WebUI\\\\Username=") == 1 { next }
    index($0, "WebUI\\\\Password_ha1=") == 1 { next }
    index($0, "WebUI\\\\Password_PBKDF2=") == 1 { next }
    index($0, "Bittorrent\\\\AddTrackers=") == 1 { next }
    index($0, "Session\\\\DisableAutoTMMByDefault=") == 1 { next }
    { print }
  ' "$CONF_FILE" > "$CONF_FILE.tmp" || true
  cat >> "$CONF_FILE.tmp" <<'EOF'
WebUI\\Address=${webuiAddress}
WebUI\\Port=${webuiPort}
WebUI\\LocalHostAuth=true
WebUI\\AuthSubnetWhitelist=${authWhitelist}
WebUI\\AuthSubnetWhitelistEnabled=false
EOF
}

write_desired_webui_config() {
  rewrite_webui_base
  cat >> "$CONF_FILE.tmp" <<EOF
WebUI\\Username=$QBIT_USER
WebUI\\Password_ha1=@ByteArray($QBIT_PASS_MD5)
Bittorrent\\AddTrackers=false
Session\\DisableAutoTMMByDefault=true
EOF
  mv "$CONF_FILE.tmp" "$CONF_FILE"
  chown xui:xui "$CONF_FILE"
}

cat > /etc/systemd/system/qbittorrent-nox.service <<'EOF'
[Unit]
Description=qBittorrent-nox (3JTV)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=xui
Group=xui
Environment=HOME=/home/xui
ExecStart=/usr/bin/qbittorrent-nox --webui-port=${webuiPort} --profile=/home/xui
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable qbittorrent-nox.service >/dev/null 2>&1 || true
systemctl stop qbittorrent-nox.service >/dev/null 2>&1 || true

# Force port/address/credentials/behavior defaults every time (idempotent).
# Do this while the service is stopped so shutdown does not overwrite edits.
write_desired_webui_config

systemctl start qbittorrent-nox.service

wait_service_active() {
  local svc_state=""
  for i in $(seq 1 30); do
    svc_state="$(systemctl is-active qbittorrent-nox.service 2>/dev/null || true)"
    if [ "$svc_state" = "active" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! wait_service_active; then
  echo "qBittorrent service is not active after restart."
  systemctl status qbittorrent-nox.service --no-pager -l || true
  journalctl -u qbittorrent-nox.service -n 120 --no-pager || true
  exit 3
fi

wait_api_ready() {
  api_code=""
  for i in $(seq 1 60); do
    api_code="$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${webuiPort}/api/v2/app/version" 2>/dev/null || true)"
    if [ "$api_code" = "200" ] || [ "$api_code" = "401" ] || [ "$api_code" = "403" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! wait_api_ready; then
  echo "qBittorrent Web API did not respond on port ${webuiPort} (last HTTP code: \${api_code:-none})"
  systemctl status qbittorrent-nox.service --no-pager -l || true
  journalctl -u qbittorrent-nox.service -n 120 --no-pager || true
  exit 3
fi

COOKIE_JAR="/tmp/3jtv_qb_cookie_$$.txt"
USE_COOKIE=0
api_post() {
  if [ "$USE_COOKIE" = "1" ]; then
    curl -fsS -H "Referer: http://127.0.0.1:${webuiPort}" -b "$COOKIE_JAR" "$@"
  else
    curl -fsS -H "Referer: http://127.0.0.1:${webuiPort}" "$@"
  fi
}
try_login() {
  local u="$1"
  local p="$2"
  [ -n "$u" ] || return 1
  local resp=""
  resp="$(curl -sS -H "Referer: http://127.0.0.1:${webuiPort}" -c "$COOKIE_JAR" --data-urlencode "username=$u" --data-urlencode "password=$p" "http://127.0.0.1:${webuiPort}/api/v2/auth/login" || true)"
  [ "$resp" = "Ok." ]
}

ensure_auth_session() {
  if [ "$USE_COOKIE" = "1" ]; then
    return 0
  fi
  if try_login "$QBIT_USER" "$QBIT_PASS"; then
    USE_COOKIE=1
    return 0
  fi

  # One legacy fallback pass in case old creds were still active while service settled.
  if try_login "$QBIT_OLD_USER" "$QBIT_OLD_PASS" || try_login "admin" "adminadmin"; then
    USE_COOKIE=1
    return 0
  fi

  echo "Configured qBittorrent WebUI credentials were not accepted after rewrite."
  echo "Expected username: $QBIT_USER"
  sed -n '/^WebUI\\\\/p' "$CONF_FILE" || true
  return 1
}

# Set credentials and a couple of safe defaults.
PREF_JSON=$(cat <<JSON
{
  "auto_tmm_enabled": false,
  "add_trackers_enabled": false,
  "queueing_enabled": ${runtimePreferences.queueing_enabled ? 'true' : 'false'},
  "max_active_downloads": ${runtimePreferences.max_active_downloads},
  "max_active_uploads": ${runtimePreferences.max_active_uploads},
  "max_active_torrents": ${runtimePreferences.max_active_torrents}
}
JSON
)

apply_preferences() {
  if api_post -X POST --data-urlencode "json=$PREF_JSON" "http://127.0.0.1:${webuiPort}/api/v2/app/setPreferences" >/dev/null; then
    return 0
  fi
  return 1
}

if ! apply_preferences; then
  if ! ensure_auth_session; then
    echo "qBittorrent API reachable but authentication failed while applying credentials."
    journalctl -u qbittorrent-nox.service -n 120 --no-pager || true
    rm -f "$COOKIE_JAR" >/dev/null 2>&1 || true
    exit 4
  fi
  if ! apply_preferences; then
    echo "qBittorrent API reachable but failed to apply credentials/preferences."
    journalctl -u qbittorrent-nox.service -n 120 --no-pager || true
    rm -f "$COOKIE_JAR" >/dev/null 2>&1 || true
    exit 4
  fi
fi

# Create categories with save paths (idempotent: ignore errors if they exist)
api_post -X POST --data-urlencode "category=MOVIE_AUTO" --data-urlencode "savePath=$MOVIES_SAVE" "http://127.0.0.1:${webuiPort}/api/v2/torrents/createCategory" >/dev/null 2>&1 || true
api_post -X POST --data-urlencode "category=SERIES_AUTO" --data-urlencode "savePath=$SERIES_SAVE" "http://127.0.0.1:${webuiPort}/api/v2/torrents/createCategory" >/dev/null 2>&1 || true

# Verify final configured credentials can login.
verify_resp="$(curl -sS -H "Referer: http://127.0.0.1:${webuiPort}" --data-urlencode "username=$QBIT_USER" --data-urlencode "password=$QBIT_PASS" "http://127.0.0.1:${webuiPort}/api/v2/auth/login" || true)"
if [ "$verify_resp" != "Ok." ]; then
  echo "Credential verification failed for configured WebUI username/password."
  journalctl -u qbittorrent-nox.service -n 120 --no-pager || true
  rm -f "$COOKIE_JAR" >/dev/null 2>&1 || true
  exit 5
fi
rm -f "$COOKIE_JAR" >/dev/null 2>&1 || true

echo "OK"
`;

  const ssh = sshFromEngineHost(engineHost);
  try {
    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 300000 });
    const stdoutText = String(r.stdout || '').trim();
    const stderrText = String(r.stderr || '').trim();
    if (r.code !== 0) throw new Error(stderrText || stdoutText || 'Provisioning failed.');

    // Quick API check (accept reachable HTTP responses even if auth is required).
    let version = '';
    let apiCode = '';
    try {
      const c = await ssh.exec(`curl -sS -o /tmp/3jtv_qb_ver.txt -w "%{http_code}" "http://127.0.0.1:${webuiPort}/api/v2/app/version" || true`, {
        timeoutMs: 15000,
      });
      apiCode = String(c.stdout || '').trim();
      if (apiCode === '200') {
        const v = await ssh.exec('cat /tmp/3jtv_qb_ver.txt 2>/dev/null || true', { timeoutMs: 10000 });
        version = String(v.stdout || '').trim();
      }
      await ssh.exec('rm -f /tmp/3jtv_qb_ver.txt >/dev/null 2>&1 || true', { timeoutMs: 10000 }).catch(() => null);
    } catch {}
    const apiReachable = ['200', '401', '403'].includes(apiCode);

    // Ensure DB save paths are synced.
    db.autodownloadSettings = db.autodownloadSettings || {};
    db.autodownloadSettings.downloadClient = {
      ...(db.autodownloadSettings.downloadClient || {}),
      host: engineHost.host,
      port: webuiPort,
      connectionMode: mode,
      lanBind: {
        ...(db.autodownloadSettings.downloadClient?.lanBind || {}),
        address: mode === 'lan' ? webuiAddress : '127.0.0.1',
        authSubnetAllowlist: mode === 'lan' ? authWhitelist : '127.0.0.1/32',
      },
      usernameEnc: encryptString(webuiUser),
      passwordEnc: encryptString(webuiPass),
      autoDeleteCompletedTorrents: behaviorOptions.autoDeleteCompletedTorrents,
      autoDeleteCompletedDelayMinutes: behaviorOptions.autoDeleteCompletedDelayMinutes,
      maxActiveDownloads: behaviorOptions.maxActiveDownloads,
      maxActiveUploads: behaviorOptions.maxActiveUploads,
      maxActiveTorrents: behaviorOptions.maxActiveTorrents,
      lastAppliedUsernameEnc: encryptString(webuiUser),
      lastAppliedPasswordEnc: encryptString(webuiPass),
      credentialsPendingProvision: false,
      moviesSavePath,
      seriesSavePath,
      lastOptionsAppliedAt: now(),
      lastOptionsAppliedOk: true,
      lastOptionsSummary: 'Applied during provisioning.',
      lastOptionsError: '',
      lastTestAt: now(),
      lastTestOk: apiReachable,
      lastTestSummary: version ? `OK · v${version}` : apiReachable ? `API reachable (${apiCode})` : 'Provisioned',
      lastError: apiReachable ? '' : 'Unable to reach qBittorrent API after provisioning.',
    };
    await saveAdminDb(db);

    const result = {
      ok: true,
      message: 'qBittorrent-nox installed and configured.',
      port: webuiPort,
      version: version || null,
      apiCode: apiCode || null,
      output: stdoutText || null,
      warnings: stderrText || null,
    };
    if (!apiReachable) {
      result.warnings = [result.warnings, `API not reachable after provisioning (HTTP ${apiCode || 'none'}).`].filter(Boolean).join('\n');
    }
    return result;
  } finally {
    await ssh.close();
  }
}

export async function testQbittorrentApi({ port = null } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const db = await getAdminDb();
  const dc = db.autodownloadSettings?.downloadClient || {};
  const webuiPort = sanitizePort(port ?? dc.port ?? 8080);
  const baseUrls = buildQbApiBaseUrls({
    port: webuiPort,
    connectionMode: dc?.connectionMode || 'ssh',
    lanAddress: dc?.lanBind?.address || '',
    fallbackHost: engineHost?.host || '',
  });

  const ssh = sshFromEngineHost(engineHost);
  try {
    const bin = await ssh.exec('command -v qbittorrent-nox >/dev/null 2>&1; echo $?', { timeoutMs: 15000 });
    const installed = String(bin.stdout || '').trim() === '0';

    const svc = await ssh.exec('systemctl is-active qbittorrent-nox.service 2>/dev/null || true', {
      sudo: true,
      timeoutMs: 15000,
    });
    const serviceStatus = String(svc.stdout || '').trim() || 'unknown';

    let version = '';
    let apiOk = false;
    let apiError = '';
    let apiCode = '';
    for (const baseUrl of baseUrls) {
      try {
        const c = await ssh.exec(
          `curl -sS -o /tmp/3jtv_qb_ver.txt -w "%{http_code}" ${shQuote(`${baseUrl}/api/v2/app/version`)} || true`,
          { timeoutMs: 15000 }
        );
        apiCode = String(c.stdout || '').trim();
        if (apiCode === '200') {
          const v = await ssh.exec('cat /tmp/3jtv_qb_ver.txt 2>/dev/null || true', { timeoutMs: 10000 });
          version = String(v.stdout || '').trim();
        }
        apiOk = ['200', '401', '403'].includes(apiCode);
        await ssh.exec('rm -f /tmp/3jtv_qb_ver.txt >/dev/null 2>&1 || true', { timeoutMs: 10000 }).catch(() => null);
        if (apiOk) break;
      } catch (e) {
        apiOk = false;
        apiError = e?.message || 'Web API not reachable';
      }
    }

    const ok = installed && serviceStatus === 'active' && apiOk;
    const summary = ok
      ? version
        ? `OK · v${version}`
        : `OK · API reachable (${apiCode || 'n/a'})`
      : `installed:${installed ? 'yes' : 'no'} service:${serviceStatus || 'unknown'} api:${apiOk ? `reachable(${apiCode || 'n/a'})` : 'fail'}`;

    db.autodownloadSettings = db.autodownloadSettings || {};
    db.autodownloadSettings.downloadClient = {
      ...(dc || {}),
      port: webuiPort,
      lastTestAt: now(),
      lastTestOk: ok,
      lastTestSummary: summary,
      lastError: ok ? '' : apiError || 'Test failed',
    };
    await saveAdminDb(db);

    return {
      ok,
      installed,
      serviceStatus,
      version: version || null,
      apiCode: apiCode || null,
      apiOk,
      apiError: apiError || null,
      port: webuiPort,
      summary,
    };
  } finally {
    await ssh.close();
  }
}

export async function controlQbittorrentService({ action } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const a = String(action || '').toLowerCase();
  if (!['start', 'stop', 'restart'].includes(a)) throw new Error('Invalid action.');

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.exec(`systemctl ${a} qbittorrent-nox.service`, { sudo: true, timeoutMs: 60000 });
    const svc = await ssh.exec('systemctl is-active qbittorrent-nox.service 2>/dev/null || true', {
      sudo: true,
      timeoutMs: 15000,
    });
    const serviceStatus = String(svc.stdout || '').trim() || 'unknown';
    return { ok: true, action: a, serviceStatus };
  } finally {
    await ssh.close();
  }
}
