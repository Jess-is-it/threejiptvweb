import 'server-only';

import crypto from 'node:crypto';

import { decryptString, encryptString } from '../vault';
import { getAdminDb, saveAdminDb } from '../adminDb';
import { getEngineHost } from './autodownloadDb';
import { discoverMovies } from './tmdbService';
import { searchBestDownloadSource } from './sourceProvidersService';
import { SSHService } from './sshService';

const PIA_SERVERLIST_URL = 'https://serverlist.piaservers.net/vpninfo/servers/v6';
const PIA_TOKEN_URL = 'https://www.privateinternetaccess.com/api/client/v2/token';
const VPN_MARK_CHAIN = '3JTV_QB_MARK';
const VPN_KILLSWITCH_CHAIN = '3JTV_QB_KILLSWITCH';
const QB_BENCHMARK_CATEGORY = 'VPN_BENCH';
const QB_BENCHMARK_SAVEPATH = '/tmp/3jtv-vpn-benchmark';

function now() {
  return Date.now();
}

function shQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function clampInt(value, { min = 0, max = 999999, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sanitizeProvider(value) {
  return String(value || '').trim().toLowerCase() === 'pia' ? 'pia' : 'pia';
}

function sanitizeLinuxAccountName(value, fallback = 'qbvpn') {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return String(fallback || 'qbvpn').trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(s)) return String(fallback || 'qbvpn').trim().toLowerCase();
  return s;
}

function sanitizeInterfaceName(value) {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_.-]/g, '').slice(0, 15);
  return cleaned || 'piawg0';
}

function sanitizeRegionId(value, fallback = 'ph') {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
  return cleaned || String(fallback || 'ph').trim().toLowerCase();
}

function sanitizeRegionName(value, fallback = '') {
  const s = String(value || '').trim().slice(0, 120);
  return s || String(fallback || '').trim();
}

function sanitizeConnectionMode(value) {
  return String(value || '').trim().toLowerCase() === 'lan' ? 'lan' : 'ssh';
}

function isValidIpv4Cidr(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) return false;
  const ip = String(match[1] || '').split('.');
  if (ip.length !== 4) return false;
  for (const chunk of ip) {
    const n = Number(chunk);
    if (!Number.isFinite(n) || n < 0 || n > 255) return false;
  }
  const prefix = Number(match[2] || 0);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
  return true;
}

function parseIpv4CidrAllowlist(value = '') {
  const rows = String(value || '')
    .split(',')
    .map((row) => String(row || '').trim())
    .filter(Boolean);
  const uniq = new Set();
  for (const row of rows) {
    if (!isValidIpv4Cidr(row)) continue;
    uniq.add(row);
  }
  return Array.from(uniq).slice(0, 24);
}

function sanitizeMarkHex(value, fallback = '0x6d6') {
  const raw = String(value ?? '').trim().toLowerCase();
  const base = raw || String(fallback || '0x6d6').trim().toLowerCase();
  const parsed = base.startsWith('0x') ? parseInt(base.slice(2), 16) : Number(base);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0xffffffff) return '0x6d6';
  return `0x${Math.floor(parsed).toString(16)}`;
}

function parseJsonObjectLoose(text, fallback = null) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {}
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(raw.slice(first, last + 1));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {}
  }
  return fallback;
}

function parseJsonArrayLoose(text, fallback = []) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {}
  const first = raw.indexOf('[');
  const last = raw.lastIndexOf(']');
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(raw.slice(first, last + 1));
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {}
  }
  return fallback;
}

function parseJsonArrayWithMeta(text, fallback = []) {
  const raw = String(text || '').trim();
  if (!raw) return { rows: fallback, parseMode: 'empty', raw };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { rows: parsed, parseMode: 'json', raw };
    return { rows: fallback, parseMode: 'json-not-array', raw };
  } catch {}
  const first = raw.indexOf('[');
  const last = raw.lastIndexOf(']');
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(raw.slice(first, last + 1));
      if (Array.isArray(parsed)) return { rows: parsed, parseMode: 'embedded-json', raw };
    } catch {}
  }
  return { rows: fallback, parseMode: 'invalid-json', raw };
}

function compactSnippet(text = '', maxLen = 220) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, Number(maxLen || 220)));
}

