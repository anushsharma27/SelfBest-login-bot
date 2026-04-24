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
const pendingActions = new Map();
const messageHandlers = new Map();
const sessionMeta = new Map();

const MAX_RETRIES = 5;

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

function markSessionStage(userId, stage, extra = '') {
  const startedAt = sessionMeta.get(userId)?.startedAt || Date.now();
  sessionMeta.set(userId, { startedAt, stage });
  const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  console.log(`🧭 [WA:${userId}] ${stage}${extra ? ` | ${extra}` : ''} | +${elapsed}s`);
}

function scheduleReconnect(userId, delay, reason, options = {}) {
  if (manualDisconnects.has(userId)) return;

  clearRetryTimer(userId);
  retryTimers.set(
    userId,
    setTimeout(() => {
      retryTimers.delete(userId);
      initSession(userId, options).catch((err) => {
        console.error(`❌ [WA:${userId}] ${reason} reconnect failed: ${err.message}`);
      });
    }, delay)
  );
}

async function closeExistingClient(userId) {
  const client = sessions.get(userId);
  if (!client) return;

  try {
    markSessionStage(userId, 'Destroying existing client');
    await client.destroy();
  } catch (err) {
    console.warn(`⚠️  [WA:${userId}] Error while closing session: ${err.message}`);
  }

  sessions.delete(userId);
}

function resolveChromeExecutablePath() {
  const candidates = [];

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
  }

  try {
    const bundled = puppeteer.executablePath();
    if (bundled) candidates.push(bundled);
  } catch (err) {
    // ignore
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

  return undefined;
}

function buildPuppeteerConfig() {
  const executablePath = resolveChromeExecutablePath();
  const isRender = !!process.env.RENDER;
  const headless = process.env.WA_HEADLESS === 'false' ? false : 'new';

  console.log(`🔧 [WA] Chrome executable: ${executablePath || '(default)'} | headless: ${headless}`);

  return {
    ...(executablePath ? { executablePath } : {}),
    headless,
    dumpio: isRender,
    env: {
      ...process.env,
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'disabled:'
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-sync'
    ]
  };
}

