import 'server-only';

export const ERROR_CATEGORY = {
  DNS: 'DNS',
  HTTP: 'HTTP',
  NETWORK: 'NETWORK',
  AUTH: 'AUTH',
  BLOCKED: 'BLOCKED',
  PARSE: 'PARSE',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
};

function now() {
  return Date.now();
}

export class ProviderError extends Error {
  constructor(message, meta = {}) {
    super(String(message || 'Provider error'));
    this.name = 'ProviderError';
    this.category = meta.category || ERROR_CATEGORY.UNKNOWN;
    this.httpStatus = Number.isFinite(Number(meta.httpStatus)) ? Number(meta.httpStatus) : null;
    this.url = meta.url ? String(meta.url) : '';
    this.domainUsed = meta.domainUsed ? String(meta.domainUsed) : '';
    this.details = meta.details && typeof meta.details === 'object' ? meta.details : {};
  }
}

export class ProviderAdapter {
  constructor(provider) {
    this.provider = provider || null;
  }

  get key() {
    return String(this.provider?.key || '').trim().toLowerCase();
  }

  async test(_opts = {}) {
    throw new Error('Provider adapter test() not implemented.');
  }

  async search(_opts = {}) {
    throw new Error('Provider adapter search() not implemented.');
  }
}

export function sanitizeResponseSnippet(raw, max = 500) {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

export function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/');
}

export function normalizeDomain(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.hash = '';
    u.search = '';
    u.pathname = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function extractBtih(magnetOrHash) {
  const raw = String(magnetOrHash || '').trim();
  if (!raw) return '';

  // Already a hash.
  if (/^[a-fA-F0-9]{40}$/.test(raw)) return raw.toUpperCase();

  const m = raw.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (m?.[1]) return String(m[1]).toUpperCase();

  return '';
}

export function parseSizeToGb(raw) {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    // Heuristic: huge numbers are bytes.
    if (n > 1024 * 1024 * 16) return n / (1024 ** 3);
    return n;
  }

  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*(bytes?|kb|kib|mb|mib|gb|gib|tb|tib)/i);
  if (!m) return null;
  const v = Number(m[1]);
  const u = String(m[2] || '').toLowerCase();
  if (!Number.isFinite(v) || v <= 0) return null;

  if (u.startsWith('tb')) return v * 1024;
  if (u.startsWith('ti')) return v * 1024;
  if (u.startsWith('gb')) return v;
  if (u.startsWith('gi')) return v;
  if (u.startsWith('mb')) return v / 1024;
  if (u.startsWith('mi')) return v / 1024;
  if (u.startsWith('kb')) return v / (1024 ** 2);
  if (u.startsWith('ki')) return v / (1024 ** 2);
  return v / (1024 ** 3);
}

export function hasBlockedSignature(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return false;
  return (
    s.includes('captcha') ||
    s.includes('attention required') ||
    s.includes('verify you are human') ||
    s.includes('checking your browser before accessing') ||
    s.includes('just a moment...') ||
    s.includes('/cdn-cgi/challenge-platform') ||
    s.includes('cf_chl_') ||
    s.includes('cf-chl-') ||
    s.includes('cloudflare challenge') ||
    s.includes('access denied') ||
    s.includes('ddos-guard') ||
    s.includes('bot protection')
  );
}

export function categorizeHttpFailure({ status, bodySnippet = '' } = {}) {
  const code = Number(status || 0) || 0;
  if (code === 401) return ERROR_CATEGORY.HTTP;
  if (code === 403 || code === 429) return ERROR_CATEGORY.BLOCKED;
  if (code >= 400 && code < 500) return hasBlockedSignature(bodySnippet) ? ERROR_CATEGORY.BLOCKED : ERROR_CATEGORY.HTTP;
  if (code >= 500) return ERROR_CATEGORY.HTTP;
  return ERROR_CATEGORY.UNKNOWN;
}

export function toProviderError(err, fallback = {}) {
  if (err instanceof ProviderError) return err;

  const message = String(err?.message || 'Provider request failed');
  const lower = message.toLowerCase();

  let category = fallback.category || ERROR_CATEGORY.UNKNOWN;
  if (lower.includes('abort') || lower.includes('timed out') || lower.includes('timeout')) category = ERROR_CATEGORY.TIMEOUT;
  else if (lower.includes('enotfound')) category = ERROR_CATEGORY.DNS;
  else if (lower.includes('http')) category = ERROR_CATEGORY.HTTP;
  else if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('enotfound') || lower.includes('econn'))
    category = ERROR_CATEGORY.NETWORK;

  return new ProviderError(message, {
    category,
    httpStatus: fallback.httpStatus ?? null,
    url: fallback.url || '',
    domainUsed: fallback.domainUsed || '',
    details: fallback.details || {},
  });
}

export async function fetchWithTimeout(url, opts = {}) {
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 15000) || 15000);
  const headers = {
    'user-agent': '3J-TV-SourceEngine/1.0',
    accept: '*/*',
    ...(opts.headers && typeof opts.headers === 'object' ? opts.headers : {}),
  };

  const startedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Timeout exceeded')), timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    const durationMs = Math.max(1, now() - startedAt);

    return {
      ok: res.ok,
      status: res.status,
      url: res.url || String(url),
      text,
      durationMs,
      headers: Object.fromEntries(res.headers.entries()),
    };
  } catch (e) {
    const lower = String(e?.message || '').toLowerCase();
    if (lower.includes('abort') || lower.includes('timeout')) {
      throw new ProviderError('Upstream timeout', {
        category: ERROR_CATEGORY.TIMEOUT,
        url: String(url),
      });
    }

    const causeCode = String(e?.cause?.code || '').toUpperCase();
    const causeHost = String(e?.cause?.hostname || '').trim();
    const causeMessage = String(e?.cause?.message || '').trim();

    let requestHost = '';
    try {
      requestHost = new URL(String(url)).hostname || '';
    } catch {}

    let message = String(e?.message || 'Network request failed');
    if (causeCode === 'ENOTFOUND') {
      const target = causeHost || requestHost || 'upstream host';
      message = `DNS lookup failed for ${target} (ENOTFOUND)`;
      throw new ProviderError(message, {
        category: ERROR_CATEGORY.DNS,
        url: String(url),
        details: {
          cause: e?.cause ? String(e.cause) : '',
          causeCode,
          causeHost,
          causeMessage,
        },
      });
    } else if (causeCode === 'ECONNREFUSED') {
      message = 'Connection refused by upstream host (ECONNREFUSED)';
    } else if (causeCode === 'ECONNRESET') {
      message = 'Upstream connection reset (ECONNRESET)';
    } else if (causeCode === 'EHOSTUNREACH') {
      message = 'Upstream host unreachable (EHOSTUNREACH)';
    }

    throw new ProviderError(message, {
      category: ERROR_CATEGORY.NETWORK,
      url: String(url),
      details: {
        cause: e?.cause ? String(e.cause) : '',
        causeCode,
        causeHost,
        causeMessage,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}
