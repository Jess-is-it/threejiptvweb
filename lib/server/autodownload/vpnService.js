import 'server-only';

import { decryptString, encryptString } from '../vault';
import { getAdminDb, saveAdminDb } from '../adminDb';
import { getEngineHost } from './autodownloadDb';
import { SSHService } from './sshService';

const PIA_SERVERLIST_URL = 'https://serverlist.piaservers.net/vpninfo/servers/v6';
const PIA_TOKEN_URL = 'https://www.privateinternetaccess.com/api/client/v2/token';
const VPN_MARK_CHAIN = '3JTV_QB_MARK';
const VPN_KILLSWITCH_CHAIN = '3JTV_QB_KILLSWITCH';

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
  return { db, downloadClient: dc, vpn };
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
  const body = new URLSearchParams();
  body.set('username', String(username || '').trim());
  body.set('password', String(password || ''));

  const res = await fetch(PIA_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const raw = await res.text();
  const parsed = parseJsonObjectLoose(raw, {});
  if (!res.ok) {
    const message = String(parsed?.message || parsed?.error || '').trim();
    throw new Error(message || `PIA token request failed (${res.status}).`);
  }

  const token = String(parsed?.token || '').trim();
  if (!token) {
    const message = String(parsed?.message || parsed?.error || '').trim();
    throw new Error(message || 'PIA token request succeeded but token is missing.');
  }
  return token;
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
    throw new Error(msg || 'PIA addKey returned non-OK status.');
  }
  return parsed;
}