function sleep(ms = 0) {
  const delay = Math.max(0, Number(ms || 0));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function sanitizePort(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return 8080;
  return Math.floor(n);
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

function bytesToMbps(bytesPerSecond = 0) {
  const n = Number(bytesPerSecond || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / (1024 * 1024);
}

function pickNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function parseKeyValueLines(text = '') {
  const out = {};
  for (const row of String(text || '').split('\n')) {
    const line = row.trim();
    if (!line) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function defaultVpnConfig() {
  return {
    enabled: false,
    provider: 'pia',
    interfaceName: 'piawg0',
    routeTable: 51820,
    markHex: '0x6d6',
    killSwitchEnabled: true,
    requiredForDispatch: true,
    regionId: 'ph',
    regionName: 'Philippines',
    piaUsernameEnc: null,
    piaPasswordEnc: null,
    lastAppliedAt: null,
    lastAppliedOk: null,
    lastAppliedSummary: '',
    lastAppliedError: '',
    lastTestAt: null,
    lastTestOk: null,
    lastTestSummary: '',
    lastError: '',
    lastPublicIp: '',
    lastVpnPublicIp: '',
    lastDownloadTestAt: null,
    lastDownloadTestOk: null,
    lastDownloadTestSummary: '',
    lastDownloadTestResult: null,
  };
}

function normalizeVpnConfig(raw = {}, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const prev = fallback && typeof fallback === 'object' ? fallback : {};
  const merged = { ...defaultVpnConfig(), ...prev, ...source };
  return {
    enabled: Boolean(merged.enabled),
    provider: sanitizeProvider(merged.provider),
    interfaceName: sanitizeInterfaceName(merged.interfaceName),
    routeTable: clampInt(merged.routeTable, { min: 10, max: 999999, fallback: 51820 }),
    markHex: sanitizeMarkHex(merged.markHex, prev.markHex || '0x6d6'),
    killSwitchEnabled: merged.killSwitchEnabled !== false,
    requiredForDispatch: merged.requiredForDispatch !== false,
    regionId: sanitizeRegionId(merged.regionId, prev.regionId || 'ph'),
    regionName: sanitizeRegionName(merged.regionName, prev.regionName || ''),
    piaUsernameEnc: merged.piaUsernameEnc || null,
    piaPasswordEnc: merged.piaPasswordEnc || null,
    lastAppliedAt: Number(merged.lastAppliedAt || 0) || null,
    lastAppliedOk: merged.lastAppliedOk ?? null,
    lastAppliedSummary: String(merged.lastAppliedSummary || ''),
    lastAppliedError: String(merged.lastAppliedError || ''),
    lastTestAt: Number(merged.lastTestAt || 0) || null,
    lastTestOk: merged.lastTestOk ?? null,
    lastTestSummary: String(merged.lastTestSummary || ''),
    lastError: String(merged.lastError || ''),
    lastPublicIp: String(merged.lastPublicIp || ''),
    lastVpnPublicIp: String(merged.lastVpnPublicIp || ''),
    lastDownloadTestAt: Number(merged.lastDownloadTestAt || 0) || null,
    lastDownloadTestOk: merged.lastDownloadTestOk ?? null,
    lastDownloadTestSummary: String(merged.lastDownloadTestSummary || ''),
    lastDownloadTestResult:
      merged.lastDownloadTestResult && typeof merged.lastDownloadTestResult === 'object' ? merged.lastDownloadTestResult : null,
  };
}

function safeUsernamePreview(vpnConfig) {
  if (!vpnConfig?.piaUsernameEnc) return '';
  try {
    const raw = String(decryptString(vpnConfig.piaUsernameEnc) || '').trim();
    if (!raw) return '';
    if (raw.length <= 2) return `${raw[0] || '*'}*`;
    return `${raw.slice(0, 2)}***${raw.slice(-1)}`;
  } catch {
    return '';
  }
}

function toSafeVpn(vpnConfig = {}) {
  const normalized = normalizeVpnConfig(vpnConfig);
  return {
    enabled: normalized.enabled,
    provider: normalized.provider,
    interfaceName: normalized.interfaceName,
    routeTable: normalized.routeTable,
    markHex: normalized.markHex,
    killSwitchEnabled: normalized.killSwitchEnabled,
    requiredForDispatch: normalized.requiredForDispatch,
    regionId: normalized.regionId,
    regionName: normalized.regionName,
    hasCredentials: Boolean(normalized.piaUsernameEnc && normalized.piaPasswordEnc),
    usernamePreview: safeUsernamePreview(normalized),
    lastAppliedAt: normalized.lastAppliedAt,
    lastAppliedOk: normalized.lastAppliedOk,
    lastAppliedSummary: normalized.lastAppliedSummary,
    lastAppliedError: normalized.lastAppliedError,
    lastTestAt: normalized.lastTestAt,
    lastTestOk: normalized.lastTestOk,
    lastTestSummary: normalized.lastTestSummary,
    lastError: normalized.lastError,
    lastPublicIp: normalized.lastPublicIp,
    lastVpnPublicIp: normalized.lastVpnPublicIp,
    lastDownloadTestAt: normalized.lastDownloadTestAt,
    lastDownloadTestOk: normalized.lastDownloadTestOk,
    lastDownloadTestSummary: normalized.lastDownloadTestSummary,
    lastDownloadTestResult: normalized.lastDownloadTestResult,
  };
}

function buildStoredVpnDownloadTestResult({ sourceSelection = null, run = null, runtime = null, summary = '' } = {}) {
  const selection = sourceSelection && typeof sourceSelection === 'object' ? sourceSelection : null;
  const sample = run && typeof run === 'object' ? run : null;
  const runtimeInfo = runtime && typeof runtime === 'object' ? runtime : null;
  return {
    summary: String(summary || '').trim(),
    sourceSelection: selection
      ? {
          minSeedersRequested: Number(selection.minSeedersRequested || 0) || 0,
          title: String(selection.title || '').trim(),
          year: selection.year ?? null,
          tmdbId: selection.tmdbId ?? null,
          releaseDate: String(selection.releaseDate || '').trim(),
          popularity: Number(selection.popularity || 0) || 0,
          provider: String(selection.provider || '').trim(),
          name: String(selection.name || '').trim(),
          seeders: Number(selection.seeders || 0) || 0,
          quality: String(selection.quality || '').trim(),
          sizeGb: selection.sizeGb ?? null,
          domainUsed: String(selection.domainUsed || '').trim(),
          linkType: String(selection.linkType || '').trim(),
        }
      : null,
    run: sample
      ? {
          label: String(sample.label || '').trim(),
          torrentName: String(sample.torrentName || '').trim(),
          durationMs: Number(sample.durationMs || 0) || 0,
          samples: Number(sample.samples || 0) || 0,
          avgDownloadMbps: Number(sample.avgSpeedMbps || 0) || 0,
          peakDownloadMbps: Number(sample.maxSpeedMbps || 0) || 0,
          avgUploadMbps: Number(sample.avgUploadMbps || 0) || 0,
          peakUploadMbps: Number(sample.maxUploadMbps || 0) || 0,
          downloadedMb: Number(sample.downloadedMb || 0) || 0,
          uploadedMb: Number(sample.uploadedMb || 0) || 0,
          finalProgress: Number(sample.finalProgress || 0) || 0,
          finalState: String(sample.finalState || '').trim(),
          finalSeeds: Number(sample.finalSeeds || 0) || 0,
          finalPeers: Number(sample.finalPeers || 0) || 0,
          completed: sample.completed === true,
          states: Array.isArray(sample.states)
            ? sample.states.map((row) => ({
                state: String(row?.state || '').trim(),
                count: Number(row?.count || 0) || 0,
              }))
            : [],
        }
      : null,
    runtime: runtimeInfo
      ? {
          hostIp: String(runtimeInfo.hostIp || '').trim(),
          vpnIp: String(runtimeInfo.vpnIp || '').trim(),
          interfaceName: String(runtimeInfo.interfaceName || runtimeInfo.iface || '').trim(),
          handshakeRecent: runtimeInfo.handshakeRecent === true,
        }
      : null,
  };
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

async function fetchPiaServerCatalog() {
  const res = await fetch(PIA_SERVERLIST_URL, { cache: 'no-store' });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`PIA server list request failed (${res.status}).`);
  }
  const firstJsonLine =
    raw
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('{') && line.endsWith('}')) || '';
  const parsed = parseJsonObjectLoose(firstJsonLine, null);
  if (!parsed || !Array.isArray(parsed.regions)) throw new Error('Invalid PIA server list payload.');
  return parsed;
}

function mapPiaRegion(region) {
  const id = sanitizeRegionId(region?.id || '', '');
  if (!id) return null;
  const wg = (Array.isArray(region?.servers?.wg) ? region.servers.wg : []).find((row) => row?.cn && row?.ip);
  const meta = (Array.isArray(region?.servers?.meta) ? region.servers.meta : []).find((row) => row?.cn && row?.ip);
  if (!wg || !meta) return null;
  const dnsList = Array.isArray(region?.dns)
    ? region.dns.map((x) => String(x || '').trim()).filter(Boolean)
    : region?.dns
      ? [String(region.dns).trim()].filter(Boolean)
      : [];
  return {
    id,
    name: sanitizeRegionName(region?.name || id, id.toUpperCase()),
    country: String(region?.country || '').trim(),
    city: String(region?.geo?.city || '').trim(),
    latitude: Number(region?.geo?.lat || 0) || null,
    longitude: Number(region?.geo?.lng || 0) || null,
    portForward: Boolean(region?.port_forward),
    dnsList,
    wg: {
      cn: String(wg.cn || '').trim(),
      ip: String(wg.ip || '').trim(),
    },
    meta: {
      cn: String(meta.cn || '').trim(),
      ip: String(meta.ip || '').trim(),
    },
  };
}

function choosePiaRegion(allRegions = [], regionId = '') {
  const rows = Array.isArray(allRegions) ? allRegions : [];
  if (!rows.length) return null;
  const wanted = sanitizeRegionId(regionId || '', '');
  if (wanted) {
    const exact = rows.find((row) => row.id === wanted);
    if (exact) return exact;
  }
  const preferredOrder = ['ph', 'sg', 'jp'];
  for (const id of preferredOrder) {
    const row = rows.find((r) => r.id === id);
    if (row) return row;
  }
  return rows[0];
}

async function getVpnConfigAndDb() {
  const db = await getAdminDb();
  const dc = db.autodownloadSettings?.downloadClient || {};
  const vpn = normalizeVpnConfig(dc?.vpn || {}, defaultVpnConfig());
  const serviceUser = sanitizeLinuxAccountName(dc?.serviceUser || 'qbvpn', 'qbvpn');
  return { db, downloadClient: dc, vpn, serviceUser };
}

async function saveVpnConfig({ db, downloadClient, vpn }) {
  db.autodownloadSettings = db.autodownloadSettings || {};
  db.autodownloadSettings.downloadClient = {
    ...(downloadClient || {}),
    vpn: normalizeVpnConfig(vpn || {}, defaultVpnConfig()),
  };
  await saveAdminDb(db);
  return db.autodownloadSettings.downloadClient.vpn;
}

function qbCredentialsFromDownloadClient(downloadClient = {}) {
  const dc = downloadClient && typeof downloadClient === 'object' ? downloadClient : {};
  const username = dc?.usernameEnc ? decryptString(dc.usernameEnc) : String(dc?.username || '').trim();
  const password = dc?.passwordEnc ? decryptString(dc.passwordEnc) : String(dc?.password || '');
  return {
    username: String(username || '').trim(),
    password: String(password || ''),
  };
}

function pickTorrentLinkFromSource(source = {}) {
  const src = source && typeof source === 'object' ? source : {};
  const sourceUrl = String(src?.sourceUrl || '').trim();
  const magnet = String(src?.magnet || '').trim();
  if (magnet && /^magnet:\?/i.test(magnet)) return magnet;
  return sourceUrl || magnet || '';
}

function pickAlternateTorrentLinkFromSource(source = {}, primaryLink = '') {
  const src = source && typeof source === 'object' ? source : {};
  const sourceUrl = String(src?.sourceUrl || '').trim();
  const magnet = String(src?.magnet || '').trim();
  const primary = String(primaryLink || '').trim();
  const candidates = [sourceUrl, magnet].map((row) => String(row || '').trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (!primary) return candidate;
    if (candidate !== primary) return candidate;
  }
  return '';
}

function normalizeTorrentNameForMatch(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeInfoHash(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^a-f0-9]/gi, '')
    .toLowerCase();
}

function isInfoHash(value = '') {
  return normalizeInfoHash(value).length === 40;
}

function extractInfoHashFromTorrentLink(link = '') {
  const raw = String(link || '').trim();
  if (!raw) return '';
  const hashMatch = raw.match(/btih:([a-z0-9]{32,40})/i);
  if (!hashMatch || !hashMatch[1]) return '';
  const maybeHash = normalizeInfoHash(hashMatch[1]);
  return isInfoHash(maybeHash) ? maybeHash : '';
}

function pickBenchmarkTorrentCandidate(
  rows = [],
  {
    beforeHashes = new Set(),
    sourceHash = '',
    titleNeedle = '',
    allowBefore = false,
  } = {}
) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const normalizedSourceHash = normalizeInfoHash(sourceHash);

  const enrich = (row) => {
    const hash = normalizeInfoHash(row?.hash || '');
    const name = String(row?.name || '').trim();
    const normalizedName = normalizeTorrentNameForMatch(name);
    const isNew = hash ? !beforeHashes.has(hash) : false;
    const titleMatch = titleNeedle ? normalizedName.includes(titleNeedle) || titleNeedle.includes(normalizedName) : true;
    return {
      row,
      hash,
      name,
      isNew,
      titleMatch,
      addedOn: Number(row?.added_on || 0) || 0,
    };
  };

  const prepared = list.map(enrich).filter((item) => item.hash);
  if (!prepared.length) return null;

  const bySourceHash = prepared
    .filter((item) => item.hash === normalizedSourceHash && (allowBefore || item.isNew))
    .sort((a, b) => b.addedOn - a.addedOn)[0];
  if (bySourceHash) return bySourceHash;

  const byTitle = prepared
    .filter((item) => item.titleMatch && (allowBefore || item.isNew))
    .sort((a, b) => b.addedOn - a.addedOn)[0];
  if (byTitle) return byTitle;

  const fallback = prepared
    .filter((item) => allowBefore || item.isNew)
    .sort((a, b) => b.addedOn - a.addedOn)[0];
  return fallback || null;
}

async function withQbSession({ ssh, baseUrls = [], username = '', password = '' } = {}, runner) {
  const urls = Array.isArray(baseUrls) ? baseUrls.filter(Boolean) : [];
  if (!urls.length) throw new Error('No qBittorrent API base URL is available.');
  if (!String(username || '').trim() || !String(password || '')) {
    throw new Error('qBittorrent WebUI credentials are missing. Save qBittorrent credentials first.');
  }

  let lastError = '';
  for (const baseUrl of urls) {
    const cookieJar = `/tmp/3jtv_qb_vpn_bench_${crypto.randomUUID().replace(/-/g, '')}.txt`;
    const referer = `Referer: ${baseUrl}`;
    try {
      const loginCmd =
        `curl -sS -m 25 -H ${shQuote(referer)} -c ${shQuote(cookieJar)} ` +
        `--data-urlencode ${shQuote(`username=${username}`)} ` +
        `--data-urlencode ${shQuote(`password=${password}`)} ` +
        `${shQuote(`${baseUrl}/api/v2/auth/login`)}`;
      const login = await ssh.exec(loginCmd, { timeoutMs: 30000 });
      const loginOk = Number(login?.code) === 0 && /^ok\.?$/i.test(String(login?.stdout || '').trim());
      if (!loginOk) {
        const msg = String(login?.stderr || login?.stdout || '').trim();
        throw new Error(msg || `qBittorrent login failed at ${baseUrl}.`);
      }

      const run = async ({ method = 'GET', path = '', form = null, timeoutMs = 30000 } = {}) => {
        const relPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;
        const url = `${baseUrl}${relPath}`;
        const upperMethod = String(method || 'GET').trim().toUpperCase();
        const payload = form && typeof form === 'object' ? form : null;
        const formArgs = payload
          ? Object.entries(payload)
              .filter(([, value]) => value !== undefined && value !== null)
              .map(([key, value]) => `--data-urlencode ${shQuote(`${key}=${String(value)}`)}`)
              .join(' ')
          : '';
        const methodArg = upperMethod === 'GET' ? '' : `-X ${shQuote(upperMethod)}`;
        const marker = '__3JTV_HTTP_STATUS__';
        const cmd =
          `curl -sS -m 25 ${methodArg} -H ${shQuote(referer)} -b ${shQuote(cookieJar)} ` +
          `${formArgs} -w '\\n${marker}:%{http_code}' ${shQuote(url)}`;
        const res = await ssh.exec(cmd, { timeoutMs });
        if (Number(res?.code) !== 0) {
          const msg = String(res?.stderr || res?.stdout || '').trim();
          throw new Error(msg || `qBittorrent request failed (${upperMethod} ${relPath}).`);
        }
        const raw = String(res?.stdout || '');
        const markerNeedle = `\n${marker}:`;
        const markerIndex = raw.lastIndexOf(markerNeedle);
        const body = markerIndex >= 0 ? raw.slice(0, markerIndex) : raw;
        const statusRaw = markerIndex >= 0 ? raw.slice(markerIndex + markerNeedle.length).trim() : '';
        const httpCode = Number(statusRaw || 0) || 0;
        if (httpCode && (httpCode < 200 || httpCode >= 300)) {
          throw new Error(
            `qBittorrent API HTTP ${httpCode} (${upperMethod} ${relPath}). Response: ${compactSnippet(body, 320) || 'empty'}`
          );
        }
        const bodyTrim = String(body || '').trim();
        if (bodyTrim && /^fails\.?$/i.test(bodyTrim)) {
          throw new Error(`qBittorrent API returned auth failure (${upperMethod} ${relPath}).`);
        }
        return body;
      };

      return await runner({ baseUrl, run });
    } catch (e) {
      lastError = e?.message || String(e || '');
    } finally {
      await ssh.exec(`rm -f ${shQuote(cookieJar)} >/dev/null 2>&1 || true`, { timeoutMs: 8000 }).catch(() => null);
    }
  }
  throw new Error(lastError || 'Unable to open qBittorrent WebUI session.');
}

function isBenchmarkTorrentRow(row = {}) {
  const category = String(row?.category || '').trim();
  const savePath = String(row?.save_path || row?.savePath || '').trim();
  return (
    category === QB_BENCHMARK_CATEGORY ||
    savePath === QB_BENCHMARK_SAVEPATH ||
    savePath.startsWith(`${QB_BENCHMARK_SAVEPATH}/`)
  );
}

async function cleanupBenchmarkTorrents({
  ssh,
  baseUrls = [],
  username = '',
  password = '',
} = {}) {
  return withQbSession({ ssh, baseUrls, username, password }, async ({ run }) => {
    const allText = await run({ path: '/api/v2/torrents/info?filter=all' });
    const allRows = parseJsonArrayLoose(allText, []);
    const cleanupHashes = new Set();
    for (const row of allRows) {
      if (!isBenchmarkTorrentRow(row)) continue;
      const hash = normalizeInfoHash(row?.hash || '');
      if (hash) cleanupHashes.add(hash);
    }
    if (!cleanupHashes.size) return { deletedCount: 0 };
    await run({
      method: 'POST',
      path: '/api/v2/torrents/delete',
      form: {
        hashes: Array.from(cleanupHashes).join('|'),
        deleteFiles: 'true',
      },
    });
    await sleep(1200);
    return { deletedCount: cleanupHashes.size };
  });
}

async function selectBenchmarkMovieSource({
  minSeeders = 20,
  minSizeGb = 0.5,
  maxSizeGb = 1.0,
  reasonLabel = 'VPN comparison',
  excludeSourceKeys = new Set(),
} = {}) {
  const seedThreshold = Math.max(1, Number(minSeeders || 0) || 1);
  const minSize = Math.max(0.1, Number(minSizeGb || 0.5) || 0.5);
  const maxSize = Math.max(minSize, Number(maxSizeGb || 1.0) || 1.0);
  const reason = String(reasonLabel || 'VPN comparison').trim() || 'VPN comparison';
  const today = new Date();
  const start = new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000);
  const dateGte = start.toISOString().slice(0, 10);
  const dateLte = today.toISOString().slice(0, 10);

  const pagesToTry = [1, 2];
  const candidates = [];
  for (const page of pagesToTry) {
    const discovered = await discoverMovies({
      params: {
        page,
        'primary_release_date.gte': dateGte,
        'primary_release_date.lte': dateLte,
      },
    }).catch(() => ({ ok: false, results: [] }));
    if (!discovered?.ok) continue;
    const rows = Array.isArray(discovered.results) ? discovered.results : [];
    for (const row of rows) {
      const tmdbId = Number(row?.id || 0);
      const title = String(row?.title || '').trim();
      const releaseDate = String(row?.release_date || '').trim();
      const year = Number(String(releaseDate).slice(0, 4)) || null;
      if (!tmdbId || !title || !year) continue;
      candidates.push({
        tmdbId,
        title,
        year,
        releaseDate,
        popularity: Number(row?.popularity || 0) || 0,
      });
      if (candidates.length >= 12) break;
    }
    if (candidates.length >= 12) break;
  }
  if (!candidates.length) throw new Error('Unable to fetch latest popular movie candidates from TMDB.');

  for (const candidate of candidates) {
    const sourceSearch = await searchBestDownloadSource({
      query: candidate.title,
      year: candidate.year,
      type: 'movie',
      stopOnFirstValid: true,
      minSeeders: seedThreshold,
      minSizeGb: minSize,
      maxSizeGb: maxSize,
    }).catch(() => ({ ok: false, selected: null }));
    const selected = sourceSearch?.selected && typeof sourceSearch.selected === 'object' ? sourceSearch.selected : null;
    const link = pickTorrentLinkFromSource(selected);
    if (!selected || !link) continue;
    const seeders = Math.max(0, Math.floor(Number(selected?.seeders || 0) || 0));
    if (seeders < seedThreshold) continue;
    const sourceKey =
      `${String(candidate.tmdbId || '')}:` +
      (normalizeInfoHash(selected?.hash || '') || normalizeTorrentNameForMatch(selected?.name || link));
    if (excludeSourceKeys instanceof Set && sourceKey && excludeSourceKeys.has(sourceKey)) continue;
    return {
      movie: candidate,
      source: selected,
      link,
      sourceKey,
      minSeedersUsed: seedThreshold,
    };
  }

  throw new Error(
    `No suitable movie source found for ${reason} (required: high seeders, size ${minSize.toFixed(1)}GB to ${maxSize.toFixed(1)}GB).`
  );
}

