const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const sessions = new Map();
const qrCodes = new Map();
const statuses = new Map();
const retryCount = new Map();

const MAX_RETRIES = 5;

const pendingActions = new Map();
const messageHandlers = new Map();

const AUTH_DIR = path.join(__dirname, 'auth_info');

async function initSession(userId) {
  const current = statuses.get(userId);
  if (current === 'connected' || current === 'initializing') return;

  statuses.set(userId, 'initializing');
  qrCodes.delete(userId);

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: String(userId),
      dataPath: AUTH_DIR
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run'
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

  client.on('ready', () => {
    statuses.set(userId, 'connected');
    qrCodes.delete(userId);
    retryCount.set(userId, 0);
    console.log(`✅ [WA:${userId}] Connected and ready`);
  });

  client.on('authenticated', () => {
    console.log(`🔐 [WA:${userId}] Authenticated`);
  });

  client.on('auth_failure', (msg) => {
    statuses.set(userId, 'disconnected');
    sessions.delete(userId);
    qrCodes.delete(userId);
    console.error(`❌ [WA:${userId}] Auth failure: ${msg}`);
  });

  client.on('disconnected', (reason) => {
    statuses.set(userId, 'disconnected');
    sessions.delete(userId);
    console.log(`🔴 [WA:${userId}] Disconnected: ${reason}`);
    console.log(`🔄 [WA:${userId}] Reconnecting in 5s...`);
    setTimeout(() => initSession(userId), 5000);
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
  } catch (err) {
    console.error(`❌ [WA:${userId}] Init error:`, err.message);
    statuses.set(userId, 'disconnected');
    sessions.delete(userId);
    const attempts = (retryCount.get(userId) || 0) + 1;
    retryCount.set(userId, attempts);
    if (attempts < MAX_RETRIES) {
      const delay = Math.min(5000 * attempts, 30000); // backoff: 5s, 10s, 15s…
      console.log(`🔄 [WA:${userId}] Retry ${attempts}/${MAX_RETRIES} in ${delay/1000}s…`);
      setTimeout(() => initSession(userId), delay);
    } else {
      console.error(`❌ [WA:${userId}] Max retries reached. Manual reconnect required.`);
      retryCount.set(userId, 0);
    }
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

  const sessionDir = path.join(AUTH_DIR, `session-${userId}`);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  console.log(`🗑️ [WA:${userId}] Session cleared`);
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
  sendMessage,
  disconnectSession,
  registerMessageHandler,
  getPendingAction,
  setPendingAction,
  clearPendingAction
};