async function applyVpnOnEngine({
  ssh,
  vpn,
  region,
  privateKey,
  addKeyResponse,
}) {
  const interfaceName = sanitizeInterfaceName(vpn.interfaceName);
  const table = clampInt(vpn.routeTable, { min: 10, max: 999999, fallback: 51820 });
  const markHex = sanitizeMarkHex(vpn.markHex, '0x6d6');
  const killSwitchEnabled = vpn.killSwitchEnabled !== false;
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
MARK_MASK="$MARK_HEX/0xffffffff"
ENDPOINT_IP=${JSON.stringify(endpointIp)}
ENDPOINT_PORT=${JSON.stringify(String(endpointPort))}
PRIVATE_KEY=${JSON.stringify(privateKey)}
PEER_PUBLIC_KEY=${JSON.stringify(peerPublicKey)}
PEER_IP=${JSON.stringify(peerIp)}
DNS_SERVER=${JSON.stringify(dnsServer)}
KILLSWITCH=${JSON.stringify(killSwitchEnabled ? '1' : '0')}
MARK_CHAIN=${JSON.stringify(VPN_MARK_CHAIN)}
KILLSWITCH_CHAIN=${JSON.stringify(VPN_KILLSWITCH_CHAIN)}

WG_CONF="/etc/wireguard/$IFACE.conf"
install -d -m 700 /etc/wireguard

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
ip route flush table "$TABLE" >/dev/null 2>&1 || true

while iptables -t mangle -C OUTPUT -m owner --uid-owner xui -j "$MARK_CHAIN" >/dev/null 2>&1; do
  iptables -t mangle -D OUTPUT -m owner --uid-owner xui -j "$MARK_CHAIN" >/dev/null 2>&1 || break
done
iptables -t mangle -F "$MARK_CHAIN" >/dev/null 2>&1 || true
iptables -t mangle -X "$MARK_CHAIN" >/dev/null 2>&1 || true

while iptables -C OUTPUT -m owner --uid-owner xui -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1; do
  iptables -D OUTPUT -m owner --uid-owner xui -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || break
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
ip route replace default dev "$IFACE" table "$TABLE"
ip rule add fwmark "$MARK_HEX" table "$TABLE" priority 10020
sysctl -w net.ipv4.conf.all.src_valid_mark=1 >/dev/null 2>&1 || true

iptables -t mangle -N "$MARK_CHAIN" >/dev/null 2>&1 || true
iptables -t mangle -F "$MARK_CHAIN"
iptables -t mangle -A "$MARK_CHAIN" -j MARK --set-xmark "$MARK_MASK"
iptables -t mangle -C OUTPUT -m owner --uid-owner xui -j "$MARK_CHAIN" >/dev/null 2>&1 || iptables -t mangle -I OUTPUT 1 -m owner --uid-owner xui -j "$MARK_CHAIN"

if [ "$KILLSWITCH" = "1" ]; then
  iptables -N "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || true
  iptables -F "$KILLSWITCH_CHAIN"
  iptables -A "$KILLSWITCH_CHAIN" -o lo -j RETURN
  iptables -A "$KILLSWITCH_CHAIN" -d 127.0.0.0/8 -j RETURN
  iptables -A "$KILLSWITCH_CHAIN" -o "$IFACE" -j RETURN
  iptables -A "$KILLSWITCH_CHAIN" -j REJECT
  iptables -C OUTPUT -m owner --uid-owner xui -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || iptables -I OUTPUT 1 -m owner --uid-owner xui -j "$KILLSWITCH_CHAIN"
fi

echo "OK"
`;
  const res = await ssh.execScript(script, { sudo: true, timeoutMs: 180000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'Failed to apply VPN routing rules on Engine Host.');
  }
}

async function disableVpnOnEngine({ ssh, vpn }) {
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

while ip rule show | grep -q "fwmark $MARK_HEX lookup $TABLE"; do
  ip rule del fwmark "$MARK_HEX" table "$TABLE" >/dev/null 2>&1 || break
done
ip route flush table "$TABLE" >/dev/null 2>&1 || true

while iptables -t mangle -C OUTPUT -m owner --uid-owner xui -j "$MARK_CHAIN" >/dev/null 2>&1; do
  iptables -t mangle -D OUTPUT -m owner --uid-owner xui -j "$MARK_CHAIN" >/dev/null 2>&1 || break
done
iptables -t mangle -F "$MARK_CHAIN" >/dev/null 2>&1 || true
iptables -t mangle -X "$MARK_CHAIN" >/dev/null 2>&1 || true

while iptables -C OUTPUT -m owner --uid-owner xui -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1; do
  iptables -D OUTPUT -m owner --uid-owner xui -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1 || break
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

async function queryVpnRuntime({ ssh, vpn, includePublicIp = true } = {}) {
  const interfaceName = sanitizeInterfaceName(vpn.interfaceName);
  const table = clampInt(vpn.routeTable, { min: 10, max: 999999, fallback: 51820 });
  const markHex = sanitizeMarkHex(vpn.markHex, '0x6d6');
  const script = `
set +e
IFACE=${JSON.stringify(interfaceName)}
TABLE=${JSON.stringify(String(table))}
MARK_HEX=${JSON.stringify(markHex)}
KILLSWITCH_EXPECTED=${JSON.stringify(vpn.killSwitchEnabled !== false ? '1' : '0')}
MARK_CHAIN=${JSON.stringify(VPN_MARK_CHAIN)}
KILLSWITCH_CHAIN=${JSON.stringify(VPN_KILLSWITCH_CHAIN)}

iface_up=0
ip link show dev "$IFACE" >/dev/null 2>&1 && iface_up=1

rule_ok=0
ip rule show | grep -q "fwmark $MARK_HEX lookup $TABLE" && rule_ok=1

mark_ok=0
iptables -t mangle -C OUTPUT -m owner --uid-owner xui -j "$MARK_CHAIN" >/dev/null 2>&1 && mark_ok=1

killswitch_ok=1
if [ "$KILLSWITCH_EXPECTED" = "1" ]; then
  killswitch_ok=0
  iptables -C OUTPUT -m owner --uid-owner xui -j "$KILLSWITCH_CHAIN" >/dev/null 2>&1 && killswitch_ok=1
fi

wg_ok=0
wg show "$IFACE" >/dev/null 2>&1 && wg_ok=1

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
printf 'iface_up=%s\\nrule_ok=%s\\nmark_ok=%s\\nkillswitch_ok=%s\\nwg_ok=%s\\nhandshake=%s\\nhost_ip=%s\\nvpn_ip=%s\\n' "$iface_up" "$rule_ok" "$mark_ok" "$killswitch_ok" "$wg_ok" "$handshake" "$host_ip" "$vpn_ip"
`;
  const res = await ssh.execScript(`${script}\n${ipCheck}\n${suffix}`, { sudo: true, timeoutMs: includePublicIp ? 60000 : 30000 });
  if (Number(res?.code) !== 0) {
    const msg = String(res?.stderr || res?.stdout || '').trim();
    throw new Error(msg || 'Failed to query VPN runtime status.');
  }
  const parsed = parseKeyValueLines(res?.stdout || '');
  const ifaceUp = parsed?.iface_up === '1';
  const ruleOk = parsed?.rule_ok === '1';
  const markOk = parsed?.mark_ok === '1';
  const killOk = parsed?.killswitch_ok === '1';
  const wgOk = parsed?.wg_ok === '1';
  const handshakeRaw = Number(parsed?.handshake || 0);
  const handshakeRecent = Number.isFinite(handshakeRaw) && handshakeRaw > 0;
  const hostIp = String(parsed?.host_ip || '').trim();
  const vpnIp = String(parsed?.vpn_ip || '').trim();
  const ready = ifaceUp && ruleOk && markOk && wgOk && (vpn.killSwitchEnabled === false || killOk);
  return {
    ok: ready,
    ifaceUp,
    ruleOk,
    markOk,
    killSwitchOk: vpn.killSwitchEnabled === false ? true : killOk,
    wgOk,
    handshakeRecent,
    hostIp,
    vpnIp,
    summary: ready
      ? `VPN ready (${interfaceName})`
      : `VPN not ready (iface:${ifaceUp ? 'yes' : 'no'} rule:${ruleOk ? 'yes' : 'no'} mark:${markOk ? 'yes' : 'no'} wg:${wgOk ? 'yes' : 'no'} kill:${vpn.killSwitchEnabled === false ? 'off' : killOk ? 'yes' : 'no'})`,
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

  const { db, downloadClient, vpn: prevVpn } = await getVpnConfigAndDb();
  const vpn = normalizeVpnConfig(prevVpn, defaultVpnConfig());

  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    if (!vpn.enabled) {
      await disableVpnOnEngine({ ssh, vpn });
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
    });

    const runtime = await queryVpnRuntime({ ssh, vpn, includePublicIp: true });
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

  const { db, downloadClient, vpn } = await getVpnConfigAndDb();
  const ssh = sshFromEngineHost(engineHost);
  try {
    await ssh.connect({ timeoutMs: 20000 });
    await disableVpnOnEngine({ ssh, vpn });
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

export async function testQbittorrentVpnRuntime({ includePublicIp = true } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');

  const { db, downloadClient, vpn } = await getVpnConfigAndDb();
  if (!vpn.enabled) {
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
    const runtime = await queryVpnRuntime({ ssh, vpn, includePublicIp });
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

export async function ensureQbittorrentVpnReadyForDispatch() {
  const { db, downloadClient, vpn } = await getVpnConfigAndDb();
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
    const runtime = await queryVpnRuntime({ ssh, vpn, includePublicIp: false });
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