async function runQbScenarioSample({
  ssh,
  baseUrls = [],
  username = '',
  password = '',
  link = '',
  alternateLink = '',
  sourceHash = '',
  sourceName = '',
  sourceTitle = '',
  mode = 'vpn_on',
  maxRunMinutes = 25,
  onProgress = null,
} = {}) {
  const scenarioLabel = mode === 'vpn_off' ? 'No VPN' : 'VPN';
  const linkValue = String(link || '').trim();
  const alternateLinkValue = String(alternateLink || '').trim();
  if (!linkValue) throw new Error(`${scenarioLabel} scenario is missing torrent link.`);
  const maxDurationMinutes = Math.max(3, Math.min(120, Math.floor(Number(maxRunMinutes || 0) || 25)));
  const timeoutMs = maxDurationMinutes * 60 * 1000;
  const sourceHashNormalized =
    normalizeInfoHash(sourceHash) || extractInfoHashFromTorrentLink(linkValue) || extractInfoHashFromTorrentLink(alternateLinkValue);
  const sourceHashApi = sourceHashNormalized ? sourceHashNormalized : '';
  const titleNeedle = normalizeTorrentNameForMatch(sourceTitle || sourceName);

  return withQbSession({ ssh, baseUrls, username, password }, async ({ run }) => {
    const cleanupBefore = async () => {
      const byCategoryText = await run({
        path: `/api/v2/torrents/info?filter=all&category=${encodeURIComponent(QB_BENCHMARK_CATEGORY)}`,
      });
      const categoryRows = parseJsonArrayLoose(byCategoryText, []);
      const cleanupHashes = new Set();
      for (const row of categoryRows) {
        const hash = normalizeInfoHash(row?.hash || '');
        if (hash) cleanupHashes.add(hash);
      }
      if (!cleanupHashes.size) return;
      await run({
        method: 'POST',
        path: '/api/v2/torrents/delete',
        form: {
          hashes: Array.from(cleanupHashes).join('|'),
          deleteFiles: 'true',
        },
      });
      await sleep(1200);
    };

    await cleanupBefore();

    const listBeforeText = await run({
      path: `/api/v2/torrents/info?filter=all&category=${encodeURIComponent(QB_BENCHMARK_CATEGORY)}`,
    });
    const beforeRows = parseJsonArrayLoose(listBeforeText, []);
    const beforeHashes = new Set(beforeRows.map((row) => normalizeInfoHash(row?.hash || '')).filter(Boolean));

    const addBenchmarkTorrent = async (torrentLink) => {
      const addText = await run({
        method: 'POST',
        path: '/api/v2/torrents/add',
        form: {
          urls: torrentLink,
          category: QB_BENCHMARK_CATEGORY,
          savepath: QB_BENCHMARK_SAVEPATH,
          paused: 'false',
          autoTMM: 'false',
        },
        timeoutMs: 40000,
      });
      const addReply = String(addText || '').trim().toLowerCase();
      if (addReply && !addReply.startsWith('ok')) {
        throw new Error(`${scenarioLabel}: qBittorrent rejected benchmark add (${String(addText || '').trim()}).`);
      }
      return addReply || '(empty)';
    };

    const waitForBenchmarkHash = async () => {
      let hash = '';
      let name = '';
      let categoryRows = [];
      let allRows = [];
      let categoryParseMode = 'empty';
      let allParseMode = 'empty';
      let categoryRaw = '';
      let allRaw = '';
      const waitDeadline = now() + 50000;
      while (!hash && now() < waitDeadline) {
        await sleep(1500);
        const categoryText = await run({
          path: `/api/v2/torrents/info?filter=all&category=${encodeURIComponent(QB_BENCHMARK_CATEGORY)}`,
        });
        const parsedCategory = parseJsonArrayWithMeta(categoryText, []);
        categoryRows = parsedCategory.rows;
        categoryParseMode = parsedCategory.parseMode;
        categoryRaw = compactSnippet(parsedCategory.raw || categoryText, 340);

        let picked = pickBenchmarkTorrentCandidate(categoryRows, {
          beforeHashes,
          sourceHash: sourceHashNormalized,
          titleNeedle,
          allowBefore: false,
        });

        if (!picked) {
          const allText = await run({ path: '/api/v2/torrents/info?filter=all' });
          const parsedAll = parseJsonArrayWithMeta(allText, []);
          allRows = parsedAll.rows;
          allParseMode = parsedAll.parseMode;
          allRaw = compactSnippet(parsedAll.raw || allText, 340);
          picked = pickBenchmarkTorrentCandidate(allRows, {
            beforeHashes,
            sourceHash: sourceHashNormalized,
            titleNeedle,
            allowBefore: true,
          });
        }

        if (picked?.hash) {
          hash = picked.hash;
          name = picked.name || '';
          try {
            await run({
              method: 'POST',
              path: '/api/v2/torrents/setCategory',
              form: {
                hashes: hash,
                category: QB_BENCHMARK_CATEGORY,
              },
            });
          } catch {}
          try {
            await run({
              method: 'POST',
              path: '/api/v2/torrents/resume',
              form: {
                hashes: hash,
              },
            });
          } catch {}
          break;
        }
      }
      return {
        hash,
        name,
        categoryRows,
        allRows,
        categoryParseMode,
        allParseMode,
        categoryRaw,
        allRaw,
      };
    };

    const addReply = await addBenchmarkTorrent(linkValue);
    let addReplyRetry = '';
    let linkUsed = linkValue;
    let linkRetryType = '';
    let detect = await waitForBenchmarkHash();
    let benchmarkHash = detect.hash || '';
    let benchmarkName = detect.name || '';
    let lastCategoryRows = detect.categoryRows || [];
    let lastAllRows = detect.allRows || [];
    let lastCategoryParseMode = detect.categoryParseMode || 'empty';
    let lastAllParseMode = detect.allParseMode || 'empty';
    let lastCategoryRaw = detect.categoryRaw || '';
    let lastAllRaw = detect.allRaw || '';

    const useAlternate = Boolean(alternateLinkValue && alternateLinkValue !== linkValue);
    if (!benchmarkHash && useAlternate) {
      addReplyRetry = await addBenchmarkTorrent(alternateLinkValue);
      linkUsed = alternateLinkValue;
      linkRetryType = alternateLinkValue.toLowerCase().startsWith('magnet:') ? 'magnet' : 'torrent';
      detect = await waitForBenchmarkHash();
      benchmarkHash = detect.hash || '';
      benchmarkName = detect.name || '';
      lastCategoryRows = detect.categoryRows || [];
      lastAllRows = detect.allRows || [];
      lastCategoryParseMode = detect.categoryParseMode || 'empty';
      lastAllParseMode = detect.allParseMode || 'empty';
      lastCategoryRaw = detect.categoryRaw || '';
      lastAllRaw = detect.allRaw || '';
    }

    if (!benchmarkHash) {
      if (isInfoHash(sourceHashNormalized)) {
        const verifyText = await run({
          path: `/api/v2/torrents/info?hashes=${encodeURIComponent(sourceHashApi || sourceHashNormalized)}`,
        });
        const rows = parseJsonArrayLoose(verifyText, []);
        const row = rows.find((entry) => normalizeInfoHash(entry?.hash || '') === sourceHashNormalized);
        if (row?.hash) {
          benchmarkHash = normalizeInfoHash(row.hash || '');
          benchmarkName = String(row?.name || '').trim();
        }
      }
    }

    if (!benchmarkHash) {
      const categorySample = (Array.isArray(lastCategoryRows) ? lastCategoryRows : [])
        .slice(0, 4)
        .map((row) => `${String(row?.name || '').trim() || '(no-name)'} [${normalizeInfoHash(row?.hash || '').toUpperCase() || 'NOHASH'}]`)
        .join(' | ');
      const allSample = (Array.isArray(lastAllRows) ? lastAllRows : [])
        .slice(0, 4)
        .map((row) => `${String(row?.name || '').trim() || '(no-name)'} [${normalizeInfoHash(row?.hash || '').toUpperCase() || 'NOHASH'}]`)
        .join(' | ');
      const debug = [
        `addReply=${addReply || '(empty)'}`,
        `addRetry=${addReplyRetry || 'not_used'}`,
        `sourceHash=${sourceHashApi || 'N/A'}`,
        `beforeCategory=${beforeRows.length}`,
        `linkCategory=${Array.isArray(lastCategoryRows) ? lastCategoryRows.length : 0}`,
        `linkAlt=${Array.isArray(lastAllRows) ? lastAllRows.length : 0}`,
        `categoryParse=${lastCategoryParseMode || 'unknown'}`,
        `allParse=${lastAllParseMode || 'unknown'}`,
        `titleNeedle=${titleNeedle || 'N/A'}`,
        `linkType=${linkValue.toLowerCase().startsWith('magnet:') ? 'magnet' : 'torrent'}`,
        `retryType=${linkRetryType || 'n/a'}`,
        `linkUsedType=${linkUsed.toLowerCase().startsWith('magnet:') ? 'magnet' : 'torrent'}`,
        `categorySample=${categorySample || 'none'}`,
        `altSample=${allSample || 'none'}`,
        `categoryRaw=${lastCategoryRaw || 'empty'}`,
        `allRaw=${lastAllRaw || 'empty'}`,
      ].join('; ');
      throw new Error(`${scenarioLabel}: benchmark torrent hash was not detected in qBittorrent. Debug: ${debug}`);
    }

    const benchmarkHashApi = benchmarkHash;

    const pollIntervalMs = 2000;
    const completedStates = new Set(['uploading', 'stalledup', 'pausedup', 'queuedup', 'forcedup', 'checkingup']);
    let maxSpeed = 0;
    let speedSum = 0;
    let speedSamples = 0;
    let maxUploadSpeed = 0;
    let uploadSpeedSum = 0;
    let uploadSpeedSamples = 0;
    let downloadedStart = null;
    let downloadedEnd = null;
    let uploadedStart = null;
    let uploadedEnd = null;
    let progress = 0;
    let lastState = 'unknown';
    let lastAmountLeft = null;
    let lastSpeed = 0;
    let lastUploadSpeed = 0;
    let lastSeeds = 0;
    let lastPeers = 0;
    let missingPolls = 0;
    let metadataStuckPolls = 0;
    let noPeerStuckPolls = 0;
    let completed = false;
    const stateCounts = {};
    const startedAt = now();
    const deadline = startedAt + timeoutMs;
    const reportProgress = (patch = {}) => {
      if (typeof onProgress !== 'function') return;
      try {
        onProgress({
          mode: mode === 'vpn_off' ? 'vpn_off' : 'vpn_on',
          label: scenarioLabel,
          ...patch,
        });
      } catch {}
    };

    try {
      reportProgress({
        stage: 'starting',
        phaseLabel: `${scenarioLabel}: adding torrent`,
        progress: 0,
      });
      while (now() < deadline) {
        const infoText = await run({
          path: `/api/v2/torrents/info?hashes=${encodeURIComponent(benchmarkHashApi)}`,
        });
        const rows = parseJsonArrayLoose(infoText, []);
        const row = rows.find((entry) => normalizeInfoHash(entry?.hash || '') === benchmarkHash) || rows[0] || null;

        if (!row || !row?.hash) {
          missingPolls += 1;
          if (missingPolls >= 4) {
            const catText = await run({
              path: `/api/v2/torrents/info?filter=all&category=${encodeURIComponent(QB_BENCHMARK_CATEGORY)}`,
            });
            const catRows = parseJsonArrayLoose(catText, []);
            const catSample = catRows
              .slice(0, 4)
              .map((entry) => `${String(entry?.name || '').trim() || '(no-name)'} [${normalizeInfoHash(entry?.hash || '').toUpperCase() || 'NOHASH'}]`)
              .join(' | ');
            throw new Error(
              `${scenarioLabel}: benchmark torrent disappeared during run. hash=${benchmarkHashApi}; categoryRows=${catRows.length}; categorySample=${catSample || 'none'}`
            );
          }
          await sleep(pollIntervalMs);
          continue;
        }

        missingPolls = 0;
        const speed = Math.max(0, Math.floor(pickNumber(row?.dlspeed, 0)));
        const downloaded = Math.max(
          0,
          Math.floor(pickNumber(row?.downloaded_session, row?.downloaded, row?.completed, row?.total_downloaded, 0))
        );
        progress = Math.max(0, Number(row?.progress || 0) || 0);
        lastState = String(row?.state || '').trim().toLowerCase() || 'unknown';
        lastSpeed = speed;
        lastUploadSpeed = Math.max(0, Math.floor(pickNumber(row?.upspeed, 0)));
        lastSeeds = Math.max(0, Math.floor(pickNumber(row?.num_seeds, row?.seeds, row?.num_complete, 0)));
        lastPeers = Math.max(0, Math.floor(pickNumber(row?.num_leechs, row?.num_incomplete, row?.peers, 0)));
        const uploaded = Math.max(0, Math.floor(pickNumber(row?.uploaded_session, row?.uploaded, row?.total_uploaded, 0)));
        const totalSize = Math.max(0, Math.floor(pickNumber(row?.total_size, row?.size, 0)));
        const amountLeftRaw = Math.floor(pickNumber(row?.amount_left, totalSize > 0 ? totalSize - downloaded : 0, 0));
        lastAmountLeft = Math.max(0, amountLeftRaw);
        stateCounts[lastState] = Number(stateCounts[lastState] || 0) + 1;
        const progressPercent = Math.max(0, Math.min(100, Math.round(progress * 10000) / 100));

        if (downloadedStart === null) downloadedStart = downloaded;
        downloadedEnd = downloaded;
        if (uploadedStart === null) uploadedStart = uploaded;
        uploadedEnd = uploaded;
        maxSpeed = Math.max(maxSpeed, speed);
        speedSum += speed;
        speedSamples += 1;
        maxUploadSpeed = Math.max(maxUploadSpeed, lastUploadSpeed);
        uploadSpeedSum += lastUploadSpeed;
        uploadSpeedSamples += 1;
        reportProgress({
          stage: 'downloading',
          phaseLabel: `${scenarioLabel}: downloading`,
          progress: progressPercent,
          state: lastState,
          speedBps: speed,
          speedMbps: Number(bytesToMbps(speed).toFixed(3)),
          uploadSpeedBps: lastUploadSpeed,
          uploadSpeedMbps: Number(bytesToMbps(lastUploadSpeed).toFixed(3)),
          seeds: lastSeeds,
          peers: lastPeers,
          downloadedBytes: downloaded,
          downloadedMb: Number((downloaded / (1024 * 1024)).toFixed(2)),
          uploadedBytes: uploaded,
          uploadedMb: Number((uploaded / (1024 * 1024)).toFixed(2)),
          totalSizeBytes: totalSize,
          totalSizeMb: Number((totalSize / (1024 * 1024)).toFixed(2)),
          torrentName: benchmarkName || sourceName || '',
        });

        const hasSizeMetadata = totalSize > 0;
        const doneByProgress = hasSizeMetadata && progress >= 0.999;
        const doneByLeft = hasSizeMetadata && Number.isFinite(Number(lastAmountLeft)) ? Number(lastAmountLeft) <= 0 : false;
        const doneByState = hasSizeMetadata && completedStates.has(lastState);
        if (doneByProgress || doneByLeft || doneByState) {
          completed = true;
          break;
        }

        const metadataState = lastState.includes('meta');
        if (metadataState && progress <= 0.0001 && speed <= 0) {
          metadataStuckPolls += 1;
          if (metadataStuckPolls >= 30) {
            throw new Error(
              `${scenarioLabel}: torrent stuck in metadata phase for ~${Math.round((metadataStuckPolls * pollIntervalMs) / 1000)}s. hash=${benchmarkHashApi}; state=${lastState}; seeds=${lastSeeds}; peers=${lastPeers}`
            );
          }
        } else {
          metadataStuckPolls = 0;
        }

        const noPeerState = lastSeeds <= 0 && lastPeers <= 0 && speed <= 0 && progress <= 0.001;
        if (noPeerState) {
          noPeerStuckPolls += 1;
          if (noPeerStuckPolls >= 45) {
            throw new Error(
              `${scenarioLabel}: no peers/seeds for ~${Math.round((noPeerStuckPolls * pollIntervalMs) / 1000)}s. hash=${benchmarkHashApi}; state=${lastState}; seeds=${lastSeeds}; peers=${lastPeers}`
            );
          }
        } else {
          noPeerStuckPolls = 0;
        }

        await sleep(pollIntervalMs);
      }

      const endedAt = now();
      const downloadedBytes = Math.max(0, Number(downloadedEnd || 0) - Number(downloadedStart || 0));
      const uploadedBytes = Math.max(0, Number(uploadedEnd || 0) - Number(uploadedStart || 0));
      const avgSpeed = speedSamples > 0 ? Math.round(speedSum / speedSamples) : 0;
      const avgUploadSpeed = uploadSpeedSamples > 0 ? Math.round(uploadSpeedSum / uploadSpeedSamples) : 0;

      if (!completed) {
        throw new Error(
          `${scenarioLabel}: torrent did not complete within ${maxDurationMinutes} minute(s). hash=${benchmarkHashApi}; state=${lastState || 'unknown'}; progress=${(
            progress * 100
          ).toFixed(2)}%; amountLeft=${lastAmountLeft ?? 'unknown'}; dlspeed=${lastSpeed}; seeds=${lastSeeds}; peers=${lastPeers}`
        );
      }

      if (downloadedBytes <= 0) {
        throw new Error(
          `${scenarioLabel}: no payload was downloaded during benchmark run. hash=${benchmarkHashApi}; state=${lastState || 'unknown'}; progress=${(
            progress * 100
          ).toFixed(2)}%; amountLeft=${lastAmountLeft ?? 'unknown'}; seeds=${lastSeeds}; peers=${lastPeers}`
        );
      }

      return {
        mode: mode === 'vpn_off' ? 'vpn_off' : 'vpn_on',
        label: scenarioLabel,
        hash: benchmarkHash,
        torrentName: benchmarkName || sourceName || '',
        durationMs: Math.max(0, endedAt - startedAt),
        samples: speedSamples,
        avgSpeedBps: avgSpeed,
        maxSpeedBps: maxSpeed,
        avgSpeedMbps: Number(bytesToMbps(avgSpeed).toFixed(3)),
        maxSpeedMbps: Number(bytesToMbps(maxSpeed).toFixed(3)),
        avgUploadBps: avgUploadSpeed,
        maxUploadBps: maxUploadSpeed,
        avgUploadMbps: Number(bytesToMbps(avgUploadSpeed).toFixed(3)),
        maxUploadMbps: Number(bytesToMbps(maxUploadSpeed).toFixed(3)),
        downloadedBytes,
        downloadedMb: Number((downloadedBytes / (1024 * 1024)).toFixed(2)),
        uploadedBytes,
        uploadedMb: Number((uploadedBytes / (1024 * 1024)).toFixed(2)),
        finalProgress: Number(progress.toFixed(4)),
        finalState: lastState,
        finalSeeds: lastSeeds,
        finalPeers: lastPeers,
        completed: true,
        states: Object.entries(stateCounts)
          .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
          .map(([state, count]) => ({ state, count })),
      };
    } finally {
      reportProgress({
        stage: 'cleanup',
        phaseLabel: `${scenarioLabel}: cleaning benchmark torrent`,
        progress: 100,
      });
      await run({
        method: 'POST',
        path: '/api/v2/torrents/delete',
        form: {
          hashes: benchmarkHashApi,
          deleteFiles: 'true',
        },
      }).catch(() => null);
      await sleep(1000);
    }
  });
}

