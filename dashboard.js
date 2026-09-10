const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const QRCode = require('qrcode');
const settings = require('./settings');

const PORT = 3000;
const HOST = '0.0.0.0';

// In-memory state for the bot and web dashboard
const botState = {
  sock: null,
  status: 'starting', // starting, connecting, waiting_pair, connected, disconnected
  connection: 'initializing',
  botName: settings.botName || 'X Bot',
  botOwner: settings.botOwner || 'Malidu',
  ownerNumber: settings.ownerNumber || '94719531525',
  version: settings.version || '3.0.7',
  commandMode: settings.commandMode || 'public',
  connectedUser: null,
  pairingCode: 'ZX58-SLC2',
  pairingPhone: settings.ownerNumber || '94719531525',
  qrDataUrl: null,
  qrRaw: null,
  startedAt: Date.now(),
  messageCount: 0,
  commandsExecuted: 0,
  logs: []
};

// Push a timestamped log
function log(type, message) {
  const time = new Date().toLocaleTimeString();
  const entry = { time, type, message: String(message) };
  botState.logs.unshift(entry);
  if (botState.logs.length > 100) {
    botState.logs.pop();
  }
}

// Initial log
log('info', 'X-BOT-MD Dashboard initialized on port ' + PORT);

// Categorized command catalog from X-BOT-MD
const COMMAND_CATALOG = [
  {
    category: 'General',
    icon: '🌐',
    commands: [
      { cmd: '.help / .menu', desc: 'Display bot command catalog and interactive menus' },
      { cmd: '.ping', desc: 'Check bot server response speed and latency' },
      { cmd: '.alive', desc: 'Check if bot is active and system uptime' },
      { cmd: '.tts <text>', desc: 'Convert text to voice message audio' },
      { cmd: '.owner', desc: 'Display bot owner contact and information' },
      { cmd: '.joke', desc: 'Get a random funny joke' },
      { cmd: '.quote', desc: 'Get an inspiring motivational quote' },
      { cmd: '.fact', desc: 'Get a fascinating random fact' },
      { cmd: '.weather <city>', desc: 'Current weather report for a city' },
      { cmd: '.news', desc: 'Fetch latest breaking news headlines' },
      { cmd: '.lyrics <song>', desc: 'Search and display song lyrics' },
      { cmd: '.8ball <question>', desc: 'Ask the magic 8-ball a question' },
      { cmd: '.groupinfo', desc: 'Get information about current WhatsApp group' },
      { cmd: '.staff / .admins', desc: 'List all group administrators' },
      { cmd: '.vv', desc: 'Reveal view-once photo or video message' },
      { cmd: '.trt <text> <lang>', desc: 'Translate text to another language' },
      { cmd: '.ss <url>', desc: 'Capture screenshot of a webpage' },
      { cmd: '.jid', desc: 'Get WhatsApp JID of the current chat' },
      { cmd: '.url', desc: 'Upload replied media and get shareable link' }
    ]
  },
  {
    category: 'AI & Chat',
    icon: '🤖',
    commands: [
      { cmd: '.gpt <prompt>', desc: 'Ask ChatGPT any question' },
      { cmd: '.gemini <prompt>', desc: 'Ask Google Gemini AI for smart answers' },
      { cmd: '.imagine <prompt>', desc: 'Generate AI images from text prompts' },
      { cmd: '.flux <prompt>', desc: 'High-detail Flux AI image generator' },
      { cmd: '.sora <prompt>', desc: 'AI video generation prompt query' },
      { cmd: '.chatbot', desc: 'Toggle automated conversational AI replies' }
    ]
  },
  {
    category: 'Admin & Moderation',
    icon: '👮‍♂️',
    commands: [
      { cmd: '.ban @user', desc: 'Ban user from bot usage' },
      { cmd: '.kick @user', desc: 'Remove member from group' },
      { cmd: '.promote @user', desc: 'Promote participant to group admin' },
      { cmd: '.demote @user', desc: 'Demote group admin to normal participant' },
      { cmd: '.mute <minutes>', desc: 'Mute group chat for specified duration' },
      { cmd: '.unmute', desc: 'Unmute group chat immediately' },
      { cmd: '.delete / .del', desc: 'Delete replied message for everyone' },
      { cmd: '.warn @user', desc: 'Issue warning to a group member' },
      { cmd: '.warnings @user', desc: 'Check warning count for a user' },
      { cmd: '.antilink <on/off>', desc: 'Detect and remove members sharing links' },
      { cmd: '.antibadword <on/off>', desc: 'Automated abusive word filter' },
      { cmd: '.antitag <on/off>', desc: 'Prevent unauthorized mass mentions' },
      { cmd: '.welcome <on/off>', desc: 'Send welcome message when new members join' },
      { cmd: '.goodbye <on/off>', desc: 'Send goodbye card when members leave' },
      { cmd: '.tagall', desc: 'Mention every member in the group' },
      { cmd: '.hidetag <msg>', desc: 'Send a message that tags all members invisibly' },
      { cmd: '.tagnotadmin', desc: 'Mention only non-admin members' },
      { cmd: '.setgname <name>', desc: 'Change WhatsApp group subject' },
      { cmd: '.setgdesc <text>', desc: 'Change WhatsApp group description' },
      { cmd: '.setgpp', desc: 'Update group profile photo with replied image' },
      { cmd: '.resetlink', desc: 'Revoke and reset WhatsApp group invite link' }
    ]
  },
  {
    category: 'Media & Stickers',
    icon: '🎨',
    commands: [
      { cmd: '.sticker', desc: 'Convert replied photo or video into WhatsApp sticker' },
      { cmd: '.simage', desc: 'Convert sticker back into normal image file' },
      { cmd: '.crop', desc: 'Crop replied photo into 1:1 sticker shape' },
      { cmd: '.take <pack> <author>', desc: 'Change sticker author and pack metadata' },
      { cmd: '.removebg', desc: 'AI background removal from replied image' },
      { cmd: '.remini', desc: 'AI photo quality enhancement and upscaling' },
      { cmd: '.blur', desc: 'Apply blur filter to replied image' },
      { cmd: '.attp <text>', desc: 'Generate flashing animated rainbow text sticker' },
      { cmd: '.tgsticker <link>', desc: 'Download Telegram sticker pack to WhatsApp' },
      { cmd: '.emojimix 😃+😎', desc: 'Mix two emojis into custom sticker combo' }
    ]
  },
  {
    category: 'Downloader',
    icon: '📥',
    commands: [
      { cmd: '.song <name/url>', desc: 'Search and download MP3 audio' },
      { cmd: '.play <name>', desc: 'Play and download YouTube audio track' },
      { cmd: '.video <name>', desc: 'Download YouTube video in MP4 format' },
      { cmd: '.spotify <query>', desc: 'Search and download Spotify track' },
      { cmd: '.instagram <link>', desc: 'Download Instagram reels, photos, or posts' },
      { cmd: '.facebook <link>', desc: 'Download Facebook video in HD quality' },
      { cmd: '.tiktok <link>', desc: 'Download TikTok video without watermark' },
      { cmd: '.igs <username>', desc: 'Download Instagram story media' }
    ]
  },
  {
    category: 'Games & Entertainment',
    icon: '🎮',
    commands: [
      { cmd: '.tictactoe @user', desc: 'Play Tic-Tac-Toe match in group chat' },
      { cmd: '.hangman', desc: 'Start a hangman word guessing game' },
      { cmd: '.guess <letter>', desc: 'Guess a letter in active hangman game' },
      { cmd: '.trivia', desc: 'Start a trivia quiz question' },
      { cmd: '.truth', desc: 'Get a Truth prompt for party games' },
      { cmd: '.dare', desc: 'Get a Dare challenge for party games' },
      { cmd: '.ship @user1 @user2', desc: 'Calculate romantic compatibility rate' },
      { cmd: '.wasted @user', desc: 'GTA Wasted overlay on user avatar' },
      { cmd: '.character @user', desc: 'Fun AI personality analysis' }
    ]
  },
  {
    category: 'Owner Controls',
    icon: '🔒',
    commands: [
      { cmd: '.mode <public/private>', desc: 'Switch bot response mode' },
      { cmd: '.autostatus <on/off>', desc: 'Automatically view and react to WhatsApp statuses' },
      { cmd: '.autotyping <on/off>', desc: 'Simulate typing indicator when processing' },
      { cmd: '.autoread <on/off>', desc: 'Auto-read incoming messages (blue tick)' },
      { cmd: '.anticall <on/off>', desc: 'Automatically reject and block incoming calls' },
      { cmd: '.pmblocker <on/off>', desc: 'Block direct message spam to bot number' },
      { cmd: '.clearsession', desc: 'Wipe current WhatsApp session and re-authenticate' },
      { cmd: '.cleartmp', desc: 'Purge temporary files and cache' },
      { cmd: '.setpp', desc: 'Set bot profile photo' },
      { cmd: '.update', desc: 'Pull latest code update from repository' }
    ]
  }
];

