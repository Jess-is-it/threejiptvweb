import 'server-only';

import { defaultPublicSettings } from '../settingsDefaults';
import { readJSON, writeJSON } from './blobStore';

const DB_KEY = 'db';

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function defaultDb() {
  return {
    version: 1,
    updatedAt: Date.now(),
    admins: [],
    sessions: {},
    secrets: {},
    settings: defaultPublicSettings(),
    reports: [],
    notifications: {},
    requestSettings: {
      enabled: true,
      dailyLimitDefault: 3,
      seriesEpisodeLimitDefault: 8,
      dailyLimitsByUsername: {},
      seriesEpisodeLimitsByUsername: {},
      defaultLandingCategory: 'popular',
      statusTags: {
        pending: 'Pending',
        approved: 'Approved',
        availableNow: 'Available Now',
        rejected: 'Rejected',
        archived: 'Archived',
      },
    },
    requests: [],
    // AutoDownload Engine + XUI One ingestion
    engineHosts: [],
    mountSettings: null,
    mountStatus: null,
    autodownloadSettings: {
      enabled: false,
      moviesEnabled: false,
      seriesEnabled: false,
      schedule: {
        timezone: 'UTC',
        // 0=Sun … 6=Sat
        days: [1, 2, 3, 4, 5, 6, 0],
        startTime: '00:00',
        endTime: '23:59',
      },
      storage: {
        limitGb: null,
        limitPercent: 95,
      },
      deletion: {
        enabled: false,
        triggerUsedGb: null,
        deleteBatchTargetGb: 50,
        deleteDelayDays: 3,
        previewRefreshTime: '00:00',
        protectRecentReleaseDays: 60,
        protectRecentWatchDays: 7,
        seriesEligibleThreshold: 10,
        maxSeriesPerBatch: 1,
        pauseSelectionWhileActive: true,
      },
      sizeLimits: {
        maxMovieGb: 2.5,
        maxEpisodeGb: null,
        maxSeasonTotalGb: null,
      },
      sourceFilters: {
        minMovieSeeders: 1,
        minSeriesSeeders: 1,
      },
      timeoutChecker: {
        enabled: false,
        maxWaitHours: 6,
        intervalMinutes: 15,
        strictSeriesReplacement: true,
        deletePartialSeriesOnReplacementFailure: true,
      },
      cleaning: {
        enabled: true,
        createMovieFolderIfMissing: true,
        templates: {
          movieFolder: '{title} ({year})-{quality}',
          movieFile: '{title} ({year})-{quality}',
          movieSubtitle: '{title} ({year})-{quality}.{lang}',
          seriesFolder: '{title} ({year})',
          seriesSeasonFolder: 'Season {season}',
          seriesEpisode: '{title} - S{season}E{episode}',
          seriesSubtitle: '{title} - S{season}E{episode}.{lang}',
        },
      },
      release: {
        delayDays: 3,
        timezone: 'Asia/Manila',
      },
      fileRules: {
        videoExtensions: ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts', 'webm'],
        subtitleExtensions: ['srt', 'ass', 'ssa', 'sub', 'vtt'],
        keepSubtitleLanguages: ['en', 'tl'],
        languagePatterns: {
          en: '(eng|english|en)',
          tl: '(tag|fil|filipino|tl)',
        },
        skipSample: true,
      },
      libraryFolders: {
        movies: {
          downloading: 'Downloading',
          downloaded: 'Downloaded and Processing',
          processing: 'Cleaned and Ready',
        },
        series: {
          downloading: 'Downloading',
          downloaded: 'Downloaded and Processing',
          processing: 'Cleaned and Ready',
        },
      },
      manualUploadFolders: {
        rootName: 'Manual Upload',
        movies: {
          processing: 'Processing',
          cleaned: 'Cleaned and Ready',
        },
        series: {
          processing: 'Processing',
          cleaned: 'Cleaned and Ready',
        },
      },
      categories: {
        categories: ['English', 'Asian'],
        defaultMoviesCategory: 'English',
        defaultSeriesCategory: 'English',
        defaultMovieGenreId: null,
        defaultSeriesGenreId: null,
      },
      movieSelectionStrategy: {
        recentMonthsRange: 5,
        classicYearStart: 1996,
        classicYearEnd: 2012,
        recentAnimationCount: 1,
        recentLiveActionCount: 3,
        classicAnimationCount: 1,
        classicLiveActionCount: 3,
      },
      seriesSelectionStrategy: {
        recentMonthsRange: 12,
        classicYearStart: 1990,
        classicYearEnd: 2018,
        recentAnimationCount: 1,
        recentLiveActionCount: 2,
        classicAnimationCount: 1,
        classicLiveActionCount: 2,
      },
      seriesPipelines: {
        newSeries: {
          enabled: true,
          acquisitionMode: 'season_pack',
          minSeeders: 8,
          maxEpisodeGb: 2.5,
          maxSeasonTotalGb: 14,
          timeoutHours: 24,
          strategy: {
            recentMonthsRange: 12,
            classicYearStart: 2008,
            classicYearEnd: 2020,
            recentAnimationCount: 0,
            recentLiveActionCount: 1,
            classicAnimationCount: 0,
            classicLiveActionCount: 0,
          },
        },
        newSeriesEpisode: {
          enabled: false,
          acquisitionMode: 'first_episode',
          minSeeders: 8,
          maxEpisodeGb: 2.5,
          maxSeasonTotalGb: 14,
          timeoutHours: 12,
          strategy: {
            recentMonthsRange: 12,
            classicYearStart: 2008,
            classicYearEnd: 2020,
            recentAnimationCount: 0,
            recentLiveActionCount: 1,
            classicAnimationCount: 0,
            classicLiveActionCount: 0,
          },
        },
        existingSeries: {
          enabled: false,
          acquisitionMode: 'next_episode',
          minSeeders: 5,
          maxEpisodeGb: 2.5,
          maxSeasonTotalGb: 8,
          timeoutHours: 12,
          strategy: {
            recentMonthsRange: 12,
            classicYearStart: 2008,
            classicYearEnd: 2020,
            recentAnimationCount: 0,
            recentLiveActionCount: 1,
            classicAnimationCount: 0,
            classicLiveActionCount: 0,
          },
        },
        deferredRetry: {
          enabled: true,
          acquisitionMode: 'replacement_retry',
          minSeeders: 10,
          maxEpisodeGb: 2,
          maxSeasonTotalGb: 10,
          timeoutHours: 12,
          strategy: {
            recentMonthsRange: 12,
            classicYearStart: 2008,
            classicYearEnd: 2020,
            recentAnimationCount: 0,
            recentLiveActionCount: 1,
            classicAnimationCount: 0,
            classicLiveActionCount: 0,
          },
        },
      },
      selection: {
        intervalHours: 24,
        lastMoviesRunAt: null,
        lastSeriesRunAt: null,
      },
      downloadClient: {
        type: 'qbittorrent',
        serviceUser: 'qbvpn',
        serviceGroup: 'qbvpn',
        connectionMode: 'ssh', // ssh | lan
        host: '',
        port: 8080,
        usernameEnc: null,
        passwordEnc: null,
        autoDeleteCompletedTorrents: true,
        autoDeleteCompletedDelayMinutes: 30,
        maxActiveDownloads: 3,
        maxActiveUploads: 3,
        maxActiveTorrents: 5,
        moviesSavePath: '',
        seriesSavePath: '',
        lanBind: {
          address: '127.0.0.1',
          authSubnetAllowlist: '127.0.0.1/32',
        },
        vpn: {
          enabled: false,
          provider: 'pia', // currently supported: pia
          interfaceName: 'piawg0',
          routeTable: 51820,
          markHex: '0x6d6',
          killSwitchEnabled: true,
          requiredForDispatch: true,
          regionId: 'ph',
          regionName: 'Philippines',
          piaUsernameEnc: null,
          piaPasswordEnc: null,
          lastAppliedAt: null,
          lastAppliedOk: null,
          lastAppliedSummary: '',
          lastAppliedError: '',
          lastTestAt: null,
          lastTestOk: null,
          lastTestSummary: '',
          lastError: '',
          lastPublicIp: '',
          lastVpnPublicIp: '',
          lastDownloadTestAt: null,
          lastDownloadTestOk: null,
          lastDownloadTestSummary: '',
          lastDownloadTestResult: null,
        },
        lastOptionsAppliedAt: null,
        lastOptionsAppliedOk: null,
        lastOptionsSummary: '',
        lastOptionsError: '',
        lastTestAt: null,
        lastTestOk: null,
        lastTestSummary: '',
        lastError: '',
      },
      scheduler: {
        enabled: true,
        intervalMinutes: 1,
        lastTickAt: null,
        lastOk: null,
        lastError: '',
      },
      watchfolderTrigger: {
        enabled: true,
        cooldownMinutes: 10,
        mode: 'debounced', // debounced | immediate
        triggerAfterFinalOnly: true,
      },
    },
    downloadsMovies: [],
    downloadsSeries: [],
    processingLogs: [],
    selectionLogs: [],
    deletionLogs: [],
    deletionState: {
      active: false,
      reason: '',
      triggerVolume: '',
      updatedAt: null,
      targetFreeGb: 50,
      nasState: null,
      vodState: null,
    },
    deletionPreview: {
      generatedAt: null,
      refreshedAt: null,
      cycleKey: '',
      refreshTime: '00:00',
      timeZone: 'Asia/Manila',
      reason: '',
      targetBytes: 0,
      totalVodBytes: 0,
      totalNasBytes: 0,
      totalEstimatedBytes: 0,
      counts: { movies: 0, series: 0, total: 0 },
      seriesCandidateCount: 0,
      seriesEligible: false,
      movie: { items: [], totalVodBytes: 0, totalNasBytes: 0, totalEstimatedBytes: 0 },
      series: { items: [], totalVodBytes: 0, totalNasBytes: 0, totalEstimatedBytes: 0 },
      lastError: '',
    },
    autodownloadHealth: null,
    sourceProviders: [],
    sourceProviderLogs: [],
    sourceProviderDomains: [],
    sourceProviderDomainHealth: [],
    mediaLibraryLogs: [],
    upcomingReminders: [],
    libraryInventory: {
      updatedAt: null,
      mountDir: '',
      source: 'mount_scan',
      movies: [],
      series: [],
      stats: {
        movies: 0,
        series: 0,
        total: 0,
      },
      lastError: '',
    },
    xuiIntegration: {
      baseUrl: '',
      accessCodeEnc: null,
      apiKeyEnc: null,
      watchFolderIdMovies: '',
      watchFolderIdSeries: '',
    },
    xuiScanState: {
      moviesScanPending: false,
      moviesLastScanAt: null,
      moviesCooldownUntil: null,
      seriesScanPending: false,
      seriesLastScanAt: null,
      seriesCooldownUntil: null,

      // Back-compat keys (older UI/service)
      lastMoviesScanTriggerAt: null,
      lastSeriesScanTriggerAt: null,
    },
    xuiScanLogs: [],
  };
}

