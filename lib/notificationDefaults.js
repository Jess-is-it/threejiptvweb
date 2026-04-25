import { defaultTelegramMessageTemplates, normalizeTelegramMessageTemplates } from './telegramMessageTemplates';

function pad2(value) {
  return String(Math.max(0, Number(value || 0) || 0)).padStart(2, '0');
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeNumberInRange(value, { fallback = 0, min = 0, max = 100000, integer = true } = {}) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  const normalized = integer ? Math.floor(raw) : raw;
  if (normalized < min) return fallback;
  if (normalized > max) return fallback;
  return normalized;
}

export function normalizeDailyReportTime(input, fallback = '07:00') {
  const fallbackValue = String(fallback || '07:00').trim() || '07:00';
  const raw = String(input || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallbackValue;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallbackValue;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallbackValue;

  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function normalizeLiveChannelAlertDelayMinutes(input, fallback = 15) {
  return normalizeNumberInRange(input, {
    fallback: normalizeNumberInRange(fallback, { fallback: 15, min: 0, max: 1440 }),
    min: 0,
    max: 1440,
  });
}

export function normalizeLiveChannelDownReminderHours(input, fallback = 12) {
  return normalizeNumberInRange(input, {
    fallback: normalizeNumberInRange(fallback, { fallback: 12, min: 0, max: 720 }),
    min: 0,
    max: 720,
  });
}

function normalizeMaybeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = true } = {}) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const normalized = integer ? Math.floor(raw) : raw;
  if (normalized < min) return null;
  if (normalized > max) return null;
  return normalized;
}

function normalizeLiveChannelSnapshotItem(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  if (source.isUp !== true && source.isUp !== false) return null;
  return {
    name: String(source.name || '').trim(),
    isUp: source.isUp === true,
    streamStatus: String(source.streamStatus || '').trim(),
    xuiPid: String(source.xuiPid || '').trim(),
    fps: String(source.fps || '').trim(),
    serverName: String(source.serverName || '').trim(),
    serverId: String(source.serverId || '').trim(),
    sourceHost: String(source.sourceHost || '').trim(),
    bitrateKbps: normalizeMaybeNumber(source.bitrateKbps, { min: 0, max: 1000000, integer: false }),
    resolution: String(source.resolution || '').trim(),
    videoCodec: String(source.videoCodec || '').trim(),
    videoProfile: String(source.videoProfile || '').trim(),
    audioCodec: String(source.audioCodec || '').trim(),
    audioChannels: normalizeMaybeNumber(source.audioChannels, { min: 0, max: 64 }),
    transcodeSpeed: String(source.transcodeSpeed || '').trim(),
    dupFrames: normalizeMaybeNumber(source.dupFrames, { min: 0, max: 100000000 }),
    dropFrames: normalizeMaybeNumber(source.dropFrames, { min: 0, max: 100000000 }),
    uptimeSeconds: normalizeMaybeNumber(source.uptimeSeconds, { min: 0, max: 315360000 }),
    streamStartedAt: normalizeMaybeNumber(source.streamStartedAt, { min: 0, max: 9999999999999 }),
    downSinceAt: normalizeMaybeNumber(source.downSinceAt, { min: 0, max: 9999999999999 }),
    lastReminderAt: normalizeMaybeNumber(source.lastReminderAt, { min: 0, max: 9999999999999 }),
  };
}

function normalizeLiveChannelPendingChange(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  const startedAt = normalizeMaybeNumber(source.startedAt, { min: 1, max: 9999999999999 });
  const toIsUp = source.toIsUp === true ? true : source.toIsUp === false ? false : null;
  const fromIsUp = source.fromIsUp === true ? true : source.fromIsUp === false ? false : null;
  const snapshotSource =
    source.snapshot && typeof source.snapshot === 'object'
      ? {
          ...source.snapshot,
          isUp: toIsUp === null ? source.snapshot.isUp : toIsUp,
        }
      : null;
  const snapshot = normalizeLiveChannelSnapshotItem(snapshotSource);

  if (!startedAt || toIsUp === null || !snapshot) return null;
  return {
    fromIsUp,
    toIsUp,
    startedAt,
    snapshot,
  };
}

export function defaultNotificationSettings() {
  return {
    telegram: {
      liveChannelsEnabled: false,
      liveChannelAlertDelayMinutes: 15,
      liveChannelDownReminderHours: 12,
      userReportsEnabled: false,
      nasSizeReportEnabled: false,
      vodSizeReportEnabled: false,
      dailyReportTime: '07:00',
      messageTemplates: defaultTelegramMessageTemplates(),
    },
  };
}

