const { Client, LocalAuth } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const sessions = new Map();
const qrCodes = new Map();
const statuses = new Map();
const retryCount = new Map();
const retryTimers = new Map();
const launchLocks = new Set();
const manualDisconnects = new Set();

const MAX_RETRIES = 5;
const WEB_VERSION = '2.3000.1037968143';

const pendingActions = new Map();
const messageHandlers = new Map();

const AUTH_DIR_CANDIDATES = [
  process.env.WHATSAPP_AUTH_DIR,
  process.env.RENDER ? '/var/data/auth_info' : null,
  path.join(__dirname, 'auth_info')
].filter(Boolean);

let AUTH_DIR = null;

function ensureAuthDir() {
  if (AUTH_DIR) return AUTH_DIR;

  for (const candidate of AUTH_DIR_CANDIDATES) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      AUTH_DIR = candidate;
      console.log(`🔐 [WA] Using auth dir: ${AUTH_DIR}`);
      return AUTH_DIR;
    } catch (err) {
      console.warn(`⚠️  [WA] Auth dir unavailable: ${candidate} (${err.message})`);
    }
  }

  throw new Error(`No writable auth directory found. Tried: ${AUTH_DIR_CANDIDATES.join(', ')}`);
}

function resolveChromeExecutablePath() {
  const candidates = [];

  const bundledPath = puppeteer.executablePath();
  if (bundledPath) candidates.push(bundledPath);

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
  }

  if (!process.env.RENDER) {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.env.RENDER) {
    throw new Error(`No Chrome executable found. Bundled path was ${bundledPath || 'unset'}.`);
  }

  return undefined;
}

function getSessionDir(userId) {
  return path.join(ensureAuthDir(), `session-${userId}`);
}

function clearSessionFiles(userId) {
  const sessionDir = getSessionDir(userId);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}

function clearRetryTimer(userId) {
  const timer = retryTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(userId);
  }
}

function getSessionHealth(userId) {
  return {
    status: statuses.get(userId) || 'disconnected',
    hasClient: sessions.has(userId),
    hasQR: qrCodes.has(userId),
    manuallyDisconnected: manualDisconnects.has(userId)
  };
}

function scheduleReconnect(userId, delay, reason) {
  if (manualDisconnects.has(userId)) return;
  clearRetryTimer(userId);
  retryTimers.set(userId, setTimeout(() => {
    retryTimers.delete(userId);
    initSession(userId).catch((err) => {
      console.error(`❌ [WA:${userId}] ${reason} reconnect failed:`, err.message);
    });
  }, delay));
}

async function closeExistingClient(userId) {
  const existing = sessions.get(userId);
  if (!existing) return;

  try {
    await existing.destroy();
  } catch (err) {
    // ignore
  }
  sessions.delete(userId);
}

