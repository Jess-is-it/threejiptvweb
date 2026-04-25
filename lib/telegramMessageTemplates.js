const MAX_TEMPLATE_LENGTH = 12000;

function normalizeStampToken(stamp = '') {
  return String(stamp || '')
    .trim()
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim()
    .toLowerCase();
}

export const TELEGRAM_MESSAGE_TEMPLATE_FIELDS = [
  {
    key: 'liveChange',
    label: 'Live TV status update',
    description: 'Used when one or more live channels go up or down after the configured alert delay.',
    rows: 10,
  },
  {
    key: 'liveItem',
    label: 'Live TV channel item',
    description: 'Used for each channel row inside Live TV change alerts and down reminders.',
    rows: 10,
  },
  {
    key: 'liveDownReminder',
    label: 'Live TV down reminder',
    description: 'Used when Telegram reminds that one or more live channels are still down.',
    rows: 8,
  },
  {
    key: 'userReport',
    label: 'User report',
    description: 'Used when a viewer submits a report from the player.',
    rows: 7,
  },
  {
    key: 'storageTrigger',
    label: 'AutoDelete trigger alert',
    description: 'Used when NAS and/or VOD usage reaches the AutoDelete trigger threshold.',
    rows: 12,
  },
  {
    key: 'dailyMonitorReport',
    label: 'Daily monitor report',
    description: 'Used for the scheduled daily Telegram report.',
    rows: 18,
  },
];