function getUptimeString() {
  const diff = Math.floor((Date.now() - botState.startedAt) / 1000);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function renderHtml() {
  const uptimeStr = getUptimeString();
  const mem = process.memoryUsage();
  const ramMb = Math.round(mem.rss / 1024 / 1024);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X-BOT-MD Dashboard | WhatsApp Bot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --card-border: #1f293d;
      --text: #f3f4f6;
      --text-muted: #94a3b8;
      --accent: #25d366; /* WhatsApp Green */
      --accent-dim: rgba(37, 211, 102, 0.15);
      --cyan: #06b6d4;
      --cyan-dim: rgba(6, 182, 212, 0.15);
      --amber: #f59e0b;
      --red: #ef4444;
      --font-main: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-main);
      line-height: 1.6;
      padding: 24px;
      min-height: 100vh;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 28px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-logo {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: #128c7e;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      box-shadow: 0 4px 12px rgba(18, 140, 126, 0.3);
    }
    .brand-title h1 {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
    }
    .brand-title p {
      font-size: 13px;
      color: var(--text-muted);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 10px var(--accent);
      animation: pulse 2s infinite;
    }
    .status-dot.connecting {
      background: var(--amber);
      box-shadow: 0 0 10px var(--amber);
    }
    .status-dot.disconnected {
      background: var(--red);
      box-shadow: 0 0 10px var(--red);
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.9); }
    }
    .grid-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px 20px;
    }
    .metric-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .metric-val {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      font-family: var(--font-mono);
    }
    .main-grid {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 24px;
      margin-bottom: 28px;
    }
    @media (max-width: 900px) {
      .main-grid {
        grid-template-columns: 1fr;
      }
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      display: flex;
      flex-direction: column;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
    }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    /* Pairing Box */
    .pairing-box {
      background: #0d1321;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      margin-bottom: 20px;
    }
    .pairing-label {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .pairing-code-display {
      font-family: var(--font-mono);
      font-size: 32px;
      font-weight: 800;
      letter-spacing: 4px;
      color: #25d366;
      background: rgba(37, 211, 102, 0.08);
      border: 1px dashed rgba(37, 211, 102, 0.4);
      padding: 12px 20px;
      border-radius: 10px;
      display: inline-block;
      margin-bottom: 12px;
      user-select: all;
    }
    .btn {
      background: var(--accent);
      color: #0b0f19;
      font-weight: 700;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-family: var(--font-main);
      font-size: 14px;
      transition: opacity 0.2s, transform 0.1s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-secondary {
      background: #1f293d;
      color: #fff;
      border: 1px solid var(--card-border);
    }
    .btn-secondary:hover {
      background: #27354f;
    }
    .phone-form {
      display: flex;
      gap: 10px;
      margin-top: 14px;
    }
    .input-field {
      flex: 1;
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-family: var(--font-mono);
      font-size: 14px;
      outline: none;
    }
    .input-field:focus {
      border-color: var(--accent);
    }
    .steps-list {
      list-style: none;
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .step-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      font-size: 13px;
      color: var(--text-muted);
    }
    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #1f293d;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .step-text strong {
      color: #fff;
    }
    /* QR Section */
    .qr-container {
      display: none;
      text-align: center;
      padding: 14px;
      background: #090d16;
      border-radius: 12px;
      margin-top: 12px;
    }
    .qr-container img {
      max-width: 180px;
      border-radius: 8px;
      border: 4px solid #fff;
    }
    /* Log console */
    .console-box {
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      font-family: var(--font-mono);
      font-size: 12px;
      padding: 14px;
      height: 260px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .log-line {
      display: flex;
      gap: 10px;
      line-height: 1.4;
    }
    .log-time {
      color: #64748b;
      flex-shrink: 0;
    }
    .log-type-info { color: var(--cyan); }
    .log-type-success { color: var(--accent); }
    .log-type-warn { color: var(--amber); }
    .log-type-error { color: var(--red); }
    .log-msg {
      color: #cbd5e1;
      word-break: break-word;
    }
    /* Commands catalog */
    .commands-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 28px;
    }
    .catalog-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    .category-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pill {
      background: #090d16;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .pill.active, .pill:hover {
      background: var(--card-border);
      color: #fff;
    }
    .pill.active {
      border-color: var(--accent);
      color: var(--accent);
    }
    .search-input {
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 8px 14px;
      color: #fff;
      font-size: 13px;
      outline: none;
      min-width: 220px;
    }
    .search-input:focus {
      border-color: var(--accent);
    }
    .commands-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
    }
    .cmd-item {
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: border-color 0.15s;
    }
    .cmd-item:hover {
      border-color: #334155;
    }
    .cmd-name {
      font-family: var(--font-mono);
      font-weight: 700;
      color: #38bdf8;
      font-size: 13px;
    }
    .cmd-desc {
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .cmd-cat {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-top: 4px;
    }
    footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
      padding-top: 18px;
      border-top: 1px solid var(--card-border);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-logo">⚡</div>
        <div class="brand-title">
          <h1>X-BOT-MD Management Panel</h1>
          <p>Multi-Device WhatsApp Bot &middot; Version ${botState.version}</p>
        </div>
      </div>
      <div id="statusBadge" class="status-badge">
        <div id="statusDot" class="status-dot connecting"></div>
        <span id="statusText">Connecting to WhatsApp...</span>
      </div>
    </header>

    <!-- Metrics Bar -->
    <div class="grid-metrics">
      <div class="metric-card">
        <div class="metric-label">Bot Status</div>
        <div id="metricStatus" class="metric-val" style="color: #38bdf8;">Connecting</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Uptime</div>
        <div id="metricUptime" class="metric-val">${uptimeStr}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">RAM Usage</div>
        <div id="metricRam" class="metric-val">${ramMb} MB</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Active Mode</div>
        <div class="metric-val" style="text-transform: capitalize;">${botState.commandMode}</div>
      </div>
    </div>

    <!-- Main Grid -->
    <div class="main-grid">
      <!-- WhatsApp Authentication Card -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span>📲</span> WhatsApp Link & Pairing
          </div>
          <span id="regStatusBadge" style="font-size: 12px; color: var(--text-muted);">Pairing Mode</span>
        </div>

        <div id="connectedBanner" style="display: none; background: rgba(37, 211, 102, 0.1); border: 1px solid rgba(37, 211, 102, 0.3); border-radius: 12px; padding: 18px; margin-bottom: 16px; text-align: center;">
          <div style="font-size: 36px; margin-bottom: 6px;">✅</div>
          <h3 style="color: #25d366; font-size: 16px; font-weight: 700;">Bot Connected to WhatsApp!</h3>
          <p id="connectedUserText" style="font-size: 13px; color: #cbd5e1; margin-top: 4px;">Active Session</p>
        </div>

        <div id="pairingContainer">
          <div class="pairing-box">
            <div class="pairing-label">Your WhatsApp 8-Digit Pairing Code:</div>
            <div id="pairingCodeVal" class="pairing-code-display">${botState.pairingCode || 'REQUESTING...'}</div>
            <div>
              <button id="copyBtn" class="btn btn-secondary" onclick="copyPairingCode()">
                📋 Copy Pairing Code
              </button>
            </div>
          </div>

          <div style="margin-top: 12px;">
            <label style="font-size: 12px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 6px;">
              Link Another WhatsApp Number:
            </label>
            <div class="phone-form">
              <input id="phoneInput" type="text" class="input-field" placeholder="e.g. 94787515050 (no + or spaces)" value="${botState.pairingPhone}">
              <button id="pairBtn" class="btn" onclick="requestNewPairingCode()">
                Get Code
              </button>
            </div>
            <p id="phoneFeedback" style="font-size: 12px; color: var(--amber); margin-top: 6px; display: none;"></p>
          </div>

          <div id="qrBox" class="qr-container">
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">Or Scan QR Code with WhatsApp:</p>
            <img id="qrImg" src="" alt="WhatsApp QR Code">
          </div>

          <div style="margin-top: 20px;">
            <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 10px;">How to link your WhatsApp:</div>
            <ul class="steps-list">
              <li class="step-item">
                <div class="step-num">1</div>
                <div class="step-text">Open <strong>WhatsApp</strong> on your phone</div>
              </li>
              <li class="step-item">
                <div class="step-num">2</div>
                <div class="step-text">Tap <strong>Linked Devices</strong> (in Settings or ⋮ Menu)</div>
              </li>
              <li class="step-item">
                <div class="step-num">3</div>
                <div class="step-text">Tap <strong>Link a Device</strong> &gt; <strong>Link with phone number instead</strong></div>
              </li>
              <li class="step-item">
                <div class="step-num">4</div>
                <div class="step-text">Enter the 8-digit code displayed above</div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Live Activity & Bot Status Console -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">
            <span>⚡</span> Real-time Bot Activity
          </div>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="clearLogs()">Clear</button>
        </div>

        <div id="consoleBox" class="console-box">
          <!-- Logs populate here -->
        </div>

        <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--card-border); display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;">
          <div>
            <span style="color: var(--text-muted);">Bot Name:</span>
            <strong style="color: #fff; margin-left: 6px;">${botState.botName}</strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Owner Number:</span>
            <strong style="color: #fff; margin-left: 6px;">+${botState.ownerNumber}</strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Prefix:</span>
            <strong style="color: #fff; margin-left: 6px;">. (Dot)</strong>
          </div>
          <div>
            <span style="color: var(--text-muted);">Node Engine:</span>
            <strong style="color: #fff; margin-left: 6px;">${process.version}</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- YouTube Cookies & Long Video Downloader Manager -->
    <div class="card" style="margin-bottom: 28px;">
      <div class="card-header">
        <div class="card-title">
          <span style="font-size: 22px;">🎬</span>
          <div>
            <h3>YouTube Cookies Manager (Long Video & Song Downloader)</h3>
            <p>Export cookies from your browser to download unlimited length YouTube videos & songs (1 to 3+ hours)</p>
          </div>
        </div>
        <div id="cookieBadge" class="status-badge">
          <div id="cookieDot" class="status-dot disconnected"></div>
          <span id="cookieBadgeText">Checking cookies...</span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; margin-top: 14px;">
        <!-- Left: Instructions -->
        <div style="background: #090d16; border: 1px solid var(--card-border); border-radius: 12px; padding: 16px;">
          <h4 style="font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <span>📋</span> Cookies ලබාගන්නා නිවැරදි පියවර (30 තත්පරයෙන්)
          </h4>
          <ol style="padding-left: 20px; font-size: 13px; color: #cbd5e1; line-height: 1.8; display: flex; flex-direction: column; gap: 8px;">
            <li>ඔබේ PC එකේ Chrome / Edge / Brave / Firefox වෙත <strong>"Get cookies.txt LOCALLY"</strong> extension එක දමාගන්න.</li>
            <li><strong>youtube.com</strong> වෙත ගොස් ඔබගේ Google ගිණුමට Sign in වී ඇති බවට තහවුරු කරගන්න.</li>
            <li>YouTube tab එකේ සිටියදී extension එක click කර <strong>"Export"</strong> ලබාගන්න (Netscape format).</li>
            <li>එම Text එක දකුණු පස ඇති කොටුවට Paste කර <strong>"Save & Test Cookies"</strong> ඔබන්න!</li>
          </ol>
          <div style="margin-top: 14px; padding: 10px 12px; background: rgba(37, 211, 102, 0.08); border-left: 3px solid var(--accent); border-radius: 4px; font-size: 12px; color: #94a3b8;">
            ✅ <em>Cookies සක්‍රීය වූ පසු Bot එක කෙලින්ම VPS එකේ <strong>yt-dlp</strong> හරහා ඕනෑම දිග වීඩියෝවක් කිසිදු limit එකක් නොමැතිව WhatsApp Document එකක් ලෙස එවයි!</em>
          </div>
        </div>

        <!-- Right: Input & Test Buttons -->
        <div>
          <label style="display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">
            Paste exported cookies.txt content:
          </label>
          <textarea id="cookieInput" style="width: 100%; height: 130px; background: #090d16; border: 1px solid var(--card-border); border-radius: 8px; color: #38bdf8; font-family: var(--font-mono); font-size: 11px; padding: 10px; resize: vertical; outline: none;" placeholder="# Netscape HTTP Cookie File&#10;# https://curl.se/docs/http-cookies.html&#10;.youtube.com	TRUE	/	TRUE	..."></textarea>
          
          <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
            <button id="saveCookieBtn" onclick="saveAndTestCookies()" class="btn" style="font-size: 13px; padding: 9px 16px;">
              💾 Save & Test Cookies
            </button>
            <button id="testOnlyBtn" onclick="testExistingCookies()" class="btn btn-secondary" style="font-size: 13px; padding: 9px 16px;">
              ⚡ Test Existing
            </button>
            <button id="deleteCookieBtn" onclick="deleteCookies()" class="btn btn-secondary" style="font-size: 13px; padding: 9px 16px; color: var(--red); border-color: rgba(239, 68, 68, 0.3);">
              🗑️ Remove
            </button>
          </div>
          
          <div id="cookieFeedback" style="margin-top: 12px; font-size: 12px; padding: 10px 14px; border-radius: 8px; display: none; line-height: 1.5;"></div>
        </div>
      </div>
    </div>

    <!-- Commands Catalog Section -->
    <div class="commands-section">
      <div class="catalog-controls">
        <div>
          <h2 style="font-size: 18px; font-weight: 800; color: #fff;">Commands Directory</h2>
          <p style="font-size: 13px; color: var(--text-muted);">Available in WhatsApp groups or private messages</p>
        </div>
        <input id="searchInput" type="text" class="search-input" placeholder="Search commands..." oninput="filterCommands()">
      </div>

      <div class="category-pills" id="categoryPills">
        <div class="pill active" onclick="selectCategory('All', this)">All</div>
        ${COMMAND_CATALOG.map(cat => `<div class="pill" onclick="selectCategory('${cat.category}', this)">${cat.icon} ${cat.category}</div>`).join('')}
      </div>

      <div id="commandsGrid" class="commands-grid" style="margin-top: 18px;">
        <!-- Commands injected here -->
      </div>
    </div>

    <footer>
      X-BOT-MD WhatsApp Bot &middot; Powered by Baileys &middot; Running in Google AI Studio
    </footer>
  </div>

  <script>
    const catalog = ${JSON.stringify(COMMAND_CATALOG)};
    let activeCategory = 'All';
    let searchQuery = '';

    function renderCommands() {
      const grid = document.getElementById('commandsGrid');
      let filtered = [];

      catalog.forEach(cat => {
        if (activeCategory === 'All' || activeCategory === cat.category) {
          cat.commands.forEach(cmd => {
            const matchSearch = !searchQuery || 
              cmd.cmd.toLowerCase().includes(searchQuery.toLowerCase()) || 
              cmd.desc.toLowerCase().includes(searchQuery.toLowerCase());
            if (matchSearch) {
              filtered.push({ ...cmd, cat: cat.category, icon: cat.icon });
            }
          });
        }
      });

      if (filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 30px; color: var(--text-muted);">No matching commands found.</div>';
        return;
      }

      grid.innerHTML = filtered.map(item => \`
        <div class="cmd-item">
          <div class="cmd-name">\${item.cmd}</div>
          <div class="cmd-desc">\${item.desc}</div>
          <div class="cmd-cat">\${item.icon} \${item.cat}</div>
        </div>
      \`).join('');
    }

    function selectCategory(cat, el) {
      activeCategory = cat;
      document.querySelectorAll('.category-pills .pill').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      renderCommands();
    }

    function filterCommands() {
      searchQuery = document.getElementById('searchInput').value.trim();
      renderCommands();
    }

    async function copyPairingCode() {
      const code = document.getElementById('pairingCodeVal').innerText;
      if (!code || code === 'REQUESTING...') return;
      try {
        await navigator.clipboard.writeText(code);
        const btn = document.getElementById('copyBtn');
        const orig = btn.innerText;
        btn.innerText = '✅ Copied to Clipboard!';
        setTimeout(() => { btn.innerText = orig; }, 2000);
      } catch (e) {
        alert('Pairing code: ' + code);
      }
    }

    async function requestNewPairingCode() {
      const phoneInput = document.getElementById('phoneInput');
      const feedback = document.getElementById('phoneFeedback');
      const btn = document.getElementById('pairBtn');
      const raw = phoneInput.value.trim().replace(/[^0-9]/g, '');

      if (!raw || raw.length < 9) {
        feedback.innerText = 'Please enter a valid international number with country code (e.g. 94787515050).';
        feedback.style.display = 'block';
        return;
      }

      feedback.innerText = 'Requesting pairing code from WhatsApp...';
      feedback.style.color = 'var(--cyan)';
      feedback.style.display = 'block';
      btn.disabled = true;

      try {
        const res = await fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: raw })
        });
        const data = await res.json();
        if (data.success && data.code) {
          document.getElementById('pairingCodeVal').innerText = data.code;
          feedback.innerText = 'New pairing code generated successfully!';
          feedback.style.color = 'var(--accent)';
        } else {
          feedback.innerText = data.error || 'Failed to request pairing code.';
          feedback.style.color = 'var(--red)';
        }
      } catch (err) {
        feedback.innerText = 'Connection error while requesting code.';
        feedback.style.color = 'var(--red)';
      } finally {
        btn.disabled = false;
      }
    }

    async function clearLogs() {
      try {
        await fetch('/api/clear-logs', { method: 'POST' });
        document.getElementById('consoleBox').innerHTML = '<div class="log-line"><span class="log-time">' + new Date().toLocaleTimeString() + '</span><span class="log-msg">Logs cleared</span></div>';
      } catch (e) {}
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // Update status badge
        const badge = document.getElementById('statusBadge');
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        const metricStatus = document.getElementById('metricStatus');

        dot.className = 'status-dot ' + (data.status === 'connected' ? '' : data.status === 'disconnected' ? 'disconnected' : 'connecting');
        
        if (data.status === 'connected') {
          text.innerText = 'Connected & Active';
          metricStatus.innerText = 'Online';
          metricStatus.style.color = '#25d366';
          document.getElementById('connectedBanner').style.display = 'block';
          document.getElementById('pairingContainer').style.display = 'none';
          document.getElementById('regStatusBadge').innerText = 'Connected';
          if (data.connectedUser) {
            document.getElementById('connectedUserText').innerText = 'Connected as: ' + (data.connectedUser.name || data.connectedUser.id || 'Active User');
          }
        } else if (data.status === 'waiting_pair' || data.pairingCode) {
          text.innerText = 'Waiting for WhatsApp Link';
          metricStatus.innerText = 'Pairing';
          metricStatus.style.color = '#38bdf8';
          document.getElementById('connectedBanner').style.display = 'none';
          document.getElementById('pairingContainer').style.display = 'block';
        } else {
          text.innerText = 'Connecting to WhatsApp...';
          metricStatus.innerText = 'Connecting';
          metricStatus.style.color = '#f59e0b';
        }

        if (data.pairingCode) {
          document.getElementById('pairingCodeVal').innerText = data.pairingCode;
        }

        if (data.qrDataUrl) {
          const qrBox = document.getElementById('qrBox');
          const qrImg = document.getElementById('qrImg');
          qrImg.src = data.qrDataUrl;
          qrBox.style.display = 'block';
        }

        // Metrics
        document.getElementById('metricUptime').innerText = data.uptime;
        document.getElementById('metricRam').innerText = data.ramMb + ' MB';

        // Logs
        const consoleBox = document.getElementById('consoleBox');
        if (data.logs && data.logs.length > 0) {
          consoleBox.innerHTML = data.logs.map(l => \`
            <div class="log-line">
              <span class="log-time">[\${l.time}]</span>
              <span class="log-msg log-type-\${l.type}">\${l.message}</span>
            </div>
          \`).join('');
        }
      } catch (e) {
        // Network lag or restarting
      }
    }

    async function checkCookiesStatus() {
      try {
        const res = await fetch('/api/cookies/status');
        const data = await res.json();
        const badge = document.getElementById('cookieBadge');
        const dot = document.getElementById('cookieDot');
        const text = document.getElementById('cookieBadgeText');

        if (data.exists && data.hasYoutube) {
          dot.className = 'status-dot connected';
          text.innerText = 'Active (' + data.lineCount + ' cookies loaded)';
          badge.className = 'status-badge';
          badge.style.borderColor = 'rgba(37, 211, 102, 0.4)';
          badge.style.color = 'var(--accent)';
        } else if (data.exists) {
          dot.className = 'status-dot connecting';
          text.innerText = 'File exists, but no YouTube cookies found';
          badge.className = 'status-badge';
          badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          badge.style.color = 'var(--amber)';
        } else {
          dot.className = 'status-dot disconnected';
          text.innerText = 'Not Configured (Short videos only)';
          badge.className = 'status-badge';
          badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
          badge.style.color = 'var(--red)';
        }
      } catch (e) {}
    }

    async function saveAndTestCookies() {
      const input = document.getElementById('cookieInput');
      const val = input.value.trim();
      const fb = document.getElementById('cookieFeedback');
      const btn = document.getElementById('saveCookieBtn');

      if (!val) {
        fb.style.display = 'block';
        fb.style.background = 'rgba(239, 68, 68, 0.15)';
        fb.style.color = 'var(--red)';
        fb.style.border = '1px solid var(--red)';
        fb.innerText = '⚠️ Please paste cookies text into the box above before saving.';
        return;
      }

      btn.innerText = 'Saving...';
      btn.disabled = true;
      fb.style.display = 'block';
      fb.style.background = 'rgba(6, 182, 212, 0.15)';
      fb.style.color = 'var(--cyan)';
      fb.style.border = '1px solid var(--cyan)';
      fb.innerText = 'Saving cookies.txt to bot server...';

      try {
        const saveRes = await fetch('/api/cookies/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies: val })
        });
        const saveJson = await saveRes.json();
        if (!saveJson.success) {
          throw new Error(saveJson.error || 'Failed to save');
        }

        fb.innerText = 'Cookies saved! Testing stream extraction with YouTube via yt-dlp...';
        btn.innerText = 'Testing with YouTube...';

        const testRes = await fetch('/api/cookies/test', { method: 'POST' });
        const testJson = await testRes.json();

        if (testJson.success) {
          fb.style.background = 'rgba(37, 211, 102, 0.15)';
          fb.style.color = 'var(--accent)';
          fb.style.border = '1px solid var(--accent)';
          fb.innerHTML = '🎉 <strong>Success!</strong> YouTube cookies verified. You can now download long videos (1-2+ hours) and large MP3 audio files directly to WhatsApp!';
          input.value = '';
        } else {
          fb.style.background = 'rgba(239, 68, 68, 0.15)';
          fb.style.color = 'var(--red)';
          fb.style.border = '1px solid var(--red)';
          fb.innerHTML = '⚠️ <strong>Saved, but YouTube test returned an error:</strong><br><pre style="margin-top:6px; font-size:11px; white-space:pre-wrap;">' + (testJson.error || 'Unknown test error') + '</pre>';
        }
      } catch (err) {
        fb.style.background = 'rgba(239, 68, 68, 0.15)';
        fb.style.color = 'var(--red)';
        fb.style.border = '1px solid var(--red)';
        fb.innerText = 'Error: ' + err.message;
      } finally {
        btn.innerText = '💾 Save & Test Cookies';
        btn.disabled = false;
        checkCookiesStatus();
      }
    }

    async function testExistingCookies() {
      const fb = document.getElementById('cookieFeedback');
      const btn = document.getElementById('testOnlyBtn');
      btn.innerText = 'Testing...';
      btn.disabled = true;
      fb.style.display = 'block';
      fb.style.background = 'rgba(6, 182, 212, 0.15)';
      fb.style.color = 'var(--cyan)';
      fb.style.border = '1px solid var(--cyan)';
      fb.innerText = 'Testing existing cookies with YouTube...';

      try {
        const testRes = await fetch('/api/cookies/test', { method: 'POST' });
        const testJson = await testRes.json();
        if (testJson.success) {
          fb.style.background = 'rgba(37, 211, 102, 0.15)';
          fb.style.color = 'var(--accent)';
          fb.style.border = '1px solid var(--accent)';
          fb.innerHTML = '🎉 <strong>Verified!</strong> YouTube cookies are fully valid and working!';
        } else {
          fb.style.background = 'rgba(239, 68, 68, 0.15)';
          fb.style.color = 'var(--red)';
          fb.style.border = '1px solid var(--red)';
          fb.innerHTML = '⚠️ <strong>Test failed:</strong><br><pre style="margin-top:6px; font-size:11px; white-space:pre-wrap;">' + (testJson.error || 'Unknown error') + '</pre>';
        }
      } catch (e) {
        fb.innerText = 'Test error: ' + e.message;
      } finally {
        btn.innerText = '⚡ Test Existing';
        btn.disabled = false;
        checkCookiesStatus();
      }
    }

    async function deleteCookies() {
      if (!confirm('Are you sure you want to remove cookies.txt?')) return;
      try {
        await fetch('/api/cookies/delete', { method: 'POST' });
        document.getElementById('cookieFeedback').style.display = 'none';
        checkCookiesStatus();
      } catch (e) {}
    }

    renderCommands();
    fetchStatus();
    checkCookiesStatus();
    setInterval(fetchStatus, 2500);
    setInterval(checkCookiesStatus, 10000);
  </script>
</body>
</html>`;
}

// Create and start HTTP server
function startDashboardServer(onPairRequest) {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // Health check endpoint
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    }

    // Status endpoint
    if (pathname === '/api/status') {
      const mem = process.memoryUsage();
      const payload = {
        status: botState.status,
        connection: botState.connection,
        botName: botState.botName,
        botOwner: botState.botOwner,
        ownerNumber: botState.ownerNumber,
        version: botState.version,
        pairingCode: botState.pairingCode,
        pairingPhone: botState.pairingPhone,
        qrDataUrl: botState.qrDataUrl,
        connectedUser: botState.connectedUser,
        uptime: getUptimeString(),
        ramMb: Math.round(mem.rss / 1024 / 1024),
        messageCount: botState.messageCount,
        logs: botState.logs
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(payload));
    }

    // Commands endpoint
    if (pathname === '/api/commands') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(COMMAND_CATALOG));
    }

    // Clear logs
    if (pathname === '/api/clear-logs' && req.method === 'POST') {
      botState.logs = [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    // YouTube Cookies Status Endpoint
    if (pathname === '/api/cookies/status' && req.method === 'GET') {
      const cookiesPath = path.join(__dirname, 'cookies.txt');
      const exists = fs.existsSync(cookiesPath);
      let size = 0;
      let lineCount = 0;
      let modifiedAt = null;
      let hasYoutube = false;
      if (exists) {
        try {
          const stat = fs.statSync(cookiesPath);
          size = stat.size;
          modifiedAt = stat.mtime.toISOString();
          const content = fs.readFileSync(cookiesPath, 'utf8');
          const lines = content.split('\n');
          lineCount = lines.filter(l => l.trim() && !l.startsWith('#')).length;
          hasYoutube = content.includes('youtube.com') || content.includes('.google.com');
        } catch (e) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ exists, size, lineCount, modifiedAt, hasYoutube }));
    }

    // Save YouTube cookies
    if (pathname === '/api/cookies/save' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const content = (parsed.cookies || '').trim();
          if (!content) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Cookies content cannot be empty.' }));
          }
          if (!content.includes('youtube.com') || !content.includes('\t')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid cookie format! Must be in Netscape format (tab-separated lines from .youtube.com). Use "Get cookies.txt LOCALLY" extension.' }));
          }
          const cookiesPath = path.join(__dirname, 'cookies.txt');
          fs.writeFileSync(cookiesPath, content, 'utf8');
          log('success', 'YouTube cookies.txt saved successfully (' + content.length + ' bytes)');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, message: 'Saved cookies.txt successfully!' }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Test YouTube cookies with yt-dlp
    if (pathname === '/api/cookies/test' && req.method === 'POST') {
      const cookiesPath = path.join(__dirname, 'cookies.txt');
      if (!fs.existsSync(cookiesPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'No cookies.txt file found. Please paste and save cookies first.' }));
      }
      log('info', 'Testing YouTube cookies using yt-dlp...');
      const testUrl = 'https://www.youtube.com/watch?v=kJQP7kiw5Fk';
      const ytdlpBin = fs.existsSync('/usr/local/bin/yt-dlp') ? '/usr/local/bin/yt-dlp' : 'yt-dlp';
      const nodeBin = process.execPath || 'node';
      const cmd = `${ytdlpBin} --cookies "${cookiesPath}" --js-runtimes "node:${nodeBin}" --remote-components ejs:github -g --no-playlist "${testUrl}"`;
      exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
        if (err) {
          const errOutput = stderr || err.message || '';
          log('warn', 'YouTube cookies test failed: ' + errOutput.slice(0, 80));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: errOutput
          }));
        }
        const hasStream = stdout && (stdout.includes('googlevideo.com') || stdout.startsWith('http'));
        if (hasStream) {
          log('success', 'YouTube cookies verified! Long video & audio downloads enabled.');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            message: 'Cookies verified! yt-dlp extracted stream URL successfully. Long video downloads enabled.'
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: stdout || 'No video stream URL returned'
          }));
        }
      });
      return;
    }

    // Delete cookies
    if (pathname === '/api/cookies/delete' && req.method === 'POST') {
      const cookiesPath = path.join(__dirname, 'cookies.txt');
      if (fs.existsSync(cookiesPath)) {
        fs.unlinkSync(cookiesPath);
      }
      log('info', 'YouTube cookies.txt removed');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    }

    // Pair request endpoint
    if (pathname === '/api/pair' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const phone = (parsed.phoneNumber || '').replace(/[^0-9]/g, '');
          if (!phone || phone.length < 8) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Valid international phone number is required (without + or spaces).' }));
          }

          log('info', 'Received pairing request for number: ' + phone);

          if (typeof onPairRequest === 'function') {
            const result = await onPairRequest(phone);
            if (result && result.code) {
              botState.pairingCode = result.code;
              botState.pairingPhone = phone;
              log('success', 'Generated pairing code: ' + result.code);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: true, code: result.code }));
            } else {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: result?.error || 'Failed to generate pairing code' }));
            }
          } else {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Bot socket is not ready yet. Please try again in a few seconds.' }));
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Main dashboard page
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderHtml());
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(PORT, HOST, () => {
    console.log(`🌐 X-BOT-MD Dashboard server listening on http://${HOST}:${PORT}`);
    log('success', `Web dashboard listening on port ${PORT}`);
  });

  return server;
}

module.exports = {
  botState,
  log,
  startDashboardServer
};
