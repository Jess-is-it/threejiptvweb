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
      // Used by the UI to render server labels and by some API routes (health/login)
      // when env vars are not set.
      servers: ['https://tv1.3jxentro.net/', 'https://tv2.3jxentro.net/'],
    },
    catalog: JSON.parse(JSON.stringify(DEFAULT_CATALOG_SETTINGS)),
  };
}