async function initSession(userId) {
  const current = statuses.get(userId);
  if (current === 'connected' || current === 'initializing' || launchLocks.has(userId)) return;

  manualDisconnects.delete(userId);
  launchLocks.add(userId);
  clearRetryTimer(userId);
  await closeExistingClient(userId);

  statuses.set(userId, 'initializing');
  qrCodes.delete(userId);

  const authDir = ensureAuthDir();
  const executablePath = resolveChromeExecutablePath();
  console.log(`🔧 [WA:${userId}] Using Chrome executable: ${executablePath || '(puppeteer default)'}`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: String(userId),
      dataPath: authDir
    }),
    webVersion: WEB_VERSION,
    webVersionCache: {
      type: 'local',
      path: path.join(__dirname, '.wwebjs_cache'),
      strict: true
    },
    puppeteer: {
      ...(executablePath ? { executablePath } : {}),
      headless: 'new',
      dumpio: !!process.env.RENDER,
      env: {
        ...process.env,
        // Render doesn't provide a desktop DBus session; this avoids some noisy Chromium probes.
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'disabled:'
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion'
      ]
    }
  });

  client.on('qr', async (qr) => {
    try {
      const qrBase64 = await QRCode.toDataURL(qr);
      qrCodes.set(userId, qrBase64);
      statuses.set(userId, 'connecting');  // now visible to frontend as "Connecting"
      retryCount.set(userId, 0);           // reset retries when we get a fresh QR
      console.log(`📱 [WA:${userId}] QR code generated`);
    } catch (err) {
      console.error(`[WA:${userId}] QR generation error:`, err.message);
    }
  });

  client.on('loading_screen', (percent, message) => {
    statuses.set(userId, 'loading');
    console.log(`⏳ [WA:${userId}] Loading screen ${percent}% - ${message}`);
  });

  client.on('change_state', (state) => {
    console.log(`🔁 [WA:${userId}] State changed: ${state}`);
    if (state === 'CONNECTED') {
      statuses.set(userId, 'loading');
    }
    if (state === 'UNPAIRED' || state === 'UNPAIRED_IDLE') {
      statuses.set(userId, 'connecting');
    }
  });

  client.on('ready', () => {
    statuses.set(userId, 'connected');
    qrCodes.delete(userId);
    retryCount.set(userId, 0);
    manualDisconnects.delete(userId);
    console.log(`✅ [WA:${userId}] Connected and ready`);
  });

  client.on('authenticated', () => {
    statuses.set(userId, 'loading');
    console.log(`🔐 [WA:${userId}] Authenticated`);
  });

  client.on('disconnected', async (reason) => {
    statuses.set(userId, 'disconnected');
    qrCodes.delete(userId);
    console.log(`🔴 [WA:${userId}] Disconnected: ${reason}`);
    if (manualDisconnects.has(userId)) return;
    console.log(`🔄 [WA:${userId}] Reconnecting in 5s...`);
    scheduleReconnect(userId, 5000, 'Disconnected');
  });

  client.on('change_battery', (batteryInfo) => {
    console.log(`🔋 [WA:${userId}] Battery event`, batteryInfo);
  });

  client.on('auth_failure', (msg) => {
    statuses.set(userId, 'disconnected');
    qrCodes.delete(userId);
    console.error(`❌ [WA:${userId}] Auth failure: ${msg}`);

    // Remove stale auth and retry so a fresh QR can be generated.
    clearSessionFiles(userId);
    const attempts = (retryCount.get(userId) || 0) + 1;
    retryCount.set(userId, attempts);
    if (attempts < MAX_RETRIES) {
      const delay = Math.min(5000 * attempts, 30000);
      console.log(`🔄 [WA:${userId}] Retrying from a clean auth state in ${delay / 1000}s...`);
      scheduleReconnect(userId, delay, 'Auth failure');
    } else {
      console.error(`❌ [WA:${userId}] Max retries reached after auth failure. Manual reconnect required.`);
      retryCount.set(userId, 0);
    }
  });

  client.on('message', (msg) => {
    if (msg.fromMe) return;

    const from = msg.from.replace('@c.us', '');
    const body = msg.body || '';

    console.log(`[WA:${userId}] 📩 From ${from}: "${body}"`);

    for (const [pattern, handler] of messageHandlers) {
      if (body.toLowerCase().includes(pattern.toLowerCase())) {
        console.log(`[WA:${userId}] ✅ Matched: ${pattern}`);
        handler(userId, from, body);
      }
    }
  });

  sessions.set(userId, client);

  try {
    await client.initialize();
    // Surface browser/page errors after initialization so Render logs show the real failure.
    client.pupPage?.on('error', (err) => {
      console.error(`❌ [WA:${userId}] Page crashed:`, err?.message || err);
    });
    client.pupPage?.on('pageerror', (err) => {
      console.error(`❌ [WA:${userId}] Page error:`, err?.message || err);
    });
    client.pupPage?.on('framenavigated', (frame) => {
      const url = frame?.url?.();
      if (url && url.includes('post_logout=1')) {
        console.log(`ℹ️ [WA:${userId}] Navigated to logout URL`);
      }
    });
  } catch (err) {
    console.error(`❌ [WA:${userId}] Init error:`, err.message);
    statuses.set(userId, 'disconnected');
    qrCodes.delete(userId);
    try {
      await client.destroy();
    } catch (destroyErr) {
      // ignore
    }
    sessions.delete(userId);
    const attempts = (retryCount.get(userId) || 0) + 1;
    retryCount.set(userId, attempts);
    if (attempts < MAX_RETRIES) {
      const delay = Math.min(5000 * attempts, 30000); // backoff: 5s, 10s, 15s…
      console.log(`🔄 [WA:${userId}] Retry ${attempts}/${MAX_RETRIES} in ${delay/1000}s…`);
      scheduleReconnect(userId, delay, 'Init');
    } else {
      console.error(`❌ [WA:${userId}] Max retries reached. Manual reconnect required.`);
      retryCount.set(userId, 0);
    }
  } finally {
    launchLocks.delete(userId);
  }
}