export const TELEGRAM_MESSAGE_STAMP_GROUPS = [
  {
    title: 'Common',
    items: [
      { stamp: '{{date}}', example: '2025-01-20', description: 'Current Manila date.' },
      { stamp: '{{time}}', example: '08:15 PM', description: 'Current Manila time in 12-hour format.' },
      { stamp: '{{datetime}}', example: '2025-01-20 08:15 PM', description: 'Current Manila date and time.' },
      { stamp: '{{timezone}}', example: 'Asia/Manila', description: 'Current notification timezone.' },
      { stamp: '{{daily-report-time}}', example: '07:00', description: 'Configured daily report time.' },
    ],
  },
  {
    title: 'Live TV Message',
    items: [
      { stamp: '{{checked-datetime}}', example: '2025-01-20 08:15 PM', description: 'When the live check ran.' },
      { stamp: '{{detected-down-count}}', example: '2', description: 'How many channels just went down.' },
      { stamp: '{{detected-up-count}}', example: '1', description: 'How many channels just came back up.' },
      { stamp: '{{current-up-count}}', example: '68', description: 'Current total live channels that are up.' },
      { stamp: '{{current-down-count}}', example: '4', description: 'Current total live channels that are down.' },
      { stamp: '{{tracked-count}}', example: '72', description: 'Current total live channels tracked.' },
      { stamp: '{{current-totals-line}}', example: 'Current totals: 68 up, 4 down, 72 tracked', description: 'Ready-to-use totals line.' },
      { stamp: '{{alert-delay-minutes}}', example: '15', description: 'Configured Live TV alert delay in minutes.' },
      { stamp: '{{alert-delay-text}}', example: '15 minute(s) stable before send', description: 'Friendly delay text. Shows `immediate` when delay is 0.' },
      { stamp: '{{alert-delay-line}}', example: 'Alert delay: 15 minute(s) stable before send', description: 'Ready-to-use Live TV delay line.' },
      { stamp: '{{down-heading}}', example: 'Down (2)', description: 'Heading for the down-channel list.' },
      { stamp: '{{up-heading}}', example: 'Up (1)', description: 'Heading for the up-channel list.' },
      {
        stamp: '{{down-items}}',
        example: ['• CNN HD', '  🔴 Down • Down for 22m • Server Main Server'].join('\n'),
        description: 'Rendered list of down-channel items using the Live TV channel item template.',
      },
      {
        stamp: '{{up-items}}',
        example: ['• A2Z', '  🟢 Up • Uptime 4h 20m • Server Main Server'].join('\n'),
        description: 'Rendered list of up-channel items using the Live TV channel item template.',
      },
      { stamp: '{{down-section}}', example: ['Down (2)', '• CNN HD', '  🔴 Down • Down for 22m • Server Main Server'].join('\n'), description: 'Ready-to-use down section with heading and items.' },
      { stamp: '{{up-section}}', example: ['Up (1)', '• A2Z', '  🟢 Up • Uptime 4h 20m • Server Main Server'].join('\n'), description: 'Ready-to-use up section with heading and items.' },
    ],
  },
  {
    title: 'Live TV Channel Item',
    items: [
      { stamp: '{{channel-name}}', example: 'A2Z', description: 'Channel display name.' },
      { stamp: '{{channel-status-icon}}', example: '🟢', description: 'Green for up, red for down.' },
      { stamp: '{{channel-status-text}}', example: 'Up', description: 'Friendly text for current status.' },
      { stamp: '{{channel-status}}', example: '🟢 Up', description: 'Status icon and text together.' },
      { stamp: '{{channel-status-duration}}', example: 'Uptime 4h 20m', description: 'Friendly duration text for uptime, downtime, or recovery.' },
      { stamp: '{{channel-status-duration-part}}', example: ' • Uptime 4h 20m', description: 'Same status duration with a leading separator for inline templates.' },
      { stamp: '{{channel-server}}', example: 'Main Server', description: 'XUI server name when available.' },
      { stamp: '{{channel-server-line}}', example: 'Server Main Server', description: 'Server text ready to print.' },
      { stamp: '{{channel-server-part}}', example: ' • Server Main Server', description: 'Server text with a leading separator for inline templates.' },
      { stamp: '{{channel-source}}', example: '10.100.100.89:1234', description: 'Source host when available.' },
      { stamp: '{{channel-source-line}}', example: 'Source 10.100.100.89:1234', description: 'Source text ready to print.' },
      { stamp: '{{channel-source-part}}', example: ' • Source 10.100.100.89:1234', description: 'Source text with a leading separator for inline templates.' },
      { stamp: '{{channel-resolution}}', example: '640x360', description: 'Current resolution when available.' },
      { stamp: '{{channel-resolution-line}}', example: '640x360', description: 'Resolution text ready to print.' },
      { stamp: '{{channel-resolution-part}}', example: ' • 640x360', description: 'Resolution text with a leading separator for inline templates.' },
      { stamp: '{{channel-video-codec}}', example: 'h264', description: 'Video codec when available.' },
      { stamp: '{{channel-video-profile}}', example: 'high', description: 'Video profile when available.' },
      { stamp: '{{channel-audio-codec}}', example: 'aac', description: 'Audio codec when available.' },
      { stamp: '{{channel-audio-channels}}', example: '2', description: 'Audio channel count when available.' },
      { stamp: '{{channel-fps}}', example: '30', description: 'Current FPS when available.' },
      { stamp: '{{channel-fps-line}}', example: '30 fps', description: 'FPS text ready to print.' },
      { stamp: '{{channel-fps-part}}', example: ' • 30 fps', description: 'FPS text with a leading separator for inline templates.' },
      { stamp: '{{channel-bitrate-kbps}}', example: '1389', description: 'Current bitrate in kbps when available.' },
      { stamp: '{{channel-bitrate-line}}', example: '1389 kbps', description: 'Bitrate text ready to print.' },
      { stamp: '{{channel-bitrate-part}}', example: ' • 1389 kbps', description: 'Bitrate text with a leading separator for inline templates.' },
      { stamp: '{{channel-codecs}}', example: 'h264/aac 2ch', description: 'Combined codec text.' },
      { stamp: '{{channel-codecs-line}}', example: 'h264/aac 2ch', description: 'Codec text ready to print.' },
      { stamp: '{{channel-codecs-part}}', example: ' • h264/aac 2ch', description: 'Codec text with a leading separator for inline templates.' },
      { stamp: '{{channel-transcode-speed}}', example: '1.3x', description: 'Transcode speed when available.' },
      { stamp: '{{channel-transcode-speed-line}}', example: 'speed 1.3x', description: 'Transcode speed text ready to print.' },
      { stamp: '{{channel-transcode-speed-part}}', example: ' • speed 1.3x', description: 'Transcode speed with a leading separator for inline templates.' },
      { stamp: '{{channel-drop-frames}}', example: '4', description: 'Dropped frame count when available.' },
      { stamp: '{{channel-drop-frames-line}}', example: 'drop 4', description: 'Dropped frame text ready to print.' },
      { stamp: '{{channel-drop-frames-part}}', example: ' • drop 4', description: 'Dropped frame text with a leading separator for inline templates.' },
      { stamp: '{{channel-dup-frames}}', example: '2', description: 'Duplicated frame count when available.' },
      { stamp: '{{channel-dup-frames-line}}', example: 'dup 2', description: 'Duplicated frame text ready to print.' },
      { stamp: '{{channel-dup-frames-part}}', example: ' • dup 2', description: 'Duplicated frame text with a leading separator for inline templates.' },
      { stamp: '{{channel-media-summary}}', example: '640x360 • h264/aac 2ch • 30 fps • 1389 kbps', description: 'Legacy combined media summary line.' },
      { stamp: '{{channel-transcode-summary}}', example: 'speed 1.3x • drop 4 • dup 2', description: 'Legacy combined transcode summary line.' },
      { stamp: '{{channel-details-line}}', example: '🟢 Up • Uptime 4h 20m • Server Main Server', description: 'Legacy combined status line.' },
      { stamp: '{{channel-meta-line}}', example: '640x360 • h264/aac 2ch • 30 fps • 1389 kbps • Source 10.100.100.89:1234', description: 'Legacy combined media/source line.' },
      { stamp: '{{down-sincedatetime}}', example: '2025-01-20 06:10 PM', description: 'When the channel first went down, if known.' },
      { stamp: '{{stream-starteddatetime}}', example: '2025-01-20 03:55 PM', description: 'When the stream started, if known.' },
    ],
  },
  {
    title: 'Live TV Reminder',
    items: [
      { stamp: '{{reminder-hours}}', example: '12', description: 'Configured reminder interval in hours.' },
      { stamp: '{{reminder-interval-text}}', example: 'every 12 hour(s)', description: 'Friendly reminder interval text. Shows `disabled` when reminders are off.' },
      { stamp: '{{reminder-interval-line}}', example: 'Reminder interval: every 12 hour(s)', description: 'Ready-to-use reminder interval line.' },
      { stamp: '{{reminder-heading}}', example: 'Still down (1)', description: 'Heading for the still-down list.' },
      {
        stamp: '{{reminder-items}}',
        example: ['• CNN HD', '  🔴 Down • Down for 12h 15m • Server Main Server'].join('\n'),
        description: 'Rendered list of reminder channel items using the Live TV channel item template.',
      },
      { stamp: '{{reminder-section}}', example: ['Still down (1)', '• CNN HD', '  🔴 Down • Down for 12h 15m • Server Main Server'].join('\n'), description: 'Ready-to-use reminder section with heading and items.' },
    ],
  },
  {
    title: 'User Reports',
    items: [
      { stamp: '{{report-user}}', example: 'sample-user', description: 'Reporting username.' },
      { stamp: '{{report-issue}}', example: 'Playback issue', description: 'Selected report issue.' },
      { stamp: '{{report-content-type}}', example: 'movie', description: 'Reported content type when available.' },
      { stamp: '{{report-content-type-line}}', example: 'Content type: movie', description: 'Content type text ready to print.' },
      { stamp: '{{report-content-title}}', example: 'Sample Title', description: 'Reported content title when available.' },
      { stamp: '{{report-content-title-line}}', example: 'Content title: Sample Title', description: 'Content title text ready to print.' },
      { stamp: '{{report-content-link}}', example: 'https://3j.example/watch/movie/123', description: 'Reported content link when available.' },
      { stamp: '{{report-message}}', example: 'Video keeps buffering on server 2.', description: 'Free-text message from the viewer.' },
      { stamp: '{{report-content-line}}', example: 'Content: movie — Sample Title', description: 'Legacy combined content line.' },
      { stamp: '{{report-link-line}}', example: 'Link: https://3j.example/watch/movie/123', description: 'Link text ready to print.' },
      { stamp: '{{report-message-line}}', example: 'Message: Video keeps buffering on server 2.', description: 'Message text ready to print.' },
      { stamp: '{{submitted-datetime}}', example: '2025-01-20 08:15 PM', description: 'When the report was submitted.' },
    ],
  },
  {
    title: 'Storage / Daily Report Sections',
    items: [
      { stamp: '{{auto-delete-state}}', example: 'trigger reached', description: 'Current AutoDelete state.' },
      { stamp: '{{trigger-gb}}', example: '4983.1', description: 'AutoDelete trigger threshold in GB.' },
      { stamp: '{{limit-gb}}', example: '5033.1', description: 'AutoDelete limit threshold in GB.' },
      { stamp: '{{thresholds-line}}', example: 'Thresholds: Trigger 4983.1 GB / Limit 5033.1 GB', description: 'Legacy threshold line.' },
      { stamp: '{{live-title}}', example: 'Live TV', description: 'Daily report Live TV section title.' },
      { stamp: '{{live-status-line}}', example: '• Status: unavailable (XUI timeout)', description: 'Live TV status line when live data is unavailable.' },
      { stamp: '{{live-tracked-count}}', example: '72', description: 'Tracked live channel count in the daily report.' },
      { stamp: '{{live-tracked-line}}', example: '• Tracked: 72', description: 'Tracked live channel line.' },
      { stamp: '{{live-up-count}}', example: '68', description: 'Live-up count in the daily report.' },
      { stamp: '{{live-up-line}}', example: '• Up: 68', description: 'Live-up line.' },
      { stamp: '{{live-down-count}}', example: '4', description: 'Live-down count in the daily report.' },
      { stamp: '{{live-down-line}}', example: '• Down: 4', description: 'Live-down line.' },
      { stamp: '{{live-down-sample}}', example: 'CNN HD, Cartoon Network', description: 'Daily report sample of down channels.' },
      { stamp: '{{live-down-sample-line}}', example: '• Down sample: CNN HD, Cartoon Network', description: 'Daily report down-sample line.' },
      { stamp: '{{live-section}}', example: ['Live TV', '• Tracked: 72', '• Up: 68', '• Down: 4'].join('\n'), description: 'Legacy combined Live TV section.' },
      { stamp: '{{user-reports-title}}', example: 'User Reports', description: 'Daily report User Reports section title.' },
      { stamp: '{{user-reports-total-count}}', example: '18', description: 'Total report count.' },
      { stamp: '{{user-reports-total-line}}', example: '• Total: 18', description: 'Total report line.' },
      { stamp: '{{user-reports-open-count}}', example: '3', description: 'Open report count.' },
      { stamp: '{{user-reports-open-line}}', example: '• Open: 3', description: 'Open report line.' },
      { stamp: '{{user-reports-resolved-count}}', example: '9', description: 'Resolved report count.' },
      { stamp: '{{user-reports-resolved-line}}', example: '• Resolved: 9', description: 'Resolved report line.' },
      { stamp: '{{user-reports-ignored-count}}', example: '6', description: 'Ignored report count.' },
      { stamp: '{{user-reports-ignored-line}}', example: '• Ignored: 6', description: 'Ignored report line.' },
      { stamp: '{{user-reports-recent-count}}', example: '2', description: 'New report count in the last 24 hours.' },
      { stamp: '{{user-reports-recent-line}}', example: '• New last 24h: 2', description: 'Recent report line.' },
      { stamp: '{{user-reports-latest-open}}', example: 'juan: Playback issue | anna: Wrong audio', description: 'Latest open report summary.' },
      { stamp: '{{user-reports-latest-open-line}}', example: '• Latest open: juan: Playback issue | anna: Wrong audio', description: 'Latest open report line.' },
      { stamp: '{{user-reports-section}}', example: ['User Reports', '• Total: 18', '• Open: 3'].join('\n'), description: 'Legacy combined User Reports section.' },
      { stamp: '{{nas-title}}', example: 'NAS', description: 'NAS section title.' },
      { stamp: '{{nas-status}}', example: 'ok', description: 'NAS status: `ok` or `unavailable`.' },
      { stamp: '{{nas-status-line}}', example: '• Status: unavailable (Mount missing)', description: 'NAS status line when unavailable.' },
      { stamp: '{{nas-path}}', example: '/mnt/nas', description: 'NAS path.' },
      { stamp: '{{nas-path-line}}', example: '• Path: /mnt/nas', description: 'NAS path line.' },
      { stamp: '{{nas-used}}', example: '4.8 TB', description: 'NAS used capacity.' },
      { stamp: '{{nas-total}}', example: '5.0 TB', description: 'NAS total capacity.' },
      { stamp: '{{nas-free}}', example: '200 GB', description: 'NAS free capacity.' },
      { stamp: '{{nas-percent}}', example: '96.0%', description: 'NAS usage percent.' },
      { stamp: '{{nas-used-line}}', example: '• Used: 4.8 TB / 5.0 TB (96.0%)', description: 'NAS used-capacity line.' },
      { stamp: '{{nas-free-line}}', example: '• Free: 200 GB', description: 'NAS free-capacity line.' },
      { stamp: '{{nas-auto-delete-state}}', example: 'trigger reached', description: 'NAS AutoDelete state.' },
      { stamp: '{{nas-auto-delete-line}}', example: '• AutoDelete: trigger reached (Trigger 4983.1 GB / Limit 5033.1 GB)', description: 'NAS AutoDelete status line.' },
      { stamp: '{{nas-section}}', example: ['NAS', '• Path: /mnt/nas', '• Used: 4.8 TB / 5.0 TB (96.0%)'].join('\n'), description: 'Legacy combined NAS section.' },
      { stamp: '{{vod-title}}', example: 'XUI VOD', description: 'VOD section title.' },
      { stamp: '{{vod-status}}', example: 'ok', description: 'VOD status: `ok` or `unavailable`.' },
      { stamp: '{{vod-status-line}}', example: '• Status: unavailable (Path missing)', description: 'VOD status line when unavailable.' },
      { stamp: '{{vod-path}}', example: '/home/xui/content/vod', description: 'VOD path.' },
      { stamp: '{{vod-path-line}}', example: '• Path: /home/xui/content/vod', description: 'VOD path line.' },
      { stamp: '{{vod-used}}', example: '4.8 TB', description: 'VOD used capacity.' },
      { stamp: '{{vod-total}}', example: '5.0 TB', description: 'VOD total capacity.' },
      { stamp: '{{vod-free}}', example: '200 GB', description: 'VOD free capacity.' },
      { stamp: '{{vod-percent}}', example: '96.0%', description: 'VOD usage percent.' },
      { stamp: '{{vod-used-line}}', example: '• Used: 4.8 TB / 5.0 TB (96.0%)', description: 'VOD used-capacity line.' },
      { stamp: '{{vod-free-line}}', example: '• Free: 200 GB', description: 'VOD free-capacity line.' },
      { stamp: '{{vod-auto-delete-state}}', example: 'trigger reached', description: 'VOD AutoDelete state.' },
      { stamp: '{{vod-auto-delete-line}}', example: '• AutoDelete: trigger reached (Trigger 4983.1 GB / Limit 5033.1 GB)', description: 'VOD AutoDelete status line.' },
      { stamp: '{{vod-section}}', example: ['XUI VOD', '• Path: /home/xui/content/vod', '• Used: 4.8 TB / 5.0 TB (96.0%)'].join('\n'), description: 'Legacy combined VOD section.' },
    ],
  },
];