async function ensureRemoteVpnPrerequisites(ssh) {
  const script = `
set -euo pipefail
need_pkg=0
for b in wg ip iptables curl; do
  command -v "$b" >/dev/null 2>&1 || need_pkg=1
done
if [ "$need_pkg" -eq 1 ]; then
  export DEBIAN_FRONTEND=noninteractive
  if command -v apt-get >/dev/null 2>&1; then
    apt-get -y -o Dpkg::Use-Pty=0 update
    apt-get -y -o Dpkg::Use-Pty=0 install wireguard-tools iptables iproute2 curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y wireguard-tools iptables iproute curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y wireguard-tools iptables iproute curl ca-certificates
  else
    echo "No supported package manager found for VPN prerequisites."
    exit 2
  fi
fi
command -v wg >/dev/null 2>&1
command -v ip >/dev/null 2>&1
command -v iptables >/dev/null 2>&1
command -v curl >/dev/null 2>&1
echo "OK"
`;
  const res = await ssh.execScript(script, { sudo: true, timeoutMs: 300000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'Failed to install VPN prerequisites on Engine Host.');
  }
}

async function generateWireguardKeypair(ssh) {
  const script = `
set -euo pipefail
PRIV="$(wg genkey)"
PUB="$(printf '%s' "$PRIV" | wg pubkey)"
printf 'private_key=%s\\npublic_key=%s\\n' "$PRIV" "$PUB"
`;
  const res = await ssh.execScript(script, { sudo: true, timeoutMs: 90000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'Failed to generate WireGuard keypair.');
  }
  const parsed = parseKeyValueLines(res?.stdout || '');
  const privateKey = String(parsed?.private_key || '').trim();
  const publicKey = String(parsed?.public_key || '').trim();
  if (!privateKey || !publicKey) throw new Error('WireGuard keypair generation returned empty keys.');
  return { privateKey, publicKey };
}

async function createPiaToken({ username, password }) {
  const sanitizedUsername = String(username || '').trim();
  const sanitizedPassword = String(password || '').replace(/[\r\n]+/g, '');
  if (!sanitizedUsername || !sanitizedPassword) throw new Error('PIA credentials are required.');
  if (sanitizedUsername.includes('@')) {
    throw new Error('PIA login failed. Use your PIA VPN username (not email) from the PIA Client Control Panel.');
  }

  const parseTokenResponse = async (res, mode) => {
    const raw = await res.text();
    const parsed = parseJsonObjectLoose(raw, {});
    if (!res.ok) {
      const message = String(parsed?.message || parsed?.error || raw || '').trim();
      throw new Error(`${mode}: ${message || `PIA token request failed (${res.status}).`}`);
    }
    const token = String(parsed?.token || '').trim();
    if (!token) {
      const message = String(parsed?.message || parsed?.error || '').trim();
      throw new Error(`${mode}: ${message || 'PIA token request succeeded but token is missing.'}`);
    }
    return token;
  };

  const failures = [];
  try {
    const multipart = new FormData();
    multipart.set('username', sanitizedUsername);
    multipart.set('password', sanitizedPassword);
    const multipartRes = await fetch(PIA_TOKEN_URL, {
      method: 'POST',
      body: multipart,
      cache: 'no-store',
    });
    return await parseTokenResponse(multipartRes, 'multipart');
  } catch (multipartError) {
    failures.push(String(multipartError?.message || 'multipart auth failed'));
  }

  try {
    const jsonRes = await fetch(PIA_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: sanitizedUsername, password: sanitizedPassword }),
      cache: 'no-store',
    });
    return await parseTokenResponse(jsonRes, 'json');
  } catch (jsonError) {
    failures.push(String(jsonError?.message || 'json auth failed'));
  }

  try {
    const body = new URLSearchParams();
    body.set('username', sanitizedUsername);
    body.set('password', sanitizedPassword);
    const res = await fetch(PIA_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
    });
    return await parseTokenResponse(res, 'urlencoded');
  } catch (urlEncodedError) {
    failures.push(String(urlEncodedError?.message || 'urlencoded auth failed'));
    const combined = failures.join(' | ');
    if (/access denied|login failed|invalid|unauthorized|auth/i.test(combined)) {
      throw new Error(
        `PIA login failed. Use your PIA VPN username and password from PIA Client Control Panel (manual connection credentials, not email login). Diagnostics: ${combined}`
      );
    }
    throw new Error(combined || 'PIA login failed.');
  }
}

async function requestPiaAddKeyViaEngine({
  ssh,
  token,
  publicKey,
  region,
}) {
  const connectTo = `${region?.wg?.cn || ''}::${region?.wg?.ip || ''}:`;
  const url = `https://${region?.wg?.cn || ''}:1337/addKey`;
  const cmd = [
    'curl',
    '-ksS',
    '--max-time',
    '45',
    '--request',
    'GET',
    '-G',
    '--connect-to',
    connectTo,
    '--data-urlencode',
    `pt=${token}`,
    '--data-urlencode',
    `pubkey=${publicKey}`,
    url,
  ]
    .map(shQuote)
    .join(' ');
  const res = await ssh.exec(cmd, { timeoutMs: 80000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'PIA addKey request failed from Engine Host.');
  }
  const parsed = parseJsonObjectLoose(res?.stdout || '', null);
  if (!parsed || typeof parsed !== 'object') throw new Error('PIA addKey returned invalid payload.');
  const status = String(parsed?.status || '').trim().toUpperCase();
  if (status !== 'OK') {
    const msg = String(parsed?.message || parsed?.error || '').trim();
    const diag = String(res?.stdout || '').trim().slice(0, 400);
    throw new Error(`PIA addKey failed (${status || 'UNKNOWN'}): ${msg || 'No message.'}${diag ? ` Raw: ${diag}` : ''}`);
  }
  return parsed;
}

