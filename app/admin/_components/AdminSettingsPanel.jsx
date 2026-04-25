'use client';

import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';

import {
  defaultTelegramMessageTemplates,
  normalizeTelegramMessageTemplates,
  renderTelegramTemplatePreview,
  TELEGRAM_MESSAGE_STAMP_EXAMPLES,
  TELEGRAM_MESSAGE_STAMP_GROUPS,
  TELEGRAM_MESSAGE_TEMPLATE_FIELDS,
} from '../../../lib/telegramMessageTemplates';

const TABS = [
  { key: 'branding', label: 'Branding' },
  { key: 'player', label: 'Player' },
  { key: 'login', label: 'Login' },
  { key: 'servers', label: 'Xuione' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'messages', label: 'Messages' },
];

const TEST_MESSAGES = {
  general: 'Telegram test notification sent.',
  live_channels: 'Live TV Channels Up/down test notification sent.',
  user_reports: 'User Reports test notification sent.',
  nas_trigger: 'NAS Size Report test notification sent.',
  vod_trigger: '/home/xui/content/vod Size Report test notification sent.',
  daily_monitor_report: 'Daily monitor report test notification sent.',
};

function normalizeServers(text) {
  const lines = String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((u) => (u.endsWith('/') ? u : `${u}/`));
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-lg px-4 py-2 text-sm font-medium transition ' +
        (active
          ? 'bg-[var(--admin-surface-solid)] text-[var(--admin-text)] shadow-sm'
          : 'text-[var(--admin-muted)] hover:bg-black/5 hover:text-[var(--admin-text)] data-[theme=dark]:hover:bg-white/5')
      }
    >
      {children}
    </button>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-[var(--admin-muted)]">{description}</p> : null}
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--admin-muted)]">{label}</label>
      {children}
      {help ? <div className="mt-2 text-xs text-[var(--admin-muted)]">{help}</div> : null}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', min, max, step }) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
      placeholder={placeholder}
    />
  );
}

function TextAreaInput({ value, onChange, placeholder, rows = 6, noWrap = false }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      wrap={noWrap ? 'off' : undefined}
      className={
        'w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30 ' +
        (noWrap ? 'resize-y overflow-x-auto whitespace-pre font-mono text-xs leading-5' : '')
      }
      placeholder={placeholder}
      spellCheck={false}
    />
  );
}

function TemplatePreview({ value }) {
  const preview = renderTelegramTemplatePreview(value);
  if (!preview) return null;

  return (
    <div className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <div className="text-xs font-semibold text-[var(--admin-text)]">Telegram preview</div>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm leading-5 text-[var(--admin-text)]">{preview}</pre>
    </div>
  );
}

function TestActionButton({ visible, busy, disabled, onClick, children }) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-xs font-medium hover:bg-black/10 disabled:opacity-60"
    >
      {busy ? 'Sending…' : children}
    </button>
  );
}

