const securityHeaders = [
    { key: 'X-DNS-Prefetch-Control', value: 'on' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    {
        key: 'Content-Security-Policy',
        value: [
            "default-src 'self'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
            "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https: http:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "media-src 'self' data: blob: https: http:",
            "connect-src 'self' https: http: ws: wss: https://cloudflareinsights.com https://*.cloudflareinsights.com",
            "worker-src 'self' blob:",
            "frame-src https://challenges.cloudflare.com blob:",
            "child-src https://challenges.cloudflare.com blob:",
            "manifest-src 'self'",
        ].join('; '),
    },
];

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
                source: '/:path*',
                headers: securityHeaders
            },
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