async function applyVpnOnEngine({
  ssh,
  vpn,
  region,
  privateKey,
  addKeyResponse,
  serviceUser = 'qbvpn',
  allowLanCidrs = [],
}) {
  const interfaceName = sanitizeInterfaceName(vpn.interfaceName);
  const table = clampInt(vpn.routeTable, { min: 10, max: 999999, fallback: 51820 });
  const markHex = sanitizeMarkHex(vpn.markHex, '0x6d6');
  const defaultLanBypassCidrs = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  const lanCidrsSet = new Set(defaultLanBypassCidrs);
  if (Array.isArray(allowLanCidrs)) {
    for (const row of allowLanCidrs) {
      const cidr = String(row || '').trim();
      if (!isValidIpv4Cidr(cidr)) continue;
      lanCidrsSet.add(cidr);
    }
  }
  const lanCidrs = Array.from(lanCidrsSet);
  const endpointIp = String(region?.wg?.ip || '').trim();
  const endpointPort = Number(addKeyResponse?.server_port || 1337) || 1337;
  const peerPublicKey = String(addKeyResponse?.server_key || '').trim();
  const peerIpRaw = String(addKeyResponse?.peer_ip || '').trim();
  const peerIp = peerIpRaw.includes('/') ? peerIpRaw : `${peerIpRaw}/32`;
  const dnsServer = String((Array.isArray(region?.dnsList) ? region.dnsList[0] : '') || '').trim() || '10.0.0.241';
  if (!endpointIp || !peerPublicKey || !peerIpRaw) throw new Error('PIA addKey response is missing endpoint fields.');

  const script = `
set -euo pipefail
IFACE=${JSON.stringify(interfaceName)}
TABLE=${JSON.stringify(String(table))}
MARK_HEX=${JSON.stringify(markHex)}
ENDPOINT_IP=${JSON.stringify(endpointIp)}
ENDPOINT_PORT=${JSON.stringify(String(endpointPort))}
PRIVATE_KEY=${JSON.stringify(privateKey)}
PEER_PUBLIC_KEY=${JSON.stringify(peerPublicKey)}
PEER_IP=${JSON.stringify(peerIp)}
DNS_SERVER=${JSON.stringify(dnsServer)}
MARK_CHAIN=${JSON.stringify(VPN_MARK_CHAIN)}
KILLSWITCH_CHAIN=${JSON.stringify(VPN_KILLSWITCH_CHAIN)}
QBIT_SYS_USER=${JSON.stringify(sanitizeLinuxAccountName(serviceUser, 'qbvpn'))}
ALLOW_LAN_CIDRS=${JSON.stringify(lanCidrs.join(' '))}

WG_CONF="/etc/wireguard/$IFACE.conf"
install -d -m 700 /etc/wireguard

if ! id -u "$QBIT_SYS_USER" >/dev/null 2>&1; then
  if ! getent group "$QBIT_SYS_USER" >/dev/null 2>&1; then
    groupadd --system "$QBIT_SYS_USER"
  fi
  useradd --system --home "/home/$QBIT_SYS_USER" --create-home --shell /usr/sbin/nologin -g "$QBIT_SYS_USER" "$QBIT_SYS_USER" >/dev/null 2>&1 || true
fi
QBIT_UID="$(id -u "$QBIT_SYS_USER")"

DEFAULT_LINE="$(ip -4 route show default | head -n1 || true)"
DEFAULT_GW="$(printf '%s' "$DEFAULT_LINE" | awk '{for(i=1;i<=NF;i++){if($i=="via"){print $(i+1);exit}}}')"
DEFAULT_DEV="$(printf '%s' "$DEFAULT_LINE" | awk '{for(i=1;i<=NF;i++){if($i=="dev"){print $(i+1);exit}}}')"
if [ -z "$DEFAULT_DEV" ]; then
  echo "Unable to detect default route device."
  exit 2
fi

cat > "$WG_CONF" <<EOF
[Interface]
Address = $PEER_IP
PrivateKey = $PRIVATE_KEY
DNS = $DNS_SERVER
Table = off
MTU = 1420

[Peer]
PublicKey = $PEER_PUBLIC_KEY
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = $ENDPOINT_IP:$ENDPOINT_PORT
PersistentKeepalive = 25
EOF
chmod 600 "$WG_CONF"

while ip rule show | grep -q "fwmark $MARK_HEX lookup $TABLE"; do
  ip rule del fwmark "$MARK_HEX" table "$TABLE" >/dev/null 2>&1 || break
done
while ip rule show | grep -q "uidrange $QBIT_UID-$QBIT_UID lookup $TABLE"; do
  ip rule del uidrange "$QBIT_UID-$QBIT_UID" table "$TABLE" >/dev/null 2>&1 || break
done
ip route flush table "$TABLE" >/dev/null 2>&1 || true

while iptables -t mangle -C OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$MARK_CHAIN" >/dev/null 2>&1; do
  iptables -t mangle -D OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$MARK_CHAIN" >/dev/null 2>&1 || break
done
iptables -t mangle -F "$MARK_CHAIN" >/dev/null 2>&1 || true
iptables -t mangle -X "$MARK_CHAIN" >/dev/null 2>&1 || true

while iptables -C OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1; do
  iptables -D OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || break
done
iptables -F "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || true
iptables -X "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || true

wg-quick down "$IFACE" >/dev/null 2>&1 || true
wg-quick up "$IFACE"

if [ -n "$DEFAULT_GW" ]; then
  ip route replace "$ENDPOINT_IP/32" via "$DEFAULT_GW" dev "$DEFAULT_DEV" table "$TABLE"
else
  ip route replace "$ENDPOINT_IP/32" dev "$DEFAULT_DEV" table "$TABLE"
fi
ip route replace 127.0.0.0/8 dev lo table "$TABLE"
for cidr in $ALLOW_LAN_CIDRS; do
  [ -n "$cidr" ] || continue
  if [ -n "$DEFAULT_GW" ]; then
    ip route replace "$cidr" via "$DEFAULT_GW" dev "$DEFAULT_DEV" table "$TABLE"
  else
    ip route replace "$cidr" dev "$DEFAULT_DEV" table "$TABLE"
  fi
done
ip route replace default dev "$IFACE" table "$TABLE"
ip rule add uidrange "$QBIT_UID-$QBIT_UID" table "$TABLE" priority 10010
ip route flush cache >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.all.src_valid_mark=1 >/dev/null 2>&1 || true

echo "OK"
`;
  const res = await ssh.execScript(script, { sudo: true, timeoutMs: 180000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'Failed to apply VPN routing rules on Engine Host.');
  }
}

async function disableVpnOnEngine({ ssh, vpn, serviceUser = 'qbvpn' }) {
  const interfaceName = sanitizeInterfaceName(vpn.interfaceName);
  const table = clampInt(vpn.routeTable, { min: 10, max: 999999, fallback: 51820 });
  const markHex = sanitizeMarkHex(vpn.markHex, '0x6d6');
  const script = `
set -euo pipefail
IFACE=${JSON.stringify(interfaceName)}
TABLE=${JSON.stringify(String(table))}
MARK_HEX=${JSON.stringify(markHex)}
MARK_CHAIN=${JSON.stringify(VPN_MARK_CHAIN)}
KILLSWITCH_CHAIN=${JSON.stringify(VPN_KILLSWITCH_CHAIN)}
QBIT_SYS_USER=${JSON.stringify(sanitizeLinuxAccountName(serviceUser, 'qbvpn'))}
QBIT_UID="$(id -u "$QBIT_SYS_USER" 2>/dev/null || true)"

while [ -n "$QBIT_UID" ] && ip rule show | grep -q "uidrange $QBIT_UID-$QBIT_UID lookup $TABLE"; do
  ip rule del uidrange "$QBIT_UID-$QBIT_UID" table "$TABLE" >/dev/null 2>&1 || break
done
while ip rule show | grep -q "fwmark $MARK_HEX lookup $TABLE"; do
  ip rule del fwmark "$MARK_HEX" table "$TABLE" >/dev/null 2>&1 || break
done
ip route flush table "$TABLE" >/dev/null 2>&1 || true
ip route flush cache >/dev/null 2>&1 || true

while iptables -t mangle -C OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$MARK_CHAIN" >/dev/null 2>&1; do
  iptables -t mangle -D OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$MARK_CHAIN" >/dev/null 2>&1 || break
done
iptables -t mangle -F "$MARK_CHAIN" >/dev/null 2>&1 || true
iptables -t mangle -X "$MARK_CHAIN" >/dev/null 2>&1 || true

while iptables -C OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1; do
  iptables -D OUTPUT -m owner --uid-owner "$QBIT_SYS_USER" -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || break
done
iptables -F "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || true
iptables -X "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || true

wg-quick down "$IFACE" >/dev/null 2>&1 || true
echo "OK"
`;
  const res = await ssh.execScript(script, { sudo: true, timeoutMs: 120000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'Failed to disable VPN routing on Engine Host.');
  }
}

async function queryVpnRuntime({ ssh, vpn, serviceUser = 'qbvpn', includePublicIp = true } = {}) {
  const interfaceName = sanitizeInterfaceName(vpn.interfaceName);
  const table = clampInt(vpn.routeTable, { min: 10, max: 999999, fallback: 51820 });
  const script = `
set +e
IFACE=${JSON.stringify(interfaceName)}
TABLE=${JSON.stringify(String(table))}
QBIT_SYS_USER=${JSON.stringify(sanitizeLinuxAccountName(serviceUser, 'qbvpn'))}
QBIT_UID="$(id -u "$QBIT_SYS_USER" 2>/dev/null || true)"

iface_up=0
ip link show dev "$IFACE" >/dev/null 2>&1 && iface_up=1

uid_rule_ok=0
[ -n "$QBIT_UID" ] && ip rule show | grep -q "uidrange $QBIT_UID-$QBIT_UID lookup $TABLE" && uid_rule_ok=1

rule_ok="$uid_rule_ok"
killswitch_ok="$uid_rule_ok"

wg_ok=0
wg show "$IFACE" >/dev/null 2>&1 && wg_ok=1

user_route_ok=0
[ -n "$QBIT_UID" ] && ip -4 route get 1.1.1.1 uid "$QBIT_UID" 2>/dev/null | grep -q "dev $IFACE" && user_route_ok=1

handshake=""
if [ "$wg_ok" = "1" ]; then
  handshake="$(wg show "$IFACE" latest-handshakes 2>/dev/null | awk 'NR==1{print $2}' || true)"
fi

host_ip=""
vpn_ip=""
`;
  const ipCheck = includePublicIp
    ? `
host_ip="$(curl -fsS --max-time 10 https://ipinfo.io/ip 2>/dev/null | tr -d '\\r' || true)"
vpn_ip="$(curl -fsS --max-time 12 --interface "$IFACE" https://ipinfo.io/ip 2>/dev/null | tr -d '\\r' || true)"
`
    : '';
  const suffix = `
printf 'iface_up=%s\\nrule_ok=%s\\nuid_rule_ok=%s\\nuser_route_ok=%s\\nkillswitch_ok=%s\\nwg_ok=%s\\nhandshake=%s\\nhost_ip=%s\\nvpn_ip=%s\\n' "$iface_up" "$rule_ok" "$uid_rule_ok" "$user_route_ok" "$killswitch_ok" "$wg_ok" "$handshake" "$host_ip" "$vpn_ip"
`;
  const res = await ssh.execScript(`${script}\n${ipCheck}\n${suffix}`, { sudo: true, timeoutMs: includePublicIp ? 60000 : 30000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'Failed to query VPN runtime status.');
  }
  const parsed = parseKeyValueLines(res?.stdout || '');
  const ifaceUp = parsed?.iface_up === '1';
  const ruleOk = parsed?.rule_ok === '1';
  const uidRuleOk = parsed?.uid_rule_ok === '1';
  const userRouteOk = parsed?.user_route_ok === '1';
  const killOk = parsed?.killswitch_ok === '1';
  const wgOk = parsed?.wg_ok === '1';
  const handshakeRaw = Number(parsed?.handshake || 0);
  const handshakeRecent = Number.isFinite(handshakeRaw) && handshakeRaw > 0;
  const hostIp = String(parsed?.host_ip || '').trim();
  const vpnIp = String(parsed?.vpn_ip || '').trim();
  const ready = ifaceUp && ruleOk && userRouteOk && wgOk && (vpn.killSwitchEnabled === false || killOk);
  return {
    ok: ready,
    ifaceUp,
    ruleOk,
    uidRuleOk,
    userRouteOk,
    killSwitchOk: vpn.killSwitchEnabled === false ? true : killOk,
    wgOk,
    handshakeRecent,
    hostIp,
    vpnIp,
    summary: ready
      ? `VPN ready (${interfaceName})`
      : `VPN not ready (iface:${ifaceUp ? 'yes' : 'no'} rule:${ruleOk ? 'yes' : 'no'} user-route:${userRouteOk ? 'yes' : 'no'} wg:${wgOk ? 'yes' : 'no'} kill:${vpn.killSwitchEnabled === false ? 'off' : killOk ? 'yes' : 'no'})`,
  };
}

export async function getQbittorrentVpnSettingsSafe() {
  const { vpn } = await getVpnConfigAndDb();
  return toSafeVpn(vpn);
}

