import 'server-only';

import crypto from 'node:crypto';

import { decryptString, encryptString } from '../vault';
import { getEngineHost } from './autodownloadDb';
import { getMountSettings, setMountSettings, setMountStatus } from './autodownloadDb';
import { getAutodownloadSettings } from './autodownloadDb';
import { SSHService } from './sshService';
import { buildLibraryPaths, getLibraryFolderConfig } from './libraryFolders';
import { getTmdbGenres } from './tmdbService';

function now() {
  return Date.now();
}

function sanitizeMountDir(dir) {
  const d = String(dir || '').trim() || '/mnt/windows_vod';
  // keep it simple: absolute paths only
  if (!d.startsWith('/')) throw new Error('Mount directory must be an absolute path.');
  return d.replace(/\/+$/, '');
}

function sanitizeShare(s) {
  const share = String(s || '').trim();
  if (!share) throw new Error('Share name is required.');
  // Windows share names typically do not include slashes
  return share.replace(/^\/+/, '').replace(/\/+$/, '');
}

function sanitizeHost(h) {
  const host = String(h || '').trim();
  if (!host) throw new Error('Windows host is required.');
  return host;
}

function sanitizeUidGid(v, fallback) {
  const s = String(v || '').trim();
  if (!s) return fallback;
  // allow simple usernames, group names, or numeric ids
  if (!/^[a-z_][a-z0-9_-]*$|^\d+$/i.test(s)) throw new Error('uid/gid must be a username or numeric id.');
  return s;
}

function sanitizeSmbVersion(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('SMB version must look like "3.0".');
  return s;
}

export async function upsertMountSettingsFromAdminInput(input) {
  const windowsHost = sanitizeHost(input?.windowsHost || input?.host);
  const shareName = sanitizeShare(input?.shareName || input?.share);
  const mountDir = sanitizeMountDir(input?.mountDir);
  const username = String(input?.username || '').trim();
  const password = String(input?.password || '');
  const domain = String(input?.domain || '').trim();
  const smbVersion = sanitizeSmbVersion(input?.smbVersion || input?.vers);
  const uid = sanitizeUidGid(input?.uid, 'xui');
  const gid = sanitizeUidGid(input?.gid, 'xui');

  if (!username) throw new Error('SMB username is required.');
  if (!password) throw new Error('SMB password is required.');

  const next = {
    windowsHost,
    shareName,
    mountDir,
    domain: domain || '',
    smbVersion: smbVersion || '',
    uid,
    gid,
    usernameEnc: encryptString(username),
    passwordEnc: encryptString(password),
  };
  return setMountSettings(next);
}