export const TELEGRAM_MESSAGE_STAMP_EXAMPLES = [
  {
    title: 'Live TV status template example',
    text: [
      '📡 Live TV channel status update',
      'Checked: {{checked-datetime}}',
      'Detected changes: {{detected-down-count}} down, {{detected-up-count}} up',
      'Current totals: {{current-up-count}} up, {{current-down-count}} down, {{tracked-count}} tracked',
      'Alert delay: {{alert-delay-text}}',
      '{{down-heading}}',
      '{{down-items}}',
      '{{up-heading}}',
      '{{up-items}}',
    ].join('\n'),
  },
  {
    title: 'Live TV channel item example',
    text: [
      '• {{channel-name}}',
      '  {{channel-status}}{{channel-status-duration-part}}{{channel-server-part}}',
      '  {{channel-resolution}}{{channel-codecs-part}}{{channel-fps-part}}{{channel-bitrate-part}}{{channel-transcode-speed-part}}{{channel-drop-frames-part}}{{channel-dup-frames-part}}{{channel-source-part}}',
    ].join('\n'),
  },
  {
    title: 'User report example',
    text: [
      '📝 New user report',
      'User: {{report-user}}',
      'Issue: {{report-issue}}',
      '{{report-content-type-line}}',
      '{{report-content-title-line}}',
      '{{report-link-line}}',
      '{{report-message-line}}',
      'Submitted: {{submitted-datetime}}',
    ].join('\n'),
  },
];