export async function updateQbittorrentVpnSettingsFromAdminInput(input = {}) {
  const payload = input && typeof input === 'object' ? input : {};
  const { db, downloadClient, vpn: prevVpn } = await getVpnConfigAndDb();
  const nextVpn = normalizeVpnConfig(payload, prevVpn);

  if (payload?.clearCredentials === true) {
    nextVpn.piaUsernameEnc = null;
    nextVpn.piaPasswordEnc = null;
  }

  if (payload?.piaUsername !== undefined) {
    const username = String(payload?.piaUsername || '').trim();
    if (username) nextVpn.piaUsernameEnc = encryptString(username);
  }

  if (payload?.piaPassword !== undefined) {
    const password = String(payload?.piaPassword || '');
    if (password) nextVpn.piaPasswordEnc = encryptString(password);
  }

  if (payload?.enabled === false) {
    nextVpn.enabled = false;
  }

  if (payload?.enabled === true) {
    nextVpn.enabled = true;
  }

  if (!nextVpn.regionName && nextVpn.regionId) {
    nextVpn.regionName = nextVpn.regionId.toUpperCase();
  }

  const saved = await saveVpnConfig({ db, downloadClient, vpn: nextVpn });
  return toSafeVpn(saved);
}

export async function listPiaRegions() {
  const catalog = await fetchPiaServerCatalog();
  const rows = (Array.isArray(catalog?.regions) ? catalog.regions : [])
    .map((region) => mapPiaRegion(region))
    .filter(Boolean)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    country: row.country,
    city: row.city,
    portForward: row.portForward,
  }));
}

async function resolvePiaRegionForConfig(vpn) {
  const catalog = await fetchPiaServerCatalog();
  const rows = (Array.isArray(catalog?.regions) ? catalog.regions : [])
    .map((region) => mapPiaRegion(region))
    .filter(Boolean);
  if (!rows.length) throw new Error('No WireGuard-capable PIA regions returned.');
  const selected = choosePiaRegion(rows, vpn?.regionId || '');
  if (!selected) throw new Error('Unable to resolve selected PIA region.');
  return selected;
}

export async function applyQbittorrentVpnConfiguration() {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const { db, downloadClient, vpn: prevVpn, serviceUser } = await getVpnConfigAndDb();
  const vpn = normalizeVpnConfig(prevVpn, defaultVpnConfig());

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    if (!vpn.enabled) {
      await disableVpnOnEngine({ ssh, vpn, serviceUser });
      const savedVpn = normalizeVpnConfig(
        {
          ...vpn,
          lastAppliedAt: now(),
          lastAppliedOk: true,
          lastAppliedSummary: 'VPN disabled (opt-out).',
          lastAppliedError: '',
          lastError: '',
        },
        defaultVpnConfig()
      );
      const saved = await saveVpnConfig({ db, downloadClient, vpn: savedVpn });
      return {
        ok: true,
        action: 'disabled',
        vpn: toSafeVpn(saved),
      };
    }

    const username = vpn?.piaUsernameEnc ? decryptString(vpn.piaUsernameEnc) : '';
    const password = vpn?.piaPasswordEnc ? decryptString(vpn.piaPasswordEnc) : '';
    if (!String(username || '').trim() || !String(password || '')) {
      throw new Error('PIA credentials are required before enabling VPN.');
    }

    const connectionMode = sanitizeConnectionMode(downloadClient?.connectionMode || 'ssh');
    const allowLanCidrs =
      connectionMode === 'lan' ? parseIpv4CidrAllowlist(downloadClient?.lanBind?.authSubnetAllowlist || '') : [];

    await ensureRemoteVpnPrerequisites(ssh);
    const region = await resolvePiaRegionForConfig(vpn);
    const token = await createPiaToken({ username, password });
    const keypair = await generateWireguardKeypair(ssh);
    const addKeyResponse = await requestPiaAddKeyViaEngine({
      ssh,
      token,
      publicKey: keypair.publicKey,
      region,
    });

    await applyVpnOnEngine({
      ssh,
      vpn,
      region,
      privateKey: keypair.privateKey,
      addKeyResponse,
      serviceUser,
      allowLanCidrs,
    });

    const runtime = await queryVpnRuntime({ ssh, vpn, serviceUser, includePublicIp: true });
    const savedVpn = normalizeVpnConfig(
      {
        ...vpn,
        regionId: region.id,
        regionName: region.name,
        lastAppliedAt: now(),
        lastAppliedOk: runtime.ok,
        lastAppliedSummary: runtime.ok ? `VPN applied (${region.name}).` : runtime.summary,
        lastAppliedError: runtime.ok ? '' : runtime.summary,
        lastTestAt: now(),
        lastTestOk: runtime.ok,
        lastTestSummary: runtime.summary,
        lastError: runtime.ok ? '' : runtime.summary,
        lastPublicIp: runtime.hostIp || '',
        lastVpnPublicIp: runtime.vpnIp || '',
      },
      defaultVpnConfig()
    );
    const saved = await saveVpnConfig({ db, downloadClient, vpn: savedVpn });

    return {
      ok: runtime.ok,
      action: 'enabled',
      runtime,
      vpn: toSafeVpn(saved),
    };
  } catch (error) {
    const message = error?.message || 'Failed to apply VPN configuration.';
    const { db: latestDb, downloadClient: latestClient, vpn: latestVpn } = await getVpnConfigAndDb();
    const saved = await saveVpnConfig({
      db: latestDb,
      downloadClient: latestClient,
      vpn: {
        ...latestVpn,
        lastAppliedAt: now(),
        lastAppliedOk: false,
        lastAppliedSummary: '',
        lastAppliedError: message,
        lastError: message,
      },
    });
    return {
      ok: false,
      action: latestVpn.enabled ? 'enabled' : 'disabled',
      error: message,
      vpn: toSafeVpn(saved),
    };
  } finally {
    await ssh.close();
  }
}

export async function disableQbittorrentVpnConfiguration() {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const { db, downloadClient, vpn, serviceUser } = await getVpnConfigAndDb();
  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    await disableVpnOnEngine({ ssh, vpn, serviceUser });
    const savedVpn = normalizeVpnConfig(
      {
        ...vpn,
        enabled: false,
        lastAppliedAt: now(),
        lastAppliedOk: true,
        lastAppliedSummary: 'VPN disabled (manual stop).',
        lastAppliedError: '',
        lastError: '',
      },
      defaultVpnConfig()
    );
    const saved = await saveVpnConfig({ db, downloadClient, vpn: savedVpn });
    return { ok: true, vpn: toSafeVpn(saved) };
  } finally {
    await ssh.close();
  }
}

export async function testQbittorrentVpnRuntime({ includePublicIp = true, validateCredentials = false } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const { db, downloadClient, vpn, serviceUser } = await getVpnConfigAndDb();
  if (!vpn.enabled) {
    if (validateCredentials) {
      if (!vpn.piaUsernameEnc || !vpn.piaPasswordEnc) {
        const savedMissing = await saveVpnConfig({
          db,
          downloadClient,
          vpn: {
            ...vpn,
            lastTestAt: now(),
            lastTestOk: false,
            lastTestSummary: 'PIA credentials are missing.',
            lastError: 'PIA credentials are missing.',
          },
        });
        return {
          ok: false,
          summary: 'PIA credentials are missing.',
          runtime: null,
          vpn: toSafeVpn(savedMissing),
        };
      }
      try {
        const username = decryptString(vpn.piaUsernameEnc);
        const password = decryptString(vpn.piaPasswordEnc);
        await createPiaToken({ username, password });
        const savedCreds = await saveVpnConfig({
          db,
          downloadClient,
          vpn: {
            ...vpn,
            lastTestAt: now(),
            lastTestOk: true,
            lastTestSummary: 'PIA credentials are valid. VPN remains disabled (opt-out).',
            lastError: '',
          },
        });
        return {
          ok: true,
          summary: 'PIA credentials are valid. VPN remains disabled (opt-out).',
          runtime: null,
          vpn: toSafeVpn(savedCreds),
        };
      } catch (error) {
        const message = String(error?.message || 'PIA credential validation failed.').trim();
        const savedFailed = await saveVpnConfig({
          db,
          downloadClient,
          vpn: {
            ...vpn,
            lastTestAt: now(),
            lastTestOk: false,
            lastTestSummary: message,
            lastError: message,
          },
        });
        return {
          ok: false,
          summary: message,
          runtime: null,
          vpn: toSafeVpn(savedFailed),
        };
      }
    }
    const saved = await saveVpnConfig({
      db,
      downloadClient,
      vpn: {
        ...vpn,
        lastTestAt: now(),
        lastTestOk: true,
        lastTestSummary: 'VPN is disabled (opt-out).',
        lastError: '',
      },
    });
    return {
      ok: true,
      summary: 'VPN is disabled (opt-out).',
      runtime: null,
      vpn: toSafeVpn(saved),
    };
  }

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    const runtime = await queryVpnRuntime({ ssh, vpn, serviceUser, includePublicIp });
    const saved = await saveVpnConfig({
      db,
      downloadClient,
      vpn: {
        ...vpn,
        lastTestAt: now(),
        lastTestOk: runtime.ok,
        lastTestSummary: runtime.summary,
        lastError: runtime.ok ? '' : runtime.summary,
        lastPublicIp: runtime.hostIp || vpn.lastPublicIp || '',
        lastVpnPublicIp: runtime.vpnIp || vpn.lastVpnPublicIp || '',
      },
    });
    return {
      ok: runtime.ok,
      summary: runtime.summary,
      runtime,
      vpn: toSafeVpn(saved),
    };
  } finally {
    await ssh.close();
  }
}