export function defaultNotificationState() {
  return {
    telegram: {
      liveChannels: {
        lastCheckedAt: null,
        channelsById: {},
        notifiedById: {},
        pendingById: {},
      },
      dailyReports: {
        monitor: {
          lastSentDate: '',
          lastSentAt: null,
        },
      },
      storageTrigger: {
        active: false,
        lastSentAt: null,
      },
    },
  };
}

export function normalizeNotificationSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const telegram = source.telegram && typeof source.telegram === 'object' ? source.telegram : {};

  return {
    telegram: {
      liveChannelsEnabled: normalizeBoolean(telegram.liveChannelsEnabled),
      liveChannelAlertDelayMinutes: normalizeLiveChannelAlertDelayMinutes(telegram.liveChannelAlertDelayMinutes, 15),
      liveChannelDownReminderHours: normalizeLiveChannelDownReminderHours(telegram.liveChannelDownReminderHours, 12),
      userReportsEnabled: normalizeBoolean(telegram.userReportsEnabled),
      nasSizeReportEnabled: normalizeBoolean(telegram.nasSizeReportEnabled),
      vodSizeReportEnabled: normalizeBoolean(telegram.vodSizeReportEnabled),
      dailyReportTime: normalizeDailyReportTime(telegram.dailyReportTime, '07:00'),
      messageTemplates: normalizeTelegramMessageTemplates(telegram.messageTemplates),
    },
  };
}

export function normalizeNotificationState(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const telegram = source.telegram && typeof source.telegram === 'object' ? source.telegram : {};
  const liveChannels = telegram.liveChannels && typeof telegram.liveChannels === 'object' ? telegram.liveChannels : {};
  const dailyReports = telegram.dailyReports && typeof telegram.dailyReports === 'object' ? telegram.dailyReports : {};
  const monitor =
    dailyReports.monitor && typeof dailyReports.monitor === 'object'
      ? dailyReports.monitor
      : dailyReports.storage && typeof dailyReports.storage === 'object'
        ? dailyReports.storage
        : {};
  const storageTrigger = telegram.storageTrigger && typeof telegram.storageTrigger === 'object' ? telegram.storageTrigger : {};

  const channelsSource = liveChannels.channelsById && typeof liveChannels.channelsById === 'object' ? liveChannels.channelsById : {};
  const channelsById = {};
  for (const [id, row] of Object.entries(channelsSource)) {
    const channelId = String(id || '').trim();
    if (!channelId) continue;
    const item = normalizeLiveChannelSnapshotItem(row);
    if (!item) continue;
    channelsById[channelId] = item;
  }

  const notifiedSource =
    liveChannels.notifiedById && typeof liveChannels.notifiedById === 'object'
      ? liveChannels.notifiedById
      : channelsSource;
  const notifiedById = {};
  for (const [id, row] of Object.entries(notifiedSource)) {
    const channelId = String(id || '').trim();
    if (!channelId) continue;
    const item = normalizeLiveChannelSnapshotItem(row);
    if (!item) continue;
    notifiedById[channelId] = item;
  }

  const pendingSource = liveChannels.pendingById && typeof liveChannels.pendingById === 'object' ? liveChannels.pendingById : {};
  const pendingById = {};
  for (const [id, row] of Object.entries(pendingSource)) {
    const channelId = String(id || '').trim();
    if (!channelId) continue;
    const item = normalizeLiveChannelPendingChange(row);
    if (!item) continue;
    pendingById[channelId] = item;
  }

  const lastCheckedAtRaw = Number(liveChannels.lastCheckedAt || 0);
  const lastSentAtRaw = Number(monitor.lastSentAt || 0);
  const lastSentDateRaw = String(monitor.lastSentDate || '').trim();
  const storageTriggerLastSentAtRaw = Number(storageTrigger.lastSentAt || 0);

  return {
    telegram: {
      liveChannels: {
        lastCheckedAt: Number.isFinite(lastCheckedAtRaw) && lastCheckedAtRaw > 0 ? lastCheckedAtRaw : null,
        channelsById,
        notifiedById,
        pendingById,
      },
      dailyReports: {
        monitor: {
          lastSentDate: /^\d{4}-\d{2}-\d{2}$/.test(lastSentDateRaw) ? lastSentDateRaw : '',
          lastSentAt: Number.isFinite(lastSentAtRaw) && lastSentAtRaw > 0 ? lastSentAtRaw : null,
        },
      },
      storageTrigger: {
        active: storageTrigger.active === true,
        lastSentAt:
          Number.isFinite(storageTriggerLastSentAtRaw) && storageTriggerLastSentAtRaw > 0
            ? storageTriggerLastSentAtRaw
            : null,
      },
    },
  };
}
