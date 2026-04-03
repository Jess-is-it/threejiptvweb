function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasText(value) {
  return Boolean(String(value ?? '').trim());
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function boolFlag(value, fallback = false) {
  return value === undefined || value === null ? fallback : value === true;
}

function validTimezone(value) {
  const timezone = String(value || '').trim();
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function hasSecret(value = {}) {
  return Boolean(value?.hasSecret === true || hasText(value?.passwordEnc) || hasText(value?.privateKeyEnc));
}

function hasPositiveSelectionCounts(strategy = {}) {
  const keys = ['recentAnimationCount', 'recentLiveActionCount', 'classicAnimationCount', 'classicLiveActionCount'];
  return keys.some((key) => asNumber(strategy?.[key], 0) > 0);
}

function summarizeLastState(ok, emptyText = 'Not tested') {
  if (ok === true) return 'OK';
  if (ok === false) return 'Failed';
  return emptyText;
}

export function buildAutodownloadReadinessModel({
  settings = null,
  engineHost = null,
  mount = null,
  mountStatus = null,
  qb = null,
  xui = null,
  providers = [],
  live = {},
} = {}) {
  const autodownload = isObject(settings) ? settings : {};
  const engine = isObject(engineHost) ? engineHost : {};
  const storage = isObject(mount) ? mount : {};
  const storageState = isObject(mountStatus) ? mountStatus : {};
  const downloadClient = isObject(qb) ? qb : isObject(autodownload?.downloadClient) ? autodownload.downloadClient : {};
  const xuiConfig = isObject(xui) ? xui : {};
  const liveChecks = isObject(live) ? live : {};
  const sourceProviders = asArray(providers);

  const schedule = isObject(autodownload?.schedule) ? autodownload.schedule : {};
  const scheduler = isObject(autodownload?.scheduler) ? autodownload.scheduler : {};
  const selection = isObject(autodownload?.selection) ? autodownload.selection : {};
  const sourceFilters = isObject(autodownload?.sourceFilters) ? autodownload.sourceFilters : {};
  const sizeLimits = isObject(autodownload?.sizeLimits) ? autodownload.sizeLimits : {};
  const timeoutChecker = isObject(autodownload?.timeoutChecker) ? autodownload.timeoutChecker : {};
  const cleaning = isObject(autodownload?.cleaning) ? autodownload.cleaning : {};
  const templates = isObject(cleaning?.templates) ? cleaning.templates : {};
  const release = isObject(autodownload?.release) ? autodownload.release : {};
  const fileRules = isObject(autodownload?.fileRules) ? autodownload.fileRules : {};
  const libraryFolders = isObject(autodownload?.libraryFolders) ? autodownload.libraryFolders : {};
  const movieFolders = isObject(libraryFolders?.movies) ? libraryFolders.movies : {};
  const seriesFolders = isObject(libraryFolders?.series) ? libraryFolders.series : {};
  const categories = isObject(autodownload?.categories) ? autodownload.categories : {};
  const watchfolderTrigger = isObject(autodownload?.watchfolderTrigger) ? autodownload.watchfolderTrigger : {};
  const movieStrategy = isObject(autodownload?.movieSelectionStrategy) ? autodownload.movieSelectionStrategy : {};
  const seriesStrategy = isObject(autodownload?.seriesSelectionStrategy) ? autodownload.seriesSelectionStrategy : {};
  const vpn = isObject(downloadClient?.vpn) ? downloadClient.vpn : {};

  const moviesEnabled = boolFlag(autodownload?.moviesEnabled, false);
  const seriesEnabled = boolFlag(autodownload?.seriesEnabled, false);
  const coreEnabled = boolFlag(autodownload?.enabled, false) && (moviesEnabled || seriesEnabled);

  const scheduleConfigured =
    validTimezone(schedule?.timezone) &&
    asArray(schedule?.days).length > 0 &&
    hasText(schedule?.startTime) &&
    hasText(schedule?.endTime);

  const schedulerConfigured = boolFlag(scheduler?.enabled, true) && asNumber(scheduler?.intervalMinutes, 0) >= 1 && asNumber(selection?.intervalHours, 0) >= 1;
  const engineConfigured = hasText(engine?.host) && hasText(engine?.username) && hasText(engine?.authType) && hasSecret(engine);
  const mountConfigured =
    hasText(storage?.windowsHost) &&
    hasText(storage?.shareName) &&
    hasText(storage?.mountDir) &&
    Boolean(storage?.hasCredentials === true || (hasText(storage?.usernameEnc) && hasText(storage?.passwordEnc)));
  const mountHealthy = liveChecks?.mount?.ok === true || storageState?.ok === true;

  const qbConfigured =
    String(downloadClient?.type || 'qbittorrent').trim().toLowerCase() === 'qbittorrent' &&
    Boolean(downloadClient?.hasCredentials === true || (hasText(downloadClient?.usernameEnc) && hasText(downloadClient?.passwordEnc))) &&
    hasText(downloadClient?.moviesSavePath) &&
    hasText(downloadClient?.seriesSavePath) &&
    asNumber(downloadClient?.port, 0) > 0;
  const qbHealthy = liveChecks?.qb?.ok === true || downloadClient?.lastTestOk === true;
  const qbBehaviorConfigured =
    asNumber(downloadClient?.autoDeleteCompletedDelayMinutes, -1) >= 0 &&
    downloadClient?.lastOptionsAppliedOk !== false;

  const enabledProviders = sourceProviders.filter((row) => row?.enabled !== false);
  const healthyProviders = enabledProviders.filter((row) => ['healthy', 'degraded'].includes(String(row?.status || '').toLowerCase()));
  const providerResults = asArray(liveChecks?.providers?.results);
  const providerLiveOk = providerResults.length ? providerResults.some((row) => row?.ok) : null;
  const providersHealthy = providerLiveOk === true || healthyProviders.length > 0;

  const sourceFiltersConfigured =
    asNumber(sourceFilters?.minMovieSeeders, -1) >= 0 &&
    asNumber(sourceFilters?.minSeriesSeeders, -1) >= 0 &&
    (sizeLimits?.maxMovieGb === null || sizeLimits?.maxMovieGb === undefined || asNumber(sizeLimits?.maxMovieGb, 0) > 0) &&
    (sizeLimits?.maxEpisodeGb === null || sizeLimits?.maxEpisodeGb === undefined || asNumber(sizeLimits?.maxEpisodeGb, 0) > 0) &&
    (sizeLimits?.maxSeasonTotalGb === null || sizeLimits?.maxSeasonTotalGb === undefined || asNumber(sizeLimits?.maxSeasonTotalGb, 0) > 0);

  const movieStrategyOk =
    !moviesEnabled ||
    (hasPositiveSelectionCounts(movieStrategy) &&
      asNumber(movieStrategy?.recentMonthsRange, 0) >= 1 &&
      asNumber(movieStrategy?.classicYearStart, 0) < asNumber(movieStrategy?.classicYearEnd, 0));
  const seriesStrategyOk =
    !seriesEnabled ||
    (hasPositiveSelectionCounts(seriesStrategy) &&
      asNumber(seriesStrategy?.recentMonthsRange, 0) >= 1 &&
      asNumber(seriesStrategy?.classicYearStart, 0) < asNumber(seriesStrategy?.classicYearEnd, 0));
  const strategiesConfigured = movieStrategyOk && seriesStrategyOk;

  const cleaningTemplatesConfigured = [
    templates?.movieFolder,
    templates?.movieFile,
    templates?.movieSubtitle,
    templates?.seriesFolder,
    templates?.seriesSeasonFolder,
    templates?.seriesEpisode,
    templates?.seriesSubtitle,
  ].every(hasText);
  const cleaningConfigured =
    boolFlag(cleaning?.enabled, true) &&
    cleaningTemplatesConfigured &&
    asArray(fileRules?.videoExtensions).length > 0 &&
    asArray(fileRules?.subtitleExtensions).length > 0 &&
    asArray(fileRules?.keepSubtitleLanguages).length > 0;

  const timeoutConfigured =
    boolFlag(timeoutChecker?.enabled, false) &&
    asNumber(timeoutChecker?.maxWaitHours, 0) >= 1 &&
    asNumber(timeoutChecker?.intervalMinutes, 0) >= 1 &&
    (!seriesEnabled || timeoutChecker?.strictSeriesReplacement !== undefined) &&
    (!seriesEnabled || timeoutChecker?.deletePartialSeriesOnReplacementFailure !== undefined);

  const releaseConfigured = asNumber(release?.delayDays, -1) >= 0 && validTimezone(release?.timezone);

  const categoriesList = asArray(categories?.categories).filter(hasText);
  const movieLibraryConfigured =
    hasText(movieFolders?.downloading) && hasText(movieFolders?.downloaded) && hasText(movieFolders?.processing);
  const seriesLibraryConfigured =
    hasText(seriesFolders?.downloading) && hasText(seriesFolders?.downloaded) && hasText(seriesFolders?.processing);
  const categoryRoutingConfigured =
    categoriesList.length > 0 &&
    hasText(categories?.defaultMoviesCategory) &&
    hasText(categories?.defaultSeriesCategory) &&
    categoriesList.includes(String(categories?.defaultMoviesCategory || '').trim()) &&
    categoriesList.includes(String(categories?.defaultSeriesCategory || '').trim());
  const libraryRoutingConfigured = movieLibraryConfigured && seriesLibraryConfigured && categoryRoutingConfigured;

  const watchfolderConfigured =
    boolFlag(watchfolderTrigger?.enabled, true) &&
    ['debounced', 'immediate'].includes(String(watchfolderTrigger?.mode || '').trim().toLowerCase()) &&
    asNumber(watchfolderTrigger?.cooldownMinutes, -1) >= 0;

  const xuiConfigured =
    hasText(xuiConfig?.baseUrl) &&
    Boolean(xuiConfig?.hasAccessCode === true || hasText(xuiConfig?.accessCodeEnc)) &&
    Boolean(xuiConfig?.hasApiKey === true || hasText(xuiConfig?.apiKeyEnc)) &&
    (!moviesEnabled || hasText(xuiConfig?.watchFolderIdMovies || xuiConfig?.watchFolderIdMovie || xuiConfig?.watchFolderId)) &&
    (!seriesEnabled || hasText(xuiConfig?.watchFolderIdSeries || xuiConfig?.watchFolderIdSerie || xuiConfig?.watchFolderId));
  const xuiHealthy = liveChecks?.xui?.ok === true;

  const vpnEnabled = boolFlag(vpn?.enabled, false);
  const vpnCredentialsConfigured = Boolean(vpn?.hasCredentials === true || (hasText(vpn?.piaUsernameEnc) && hasText(vpn?.piaPasswordEnc)));
  const vpnReady =
    !vpnEnabled ||
    (vpnCredentialsConfigured &&
      hasText(vpn?.regionId) &&
      vpn?.lastAppliedOk !== false &&
      (vpn?.lastTestOk === true || vpn?.lastDownloadTestOk === true || vpn?.lastAppliedOk === true));

  const engineHealthy = liveChecks?.engine?.ok === true || engine?.lastTestOk === true;

  const items = [
    {
      key: 'policy',
      label: 'AutoDownload policy configured',
      detail: `Enabled: ${coreEnabled ? 'Yes' : 'No'} • Window: ${scheduleConfigured ? 'OK' : 'Missing'}`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: coreEnabled && scheduleConfigured,
    },
    {
      key: 'scheduler',
      label: 'Scheduler cadence configured',
      detail: `Worker: ${boolFlag(scheduler?.enabled, true) ? 'Enabled' : 'Disabled'} • Tick: ${asNumber(scheduler?.intervalMinutes, 0)}m • Selection: ${asNumber(selection?.intervalHours, 0)}h`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: schedulerConfigured,
    },
    {
      key: 'engine',
      label: 'Engine Host configured + reachable',
      detail: engineConfigured
        ? `Host: ${engine?.host || '—'} • Last test: ${summarizeLastState(engine?.lastTestOk)}`
        : 'Not configured',
      href: '/admin/autodownload/engine',
      required: true,
      ok: engineConfigured && engineHealthy,
    },
    {
      key: 'mount_config',
      label: 'Storage mount configured',
      detail: mountConfigured ? `Mount: ${storage?.mountDir || '—'} • SMB share set` : 'Not configured',
      href: '/admin/autodownload/storage',
      required: true,
      ok: mountConfigured,
    },
    {
      key: 'mount_state',
      label: 'Storage mount is mounted + writable',
      detail: mountConfigured ? `Mount state: ${mountHealthy ? 'Mounted/Writable' : 'Not ready'}` : 'Mount not configured',
      href: '/admin/autodownload/storage',
      required: true,
      ok: mountConfigured && mountHealthy,
    },
    {
      key: 'qb',
      label: 'qBittorrent configured + API reachable',
      detail: qbConfigured
        ? `Port ${downloadClient?.port || 8080} • Last test: ${summarizeLastState(downloadClient?.lastTestOk)}`
        : 'Not configured',
      href: '/admin/autodownload/qbittorrent',
      required: true,
      ok: qbConfigured && qbHealthy,
    },
    {
      key: 'qb_behavior',
      label: 'qB behavior options configured',
      detail: `Auto-delete: ${downloadClient?.autoDeleteCompletedTorrents === false ? 'Off' : 'On'} (${asNumber(downloadClient?.autoDeleteCompletedDelayMinutes, 0)}m) • Last apply: ${summarizeLastState(downloadClient?.lastOptionsAppliedOk, 'Not applied')}`,
      href: '/admin/autodownload/qbittorrent',
      required: true,
      ok: qbBehaviorConfigured,
    },
    {
      key: 'providers',
      label: 'Download Sources healthy',
      detail: `${enabledProviders.length} enabled • ${healthyProviders.length} usable (healthy/degraded)`,
      href: '/admin/autodownload/sources',
      required: true,
      ok: providersHealthy,
    },
    {
      key: 'source_filters',
      label: 'Source quality gates configured',
      detail: `Min seeders M/S: ${asNumber(sourceFilters?.minMovieSeeders, 0)}/${asNumber(sourceFilters?.minSeriesSeeders, 0)} • Size caps M/E/Season: ${sizeLimits?.maxMovieGb ?? '—'}GB/${sizeLimits?.maxEpisodeGb ?? '—'}GB/${sizeLimits?.maxSeasonTotalGb ?? '—'}GB`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: sourceFiltersConfigured,
    },
    {
      key: 'strategies',
      label: 'Movie + Series selection strategies set',
      detail: `Movie: ${movieStrategyOk ? 'OK' : 'Missing'} • Series: ${seriesStrategyOk ? 'OK' : 'Missing'}`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: strategiesConfigured,
    },
    {
      key: 'cleaning',
      label: 'Cleaning workflow configured',
      detail: `Cleaning: ${boolFlag(cleaning?.enabled, true) ? 'Enabled' : 'Disabled'} • Templates: ${cleaningTemplatesConfigured ? 'OK' : 'Incomplete'} • Folder-if-missing: ${cleaning?.createMovieFolderIfMissing !== false ? 'On' : 'Off'}`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: cleaningConfigured,
    },
    {
      key: 'timeout',
      label: 'Timeout + replacement policy configured',
      detail: `Timeout checker: ${boolFlag(timeoutChecker?.enabled, false) ? 'Enabled' : 'Disabled'} • Max wait: ${asNumber(timeoutChecker?.maxWaitHours, 0)}h • Scan: ${asNumber(timeoutChecker?.intervalMinutes, 0)}m`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: timeoutConfigured,
    },
    {
      key: 'release',
      label: 'Release hold workflow configured',
      detail: `Delay: ${asNumber(release?.delayDays, 0)} day(s) • Timezone: ${release?.timezone || '—'}`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: releaseConfigured,
    },
    {
      key: 'library_routing',
      label: 'Library stages + category routing set',
      detail: `Movies: ${movieFolders?.downloaded || '—'} → ${movieFolders?.processing || '—'} • Series: ${seriesFolders?.downloaded || '—'} → ${seriesFolders?.processing || '—'} • Defaults: ${categories?.defaultMoviesCategory || '—'}/${categories?.defaultSeriesCategory || '—'}`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: libraryRoutingConfigured,
    },
    {
      key: 'watchfolder',
      label: 'Watchfolder trigger configured',
      detail: `Trigger: ${boolFlag(watchfolderTrigger?.enabled, true) ? 'Enabled' : 'Disabled'} • Mode: ${watchfolderTrigger?.mode || '—'} • Cooldown: ${asNumber(watchfolderTrigger?.cooldownMinutes, 0)}m`,
      href: '/admin/autodownload/settings',
      required: true,
      ok: watchfolderConfigured,
    },
    {
      key: 'xui',
      label: 'XUI integration (for IPTV ingest)',
      detail: xuiConfigured
        ? `Configured • Watchfolders M/S: ${xuiConfig?.watchFolderIdMovies || xuiConfig?.watchFolderIdMovie || xuiConfig?.watchFolderId || '—'}/${xuiConfig?.watchFolderIdSeries || xuiConfig?.watchFolderIdSerie || xuiConfig?.watchFolderId || '—'}`
        : 'Not fully configured',
      href: '/admin/autodownload/xui',
      required: true,
      ok: xuiConfigured && (liveChecks?.xui ? xuiHealthy : true),
    },
    {
      key: 'vpn',
      label: 'VPN routing ready (optional)',
      detail: !vpnEnabled
        ? 'Disabled • Optional for AutoDownload'
        : `Region: ${vpn?.regionName || vpn?.regionId || '—'} • Credentials: ${vpnCredentialsConfigured ? 'Saved' : 'Missing'} • Last health: ${summarizeLastState(vpn?.lastDownloadTestOk ?? vpn?.lastTestOk ?? vpn?.lastAppliedOk)}`,
      href: '/admin/autodownload/vpn',
      required: false,
      ok: vpnReady,
    },
  ];

  const requiredItems = items.filter((row) => row.required);
  const coreItems = requiredItems.filter((row) => row.key !== 'xui');
  const coreReady = coreItems.every((row) => row.ok);
  const connectivityReady = engineHealthy && mountHealthy && qbHealthy && providersHealthy && (!vpnEnabled || vpnReady);
  const e2eReady = requiredItems.every((row) => row.ok) && (!vpnEnabled || vpnReady);

  const passed = items.filter((row) => row.ok).length;
  const total = items.length;
  const status = passed === total ? 'good' : passed >= Math.ceil(total / 2) ? 'warn' : 'bad';

  return {
    coreReady,
    connectivityReady,
    e2eReady,
    passed,
    total,
    status,
    items,
  };
}
