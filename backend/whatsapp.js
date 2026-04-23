const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

// Maps to store per-user state
const sessions = new Map();    // userId → socket
const qrCodes = new Map();     // userId → base64 QR string
const statuses = new Map();    // userId → 'disconnected' | 'connecting' | 'connected'

const AUTH_DIR = path.join(__dirname, 'auth_info');

/**
 * Initialize or resume a WhatsApp session for a user
 */
async function initSession(userId) {
  // If already connected, skip
  if (sessions.has(userId) && statuses.get(userId) === 'connected') {
    return;
  }

  statuses.set(userId, 'connecting');
  qrCodes.delete(userId);

  const sessionDir = path.join(AUTH_DIR, String(userId));
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true,
    browser: ['ClockBot', 'Chrome', '1.0.0'],
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
    retryRequestDelayMs: 2000,
  });

  // Listen for credential updates
  sock.ev.on('creds.update', saveCreds);

  // Listen for connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Generate base64 QR code
      try {
        const qrBase64 = await QRCode.toDataURL(qr);
        qrCodes.set(userId, qrBase64);
        statuses.set(userId, 'connecting');
      } catch (err) {
        console.error(`[WA:${userId}] QR generation error:`, err.message);
      }
    }

    if (connection === 'open') {
      statuses.set(userId, 'connected');
      qrCodes.delete(userId);
      console.log(`✅ [WA:${userId}] Connected`);
    }

    if (connection === 'close') {
      sessions.delete(userId);
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        statuses.set(userId, 'disconnected');
        console.log(`🔄 [WA:${userId}] Reconnecting in 5s...`);
        setTimeout(() => initSession(userId), 5000);
      } else {
        statuses.set(userId, 'disconnected');
        qrCodes.delete(userId);
        console.log(`🚪 [WA:${userId}] Logged out`);
      }
    }
  });

  sessions.set(userId, sock);
}

/**
 * Get the latest QR code for a user as base64 data URL
 */
function getQR(userId) {
  return qrCodes.get(userId) || null;
}

/**
 * Get the connection status for a user
 */
function getStatus(userId) {
  return statuses.get(userId) || 'disconnected';
}

/**
 * Send a WhatsApp message from a user's session
 * @param {number} userId
 * @param {string} number - format: countrycode+number e.g. 919876543210
 * @param {string} message - text message to send
 */
async function sendMessage(userId, number, message) {
  const sock = sessions.get(userId);
  if (!sock) {
    throw new Error('WhatsApp session not connected');
  }

  const jid = `${number}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text: message });
  console.log(`📤 [WA:${userId}] Sent "${message}" to ${number}`);
}

/**
 * Disconnect and clear session files for a user
 */
async function disconnectSession(userId) {
  const sock = sessions.get(userId);
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      // Ignore logout errors
    }
    sessions.delete(userId);
  }
  qrCodes.delete(userId);
  statuses.set(userId, 'disconnected');

  // Remove auth files
  const sessionDir = path.join(AUTH_DIR, String(userId));
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
  console.log(`🗑️  [WA:${userId}] Session cleared`);
}

module.exports = { initSession, getQR, getStatus, sendMessage, disconnectSession };
