import 'server-only';

import crypto from 'node:crypto';

import { getAdminDb, saveAdminDb } from './adminDb';
import { decryptString, encryptString, isEncryptedPayload } from './vault';

const A2P_AUTH_METHODS = new Set(['API_KEY_HEADERS', 'BASIC_AUTH', 'BODY_CREDENTIALS']);
const DEFAULT_SOURCE_ADDRESSES = ['3JXENTRONET', '3J BILL', '3J ALERT', '3J PROMO', '3J FibrWIFI'];

const DEFAULT_SETTINGS = {
  enabled: false,
  provider: 'SMART_MESSAGING_SUITE',
  baseUrl: 'https://enterprise.messagingsuite.smart.com.ph',
  sendPath: '/cgphttp/servlet/sendmsg',
  queryPath: '/cgphttp/servlet/querymsg',
  cancelPath: '/cgphttp/servlet/cancelmsg',
  startBatchPath: '/cgphttp/servlet/startbatch',
  sendBatchPath: '/cgphttp/servlet/sendbatch',
  creditsPath: '/cgpapi/service1/credits',
  authMethod: 'API_KEY_HEADERS',
  apiId: '',
  username: '',
  defaultSource: '',
  sourceAddresses: DEFAULT_SOURCE_ADDRESSES,
  registeredDelivery: true,
  monthlyCreditLimit: null,
  monthlyResetDay: 1,
  notes: '',
  lastCreditCheckAt: null,
  lastCreditCheckStatus: '',
  lastCreditAvailable: null,
  lastCreditResponse: '',
  lastCreditError: '',
  lastTestSendAt: null,
  lastTestSendStatus: '',
  lastTestSendDestination: '',
  lastTestSendMessageId: '',
  lastTestSendResponse: '',
  lastTestSendError: '',
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value, maxLength = 500) {
  return String(value ?? '')
    .replace(/\0/g, '')
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizePath(value, fallback) {
  let path = normalizeText(value || fallback, 200);
  if (!path) path = fallback;
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeBaseUrl(value) {
  const url = normalizeText(value || DEFAULT_SETTINGS.baseUrl, 300).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('A2P base URL must be a valid http or https URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) {
    throw new Error('A2P base URL must be a valid http or https URL.');
  }
  return url;
}

function normalizeSourceAddresses(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const source = normalizeText(item, 80);
    if (!source || seen.has(source)) continue;
    seen.add(source);
    out.push(source);
  }
  return out.slice(0, 50);
}

function normalizeAuthMethod(value) {
  const method = normalizeText(value || DEFAULT_SETTINGS.authMethod, 40).toUpperCase();
  if (!A2P_AUTH_METHODS.has(method)) throw new Error('Unsupported A2P authentication method.');
  return method;
}

function maskSecret(value) {
  const text = normalizeText(value, 500);
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 2)}…`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function maskDestination(destination) {
  const digits = normalizeText(destination, 32).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 6) return '***';
  return `${digits.slice(0, 4)}…${digits.slice(-3)}`;
}

function normalizeDestination(value) {
  let digits = normalizeText(value, 32).replace(/\D/g, '');
  if (digits.startsWith('09') && digits.length === 11) digits = `63${digits.slice(1)}`;
  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error('Destination must be an international-format mobile number, for example 639171234567.');
  }
  return digits;
}

function parseCreditAvailable(text) {
  const clean = normalizeText(text, 1000);
  const patterns = [
    /Available\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    /Credits?\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
    /Balance\s*[:=]?\s*([\d,]+(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (!match) continue;
    const value = match[1].replace(/,/g, '');
    return value.includes('.') ? Number.parseFloat(value) : Number.parseInt(value, 10);
  }
  if (/^[\d,]+(?:\.\d+)?$/.test(clean)) {
    const value = clean.replace(/,/g, '');
    return value.includes('.') ? Number.parseFloat(value) : Number.parseInt(value, 10);
  }
  return null;
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function readSecret(payload) {
  if (!payload) return '';
  return isEncryptedPayload(payload) ? decryptString(payload) : String(payload || '');
}

function normalizeStore(value = {}) {
  const store = {
    ...DEFAULT_SETTINGS,
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
  };
  store.enabled = store.enabled === true;
  store.provider = normalizeText(store.provider || DEFAULT_SETTINGS.provider, 80);
  store.baseUrl = normalizeBaseUrl(store.baseUrl || store.base_url || DEFAULT_SETTINGS.baseUrl);
  store.sendPath = normalizePath(store.sendPath || store.send_path, DEFAULT_SETTINGS.sendPath);
  store.queryPath = normalizePath(store.queryPath || store.query_path, DEFAULT_SETTINGS.queryPath);
  store.cancelPath = normalizePath(store.cancelPath || store.cancel_path, DEFAULT_SETTINGS.cancelPath);
  store.startBatchPath = normalizePath(store.startBatchPath || store.start_batch_path, DEFAULT_SETTINGS.startBatchPath);
  store.sendBatchPath = normalizePath(store.sendBatchPath || store.send_batch_path, DEFAULT_SETTINGS.sendBatchPath);
  store.creditsPath = normalizePath(store.creditsPath || store.credits_path, DEFAULT_SETTINGS.creditsPath);
  store.authMethod = normalizeAuthMethod(store.authMethod || store.auth_method);
  store.apiId = normalizeText(store.apiId || store.api_id, 200);
  store.username = normalizeText(store.username, 200);
  store.defaultSource = normalizeText(store.defaultSource || store.default_source, 80);
  store.sourceAddresses = normalizeSourceAddresses(store.sourceAddresses || store.source_addresses);
  if (!store.sourceAddresses.length) store.sourceAddresses = [...DEFAULT_SOURCE_ADDRESSES];
  store.registeredDelivery = store.registeredDelivery !== false && store.registered_delivery !== false;
  store.monthlyCreditLimit =
    store.monthlyCreditLimit === null || store.monthlyCreditLimit === undefined || store.monthlyCreditLimit === ''
      ? null
      : Math.max(0, Number.parseInt(store.monthlyCreditLimit, 10) || 0);
  store.monthlyResetDay = Math.min(31, Math.max(1, Number.parseInt(store.monthlyResetDay || store.monthly_reset_day || 1, 10) || 1));
  store.notes = normalizeText(store.notes, 1000);
  return store;
}

function publicSettings(store) {
  const apiKey = readSecret(store.apiKeyEnc || store.api_key_encrypted);
  const password = readSecret(store.passwordEnc || store.password_encrypted);
  return {
    enabled: store.enabled === true,
    provider: store.provider,
    baseUrl: store.baseUrl,
    sendPath: store.sendPath,
    queryPath: store.queryPath,
    cancelPath: store.cancelPath,
    startBatchPath: store.startBatchPath,
    sendBatchPath: store.sendBatchPath,
    creditsPath: store.creditsPath,
    authMethod: store.authMethod,
    apiId: store.apiId,
    apiKeyConfigured: Boolean(normalizeText(apiKey)),
    apiKeyHint: maskSecret(apiKey),
    username: store.username,
    passwordConfigured: Boolean(normalizeText(password)),
    passwordHint: maskSecret(password),
    defaultSource: store.defaultSource,
    sourceAddresses: store.sourceAddresses || [],
    registeredDelivery: store.registeredDelivery === true,
    monthlyCreditLimit: store.monthlyCreditLimit,
    monthlyResetDay: store.monthlyResetDay,
    notes: store.notes,
    lastCreditCheckAt: store.lastCreditCheckAt || null,
    lastCreditCheckStatus: store.lastCreditCheckStatus || '',
    lastCreditAvailable: store.lastCreditAvailable ?? null,
    lastCreditResponse: store.lastCreditResponse || '',
    lastCreditError: store.lastCreditError || '',
    lastTestSendAt: store.lastTestSendAt || null,
    lastTestSendStatus: store.lastTestSendStatus || '',
    lastTestSendDestination: store.lastTestSendDestination || '',
    lastTestSendMessageId: store.lastTestSendMessageId || '',
    lastTestSendResponse: store.lastTestSendResponse || '',
    lastTestSendError: store.lastTestSendError || '',
    capabilities: {
      sendSms: true,
      sendBatch: true,
      queryMessage: true,
      cancelMessage: true,
      deliveryReceipts: true,
      mobileOriginatedReplies: true,
      creditsQuery: true,
      maxDestinationsPerSendmsg: 300,
      documentedRequestRatePerCustomerIp: '100 requests/second',
    },
    creditsTracking: {
      smartPrepaidCreditsEndpoint: DEFAULT_SETTINGS.creditsPath,
      directBalanceCheckSupported: true,
      monthlyUsageRequiresLocalMessageLogs: true,
      portalReportsAvailable: true,
    },
  };
}

async function loadStoreWithDb() {
  const db = await getAdminDb();
  db.a2pMessaging = normalizeStore(db.a2pMessaging);
  db.a2pMessageLogs = Array.isArray(db.a2pMessageLogs) ? db.a2pMessageLogs : [];
  return { db, store: db.a2pMessaging };
}

function getAuthParts(store) {
  const headers = { 'User-Agent': '3JTV/1.0 a2p-messaging' };
  const extraParams = {};
  const apiKey = readSecret(store.apiKeyEnc || store.api_key_encrypted);
  const password = readSecret(store.passwordEnc || store.password_encrypted);
  if (store.authMethod === 'API_KEY_HEADERS') {
    if (!store.apiId || !apiKey) throw new Error('Save API ID and API key first.');
    headers['X-MEMS-API-ID'] = store.apiId;
    headers['X-MEMS-API-KEY'] = apiKey;
    return { headers, authHeader: '', extraParams };
  }
  if (!store.username || !password) throw new Error('Save username and password first.');
  if (store.authMethod === 'BASIC_AUTH') {
    return { headers, authHeader: `Basic ${Buffer.from(`${store.username}:${password}`).toString('base64')}`, extraParams };
  }
  extraParams.username = store.username;
  extraParams.password = password;
  return { headers, authHeader: '', extraParams };
}

async function recordMessageLog(entry) {
  const { db } = await loadStoreWithDb();
  const status = normalizeText(entry.status, 20).toUpperCase();
  const normalizedStatus = ['PENDING', 'SUCCESS', 'FAILED'].includes(status) ? status : 'FAILED';
  const messageText = normalizeText(entry.messageText, 1000);
  const item = {
    id: crypto.randomUUID(),
    provider: normalizeText(entry.provider || DEFAULT_SETTINGS.provider, 80),
    purpose: normalizeText(entry.purpose || 'GENERAL', 80).toUpperCase() || 'GENERAL',
    destination: normalizeText(entry.destination, 32),
    destinationMasked: entry.destinationMasked || maskDestination(entry.destination),
    source: normalizeText(entry.source, 80),
    messageText,
    messagePreview: messageText.slice(0, 160),
    status: normalizedStatus,
    smartStatus: normalizeText(entry.smartStatus, 80),
    httpStatus: Number.isFinite(Number(entry.httpStatus)) ? Number(entry.httpStatus) : null,
    messageId: normalizeText(entry.messageId, 120),
    responseSummary: normalizeText(entry.responseSummary, 1000),
    errorMessage: normalizeText(entry.errorMessage, 1000),
    requestContext: entry.requestContext && typeof entry.requestContext === 'object' ? entry.requestContext : {},
    createdByAdminId: normalizeText(entry.createdByAdminId, 120),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.a2pMessageLogs.unshift(item);
  db.a2pMessageLogs = db.a2pMessageLogs.slice(0, 2000);
  await saveAdminDb(db);
  return item;
}

export async function getA2pMessagingSettings() {
  const { store } = await loadStoreWithDb();
  return publicSettings(store);
}

export async function updateA2pMessagingSettings(input = {}) {
  const { db, store } = await loadStoreWithDb();
  const next = { ...store };

  for (const key of ['enabled', 'registeredDelivery']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) next[key] = Boolean(input[key]);
  }
  for (const key of ['provider', 'apiId', 'username', 'defaultSource', 'notes']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) next[key] = normalizeText(input[key], key === 'notes' ? 1000 : 200);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'baseUrl')) next.baseUrl = normalizeBaseUrl(input.baseUrl);
  for (const key of ['sendPath', 'queryPath', 'cancelPath', 'startBatchPath', 'sendBatchPath', 'creditsPath']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) next[key] = normalizePath(input[key], DEFAULT_SETTINGS[key]);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'authMethod')) next.authMethod = normalizeAuthMethod(input.authMethod);
  if (input.clearApiKey) delete next.apiKeyEnc;
  else if (Object.prototype.hasOwnProperty.call(input, 'apiKey') && normalizeText(input.apiKey, 500)) {
    next.apiKeyEnc = encryptString(normalizeText(input.apiKey, 500));
  }
  if (input.clearPassword) delete next.passwordEnc;
  else if (Object.prototype.hasOwnProperty.call(input, 'password') && normalizeText(input.password, 500)) {
    next.passwordEnc = encryptString(normalizeText(input.password, 500));
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sourceAddresses')) next.sourceAddresses = normalizeSourceAddresses(input.sourceAddresses);
  if (Object.prototype.hasOwnProperty.call(input, 'monthlyCreditLimit')) {
    next.monthlyCreditLimit =
      input.monthlyCreditLimit === null || input.monthlyCreditLimit === ''
        ? null
        : Math.max(0, Number.parseInt(input.monthlyCreditLimit, 10) || 0);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'monthlyResetDay')) {
    next.monthlyResetDay = Math.min(31, Math.max(1, Number.parseInt(input.monthlyResetDay, 10) || 1));
  }

  db.a2pMessaging = normalizeStore(next);
  await saveAdminDb(db);
  return publicSettings(db.a2pMessaging);
}

export async function checkA2pCredits() {
  const { db, store } = await loadStoreWithDb();
  const username = normalizeText(store.username, 200);
  const password = readSecret(store.passwordEnc || store.password_encrypted);
  if (!username || !password) {
    throw new Error('Smart credits check requires the HTTP API username and password.');
  }
  const checkedAt = nowIso();
  try {
    const response = await fetch(joinUrl(store.baseUrl, store.creditsPath), {
      method: 'GET',
      headers: {
        Accept: 'text/plain',
        'User-Agent': '3JTV/1.0 a2p-credits-check',
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const text = normalizeText(await response.text(), 1000);
    if (!response.ok) {
      throw new Error(`Smart credits check failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    const available = parseCreditAvailable(text);
    db.a2pMessaging = {
      ...store,
      lastCreditCheckAt: checkedAt,
      lastCreditCheckStatus: 'SUCCESS',
      lastCreditAvailable: available,
      lastCreditResponse: text.slice(0, 500),
      lastCreditError: available === null ? `Could not parse credits response: ${text.slice(0, 200)}` : '',
    };
    await saveAdminDb(db);
    return {
      ...publicSettings(db.a2pMessaging),
      creditCheck: {
        status: 'SUCCESS',
        available,
        responseSummary: text.slice(0, 300),
        checkedAt,
      },
    };
  } catch (error) {
    db.a2pMessaging = {
      ...store,
      lastCreditCheckAt: checkedAt,
      lastCreditCheckStatus: 'FAILED',
      lastCreditError: error?.message || 'Smart credits check failed.',
    };
    await saveAdminDb(db);
    throw error;
  }
}