function MessageStampsModal({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95]">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close message stamps" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(1040px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--admin-border)] p-5">
          <div>
            <div className="text-lg font-semibold text-[var(--admin-text)]">Message Stamps</div>
            <div className="mt-1 text-sm text-[var(--admin-muted)]">
              Use these stamps inside the Telegram message templates. Blank sections automatically collapse after rendering.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm hover:bg-black/10"
          >
            Close
          </button>
        </div>

        <div className="max-h-[76vh] overflow-auto p-5">
          <div className="grid gap-4 xl:grid-cols-2">
            {TELEGRAM_MESSAGE_STAMP_GROUPS.map((group) => (
              <div key={group.title} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="text-sm font-semibold text-[var(--admin-text)]">{group.title}</div>
                <div className="mt-3 space-y-3">
                  {group.items.map((item) => (
                    <div key={item.stamp} className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
                      <div className="font-mono text-xs text-[var(--admin-text)]">{item.stamp}</div>
                      <div className="mt-1 text-xs text-[var(--admin-muted)]">{item.description}</div>
                      <div className="mt-2 text-xs text-[var(--admin-text)]">
                        Example:
                        <span className="mt-1 block font-mono whitespace-pre-wrap">{item.example}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {TELEGRAM_MESSAGE_STAMP_EXAMPLES.map((example) => (
              <div key={example.title} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
                <div className="text-sm font-semibold text-[var(--admin-text)]">{example.title}</div>
                <pre className="mt-3 overflow-auto rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-xs text-[var(--admin-text)] whitespace-pre-wrap">
                  {example.text}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange, actions = null }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--admin-text)]">{label}</div>
        {description ? <div className="mt-1 text-xs text-[var(--admin-muted)]">{description}</div> : null}
        {actions ? <div className="mt-3">{actions}</div> : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          'inline-flex items-center gap-3 rounded-full border px-2 py-1 text-sm transition ' +
          (checked
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 data-[theme=dark]:text-emerald-200'
            : 'border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text)]')
        }
      >
        <span
          className={
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' +
            (checked ? 'bg-emerald-500/70' : 'bg-slate-400/60')
          }
        >
          <span
            className={
              'h-5 w-5 rounded-full bg-white shadow transition-transform ' +
              (checked ? 'translate-x-5' : 'translate-x-0.5')
            }
          />
        </span>
        <span className="min-w-[72px] text-left font-medium">{checked ? 'Enabled' : 'Disabled'}</span>
      </button>
    </div>
  );
}

export default function AdminSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingTelegramTarget, setTestingTelegramTarget] = useState('');
  const [activeTab, setActiveTab] = useState('branding');
  const [showMessageStamps, setShowMessageStamps] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [testErr, setTestErr] = useState('');
  const [testOkMsg, setTestOkMsg] = useState('');
  const [showTestActions, setShowTestActions] = useState(false);

  const [brandName, setBrandName] = useState('');
  const [brandColor, setBrandColor] = useState('#FA5252');
  const [logoUrl, setLogoUrl] = useState('');
  const [defaultMovieClick, setDefaultMovieClick] = useState('play');
  const [bgDesktop, setBgDesktop] = useState('');
  const [bgMobile, setBgMobile] = useState('');
  const [helpUrl, setHelpUrl] = useState('');
  const [helpText, setHelpText] = useState('');
  const [serversText, setServersText] = useState('');

  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [notifyLiveChannels, setNotifyLiveChannels] = useState(false);
  const [liveChannelAlertDelayMinutes, setLiveChannelAlertDelayMinutes] = useState('15');
  const [liveChannelDownReminderHours, setLiveChannelDownReminderHours] = useState('12');
  const [notifyUserReports, setNotifyUserReports] = useState(false);
  const [reportNasSize, setReportNasSize] = useState(false);
  const [reportVodSize, setReportVodSize] = useState(false);
  const [dailyReportTime, setDailyReportTime] = useState('07:00');
  const [messageTemplates, setMessageTemplates] = useState(defaultTelegramMessageTemplates());
  const [notificationTimeZone, setNotificationTimeZone] = useState('Asia/Manila');
  const [notificationMeta, setNotificationMeta] = useState({
    liveChannelsTracked: 0,
    liveChannelsUp: 0,
    liveChannelsDown: 0,
    dailyMonitorReportLastSentDate: '',
    autoDeleteThreshold: {
      triggerUsedGb: 0,
      limitUsedGb: 0,
    },
  });
  const [telegramMeta, setTelegramMeta] = useState({
    hasBotToken: false,
    hasChatId: false,
    configured: false,
  });

  const load = async () => {
    setLoading(true);
    setErr('');
    setOkMsg('');
    setTestErr('');
    setTestOkMsg('');

    try {
      const response = await fetch('/api/admin/settings', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to load settings.');

      const settings = json.settings || {};
      const notificationSettings = json.notificationSettings || {};
      const telegram = json.telegram || {};

      setBrandName(settings?.brand?.name || '3J TV');
      setBrandColor(settings?.brand?.color || '#FA5252');
      setLogoUrl(settings?.brand?.logoUrl || '/brand/logo.svg');
      setDefaultMovieClick(String(settings?.ui?.defaultMovieCardClickAction || 'play'));
      setBgDesktop(settings?.login?.backgroundDesktopUrl || '/auth/login-bg.jpg');
      setBgMobile(settings?.login?.backgroundMobileUrl || '/auth/login-bg-mobile.jpg');
      setHelpUrl(settings?.login?.helpLinkUrl || 'https://www.facebook.com/threejfiberwifi');
      setHelpText(settings?.login?.helpLinkText || 'FB Page');
      setServersText((settings?.xuione?.servers || []).join('\n'));

      setTelegramBotToken(telegram?.botToken || '');
      setTelegramChatId(telegram?.chatId || '');
      setNotifyLiveChannels(notificationSettings?.telegram?.liveChannelsEnabled === true);
      setLiveChannelAlertDelayMinutes(String(notificationSettings?.telegram?.liveChannelAlertDelayMinutes ?? 15));
      setLiveChannelDownReminderHours(String(notificationSettings?.telegram?.liveChannelDownReminderHours ?? 12));
      setNotifyUserReports(notificationSettings?.telegram?.userReportsEnabled === true);
      setReportNasSize(notificationSettings?.telegram?.nasSizeReportEnabled === true);
      setReportVodSize(notificationSettings?.telegram?.vodSizeReportEnabled === true);
      setDailyReportTime(String(notificationSettings?.telegram?.dailyReportTime || '07:00').trim() || '07:00');
      setMessageTemplates(normalizeTelegramMessageTemplates(notificationSettings?.telegram?.messageTemplates));
      setNotificationTimeZone(String(json?.notificationTimeZone || 'Asia/Manila').trim() || 'Asia/Manila');
      setNotificationMeta({
        liveChannelsTracked: Number(json?.notificationMeta?.liveChannelsTracked || 0) || 0,
        liveChannelsUp: Number(json?.notificationMeta?.liveChannelsUp || 0) || 0,
        liveChannelsDown: Number(json?.notificationMeta?.liveChannelsDown || 0) || 0,
        dailyMonitorReportLastSentDate: String(json?.notificationMeta?.dailyMonitorReportLastSentDate || '').trim(),
        autoDeleteThreshold: {
          triggerUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.triggerUsedGb || 0) || 0,
          limitUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.limitUsedGb || 0) || 0,
        },
      });
      setTelegramMeta({
        hasBotToken: telegram?.hasBotToken === true,
        hasChatId: telegram?.hasChatId === true,
        configured: telegram?.configured === true,
      });
    } catch (error) {
      setErr(error?.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const payload = useMemo(
    () => ({
      settings: {
        brand: {
          name: brandName,
          color: brandColor,
          logoUrl,
        },
        ui: {
          defaultMovieCardClickAction: defaultMovieClick === 'preview' ? 'preview' : 'play',
        },
        login: {
          backgroundDesktopUrl: bgDesktop,
          backgroundMobileUrl: bgMobile,
          helpLinkUrl: helpUrl,
          helpLinkText: helpText,
        },
        xuione: {
          servers: normalizeServers(serversText),
        },
      },
      notificationSettings: {
        telegram: {
          liveChannelsEnabled: notifyLiveChannels,
          liveChannelAlertDelayMinutes: liveChannelAlertDelayMinutes,
          liveChannelDownReminderHours: liveChannelDownReminderHours,
          userReportsEnabled: notifyUserReports,
          nasSizeReportEnabled: reportNasSize,
          vodSizeReportEnabled: reportVodSize,
          dailyReportTime: dailyReportTime || '07:00',
          messageTemplates,
        },
      },
      telegram: {
        botToken: telegramBotToken,
        chatId: telegramChatId,
      },
    }),
    [
      bgDesktop,
      bgMobile,
      brandColor,
      brandName,
      dailyReportTime,
      defaultMovieClick,
      helpText,
      helpUrl,
      liveChannelAlertDelayMinutes,
      liveChannelDownReminderHours,
      logoUrl,
      messageTemplates,
      notifyLiveChannels,
      notifyUserReports,
      reportNasSize,
      reportVodSize,
      serversText,
      telegramBotToken,
      telegramChatId,
    ]
  );

  const save = async () => {
    setSaving(true);
    setErr('');
    setOkMsg('');

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to save settings.');

      setOkMsg('Saved settings.');
      setServersText((json?.settings?.xuione?.servers || []).join('\n'));
      setLiveChannelAlertDelayMinutes(String(json?.notificationSettings?.telegram?.liveChannelAlertDelayMinutes ?? 15));
      setLiveChannelDownReminderHours(String(json?.notificationSettings?.telegram?.liveChannelDownReminderHours ?? 12));
      setDailyReportTime(String(json?.notificationSettings?.telegram?.dailyReportTime || '07:00').trim() || '07:00');
      setMessageTemplates(normalizeTelegramMessageTemplates(json?.notificationSettings?.telegram?.messageTemplates));
      setNotificationTimeZone(String(json?.notificationTimeZone || notificationTimeZone).trim() || notificationTimeZone);
      setNotificationMeta({
        liveChannelsTracked: Number(json?.notificationMeta?.liveChannelsTracked || 0) || 0,
        liveChannelsUp: Number(json?.notificationMeta?.liveChannelsUp || 0) || 0,
        liveChannelsDown: Number(json?.notificationMeta?.liveChannelsDown || 0) || 0,
        dailyMonitorReportLastSentDate: String(json?.notificationMeta?.dailyMonitorReportLastSentDate || '').trim(),
        autoDeleteThreshold: {
          triggerUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.triggerUsedGb || 0) || 0,
          limitUsedGb: Number(json?.notificationMeta?.autoDeleteThreshold?.limitUsedGb || 0) || 0,
        },
      });
      setTelegramMeta({
        hasBotToken: json?.telegram?.hasBotToken === true,
        hasChatId: json?.telegram?.hasChatId === true,
        configured: json?.telegram?.configured === true,
      });
    } catch (error) {
      setErr(error?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const setShowTestNotifications = (nextValue) => {
    setShowTestActions(nextValue);
    if (!nextValue) {
      setTestingTelegramTarget('');
      setTestErr('');
      setTestOkMsg('');
    }
  };

  const runTelegramTest = async (scenario = 'general') => {
    setTestingTelegramTarget(scenario);
    setTestErr('');
    setTestOkMsg('');

    try {
      const response = await fetch('/api/admin/settings/telegram/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          telegram: payload.telegram,
          notificationSettings: payload.notificationSettings,
          scenario,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Failed to send Telegram test notification.');
      setTestOkMsg(TEST_MESSAGES[scenario] || TEST_MESSAGES.general);
    } catch (error) {
      setTestErr(error?.message || 'Failed to send Telegram test notification.');
    } finally {
      setTestingTelegramTarget('');
    }
  };

  const testTelegram = async () => runTelegramTest('general');
  const updateMessageTemplate = (key, value) => {
    setMessageTemplates((current) => ({
      ...current,
      [key]: value,
    }));
  };

  if (loading) return <div className="text-sm text-[var(--admin-muted)]">Loading…</div>;

  const notificationsEnabled = notifyLiveChannels || notifyUserReports || reportNasSize || reportVodSize;
  const testingTelegram = Boolean(testingTelegramTarget);
  const liveDelayMinutes = Math.max(0, Number(liveChannelAlertDelayMinutes || 0) || 0);
  const liveReminderHours = Math.max(0, Number(liveChannelDownReminderHours || 0) || 0);
  const autoDeleteTriggerNote =
    notificationMeta.autoDeleteThreshold.triggerUsedGb > 0 && notificationMeta.autoDeleteThreshold.limitUsedGb > 0
      ? `Immediate alert also sends when AutoDelete reaches Trigger ${notificationMeta.autoDeleteThreshold.triggerUsedGb.toFixed(1)} GB / Limit ${notificationMeta.autoDeleteThreshold.limitUsedGb.toFixed(1)} GB.`
      : 'Immediate alert also sends when the configured AutoDelete trigger state is reached.';

  let content = null;
  if (activeTab === 'branding') {
    content = (
      <Section
        title="Branding"
        description="Manage the public brand identity used across the header, logo assets, and colors."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name">
            <TextInput value={brandName} onChange={setBrandName} placeholder="3J TV" />
          </Field>
          <Field label="Brand color">
            <TextInput value={brandColor} onChange={setBrandColor} placeholder="#FA5252" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Logo URL" help="Use `/brand/logo.svg` or a hosted image URL.">
              <TextInput value={logoUrl} onChange={setLogoUrl} placeholder="/brand/logo.svg" />
            </Field>
          </div>
        </div>
      </Section>
    );
  } else if (activeTab === 'player') {
    content = (
      <Section
        title="Player"
        description="Control how movie cards behave when a user taps them in the catalog."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Default movie card click behavior"
            help="Users can still override this in their Profile preferences."
          >
            <select
              value={defaultMovieClick}
              onChange={(event) => setDefaultMovieClick(event.target.value)}
              className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            >
              <option value="play">Play immediately</option>
              <option value="preview">Open trailer preview</option>
            </select>
          </Field>
        </div>
      </Section>
    );
  } else if (activeTab === 'login') {
    content = (
      <Section
        title="Login"
        description="Configure login-screen backgrounds and the support/help link shown to users."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Login background (desktop)">
            <TextInput value={bgDesktop} onChange={setBgDesktop} placeholder="/auth/login-bg.jpg" />
          </Field>
          <Field label="Login background (mobile)">
            <TextInput value={bgMobile} onChange={setBgMobile} placeholder="/auth/login-bg-mobile.jpg" />
          </Field>
          <Field label="Help link URL">
            <TextInput value={helpUrl} onChange={setHelpUrl} placeholder="https://…" />
          </Field>
          <Field label="Help link text">
            <TextInput value={helpText} onChange={setHelpText} placeholder="FB Page" />
          </Field>
        </div>
      </Section>
    );
  } else if (activeTab === 'servers') {
    content = (
      <Section
        title="Xuione Servers"
        description="This server list is used by auth and playback APIs when env vars do not override it."
      >
        <Field label="Xuione servers (one per line)" help="Env vars `XUIONE_URLS` or `XUI_SERVERS` still take priority when set.">
          <textarea
            value={serversText}
            onChange={(event) => setServersText(event.target.value)}
            rows={7}
            className="w-full rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-solid)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[--brand]/30"
            placeholder="https://tv1.example.com/\nhttps://tv2.example.com/"
          />
        </Field>
      </Section>
    );
  } else if (activeTab === 'messages') {
    content = (
      <Section
        title="Telegram Messages"
        description="Edit the Telegram message templates for each monitor area. Use Message Stamps to insert live values like time, counts, channel details, and storage sections."
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div>
            <div className="text-sm font-semibold text-[var(--admin-text)]">Template Editor</div>
            <div className="mt-1 text-xs text-[var(--admin-muted)]">
              The editor does not wrap long stamp lines, so inline `*-part` stamps stay on the same editable sentence. Use the preview under each editor to see the Telegram-rendered message.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowMessageStamps(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm hover:bg-black/10"
          >
            <Info size={16} />
            Message Stamps
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {TELEGRAM_MESSAGE_TEMPLATE_FIELDS.map((field) => (
            <div key={field.key} className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
              <Field
                label={field.label}
                help={`${field.description} Leave the textarea blank if you want Save to restore the default template.`}
              >
                <TextAreaInput
                  value={messageTemplates[field.key] || ''}
                  onChange={(value) => updateMessageTemplate(field.key, value)}
                  rows={field.rows}
                  noWrap
                />
                <TemplatePreview value={messageTemplates[field.key] || ''} />
              </Field>
            </div>
          ))}
        </div>
      </Section>
    );
  } else {
    content = (
      <Section
        title="Notifications"
        description="Configure Telegram delivery, immediate monitor alerts, and the daily 7:00 AM Manila report. Use the Messages tab to customize the Telegram body format."
      >
        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Telegram Delivery</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            Telegram is {telegramMeta.configured ? 'configured' : 'not configured'}.
            {telegramMeta.hasBotToken || telegramMeta.hasChatId
              ? ` Bot token: ${telegramMeta.hasBotToken ? 'saved' : 'missing'} • Chat ID: ${telegramMeta.hasChatId ? 'saved' : 'missing'}.`
              : ' Save a bot token and chat ID to start sending alerts.'}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
            <div className="grid gap-4">
              <Field label="Telegram bot token">
                <TextInput value={telegramBotToken} onChange={setTelegramBotToken} type="password" placeholder="123456789:AA..." />
              </Field>
              <Field label="Telegram chat ID">
                <TextInput value={telegramChatId} onChange={setTelegramChatId} placeholder="e.g. 123456789 or -100..." />
              </Field>
            </div>

            <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
              <div className="text-sm font-medium text-[var(--admin-text)]">Test Telegram</div>
              <div className="mt-1 text-xs text-[var(--admin-muted)]">
                Turn on test notifications to reveal realistic test sends for each monitor area and the daily report.
              </div>
              <div className="mt-4">
                <ToggleRow
                  label="Test notifications"
                  description="Show realistic test buttons for general Telegram delivery, each monitor area, and the daily monitor report."
                  checked={showTestActions}
                  onChange={setShowTestNotifications}
                />
              </div>
              <div className="mt-4">
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'general'}
                  disabled={testingTelegram}
                  onClick={testTelegram}
                >
                  Send Test Notification
                </TestActionButton>
              </div>
              {testErr ? (
                <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{testErr}</div>
              ) : null}
              {testOkMsg ? (
                <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{testOkMsg}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          <div className="text-sm font-semibold text-[var(--admin-text)]">Monitor Areas</div>
          <div className="mt-1 text-xs text-[var(--admin-muted)]">
            These switches control immediate alerts. The daily report always includes all monitor areas at the scheduled Manila time, even when an immediate switch is off.
          </div>

          <div className="mt-4 space-y-3">
            <ToggleRow
              label="Live TV Channels Up/down"
              description={
                notificationMeta.liveChannelsTracked > 0
                  ? `Currently tracking ${notificationMeta.liveChannelsTracked} live channels from XUI (${notificationMeta.liveChannelsUp} up, ${notificationMeta.liveChannelsDown} down). Immediate alerts wait ${liveDelayMinutes} minute(s) before sending, include friendly UP/DOWN status, and send down reminders every ${liveReminderHours} hour(s)${liveReminderHours === 0 ? ' (disabled)' : ''}.`
                  : `Sends an alert when a live channel changes between up and down states after ${liveDelayMinutes} minute(s) of stability. Down reminders repeat every ${liveReminderHours} hour(s)${liveReminderHours === 0 ? ' (disabled)' : ''}.`
              }
              checked={notifyLiveChannels}
              onChange={setNotifyLiveChannels}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'live_channels'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('live_channels')}
                >
                  Test Live TV Alert
                </TestActionButton>
              }
            />
            <ToggleRow
              label="User Reports"
              description="Sends an alert when a viewer submits a new report from the player."
              checked={notifyUserReports}
              onChange={setNotifyUserReports}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'user_reports'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('user_reports')}
                >
                  Test User Report Alert
                </TestActionButton>
              }
            />
            <ToggleRow
              label="NAS Size Report"
              description={
                reportNasSize
                  ? `Includes current NAS usage in the daily Telegram report. ${autoDeleteTriggerNote}`
                  : 'Includes current NAS usage in the daily Telegram report.'
              }
              checked={reportNasSize}
              onChange={setReportNasSize}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'nas_trigger'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('nas_trigger')}
                >
                  Test NAS Alert
                </TestActionButton>
              }
            />
            <ToggleRow
              label="/home/xui/content/vod Size Report"
              description={
                reportVodSize
                  ? `Includes the XUI VOD volume usage in the daily Telegram report. ${autoDeleteTriggerNote}`
                  : 'Includes the XUI VOD volume usage in the daily Telegram report.'
              }
              checked={reportVodSize}
              onChange={setReportVodSize}
              actions={
                <TestActionButton
                  visible={showTestActions}
                  busy={testingTelegramTarget === 'vod_trigger'}
                  disabled={testingTelegram}
                  onClick={() => runTelegramTest('vod_trigger')}
                >
                  Test VOD Alert
                </TestActionButton>
              }
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,320px)_minmax(0,1fr)]">
          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <Field
              label="Live alert delay (minutes)"
              help="How long a channel must stay up or down before Telegram sends the Live TV status alert. Use 0 for immediate delivery."
            >
              <TextInput
                value={liveChannelAlertDelayMinutes}
                onChange={setLiveChannelAlertDelayMinutes}
                type="number"
                min={0}
                max={1440}
                step={1}
              />
            </Field>
            <Field
              label="Live down reminder (hours)"
              help="While a stream stays down, Telegram repeats the reminder at this interval. Use 0 to disable down reminders."
            >
              <TextInput
                value={liveChannelDownReminderHours}
                onChange={setLiveChannelDownReminderHours}
                type="number"
                min={0}
                max={720}
                step={1}
              />
            </Field>
          </div>

          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <Field
              label="Daily report time"
              help={`Runs once per day after this time using timezone ${notificationTimeZone} (GMT+8 Manila). This daily report always includes Live TV, User Reports, NAS usage, and VOD usage regardless of the immediate-alert switches.`}
            >
              <TextInput value={dailyReportTime} onChange={setDailyReportTime} type="time" />
            </Field>
            <div className="mt-4">
              <TestActionButton
                visible={showTestActions}
                busy={testingTelegramTarget === 'daily_monitor_report'}
                disabled={testingTelegram}
                onClick={() => runTelegramTest('daily_monitor_report')}
              >
                Test Daily Report
              </TestActionButton>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
            <div className="text-sm font-medium text-[var(--admin-text)]">Schedule Status</div>
            <div className="mt-2 text-sm text-[var(--admin-text)]">
              {notificationsEnabled
                ? 'Immediate Telegram alerts are enabled for at least one monitor area.'
                : 'Immediate Telegram alerts are disabled, but the daily Manila report still includes all monitor areas.'}
            </div>
            <div className="mt-2 text-xs text-[var(--admin-muted)]">
              {notificationMeta.dailyMonitorReportLastSentDate
                ? `Last daily monitor report sent on ${notificationMeta.dailyMonitorReportLastSentDate}.`
                : 'No daily monitor report has been sent yet.'}
            </div>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Public brand settings, player defaults, Xuione server fallbacks, Telegram notifications, and Telegram message templates.
        </p>

        <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-1">
          <div className="flex min-w-max gap-1">
            {TABS.map((tab) => (
              <TabButton key={tab.key} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
                {tab.label}
              </TabButton>
            ))}
          </div>
        </div>
      </div>

      {content}

      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        {err ? <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{err}</div> : null}
        {okMsg ? <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{okMsg}</div> : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={load}
            className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10 disabled:opacity-60"
          >
            Reload
          </button>
        </div>
      </div>

      {activeTab !== 'notifications' && activeTab !== 'messages' ? (
        <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-lg font-semibold">Secrets</h2>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Manage TMDb, OpenSubtitles, XUI Admin, and other secret values in the Admin Secrets page.
          </p>

          <a
            href="/admin/secrets"
            className="mt-4 inline-flex rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-2 text-sm hover:bg-black/10"
          >
            Open Secrets
          </a>
        </div>
      ) : null}

      <MessageStampsModal open={showMessageStamps} onClose={() => setShowMessageStamps(false)} />
    </div>
  );
}