function getQR(userId) {
  return qrCodes.get(userId) || null;
}

function getStatus(userId) {
  return statuses.get(userId) || 'disconnected';
}

async function sendMessage(userId, number, message) {
  const client = sessions.get(userId);

  if (!client) {
    throw new Error(`No session found for user ${userId}`);
  }

  if (statuses.get(userId) !== 'connected') {
    throw new Error(`WhatsApp not connected for user ${userId}. Status: ${statuses.get(userId)}`);
  }

  const chatId = `${number}@c.us`;

  await client.sendMessage(chatId, message);
  console.log(`📤 [WA:${userId}] Sent "${message}" to ${number}`);
}

async function disconnectSession(userId) {
  manualDisconnects.add(userId);
  clearRetryTimer(userId);
  const client = sessions.get(userId);
  if (client) {
    try {
      await client.destroy();
    } catch (err) {
      // ignore
    }
    sessions.delete(userId);
  }
  qrCodes.delete(userId);
  statuses.set(userId, 'disconnected');
  retryCount.set(userId, 0);
  clearSessionFiles(userId);

  console.log(`🗑️ [WA:${userId}] Session cleared`);
}

async function reconnectSession(userId) {
  await disconnectSession(userId);
  manualDisconnects.delete(userId);
  statuses.set(userId, 'initializing');
  qrCodes.delete(userId);

  // Let puppeteer and the old LocalAuth cleanup settle before starting again.
  retryTimers.set(userId, setTimeout(() => {
    retryTimers.delete(userId);
    initSession(userId).catch((err) => {
      console.error(`❌ [WA:${userId}] Background reconnect failed:`, err.message);
    });
  }, 1200));
}

function ensureSession(userId) {
  const status = statuses.get(userId) || 'disconnected';
  const hasClient = sessions.has(userId);
  const hasQR = qrCodes.has(userId);

  if (manualDisconnects.has(userId)) return getSessionHealth(userId);
  if (status === 'connected' || status === 'initializing' || status === 'loading' || launchLocks.has(userId)) {
    return getSessionHealth(userId);
  }
  if (status === 'connecting' && hasQR) {
    return getSessionHealth(userId);
  }
  if (status === 'connecting' && !hasQR && hasClient) {
    return getSessionHealth(userId);
  }

  statuses.set(userId, 'initializing');
  initSession(userId).catch((err) => {
    console.error(`❌ [WA:${userId}] Auto-start failed:`, err.message);
  });

  return getSessionHealth(userId);
}

function registerMessageHandler(pattern, handler) {
  messageHandlers.set(pattern, handler);
}

function getPendingAction(userId) {
  return pendingActions.get(userId) || null;
}

function setPendingAction(userId, action) {
  pendingActions.set(userId, action);
}

function clearPendingAction(userId) {
  pendingActions.delete(userId);
}

module.exports = {
  initSession,
  getQR,
  getStatus,
  getSessionHealth,
  sendMessage,
  disconnectSession,
  reconnectSession,
  ensureSession,
  registerMessageHandler,
  getPendingAction,
  setPendingAction,
  clearPendingAction
};
