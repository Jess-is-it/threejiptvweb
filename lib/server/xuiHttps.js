import 'server-only';

import { getAdminDb, saveAdminDb } from './adminDb';
import { decryptString, encryptString } from './vault';
import { extractCloudflareTunnelToken } from './publicHttps';
import { SSHService } from './autodownload/sshService';

const SAVED_TOKEN_TEXT = 'Saved token configured - leave blank to keep it';
const SAVED_SECRET_TEXT = 'Saved secret configured - leave blank to keep it';
const SERVICE_NAME = '3j-xui-https-cloudflared.service';
const CONFIG_DIR = '/etc/3j-xui-https';
const TOKEN_FILE = `${CONFIG_DIR}/cloudflared.token`;
const CLOUDFLARED_BIN = '/usr/local/bin/cloudflared';

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeHostname(value, fallback = '') {
  const text = normalizeText(value, fallback)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  return text || normalizeText(fallback).toLowerCase();
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

function defaults() {
  return {
    enabled: false,
    provider: 'cloudflare_tunnel_remote_xui',
    domain: '3jhotspot.com',
    publicHostname: 'xui.3jhotspot.com',
    publicUrl: 'https://xui.3jhotspot.com',
    originServiceUrl: 'http://127.0.0.1',
    sshHost: '10.100.100.100',
    sshPort: '22',
    sshUsername: 'root',
    sshAuthType: 'password',
    notes: '',
    tokenUpdatedAt: '',
    lastAction: '',
    lastActionAt: '',
    lastActionError: '',
    lastRemoteStatus: null,
  };
}

function mergeSettings(value) {
  const current = value && typeof value === 'object' ? value : {};
  return { ...defaults(), ...current };
}

function safeDecrypt(payload) {
  if (!payload) return '';
  try {
    return decryptString(payload);
  } catch {
    return '';
  }
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 12) return 'saved';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function encryptedHint(payload) {
  return maskSecret(safeDecrypt(payload));
}

function isSavedPlaceholder(value) {
  const text = normalizeText(value);
  return text === SAVED_TOKEN_TEXT || text === SAVED_SECRET_TEXT;
}

function connectorTokenInput(payload = {}) {
  const keys = ['connectorCommand', 'connector_command', 'tunnelToken', 'tunnel_token', 'cloudflareConnectorCommand', 'cloudflareTunnelToken'];
  for (const key of keys) {
    const value = normalizeText(payload?.[key]);
    if (value && !isSavedPlaceholder(value)) return value;
  }
  return '';
}

function publicHostnameGuide(settings) {
  const publicHostname = normalizeHostname(settings.publicHostname, defaults().publicHostname);
  const parts = publicHostname.split('.');
  return {
    subdomain: parts[0] || 'xui',
    domain: parts.slice(1).join('.') || settings.domain || defaults().domain,
    type: 'HTTP',
    url: settings.originServiceUrl || defaults().originServiceUrl,
  };
}

async function checkPublicUrl(url) {
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

async function readDbState() {
  const db = await getAdminDb();
  db.xuiHttps = mergeSettings(db.xuiHttps);
  return { db, current: db.xuiHttps };
}

function sshConfigured(settings) {
  if (!settings.sshHost || !settings.sshUsername || !settings.sshAuthType) return false;
  if (settings.sshAuthType === 'privateKey') return Boolean(settings.sshPrivateKeyEnc);
  return Boolean(settings.sshPasswordEnc);
}

function safeSettings(settings) {
  const current = mergeSettings(settings);
  const domain = normalizeHostname(current.domain, defaults().domain);
  const publicHostname = normalizeHostname(current.publicHostname, `xui.${domain}`);
  const publicUrl = normalizeUrl(current.publicUrl, `https://${publicHostname}`);
  const originServiceUrl = normalizeUrl(current.originServiceUrl, defaults().originServiceUrl);
  return {
    enabled: current.enabled === true,
    provider: 'cloudflare_tunnel_remote_xui',
    domain,
    publicHostname,
    publicUrl,
    originServiceUrl,
    sshHost: normalizeText(current.sshHost, defaults().sshHost),
    sshPort: normalizeText(current.sshPort, defaults().sshPort),
    sshUsername: normalizeText(current.sshUsername, defaults().sshUsername),
    sshAuthType: current.sshAuthType === 'privateKey' ? 'privateKey' : 'password',
    notes: normalizeText(current.notes),
    tokenUpdatedAt: normalizeText(current.tokenUpdatedAt),
    lastAction: normalizeText(current.lastAction),
    lastActionAt: normalizeText(current.lastActionAt),
    lastActionError: normalizeText(current.lastActionError),
    lastRemoteStatus: current.lastRemoteStatus || null,
  };
}

export async function getXuiHttpsStatus({ refreshRemote = false } = {}) {
  const { current } = await readDbState();
  const settings = safeSettings(current);
  let remoteStatus = settings.lastRemoteStatus;
  if (refreshRemote && sshConfigured(current)) {
    try {
      remoteStatus = await refreshRemoteConnectorStatus();
    } catch (error) {
      remoteStatus = {
        status: 'FAILED',
        error: error?.message || 'Remote XUI status check failed.',
        checkedAt: new Date().toISOString(),
      };
    }
  }

  return {
    ok: true,
    settings,
    tokenConfigured: Boolean(current.tunnelTokenEnc),
    tokenHint: encryptedHint(current.tunnelTokenEnc),
    tokenUpdatedAt: normalizeText(current.tokenUpdatedAt),
    tokenTextAreaValue: current.tunnelTokenEnc ? SAVED_TOKEN_TEXT : '',
    sshConfigured: sshConfigured(current),
    sshPasswordConfigured: Boolean(current.sshPasswordEnc),
    sshPrivateKeyConfigured: Boolean(current.sshPrivateKeyEnc),
    sshPassphraseConfigured: Boolean(current.sshPassphraseEnc),
    sudoPasswordConfigured: Boolean(current.sudoPasswordEnc),
    sshPasswordTextAreaValue: current.sshPasswordEnc ? SAVED_SECRET_TEXT : '',
    sshPrivateKeyTextAreaValue: current.sshPrivateKeyEnc ? SAVED_SECRET_TEXT : '',
    sshPassphraseTextAreaValue: current.sshPassphraseEnc ? SAVED_SECRET_TEXT : '',
    sudoPasswordTextAreaValue: current.sudoPasswordEnc ? SAVED_SECRET_TEXT : '',
    publicHostnameGuide: publicHostnameGuide(settings),
    publicServiceCheck: await checkPublicUrl(settings.publicUrl),
    lastRemoteStatus: remoteStatus,
  };
}

function secretInput(payload, key) {
  const value = normalizeText(payload?.[key]);
  return value && !isSavedPlaceholder(value) ? value : '';
}

export async function saveXuiHttpsSettings(payload = {}) {
  const { db, current } = await readDbState();
  const prev = safeSettings(current);
  const domain = normalizeHostname(payload.domain, prev.domain);
  const publicHostname = normalizeHostname(payload.publicHostname, prev.publicHostname || `xui.${domain}`);
  const publicUrl = normalizeUrl(payload.publicUrl, `https://${publicHostname}`);
  const originServiceUrl = normalizeUrl(payload.originServiceUrl, prev.originServiceUrl);
  const next = {
    ...current,
    enabled: payload.enabled === true,
    provider: 'cloudflare_tunnel_remote_xui',
    domain,
    publicHostname,
    publicUrl,
    originServiceUrl,
    sshHost: normalizeText(payload.sshHost, prev.sshHost),
    sshPort: normalizeText(payload.sshPort, prev.sshPort || '22'),
    sshUsername: normalizeText(payload.sshUsername, prev.sshUsername),
    sshAuthType: payload.sshAuthType === 'privateKey' ? 'privateKey' : 'password',
    notes: normalizeText(payload.notes).slice(0, 1500),
  };

  const tokenValue = connectorTokenInput(payload);
  if (payload.clearToken === true || payload.clear_token === true) {
    next.tunnelTokenEnc = null;
    next.tokenUpdatedAt = '';
  } else if (tokenValue) {
    next.tunnelTokenEnc = encryptString(extractCloudflareTunnelToken(tokenValue));
    next.tokenUpdatedAt = new Date().toISOString();
  }

  const password = secretInput(payload, 'sshPassword');
  const privateKey = secretInput(payload, 'sshPrivateKey');
  const passphrase = secretInput(payload, 'sshPassphrase');
  const sudoPassword = secretInput(payload, 'sudoPassword');

  if (payload.clearSshPassword === true) next.sshPasswordEnc = null;
  else if (password) next.sshPasswordEnc = encryptString(password);

  if (payload.clearSshPrivateKey === true) next.sshPrivateKeyEnc = null;
  else if (privateKey) next.sshPrivateKeyEnc = encryptString(privateKey);

  if (payload.clearSshPassphrase === true) next.sshPassphraseEnc = null;
  else if (passphrase) next.sshPassphraseEnc = encryptString(passphrase);

  if (payload.clearSudoPassword === true) next.sudoPasswordEnc = null;
  else if (sudoPassword) next.sudoPasswordEnc = encryptString(sudoPassword);

  db.xuiHttps = next;
  db.xuiIntegration = { ...(db.xuiIntegration || {}), publicBaseUrl: publicUrl };
  await saveAdminDb(db);
  return getXuiHttpsStatus();
}

function createSshClient(settings) {
  const authType = settings.sshAuthType === 'privateKey' ? 'privateKey' : 'password';
  const opts = {
    host: settings.sshHost,
    port: Number(settings.sshPort || 22) || 22,
    username: settings.sshUsername,
    authType,
    sudoPassword: safeDecrypt(settings.sudoPasswordEnc),
  };
  if (authType === 'privateKey') {
    opts.privateKey = safeDecrypt(settings.sshPrivateKeyEnc);
    opts.passphrase = safeDecrypt(settings.sshPassphraseEnc);
  } else {
    opts.password = safeDecrypt(settings.sshPasswordEnc);
  }
  return new SSHService(opts);
}

async function updateAction(patch) {
  const { db, current } = await readDbState();
  db.xuiHttps = { ...current, ...patch };
  await saveAdminDb(db);
}

function parseStatus(stdout) {
  const lineValue = (key) => {
    const match = String(stdout || '').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  };
  const logsMarker = '---journal---';
  const logIndex = String(stdout || '').indexOf(logsMarker);
  const logs = logIndex >= 0 ? String(stdout || '').slice(logIndex + logsMarker.length).trim().split('\n').slice(-80) : [];
  return {
    status: 'SUCCESS',
    cloudflaredPath: lineValue('cloudflared_path'),
    serviceActive: lineValue('service_active'),
    serviceEnabled: lineValue('service_enabled'),
    servicePid: lineValue('service_pid'),
    originCheck: lineValue('origin_check'),
    logs: logs.filter(Boolean),
    checkedAt: new Date().toISOString(),
  };
}

function remoteStatusScript(originServiceUrl) {
  const origin = JSON.stringify(originServiceUrl || defaults().originServiceUrl);
  return `set +e
SERVICE=${SERVICE_NAME}
ORIGIN=${origin}
echo "cloudflared_path=$(command -v cloudflared || true)"
echo "service_active=$(systemctl is-active \"$SERVICE\" 2>/dev/null || true)"
echo "service_enabled=$(systemctl is-enabled \"$SERVICE\" 2>/dev/null || true)"
echo "service_pid=$(systemctl show -p MainPID --value \"$SERVICE\" 2>/dev/null || true)"
if command -v curl >/dev/null 2>&1; then
  CHECK=$(curl -k -L -o /dev/null -sS -w 'HTTP %{http_code} in %{time_total}s' --max-time 8 "$ORIGIN" 2>&1 || true)
elif command -v wget >/dev/null 2>&1; then
  CHECK=$(wget --server-response --spider --timeout=8 "$ORIGIN" 2>&1 | awk '/HTTP\\// {code=$2} END {if (code) print "HTTP " code; else print "FAILED"}')
else
  CHECK='SKIPPED no curl/wget'
fi
echo "origin_check=$CHECK"
echo "---journal---"
journalctl -u "$SERVICE" -n 80 --no-pager 2>/dev/null || true
`;
}

export async function refreshRemoteConnectorStatus() {
  const { db, current } = await readDbState();
  if (!sshConfigured(current)) throw new Error('XUI SSH credentials are not configured.');
  const ssh = createSshClient(current);
  try {
    await ssh.connect({ timeoutMs: 15000 });
    const result = await ssh.execScript(remoteStatusScript(current.originServiceUrl), { timeoutMs: 25000 });
    const parsed = parseStatus(result.stdout || '');
    parsed.status = result.code === 0 ? 'SUCCESS' : 'WARNING';
    if (result.stderr) parsed.stderr = result.stderr.trim().slice(-3000);
    db.xuiHttps = { ...current, lastRemoteStatus: parsed, lastAction: 'check', lastActionAt: new Date().toISOString(), lastActionError: '' };
    await saveAdminDb(db);
    return parsed;
  } finally {
    await ssh.close().catch(() => null);
  }
}

export async function testXuiHttpsSsh() {
  const { current } = await readDbState();
  if (!sshConfigured(current)) throw new Error('XUI SSH credentials are not configured.');
  const ssh = createSshClient(current);
  try {
    await ssh.connect({ timeoutMs: 15000 });
    const result = await ssh.exec('whoami && id -u && uname -a && command -v systemctl || true && command -v curl || true && command -v wget || true', { timeoutMs: 20000 });
    if (result.code !== 0) throw new Error(result.stderr || 'SSH test command failed.');
    await updateAction({ lastAction: 'test-ssh', lastActionAt: new Date().toISOString(), lastActionError: '' });
    return { ...(await getXuiHttpsStatus()), sshTest: { status: 'SUCCESS', stdout: result.stdout } };
  } catch (error) {
    await updateAction({ lastAction: 'test-ssh', lastActionAt: new Date().toISOString(), lastActionError: error?.message || 'SSH test failed.' });
    throw error;
  } finally {
    await ssh.close().catch(() => null);
  }
}

async function runPrivilegedScript(script, { timeoutMs = 120000, action = 'remote-action' } = {}) {
  const { current } = await readDbState();
  if (!sshConfigured(current)) throw new Error('XUI SSH credentials are not configured.');
  const ssh = createSshClient(current);
  try {
    await ssh.connect({ timeoutMs: 15000 });
    const idResult = await ssh.exec('id -u', { timeoutMs: 10000 });
    const isRoot = String(idResult.stdout || '').trim().split('\n')[0] === '0';
    if (!isRoot && !safeDecrypt(current.sudoPasswordEnc)) throw new Error('Sudo password is required for installing or controlling cloudflared on the XUI server.');
    const result = await ssh.execScript(script, { sudo: !isRoot, timeoutMs });
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'Remote command failed.');
    await updateAction({ lastAction: action, lastActionAt: new Date().toISOString(), lastActionError: '' });
    return result;
  } catch (error) {
    await updateAction({ lastAction: action, lastActionAt: new Date().toISOString(), lastActionError: error?.message || 'Remote action failed.' });
    throw error;
  } finally {
    await ssh.close().catch(() => null);
  }
}

function installScript(token) {
  const tokenB64 = Buffer.from(`${token}\n`, 'utf8').toString('base64');
  const unit = `[Unit]
Description=3J XUI Cloudflare Tunnel Connector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=${CLOUDFLARED_BIN} tunnel --no-autoupdate run --token-file ${TOKEN_FILE}
Restart=always
RestartSec=5
Environment=HOME=/root

[Install]
WantedBy=multi-user.target
`;
  const unitB64 = Buffer.from(unit, 'utf8').toString('base64');
  return `set -euo pipefail
SERVICE=${SERVICE_NAME}
CONFIG_DIR=${CONFIG_DIR}
TOKEN_FILE=${TOKEN_FILE}
BIN=${CLOUDFLARED_BIN}
mkdir -p "$CONFIG_DIR"
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) URL='https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64' ;;
  aarch64|arm64) URL='https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64' ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 2 ;;
esac
if [ ! -x "$BIN" ]; then
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$BIN"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$BIN" "$URL"
  else
    echo 'curl or wget is required to download cloudflared.' >&2
    exit 3
  fi
  chmod 0755 "$BIN"
fi
printf '%s' '${tokenB64}' | base64 -d > "$TOKEN_FILE"
chmod 0600 "$TOKEN_FILE"
printf '%s' '${unitB64}' | base64 -d > "/etc/systemd/system/$SERVICE"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE"
systemctl status "$SERVICE" --no-pager -l | sed -n '1,24p'
`;
}

export async function installXuiHttpsConnector() {
  const { current } = await readDbState();
  const token = safeDecrypt(current.tunnelTokenEnc);
  if (!token) throw new Error('Save the XUI Cloudflare connector command or token first.');
  await runPrivilegedScript(installScript(token), { timeoutMs: 180000, action: 'install' });
  return getXuiHttpsStatus({ refreshRemote: true });
}

function controlScript(action) {
  return `set -euo pipefail
systemctl ${action} ${SERVICE_NAME}
sleep 1
systemctl is-active ${SERVICE_NAME} || true
systemctl status ${SERVICE_NAME} --no-pager -l | sed -n '1,24p'
`;
}

export async function startXuiHttpsConnector() {
  await runPrivilegedScript(controlScript('start'), { timeoutMs: 60000, action: 'start' });
  return getXuiHttpsStatus({ refreshRemote: true });
}

export async function stopXuiHttpsConnector() {
  await runPrivilegedScript(controlScript('stop'), { timeoutMs: 60000, action: 'stop' });
  return getXuiHttpsStatus({ refreshRemote: true });
}

export async function restartXuiHttpsConnector() {
  await runPrivilegedScript(controlScript('restart'), { timeoutMs: 60000, action: 'restart' });
  return getXuiHttpsStatus({ refreshRemote: true });
}