const BASE_TELEGRAM_MESSAGE_SAMPLE_VALUES = Object.fromEntries(
  TELEGRAM_MESSAGE_STAMP_GROUPS.flatMap((group) =>
    group.items.map((item) => [normalizeStampToken(item.stamp), item.example])
  )
);

export const TELEGRAM_MESSAGE_SAMPLE_VALUES = Object.freeze({
  ...BASE_TELEGRAM_MESSAGE_SAMPLE_VALUES,
  'checked-datetime': '2025-01-20 08:15 PM',
  'channel-name': 'Cartoon Network',
  'channel-status-icon': '🔴',
  'channel-status-text': 'Down',
  'channel-status': '🔴 Down',
  'channel-status-duration': '',
  'channel-status-duration-part': '',
  'channel-server': 'Main Server',
  'channel-server-line': 'Server Main Server',
  'channel-server-part': ' • Server Main Server',
  'channel-resolution': '1920x1080',
  'channel-resolution-line': '1920x1080',
  'channel-resolution-part': ' • 1920x1080',
  'channel-codecs': 'h264/aac 2ch',
  'channel-codecs-line': 'h264/aac 2ch',
  'channel-codecs-part': ' • h264/aac 2ch',
  'channel-fps': '30',
  'channel-fps-line': '30 fps',
  'channel-fps-part': ' • 30 fps',
  'channel-bitrate-kbps': '4995',
  'channel-bitrate-line': '4995 kbps',
  'channel-bitrate-part': ' • 4995 kbps',
  'channel-transcode-speed': '',
  'channel-transcode-speed-line': '',
  'channel-transcode-speed-part': '',
  'channel-drop-frames': '',
  'channel-drop-frames-line': '',
  'channel-drop-frames-part': '',
  'channel-dup-frames': '',
  'channel-dup-frames-line': '',
  'channel-dup-frames-part': '',
  'channel-source': '10.100.100.89:1234',
  'channel-source-line': 'Source 10.100.100.89:1234',
  'channel-source-part': ' • Source 10.100.100.89:1234',
  'channel-details-line': '🔴 Down • Server Main Server',
  'channel-meta-line': '1920x1080 • h264/aac 2ch • 30 fps • 4995 kbps • Source 10.100.100.89:1234',
  'down-heading': 'Down (1)',
  'up-heading': 'Up (1)',
  'down-items': [
    '• Cartoon Network',
    '  🔴 Down • Server Main Server',
    '  1920x1080 • h264/aac 2ch • 30 fps • 4995 kbps • Source 10.100.100.89:1234',
  ].join('\n'),
  'up-items': [
    '• A2Z',
    '  🟢 Up • Uptime 4h 20m • Server Main Server',
    '  640x360 • h264/aac 2ch • 30 fps • 1389 kbps • Source 10.100.100.89:1234',
  ].join('\n'),
  'down-section': [
    'Down (1)',
    '• Cartoon Network',
    '  🔴 Down • Server Main Server',
    '  1920x1080 • h264/aac 2ch • 30 fps • 4995 kbps • Source 10.100.100.89:1234',
  ].join('\n'),
  'up-section': [
    'Up (1)',
    '• A2Z',
    '  🟢 Up • Uptime 4h 20m • Server Main Server',
    '  640x360 • h264/aac 2ch • 30 fps • 1389 kbps • Source 10.100.100.89:1234',
  ].join('\n'),
  'reminder-heading': 'Still down (1)',
  'reminder-items': [
    '• Cartoon Network',
    '  🔴 Down • Down for 12h 15m • Server Main Server',
    '  1920x1080 • h264/aac 2ch • 30 fps • 4995 kbps • Source 10.100.100.89:1234',
  ].join('\n'),
  'reminder-section': [
    'Still down (1)',
    '• Cartoon Network',
    '  🔴 Down • Down for 12h 15m • Server Main Server',
    '  1920x1080 • h264/aac 2ch • 30 fps • 4995 kbps • Source 10.100.100.89:1234',
  ].join('\n'),
});