export async function sendA2pSmsMessage({
  destination,
  messageText,
  source,
  purpose = 'GENERAL',
  requestContext = {},
  createdByAdminId = '',
  registeredDelivery,
} = {}) {
  const { store } = await loadStoreWithDb();
  const rawDestination = normalizeText(destination, 32);
  const rawMessage = normalizeText(messageText, 1000);
  let cleanSource = normalizeText(source ?? store.defaultSource, 80);
  try {
    if (!store.enabled) throw new Error('A2P Messaging is disabled in System Settings.');
    const cleanDestination = normalizeDestination(destination);
    const cleanMessage = normalizeText(messageText, 500);
    if (!cleanMessage) throw new Error('SMS message text is required.');
    if (cleanSource && !store.sourceAddresses.includes(cleanSource)) {
      throw new Error('Choose one of the registered Sender IDs provisioned for the Smart A2P account.');
    }

    const { headers, authHeader, extraParams } = getAuthParts(store);
    const body = new URLSearchParams({
      ...extraParams,
      destination: cleanDestination,
      text: cleanMessage,
      registered: (registeredDelivery ?? store.registeredDelivery) ? '1' : '0',
    });
    if (cleanSource) body.set('source', cleanSource);
    const response = await fetch(joinUrl(store.baseUrl, store.sendPath), {
      method: 'POST',
      headers: {
        ...headers,
        ...(authHeader ? { Authorization: authHeader } : {}),
        Accept: 'text/plain',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    const text = normalizeText(await response.text(), 1000);
    const messageId = text.match(/Message[- ]ID\s*:\s*([^\s]+)/i)?.[1] || '';
    if (!response.ok) {
      const error = `Smart SMS send failed: HTTP ${response.status} ${text.slice(0, 240)}`;
      await recordMessageLog({
        status: 'FAILED',
        destination: cleanDestination,
        source: cleanSource,
        messageText: cleanMessage,
        purpose,
        httpStatus: response.status,
        messageId,
        responseSummary: text.slice(0, 500),
        errorMessage: error,
        requestContext,
        createdByAdminId,
      });
      throw new Error(error);
    }
    const accepted = /^\s*0\s+\d{3}\s+OK/i.test(text);
    if (!accepted) {
      const error = `Smart SMS was not accepted: ${text.slice(0, 300)}`;
      await recordMessageLog({
        status: 'FAILED',
        destination: cleanDestination,
        source: cleanSource,
        messageText: cleanMessage,
        purpose,
        httpStatus: response.status,
        smartStatus: 'NOT_ACCEPTED',
        messageId,
        responseSummary: text.slice(0, 500),
        errorMessage: error,
        requestContext,
        createdByAdminId,
      });
      throw new Error(error);
    }
    await recordMessageLog({
      status: 'SUCCESS',
      destination: cleanDestination,
      source: cleanSource,
      messageText: cleanMessage,
      purpose,
      httpStatus: response.status,
      smartStatus: 'ACCEPTED',
      messageId,
      responseSummary: text.slice(0, 500),
      requestContext,
      createdByAdminId,
    });
    return {
      status: 'SUCCESS',
      destination: maskDestination(cleanDestination),
      messageId,
      responseSummary: text.slice(0, 300),
    };
  } catch (error) {
    const message = error?.message || 'Smart SMS send failed.';
    if (!message.startsWith('Smart SMS')) {
      await recordMessageLog({
        status: 'FAILED',
        destination: rawDestination,
        source: cleanSource,
        messageText: rawMessage,
        purpose,
        errorMessage: message,
        requestContext,
        createdByAdminId,
      });
    }
    throw error;
  }
}

export async function sendA2pTestSms(input = {}, admin = null) {
  const { store } = await loadStoreWithDb();
  const sentAt = nowIso();
  const destination = normalizeText(input.destination, 32);
  const source = normalizeText(input.source ?? store.defaultSource, 80);
  const messageText = normalizeText(input.messageText || input.message_text, 500);
  try {
    const result = await sendA2pSmsMessage({
      destination,
      messageText,
      source,
      purpose: 'TEST_SEND',
      requestContext: { origin: 'admin_settings_test_send' },
      createdByAdminId: admin?.id || admin?.username || '',
      registeredDelivery: input.registeredDelivery,
    });
    const latest = (await loadStoreWithDb()).db;
    latest.a2pMessaging = {
      ...normalizeStore(latest.a2pMessaging),
      lastTestSendAt: sentAt,
      lastTestSendStatus: 'SUCCESS',
      lastTestSendDestination: result.destination,
      lastTestSendMessageId: result.messageId || '',
      lastTestSendResponse: result.responseSummary || '',
      lastTestSendError: '',
    };
    await saveAdminDb(latest);
    return {
      ...publicSettings(latest.a2pMessaging),
      testSend: {
        status: 'SUCCESS',
        destination: result.destination,
        messageId: result.messageId || '',
        responseSummary: result.responseSummary || '',
        sentAt,
      },
    };
  } catch (error) {
    const latest = (await loadStoreWithDb()).db;
    latest.a2pMessaging = {
      ...normalizeStore(latest.a2pMessaging),
      lastTestSendAt: sentAt,
      lastTestSendStatus: 'FAILED',
      lastTestSendDestination: maskDestination(destination),
      lastTestSendMessageId: '',
      lastTestSendResponse: '',
      lastTestSendError: error?.message || 'Smart test SMS failed.',
    };
    await saveAdminDb(latest);
    throw error;
  }
}

export async function listA2pMessages({ status = 'ALL', purpose = 'ALL', search = '', page = 1, pageSize = 20 } = {}) {
  const { db } = await loadStoreWithDb();
  const selectedStatus = normalizeText(status, 20).toUpperCase();
  const selectedPurpose = normalizeText(purpose, 80).toUpperCase();
  const query = normalizeText(search, 120).toLowerCase();
  const logs = [...(db.a2pMessageLogs || [])];
  const filtered = logs.filter((item) => {
    if (selectedStatus && selectedStatus !== 'ALL' && item.status !== selectedStatus) return false;
    if (selectedPurpose && selectedPurpose !== 'ALL' && item.purpose !== selectedPurpose) return false;
    if (!query) return true;
    return [
      item.destination,
      item.destinationMasked,
      item.source,
      item.purpose,
      item.messageText,
      item.messageId,
      item.responseSummary,
      item.errorMessage,
    ]
      .some((value) => String(value || '').toLowerCase().includes(query));
  });
  const safePageSize = Math.min(100, Math.max(5, Number.parseInt(pageSize, 10) || 20));
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const offset = (safePage - 1) * safePageSize;
  const items = filtered.slice(offset, offset + safePageSize);
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const purposeCounts = new Map();
  for (const item of logs) {
    const key = item.purpose || 'GENERAL';
    purposeCounts.set(key, (purposeCounts.get(key) || 0) + 1);
  }
  return {
    items,
    total: filtered.length,
    page: safePage,
    pageSize: safePageSize,
    summary: {
      total: logs.length,
      success: logs.filter((item) => item.status === 'SUCCESS').length,
      failed: logs.filter((item) => item.status === 'FAILED').length,
      today: logs.filter((item) => String(item.createdAt || '').startsWith(todayPrefix)).length,
      thisMonth: logs.filter((item) => String(item.createdAt || '').startsWith(monthPrefix)).length,
      lastFailedAt: logs.find((item) => item.status === 'FAILED')?.createdAt || null,
      lastSentAt: logs[0]?.createdAt || null,
    },
    purposes: Array.from(purposeCounts.entries())
      .map(([purposeName, count]) => ({ purpose: purposeName, count }))
      .sort((a, b) => b.count - a.count || a.purpose.localeCompare(b.purpose))
      .slice(0, 50),
  };
}
