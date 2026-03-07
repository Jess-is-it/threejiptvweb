import 'server-only';

import { decryptString, encryptString } from '../vault';
import { getEngineHost, upsertEngineHost } from './autodownloadDb';
import { SSHService } from './sshService';

function redactHost(host) {
  if (!host) return '';
  const s = String(host);
  if (s.length <= 6) return '***';
  return `${s.slice(0, 3)}…${s.slice(-2)}`;
}

function now() {
  return Date.now();
}

export async function getEngineHostSafe() {
  const h = await getEngineHost();
  if (!h) return null;
  return {
    id: h.id,
    host: h.host,
    port: h.port,
    username: h.username,
    authType: h.authType,
    hasSecret: Boolean(h.passwordEnc || h.privateKeyEnc),
    hasSudoPassword: Boolean(h.sudoPasswordEnc),
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    lastTestAt: h.lastTestAt || null,
    lastTestOk: h.lastTestOk ?? null,
    lastTestSummary: h.lastTestSummary || '',
    lastTestDetails: h.lastTestDetails || null,
    lastError: h.lastError || '',
  };
}

export async function upsertEngineHostFromAdminInput(input) {
  const host = String(input?.host || '').trim();
  const port = Number(input?.port || 22) || 22;
  const username = String(input?.username || '').trim();
  const authType = input?.authType === 'privateKey' ? 'privateKey' : 'password';

  const password = String(input?.password || '');
  const privateKey = String(input?.privateKey || '');
  const passphrase = String(input?.passphrase || '');
  const sudoPassword = String(input?.sudoPassword || '');

  if (!host) throw new Error('Host is required.');
  if (!username) throw new Error('Username is required.');

  const next = {
    host,
    port,
    username,
    authType,
  };

  if (authType === 'password') {
    if (!password) throw new Error('SSH password is required.');
    next.passwordEnc = encryptString(password);
    next.privateKeyEnc = null;
    next.passphraseEnc = null;
  } else {
    if (!privateKey) throw new Error('Private key is required.');
    next.privateKeyEnc = encryptString(privateKey);
    next.passphraseEnc = passphrase ? encryptString(passphrase) : null;
    next.passwordEnc = null;
  }

  next.sudoPasswordEnc = sudoPassword ? encryptString(sudoPassword) : null;
  next.lastError = '';
  return upsertEngineHost(next);
}

export async function testEngineHostConnection() {
  const h = await getEngineHost();
  if (!h) throw new Error('No Engine Host configured.');

  const ssh = new SSHService({
    host: h.host,
    port: h.port,
    username: h.username,
    authType: h.authType,
    password: h.passwordEnc ? decryptString(h.passwordEnc) : '',
    privateKey: h.privateKeyEnc ? decryptString(h.privateKeyEnc) : '',
    passphrase: h.passphraseEnc ? decryptString(h.passphraseEnc) : '',
    sudoPassword: h.sudoPasswordEnc ? decryptString(h.sudoPasswordEnc) : '',
  });

  const startedAt = now();
  let summary = '';
  try {
    await ssh.connect({ timeoutMs: 15000 });

    const who = await ssh.exec('whoami', { timeoutMs: 10000 });
    if (who.code !== 0) throw new Error(`SSH command failed: whoami (${who.code})`);

    const os = await ssh.exec('cat /etc/os-release 2>/dev/null || true', { timeoutMs: 10000 });
    const osText = String(os.stdout || '');
    const hasUbuntu = /ubuntu/i.test(osText);
    const name = (osText.match(/^NAME="?([^"\n]+)"?/m) || [])[1] || '';
    const version = (osText.match(/^VERSION_ID="?([^"\n]+)"?/m) || [])[1] || '';
    const pretty = (osText.match(/^PRETTY_NAME="?([^"\n]+)"?/m) || [])[1] || '';

    const pm = await ssh.exec('command -v apt-get || command -v dnf || command -v yum || true', { timeoutMs: 10000 });
    const pmPath = String(pm.stdout || '').trim();
    const pmOk = Boolean(pmPath);

    // sudo test: if passwordless sudo is enabled, this succeeds. If not, user must provide sudoPassword.
    const sudoTest = await ssh.exec('true', { sudo: true, timeoutMs: 10000 });
    const sudoOk = sudoTest.code === 0;

    summary = `Connected as ${String(who.stdout || '').trim()} · ${hasUbuntu ? 'Ubuntu' : 'Linux'} · pkg:${
      pmOk ? 'ok' : 'missing'
    } · sudo:${sudoOk ? 'ok' : 'needs-password'}`;

    await upsertEngineHost({
      lastTestAt: now(),
      lastTestOk: pmOk && sudoOk,
      lastTestSummary: summary,
      lastTestDetails: {
        user: String(who.stdout || '').trim(),
        os: {
          name: name || (hasUbuntu ? 'Ubuntu' : ''),
          version,
          pretty,
          raw: osText.slice(0, 4000),
        },
        packageManager: pmPath || '',
        sudoOk,
      },
      lastError: sudoOk && pmOk ? '' : !sudoOk ? 'Sudo check failed. Provide sudo password if required.' : 'No package manager found.',
    });

    return { ok: pmOk && sudoOk, summary, details: { ubuntu: hasUbuntu, packageManager: pmOk, sudo: sudoOk } };
  } catch (e) {
    const msg = e?.message || 'SSH test failed.';
    await upsertEngineHost({
      lastTestAt: now(),
      lastTestOk: false,
      lastTestSummary: `Failed to connect (${redactHost(h.host)})`,
      lastError: msg,
    });
    throw new Error(msg);
  } finally {
    await ssh.close();
    const dur = Date.now() - startedAt;
    if (!summary) summary = `Failed (${dur}ms)`;
  }
}
