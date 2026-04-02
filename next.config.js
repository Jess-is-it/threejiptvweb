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
    images: {
        formats: ['image/avif', 'image/webp'],
        minimumCacheTTL: 60 * 60 * 24 * 30,
        deviceSizes: [640, 768, 828, 1024, 1280, 1536, 1920],
        imageSizes: [160, 210, 342, 500]
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
