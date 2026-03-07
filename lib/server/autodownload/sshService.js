import 'server-only';

import { Client } from 'ssh2';

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function safeTrim(s, max = 10_000_000) {
  const str = String(s || '');
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n…(truncated ${str.length - max} chars)`;
}

export class SSHService {
  /**
   * @param {object} opts
   * @param {string} opts.host
   * @param {number} [opts.port]
   * @param {string} opts.username
   * @param {'password'|'privateKey'} opts.authType
   * @param {string} [opts.password]
   * @param {string} [opts.privateKey]
   * @param {string} [opts.passphrase]
   * @param {string} [opts.sudoPassword]
   */
  constructor(opts) {
    this.opts = opts || {};
    this.client = new Client();
    this.connected = false;
  }

  async connect({ timeoutMs = 15000 } = {}) {
    if (this.connected) return;

    const { host, port = 22, username, authType } = this.opts;
    if (!host || !username || !authType) throw new Error('SSH config is incomplete.');

    const connectOpts = {
      host,
      port: Number(port) || 22,
      username,
      readyTimeout: timeoutMs,
      keepaliveInterval: 15000,
      keepaliveCountMax: 2,
    };

    if (authType === 'password') {
      connectOpts.password = String(this.opts.password || '');
      if (!connectOpts.password) throw new Error('SSH password is missing.');
    } else if (authType === 'privateKey') {
      connectOpts.privateKey = String(this.opts.privateKey || '');
      if (!connectOpts.privateKey) throw new Error('SSH private key is missing.');
      if (this.opts.passphrase) connectOpts.passphrase = String(this.opts.passphrase);
    } else {
      throw new Error('Unsupported SSH authType.');
    }

    this.client.connect(connectOpts);
    const err = await Promise.race([
      once(this.client, 'ready').then(() => null),
      once(this.client, 'error'),
    ]);
    if (err) throw err;
    this.connected = true;
  }

  async close() {
    try {
      this.client.end();
    } catch {}
    this.connected = false;
  }

  async exec(command, { timeoutMs = 60000, sudo = false } = {}) {
    await this.connect();
    const cmd = sudo ? this.#sudoWrap(command) : command;

    const p = new Promise((resolve, reject) => {
      this.client.exec(cmd, { env: { LANG: 'C', LC_ALL: 'C' } }, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';
        const done = (code, signal) =>
          resolve({
            code: Number.isFinite(code) ? code : null,
            signal: signal || null,
            stdout: safeTrim(stdout),
            stderr: safeTrim(stderr),
          });

        stream.on('data', (d) => (stdout += d.toString('utf8')));
        stream.stderr.on('data', (d) => (stderr += d.toString('utf8')));
        stream.on('close', done);

        if (sudo) {
          const sudoPass = String(this.opts.sudoPassword || '');
          if (sudoPass) {
            // Feed sudo password once.
            try {
              stream.write(`${sudoPass}\n`);
            } catch {}
          }
        }
      });
    });

    if (!timeoutMs) return p;
    let t;
    const timeout = new Promise((_resolve, reject) => {
      t = setTimeout(() => reject(new Error(`SSH command timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
  }

  async execScript(script, { timeoutMs = 120000, sudo = false, args = [] } = {}) {
    await this.connect();
    const argStr = Array.isArray(args) ? args.map((a) => String(a)).join(' ') : '';
    const cmd = sudo ? this.#sudoWrap(`bash -s -- ${argStr}`) : `bash -s -- ${argStr}`;

    const p = new Promise((resolve, reject) => {
      this.client.exec(cmd, { env: { LANG: 'C', LC_ALL: 'C' } }, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        stream.on('data', (d) => (stdout += d.toString('utf8')));
        stream.stderr.on('data', (d) => (stderr += d.toString('utf8')));
        stream.on('close', (code, signal) =>
          resolve({
            code: Number.isFinite(code) ? code : null,
            signal: signal || null,
            stdout: safeTrim(stdout),
            stderr: safeTrim(stderr),
          })
        );

        if (sudo) {
          const sudoPass = String(this.opts.sudoPassword || '');
          if (sudoPass) {
            try {
              stream.write(`${sudoPass}\n`);
            } catch {}
          }
        }

        stream.end(`${String(script || '')}\n`);
      });
    });

    if (!timeoutMs) return p;
    let t;
    const timeout = new Promise((_resolve, reject) => {
      t = setTimeout(() => reject(new Error(`SSH script timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
  }

  #sudoWrap(cmd) {
    // -S: read password from stdin (we feed it)
    // -p '': avoid prompt text in stderr
    const script = String(cmd || '');
    // Use single-quote shell escaping so `$VAR` is expanded by the target shell,
    // not by an intermediate shell layer before command execution.
    const quoted = `'${script.replace(/'/g, `'\"'\"'`)}'`;
    return `sudo -S -p '' bash -lc ${quoted}`;
  }
}
