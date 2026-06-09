import { DEFAULT_CATALOG_SETTINGS } from './catalogSettings';

export function defaultPublicSettings() {
  return {
    version: 1,
    brand: {
      name: '3J TV',
      color: '#FA5252',
      logoUrl: '/brand/logo.svg',
    },
    ui: {
      // Default behavior for movie cards on click:
      // - 'play': play immediately
      // - 'preview': open trailer preview modal first
      defaultMovieCardClickAction: 'play',
    },
    login: {
      backgroundDesktopUrl: '/auth/login-bg.jpg',
      backgroundMobileUrl: '/auth/login-bg-mobile.jpg',
      helpLinkUrl: 'https://www.facebook.com/threejfiberwifi',
      helpLinkText: 'FB Page',
    },
    xuione: {
      // Legacy shape only. Playback servers are now managed in XUI Integration.
      servers: [],
    },
    publicHttps: {
      enabled: false,
      provider: 'cloudflare_tunnel',
      domain: '3jhotspot.com',
      publicHostname: 'tv.3jhotspot.com',
      publicUrl: 'https://tv.3jhotspot.com',
      localServiceUrl: 'http://127.0.0.1:3000',
      notes: '',
    },
    security: {
      turnstile: {
        enabled: false,
        siteKey: '',
        protectPublicLogin: true,
        protectAdminLogin: true,
        protectAdminForgotPassword: true,
        enforcePublicHostOnly: true,
      },
    },
    catalog: JSON.parse(JSON.stringify(DEFAULT_CATALOG_SETTINGS)),
  };
}