export function renderTelegramTemplatePreview(template = '', sampleValues = TELEGRAM_MESSAGE_SAMPLE_VALUES) {
  const rendered = String(template || '').replace(/\{\{\s*([a-z0-9_-]+)\s*\}\}/gi, (match, token) => {
    const key = String(token || '').trim().toLowerCase();
    if (!key) return '';
    if (!Object.prototype.hasOwnProperty.call(sampleValues, key)) return '';
    return sampleValues[key] == null ? '' : String(sampleValues[key]);
  });

  return rendered
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmedEnd = line.replace(/[ \t]+$/g, '');
      return trimmedEnd.trim() ? trimmedEnd : '';
    })
    .join('\n')
    .replace(/(^[ \t]+)•\s+/gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const LEGACY_DEFAULT_TELEGRAM_MESSAGE_TEMPLATES = {
  liveChange: [
    [
      '📡 Live TV channel status update',
      'Checked: {{checked-datetime}}',
      'Detected changes: {{detected-down-count}} down, {{detected-up-count}} up',
      '{{current-totals-line}}',
      '{{alert-delay-line}}',
      '{{down-section}}',
      '{{up-section}}',
    ].join('\n'),
    [
      '📡 Live TV channel status update',
      'Checked: {{checked-datetime}}',
      'Detected changes: {{detected-down-count}} down, {{detected-up-count}} up',
      'Current totals: {{current-up-count}} up, {{current-down-count}} down, {{tracked-count}} tracked',
      'Alert delay: {{alert-delay-text}}',
      '{{down-heading}}',
      '{{down-items}}',
      '{{up-heading}}',
      '{{up-items}}',
    ].join('\n'),
  ],
  liveItem: [
    ['• {{channel-name}}', '  {{channel-details-line}}', '  {{channel-meta-line}}'].join('\n'),
    [
      '• {{channel-name}}',
      '  {{channel-status}}',
      '  {{channel-status-duration}}',
      '  {{channel-server-line}}',
      '  {{channel-resolution-line}}',
      '  {{channel-codecs-line}}',
      '  {{channel-fps-line}}',
      '  {{channel-bitrate-line}}',
      '  {{channel-source-line}}',
    ].join('\n'),
    [
      '• {{channel-name}}',
      '  {{channel-status}}{{channel-status-duration-part}}{{channel-server-part}}',
      '  {{channel-resolution}}{{channel-codecs-part}}{{channel-fps-part}}{{channel-bitrate-part}}{{channel-source-part}}',
    ].join('\n'),
  ],
  liveDownReminder: [
    [
      '⏰ Live TV channel down reminder',
      'Checked: {{checked-datetime}}',
      '{{reminder-interval-line}}',
      '{{current-totals-line}}',
      '{{reminder-section}}',
    ].join('\n'),
    [
      '⏰ Live TV channel down reminder',
      'Checked: {{checked-datetime}}',
      'Reminder interval: {{reminder-interval-text}}',
      'Current totals: {{current-up-count}} up, {{current-down-count}} down, {{tracked-count}} tracked',
      '{{reminder-heading}}',
      '{{reminder-items}}',
    ].join('\n'),
  ],
  userReport: [
    [
      '📝 New user report',
      'User: {{report-user}}',
      'Issue: {{report-issue}}',
      '{{report-content-line}}',
      '{{report-link-line}}',
      '{{report-message-line}}',
      'Submitted: {{submitted-datetime}}',
    ].join('\n'),
    [
      '📝 New user report',
      'User: {{report-user}}',
      'Issue: {{report-issue}}',
      '{{report-content-type-line}}',
      '{{report-content-title-line}}',
      '{{report-link-line}}',
      '{{report-message-line}}',
      'Submitted: {{submitted-datetime}}',
    ].join('\n'),
  ],
  storageTrigger: [
    [
      '⚠️ AutoDelete trigger reached',
      'Time: {{datetime}}',
      '{{thresholds-line}}',
      '{{nas-section}}',
      '{{vod-section}}',
    ].join('\n'),
    [
      '⚠️ AutoDelete trigger reached',
      'Time: {{datetime}}',
      'Thresholds: Trigger {{trigger-gb}} GB / Limit {{limit-gb}} GB',
      '{{nas-title}}',
      '{{nas-path-line}}',
      '{{nas-used-line}}',
      '{{nas-free-line}}',
      '{{nas-auto-delete-line}}',
      '{{vod-title}}',
      '{{vod-path-line}}',
      '{{vod-used-line}}',
      '{{vod-free-line}}',
      '{{vod-auto-delete-line}}',
    ].join('\n'),
  ],
  dailyMonitorReport: [
    [
      '📊 Daily monitor report',
      'Time: {{datetime}}',
      'AutoDelete state: {{auto-delete-state}}',
      '{{live-section}}',
      '{{user-reports-section}}',
      '{{nas-section}}',
      '{{vod-section}}',
    ].join('\n'),
    [
      '📊 Daily monitor report',
      'Time: {{datetime}}',
      'AutoDelete state: {{auto-delete-state}}',
      '{{live-title}}',
      '{{live-status-line}}',
      '{{live-tracked-line}}',
      '{{live-up-line}}',
      '{{live-down-line}}',
      '{{live-down-sample-line}}',
      '{{user-reports-title}}',
      '{{user-reports-total-line}}',
      '{{user-reports-open-line}}',
      '{{user-reports-resolved-line}}',
      '{{user-reports-ignored-line}}',
      '{{user-reports-recent-line}}',
      '{{user-reports-latest-open-line}}',
      '{{nas-title}}',
      '{{nas-status-line}}',
      '{{nas-path-line}}',
      '{{nas-used-line}}',
      '{{nas-free-line}}',
      '{{nas-auto-delete-line}}',
      '{{vod-title}}',
      '{{vod-status-line}}',
      '{{vod-path-line}}',
      '{{vod-used-line}}',
      '{{vod-free-line}}',
      '{{vod-auto-delete-line}}',
    ].join('\n'),
  ],
};

export function defaultTelegramMessageTemplates() {
  return {
    liveChange: [
      '📡 Live TV channel status update',
      'Checked: {{checked-datetime}}',
      'Detected changes: {{detected-down-count}} down, {{detected-up-count}} up',
      'Current totals: {{current-up-count}} up, {{current-down-count}} down, {{tracked-count}} tracked',
      'Alert delay: {{alert-delay-text}}',
      '{{down-heading}}',
      '{{down-items}}',
      '{{up-heading}}',
      '{{up-items}}',
    ].join('\n'),
    liveItem: [
      '• {{channel-name}}',
      '  {{channel-status}}{{channel-status-duration-part}}{{channel-server-part}}',
      '  {{channel-resolution}}{{channel-codecs-part}}{{channel-fps-part}}{{channel-bitrate-part}}{{channel-transcode-speed-part}}{{channel-drop-frames-part}}{{channel-dup-frames-part}}{{channel-source-part}}',
    ].join('\n'),
    liveDownReminder: [
      '⏰ Live TV channel down reminder',
      'Checked: {{checked-datetime}}',
      'Reminder interval: {{reminder-interval-text}}',
      'Current totals: {{current-up-count}} up, {{current-down-count}} down, {{tracked-count}} tracked',
      '{{reminder-heading}}',
      '{{reminder-items}}',
    ].join('\n'),
    userReport: [
      '📝 New user report',
      'User: {{report-user}}',
      'Issue: {{report-issue}}',
      '{{report-content-type-line}}',
      '{{report-content-title-line}}',
      '{{report-link-line}}',
      '{{report-message-line}}',
      'Submitted: {{submitted-datetime}}',
    ].join('\n'),
    storageTrigger: [
      '⚠️ AutoDelete trigger reached',
      'Time: {{datetime}}',
      'Thresholds: Trigger {{trigger-gb}} GB / Limit {{limit-gb}} GB',
      '{{nas-title}}',
      '{{nas-path-line}}',
      '{{nas-used-line}}',
      '{{nas-free-line}}',
      '{{nas-auto-delete-line}}',
      '{{vod-title}}',
      '{{vod-path-line}}',
      '{{vod-used-line}}',
      '{{vod-free-line}}',
      '{{vod-auto-delete-line}}',
    ].join('\n'),
    dailyMonitorReport: [
      '📊 Daily monitor report',
      'Time: {{datetime}}',
      'AutoDelete state: {{auto-delete-state}}',
      '{{live-title}}',
      '{{live-status-line}}',
      '{{live-tracked-line}}',
      '{{live-up-line}}',
      '{{live-down-line}}',
      '{{live-down-sample-line}}',
      '{{user-reports-title}}',
      '{{user-reports-total-line}}',
      '{{user-reports-open-line}}',
      '{{user-reports-resolved-line}}',
      '{{user-reports-ignored-line}}',
      '{{user-reports-recent-line}}',
      '{{user-reports-latest-open-line}}',
      '{{nas-title}}',
      '{{nas-status-line}}',
      '{{nas-path-line}}',
      '{{nas-used-line}}',
      '{{nas-free-line}}',
      '{{nas-auto-delete-line}}',
      '{{vod-title}}',
      '{{vod-status-line}}',
      '{{vod-path-line}}',
      '{{vod-used-line}}',
      '{{vod-free-line}}',
      '{{vod-auto-delete-line}}',
    ].join('\n'),
  };
}

export function normalizeTelegramMessageTemplate(input, fallback = '') {
  const fallbackValue = String(fallback || '').replace(/\r\n/g, '\n').trim();
  const value = String(input || '').replace(/\r\n/g, '\n').trim();
  const normalized = value || fallbackValue;
  if (!normalized) return fallbackValue;
  if (normalized.length <= MAX_TEMPLATE_LENGTH) return normalized;
  return normalized.slice(0, MAX_TEMPLATE_LENGTH).trimEnd();
}

export function normalizeTelegramMessageTemplates(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = defaultTelegramMessageTemplates();
  const next = {};

  for (const { key } of TELEGRAM_MESSAGE_TEMPLATE_FIELDS) {
    const normalized = normalizeTelegramMessageTemplate(source[key], defaults[key]);
    const legacyVariants = Array.isArray(LEGACY_DEFAULT_TELEGRAM_MESSAGE_TEMPLATES[key])
      ? LEGACY_DEFAULT_TELEGRAM_MESSAGE_TEMPLATES[key]
      : [];
    next[key] = legacyVariants.includes(normalized) ? defaults[key] : normalized;
  }

  return next;
}
