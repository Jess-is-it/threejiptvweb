export function publicHostFromSettings(settings = {}) {
  const host = String(settings?.publicHttps?.publicHostname || '').trim();
  if (host) return host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase();
  try {
    return new URL(settings?.publicHttps?.publicUrl || '').hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function turnstileApplies(settings = {}, flag = 'protectPublicLogin') {
  const config = settings?.security?.turnstile || {};
  if (config.enabled !== true) return false;
  if (config[flag] === false) return false;
  if (!String(config.siteKey || '').trim()) return false;

  if (config.enforcePublicHostOnly !== false) {
    if (typeof window === 'undefined') return false;
    const expectedHost = publicHostFromSettings(settings);
    if (expectedHost && window.location.hostname.toLowerCase() !== expectedHost) return false;
  }

  return true;
}
