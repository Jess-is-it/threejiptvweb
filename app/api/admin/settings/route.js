import { NextResponse } from 'next/server';

import { adminCookieName, getAdminFromSessionToken } from '../../../../lib/server/adminAuth';
import { getAdminDb } from '../../../../lib/server/adminDb';
import { deriveStoragePolicy } from '../../../../lib/server/autodownload/storagePolicy';
import { getNotificationSettings, getNotificationState, getNotificationTimeZone, updateNotificationSettings } from '../../../../lib/server/notificationSettings';
import { getSecret, secretKeys, setSecret } from '../../../../lib/server/secrets';
import { getPublicSettings, updatePublicSettings } from '../../../../lib/server/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireAdmin(req) {
  const token = req.cookies.get(adminCookieName())?.value || '';
  const admin = await getAdminFromSessionToken(token);
  if (!admin) return null;
  return admin;
}

function envStatus() {
  const mask = (v) => (v ? `${String(v).slice(0, 2)}…${String(v).slice(-2)}` : '');
  const tmdb = process.env.TMDB_API_KEY || '';
  const xuione = process.env.XUIONE_URLS || process.env.XUI_SERVERS || '';

  return {
    tmdbApiKey: tmdb ? { set: true, masked: mask(tmdb) } : { set: false, masked: '' },
    xuioneUrls: xuione ? { set: true, masked: mask(xuione) } : { set: false, masked: '' },
  };
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

async function telegramSettingsForAdmin() {
  const keys = secretKeys();
  const botToken = String((await getSecret(keys.telegramBotToken)) || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String((await getSecret(keys.telegramChatId)) || process.env.TELEGRAM_CHAT_ID || '').trim();
  return {
    botToken,
    chatId,
    hasBotToken: Boolean(botToken),
    hasChatId: Boolean(chatId),
    configured: Boolean(botToken && chatId),
  };
}

async function buildResponsePayload() {
  const [settings, notificationSettings, notificationState, notificationTimeZone, telegram, db] = await Promise.all([
    getPublicSettings(),
    getNotificationSettings(),
    getNotificationState(),
    getNotificationTimeZone(),
    telegramSettingsForAdmin(),
    getAdminDb(),
  ]);

  const channels = notificationState?.telegram?.liveChannels?.channelsById || {};
  const liveChannelsTracked = Object.keys(channels).length;
  const liveChannelsUp = Object.values(channels).filter((item) => item?.isUp === true).length;
  const liveChannelsDown = Object.values(channels).filter((item) => item?.isUp === false).length;

  const vodTotalBytes = Number(db?.deletionState?.vodState?.totalBytes || 0) || 0;
  const nasTotalBytes = Number(db?.mountStatus?.space?.total || 0) || 0;
  const primaryTotalBytes = vodTotalBytes > 0 ? vodTotalBytes : nasTotalBytes;
  const autoDeletePolicy = deriveStoragePolicy({
    settings: db?.autodownloadSettings || {},
    totalBytes: primaryTotalBytes,
  });

  return {
    ok: true,
    settings,
    notificationSettings,
    notificationTimeZone,
    notificationMeta: {
      liveChannelsTracked,
      liveChannelsUp,
      liveChannelsDown,
      dailyMonitorReportLastSentDate: String(
        notificationState?.telegram?.dailyReports?.monitor?.lastSentDate || ''
      ).trim(),
      autoDeleteThreshold: {
        triggerUsedGb: Number(autoDeletePolicy?.triggerUsedGb || 0) || 0,
        limitUsedGb: Number(autoDeletePolicy?.limitUsedGb || 0) || 0,
      },
    },
    telegram,
    env: envStatus(),
  };
}

export async function GET(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const payload = await buildResponsePayload();
  return NextResponse.json(payload, { status: 200 });
}

export async function PUT(req) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    const wrapped =
      hasOwn(body, 'settings') ||
      hasOwn(body, 'notificationSettings') ||
      hasOwn(body, 'telegram') ||
      hasOwn(body, 'telegramSecrets');

    const settingsPatch = hasOwn(body, 'settings') ? body.settings : wrapped ? null : body;
    if (settingsPatch && typeof settingsPatch === 'object') {
      await updatePublicSettings(settingsPatch);
    }

    if (hasOwn(body, 'notificationSettings') && body?.notificationSettings && typeof body.notificationSettings === 'object') {
      await updateNotificationSettings(body.notificationSettings);
    }

    const telegramPatch =
      hasOwn(body, 'telegramSecrets') && body?.telegramSecrets && typeof body.telegramSecrets === 'object'
        ? body.telegramSecrets
        : hasOwn(body, 'telegram') && body?.telegram && typeof body.telegram === 'object'
          ? body.telegram
          : null;

    if (telegramPatch) {
      const keys = secretKeys();
      if (hasOwn(telegramPatch, 'botToken') || hasOwn(telegramPatch, 'telegramBotToken')) {
        await setSecret(keys.telegramBotToken, telegramPatch.botToken ?? telegramPatch.telegramBotToken ?? '');
      }
      if (hasOwn(telegramPatch, 'chatId') || hasOwn(telegramPatch, 'telegramChatId')) {
        await setSecret(keys.telegramChatId, telegramPatch.chatId ?? telegramPatch.telegramChatId ?? '');
      }
    }

    const payload = await buildResponsePayload();
    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Failed to update settings.' }, { status: 400 });
  }
}
