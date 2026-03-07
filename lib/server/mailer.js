import 'server-only';

import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

import { getSecret } from './secrets';

function mask(s) {
  const v = String(s || '');
  if (!v) return '';
  return `${v.slice(0, 2)}…${v.slice(-2)}`;
}

function parseBool(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return null;
}

function dotStuff(text) {
  return String(text || '')
    .replace(/\r?\n/g, '\r\n')
    .replace(/^\./gm, '..');
}

function isEmail(s) {
  return String(s || '').includes('@');
}

async function getMailerConfig() {
  const mailFrom = (await getSecret('mailFrom')) || process.env.MAIL_FROM || '';
  const mailUser = (await getSecret('mailUser')) || process.env.MAIL_USER || '';
  const mailPass = (await getSecret('mailPass')) || process.env.MAIL_PASS || '';

  if (!mailUser || !mailPass) {
    throw new Error('Mailer is not configured. Set MAIL_USER and MAIL_PASS in Admin Secrets.');
  }
  const from = String(mailFrom || mailUser).trim();
  if (!from || !isEmail(from)) throw new Error('MAIL_FROM is invalid. Set a valid email in Admin Secrets.');

  const envHost = process.env.MAIL_HOST || '';
  const envPort = process.env.MAIL_PORT || '';
  const envSecure = process.env.MAIL_SECURE || '';

  const host =
    String(envHost).trim() ||
    (String(mailUser).toLowerCase().includes('@gmail.') ? 'smtp.gmail.com' : 'smtp.gmail.com');

  const port = Number.parseInt(String(envPort || ''), 10) || 465;
  const secure = parseBool(envSecure);
  const useTls = secure === null ? port === 465 : secure;

  return {
    host,
    port,
    secure: useTls,
    from,
    auth: { user: String(mailUser).trim(), pass: String(mailPass) },
  };
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_resolve, reject) => {
    t = setTimeout(() => reject(new Error(label || `Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function createLineQueue(socket) {
  let buf = '';
  const queue = [];
  const waiters = [];

  const flush = () => {
    while (queue.length && waiters.length) {
      const w = waiters.shift();
      w.resolve(queue.shift());
    }
  };

  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, idx + 1);
      buf = buf.slice(idx + 1);
      const line = raw.replace(/\r?\n$/, '');
      queue.push(line);
    }
    flush();
  });

  const failAll = (err) => {
    while (waiters.length) waiters.shift().reject(err);
  };
  socket.on('error', (e) => failAll(e));
  socket.on('end', () => failAll(new Error('SMTP connection closed')));

  const nextLine = () =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      waiters.push({ resolve, reject });
    });

  return { nextLine };
}

async function readResponse(nextLine, { timeoutMs = 20000 } = {}) {
  const first = await withTimeout(nextLine(), timeoutMs, 'SMTP timeout (greeting)');
  const m = String(first || '').match(/^(\d{3})([- ])(.*)$/);
  if (!m) return { code: 0, lines: [first] };
  const code = Number(m[1]);
  let sep = m[2];
  const lines = [first];
  while (sep === '-') {
    const line = await withTimeout(nextLine(), timeoutMs, 'SMTP timeout (multiline)');
    lines.push(line);
    const mm = String(line || '').match(/^(\d{3})([- ])(.*)$/);
    if (mm && mm[1] === m[1]) sep = mm[2];
    else sep = ' ';
  }
  return { code, lines };
}

async function smtpSend({ host, port, secure, auth, from, to, subject, text }) {
  let socket = await new Promise((resolve, reject) => {
    const s = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }, () => resolve(s))
      : net.connect({ host, port }, () => resolve(s));
    s.once('error', reject);
  });

  let lineQueue = createLineQueue(socket);

  const write = (line) => socket.write(`${line}\r\n`);
  const expect = async (codes, label) => {
    const { code, lines } = await readResponse(lineQueue.nextLine, { timeoutMs: 20000 });
    const ok = Array.isArray(codes) ? codes.includes(code) : code === codes;
    if (!ok) {
      const msg = lines.join(' | ');
      throw new Error(`${label || 'SMTP error'} (${code}): ${msg}`);
    }
    return { code, lines };
  };

  try {
    await expect(220, 'SMTP greeting');

    const heloId = `3jtv-${crypto.randomBytes(6).toString('hex')}`;
    write(`EHLO ${heloId}`);
    await expect(250, 'SMTP EHLO');

    if (!secure) {
      write('STARTTLS');
      await expect(220, 'SMTP STARTTLS');

      socket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: host, rejectUnauthorized: true }, () => resolve(t));
        t.once('error', reject);
      });
      lineQueue = createLineQueue(socket);

      // After STARTTLS, servers expect a new EHLO.
      write(`EHLO ${heloId}`);
      await expect(250, 'SMTP EHLO (TLS)');
    }

    write('AUTH LOGIN');
    await expect(334, 'SMTP AUTH');
    write(Buffer.from(auth.user, 'utf8').toString('base64'));
    await expect(334, 'SMTP AUTH user');
    write(Buffer.from(auth.pass, 'utf8').toString('base64'));
    await expect(235, 'SMTP AUTH pass');

    write(`MAIL FROM:<${from}>`);
    await expect([250, 251], 'SMTP MAIL FROM');
    write(`RCPT TO:<${to}>`);
    await expect([250, 251], 'SMTP RCPT TO');
    write('DATA');
    await expect(354, 'SMTP DATA');

    const headers = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@3jtv.local>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ].join('\r\n');

    const body = `${headers}\r\n\r\n${dotStuff(text)}\r\n.\r\n`;
    socket.write(body);
    await expect(250, 'SMTP send');

    write('QUIT');
    await expect(221, 'SMTP quit');
  } finally {
    try {
      socket.end();
    } catch {}
  }

  return true;
}

export async function sendMail({ to, subject, text }) {
  const cfg = await getMailerConfig();
  if (!to || !isEmail(to)) throw new Error('Recipient email is invalid.');
  return smtpSend({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
    from: cfg.from,
    to: String(to).trim(),
    subject: String(subject || '3J TV').trim(),
    text: String(text || '').trim(),
  }).catch((e) => {
    const extra = `[SMTP ${cfg.host}:${cfg.port} from ${mask(cfg.from)} as ${mask(cfg.auth?.user)}]`;
    throw new Error(`${e?.message || 'Failed to send email.'} ${extra}`);
  });
}