export async function testQbittorrentVpnInternetConnection({ report = null } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const { db, downloadClient, vpn, serviceUser } = await getVpnConfigAndDb();
  if (!vpn.enabled) {
    throw new Error('VPN internet test is available only when VPN is enabled.');
  }
  if (!vpn.piaUsernameEnc || !vpn.piaPasswordEnc) {
    throw new Error('PIA credentials are required before running the VPN internet test.');
  }

  const emit = (patch = {}) => {
    if (typeof report !== 'function') return;
    try {
      report(patch);
    } catch {}
  };
  const events = [];
  const pushEvent = (message) => {
    const text = String(message || '').trim();
    if (!text) return;
    events.push(text);
    emit({ log: text });
  };

  const ssh = sshFromEngineHost(engineHost);
  try {
    emit({ phaseKey: 'connect', phaseLabel: 'Connecting to Engine Host', progress: 5 });
    await ssh.connect({ timeoutMs: 20000 });
    pushEvent('Connected to Engine Host.');

    emit({ phaseKey: 'apply', phaseLabel: 'Applying VPN configuration', progress: 20 });
    const applied = await applyQbittorrentVpnConfiguration();
    if (!applied?.ok) {
      throw new Error(applied?.error || applied?.runtime?.summary || applied?.vpn?.lastAppliedError || 'Failed to apply VPN configuration.');
    }
    pushEvent(applied?.runtime?.summary || 'VPN apply succeeded.');

    emit({ phaseKey: 'runtime', phaseLabel: 'Checking VPN runtime health', progress: 45 });
    const runtime = await queryVpnRuntime({ ssh, vpn, serviceUser, includePublicIp: true });
    pushEvent(runtime.summary);
    if (!runtime.ok) {
      throw new Error(runtime.summary || 'VPN runtime check failed.');
    }

    emit({ phaseKey: 'internet', phaseLabel: 'Testing internet access as qB user', progress: 70 });
    const script = `
set +e
QBIT_SYS_USER=${JSON.stringify(sanitizeLinuxAccountName(serviceUser, 'qbvpn'))}
IFACE=${JSON.stringify(sanitizeInterfaceName(vpn.interfaceName))}
ROOT_ERR_FILE="$(mktemp)"
QB_ERR_FILE="$(mktemp)"
ROOT_HTTP_CODE="$(curl -sS --interface "$IFACE" -o /dev/null -w '%{http_code}' --max-time 20 https://ipinfo.io/ip 2>"$ROOT_ERR_FILE" || true)"
ROOT_VPN_IP="$(curl -sS --interface "$IFACE" --max-time 20 https://ipinfo.io/ip 2>>"$ROOT_ERR_FILE" | tr -d '\\r' || true)"
ROOT_IP_TIME="$(curl -sS --interface "$IFACE" -o /dev/null -w '%{time_total}' --max-time 20 https://ipinfo.io/ip 2>>"$ROOT_ERR_FILE" || true)"
QB_HTTP_CODE="$(sudo -u "$QBIT_SYS_USER" curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://ipinfo.io/ip 2>"$QB_ERR_FILE" || true)"
QB_IP="$(sudo -u "$QBIT_SYS_USER" curl -sS --max-time 20 https://ipinfo.io/ip 2>>"$QB_ERR_FILE" | tr -d '\\r' || true)"
QB_IP_TIME="$(sudo -u "$QBIT_SYS_USER" curl -sS -o /dev/null -w '%{time_total}' --max-time 20 https://ipinfo.io/ip 2>>"$QB_ERR_FILE" || true)"
ROOT_ERR="$(tr '\\n' ' ' < "$ROOT_ERR_FILE" | sed 's/[[:space:]]\\+/ /g' | cut -c1-220)"
QB_ERR="$(tr '\\n' ' ' < "$QB_ERR_FILE" | sed 's/[[:space:]]\\+/ /g' | cut -c1-220)"
rm -f "$ROOT_ERR_FILE" "$QB_ERR_FILE"
printf 'root_http_code=%s\\nroot_vpn_ip=%s\\nroot_ip_time=%s\\nroot_error=%s\\nqb_http_code=%s\\nqb_ip=%s\\nqb_ip_time=%s\\nqb_error=%s\\n' "$ROOT_HTTP_CODE" "$ROOT_VPN_IP" "$ROOT_IP_TIME" "$ROOT_ERR" "$QB_HTTP_CODE" "$QB_IP" "$QB_IP_TIME" "$QB_ERR"
`;
    const res = await ssh.execScript(script, { sudo: true, timeoutMs: 60000 });
    if (Number(res?.code) !== 0) {
      const message = String(res?.stderr || res?.stdout || '').trim();
      throw new Error(message || 'Failed to run VPN internet connectivity test.');
    }
    const parsed = parseKeyValueLines(res?.stdout || '');
    const rootHttpCode = String(parsed?.root_http_code || '').trim();
    const rootVpnIp = String(parsed?.root_vpn_ip || '').trim();
    const rootIpTimeSeconds = Number(parsed?.root_ip_time || 0) || 0;
    const rootError = String(parsed?.root_error || '').trim();
    const qbHttpCode = String(parsed?.qb_http_code || '').trim();
    const qbUserIp = String(parsed?.qb_ip || '').trim();
    const qbIpTimeSeconds = Number(parsed?.qb_ip_time || 0) || 0;
    const qbError = String(parsed?.qb_error || '').trim();
    const rootVpnOk = (rootHttpCode === '200' || rootHttpCode === '204') && Boolean(rootVpnIp);
    const internetOk = (qbHttpCode === '200' || qbHttpCode === '204') && Boolean(qbUserIp);
    const ipMatchesVpn = qbUserIp && runtime.vpnIp ? qbUserIp === runtime.vpnIp : null;

    pushEvent(`Root via VPN HTTP code: ${rootHttpCode || 'none'}`);
    pushEvent(`Root via VPN public IP: ${rootVpnIp || 'unavailable'}`);
    pushEvent(`qB user internet HTTP code: ${qbHttpCode || 'none'}`);
    pushEvent(`qB user public IP: ${qbUserIp || 'unavailable'}`);
    if (rootError) pushEvent(`Root via VPN curl error: ${rootError}`);
    if (qbError) pushEvent(`qB user curl error: ${qbError}`);
    if (Number.isFinite(qbIpTimeSeconds) && qbIpTimeSeconds > 0) {
      pushEvent(`qB user IP lookup time: ${qbIpTimeSeconds.toFixed(3)}s`);
    }

    emit({ phaseKey: 'finalize', phaseLabel: 'Finalizing VPN internet test', progress: 95 });
    let summary = '';
    if (internetOk) {
      summary =
        ipMatchesVpn === false
          ? 'VPN internet test reached the internet, but qB user IP does not match the VPN interface IP.'
          : 'VPN internet test succeeded. qB user can reach the internet through the VPN path.';
    } else if (rootVpnOk) {
      summary = 'VPN internet test failed for qB user only. Root traffic through the VPN works, but qB user traffic does not.';
    } else {
      summary = 'VPN internet test failed. The VPN path itself did not complete the external connectivity check.';
    }

    const { db: latestDb, downloadClient: latestClient, vpn: latestVpn } = await getVpnConfigAndDb();
    const saved = await saveVpnConfig({
      db: latestDb,
      downloadClient: latestClient,
      vpn: {
        ...latestVpn,
        lastTestAt: now(),
        lastTestOk: internetOk,
        lastTestSummary: summary,
        lastError: internetOk ? '' : summary,
        lastPublicIp: runtime.hostIp || latestVpn.lastPublicIp || '',
        lastVpnPublicIp: runtime.vpnIp || latestVpn.lastVpnPublicIp || '',
      },
    });

    return {
      ok: internetOk,
      summary,
      runtime,
      connectivity: {
        rootHttpCode,
        rootVpnIp,
        rootIpTimeSeconds,
        rootError,
        rootVpnOk,
        qbHttpCode,
        qbUserIp,
        qbIpTimeSeconds,
        qbError,
        ipMatchesVpn,
      },
      vpn: toSafeVpn(saved),
      events,
    };
  } finally {
    await ssh.close();
  }
}

export async function runQbittorrentVpnDownloadTest({
  maxRunMinutes = 35,
  minSeeders = null,
  report = null,
} = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const { db, downloadClient, vpn, serviceUser } = await getVpnConfigAndDb();
  if (!vpn.enabled) {
    throw new Error('VPN-only download test is available only when VPN is enabled.');
  }

  const { username, password } = qbCredentialsFromDownloadClient(downloadClient);
  if (!username || !password) {
    throw new Error('qBittorrent WebUI credentials are missing. Save qBittorrent credentials first.');
  }

  const connectionMode = sanitizeConnectionMode(downloadClient?.connectionMode || 'ssh');
  const lanAddress = String(downloadClient?.lanBind?.address || '').trim();
  const baseUrls = buildQbApiBaseUrls({
    port: downloadClient?.port || 8080,
    connectionMode,
    lanAddress,
    fallbackHost: String(engineHost?.host || '').trim(),
  });

  const sourceFilters = db?.autodownloadSettings?.sourceFilters || {};
  const settingsSeeders = Number(sourceFilters?.minMovieSeeders || 0) || 0;
  const effectiveMinSeeders = Math.max(5, Number(minSeeders || 0) || 0, settingsSeeders);
  const attemptedSourceKeys = new Set();
  const maxSourceAttempts = 3;
  const events = [];
  let selectedMovie = {};
  let selectedSource = {};
  let selectedLink = '';
  let selectedAlternateLink = '';
  let runtime = null;
  let downloadRun = null;
  let lastAttemptError = null;

  const emit = (patch = {}) => {
    if (typeof report !== 'function') return;
    try {
      report(patch);
    } catch {}
  };
  const pushEvent = (message) => {
    const text = String(message || '').trim();
    if (!text) return;
    events.push(text);
    emit({ log: text });
  };

  const ssh = sshFromEngineHost(engineHost);
  try {
    emit({ phaseKey: 'connect', phaseLabel: 'Connecting to Engine Host', progress: 5 });
    await ssh.connect({ timeoutMs: 25000 });
    pushEvent('Connected to Engine Host.');

    for (let attempt = 1; attempt <= maxSourceAttempts; attempt += 1) {
      emit({ phaseKey: 'source', phaseLabel: 'Selecting 1GB test movie source', progress: 12 });
      const selected = await selectBenchmarkMovieSource({
        minSeeders: effectiveMinSeeders,
        minSizeGb: 0.8,
        maxSizeGb: 1.2,
        reasonLabel: 'VPN-only download test',
        excludeSourceKeys: attemptedSourceKeys,
      });
      selectedMovie = selected?.movie || {};
      selectedSource = selected?.source || {};
      selectedLink = String(selected?.link || '').trim();
      selectedAlternateLink = pickAlternateTorrentLinkFromSource(selectedSource, selectedLink);
      const sourceKey =
        String(selected?.sourceKey || '').trim() ||
        `${String(selectedMovie?.tmdbId || '')}:${normalizeInfoHash(selectedSource?.hash || '') || normalizeTorrentNameForMatch(selectedSource?.name || selectedLink)}`;
      if (sourceKey) attemptedSourceKeys.add(sourceKey);
      pushEvent(
        `Attempt ${attempt}/${maxSourceAttempts}: selected ${selectedMovie?.title || 'Unknown'} (${selectedMovie?.year || 'N/A'}) from ${String(selectedSource?.provider || 'unknown')} with ${Number(selectedSource?.seeders || 0)} seeders.`
      );

      try {
        emit({ phaseKey: 'apply', phaseLabel: 'Applying VPN configuration', progress: 22 });
        const applied = await applyQbittorrentVpnConfiguration();
        if (!applied?.ok) {
          throw new Error(applied?.error || applied?.runtime?.summary || applied?.vpn?.lastAppliedError || 'Failed to apply VPN configuration.');
        }
        pushEvent(applied?.runtime?.summary || 'VPN apply succeeded.');

        emit({ phaseKey: 'runtime', phaseLabel: 'Verifying VPN path before download', progress: 30 });
        runtime = await queryVpnRuntime({ ssh, vpn, serviceUser, includePublicIp: true });
        pushEvent(runtime.summary);
        if (!runtime.ok) {
          throw new Error(runtime.summary || 'VPN runtime check failed.');
        }

        emit({ phaseKey: 'download', phaseLabel: 'Downloading test movie through VPN', progress: 40 });
        let lastLoggedState = '';
        downloadRun = await runQbScenarioSample({
          ssh,
          baseUrls,
          username,
          password,
          link: selectedLink,
          alternateLink: selectedAlternateLink,
          sourceHash: selectedSource?.hash || '',
          sourceName: selectedSource?.name || selectedMovie?.title || '',
          sourceTitle: selectedMovie?.title || '',
          mode: 'vpn_on',
          maxRunMinutes,
          onProgress: (snapshot) => {
            const pct = Math.max(40, Math.min(94, 40 + Number(snapshot?.progress || 0) * 0.54));
            emit({
              phaseKey: 'download',
              phaseLabel: 'Downloading test movie through VPN',
              progress: pct,
              meta: snapshot,
            });
            const state = String(snapshot?.state || '').trim().toLowerCase();
            if (state && state !== lastLoggedState) {
              lastLoggedState = state;
              pushEvent(
                `VPN download state: ${state} | progress ${Number(snapshot?.progress || 0).toFixed(2)}% | speed ${Number(snapshot?.speedMbps || 0).toFixed(3)} MB/s | seeds ${Number(snapshot?.seeds || 0)} | peers ${Number(snapshot?.peers || 0)}`
              );
            }
          },
        });
        pushEvent('VPN-only download test completed successfully.');
        break;
      } catch (error) {
        const message = error?.message || 'VPN-only download test failed.';
        lastAttemptError = error instanceof Error ? error : new Error(message);
        pushEvent(`Attempt ${attempt} failed: ${message}`);
        const retryable =
          /stuck in metadata|no payload was downloaded|benchmark torrent hash was not detected|benchmark torrent disappeared|did not complete within/i.test(
            message.toLowerCase()
          );
        if (!retryable || attempt >= maxSourceAttempts) throw lastAttemptError;
        pushEvent(`Retrying with another 1GB candidate (next attempt ${attempt + 1}/${maxSourceAttempts}).`);
      }
    }

    emit({ phaseKey: 'finalize', phaseLabel: 'Finalizing VPN-only download test', progress: 98 });
    const summary = 'VPN-only qB download test completed successfully.';
    const storedResult = buildStoredVpnDownloadTestResult({
      sourceSelection: {
        minSeedersRequested: effectiveMinSeeders,
        title: selectedMovie?.title || '',
        year: selectedMovie?.year || null,
        tmdbId: selectedMovie?.tmdbId || null,
        releaseDate: selectedMovie?.releaseDate || '',
        popularity: Number(selectedMovie?.popularity || 0) || 0,
        provider: String(selectedSource?.provider || '').trim(),
        name: String(selectedSource?.name || '').trim(),
        seeders: Number(selectedSource?.seeders || 0) || 0,
        quality: String(selectedSource?.quality || '').trim(),
        sizeGb: selectedSource?.sizeGb ?? null,
        domainUsed: String(selectedSource?.domainUsed || '').trim(),
        linkType: String(selectedLink || '').toLowerCase().startsWith('magnet:') ? 'magnet' : 'torrent',
      },
      run: downloadRun,
      runtime,
      summary,
    });
    const saved = await saveVpnConfig({
      db,
      downloadClient,
      vpn: {
        ...vpn,
        lastDownloadTestAt: now(),
        lastDownloadTestOk: true,
        lastDownloadTestSummary: summary,
        lastDownloadTestResult: storedResult,
      },
    });
    return {
      ok: true,
      summary,
      runtime,
      sourceSelection: {
        minSeedersRequested: effectiveMinSeeders,
        title: selectedMovie?.title || '',
        year: selectedMovie?.year || null,
        tmdbId: selectedMovie?.tmdbId || null,
        releaseDate: selectedMovie?.releaseDate || '',
        popularity: Number(selectedMovie?.popularity || 0) || 0,
        provider: String(selectedSource?.provider || '').trim(),
        name: String(selectedSource?.name || '').trim(),
        seeders: Number(selectedSource?.seeders || 0) || 0,
        quality: String(selectedSource?.quality || '').trim(),
        sizeGb: selectedSource?.sizeGb ?? null,
        domainUsed: String(selectedSource?.domainUsed || '').trim(),
        linkType: String(selectedLink || '').toLowerCase().startsWith('magnet:') ? 'magnet' : 'torrent',
      },
      run: downloadRun,
      events,
      vpn: toSafeVpn(saved),
    };
  } catch (error) {
    const summary = error?.message || 'VPN-only qB download test failed.';
    await saveVpnConfig({
      db,
      downloadClient,
      vpn: {
        ...vpn,
        lastDownloadTestAt: now(),
        lastDownloadTestOk: false,
        lastDownloadTestSummary: summary,
        lastDownloadTestResult: buildStoredVpnDownloadTestResult({
          sourceSelection:
            selectedMovie?.title || selectedSource?.name
              ? {
                  minSeedersRequested: effectiveMinSeeders,
                  title: selectedMovie?.title || '',
                  year: selectedMovie?.year || null,
                  tmdbId: selectedMovie?.tmdbId || null,
                  releaseDate: selectedMovie?.releaseDate || '',
                  popularity: Number(selectedMovie?.popularity || 0) || 0,
                  provider: String(selectedSource?.provider || '').trim(),
                  name: String(selectedSource?.name || '').trim(),
                  seeders: Number(selectedSource?.seeders || 0) || 0,
                  quality: String(selectedSource?.quality || '').trim(),
                  sizeGb: selectedSource?.sizeGb ?? null,
                  domainUsed: String(selectedSource?.domainUsed || '').trim(),
                  linkType: String(selectedLink || '').toLowerCase().startsWith('magnet:') ? 'magnet' : 'torrent',
                }
              : null,
          run: downloadRun,
          runtime,
          summary,
        }),
      },
    }).catch(() => null);
    throw error;
  } finally {
    try {
      const cleaned = await cleanupBenchmarkTorrents({ ssh, baseUrls, username, password });
      if (Number(cleaned?.deletedCount || 0) > 0) {
        pushEvent(`Cleanup removed ${Number(cleaned.deletedCount || 0)} benchmark torrent(s).`);
      }
    } catch (cleanupError) {
      pushEvent(`Cleanup warning: ${cleanupError?.message || 'Failed to cleanup benchmark torrents.'}`);
    }
    await ssh.close();
  }
}