export async function updateMountSettingsFromAdminInput(input) {
  const prev = await getMountSettings();

  const windowsHost = sanitizeHost(input?.windowsHost || input?.host || prev?.windowsHost);
  const shareName = sanitizeShare(input?.shareName || input?.share || prev?.shareName);
  const mountDir = sanitizeMountDir(input?.mountDir || prev?.mountDir);
  const domain = String(input?.domain ?? prev?.domain ?? '').trim();
  const smbVersion = sanitizeSmbVersion(input?.smbVersion || input?.vers || prev?.smbVersion || '');
  const uid = sanitizeUidGid(input?.uid ?? prev?.uid, 'xui');
  const gid = sanitizeUidGid(input?.gid ?? prev?.gid, 'xui');

  const usernameRaw = String(input?.username || '').trim();
  const passwordRaw = String(input?.password || '');
  const hasNewCreds = Boolean(usernameRaw && passwordRaw);
  const hasExistingCreds = Boolean(prev?.usernameEnc && prev?.passwordEnc);

  if (!hasNewCreds && !hasExistingCreds) {
    throw new Error('SMB username and password are required.');
  }
  if ((usernameRaw && !passwordRaw) || (!usernameRaw && passwordRaw)) {
    throw new Error('Provide both SMB username and SMB password (or leave both blank to keep existing).');
  }

  const next = {
    windowsHost,
    shareName,
    mountDir,
    domain: domain || '',
    smbVersion: smbVersion || '',
    uid,
    gid,
    ...(hasNewCreds
      ? { usernameEnc: encryptString(usernameRaw), passwordEnc: encryptString(passwordRaw) }
      : { usernameEnc: prev?.usernameEnc, passwordEnc: prev?.passwordEnc }),
  };
  return setMountSettings(next);
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

export async function testSmbAccess({ settingsOverride = null } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const s = settingsOverride || (await getMountSettings());
  if (!s) throw new Error('No NAS mount settings configured.');

  const username = s.username ? String(s.username) : decryptString(s.usernameEnc);
  const password = s.password ? String(s.password) : decryptString(s.passwordEnc);
  const domain = String(s.domain || '').trim();
  const smbVersion = sanitizeSmbVersion(s.smbVersion || '');
  const uid = sanitizeUidGid(s.uid, 'xui');
  const gid = sanitizeUidGid(s.gid, 'xui');
  const versOpt = smbVersion ? `,vers=${smbVersion}` : '';

  const script = `
set -euo pipefail

WIN_HOST=${JSON.stringify(s.windowsHost)}
SHARE=${JSON.stringify(s.shareName)}
MOUNT_DIR="/tmp/3jtv_smb_test_${crypto.randomUUID().slice(0,8)}"
CREDS="/tmp/3jtv_smb_test_${crypto.randomUUID().slice(0,8)}.creds"
UID_OPT=${JSON.stringify(uid)}
GID_OPT=${JSON.stringify(gid)}

cleanup() {
  set +e
  mountpoint -q "$MOUNT_DIR" && umount -f "$MOUNT_DIR" >/dev/null 2>&1 || true
  rm -f "$CREDS" || true
  rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p "$MOUNT_DIR"
uid_num="$UID_OPT"
gid_num="$GID_OPT"
if ! printf '%s' "$uid_num" | grep -Eq '^[0-9]+$'; then
  uid_num="$(id -u "$uid_num" 2>/dev/null || echo 0)"
fi
if ! printf '%s' "$gid_num" | grep -Eq '^[0-9]+$'; then
  gid_num="$(getent group "$gid_num" 2>/dev/null | cut -d: -f3 | head -n1 || true)"
  [ -n "$gid_num" ] || gid_num="$(id -g "$UID_OPT" 2>/dev/null || echo 0)"
fi
cat > "$CREDS" <<'EOF'
username=${username.replace(/'/g, "'\\''")}
password=${password.replace(/'/g, "'\\''")}
${domain ? `domain=${domain.replace(/'/g, "'\\''")}` : ''}
EOF
chmod 600 "$CREDS"

echo "Testing mount source: //$WIN_HOST/$SHARE"

if ! command -v mount.cifs >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y cifs-utils
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y cifs-utils
  elif command -v yum >/dev/null 2>&1; then
    yum install -y cifs-utils
  else
    echo "mount.cifs missing and no supported package manager found"
    exit 3
  fi
fi

if ! mount -t cifs "//$WIN_HOST/$SHARE" "$MOUNT_DIR" -o "credentials=$CREDS,iocharset=utf8,file_mode=0775,dir_mode=0775,uid=$uid_num,gid=$gid_num${versOpt}"; then
  echo ""
  echo "Mount failed. Common causes:"
  echo " - Share name is wrong (it must match the SMB share name on Windows/NAS)"
  echo " - Host is wrong/unreachable"
  echo " - Credentials are wrong or do not have permission"
  echo ""
  echo "Attempted: //$WIN_HOST/$SHARE -> $MOUNT_DIR"
  exit 1
fi

touch "$MOUNT_DIR/.3jtv_write_test" && rm -f "$MOUNT_DIR/.3jtv_write_test"
echo "OK"
`;

  const ssh = sshFromEngineHost(engineHost);
  try {
    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 180000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'SMB test failed.');
    return { ok: true, message: 'SMB credentials OK and share is writable.' };
  } finally {
    await ssh.close();
  }
}

export async function mountNow() {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const s = await getMountSettings();
  if (!s) throw new Error('No NAS mount settings configured.');

  const username = decryptString(s.usernameEnc);
  const password = decryptString(s.passwordEnc);
  const domain = String(s.domain || '').trim();
  const smbVersion = sanitizeSmbVersion(s.smbVersion || '');
  const uid = sanitizeUidGid(s.uid, 'xui');
  const gid = sanitizeUidGid(s.gid, 'xui');

  const mountDir = sanitizeMountDir(s.mountDir);
  const share = sanitizeShare(s.shareName);
  const winHost = sanitizeHost(s.windowsHost);
  const versOpt = smbVersion ? `,vers=${smbVersion}` : '';

const script = `
set -euo pipefail

cd /

WIN_HOST=${JSON.stringify(winHost)}
SHARE=${JSON.stringify(share)}
MOUNT_DIR=${JSON.stringify(mountDir)}
UID_OPT=${JSON.stringify(uid)}
GID_OPT=${JSON.stringify(gid)}
EXPECTED_SOURCE="//$WIN_HOST/$SHARE"

CREDS_DIR="/etc/samba/credentials"
CREDS_FILE="$CREDS_DIR/iptv_nas.creds"
STATUS_DIR="/var/lib/3jtv"
STATUS_FILE="$STATUS_DIR/mount-status.json"

ensure_user() {
  if [ "$UID_OPT" = "xui" ] || [ "$GID_OPT" = "xui" ]; then
    if ! getent group xui >/dev/null 2>&1; then
      groupadd --system xui
    fi
    if ! id -u xui >/dev/null 2>&1; then
      useradd --system --home /home/xui --create-home --shell /usr/sbin/nologin -g xui xui
    fi
  fi
}

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y cifs-utils
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y cifs-utils
  elif command -v yum >/dev/null 2>&1; then
    yum install -y cifs-utils
  else
    echo "No supported package manager found"
    exit 2
  fi
}

ensure_user
command -v mount.cifs >/dev/null 2>&1 || pkg_install

uid_num="$UID_OPT"
gid_num="$GID_OPT"
if ! printf '%s' "$uid_num" | grep -Eq '^[0-9]+$'; then
  uid_num="$(id -u "$uid_num" 2>/dev/null || echo 0)"
fi
if ! printf '%s' "$gid_num" | grep -Eq '^[0-9]+$'; then
  gid_num="$(getent group "$gid_num" 2>/dev/null | cut -d: -f3 | head -n1 || true)"
  [ -n "$gid_num" ] || gid_num="$(id -g "$UID_OPT" 2>/dev/null || echo 0)"
fi

mkdir -p "$MOUNT_DIR"
mkdir -p "$CREDS_DIR"
cat > "$CREDS_FILE" <<'EOF'
username=${username.replace(/'/g, "'\\''")}
password=${password.replace(/'/g, "'\\''")}
${domain ? `domain=${domain.replace(/'/g, "'\\''")}` : ''}
EOF
chmod 600 "$CREDS_FILE"

MOUNT_OPTS="credentials=$CREDS_FILE,iocharset=utf8,file_mode=0775,dir_mode=0775,uid=$uid_num,gid=$gid_num${versOpt}"

# Ensure fstab entry (idempotent)
FSTAB_LINE="//$WIN_HOST/$SHARE $MOUNT_DIR cifs $MOUNT_OPTS,_netdev,nofail 0 0"
awk -v mdir="$MOUNT_DIR" -v creds="$CREDS_FILE" '
  $0 ~ /^[[:space:]]*# 3JTV_CIFS_AUTOMOUNT/ {next}
  ($2 == mdir && $3 == "cifs") {next}
  index($0, creds) > 0 {next}
  {print}
' /etc/fstab > /tmp/fstab.3jtv.tmp
cp /tmp/fstab.3jtv.tmp /etc/fstab
echo "# 3JTV_CIFS_AUTOMOUNT" >> /etc/fstab
echo "$FSTAB_LINE" >> /etc/fstab

mkdir -p "$STATUS_DIR"

cat > /usr/local/bin/3jtv-mount-health-check <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

MOUNT_DIR="\${1:-${mountDir}}"
STATUS_FILE="\${2:-/var/lib/3jtv/mount-status.json}"
EXPECTED_SOURCE="\${3:-//${winHost}/${share}}"

ts() { date +%s%3N; }
now="$(ts)"

current_source() {
  awk -v mdir="$MOUNT_DIR" '$2==mdir {print $1; exit}' /proc/self/mounts 2>/dev/null || true
}

mounted=false
writable=false
error=""
source="$(current_source)"

if [ -n "$source" ] && [ "$source" = "$EXPECTED_SOURCE" ]; then
  mounted=true
  test_file="$MOUNT_DIR/.3jtv_write_test"
  if touch "$test_file" >/dev/null 2>&1 && rm -f "$test_file" >/dev/null 2>&1; then
    writable=true
  else
    error="Mount not writable"
  fi
else
  error="Not mounted"
fi

if [ "$mounted" != "true" ] || [ "$writable" != "true" ]; then
  mount -a >/dev/null 2>&1 || true
  mount "$MOUNT_DIR" >/dev/null 2>&1 || true
  source="$(current_source)"
  if [ -n "$source" ] && [ "$source" = "$EXPECTED_SOURCE" ]; then
    mounted=true
    test_file="$MOUNT_DIR/.3jtv_write_test"
    if touch "$test_file" >/dev/null 2>&1 && rm -f "$test_file" >/dev/null 2>&1; then
      writable=true
      error=""
    else
      writable=false
      error="Mount not writable (after remount)"
    fi
  else
    mounted=false
    writable=false
    error="Not mounted (after remount)"
  fi
fi

df_json="{}"
if command -v df >/dev/null 2>&1; then
  # bytes
  df_out="$(df -B1 "$MOUNT_DIR" 2>/dev/null | tail -n 1 || true)"
  if [ -n "$df_out" ]; then
    total="$(echo "$df_out" | awk '{print $2}')"
    used="$(echo "$df_out"  | awk '{print $3}')"
    avail="$(echo "$df_out" | awk '{print $4}')"
    total="\${total:-0}"
    used="\${used:-0}"
    avail="\${avail:-0}"
    df_json="{\"total\":$total,\"used\":$used,\"avail\":$avail}"
  fi
fi

ok=false
if [ "$mounted" = "true" ] && [ "$writable" = "true" ]; then ok=true; fi

mkdir -p "$(dirname "$STATUS_FILE")"
cat > "$STATUS_FILE" <<JSON
{
  "checkedAt": $now,
  "ok": $ok,
  "mounted": $mounted,
  "writable": $writable,
  "mountDir": "$(echo "$MOUNT_DIR" | sed 's/\"/\\\\\"/g')",
  "error": "$(echo "$error" | sed 's/\"/\\\\\"/g')",
  "space": $df_json
}
JSON

if [ "$ok" = "true" ]; then
  logger -t 3jtv-mount "OK: $MOUNT_DIR"
else
  logger -t 3jtv-mount "ERROR: $MOUNT_DIR ($error)"
fi
EOF
chmod +x /usr/local/bin/3jtv-mount-health-check

cat > /etc/systemd/system/3jtv-mount-health.service <<'EOF'
[Unit]
Description=3J TV mount health check
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/3jtv-mount-health-check
EOF

cat > /etc/systemd/system/3jtv-mount-health.timer <<'EOF'
[Unit]
Description=3J TV mount health timer

[Timer]
OnBootSec=60
OnUnitActiveSec=300
Unit=3jtv-mount-health.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now 3jtv-mount-health.timer

cur_source="$(awk -v mdir="$MOUNT_DIR" '$2==mdir {print $1; exit}' /proc/self/mounts 2>/dev/null || true)"

if [ -n "$cur_source" ] && [ "$cur_source" != "$EXPECTED_SOURCE" ]; then
  echo "Mount directory already mounted from a different source ($cur_source). Unmounting to re-mount $EXPECTED_SOURCE..."
  umount -f "$MOUNT_DIR" >/dev/null 2>&1 || true
fi

# Ensure no stacked duplicate mounts remain before mounting.
for _ in 1 2 3 4 5; do
  grep -q -F " $MOUNT_DIR " /proc/self/mounts 2>/dev/null || break
  umount -f "$MOUNT_DIR" >/dev/null 2>&1 || umount -l "$MOUNT_DIR" >/dev/null 2>&1 || true
done

mount_out="$(mount -t cifs "$EXPECTED_SOURCE" "$MOUNT_DIR" -o "$MOUNT_OPTS" 2>&1)" || true
actual_source="$(awk -v mdir="$MOUNT_DIR" '$2==mdir {print $1; exit}' /proc/self/mounts 2>/dev/null || true)"

if [ -z "$actual_source" ] || [ "$actual_source" != "$EXPECTED_SOURCE" ]; then
  echo ""
  echo "Mount failed: $MOUNT_DIR is not mounted from expected source."
  echo "Attempted source: $EXPECTED_SOURCE"
  echo "Actual source: \${actual_source:-<none>}"
  echo "mount -a output:"
  echo "$mount_out"
  echo ""
  echo "Common causes:"
  echo " - Share name is wrong (it must match the SMB share name on Windows/NAS)"
  echo " - Host is wrong/unreachable"
  echo " - Credentials are wrong or do not have permission"
  exit 1
fi

# verify write
touch "$MOUNT_DIR/.3jtv_write_test" && rm -f "$MOUNT_DIR/.3jtv_write_test" || {
  echo ""
  echo "Mount is present but not writable: $MOUNT_DIR"
  exit 1
}

# initial status write
/usr/local/bin/3jtv-mount-health-check "$MOUNT_DIR" "$STATUS_FILE" "$EXPECTED_SOURCE" || true

echo "OK"
`;

  const ssh = sshFromEngineHost(engineHost);
  try {
    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 240000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'Mount failed.');
    // fetch status file
    const status = await fetchMountStatus({ ssh });
    await setMountStatus(status);
    if (!status?.mounted || !status?.writable) {
      throw new Error(status?.error || 'Mount is configured in /etc/fstab but not actively mounted/writable.');
    }
    return { ok: true, status };
  } finally {
    await ssh.close();
  }
}

export async function ensureLibraryFolders() {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const s = await getMountSettings();
  if (!s) throw new Error('No NAS mount settings configured.');
  const mountDir = sanitizeMountDir(s.mountDir);
  const settings = await getAutodownloadSettings();
  const folderCfg = getLibraryFolderConfig(settings);
  const movies = buildLibraryPaths({ mountDir, type: 'movie', settings });
  const series = buildLibraryPaths({ mountDir, type: 'series', settings });
  const legacyMovies = {
    downloadingDir: `${mountDir}/Movies/${folderCfg.movies.downloading}`,
    downloadedDir: `${mountDir}/Movies/${folderCfg.movies.downloaded}`,
    processingDir: `${mountDir}/Movies/${folderCfg.movies.processing}`,
  };
  const legacySeries = {
    downloadingDir: `${mountDir}/Series/${folderCfg.series.downloading}`,
    downloadedDir: `${mountDir}/Series/${folderCfg.series.downloaded}`,
    processingDir: `${mountDir}/Series/${folderCfg.series.processing}`,
  };
  const movieGenres = (await getTmdbGenres({ mediaType: 'movie' }).catch(() => ({ ok: true, genres: [] }))).genres || [];
  const tvGenres = (await getTmdbGenres({ mediaType: 'tv' }).catch(() => ({ ok: true, genres: [] }))).genres || [];
  const movieGenreNames = movieGenres.map((g) => String(g?.name || '').trim()).filter(Boolean);
  const tvGenreNames = tvGenres.map((g) => String(g?.name || '').trim()).filter(Boolean);
  const categories = ['English', 'Asian'];

  const script = `
set -euo pipefail
MOUNT_DIR=${JSON.stringify(mountDir)}
MOVIES_ROOT=${JSON.stringify(movies.root)}
SERIES_ROOT=${JSON.stringify(series.root)}
LEGACY_M_DOWN=${JSON.stringify(legacyMovies.downloadingDir)}
LEGACY_M_DONE=${JSON.stringify(legacyMovies.downloadedDir)}
LEGACY_M_PROC=${JSON.stringify(legacyMovies.processingDir)}
LEGACY_S_DOWN=${JSON.stringify(legacySeries.downloadingDir)}
LEGACY_S_DONE=${JSON.stringify(legacySeries.downloadedDir)}
LEGACY_S_PROC=${JSON.stringify(legacySeries.processingDir)}
MOVIE_GENRES=(${movieGenreNames.map((x) => JSON.stringify(x)).join(' ')})
TV_GENRES=(${tvGenreNames.map((x) => JSON.stringify(x)).join(' ')})
MOVIE_CATEGORIES=(${categories.map((x) => JSON.stringify(x)).join(' ')})
dirs=(
  ${JSON.stringify(movies.downloadingDir)}
  ${JSON.stringify(movies.downloadedDir)}
  ${JSON.stringify(movies.processingDir)}
  ${JSON.stringify(series.downloadingDir)}
  ${JSON.stringify(series.downloadedDir)}
  ${JSON.stringify(series.processingDir)}
)

created=()
existing=()
normalized=()
errors=()

migrate_legacy_stage() {
  local old_path="$1"
  local new_path="$2"
  if [ -z "$old_path" ] || [ -z "$new_path" ] || [ "$old_path" = "$new_path" ]; then
    return 0
  fi
  if [ ! -e "$old_path" ]; then
    return 0
  fi

  mkdir -p "$(dirname "$new_path")" >/dev/null 2>&1 || true

  if [ ! -e "$new_path" ]; then
    if mv "$old_path" "$new_path" >/dev/null 2>&1; then
      created+=("$new_path")
      return 0
    fi
    errors+=("legacy move failed: $old_path -> $new_path")
    return 0
  fi

  if [ ! -d "$old_path" ] || [ ! -d "$new_path" ]; then
    return 0
  fi

  shopt -s dotglob nullglob
  local collision=""
  local item=""
  for item in "$old_path"/*; do
    [ -e "$item" ] || continue
    local bn
    bn="$(basename "$item")"
    if [ -e "$new_path/$bn" ]; then
      collision="$bn"
      break
    fi
  done

  if [ -n "$collision" ]; then
    shopt -u dotglob nullglob
    errors+=("legacy merge skipped (collision $collision): $old_path -> $new_path")
    return 0
  fi

  for item in "$old_path"/*; do
    [ -e "$item" ] || continue
    mv "$item" "$new_path/" >/dev/null 2>&1 || {
      errors+=("legacy merge move failed: $item -> $new_path")
      shopt -u dotglob nullglob
      return 0
    }
  done
  shopt -u dotglob nullglob
  rmdir "$old_path" >/dev/null 2>&1 || true
}

migrate_legacy_stage "$LEGACY_M_DOWN" ${JSON.stringify(movies.downloadingDir)}
migrate_legacy_stage "$LEGACY_M_DONE" ${JSON.stringify(movies.downloadedDir)}
migrate_legacy_stage "$LEGACY_M_PROC" ${JSON.stringify(movies.processingDir)}
migrate_legacy_stage "$LEGACY_S_DOWN" ${JSON.stringify(series.downloadingDir)}
migrate_legacy_stage "$LEGACY_S_DONE" ${JSON.stringify(series.downloadedDir)}
migrate_legacy_stage "$LEGACY_S_PROC" ${JSON.stringify(series.processingDir)}

strip_count_suffix() {
  local name="$1"
  echo "$name" | sed -E 's/\\([0-9]+\\)[[:space:]]*$//'
}

unique_conflict_path() {
  local target="$1"
  local n=2
  local cand="\${target}.dup\${n}"
  while [ -e "$cand" ]; do
    n=$((n+1))
    cand="\${target}.dup\${n}"
  done
  echo "$cand"
}

merge_tree() {
  local src="$1"
  local dst="$2"
  [ -d "$src" ] || return 0
  mkdir -p "$dst" >/dev/null 2>&1 || {
    errors+=("merge mkdir failed: $dst")
    return 0
  }

  shopt -s dotglob nullglob
  local item=""
  for item in "$src"/*; do
    [ -e "$item" ] || continue
    local bn
    bn="$(basename "$item")"
    local target="$dst/$bn"

    if [ -e "$target" ]; then
      if [ -d "$item" ] && [ -d "$target" ]; then
        merge_tree "$item" "$target"
        rmdir "$item" >/dev/null 2>&1 || true
      elif [ -f "$item" ] && [ -f "$target" ] && cmp -s "$item" "$target" >/dev/null 2>&1; then
        rm -f "$item" >/dev/null 2>&1 || true
      else
        local alt
        alt="$(unique_conflict_path "$target")"
        if mv "$item" "$alt" >/dev/null 2>&1; then
          normalized+=("$item -> $alt")
        else
          errors+=("merge conflict move failed: $item -> $alt")
        fi
      fi
    else
      if mv "$item" "$dst/" >/dev/null 2>&1; then
        normalized+=("$item -> $dst/")
      else
        errors+=("merge move failed: $item -> $dst")
      fi
    fi
  done
  shopt -u dotglob nullglob

  rmdir "$src" >/dev/null 2>&1 || true
}

normalize_count_suffix_children() {
  local parent="$1"
  [ -d "$parent" ] || return 0

  shopt -s nullglob
  local d=""
  for d in "$parent"/*; do
    [ -d "$d" ] || continue
    local bn
    bn="$(basename "$d")"
    local base
    base="$(strip_count_suffix "$bn")"
    if [ "$bn" = "$base" ]; then
      continue
    fi
    local canonical="$parent/$base"
    if [ -e "$canonical" ] && [ ! -d "$canonical" ]; then
      errors+=("normalize skipped (not directory): $canonical")
      continue
    fi
    if [ -d "$canonical" ]; then
      merge_tree "$d" "$canonical"
      normalized+=("$d -> $canonical (merged)")
    else
      if mv "$d" "$canonical" >/dev/null 2>&1; then
        normalized+=("$d -> $canonical (renamed)")
      else
        errors+=("normalize rename failed: $d -> $canonical")
      fi
    fi
  done
  shopt -u nullglob
}

resolve_dir() {
  local parent="$1"
  local base="$2"
  if [ -d "$parent/$base" ]; then
    echo "$parent/$base"
    return 0
  fi
  mkdir -p "$parent/$base" >/dev/null 2>&1 || return 1
  created+=("$parent/$base")
  echo "$parent/$base"
}

for d in "\${dirs[@]}"; do
  if [ -d "$d" ]; then
    existing+=("$d")
  else
    if mkdir -p "$d" >/dev/null 2>&1; then
      created+=("$d")
    else
      errors+=("mkdir failed: $d")
      continue
    fi
  fi

  testf="$d/.3jtv_perm_test"
  if touch "$testf" >/dev/null 2>&1 && rm -f "$testf" >/dev/null 2>&1; then
    :
  else
    errors+=("not writable: $d")
  fi
done

# Ensure final structure: Movies/<Category>/<Genre> and Series/<Genre>
mkdir -p "$MOVIES_ROOT" "$SERIES_ROOT" >/dev/null 2>&1 || true
normalize_count_suffix_children "$MOVIES_ROOT"
normalize_count_suffix_children "$SERIES_ROOT"

for c in "\${MOVIE_CATEGORIES[@]}"; do
  catDir="$(resolve_dir "$MOVIES_ROOT" "$c" || true)"
  if [ -z "$catDir" ]; then errors+=("mkdir failed: $MOVIES_ROOT/$c"); continue; fi
  normalize_count_suffix_children "$catDir"
  for g in "\${MOVIE_GENRES[@]}"; do
    [ -n "$g" ] || continue
    genDir="$(resolve_dir "$catDir" "$g" || true)"
    if [ -z "$genDir" ]; then errors+=("mkdir failed: $catDir/$g"); continue; fi
    existing+=("$genDir")
  done
  existing+=("$catDir")
done

for g in "\${TV_GENRES[@]}"; do
  [ -n "$g" ] || continue
  genDir="$(resolve_dir "$SERIES_ROOT" "$g" || true)"
  if [ -z "$genDir" ]; then errors+=("mkdir failed: $SERIES_ROOT/$g"); continue; fi
  existing+=("$genDir")
done
normalize_count_suffix_children "$SERIES_ROOT"

echo "__CREATED__"
printf "%s\n" "\${created[@]}"
echo "__EXISTING__"
printf "%s\n" "\${existing[@]}"
echo "__NORMALIZED__"
printf "%s\n" "\${normalized[@]}"
echo "__ERRORS__"
printf "%s\n" "\${errors[@]}"
echo "__END__"
`;

  const ssh = sshFromEngineHost(engineHost);
  try {
    const mountStatus = await fetchMountStatus({ ssh });
    if (!mountStatus?.mounted || !mountStatus?.writable) {
      throw new Error('NAS is not mounted/writable. Mount the NAS first, then run Scan & Validate Library.');
    }

    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 60000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'Failed to create folders.');
    const out = String(r.stdout || '');
    const section = (name) => {
      const start = out.indexOf(`__${name}__`);
      if (start < 0) return [];
      const rest = out.slice(start + name.length + 4);
      const end = rest.indexOf('__');
      const block = end >= 0 ? rest.slice(0, end) : rest;
      return block
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    };
    const created = section('CREATED');
    const existing = section('EXISTING');
    const normalized = section('NORMALIZED');
    const errors = section('ERRORS');
    return { ok: errors.length === 0, created, existing, normalized, errors };
  } finally {
    await ssh.close();
  }
}

export async function repairMount() {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const s = await getMountSettings();
  if (!s) throw new Error('No NAS mount settings configured.');
  const mountDir = sanitizeMountDir(s.mountDir);

  const script = `
set -euo pipefail
MOUNT_DIR=${JSON.stringify(mountDir)}
umount -f "$MOUNT_DIR" >/dev/null 2>&1 || true
mount -a >/dev/null 2>&1 || true
/usr/local/bin/3jtv-mount-health-check "$MOUNT_DIR" "/var/lib/3jtv/mount-status.json" >/dev/null 2>&1 || true
echo "OK"
`;

  const ssh = sshFromEngineHost(engineHost);
  try {
    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 120000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'Repair failed.');
    const status = await fetchMountStatus({ ssh });
    await setMountStatus(status);
    return { ok: true, status };
  } finally {
    await ssh.close();
  }
}

export async function unmountShare() {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const s = await getMountSettings();
  if (!s) throw new Error('No NAS mount settings configured.');
  const mountDir = sanitizeMountDir(s.mountDir);

  const script = `
set -euo pipefail
MOUNT_DIR=${JSON.stringify(mountDir)}
CREDS_FILE="/etc/samba/credentials/iptv_nas.creds"

# Remove managed fstab entry (idempotent)
awk -v mdir="$MOUNT_DIR" -v creds="$CREDS_FILE" '
  $0 ~ /^[[:space:]]*# 3JTV_CIFS_AUTOMOUNT/ {next}
  ($2 == mdir && $3 == "cifs") {next}
  index($0, creds) > 0 {next}
  {print}
' /etc/fstab > /tmp/fstab.3jtv.tmp
cp /tmp/fstab.3jtv.tmp /etc/fstab

systemctl daemon-reload >/dev/null 2>&1 || true
systemctl disable --now 3jtv-mount-health.timer >/dev/null 2>&1 || true

# Unmount all stacked mounts for this mountpoint (if any).
for _ in 1 2 3 4 5; do
  grep -q -F " $MOUNT_DIR " /proc/self/mounts 2>/dev/null || break
  umount -f "$MOUNT_DIR" >/dev/null 2>&1 || umount -l "$MOUNT_DIR" >/dev/null 2>&1 || true
done
/usr/local/bin/3jtv-mount-health-check "$MOUNT_DIR" "/var/lib/3jtv/mount-status.json" >/dev/null 2>&1 || true
echo "OK"
`;

  const ssh = sshFromEngineHost(engineHost);
  try {
    const r = await ssh.execScript(script, { sudo: true, timeoutMs: 60000 });
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'Unmount failed.');
    const status = await fetchMountStatus({ ssh });
    await setMountStatus(status);
    return { ok: true, status };
  } finally {
    await ssh.close();
  }
}

export async function fetchMountStatus({ ssh: injectedSsh = null } = {}) {
  const engineHost = await getEngineHost();
  if (!engineHost) throw new Error('No Engine Host configured.');
  const s = await getMountSettings();
  if (!s) throw new Error('No NAS mount settings configured.');

  const mountDir = sanitizeMountDir(s.mountDir);
  const expectedSource = `//${sanitizeHost(s.windowsHost)}/${sanitizeShare(s.shareName)}`.toLowerCase();
  const smbVersion = sanitizeSmbVersion(s.smbVersion || '');
  const uid = sanitizeUidGid(s.uid, 'xui');
  const gid = sanitizeUidGid(s.gid, 'xui');
  const versOpt = smbVersion ? `,vers=${smbVersion}` : '';
  const cifsOptionsBase = `credentials=/etc/samba/credentials/iptv_nas.creds,iocharset=utf8,file_mode=0775,dir_mode=0775${versOpt}`;

  const ssh = injectedSsh || sshFromEngineHost(engineHost);
  const owns = !injectedSsh;
  try {
    const probeScript = `
set -euo pipefail
cd /

MOUNT_DIR=${JSON.stringify(mountDir)}
EXPECTED_SOURCE=${JSON.stringify(expectedSource)}
UID_OPT=${JSON.stringify(uid)}
GID_OPT=${JSON.stringify(gid)}
OPTS_BASE=${JSON.stringify(cifsOptionsBase)}

uid_num="$UID_OPT"
gid_num="$GID_OPT"
if ! printf '%s' "$uid_num" | grep -Eq '^[0-9]+$'; then
  uid_num="$(id -u "$uid_num" 2>/dev/null || echo 0)"
fi
if ! printf '%s' "$gid_num" | grep -Eq '^[0-9]+$'; then
  gid_num="$(getent group "$gid_num" 2>/dev/null | cut -d: -f3 | head -n1 || true)"
  [ -n "$gid_num" ] || gid_num="$(id -g "$UID_OPT" 2>/dev/null || echo 0)"
fi
OPTS="$OPTS_BASE,uid=$uid_num,gid=$gid_num"

read_source() {
  grep -m1 -F " $MOUNT_DIR " /proc/self/mounts 2>/dev/null | cut -d' ' -f1 || true
}

marker="$(grep -c '^[[:space:]]*# 3JTV_CIFS_AUTOMOUNT' /etc/fstab 2>/dev/null || true)"
line="$(grep -v '^[[:space:]]*#' /etc/fstab 2>/dev/null | grep -F " $MOUNT_DIR " | grep -m1 ' cifs ' || true)"
fstab_present=false
if [ "$marker" != "0" ] || [ -n "$line" ]; then
  fstab_present=true
fi

source="$(read_source)"
source_lc="$(printf '%s' "$source" | tr '[:upper:]' '[:lower:]')"
mounted=false
if [ -n "$source" ] && { [ "$source_lc" = "$EXPECTED_SOURCE" ] || printf '%s' "$source_lc" | grep -q '^//'; }; then
  mounted=true
fi

mount_err=""
if [ "$mounted" != "true" ] && [ "$fstab_present" = "true" ]; then
  mount_err="$(mkdir -p "$MOUNT_DIR" >/dev/null 2>&1; mount -t cifs "$EXPECTED_SOURCE" "$MOUNT_DIR" -o "$OPTS" 2>&1 || true)"
  source="$(read_source)"
  source_lc="$(printf '%s' "$source" | tr '[:upper:]' '[:lower:]')"
  if [ -n "$source" ] && { [ "$source_lc" = "$EXPECTED_SOURCE" ] || printf '%s' "$source_lc" | grep -q '^//'; }; then
    mounted=true
  else
    mounted=false
  fi
fi

writable=false
err_msg="Not mounted"
if [ "$mounted" = "true" ]; then
  test_file="$MOUNT_DIR/.3jtv_status_test_$$"
  if touch "$test_file" >/dev/null 2>&1 && rm -f "$test_file" >/dev/null 2>&1; then
    writable=true
    err_msg=""
  else
    err_msg="Mount not writable"
  fi
else
  if [ -n "$mount_err" ]; then err_msg="$mount_err"; fi
fi

total=0
used=0
avail=0
if [ "$mounted" = "true" ]; then
  set -- $(df -B1 "$MOUNT_DIR" 2>/dev/null | tail -n 1 || true)
  total="\${2:-0}"
  used="\${3:-0}"
  avail="\${4:-0}"
fi

echo "__MOUNTED__"
echo "$mounted"
echo "__WRITABLE__"
echo "$writable"
echo "__ERROR__"
echo "$err_msg"
echo "__MARKER__"
echo "$marker"
echo "__LINE__"
echo "$line"
echo "__SOURCE__"
echo "$source"
echo "__TOTAL__"
echo "$total"
echo "__USED__"
echo "$used"
echo "__AVAIL__"
echo "$avail"
`;

    const probe = await ssh.execScript(probeScript, { sudo: true, timeoutMs: 45000 });
    const out = String(probe.stdout || '');
    const pick = (tag) => {
      const i = out.indexOf(tag);
      if (i < 0) return '';
      const rest = out.slice(i + tag.length);
      const line = rest.split('\n')[1] ?? '';
      return String(line || '').trim();
    };

    const mounted = pick('__MOUNTED__') === 'true';
    const writable = pick('__WRITABLE__') === 'true';
    const error = pick('__ERROR__');
    const fstabMarkerCount = Number(pick('__MARKER__')) || 0;
    const fstabLine = pick('__LINE__');
    const findmntSource = pick('__SOURCE__');
    const total = Number(pick('__TOTAL__')) || 0;
    const used = Number(pick('__USED__')) || 0;
    const avail = Number(pick('__AVAIL__')) || 0;
    const fstabPresent = Boolean(fstabMarkerCount > 0 || fstabLine);

    const status = {
      checkedAt: now(),
      ok: Boolean(mounted && writable),
      mounted,
      writable,
      mountDir,
      error: mounted && writable ? '' : error || 'Not mounted',
      space: { total, used, avail },
      fstabPresent,
      fstabLine: fstabLine || '',
      findmntSource: findmntSource || '',
    };

    await setMountStatus(status);
    return status;
  } finally {
    if (owns) await ssh.close();
  }
}