async function initSession(userId, options = {}) {
  const { forceFresh = false } = options;
  const current = statuses.get(userId);

  if (!forceFresh && (current === 'connected' || current === 'initializing' || current === 'loading' || launchLocks.has(userId))) {
    return;
  }

  manualDisconnects.delete(userId);
  launchLocks.add(userId);
  clearRetryTimer(userId);
  qrCodes.delete(userId);
  statuses.set(userId, 'initializing');
  sessionMeta.set(userId, { startedAt: Date.now(), stage: 'initializing' });
  markSessionStage(userId, 'Initializing session', `forceFresh=${forceFresh}`);

  await closeExistingClient(userId);
  if (forceFresh) {
    markSessionStage(userId, 'Clearing saved auth');
    clearSessionFiles(userId);
  }

  try {
    const authDir = ensureAuthDir();
    markSessionStage(userId, 'Auth directory ready', authDir);
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: String(userId),
        dataPath: authDir
      }),
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      authTimeoutMs: 60000,
      qrMaxRetries: 0,
      restartOnAuthFail: false,
      puppeteer: buildPuppeteerConfig()
    });
    markSessionStage(userId, 'Client created');

    client.on('qr', async (qr) => {
      try {
        const qrBase64 = await QRCode.toDataURL(qr);
        qrCodes.set(userId, qrBase64);
        statuses.set(userId, 'connecting');
        retryCount.set(userId, 0);
        markSessionStage(userId, 'QR generated');
        console.log(`📱 [WA:${userId}] QR code generated`);
      } catch (err) {
        console.error(`❌ [WA:${userId}] QR generation error: ${err.message}`);
      }
    });

    client.on('loading_screen', (percent, message) => {
      statuses.set(userId, 'loading');
      markSessionStage(userId, 'Loading screen', `${percent}% ${message}`);
      console.log(`⏳ [WA:${userId}] Loading ${percent}% - ${message}`);
    });

    client.on('authenticated', () => {
      statuses.set(userId, 'loading');
      markSessionStage(userId, 'Authenticated');
      console.log(`🔐 [WA:${userId}] Authenticated`);
    });

    client.on('ready', () => {
      statuses.set(userId, 'connected');
      qrCodes.delete(userId);
      retryCount.set(userId, 0);
      manualDisconnects.delete(userId);
      markSessionStage(userId, 'Ready');
      console.log(`✅ [WA:${userId}] Connected and ready`);
    });

    client.on('remote_session_saved', () => {
      console.log(`💾 [WA:${userId}] Remote session saved`);
    });

    client.on('change_state', (state) => {
      markSessionStage(userId, 'State changed', state);
      console.log(`🔁 [WA:${userId}] State changed: ${state}`);
      if (state === 'CONNECTED') {
        statuses.set(userId, 'loading');
      }
    });

    client.on('auth_failure', (message) => {
      sessions.delete(userId);
      statuses.set(userId, 'disconnected');
      qrCodes.delete(userId);
      markSessionStage(userId, 'Auth failure', message);
      console.error(`❌ [WA:${userId}] Auth failure: ${message}`);

      clearSessionFiles(userId);
      const attempts = (retryCount.get(userId) || 0) + 1;
      retryCount.set(userId, attempts);

      if (attempts < MAX_RETRIES) {
        const delay = Math.min(5000 * attempts, 30000);
        console.log(`🔄 [WA:${userId}] Retrying with fresh auth in ${delay / 1000}s...`);
        scheduleReconnect(userId, delay, 'Auth failure', { forceFresh: true });
      } else {
        console.error(`❌ [WA:${userId}] Max retries reached after auth failure. Manual reconnect required.`);
        retryCount.set(userId, 0);
      }
    });

    client.on('disconnected', (reason) => {
      sessions.delete(userId);
      statuses.set(userId, 'disconnected');
      qrCodes.delete(userId);
      markSessionStage(userId, 'Disconnected', String(reason || 'unknown'));
      console.log(`🔴 [WA:${userId}] Disconnected: ${reason}`);

      if (manualDisconnects.has(userId)) return;

      const shouldResetAuth = String(reason || '').toLowerCase().includes('logout');
      if (shouldResetAuth) {
        clearSessionFiles(userId);
      }

      const attempts = (retryCount.get(userId) || 0) + 1;
      retryCount.set(userId, attempts);

      if (attempts < MAX_RETRIES) {
        const delay = Math.min(5000 * attempts, 30000);
        console.log(`🔄 [WA:${userId}] Retry ${attempts}/${MAX_RETRIES} in ${delay / 1000}s...`);
        scheduleReconnect(userId, delay, 'Disconnect', { forceFresh: shouldResetAuth });
      } else {
        console.error(`❌ [WA:${userId}] Max retries reached. Manual reconnect required.`);
        retryCount.set(userId, 0);
      }
    });

    client.on('message', (msg) => {
      if (msg.fromMe) return;

      const from = (msg.from || '').replace('@c.us', '');
      const body = (msg.body || '').trim();
      if (!body) return;

      console.log(`[WA:${userId}] 📩 From ${from}: "${body}"`);

      for (const [pattern, handler] of messageHandlers.entries()) {
        if (body.toLowerCase().includes(pattern.toLowerCase())) {
          console.log(`[WA:${userId}] ✅ Matched: ${pattern}`);
          handler(userId, from, body);
        }
      }
    });

    sessions.set(userId, client);
    markSessionStage(userId, 'Calling client.initialize()');
    await client.initialize();
    markSessionStage(userId, 'client.initialize() resolved');

    if (client.pupPage) {
      client.pupPage.on('error', (err) => {
        console.error(`❌ [WA:${userId}] Page crashed: ${err?.message || err}`);
      });
      client.pupPage.on('pageerror', (err) => {
        console.error(`❌ [WA:${userId}] Page error: ${err?.message || err}`);
      });
      client.pupPage.on('framenavigated', (frame) => {
        const url = frame?.url?.();
        if (url) {
          console.log(`🌐 [WA:${userId}] Frame navigated: ${url}`);
        }
      });
    }
  } catch (err) {
    sessions.delete(userId);
    qrCodes.delete(userId);
    statuses.set(userId, 'disconnected');

    const attempts = (retryCount.get(userId) || 0) + 1;
    retryCount.set(userId, attempts);

    markSessionStage(userId, 'Init error', err.message);
    console.error(`❌ [WA:${userId}] Init error: ${err.message}`);

    if (attempts < MAX_RETRIES) {
      const delay = Math.min(5000 * attempts, 30000);
      console.log(`🔄 [WA:${userId}] Retry ${attempts}/${MAX_RETRIES} in ${delay / 1000}s...`);
      scheduleReconnect(userId, delay, 'Init', { forceFresh });
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

  const chatId = number.includes('@') ? number : `${number}@c.us`;
  await client.sendMessage(chatId, message);
  console.log(`📤 [WA:${userId}] Sent "${message}" to ${number}`);
}

async function disconnectSession(userId) {
  manualDisconnects.add(userId);
  clearRetryTimer(userId);
  qrCodes.delete(userId);
  statuses.set(userId, 'disconnected');
  retryCount.set(userId, 0);
  markSessionStage(userId, 'Manual disconnect requested');

  await closeExistingClient(userId);
  clearSessionFiles(userId);

  console.log(`🗑️ [WA:${userId}] Session cleared`);
}

async function reconnectSession(userId) {
  await disconnectSession(userId);
  manualDisconnects.delete(userId);
  statuses.set(userId, 'initializing');
  sessionMeta.set(userId, { startedAt: Date.now(), stage: 'reconnecting' });
  markSessionStage(userId, 'Reconnect queued');

  retryTimers.set(
    userId,
    setTimeout(() => {
      retryTimers.delete(userId);
      initSession(userId, { forceFresh: true }).catch((err) => {
        console.error(`❌ [WA:${userId}] Background reconnect failed: ${err.message}`);
      });
    }, 1000)
  );
}

async function clearServerAuth(userId) {
  await disconnectSession(userId);
  console.log(`🧹 [WA:${userId}] Server auth_info cleared`);
}

function ensureSession(userId) {
  const status = statuses.get(userId) || 'disconnected';
  const hasClient = sessions.has(userId);
  const hasQR = qrCodes.has(userId);

  if (manualDisconnects.has(userId)) return getSessionHealth(userId);
  if (status === 'connected' || status === 'initializing' || status === 'loading' || launchLocks.has(userId)) {
    return getSessionHealth(userId);
  }
  if (status === 'connecting' && (hasQR || hasClient)) {
    return getSessionHealth(userId);
  }

  statuses.set(userId, 'initializing');
  initSession(userId).catch((err) => {
    console.error(`❌ [WA:${userId}] Auto-start failed: ${err.message}`);
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
  clearServerAuth,
  ensureSession,
  registerMessageHandler,
  getPendingAction,
  setPendingAction,
  clearPendingAction
};
