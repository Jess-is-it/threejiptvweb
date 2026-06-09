import 'server-only';

import { execFile, spawn } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { getPublicSettings, updatePublicSettings } from './settings';
import { getSecret, secretKeys, setSecret } from './secrets';

const execFileAsync = promisify(execFile);

const CONFIG_DIR = process.env.IPTV_PUBLIC_HTTPS_CONFIG_DIR || path.join(os.homedir(), '.config', '3j-tv');
const DATA_DIR = process.env.IPTV_PUBLIC_HTTPS_DATA_DIR || path.join(os.homedir(), '.local', 'share', '3j-tv');
const BIN_DIR = process.env.IPTV_PUBLIC_HTTPS_BIN_DIR || path.join(os.homedir(), '.local', 'bin');
const TOKEN_FILE = path.join(CONFIG_DIR, 'cloudflared.token');
const LOG_FILE = process.env.IPTV_CLOUDFLARED_LOG_FILE || path.join(DATA_DIR, 'cloudflared.log');
const LOCAL_CLOUDFLARED_BIN = process.env.IPTV_CLOUDFLARED_BIN || path.join(BIN_DIR, 'cloudflared');

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeUrl(value, fallback = '') {
  const text = normalizeText(value, fallback).replace(/\/+$/, '');
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallback || '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return fallback || '';
  }
}