export async function getAdminDb() {
  const db = (await readJSON(DB_KEY)) || defaultDb();
  // ensure any newly-added defaults are present
  db.settings = deepMerge(defaultPublicSettings(), db.settings || {});
  db.admins = Array.isArray(db.admins) ? db.admins : [];
  db.sessions = db.sessions && typeof db.sessions === 'object' ? db.sessions : {};
  db.secrets = db.secrets && typeof db.secrets === 'object' ? db.secrets : {};
  db.reports = Array.isArray(db.reports) ? db.reports : [];
  db.notifications = db.notifications && typeof db.notifications === 'object' ? db.notifications : {};
  db.requestSettings =
    db.requestSettings && typeof db.requestSettings === 'object'
      ? deepMerge(defaultDb().requestSettings, db.requestSettings)
      : defaultDb().requestSettings;
  db.requests = Array.isArray(db.requests) ? db.requests : [];

  // AutoDownload defaults/type safety
  db.engineHosts = Array.isArray(db.engineHosts) ? db.engineHosts : [];
  db.mountSettings = db.mountSettings && typeof db.mountSettings === 'object' ? db.mountSettings : null;
  db.mountStatus = db.mountStatus && typeof db.mountStatus === 'object' ? db.mountStatus : null;
  db.autodownloadSettings =
    db.autodownloadSettings && typeof db.autodownloadSettings === 'object'
      ? deepMerge(defaultDb().autodownloadSettings, db.autodownloadSettings)
      : defaultDb().autodownloadSettings;
  db.downloadsMovies = Array.isArray(db.downloadsMovies) ? db.downloadsMovies : [];
  db.downloadsSeries = Array.isArray(db.downloadsSeries) ? db.downloadsSeries : [];
  db.processingLogs = Array.isArray(db.processingLogs) ? db.processingLogs : [];
  db.selectionLogs = Array.isArray(db.selectionLogs) ? db.selectionLogs : [];
  db.deletionLogs = Array.isArray(db.deletionLogs) ? db.deletionLogs : [];
  db.deletionState =
    db.deletionState && typeof db.deletionState === 'object'
      ? deepMerge(defaultDb().deletionState, db.deletionState)
      : defaultDb().deletionState;
  db.autodownloadHealth = db.autodownloadHealth && typeof db.autodownloadHealth === 'object' ? db.autodownloadHealth : null;
  db.sourceProviders = Array.isArray(db.sourceProviders) ? db.sourceProviders : [];
  db.sourceProviderLogs = Array.isArray(db.sourceProviderLogs) ? db.sourceProviderLogs : [];
  db.sourceProviderDomains = Array.isArray(db.sourceProviderDomains) ? db.sourceProviderDomains : [];
  db.sourceProviderDomainHealth = Array.isArray(db.sourceProviderDomainHealth) ? db.sourceProviderDomainHealth : [];
  db.mediaLibraryLogs = Array.isArray(db.mediaLibraryLogs) ? db.mediaLibraryLogs : [];
  db.upcomingReminders = Array.isArray(db.upcomingReminders) ? db.upcomingReminders : [];
  db.libraryInventory =
    db.libraryInventory && typeof db.libraryInventory === 'object'
      ? deepMerge(defaultDb().libraryInventory, db.libraryInventory)
      : defaultDb().libraryInventory;
  db.xuiIntegration =
    db.xuiIntegration && typeof db.xuiIntegration === 'object'
      ? deepMerge(defaultDb().xuiIntegration, db.xuiIntegration)
      : defaultDb().xuiIntegration;
  db.xuiScanState =
    db.xuiScanState && typeof db.xuiScanState === 'object'
      ? deepMerge(defaultDb().xuiScanState, db.xuiScanState)
      : defaultDb().xuiScanState;
  db.xuiScanLogs = Array.isArray(db.xuiScanLogs) ? db.xuiScanLogs : [];
  return db;
}

export async function saveAdminDb(db) {
  const next = db && typeof db === 'object' ? db : defaultDb();
  next.updatedAt = Date.now();
  await writeJSON(DB_KEY, next);
}

export function mergeSettings(currentSettings, patch) {
  return deepMerge(currentSettings || defaultPublicSettings(), patch || {});
}
