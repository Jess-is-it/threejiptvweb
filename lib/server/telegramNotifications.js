import 'server-only';

import { allowInsecureTlsFor, insecureDispatcher } from '../../app/api/xuione/_shared';
import { normalizeNotificationSettings } from '../notificationDefaults';
import { defaultTelegramMessageTemplates } from '../telegramMessageTemplates';
import {
  getNotificationSettings,
  getNotificationState,
  getNotificationTimeZone,
  telegramLiveChannelsEnabled,
  telegramUserReportsEnabled,
  updateNotificationState,
} from './notificationSettings';
import { dateKeyInTimezone } from './autodownload/releaseSchedule';
import { fetchMountStatus, fetchVodStorageDevices } from './autodownload/mountService';
import { deriveStoragePolicy } from './autodownload/storagePolicy';
import { xuiApiCall } from './autodownload/xuiService';
import { getAdminDb } from './adminDb';
import { getSecret, secretKeys } from './secrets';

const TELEGRAM_MAX_TEXT = 4096;

function now() {
  return Date.now();
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let unitIndex = 0;
  let current = value;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  const fixed = current >= 100 || unitIndex === 0 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(fixed)} ${units[unitIndex]}`;
}

function formatPercent(used = 0, total = 0) {
  const usedNum = Number(used || 0);
  const totalNum = Number(total || 0);
  if (!Number.isFinite(usedNum) || !Number.isFinite(totalNum) || totalNum <= 0) return 'n/a';
  return `${((usedNum / totalNum) * 100).toFixed(1)}%`;
}

function parseTimeToMinutes(value = '07:00') {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return 7 * 60;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 7 * 60;
  return hours * 60 + minutes;
}

function getTimePartsInTimeZone(ts = Date.now(), timeZone = 'Asia/Manila') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(Number(ts || Date.now())));
  const get = (type, fallback = '') => String(parts.find((part) => part.type === type)?.value || fallback);
  return {
    year: get('year', '0000'),
    month: get('month', '00'),
    day: get('day', '00'),
    hour: get('hour', '00'),
    minute: get('minute', '00'),
    second: get('second', '00'),
  };
}

function formatDateTimeInTimeZone(ts = Date.now(), timeZone = 'Asia/Manila') {
  const parts = getTimePartsInTimeZone(ts, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${timeZone}`;
}

function formatDateInTimeZone(ts = Date.now(), timeZone = 'Asia/Manila') {
  const parts = getTimePartsInTimeZone(ts, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatTimeInTimeZone(ts = Date.now(), timeZone = 'Asia/Manila') {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(Number(ts || Date.now())));
}

function formatFriendlyDateTimeInTimeZone(ts = Date.now(), timeZone = 'Asia/Manila') {
  return `${formatDateInTimeZone(ts, timeZone)} ${formatTimeInTimeZone(ts, timeZone)}`;
}

function getTelegramMessageTemplates(settings = null) {
  const defaults = defaultTelegramMessageTemplates();
  const templates = settings?.telegram?.messageTemplates;
  if (!templates || typeof templates !== 'object') return defaults;
  return {
    ...defaults,
    ...templates,
  };
}

function setStamp(target, key, value) {
  target[key] = value == null ? '' : String(value);
}

function setStampAliases(target, keys = [], value) {
  for (const key of keys) setStamp(target, key, value);
}

function normalizeRenderedTelegramTemplate(text = '') {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmedEnd = line.replace(/[ \t]+$/g, '');
      return trimmedEnd.trim() ? trimmedEnd : '';
    });
  return normalizeMessage(
    lines
      .join('\n')
      .replace(/(^[ \t]+)•\s+/gm, '$1')
      .replace(/\n{3,}/g, '\n\n')
  );
}

function renderTelegramTemplate(template = '', stamps = {}) {
  const rendered = String(template || '').replace(/\{\{\s*([a-z0-9_-]+)\s*\}\}/gi, (match, token) => {
    const key = String(token || '').trim().toLowerCase();
    if (!key) return '';
    if (!Object.prototype.hasOwnProperty.call(stamps, key)) return '';
    return stamps[key] == null ? '' : String(stamps[key]);
  });
  return normalizeRenderedTelegramTemplate(rendered);
}

function renderPrefixedTelegramTestMessage({ title = '🧪 Test delivery', details = [], message = '' } = {}) {
  const lines = [String(title || '🧪 Test delivery').trim()];
  for (const detail of Array.isArray(details) ? details : []) {
    const line = String(detail || '').trim();
    if (!line) continue;
    lines.push(line);
  }
  const body = String(message || '').trim();
  if (body) {
    if (lines.length) lines.push('');
    lines.push(body);
  }
  return normalizeRenderedTelegramTemplate(lines.join('\n'));
}

function linesToSection(lines = []) {
  const text = Array.isArray(lines) ? lines.filter((line) => String(line || '').trim()).join('\n') : '';
  return normalizeRenderedTelegramTemplate(text);
}

function buildCommonTemplateStamps({ ts = null, timeZone = 'Asia/Manila', dailyReportTime = '07:00' } = {}) {
  const resolvedTs = Number(ts || now()) || now();
  const stamps = {};
  const date = formatDateInTimeZone(resolvedTs, timeZone);
  const time = formatTimeInTimeZone(resolvedTs, timeZone);
  const datetime = formatFriendlyDateTimeInTimeZone(resolvedTs, timeZone);

  setStampAliases(stamps, ['date'], date);
  setStampAliases(stamps, ['time'], time);
  setStampAliases(stamps, ['datetime'], datetime);
  setStampAliases(stamps, ['timezone'], timeZone);
  setStampAliases(stamps, ['daily-report-time'], String(dailyReportTime || '07:00').trim() || '07:00');

  return stamps;
}

function normalizeMessage(text = '') {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';
  if (raw.length <= TELEGRAM_MAX_TEXT) return raw;
  return `${raw.slice(0, TELEGRAM_MAX_TEXT - 1).trimEnd()}…`;
}

function normalizeTelegramOverride(override = null) {
  const source = override && typeof override === 'object' ? override : {};
  return {
    hasBotToken: hasOwn(source, 'botToken') || hasOwn(source, 'telegramBotToken'),
    hasChatId: hasOwn(source, 'chatId') || hasOwn(source, 'telegramChatId'),
    botToken: String(source.botToken ?? source.telegramBotToken ?? '').trim(),
    chatId: String(source.chatId ?? source.telegramChatId ?? '').trim(),
  };
}

async function getTelegramCredentials({ override = null } = {}) {
  const keys = secretKeys();
  const nextOverride = normalizeTelegramOverride(override);
  const storedBotToken = String((await getSecret(keys.telegramBotToken)) || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const storedChatId = String((await getSecret(keys.telegramChatId)) || process.env.TELEGRAM_CHAT_ID || '').trim();
  const botToken = nextOverride.hasBotToken ? nextOverride.botToken : storedBotToken;
  const chatId = nextOverride.hasChatId ? nextOverride.chatId : storedChatId;
  return {
    botToken,
    chatId,
    configured: Boolean(botToken && chatId),
  };
}

export async function getTelegramSettingsForAdmin() {
  const creds = await getTelegramCredentials();
  return {
    botToken: creds.botToken,
    chatId: creds.chatId,
    hasBotToken: Boolean(creds.botToken),
    hasChatId: Boolean(creds.chatId),
    configured: creds.configured,
  };
}

export async function sendTelegramMessage({ text, override = null } = {}) {
  const message = normalizeMessage(text);
  if (!message) throw new Error('Telegram message is empty.');

  const creds = await getTelegramCredentials({ override });
  if (!creds.configured) {
    throw new Error('Telegram bot token and chat ID are required.');
  }

  const response = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: creds.chatId,
      text: message,
      disable_web_page_preview: true,
    }),
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.description || `Telegram ${response.status}`);
  }

  return json?.result || null;
}

function describeEnabledAreas(settings) {
  const areas = [];
  if (settings?.telegram?.liveChannelsEnabled) areas.push('Live TV Channels Up/down');
  if (settings?.telegram?.userReportsEnabled) areas.push('User Reports');
  if (settings?.telegram?.nasSizeReportEnabled) areas.push('NAS auto-delete trigger alert');
  if (settings?.telegram?.vodSizeReportEnabled) areas.push('/home/xui/content/vod auto-delete trigger alert');
  return areas;
}

function normalizeTestScenario(value = 'general') {
  const raw = String(value || 'general').trim().toLowerCase();
  if (raw === 'live_channels' || raw === 'live') return 'live_channels';
  if (raw === 'user_reports' || raw === 'reports') return 'user_reports';
  if (raw === 'nas_trigger' || raw === 'nas') return 'nas_trigger';
  if (raw === 'vod_trigger' || raw === 'vod') return 'vod_trigger';
  if (raw === 'daily_monitor_report' || raw === 'daily_report' || raw === 'daily') return 'daily_monitor_report';
  return 'general';
}

function buildGeneralTelegramTestMessage({ admin = null, settings, timeZone }) {
  const enabledAreas = describeEnabledAreas(settings);
  const liveDelayMinutes = Math.max(0, Number(settings?.telegram?.liveChannelAlertDelayMinutes || 0) || 0);
  const liveReminderHours = Math.max(0, Number(settings?.telegram?.liveChannelDownReminderHours || 0) || 0);
  const lines = [
    '🧪 3J TV Telegram test',
    `Time: ${formatDateTimeInTimeZone(now(), timeZone)}`,
  ];

  if (admin?.username || admin?.email) {
    lines.push(`Triggered by: ${String(admin?.username || admin?.email).trim()}`);
  }

  if (enabledAreas.length) {
    lines.push(`Enabled areas: ${enabledAreas.join(', ')}`);
  } else {
    lines.push('Enabled areas: none yet');
  }

  const dailyReportTime = String(settings?.telegram?.dailyReportTime || '07:00').trim() || '07:00';
  lines.push(`Daily report: ${dailyReportTime} (${timeZone}) with all monitor areas`);
  lines.push(
    liveDelayMinutes > 0
      ? `Live TV delay: ${liveDelayMinutes} minute(s) stable before alert`
      : 'Live TV delay: immediate'
  );
  lines.push(
    liveReminderHours > 0
      ? `Live TV down reminder: every ${liveReminderHours} hour(s)`
      : 'Live TV down reminder: disabled'
  );
  lines.push('Mode: General delivery test');

  return lines.join('\n');
}