function normalizeHostname(value, fallback = '') {
  return normalizeText(value, fallback)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function publicHttpsDefaults() {
  return {
    enabled: false,
    provider: 'cloudflare_tunnel',
    domain: '3jhotspot.com',
    publicHostname: 'tv.3jhotspot.com',
    publicUrl: 'https://tv.3jhotspot.com',
    localServiceUrl: 'http://127.0.0.1:3000',
    notes: '',
  };
}

function sanitizeTunnelTokenCandidate(value) {
  return String(value || '').trim().replace(/^['\"]|['\"]$/g, '');
}

function isLikelyCloudflareTunnelToken(value) {
  const token = sanitizeTunnelTokenCandidate(value);
  if (!token || token.length < 80 || /\s/.test(token)) return false;
  if (!/^[A-Za-z0-9._=-]+$/.test(token)) return false;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return true;
  return token.startsWith('eyJ') || token.length >= 120;
}

function connectorTokenInputFromPayload(payload = {}) {
  const directKeys = [
    'connectorCommand',
    'connector_command',
    'tunnelToken',
    'tunnel_token',
    'cloudflareConnectorCommand',
    'cloudflare_connector_command',
    'cloudflareTunnelToken',
    'cloudflare_tunnel_token',
  ];
  for (const key of directKeys) {
    const value = normalizeText(payload?.[key]);
    if (value) return value;
  }
  for (const value of Object.values(payload || {})) {
    if (typeof value !== 'string') continue;
    const text = normalizeText(value);
    if (!text) continue;
    if (/cloudflared|--token|service\s+install|tunnel\s+run/i.test(text) || isLikelyCloudflareTunnelToken(text)) return text;
  }
  return '';
}

export function extractCloudflareTunnelToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const explicitPatterns = [
    /(?:^|\s)--token(?:=|\s+)(['\"]?)([A-Za-z0-9._=-]{80,})\1(?:\s|$)/i,
    /(?:^|\s)service\s+install\s+(['\"]?)([A-Za-z0-9._=-]{80,})\1(?:\s|$)/i,
    /(?:^|\s)tunnel\s+run\s+--token(?:=|\s+)(['\"]?)([A-Za-z0-9._=-]{80,})\1(?:\s|$)/i,
  ];
  for (const pattern of explicitPatterns) {
    const match = raw.match(pattern);
    if (match && isLikelyCloudflareTunnelToken(match[2])) return sanitizeTunnelTokenCandidate(match[2]);
  }

  const candidates = raw.match(/[A-Za-z0-9._=-]{80,}/g) || [];
  const preferred = candidates
    .map(sanitizeTunnelTokenCandidate)
    .filter(isLikelyCloudflareTunnelToken)
    .sort((a, b) => {
      const aScore = (a.startsWith('eyJ') ? 2 : 0) + (a.includes('.') ? 1 : 0);
      const bScore = (b.startsWith('eyJ') ? 2 : 0) + (b.includes('.') ? 1 : 0);
      return bScore - aScore || b.length - a.length;
    })[0];
  if (preferred) return preferred;

  const rawCandidate = sanitizeTunnelTokenCandidate(raw);
  if (isLikelyCloudflareTunnelToken(rawCandidate)) return rawCandidate;

  throw new Error('Cloudflare tunnel token was not detected. Paste the full connector command or the raw token.');
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 12) return 'saved';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function cloudflaredDownloadUrl() {
  if (process.platform !== 'linux') throw new Error(`Unsupported cloudflared platform: ${process.platform}`);
  if (process.arch === 'x64') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
  if (process.arch === 'arm64') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
  throw new Error(`Unsupported cloudflared architecture: ${process.arch}`);
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandPath(name) {
  try {
    const { stdout } = await execFileAsync('sh', ['-lc', `command -v ${name} || true`], { timeout: 5000 });
    return String(stdout || '').trim().split('\n')[0] || '';
  } catch {
    return '';
  }
}

export async function cloudflaredBinaryPath() {
  if (await fileExists(LOCAL_CLOUDFLARED_BIN)) return LOCAL_CLOUDFLARED_BIN;
  return commandPath('cloudflared');
}

export async function ensureCloudflaredInstalled() {
  const existing = await cloudflaredBinaryPath();
  if (existing) return existing;

  await fsp.mkdir(BIN_DIR, { recursive: true });
  const response = await fetch(cloudflaredDownloadUrl(), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not download cloudflared: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(LOCAL_CLOUDFLARED_BIN, bytes, { mode: 0o755 });
  await fsp.chmod(LOCAL_CLOUDFLARED_BIN, 0o755);
  return LOCAL_CLOUDFLARED_BIN;
}

async function runningCloudflaredProcesses() {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-af', 'cloudflared'], { timeout: 5000 });
    return String(stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line.includes(TOKEN_FILE));
  } catch {
    return [];
  }
}

export async function readCloudflaredLogTail(lineCount = 80) {
  try {
    const text = await fsp.readFile(LOG_FILE, 'utf8');
    return text.split('\n').slice(-lineCount).filter(Boolean);
  } catch {
    return [];
  }
}

async function checkUrl(url) {
  const target = normalizeUrl(url);
  if (!target) return { status: 'SKIPPED', message: 'URL is not configured.' };
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(target, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal });
    return {
      status: response.status < 500 ? 'SUCCESS' : 'WARNING',
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      contentType: response.headers.get('content-type') || '',
    };
  } catch (error) {
    return { status: 'FAILED', error: error?.name === 'AbortError' ? 'Request timed out.' : error?.message || 'Request failed.' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPublicHttpsStatus() {
  const settings = await getPublicSettings();
  const defaults = publicHttpsDefaults();
  const current = { ...defaults, ...(settings.publicHttps || {}) };
  const domain = normalizeHostname(current.domain, defaults.domain);
  const publicHostname = normalizeHostname(current.publicHostname, `tv.${domain}`);
  const localServiceUrl = normalizeUrl(current.localServiceUrl, defaults.localServiceUrl);
  const publicUrl = normalizeUrl(current.publicUrl, `https://${publicHostname}`);
  const token = await getSecret(secretKeys().cloudflareTunnelToken);
  const binary = await cloudflaredBinaryPath();
  const processes = await runningCloudflaredProcesses();
  const runningLine = processes[0] || '';
  const pid = runningLine ? Number(runningLine.split(/\s+/)[0]) || null : null;
  return {
    ok: true,
    settings: {
      enabled: current.enabled === true,
      provider: 'cloudflare_tunnel',
      domain,
      publicHostname,
      publicUrl,
      localServiceUrl,
      notes: normalizeText(current.notes),
      tokenUpdatedAt: normalizeText(current.tokenUpdatedAt),
    },
    tokenConfigured: Boolean(token),
    tokenHint: maskSecret(token),
    tokenUpdatedAt: normalizeText(current.tokenUpdatedAt),
    tokenTextAreaValue: token ? 'Saved token configured - leave blank to keep it' : '',
    cloudflaredInstalled: Boolean(binary),
    cloudflaredPath: binary,
    cloudflaredRunning: processes.length > 0,
    cloudflaredPid: pid,
    publicHostnameGuide: {
      subdomain: publicHostname.split('.')[0] || 'tv',
      domain: publicHostname.split('.').slice(1).join('.') || domain,
      type: 'HTTP',
      url: localServiceUrl,
    },
    localServiceCheck: await checkUrl(localServiceUrl),
    publicServiceCheck: await checkUrl(publicUrl),
    logs: await readCloudflaredLogTail(80),
  };
}

export async function savePublicHttpsSettings(payload = {}) {
  const settings = await getPublicSettings();
  const defaults = publicHttpsDefaults();
  const current = { ...defaults, ...(settings.publicHttps || {}) };
  const tokenValue = connectorTokenInputFromPayload(payload);
  const tokenSubmitted = Boolean(tokenValue);
  const patch = {
    enabled: payload.enabled === true,
    provider: 'cloudflare_tunnel',
    domain: normalizeHostname(payload.domain, current.domain),
    publicHostname: normalizeHostname(payload.publicHostname, current.publicHostname),
    publicUrl: normalizeUrl(payload.publicUrl, current.publicUrl),
    localServiceUrl: normalizeUrl(payload.localServiceUrl, current.localServiceUrl),
    notes: normalizeText(payload.notes).slice(0, 1500),
    tokenUpdatedAt: current.tokenUpdatedAt || '',
  };
  if (!patch.publicUrl && patch.publicHostname) patch.publicUrl = `https://${patch.publicHostname}`;

  if (payload.clearToken === true || payload.clear_token === true) {
    await setSecret(secretKeys().cloudflareTunnelToken, '');
    patch.tokenUpdatedAt = '';
  } else if (tokenSubmitted) {
    const token = extractCloudflareTunnelToken(tokenValue);
    await setSecret(secretKeys().cloudflareTunnelToken, token);
    const savedToken = await getSecret(secretKeys().cloudflareTunnelToken);
    if (!savedToken) throw new Error('Cloudflare tunnel token could not be saved. Please try again.');
    patch.tokenUpdatedAt = new Date().toISOString();
  }

  await updatePublicSettings({ publicHttps: patch });
  return getPublicHttpsStatus();
}

async function writeTokenFile() {
  const token = await getSecret(secretKeys().cloudflareTunnelToken);
  if (!token) throw new Error('Save the Cloudflare tunnel connector command or token first.');
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  await fsp.chmod(TOKEN_FILE, 0o600);
}

async function appendLog(line) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.appendFile(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
}

export async function startCloudflaredConnector() {
  await writeTokenFile();
  const existing = await runningCloudflaredProcesses();
  if (existing.length) return getPublicHttpsStatus();
  const binary = await ensureCloudflaredInstalled();
  await appendLog('Starting cloudflared for IPTV public HTTPS.');
  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(binary, ['tunnel', '--no-autoupdate', 'run', '--token-file', TOKEN_FILE], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, HOME: os.homedir() },
  });
  child.unref();
  fs.closeSync(logFd);
  await new Promise((resolve) => setTimeout(resolve, 900));
  return getPublicHttpsStatus();
}

export async function stopCloudflaredConnector() {
  const processes = await runningCloudflaredProcesses();
  for (const line of processes) {
    const pid = Number(line.split(/\s+/)[0]) || 0;
    if (pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
  }
  if (processes.length) await appendLog(`Stopped ${processes.length} cloudflared process(es).`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  return getPublicHttpsStatus();
}

export async function restartCloudflaredConnector() {
  await stopCloudflaredConnector();
  return startCloudflaredConnector();
}