export async function runVpnMovieDownloadComparison({
  maxRunMinutes = 25,
  minSeeders = null,
} = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const { db, downloadClient, vpn } = await getVpnConfigAndDb();
  const { username, password } = qbCredentialsFromDownloadClient(downloadClient);
  if (!username || !password) {
    throw new Error('qBittorrent WebUI credentials are missing. Save qBittorrent credentials first.');
  }

  const connectionMode = sanitizeConnectionMode(downloadClient?.connectionMode || 'ssh');
  const lanAddress = String(downloadClient?.lanBind?.address || '').trim();
  const baseUrls = buildQbApiBaseUrls({
    port: downloadClient?.port || 8080,
    connectionMode,
    lanAddress,
    fallbackHost: String(engineHost?.host || '').trim(),
  });

  const sourceFilters = db?.autodownloadSettings?.sourceFilters || {};
  const settingsSeeders = Number(sourceFilters?.minMovieSeeders || 0) || 0;
  const effectiveMinSeeders = Math.max(5, Number(minSeeders || 0) || 0, settingsSeeders);
  const maxSourceAttempts = 3;
  const attemptedSourceKeys = new Set();
  let benchmarkSource = {};
  let benchmarkMovie = {};
  let benchmarkLink = '';
  let benchmarkAlternateLink = '';
  let lastAttemptError = null;

  const initialVpnEnabled = vpn.enabled === true;
  const startedAt = now();
  const events = [];

  const setVpnEnabledState = async (enabled) => {
    await updateQbittorrentVpnSettingsFromAdminInput({ enabled: Boolean(enabled) });
    const applied = await applyQbittorrentVpnConfiguration();
    if (!applied?.ok) {
      const reason = applied?.error || applied?.runtime?.summary || applied?.vpn?.lastAppliedError || 'Failed to apply VPN state.';
      throw new Error(reason);
    }
    return applied;
  };

  const ssh = sshFromEngineHost(engineHost);
  let directRun = null;
  let vpnRun = null;
  let restore = {
    ok: false,
    targetEnabled: initialVpnEnabled,
    summary: 'Restore step not executed.',
  };

  try {
    await ssh.connect({ timeoutMs: 25000 });
    for (let attempt = 1; attempt <= maxSourceAttempts; attempt += 1) {
      const selected = await selectBenchmarkMovieSource({
        minSeeders: effectiveMinSeeders,
        excludeSourceKeys: attemptedSourceKeys,
      });
      benchmarkSource = selected?.source || {};
      benchmarkMovie = selected?.movie || {};
      benchmarkLink = String(selected?.link || '').trim();
      benchmarkAlternateLink = pickAlternateTorrentLinkFromSource(benchmarkSource, benchmarkLink);
      const sourceKey =
        String(selected?.sourceKey || '').trim() ||
        `${String(benchmarkMovie?.tmdbId || '')}:${normalizeInfoHash(benchmarkSource?.hash || '') || normalizeTorrentNameForMatch(benchmarkSource?.name || benchmarkMovie?.title || benchmarkLink)}`;
      if (sourceKey) attemptedSourceKeys.add(sourceKey);
      if (!benchmarkLink) {
        lastAttemptError = new Error(`Attempt ${attempt}: selected benchmark source has empty torrent link.`);
        events.push(lastAttemptError.message);
        if (attempt >= maxSourceAttempts) throw lastAttemptError;
        continue;
      }

      events.push(`Attempt ${attempt}/${maxSourceAttempts}: selected ${benchmarkMovie.title || 'Unknown'} (${benchmarkMovie.year || 'N/A'})`);
      events.push(`Attempt ${attempt}: provider=${String(benchmarkSource?.provider || 'unknown')}, seeders=${Number(benchmarkSource?.seeders || 0)}.`);

      try {
        events.push(`Attempt ${attempt}: applying VPN OFF.`);
        await setVpnEnabledState(false);
        directRun = await runQbScenarioSample({
          ssh,
          baseUrls,
          username,
          password,
          link: benchmarkLink,
          alternateLink: benchmarkAlternateLink,
          sourceHash: benchmarkSource?.hash || '',
          sourceName: benchmarkSource?.name || benchmarkMovie?.title || '',
          sourceTitle: benchmarkMovie?.title || '',
          mode: 'vpn_off',
          maxRunMinutes,
        });

        events.push(`Attempt ${attempt}: applying VPN ON.`);
        await setVpnEnabledState(true);
        vpnRun = await runQbScenarioSample({
          ssh,
          baseUrls,
          username,
          password,
          link: benchmarkLink,
          alternateLink: benchmarkAlternateLink,
          sourceHash: benchmarkSource?.hash || '',
          sourceName: benchmarkSource?.name || benchmarkMovie?.title || '',
          sourceTitle: benchmarkMovie?.title || '',
          mode: 'vpn_on',
          maxRunMinutes,
        });
        lastAttemptError = null;
        break;
      } catch (attemptError) {
        const message = attemptError?.message || 'Benchmark attempt failed.';
        lastAttemptError = attemptError instanceof Error ? attemptError : new Error(message);
        events.push(`Attempt ${attempt} failed: ${message}`);
        const retryable =
          /stuck in metadata|no payload was downloaded|benchmark torrent hash was not detected|benchmark torrent disappeared|did not complete within/i.test(
            message.toLowerCase()
          );
        if (!retryable || attempt >= maxSourceAttempts) throw lastAttemptError;
        events.push(`Retrying with another source (next attempt ${attempt + 1}/${maxSourceAttempts}).`);
      }
    }
  } finally {
    try {
      const cleaned = await cleanupBenchmarkTorrents({ ssh, baseUrls, username, password });
      if (Number(cleaned?.deletedCount || 0) > 0) {
        events.push(`Cleanup removed ${Number(cleaned.deletedCount || 0)} benchmark torrent(s).`);
      }
    } catch (cleanupError) {
      events.push(`Cleanup warning: ${cleanupError?.message || 'Failed to cleanup benchmark torrents.'}`);
    }
    try {
      events.push(`Restoring VPN state to ${initialVpnEnabled ? 'ON' : 'OFF'}.`);
      await setVpnEnabledState(initialVpnEnabled);
      restore = {
        ok: true,
        targetEnabled: initialVpnEnabled,
        summary: `VPN restored to ${initialVpnEnabled ? 'enabled' : 'disabled'} state.`,
      };
    } catch (restoreError) {
      restore = {
        ok: false,
        targetEnabled: initialVpnEnabled,
        summary: restoreError?.message || 'Failed to restore VPN state after benchmark.',
      };
    }
    await ssh.close();
  }

  if (!vpnRun || !directRun) {
    throw new Error(lastAttemptError?.message || 'Benchmark did not complete both VPN and non-VPN runs.');
  }

  const vpnAvg = Number(vpnRun?.avgSpeedBps || 0);
  const directAvg = Number(directRun?.avgSpeedBps || 0);
  const fasterMode = vpnAvg > directAvg ? 'vpn_on' : directAvg > vpnAvg ? 'vpn_off' : 'tie';
  const fasterLabel = fasterMode === 'vpn_on' ? 'VPN' : fasterMode === 'vpn_off' ? 'No VPN' : 'Tie';
  const diff = Math.abs(vpnAvg - directAvg);
  const baseline = Math.max(1, Math.min(vpnAvg || 1, directAvg || 1));
  const marginPercent = Number(((diff / baseline) * 100).toFixed(2));
  const finishedAt = now();

  return {
    ok: true,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    maxRunMinutes: Math.max(3, Math.min(120, Math.floor(Number(maxRunMinutes || 0) || 25))),
    sourceSelection: {
      minSeedersRequested: effectiveMinSeeders,
      title: benchmarkMovie?.title || '',
      year: benchmarkMovie?.year || null,
      tmdbId: benchmarkMovie?.tmdbId || null,
      releaseDate: benchmarkMovie?.releaseDate || '',
      popularity: Number(benchmarkMovie?.popularity || 0) || 0,
      provider: String(benchmarkSource?.provider || '').trim(),
      name: String(benchmarkSource?.name || '').trim(),
      seeders: Number(benchmarkSource?.seeders || 0) || 0,
      quality: String(benchmarkSource?.quality || '').trim(),
      sizeGb: benchmarkSource?.sizeGb ?? null,
      domainUsed: String(benchmarkSource?.domainUsed || '').trim(),
      linkType: String(benchmarkLink || '').toLowerCase().startsWith('magnet:') ? 'magnet' : 'torrent',
    },
    runs: [directRun, vpnRun],
    comparison: {
      fasterMode,
      fasterLabel,
      marginPercent,
      vpnAvgMbps: Number(bytesToMbps(vpnAvg).toFixed(3)),
      directAvgMbps: Number(bytesToMbps(directAvg).toFixed(3)),
      vpnMaxMbps: Number(bytesToMbps(vpnRun?.maxSpeedBps || 0).toFixed(3)),
      directMaxMbps: Number(bytesToMbps(directRun?.maxSpeedBps || 0).toFixed(3)),
      vpnDownloadedMb: Number((Number(vpnRun?.downloadedBytes || 0) / (1024 * 1024)).toFixed(2)),
      directDownloadedMb: Number((Number(directRun?.downloadedBytes || 0) / (1024 * 1024)).toFixed(2)),
    },
    restore,
    events,
  };
}

export async function ensureQbittorrentVpnReadyForDispatch() {
  const { db, downloadClient, vpn, serviceUser } = await getVpnConfigAndDb();
  if (!vpn.enabled || vpn.requiredForDispatch === false) {
    return {
      ok: true,
      required: false,
      summary: vpn.enabled ? 'VPN dispatch guard disabled by settings.' : 'VPN disabled.',
      vpn: toSafeVpn(vpn),
    };
  }
  if (!vpn.piaUsernameEnc || !vpn.piaPasswordEnc) {
    return {
      ok: false,
      required: true,
      summary: 'VPN is enabled but PIA credentials are missing.',
      vpn: toSafeVpn(vpn),
    };
  }

  const engineHost = await getEngineHost();
  if (!engineHost) {
    return {
      ok: false,
      required: true,
      summary: 'No Engine Host configured.',
      vpn: toSafeVpn(vpn),
    };
  }

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    const runtime = await queryVpnRuntime({ ssh, vpn, serviceUser, includePublicIp: false });
    const saved = await saveVpnConfig({
      db,
      downloadClient,
      vpn: {
        ...vpn,
        lastTestAt: now(),
        lastTestOk: runtime.ok,
        lastTestSummary: runtime.summary,
        lastError: runtime.ok ? '' : runtime.summary,
      },
    });
    return {
      ok: runtime.ok,
      required: true,
      summary: runtime.summary,
      runtime,
      vpn: toSafeVpn(saved),
    };
  } catch (e) {
    const summary = e?.message || 'VPN dispatch check failed.';
    const saved = await saveVpnConfig({
      db,
      downloadClient,
      vpn: {
        ...vpn,
        lastTestAt: now(),
        lastTestOk: false,
        lastTestSummary: summary,
        lastError: summary,
      },
    });
    return {
      ok: false,
      required: true,
      summary,
      vpn: toSafeVpn(saved),
    };
  } finally {
    await ssh.close();
  }
}
