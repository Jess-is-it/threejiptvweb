// lib/loadBalancer.js
export function parseServers() {
  const raw =
    process.env.XUI_SERVERS ||
    process.env.NEXT_PUBLIC_XUI_SERVERS ||
    '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((u) => ({ origin: new URL(u).origin }));

  // fallback to your two known servers
  return list.length
    ? list
    : [
        { origin: 'https://tv1.3jxentro.net' },
        { origin: 'https://tv2.3jxentro.net' },
      ];
}

export function pickServer(servers) {
  if (!servers?.length) return null;
  const idx = Math.floor(Date.now() / 1000) % servers.length; // simple round-robin
  return servers[idx];
}
