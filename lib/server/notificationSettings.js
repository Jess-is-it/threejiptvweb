import 'server-only';

import { defaultNotificationSettings, defaultNotificationState, normalizeNotificationSettings, normalizeNotificationState } from '../notificationDefaults';
import { getAdminDb, saveAdminDb } from './adminDb';
import { normalizeReleaseTimezone } from './autodownload/releaseSchedule';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeNotificationSettings(current, patch) {
  const nextPatch = isObject(patch) ? patch : {};
  const currentTelegram = isObject(current?.telegram) ? current.telegram : defaultNotificationSettings().telegram;
  const patchTelegram = isObject(nextPatch.telegram) ? nextPatch.telegram : {};
  const currentMessageTemplates = isObject(currentTelegram.messageTemplates)
    ? currentTelegram.messageTemplates
    : defaultNotificationSettings().telegram.messageTemplates;
  const patchMessageTemplates = isObject(patchTelegram.messageTemplates) ? patchTelegram.messageTemplates : {};
  return normalizeNotificationSettings({
    ...current,
    ...nextPatch,
    telegram: {
      ...currentTelegram,
      ...patchTelegram,
      messageTemplates: {
        ...currentMessageTemplates,
        ...patchMessageTemplates,
      },
    },
  });
}

function mergeNotificationState(current, patch) {
  const nextPatch = isObject(patch) ? patch : {};
  const currentTelegram = isObject(current?.telegram) ? current.telegram : defaultNotificationState().telegram;
  const patchTelegram = isObject(nextPatch.telegram) ? nextPatch.telegram : {};

  const currentLiveChannels = isObject(currentTelegram.liveChannels) ? currentTelegram.liveChannels : defaultNotificationState().telegram.liveChannels;
  const patchLiveChannels = isObject(patchTelegram.liveChannels) ? patchTelegram.liveChannels : {};
  const currentDailyReports = isObject(currentTelegram.dailyReports) ? currentTelegram.dailyReports : defaultNotificationState().telegram.dailyReports;
  const patchDailyReports = isObject(patchTelegram.dailyReports) ? patchTelegram.dailyReports : {};
  const currentMonitor = isObject(currentDailyReports.monitor)
    ? currentDailyReports.monitor
    : defaultNotificationState().telegram.dailyReports.monitor;
  const patchMonitor = isObject(patchDailyReports.monitor) ? patchDailyReports.monitor : {};
  const currentStorageTrigger = isObject(currentTelegram.storageTrigger)
    ? currentTelegram.storageTrigger
    : defaultNotificationState().telegram.storageTrigger;
  const patchStorageTrigger = isObject(patchTelegram.storageTrigger) ? patchTelegram.storageTrigger : {};

  return normalizeNotificationState({
    ...current,
    ...nextPatch,
    telegram: {
      ...currentTelegram,
      ...patchTelegram,
      liveChannels: {
        ...currentLiveChannels,
        ...patchLiveChannels,
      },
      dailyReports: {
        ...currentDailyReports,
        ...patchDailyReports,
        monitor: {
          ...currentMonitor,
          ...patchMonitor,
        },
      },
      storageTrigger: {
        ...currentStorageTrigger,
        ...patchStorageTrigger,
      },
    },
  });
}

export async function getNotificationSettings() {
  const db = await getAdminDb();
  const raw = db.notificationSettings || defaultNotificationSettings();
  const normalized = normalizeNotificationSettings(raw);
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    db.notificationSettings = normalized;
    await saveAdminDb(db);
  }
  return normalized;
}

export async function updateNotificationSettings(patch) {
  const db = await getAdminDb();
  const current = normalizeNotificationSettings(db.notificationSettings || defaultNotificationSettings());
  const next = mergeNotificationSettings(current, patch);
  db.notificationSettings = next;
  await saveAdminDb(db);
  return next;
}

export async function getNotificationState() {
  const db = await getAdminDb();
  return normalizeNotificationState(db.notificationState || defaultNotificationState());
}

export async function updateNotificationState(patch) {
  const db = await getAdminDb();
  const current = normalizeNotificationState(db.notificationState || defaultNotificationState());
  const next = mergeNotificationState(current, patch);
  db.notificationState = next;
  await saveAdminDb(db);
  return next;
}

export async function getNotificationTimeZone() {
  return normalizeReleaseTimezone('Asia/Manila');
}

export function telegramLiveChannelsEnabled(settings) {
  return settings?.telegram?.liveChannelsEnabled === true;
}

export function telegramUserReportsEnabled(settings) {
  return settings?.telegram?.userReportsEnabled === true;
}

export function telegramDailyStorageReportsEnabled(settings) {
  return settings?.telegram?.nasSizeReportEnabled === true || settings?.telegram?.vodSizeReportEnabled === true;
}
