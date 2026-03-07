/** @type {import('next').NextConfig} */
const nextConfig = {
    // Keep production output in `.next`, but isolate dev builds to avoid
    // permission/corruption issues when `.next` was previously created by a different user.
    distDir: process.env.NEXT_DIST_DIR || '.next',
    reactStrictMode: true,
    // Avoid bundling native modules (ssh2 includes optional .node bindings).
    serverExternalPackages: ['ssh2'],
    experimental: {
        // This project runs on constrained hosts sometimes; using fewer build workers
        // reduces flaky "build worker exited" failures during static generation.
        cpus: 1
    },
    async headers() {
        // Prevent browsers/proxies from caching HTML for admin pages.
        // Cached HTML can reference old hashed chunk filenames after redeploy/restart,
        // causing ChunkLoadError in the browser.
        return [
            {
                source: '/admin/:path*',
                headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }]
            },
            {
                source: '/api/admin/:path*',
                headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }]
            }
        ];
    }
};

module.exports = nextConfig;