function toLiveChannelList(snapshot = {}, isUp = true, limit = 2) {
  return Object.entries(snapshot || {})
    .filter(([, item]) => item?.isUp === isUp)
    .map(([id, item]) => ({ id, ...item }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

async function buildLiveChannelsTestMessage({ timeZone, settings }) {
  try {
    const snapshot = await fetchLiveChannelSnapshot();
    const summary = summarizeLiveSnapshot(snapshot);
    const liveDelayMinutes = Math.max(0, Number(settings?.telegram?.liveChannelAlertDelayMinutes || 0) || 0);
    const liveReminderHours = Math.max(0, Number(settings?.telegram?.liveChannelDownReminderHours || 0) || 0);
    if (!summary.tracked) {
      return renderPrefixedTelegramTestMessage({
        title: '🧪 Test — Live TV channel status update',
        details: [
          `Checked: ${formatFriendlyDateTimeInTimeZone(now(), timeZone)}`,
          'Status: no live channels were returned from XUI.',
          liveDelayMinutes > 0
            ? `Configured delay: ${liveDelayMinutes} minute(s) stable before alert`
            : 'Configured delay: immediate',
          liveReminderHours > 0
            ? `Configured down reminder: every ${liveReminderHours} hour(s)`
            : 'Configured down reminder: disabled',
          'This is a test delivery using the current XUI live snapshot.',
        ],
      });
    }

    const message = buildLiveChangeMessage({
      up: toLiveChannelList(snapshot, true),
      down: toLiveChannelList(snapshot, false),
      summary,
      timeZone,
      alertDelayMinutes: liveDelayMinutes,
      settings,
    });
    return renderPrefixedTelegramTestMessage({
      title: '🧪 Test — Live TV channel status update',
      details: [
        liveReminderHours > 0
          ? `Configured down reminder: every ${liveReminderHours} hour(s)`
          : 'Configured down reminder: disabled',
        'This is a test delivery using the current XUI live snapshot.',
      ],
      message,
    });
  } catch (error) {
    return renderPrefixedTelegramTestMessage({
      title: '🧪 Test — Live TV channel status update',
      details: [
        `Checked: ${formatFriendlyDateTimeInTimeZone(now(), timeZone)}`,
        `Status: unavailable (${error?.message || 'Unable to read XUI live status.'})`,
        Math.max(0, Number(settings?.telegram?.liveChannelAlertDelayMinutes || 0) || 0) > 0
          ? `Configured delay: ${Math.max(0, Number(settings?.telegram?.liveChannelAlertDelayMinutes || 0) || 0)} minute(s) stable before alert`
          : 'Configured delay: immediate',
        'This is a test delivery using the current XUI live snapshot.',
      ],
    });
  }
}

function buildUserReportMessage({ report = null, timeZone = 'Asia/Manila', settings = null } = {}) {
  const templates = getTelegramMessageTemplates(settings);
  const isSample = !report;
  const issue = String(report?.choiceTitle || report?.choice || (isSample ? 'Playback issue' : 'Unknown issue')).trim();
  const username = String(report?.user?.username || '').trim() || (isSample ? 'sample-user' : 'Unknown user');
  const contentType = String(report?.meta?.type || '').trim() || (isSample ? 'movie' : '');
  const contentTitle = String(report?.meta?.title || '').trim() || (isSample ? 'Sample Title' : '');
  const contentHref = String(report?.meta?.href || '').trim();
  const body =
    String(report?.message || '').trim() || (isSample ? 'Sample report body used for Telegram notification testing.' : '');
  const submittedAt = report?.createdAt || now();
  const contentLine = contentTitle ? `Content: ${contentType ? `${contentType} — ` : ''}${contentTitle}` : '';
  const contentTypeLine = contentType ? `Content type: ${contentType}` : '';
  const contentTitleLine = contentTitle ? `Content title: ${contentTitle}` : '';
  const linkLine = contentHref ? `Link: ${contentHref}` : '';
  const messageLine = body ? `Message: ${body}` : '';
  const stamps = {
    ...buildCommonTemplateStamps({
      ts: submittedAt,
      timeZone,
      dailyReportTime: settings?.telegram?.dailyReportTime || '07:00',
    }),
  };

  setStampAliases(stamps, ['report-user'], username);
  setStampAliases(stamps, ['report-issue'], issue);
  setStampAliases(stamps, ['report-content-type'], contentType);
  setStampAliases(stamps, ['report-content-title'], contentTitle);
  setStampAliases(stamps, ['report-content-link'], contentHref);
  setStampAliases(stamps, ['report-message'], body);
  setStampAliases(stamps, ['report-content-line'], contentLine);
  setStampAliases(stamps, ['report-content-type-line'], contentTypeLine);
  setStampAliases(stamps, ['report-content-title-line'], contentTitleLine);
  setStampAliases(stamps, ['report-link-line'], linkLine);
  setStampAliases(stamps, ['report-message-line'], messageLine);
  setStampAliases(stamps, ['submitted-datetime'], formatFriendlyDateTimeInTimeZone(submittedAt, timeZone));

  return renderTelegramTemplate(templates.userReport, stamps);
}

function buildUserReportTestMessage({ report = null, timeZone = 'Asia/Manila', settings = null } = {}) {
  const source = report ? 'latest saved report' : 'generated sample report';
  return renderPrefixedTelegramTestMessage({
    title: '🧪 Test — New user report',
    details: [`Source: ${source}`],
    message: buildUserReportMessage({ report, timeZone, settings }),
  });
}

async function buildUserReportsTestMessage({ timeZone, settings }) {
  const db = await getAdminDb();
  const reports = Array.isArray(db?.reports) ? db.reports : [];
  return buildUserReportTestMessage({
    report: reports[0] || null,
    timeZone,
    settings,
  });
}

async function buildStorageTriggerTestMessage({ kind = 'nas', timeZone = 'Asia/Manila', settings = null } = {}) {
  const data = await buildStorageMonitorData();
  const message = buildImmediateStorageTriggerMessage({
    nasSnapshot: kind === 'nas' ? data.nasSnapshot : null,
    vodSnapshot: kind === 'vod' ? data.vodSnapshot : null,
    autoDeletePolicy: data.autoDeletePolicy,
    timeZone: data.timeZone || timeZone,
    settings,
  });
  return renderPrefixedTelegramTestMessage({
    title: `🧪 Test — AutoDelete trigger alert (${kind === 'vod' ? 'VOD' : 'NAS'})`,
    details: [
      data.autoDeleteTriggered
        ? 'Current state: AutoDelete is already at or above the configured trigger threshold.'
        : 'Simulation: current usage is below trigger, but this test shows the immediate alert format.',
    ],
    message,
  });
}

async function buildDailyMonitorReportTestMessage({ settings }) {
  const data = await buildDailyMonitorReportData();
  const message = buildDailyMonitorReportMessage({
    ...data,
    settings,
  });
  const dailyReportTime = String(settings?.telegram?.dailyReportTime || '07:00').trim() || '07:00';
  return renderPrefixedTelegramTestMessage({
    title: '🧪 Test — Daily monitor report',
    details: [
      `Scheduled daily send: ${dailyReportTime} (${data.timeZone || 'Asia/Manila'})`,
      'This is a test delivery using the current monitor snapshot.',
    ],
    message,
  });
}

export async function sendTelegramTestNotification({ admin = null, override = null, settingsOverride = null, scenario = 'general' } = {}) {
  const settings = settingsOverride ? normalizeNotificationSettings(settingsOverride) : await getNotificationSettings();
  const timeZone = await getNotificationTimeZone();
  const normalizedScenario = normalizeTestScenario(scenario);
  let text = '';

  if (normalizedScenario === 'live_channels') {
    text = await buildLiveChannelsTestMessage({ timeZone, settings });
  } else if (normalizedScenario === 'user_reports') {
    text = await buildUserReportsTestMessage({ timeZone, settings });
  } else if (normalizedScenario === 'nas_trigger') {
    text = await buildStorageTriggerTestMessage({ kind: 'nas', timeZone, settings });
  } else if (normalizedScenario === 'vod_trigger') {
    text = await buildStorageTriggerTestMessage({ kind: 'vod', timeZone, settings });
  } else if (normalizedScenario === 'daily_monitor_report') {
    text = await buildDailyMonitorReportTestMessage({ settings });
  } else {
    text = buildGeneralTelegramTestMessage({ admin, settings, timeZone });
  }

  const result = await sendTelegramMessage({
    text,
    override,
  });

  return { ok: true, messageId: result?.message_id || null, scenario: normalizedScenario };
}

function normalizeBaseUrl(baseUrl = '') {
  const raw = String(baseUrl || '').trim();
  if (!raw) return '';
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  return url.origin;
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseClockDurationToSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(?:(\d+)\s*day[s]?,?\s+)?(\d{1,2}):(\d{2}):(\d{2})$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function parseHumanDurationToSeconds(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const re = /(\d+)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g;
  let total = 0;
  let hit = false;
  for (const match of raw.matchAll(re)) {
    hit = true;
    const qty = Number(match[1] || 0);
    const unit = String(match[2] || '').toLowerCase();
    if (!Number.isFinite(qty) || !unit) continue;
    if (unit === 'd' || unit === 'day' || unit === 'days') total += qty * 86400;
    else if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') total += qty * 3600;
    else if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') total += qty * 60;
    else total += qty;
  }
  return hit ? total : null;
}

function parseStartTimestampToMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = safeNumber(value);
  if (num !== null) {
    if (num >= 1e12) return Math.floor(num);
    if (num >= 1e9) return Math.floor(num * 1000);
  }
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRationalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const direct = safeNumber(value);
  if (direct !== null) return direct;
  const raw = String(value || '').trim();
  const fraction = raw.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (!fraction) return null;
  const numerator = Number(fraction[1]);
  const denominator = Number(fraction[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function formatDecimal(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(digits).replace(/\.?0+$/, '');
}

function formatDurationShort(totalSeconds = 0) {
  const value = Math.max(0, Math.floor(Number(totalSeconds || 0) || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatLiveStatusPill(isUp) {
  return isUp ? '🟢 Up' : '🔴 Down';
}

function parseBitrateKbps(value) {
  if (value === null || value === undefined || value === '') return null;
  const direct = safeNumber(value);
  if (direct !== null) {
    if (direct <= 0) return null;
    return direct > 100000 ? direct / 1000 : direct;
  }
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'n/a') return null;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (raw.includes('mb') || raw.includes('mbit')) return numeric * 1000;
  if (raw.includes('kb') || raw.includes('kbit')) return numeric;
  if (raw.includes('bit')) return numeric / 1000;
  return numeric > 100000 ? numeric / 1000 : numeric;
}

function formatKbps(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n >= 100 ? `${Math.round(n)} kbps` : `${formatDecimal(n, 1)} kbps`;
}

function extractHostLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).host;
  } catch {}
  return raw.replace(/^[a-z]+:\/\//i, '').split('/')[0].trim();
}

function deriveLiveRuntimeStatus(row = {}) {
  const rawStatus = row?.stream_status ?? row?.streamStatus ?? row?.status ?? null;
  const statusNum = Number(rawStatus);
  const xuiStreamStatus = Number.isFinite(statusNum) ? statusNum : null;

  const hasPidField = hasOwn(row, 'pid') || hasOwn(row, 'monitor_pid');
  const rawPid = row?.pid ?? row?.monitor_pid ?? null;
  const pidNum = Number(rawPid);
  const pidUp = Number.isFinite(pidNum) && pidNum > 0;

  if (hasPidField) return pidUp;
  if (xuiStreamStatus === null) return null;
  return xuiStreamStatus === 0;
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const raw = String(value ?? '').trim();
    if (raw) return raw;
  }
  return '';
}

function extractProgressInfo(row = {}) {
  return parseJsonObject(row?.progress_info ?? row?.progressInfo) || {};
}

function extractStreamInfo(row = {}) {
  return parseJsonObject(row?.stream_info ?? row?.streamInfo) || {};
}

function extractUptimeSeconds(row = {}) {
  const direct =
    safeNumber(row?.uptimeSeconds) ??
    safeNumber(row?.uptime_seconds) ??
    safeNumber(row?.stream_uptime_seconds) ??
    safeNumber(row?.stream_uptime) ??
    safeNumber(row?.uptime);
  if (direct !== null && direct >= 0) return Math.floor(direct);

  const uptimeText = row?.uptimeText ?? row?.uptime_text ?? row?.uptimeString ?? row?.uptime_string ?? row?.uptime;
  const asClock = parseClockDurationToSeconds(uptimeText);
  if (asClock !== null) return asClock;
  const asHuman = parseHumanDurationToSeconds(uptimeText);
  if (asHuman !== null) return asHuman;

  const startedAt = parseStartTimestampToMs(
    row?.stream_started ??
      row?.streamStarted ??
      row?.started_at ??
      row?.startedAt ??
      row?.start_time ??
      row?.startTime ??
      row?.online_since ??
      row?.onlineSince ??
      row?.last_started ??
      row?.lastStarted
  );
  if (!startedAt) return null;
  const diff = now() - startedAt;
  return diff >= 0 ? Math.floor(diff / 1000) : null;
}

function extractStreamStartedAt(row = {}) {
  return parseStartTimestampToMs(
    row?.stream_started ??
      row?.streamStarted ??
      row?.started_at ??
      row?.startedAt ??
      row?.start_time ??
      row?.startTime ??
      row?.online_since ??
      row?.onlineSince ??
      row?.last_started ??
      row?.lastStarted
  );
}

function extractLiveFps(row = {}, progressInfo = {}, streamInfo = {}) {
  const raw = firstNonEmpty([
    row?.fps,
    row?.stream_fps,
    row?.streamFPS,
    row?.current_fps,
    row?.currentFps,
    row?.video_fps,
    row?.videoFps,
    row?.frame_rate,
    row?.frameRate,
    progressInfo?.fps,
    progressInfo?.frame_rate,
    streamInfo?.fps,
    streamInfo?.frame_rate,
    streamInfo?.codecs?.video?.avg_frame_rate,
    streamInfo?.codecs?.video?.r_frame_rate,
  ]);
  const parsed = parseRationalNumber(raw);
  return parsed !== null && parsed > 0 ? formatDecimal(parsed, 2) : '';
}

function extractLiveBitrateKbps(row = {}, progressInfo = {}, streamInfo = {}) {
  return (
    parseBitrateKbps(row?.bitrate) ??
    parseBitrateKbps(progressInfo?.bitrate) ??
    parseBitrateKbps(streamInfo?.bitrate) ??
    parseBitrateKbps(streamInfo?.codecs?.video?.bit_rate) ??
    parseBitrateKbps(streamInfo?.codecs?.audio?.bit_rate)
  );
}

function extractLiveResolution(row = {}, streamInfo = {}) {
  const width = safeNumber(streamInfo?.codecs?.video?.width ?? row?.width ?? row?.stream_width);
  const height = safeNumber(streamInfo?.codecs?.video?.height ?? row?.height ?? row?.stream_height);
  if (width && height) return `${Math.floor(width)}x${Math.floor(height)}`;
  return firstNonEmpty([row?.resolution, row?.stream_resolution, row?.streamResolution]);
}

function extractLiveVideoCodec(row = {}, streamInfo = {}) {
  return firstNonEmpty([row?.video_codec, row?.videoCodec, streamInfo?.codecs?.video?.codec_name]);
}

function extractLiveVideoProfile(row = {}, streamInfo = {}) {
  return firstNonEmpty([row?.video_profile, row?.videoProfile, streamInfo?.codecs?.video?.profile]);
}

function extractLiveAudioCodec(row = {}, streamInfo = {}) {
  return firstNonEmpty([row?.audio_codec, row?.audioCodec, streamInfo?.codecs?.audio?.codec_name]);
}

function extractLiveAudioChannels(row = {}, streamInfo = {}) {
  const value = safeNumber(row?.audio_channels ?? row?.audioChannels ?? streamInfo?.codecs?.audio?.channels);
  return value !== null && value >= 0 ? Math.floor(value) : null;
}

function extractLiveTranscodeSpeed(progressInfo = {}) {
  return firstNonEmpty([progressInfo?.speed]);
}

function extractLiveDupFrames(progressInfo = {}) {
  const value = safeNumber(progressInfo?.dup_frames ?? progressInfo?.dupFrames);
  return value !== null && value >= 0 ? Math.floor(value) : null;
}

function extractLiveDropFrames(progressInfo = {}) {
  const value = safeNumber(progressInfo?.drop_frames ?? progressInfo?.dropFrames);
  return value !== null && value >= 0 ? Math.floor(value) : null;
}

function extractLiveServerName(row = {}) {
  return firstNonEmpty([row?.server_name, row?.serverName]);
}

function extractLiveServerId(row = {}) {
  return firstNonEmpty([row?.server_id, row?.serverId]);
}

function extractLiveSourceHost(row = {}) {
  return extractHostLabel(firstNonEmpty([row?.current_source, row?.currentSource, row?.source]));
}

function extractLivePid(row = {}) {
  return firstNonEmpty([row?.pid, row?.monitor_pid, row?.monitorPid]);
}

function extractLiveStreamStatus(row = {}) {
  return firstNonEmpty([row?.stream_status, row?.streamStatus, row?.status]);
}

function normalizeLiveChannelRow(row = {}) {
  const id = String(row?.id ?? row?.stream_id ?? '').trim();
  if (!id) return null;
  const isUp = deriveLiveRuntimeStatus(row);
  if (isUp !== true && isUp !== false) return null;

  const progressInfo = extractProgressInfo(row);
  const streamInfo = extractStreamInfo(row);

  return {
    id,
    name: String(row?.stream_display_name || row?.name || `Channel ${id}`).trim() || `Channel ${id}`,
    isUp,
    streamStatus: extractLiveStreamStatus(row),
    xuiPid: extractLivePid(row),
    fps: extractLiveFps(row, progressInfo, streamInfo),
    serverName: extractLiveServerName(row),
    serverId: extractLiveServerId(row),
    sourceHost: extractLiveSourceHost(row),
    bitrateKbps: extractLiveBitrateKbps(row, progressInfo, streamInfo),
    resolution: extractLiveResolution(row, streamInfo),
    videoCodec: extractLiveVideoCodec(row, streamInfo),
    videoProfile: extractLiveVideoProfile(row, streamInfo),
    audioCodec: extractLiveAudioCodec(row, streamInfo),
    audioChannels: extractLiveAudioChannels(row, streamInfo),
    transcodeSpeed: extractLiveTranscodeSpeed(progressInfo),
    dupFrames: extractLiveDupFrames(progressInfo),
    dropFrames: extractLiveDropFrames(progressInfo),
    uptimeSeconds: extractUptimeSeconds(row),
    streamStartedAt: extractStreamStartedAt(row),
  };
}

function createLiveChannelStateItem(observed = {}, previous = null, { checkedAt = now(), downSinceAt, lastReminderAt } = {}) {
  const previousDownSinceAt = Number(previous?.downSinceAt || 0) || null;
  const previousLastReminderAt = Number(previous?.lastReminderAt || 0) || null;
  return {
    ...observed,
    downSinceAt: observed?.isUp === true ? null : downSinceAt ?? previousDownSinceAt ?? checkedAt,
    lastReminderAt: observed?.isUp === true ? null : lastReminderAt ?? previousLastReminderAt ?? null,
  };
}

function createPendingLiveChannelChange(baseline = null, observed = {}, existingPending = null, checkedAt = now()) {
  const reusingExisting = existingPending && existingPending.toIsUp === observed?.isUp;
  return {
    fromIsUp: baseline?.isUp === true ? true : baseline?.isUp === false ? false : null,
    toIsUp: observed?.isUp === true,
    startedAt: reusingExisting ? Number(existingPending.startedAt || checkedAt) || checkedAt : checkedAt,
    snapshot: {
      ...observed,
      downSinceAt: null,
      lastReminderAt: null,
    },
  };
}

function summarizeLiveSnapshot(snapshot = {}) {
  const rows = Object.values(snapshot || {});
  const tracked = rows.length;
  const up = rows.filter((row) => row?.isUp === true).length;
  const down = rows.filter((row) => row?.isUp === false).length;
  return { tracked, up, down };
}

function sortLiveItems(list = []) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function formatLiveCodecSummary(item = {}) {
  const video = String(item?.videoCodec || '').trim();
  const audio = String(item?.audioCodec || '').trim();
  const audioChannels = Number(item?.audioChannels || 0) || 0;

  if (video && audio) return `${video}/${audio}${audioChannels > 0 ? ` ${audioChannels}ch` : ''}`;
  if (video) return video;
  if (audio) return `${audio}${audioChannels > 0 ? ` ${audioChannels}ch` : ''}`;
  return '';
}

function formatLiveTranscodeSummary(item = {}) {
  const parts = [];
  if (item?.transcodeSpeed && String(item.transcodeSpeed).trim().toLowerCase() !== '1x') {
    parts.push(`speed ${String(item.transcodeSpeed).trim()}`);
  }
  if (Number(item?.dropFrames || 0) > 0) parts.push(`drop ${Number(item.dropFrames)}`);
  if (Number(item?.dupFrames || 0) > 0) parts.push(`dup ${Number(item.dupFrames)}`);
  return parts.join(' • ');
}

function formatLiveMediaSummary(item = {}) {
  const parts = [];
  if (item?.resolution) parts.push(String(item.resolution).trim());
  const codec = formatLiveCodecSummary(item);
  if (codec) parts.push(codec);
  if (item?.fps) parts.push(`${String(item.fps).trim()} fps`);
  if (item?.bitrateKbps !== null && item?.bitrateKbps !== undefined) {
    const bitrate = formatKbps(item.bitrateKbps);
    if (bitrate) parts.push(bitrate);
  }
  return parts.join(' • ');
}

function formatLiveStatusDuration(item = {}) {
  if (item?.isUp) {
    if (Number(item?.recoveredAfterSeconds || 0) > 0) {
      return `Recovered after ${formatDurationShort(item.recoveredAfterSeconds)}`;
    }
    if (Number(item?.uptimeSeconds || 0) > 0) {
      return `Uptime ${formatDurationShort(item.uptimeSeconds)}`;
    }
    return '';
  }

  if (Number(item?.downForSeconds || 0) > 0) {
    return `Down for ${formatDurationShort(item.downForSeconds)}`;
  }

  return '';
}

function toTelegramPart(text = '') {
  const value = String(text || '').trim();
  return value ? ` • ${value}` : '';
}

function buildLiveItemTemplateStamps(item = {}, { timeZone = 'Asia/Manila' } = {}) {
  const stamps = buildCommonTemplateStamps({ ts: now(), timeZone });
  const statusText = item?.isUp ? 'Up' : 'Down';
  const statusIcon = item?.isUp ? '🟢' : '🔴';
  const status = `${statusIcon} ${statusText}`;
  const statusDuration = formatLiveStatusDuration(item);
  const mediaSummary = formatLiveMediaSummary(item);
  const transcodeSummary = formatLiveTranscodeSummary(item);
  const source = String(item?.sourceHost || '').trim();
  const serverLine = item?.serverName ? `Server ${String(item.serverName).trim()}` : '';
  const resolutionLine = String(item?.resolution || '').trim();
  const codecsLine = formatLiveCodecSummary(item);
  const fpsLine = item?.fps ? `${String(item.fps).trim()} fps` : '';
  const bitrateLine =
    item?.bitrateKbps !== null && item?.bitrateKbps !== undefined ? formatKbps(item.bitrateKbps) : '';
  const sourceLine = source ? `Source ${source}` : '';
  const transcodeSpeed =
    item?.transcodeSpeed && String(item.transcodeSpeed).trim().toLowerCase() !== '1x' ? String(item.transcodeSpeed).trim() : '';
  const transcodeSpeedLine = transcodeSpeed ? `speed ${transcodeSpeed}` : '';
  const dropFrames = Number(item?.dropFrames || 0) > 0 ? String(Number(item.dropFrames)) : '';
  const dropFramesLine = dropFrames ? `drop ${dropFrames}` : '';
  const dupFrames = Number(item?.dupFrames || 0) > 0 ? String(Number(item.dupFrames)) : '';
  const dupFramesLine = dupFrames ? `dup ${dupFrames}` : '';
  const detailsLineParts = [status];
  const metaLineParts = [];

  if (statusDuration) detailsLineParts.push(statusDuration);
  if (serverLine) detailsLineParts.push(serverLine);
  if (resolutionLine) metaLineParts.push(resolutionLine);
  if (codecsLine) metaLineParts.push(codecsLine);
  if (fpsLine) metaLineParts.push(fpsLine);
  if (bitrateLine) metaLineParts.push(bitrateLine);
  if (sourceLine) metaLineParts.push(sourceLine);
  if (transcodeSpeedLine) metaLineParts.push(transcodeSpeedLine);
  if (dropFramesLine) metaLineParts.push(dropFramesLine);
  if (dupFramesLine) metaLineParts.push(dupFramesLine);

  setStampAliases(stamps, ['channel-name'], String(item?.name || '').trim());
  setStampAliases(stamps, ['channel-status-icon'], statusIcon);
  setStampAliases(stamps, ['channel-status-text'], statusText);
  setStampAliases(stamps, ['channel-status'], status);
  setStampAliases(stamps, ['channel-status-duration'], statusDuration);
  setStampAliases(stamps, ['channel-status-duration-part'], toTelegramPart(statusDuration));
  setStampAliases(stamps, ['channel-server'], String(item?.serverName || '').trim());
  setStampAliases(stamps, ['channel-server-line'], serverLine);
  setStampAliases(stamps, ['channel-server-part'], toTelegramPart(serverLine));
  setStampAliases(stamps, ['channel-source'], source);
  setStampAliases(stamps, ['channel-source-line'], sourceLine);
  setStampAliases(stamps, ['channel-source-part'], toTelegramPart(sourceLine));
  setStampAliases(stamps, ['channel-resolution'], resolutionLine);
  setStampAliases(stamps, ['channel-resolution-line'], resolutionLine);
  setStampAliases(stamps, ['channel-resolution-part'], toTelegramPart(resolutionLine));
  setStampAliases(stamps, ['channel-video-codec'], String(item?.videoCodec || '').trim());
  setStampAliases(stamps, ['channel-video-profile'], String(item?.videoProfile || '').trim());
  setStampAliases(stamps, ['channel-audio-codec'], String(item?.audioCodec || '').trim());
  setStampAliases(
    stamps,
    ['channel-audio-channels'],
    Number(item?.audioChannels || 0) > 0 ? String(Number(item.audioChannels)) : ''
  );
  setStampAliases(stamps, ['channel-codecs'], codecsLine);
  setStampAliases(stamps, ['channel-codecs-line'], codecsLine);
  setStampAliases(stamps, ['channel-codecs-part'], toTelegramPart(codecsLine));
  setStampAliases(stamps, ['channel-fps'], String(item?.fps || '').trim());
  setStampAliases(stamps, ['channel-fps-line'], fpsLine);
  setStampAliases(stamps, ['channel-fps-part'], toTelegramPart(fpsLine));
  setStampAliases(
    stamps,
    ['channel-bitrate-kbps'],
    item?.bitrateKbps !== null && item?.bitrateKbps !== undefined ? formatDecimal(item.bitrateKbps) : ''
  );
  setStampAliases(stamps, ['channel-bitrate-line'], bitrateLine);
  setStampAliases(stamps, ['channel-bitrate-part'], toTelegramPart(bitrateLine));
  setStampAliases(stamps, ['channel-transcode-speed'], transcodeSpeed);
  setStampAliases(stamps, ['channel-transcode-speed-line'], transcodeSpeedLine);
  setStampAliases(stamps, ['channel-transcode-speed-part'], toTelegramPart(transcodeSpeedLine));
  setStampAliases(stamps, ['channel-drop-frames'], dropFrames);
  setStampAliases(stamps, ['channel-drop-frames-line'], dropFramesLine);
  setStampAliases(stamps, ['channel-drop-frames-part'], toTelegramPart(dropFramesLine));
  setStampAliases(stamps, ['channel-dup-frames'], dupFrames);
  setStampAliases(stamps, ['channel-dup-frames-line'], dupFramesLine);
  setStampAliases(stamps, ['channel-dup-frames-part'], toTelegramPart(dupFramesLine));
  setStampAliases(stamps, ['channel-media-summary'], mediaSummary);
  setStampAliases(stamps, ['channel-transcode-summary'], transcodeSummary);
  setStampAliases(stamps, ['channel-details-line'], detailsLineParts.join(' • '));
  setStampAliases(stamps, ['channel-meta-line'], metaLineParts.join(' • '));
  setStampAliases(
    stamps,
    ['down-sincedatetime'],
    Number(item?.downSinceAt || 0) > 0 ? formatFriendlyDateTimeInTimeZone(item.downSinceAt, timeZone) : ''
  );
  setStampAliases(
    stamps,
    ['stream-starteddatetime'],
    Number(item?.streamStartedAt || 0) > 0 ? formatFriendlyDateTimeInTimeZone(item.streamStartedAt, timeZone) : ''
  );

  return stamps;
}

function renderLiveItemTemplate(item = {}, { settings = null, timeZone = 'Asia/Manila' } = {}) {
  const templates = getTelegramMessageTemplates(settings);
  return renderTelegramTemplate(templates.liveItem, buildLiveItemTemplateStamps(item, { timeZone }));
}

function renderLiveItems(list = [], { limit = 8, settings = null, timeZone = 'Asia/Manila' } = {}) {
  const capped = sortLiveItems(list).slice(0, limit);
  const items = capped.map((item) => renderLiveItemTemplate(item, { settings, timeZone })).filter(Boolean);
  const extra = Math.max(0, Number((Array.isArray(list) ? list.length : 0) - capped.length) || 0);
  if (extra > 0) items.push(`• +${extra} more`);
  return items.join('\n');
}

function buildLiveChangeMessage({ up = [], down = [], summary = null, timeZone = 'Asia/Manila', alertDelayMinutes = 15, settings = null } = {}) {
  const templates = getTelegramMessageTemplates(settings);
  const checkedAt = now();
  const downItems = renderLiveItems(down, { settings, timeZone });
  const upItems = renderLiveItems(up, { settings, timeZone });
  const totalsLine =
    summary && Number(summary?.tracked || 0) > 0
      ? `Current totals: ${summary.up} up, ${summary.down} down, ${summary.tracked} tracked`
      : '';
  const stamps = {
    ...buildCommonTemplateStamps({
      ts: checkedAt,
      timeZone,
      dailyReportTime: settings?.telegram?.dailyReportTime || '07:00',
    }),
  };

  setStampAliases(stamps, ['checked-datetime'], formatFriendlyDateTimeInTimeZone(checkedAt, timeZone));
  setStampAliases(stamps, ['detected-down-count'], down.length);
  setStampAliases(stamps, ['detected-up-count'], up.length);
  setStampAliases(stamps, ['current-up-count'], Number(summary?.up || 0) || 0);
  setStampAliases(stamps, ['current-down-count'], Number(summary?.down || 0) || 0);
  setStampAliases(stamps, ['tracked-count'], Number(summary?.tracked || 0) || 0);
  setStampAliases(stamps, ['current-totals-line'], totalsLine);
  setStampAliases(stamps, ['alert-delay-minutes'], alertDelayMinutes);
  setStampAliases(
    stamps,
    ['alert-delay-text'],
    alertDelayMinutes > 0 ? `${alertDelayMinutes} minute(s) stable before send` : 'immediate'
  );
  setStampAliases(
    stamps,
    ['alert-delay-line'],
    alertDelayMinutes > 0 ? `Alert delay: ${alertDelayMinutes} minute(s) stable before send` : 'Alert delay: immediate'
  );
  setStampAliases(stamps, ['down-items'], downItems);
  setStampAliases(stamps, ['up-items'], upItems);
  setStampAliases(stamps, ['down-heading'], down.length ? `Down (${down.length})` : '');
  setStampAliases(stamps, ['up-heading'], up.length ? `Up (${up.length})` : '');
  setStampAliases(
    stamps,
    ['down-section'],
    linesToSection(down.length ? [`Down (${down.length})`, downItems] : [])
  );
  setStampAliases(
    stamps,
    ['up-section'],
    linesToSection(up.length ? [`Up (${up.length})`, upItems] : [])
  );

  return renderTelegramTemplate(templates.liveChange, stamps);
}

function buildLiveDownReminderMessage({ items = [], summary = null, timeZone = 'Asia/Manila', reminderHours = 12, settings = null } = {}) {
  const templates = getTelegramMessageTemplates(settings);
  const checkedAt = now();
  const reminderItems = renderLiveItems(items, { settings, timeZone });
  const totalsLine =
    summary && Number(summary?.tracked || 0) > 0
      ? `Current totals: ${summary.up} up, ${summary.down} down, ${summary.tracked} tracked`
      : '';
  const stamps = {
    ...buildCommonTemplateStamps({
      ts: checkedAt,
      timeZone,
      dailyReportTime: settings?.telegram?.dailyReportTime || '07:00',
    }),
  };

  setStampAliases(stamps, ['checked-datetime'], formatFriendlyDateTimeInTimeZone(checkedAt, timeZone));
  setStampAliases(stamps, ['current-up-count'], Number(summary?.up || 0) || 0);
  setStampAliases(stamps, ['current-down-count'], Number(summary?.down || 0) || 0);
  setStampAliases(stamps, ['tracked-count'], Number(summary?.tracked || 0) || 0);
  setStampAliases(stamps, ['current-totals-line'], totalsLine);
  setStampAliases(stamps, ['reminder-hours'], reminderHours);
  setStampAliases(
    stamps,
    ['reminder-interval-text'],
    reminderHours > 0 ? `every ${reminderHours} hour(s)` : 'disabled'
  );
  setStampAliases(
    stamps,
    ['reminder-interval-line'],
    reminderHours > 0 ? `Reminder interval: every ${reminderHours} hour(s)` : 'Reminder interval: disabled'
  );
  setStampAliases(stamps, ['reminder-items'], reminderItems);
  setStampAliases(stamps, ['reminder-heading'], items.length ? `Still down (${items.length})` : '');
  setStampAliases(
    stamps,
    ['reminder-section'],
    linesToSection(items.length ? [`Still down (${items.length})`, reminderItems] : [])
  );

  return renderTelegramTemplate(templates.liveDownReminder, stamps);
}

async function fetchSecretConfiguredXuiRows() {
  const keys = secretKeys();
  const baseUrl = String(await getSecret(keys.xuiAdminBaseUrl)).trim();
  const accessCode = String(await getSecret(keys.xuiAdminAccessCode)).trim();
  const apiKey = String(await getSecret(keys.xuiAdminApiKey)).trim();
  if (!baseUrl || !accessCode || !apiKey) return null;

  const origin = normalizeBaseUrl(baseUrl);
  const base = `${origin.replace(/\/+$/, '')}/${encodeURIComponent(accessCode)}/`;
  const insecureTls = await allowInsecureTlsFor(base);
  const rows = [];

  for (let start = 0; start <= 2000; start += 50) {
    const url = new URL(base);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('action', 'get_streams');
    if (start) url.searchParams.set('start', String(start));
    const response = await fetch(url.toString(), {
      cache: 'no-store',
      redirect: 'follow',
      ...(insecureTls ? { dispatcher: insecureDispatcher } : {}),
    });
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new Error(`XUI Admin ${response.status}: ${text.slice(0, 200)}`);
    const payload = JSON.parse(text);
    const chunk = Array.isArray(payload?.data) ? payload.data : [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < 50) break;
  }

  return rows;
}

async function fetchIntegratedXuiRows() {
  const rows = [];
  for (let start = 0; start <= 2000; start += 50) {
    const payload = await xuiApiCall({
      action: 'get_streams',
      params: start ? { start } : {},
    });
    const chunk = Array.isArray(payload?.data) ? payload.data : [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < 50) break;
  }
  return rows;
}

async function fetchLiveChannelSnapshot() {
  let rows = null;

  try {
    rows = await fetchSecretConfiguredXuiRows();
  } catch {}

  if (!Array.isArray(rows) || !rows.length) {
    rows = await fetchIntegratedXuiRows();
  }

  const snapshot = {};
  for (const row of rows) {
    const channel = normalizeLiveChannelRow(row);
    if (!channel) continue;
    snapshot[channel.id] = {
      name: channel.name,
      isUp: channel.isUp,
      streamStatus: channel.streamStatus,
      xuiPid: channel.xuiPid,
      fps: channel.fps,
      serverName: channel.serverName,
      serverId: channel.serverId,
      sourceHost: channel.sourceHost,
      bitrateKbps: channel.bitrateKbps,
      resolution: channel.resolution,
      videoCodec: channel.videoCodec,
      videoProfile: channel.videoProfile,
      audioCodec: channel.audioCodec,
      audioChannels: channel.audioChannels,
      transcodeSpeed: channel.transcodeSpeed,
      dupFrames: channel.dupFrames,
      dropFrames: channel.dropFrames,
      uptimeSeconds: channel.uptimeSeconds,
      streamStartedAt: channel.streamStartedAt,
    };
  }

  return snapshot;
}

async function maybeSendLiveChannelNotification({ settings, override = null } = {}) {
  if (!telegramLiveChannelsEnabled(settings)) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  const checkedAt = now();
  const snapshot = await fetchLiveChannelSnapshot();
  const summary = summarizeLiveSnapshot(snapshot);
  if (!summary.tracked) {
    return { ok: true, skipped: true, reason: 'no_channels' };
  }

  const alertDelayMinutes = Math.max(0, Number(settings?.telegram?.liveChannelAlertDelayMinutes || 0) || 0);
  const reminderHours = Math.max(0, Number(settings?.telegram?.liveChannelDownReminderHours || 0) || 0);
  const delayMs = alertDelayMinutes * 60 * 1000;
  const reminderMs = reminderHours * 60 * 60 * 1000;

  const state = await getNotificationState();
  const previousObserved = state?.telegram?.liveChannels?.channelsById || {};
  const previousNotified = state?.telegram?.liveChannels?.notifiedById || previousObserved || {};
  const previousPending = state?.telegram?.liveChannels?.pendingById || {};

  if (!Object.keys(previousNotified).length) {
    const initialized = {};
    for (const [id, item] of Object.entries(snapshot)) {
      initialized[id] = createLiveChannelStateItem(item, null, { checkedAt });
    }
    await updateNotificationState({
      telegram: {
        liveChannels: {
          lastCheckedAt: checkedAt,
          channelsById: snapshot,
          notifiedById: initialized,
          pendingById: {},
        },
      },
    });
    return { ok: true, skipped: true, reason: 'initial_snapshot', tracked: summary.tracked };
  }

  const nextNotified = {};
  const nextPending = {};
  const dueUp = [];
  const dueDown = [];
  const reminderItems = [];
  const ids = new Set([...Object.keys(previousNotified), ...Object.keys(snapshot)]);

  for (const id of ids) {
    const observed = snapshot[id] || null;
    const baseline = previousNotified[id] || null;
    const existingPending = previousPending[id] || null;

    if (!observed) {
      if (baseline) nextNotified[id] = baseline;
      if (existingPending) nextPending[id] = existingPending;
      continue;
    }

    if (!baseline) {
      nextNotified[id] = createLiveChannelStateItem(observed, null, { checkedAt });
      continue;
    }

    if (observed.isUp === baseline.isUp) {
      nextNotified[id] = createLiveChannelStateItem(observed, baseline, { checkedAt });
      continue;
    }

    const pending = createPendingLiveChannelChange(baseline, observed, existingPending, checkedAt);
    if (delayMs <= 0 || checkedAt - pending.startedAt >= delayMs) {
      const previousDownSinceAt = Number(baseline?.downSinceAt || 0) || null;
      const nextItem = createLiveChannelStateItem(observed, baseline, {
        checkedAt,
        downSinceAt: observed.isUp ? null : pending.startedAt,
        lastReminderAt: null,
      });
      nextNotified[id] = nextItem;

      if (observed.isUp) {
        dueUp.push({
          id,
          ...nextItem,
          recoveredAfterSeconds:
            previousDownSinceAt && checkedAt > previousDownSinceAt
              ? Math.floor((checkedAt - previousDownSinceAt) / 1000)
              : Math.floor((checkedAt - pending.startedAt) / 1000),
        });
      } else {
        dueDown.push({
          id,
          ...nextItem,
          downForSeconds: Math.floor((checkedAt - pending.startedAt) / 1000),
        });
      }
      continue;
    }

    nextNotified[id] = baseline;
    nextPending[id] = pending;
  }

  if (reminderMs > 0) {
    for (const [id, baseline] of Object.entries(nextNotified)) {
      if (!baseline || baseline.isUp !== false) continue;
      if (!snapshot[id]) continue;
      if (nextPending[id]?.toIsUp === true) continue;

      const downSinceAt = Number(baseline?.downSinceAt || 0) || null;
      if (!downSinceAt) continue;

      const lastReminderAt = Number(baseline?.lastReminderAt || 0) || 0;
      const referenceTs = lastReminderAt > 0 ? lastReminderAt : downSinceAt;
      if (checkedAt - referenceTs < reminderMs) continue;

      const reminderItem = createLiveChannelStateItem(snapshot[id], baseline, {
        checkedAt,
        downSinceAt,
        lastReminderAt: checkedAt,
      });
      nextNotified[id] = reminderItem;
      reminderItems.push({
        id,
        ...reminderItem,
        downForSeconds: Math.floor((checkedAt - downSinceAt) / 1000),
      });
    }
  }

  const timeZone = await getNotificationTimeZone();
  if (dueUp.length || dueDown.length) {
    await sendTelegramMessage({
      text: buildLiveChangeMessage({
        up: dueUp,
        down: dueDown,
        summary,
        timeZone,
        alertDelayMinutes,
        settings,
      }),
      override,
    });
  }

  if (reminderItems.length) {
    await sendTelegramMessage({
      text: buildLiveDownReminderMessage({
        items: reminderItems,
        summary,
        timeZone,
        reminderHours,
        settings,
      }),
      override,
    });
  }

  await updateNotificationState({
    telegram: {
      liveChannels: {
        lastCheckedAt: checkedAt,
        channelsById: snapshot,
        notifiedById: nextNotified,
        pendingById: nextPending,
      },
    },
  });

  if (!dueUp.length && !dueDown.length && !reminderItems.length) {
    return {
      ok: true,
      skipped: true,
      reason: Object.keys(nextPending).length ? 'pending_delay' : 'no_change',
      tracked: summary.tracked,
      pending: Object.keys(nextPending).length,
    };
  }

  return {
    ok: true,
    sent: true,
    tracked: summary.tracked,
    currentUp: summary.up,
    currentDown: summary.down,
    up: dueUp.length,
    down: dueDown.length,
    reminders: reminderItems.length,
    pending: Object.keys(nextPending).length,
  };
}

function normalizeNasSnapshot(status = null) {
  const source = status && typeof status === 'object' ? status : {};
  const total = Number(source?.space?.total || 0) || 0;
  const used = Number(source?.space?.used || 0) || 0;
  const avail = Number(source?.space?.avail || 0) || Math.max(0, total - used);
  return {
    label: 'NAS',
    path: String(source?.mountDir || '').trim(),
    total,
    used,
    avail,
    ok: source?.ok === true || total > 0,
    error: String(source?.error || '').trim(),
  };
}

function normalizeVodSnapshot(source = null) {
  const input = source && typeof source === 'object' ? source : {};
  if (input?.logical && typeof input.logical === 'object') {
    const total = Number(input.logical.size || 0) || 0;
    const used = Number(input.logical.used || 0) || 0;
    const avail = Number(input.logical.avail || 0) || Math.max(0, total - used);
    return {
      label: 'XUI VOD',
      path: String(input?.resolvedPath || input?.preferredPath || '/home/xui/content/vod').trim() || '/home/xui/content/vod',
      total,
      used,
      avail,
      ok: total > 0 || input?.pathExists === true,
      error: '',
    };
  }

  const total = Number(input?.totalBytes || 0) || 0;
  const used = Number(input?.usedBytes || 0) || 0;
  const avail = Number(input?.availBytes || 0) || Math.max(0, total - used);
  return {
    label: 'XUI VOD',
    path: String(input?.resolvedPath || '/home/xui/content/vod').trim() || '/home/xui/content/vod',
    total,
    used,
    avail,
    ok: total > 0,
    error: String(input?.error || '').trim(),
  };
}

async function resolveNasSnapshot(status = null) {
  if (status && typeof status === 'object') return normalizeNasSnapshot(status);
  try {
    return normalizeNasSnapshot(await fetchMountStatus());
  } catch (error) {
    return {
      label: 'NAS',
      path: '',
      total: 0,
      used: 0,
      avail: 0,
      ok: false,
      error: error?.message || 'Unavailable',
    };
  }
}

async function resolveVodSnapshot(vodState = null) {
  if (vodState && typeof vodState === 'object' && (Number(vodState?.totalBytes || 0) > 0 || String(vodState?.resolvedPath || '').trim())) {
    return normalizeVodSnapshot(vodState);
  }
  try {
    return normalizeVodSnapshot(await fetchVodStorageDevices());
  } catch (error) {
    return {
      label: 'XUI VOD',
      path: '/home/xui/content/vod',
      total: 0,
      used: 0,
      avail: 0,
      ok: false,
      error: error?.message || 'Unavailable',
    };
  }
}

function buildStorageSection(snapshot) {
  if (!snapshot?.ok) {
    return [
      snapshot?.label || 'Storage',
      `• Status: unavailable${snapshot?.error ? ` (${snapshot.error})` : ''}`,
      snapshot?.path ? `• Path: ${snapshot.path}` : null,
    ].filter(Boolean);
  }

  return [
    snapshot.label,
    snapshot.path ? `• Path: ${snapshot.path}` : null,
    `• Used: ${formatBytes(snapshot.used)} / ${formatBytes(snapshot.total)} (${formatPercent(snapshot.used, snapshot.total)})`,
    `• Free: ${formatBytes(snapshot.avail)}`,
  ].filter(Boolean);
}

function bytesToGbValue(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value / (1024 * 1024 * 1024);
}

function buildStorageSectionWithPolicy(snapshot, policy = null) {
  const lines = buildStorageSection(snapshot);
  if (snapshot?.ok && Number(policy?.triggerUsedGb || 0) > 0 && Number(policy?.limitUsedGb || 0) > 0) {
    const usedGb = bytesToGbValue(snapshot.used);
    const triggerReached = usedGb >= Number(policy.triggerUsedGb || 0);
    lines.push(
      `• AutoDelete: ${triggerReached ? 'trigger reached' : 'below trigger'} (Trigger ${Number(policy.triggerUsedGb).toFixed(1)} GB / Limit ${Number(policy.limitUsedGb).toFixed(1)} GB)`
    );
  }
  return lines;
}

function buildStorageTemplateStamps({
  nasSnapshot = null,
  vodSnapshot = null,
  autoDeletePolicy = null,
  autoDeleteTriggered = false,
  timeZone = 'Asia/Manila',
  settings = null,
  ts = null,
} = {}) {
  const stamps = buildCommonTemplateStamps({
    ts: ts || now(),
    timeZone,
    dailyReportTime: settings?.telegram?.dailyReportTime || '07:00',
  });
  const applyStorageStamps = (prefix, snapshot = null) => {
    const safePrefix = String(prefix || '').trim().toLowerCase();
    if (!snapshot) {
      setStampAliases(stamps, [`${safePrefix}-title`], '');
      setStampAliases(stamps, [`${safePrefix}-status`], '');
      setStampAliases(stamps, [`${safePrefix}-status-line`], '');
      setStampAliases(stamps, [`${safePrefix}-path`], '');
      setStampAliases(stamps, [`${safePrefix}-path-line`], '');
      setStampAliases(stamps, [`${safePrefix}-used`], '');
      setStampAliases(stamps, [`${safePrefix}-total`], '');
      setStampAliases(stamps, [`${safePrefix}-free`], '');
      setStampAliases(stamps, [`${safePrefix}-percent`], '');
      setStampAliases(stamps, [`${safePrefix}-used-line`], '');
      setStampAliases(stamps, [`${safePrefix}-free-line`], '');
      setStampAliases(stamps, [`${safePrefix}-auto-delete-state`], '');
      setStampAliases(stamps, [`${safePrefix}-auto-delete-line`], '');
      return;
    }
    const label = snapshot ? snapshot.label || (safePrefix === 'vod' ? 'XUI VOD' : safePrefix.toUpperCase()) : '';
    const path = String(snapshot?.path || '').trim();
    const used = snapshot?.ok ? formatBytes(snapshot.used) : '';
    const total = snapshot?.ok ? formatBytes(snapshot.total) : '';
    const free = snapshot?.ok ? formatBytes(snapshot.avail) : '';
    const percent = snapshot?.ok ? formatPercent(snapshot.used, snapshot.total) : '';
    const status = snapshot?.ok ? 'ok' : 'unavailable';
    const statusLine = snapshot?.ok ? '' : `• Status: unavailable${snapshot?.error ? ` (${snapshot.error})` : ''}`;
    const pathLine = path ? `• Path: ${path}` : '';
    const usedLine = snapshot?.ok ? `• Used: ${used} / ${total} (${percent})` : '';
    const freeLine = snapshot?.ok ? `• Free: ${free}` : '';
    const usedGb = snapshot?.ok ? bytesToGbValue(snapshot.used) : 0;
    const autoDeleteState =
      snapshot?.ok && Number(autoDeletePolicy?.triggerUsedGb || 0) > 0 && Number(autoDeletePolicy?.limitUsedGb || 0) > 0
        ? usedGb >= Number(autoDeletePolicy.triggerUsedGb || 0)
          ? 'trigger reached'
          : 'below trigger'
        : '';
    const autoDeleteLine =
      snapshot?.ok && Number(autoDeletePolicy?.triggerUsedGb || 0) > 0 && Number(autoDeletePolicy?.limitUsedGb || 0) > 0
        ? `• AutoDelete: ${autoDeleteState} (Trigger ${Number(autoDeletePolicy.triggerUsedGb).toFixed(1)} GB / Limit ${Number(autoDeletePolicy.limitUsedGb).toFixed(1)} GB)`
        : '';

    setStampAliases(stamps, [`${safePrefix}-title`], label);
    setStampAliases(stamps, [`${safePrefix}-status`], status);
    setStampAliases(stamps, [`${safePrefix}-status-line`], statusLine);
    setStampAliases(stamps, [`${safePrefix}-path`], path);
    setStampAliases(stamps, [`${safePrefix}-path-line`], pathLine);
    setStampAliases(stamps, [`${safePrefix}-used`], used);
    setStampAliases(stamps, [`${safePrefix}-total`], total);
    setStampAliases(stamps, [`${safePrefix}-free`], free);
    setStampAliases(stamps, [`${safePrefix}-percent`], percent);
    setStampAliases(stamps, [`${safePrefix}-used-line`], usedLine);
    setStampAliases(stamps, [`${safePrefix}-free-line`], freeLine);
    setStampAliases(stamps, [`${safePrefix}-auto-delete-state`], autoDeleteState);
    setStampAliases(stamps, [`${safePrefix}-auto-delete-line`], autoDeleteLine);
  };

  setStampAliases(stamps, ['auto-delete-state'], autoDeleteTriggered ? 'trigger reached' : 'below trigger');
  setStampAliases(
    stamps,
    ['trigger-gb'],
    Number(autoDeletePolicy?.triggerUsedGb || 0) > 0 ? Number(autoDeletePolicy.triggerUsedGb).toFixed(1) : ''
  );
  setStampAliases(
    stamps,
    ['limit-gb'],
    Number(autoDeletePolicy?.limitUsedGb || 0) > 0 ? Number(autoDeletePolicy.limitUsedGb).toFixed(1) : ''
  );
  setStampAliases(
    stamps,
    ['thresholds-line'],
    Number(autoDeletePolicy?.triggerUsedGb || 0) > 0 && Number(autoDeletePolicy?.limitUsedGb || 0) > 0
      ? `Thresholds: Trigger ${Number(autoDeletePolicy.triggerUsedGb).toFixed(1)} GB / Limit ${Number(autoDeletePolicy.limitUsedGb).toFixed(1)} GB`
      : ''
  );
  applyStorageStamps('nas', nasSnapshot);
  applyStorageStamps('vod', vodSnapshot);
  setStampAliases(
    stamps,
    ['nas-section'],
    nasSnapshot ? linesToSection(buildStorageSectionWithPolicy(nasSnapshot, autoDeletePolicy)) : ''
  );
  setStampAliases(
    stamps,
    ['vod-section'],
    vodSnapshot ? linesToSection(buildStorageSectionWithPolicy(vodSnapshot, autoDeletePolicy)) : ''
  );
  return stamps;
}

function buildLiveSectionForReport(live = null) {
  if (!live?.ok) {
    return ['Live TV', `• Status: unavailable${live?.error ? ` (${live.error})` : ''}`];
  }

  const lines = [
    'Live TV',
    `• Tracked: ${live.summary.tracked}`,
    `• Up: ${live.summary.up}`,
    `• Down: ${live.summary.down}`,
  ];
  if (Array.isArray(live.downChannels) && live.downChannels.length) {
    lines.push(`• Down sample: ${live.downChannels.slice(0, 5).map((item) => item.name).join(', ')}`);
  }
  return lines;
}

function summarizeUserReports(db) {
  const reports = Array.isArray(db?.reports) ? db.reports : [];
  const lastDayCutoff = now() - 24 * 60 * 60 * 1000;
  const open = reports.filter((row) => String(row?.status || '').trim().toLowerCase() === 'open').length;
  const resolved = reports.filter((row) => String(row?.status || '').trim().toLowerCase() === 'resolved').length;
  const ignored = reports.filter((row) => String(row?.status || '').trim().toLowerCase() === 'ignored').length;
  const recent = reports.filter((row) => Number(row?.createdAt || 0) >= lastDayCutoff).length;
  const latestOpen = reports
    .filter((row) => String(row?.status || '').trim().toLowerCase() === 'open')
    .slice(0, 3)
    .map((row) => {
      const username = String(row?.user?.username || '').trim() || 'unknown';
      const issue = String(row?.choiceTitle || row?.choice || 'Unknown issue').trim();
      return `${username}: ${issue}`;
    });
  return {
    total: reports.length,
    open,
    resolved,
    ignored,
    recent,
    latestOpen,
  };
}

function buildUserReportsSection(summary) {
  const lines = [
    'User Reports',
    `• Total: ${summary.total}`,
    `• Open: ${summary.open}`,
    `• Resolved: ${summary.resolved}`,
    `• Ignored: ${summary.ignored}`,
    `• New last 24h: ${summary.recent}`,
  ];
  if (summary.latestOpen.length) {
    lines.push(`• Latest open: ${summary.latestOpen.join(' | ')}`);
  }
  return lines;
}

async function buildDailyMonitorReportData({ mountStatus = null, vodState = null } = {}) {
  const db = await getAdminDb();
  const [nasSnapshot, vodSnapshot, timeZone] = await Promise.all([
    resolveNasSnapshot(mountStatus),
    resolveVodSnapshot(vodState),
    getNotificationTimeZone(),
  ]);

  const primaryTotalBytes = Number(vodSnapshot?.total || 0) > 0 ? Number(vodSnapshot.total || 0) : Number(nasSnapshot?.total || 0) || 0;
  const autoDeletePolicy = deriveStoragePolicy({
    settings: db?.autodownloadSettings || {},
    totalBytes: primaryTotalBytes,
  });
  const primaryUsedGb = Number(vodSnapshot?.total || 0) > 0 ? bytesToGbValue(vodSnapshot.used) : bytesToGbValue(nasSnapshot.used);
  const autoDeleteTriggered =
    Number(autoDeletePolicy?.triggerUsedGb || 0) > 0 && primaryUsedGb >= Number(autoDeletePolicy.triggerUsedGb || 0);

  let live = null;
  try {
    const snapshot = await fetchLiveChannelSnapshot();
    const summary = summarizeLiveSnapshot(snapshot);
    const downChannels = Object.entries(snapshot)
      .filter(([, item]) => item?.isUp === false)
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    live = { ok: true, snapshot, summary, downChannels };
  } catch (error) {
    live = { ok: false, error: error?.message || 'Unable to read XUI live status.' };
  }

  return {
    timeZone,
    db,
    live,
    userReports: summarizeUserReports(db),
    nasSnapshot,
    vodSnapshot,
    autoDeletePolicy,
    autoDeleteTriggered,
  };
}

async function buildStorageMonitorData({ mountStatus = null, vodState = null } = {}) {
  const db = await getAdminDb();
  const [nasSnapshot, vodSnapshot, timeZone] = await Promise.all([
    resolveNasSnapshot(mountStatus),
    resolveVodSnapshot(vodState),
    getNotificationTimeZone(),
  ]);

  const primaryTotalBytes = Number(vodSnapshot?.total || 0) > 0 ? Number(vodSnapshot.total || 0) : Number(nasSnapshot?.total || 0) || 0;
  const autoDeletePolicy = deriveStoragePolicy({
    settings: db?.autodownloadSettings || {},
    totalBytes: primaryTotalBytes,
  });
  const primaryUsedGb = Number(vodSnapshot?.total || 0) > 0 ? bytesToGbValue(vodSnapshot.used) : bytesToGbValue(nasSnapshot.used);
  const autoDeleteTriggered =
    Number(autoDeletePolicy?.triggerUsedGb || 0) > 0 && primaryUsedGb >= Number(autoDeletePolicy.triggerUsedGb || 0);

  return {
    timeZone,
    nasSnapshot,
    vodSnapshot,
    autoDeletePolicy,
    autoDeleteTriggered,
  };
}

function buildDailyMonitorReportMessage({
  live = null,
  userReports = null,
  nasSnapshot = null,
  vodSnapshot = null,
  autoDeletePolicy = null,
  autoDeleteTriggered = false,
  timeZone = 'Asia/Manila',
  settings = null,
} = {}) {
  const templates = getTelegramMessageTemplates(settings);
  const ts = now();
  const stamps = {
    ...buildStorageTemplateStamps({
      nasSnapshot,
      vodSnapshot,
      autoDeletePolicy,
      autoDeleteTriggered,
      timeZone,
      settings,
      ts,
    }),
  };

  const liveDownSample = Array.isArray(live?.downChannels) && live.downChannels.length ? live.downChannels.slice(0, 5).map((item) => item.name).join(', ') : '';
  const liveStatusLine = !live?.ok ? `• Status: unavailable${live?.error ? ` (${live.error})` : ''}` : '';
  const liveTrackedLine = live?.ok ? `• Tracked: ${Number(live?.summary?.tracked || 0) || 0}` : '';
  const liveUpLine = live?.ok ? `• Up: ${Number(live?.summary?.up || 0) || 0}` : '';
  const liveDownLine = live?.ok ? `• Down: ${Number(live?.summary?.down || 0) || 0}` : '';
  const liveDownSampleLine = live?.ok && liveDownSample ? `• Down sample: ${liveDownSample}` : '';
  const userReportsTotalLine = userReports ? `• Total: ${Number(userReports.total || 0) || 0}` : '';
  const userReportsOpenLine = userReports ? `• Open: ${Number(userReports.open || 0) || 0}` : '';
  const userReportsResolvedLine = userReports ? `• Resolved: ${Number(userReports.resolved || 0) || 0}` : '';
  const userReportsIgnoredLine = userReports ? `• Ignored: ${Number(userReports.ignored || 0) || 0}` : '';
  const userReportsRecentLine = userReports ? `• New last 24h: ${Number(userReports.recent || 0) || 0}` : '';
  const userReportsLatestOpen = Array.isArray(userReports?.latestOpen) ? userReports.latestOpen.join(' | ') : '';
  const userReportsLatestOpenLine = userReportsLatestOpen ? `• Latest open: ${userReportsLatestOpen}` : '';

  setStampAliases(stamps, ['live-title'], 'Live TV');
  setStampAliases(stamps, ['live-status-line'], liveStatusLine);
  setStampAliases(stamps, ['live-tracked-count'], Number(live?.summary?.tracked || 0) || 0);
  setStampAliases(stamps, ['live-up-count'], Number(live?.summary?.up || 0) || 0);
  setStampAliases(stamps, ['live-down-count'], Number(live?.summary?.down || 0) || 0);
  setStampAliases(stamps, ['live-down-sample'], liveDownSample);
  setStampAliases(stamps, ['live-tracked-line'], liveTrackedLine);
  setStampAliases(stamps, ['live-up-line'], liveUpLine);
  setStampAliases(stamps, ['live-down-line'], liveDownLine);
  setStampAliases(stamps, ['live-down-sample-line'], liveDownSampleLine);
  setStampAliases(stamps, ['user-reports-title'], 'User Reports');
  setStampAliases(stamps, ['user-reports-total-count'], Number(userReports?.total || 0) || 0);
  setStampAliases(stamps, ['user-reports-open-count'], Number(userReports?.open || 0) || 0);
  setStampAliases(stamps, ['user-reports-resolved-count'], Number(userReports?.resolved || 0) || 0);
  setStampAliases(stamps, ['user-reports-ignored-count'], Number(userReports?.ignored || 0) || 0);
  setStampAliases(stamps, ['user-reports-recent-count'], Number(userReports?.recent || 0) || 0);
  setStampAliases(stamps, ['user-reports-latest-open'], userReportsLatestOpen);
  setStampAliases(stamps, ['user-reports-total-line'], userReportsTotalLine);
  setStampAliases(stamps, ['user-reports-open-line'], userReportsOpenLine);
  setStampAliases(stamps, ['user-reports-resolved-line'], userReportsResolvedLine);
  setStampAliases(stamps, ['user-reports-ignored-line'], userReportsIgnoredLine);
  setStampAliases(stamps, ['user-reports-recent-line'], userReportsRecentLine);
  setStampAliases(stamps, ['user-reports-latest-open-line'], userReportsLatestOpenLine);
  setStampAliases(stamps, ['live-section'], linesToSection(buildLiveSectionForReport(live)));
  setStampAliases(stamps, ['user-reports-section'], linesToSection(buildUserReportsSection(userReports)));

  return renderTelegramTemplate(templates.dailyMonitorReport, stamps);
}

async function maybeSendDailyMonitorReport({ settings, override = null, mountStatus = null, vodState = null } = {}) {
  const timeZone = await getNotificationTimeZone();
  const today = dateKeyInTimezone(now(), timeZone);
  const state = await getNotificationState();
  const lastSentDate = String(state?.telegram?.dailyReports?.monitor?.lastSentDate || '').trim();
  if (lastSentDate === today) {
    return { ok: true, skipped: true, reason: 'already_sent', date: today };
  }

  const nowParts = getTimePartsInTimeZone(now(), timeZone);
  const currentMinutes = Number(nowParts.hour) * 60 + Number(nowParts.minute);
  const targetMinutes = parseTimeToMinutes(settings?.telegram?.dailyReportTime || '07:00');
  if (currentMinutes < targetMinutes) {
    return { ok: true, skipped: true, reason: 'before_time', date: today };
  }

  const data = await buildDailyMonitorReportData({ mountStatus, vodState });

  await sendTelegramMessage({
    text: buildDailyMonitorReportMessage({
      ...data,
      settings,
    }),
    override,
  });

  await updateNotificationState({
    telegram: {
      dailyReports: {
        monitor: {
          lastSentDate: today,
          lastSentAt: now(),
        },
      },
    },
  });

  return {
    ok: true,
    sent: true,
    date: today,
    live: data?.live?.ok === true,
    reports: true,
    nas: Boolean(data?.nasSnapshot),
    vod: Boolean(data?.vodSnapshot),
    autoDeleteTriggered: data?.autoDeleteTriggered === true,
  };
}

function buildImmediateStorageTriggerMessage({
  nasSnapshot = null,
  vodSnapshot = null,
  autoDeletePolicy = null,
  timeZone = 'Asia/Manila',
  settings = null,
} = {}) {
  const templates = getTelegramMessageTemplates(settings);
  const stamps = buildStorageTemplateStamps({
    nasSnapshot,
    vodSnapshot,
    autoDeletePolicy,
    autoDeleteTriggered: true,
    timeZone,
    settings,
    ts: now(),
  });
  return renderTelegramTemplate(templates.storageTrigger, stamps);
}

async function maybeSendStorageTriggerNotification({ settings, override = null, mountStatus = null, vodState = null } = {}) {
  const monitorNas = settings?.telegram?.nasSizeReportEnabled === true;
  const monitorVod = settings?.telegram?.vodSizeReportEnabled === true;
  const state = await getNotificationState();

  if (!monitorNas && !monitorVod) {
    if (state?.telegram?.storageTrigger?.active === true) {
      await updateNotificationState({
        telegram: {
          storageTrigger: {
            active: false,
          },
        },
      });
    }
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  const data = await buildStorageMonitorData({ mountStatus, vodState });
  if (!data.autoDeleteTriggered) {
    if (state?.telegram?.storageTrigger?.active === true) {
      await updateNotificationState({
        telegram: {
          storageTrigger: {
            active: false,
          },
        },
      });
    }
    return { ok: true, skipped: true, reason: 'below_trigger' };
  }

  if (state?.telegram?.storageTrigger?.active === true) {
    return { ok: true, skipped: true, reason: 'already_active' };
  }

  await sendTelegramMessage({
    text: buildImmediateStorageTriggerMessage({
      nasSnapshot: monitorNas ? data.nasSnapshot : null,
      vodSnapshot: monitorVod ? data.vodSnapshot : null,
      autoDeletePolicy: data.autoDeletePolicy,
      timeZone: data.timeZone,
      settings,
    }),
    override,
  });

  await updateNotificationState({
    telegram: {
      storageTrigger: {
        active: true,
        lastSentAt: now(),
      },
    },
  });

  return {
    ok: true,
    sent: true,
    nas: monitorNas,
    vod: monitorVod,
  };
}

export async function notifyTelegramUserReportCreated(report) {
  const settings = await getNotificationSettings();
  if (!telegramUserReportsEnabled(settings)) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  const timeZone = await getNotificationTimeZone();
  await sendTelegramMessage({
    text: buildUserReportMessage({
      report,
      timeZone,
      settings,
    }),
  });
  return { ok: true, sent: true };
}

export async function runTelegramNotificationTick({ mountStatus = null, vodState = null } = {}) {
  const settings = await getNotificationSettings();
  const override = null;

  const creds = await getTelegramCredentials({ override });
  if (!creds.configured) {
    return { ok: true, skipped: true, reason: 'telegram_not_configured' };
  }

  const result = {
    ok: true,
    liveChannels: { ok: true, skipped: true, reason: 'disabled' },
    storageTrigger: { ok: true, skipped: true, reason: 'disabled' },
    dailyMonitorReport: { ok: true, skipped: true, reason: 'pending' },
  };

  if (telegramLiveChannelsEnabled(settings)) {
    try {
      result.liveChannels = await maybeSendLiveChannelNotification({ settings, override });
    } catch (error) {
      result.liveChannels = { ok: false, error: error?.message || 'Live channel notification failed.' };
    }
  }

  try {
    result.storageTrigger = await maybeSendStorageTriggerNotification({
      settings,
      override,
      mountStatus,
      vodState,
    });
  } catch (error) {
    result.storageTrigger = { ok: false, error: error?.message || 'Storage trigger notification failed.' };
  }

  try {
    result.dailyMonitorReport = await maybeSendDailyMonitorReport({
      settings,
      override,
      mountStatus,
      vodState,
    });
  } catch (error) {
    result.dailyMonitorReport = { ok: false, error: error?.message || 'Daily monitor report failed.' };
  }

  return result;
}
