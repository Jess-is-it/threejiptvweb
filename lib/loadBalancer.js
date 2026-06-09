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

  return list;
}

export function pickServer(servers) {
  if (!servers?.length) return null;
  const idx = Math.floor(Date.now() / 1000) % servers.length; // simple round-robin
  return servers[idx];
}
