const QRCode = require('qrcode');
const { db } = require('./db');

const SESSION_ACTIVE_STATES = new Set(['starting', 'qr', 'pairing', 'connected', 'reconnecting']);
const MAX_RECONNECTS = parseInt(process.env.WA_MAX_RECONNECTS || '5', 10);
const RECONNECT_BASE_MS = parseInt(process.env.WA_RECONNECT_BASE_MS || '5000', 10);
const RECONNECT_MAX_MS = parseInt(process.env.WA_RECONNECT_MAX_MS || '60000', 10);

const sockets = new Map();
const statusCache = new Map();
const startLocks = new Map();
const retryTimers = new Map();
const connectTimers = new Map();
const retryCounts = new Map();
const manualDisconnects = new Set();
const expectedCloses = new Set();
const messageHandlers = new Map();

let baileysModulePromise = null;
let socketFactoryForTest = null;
let baileysForTest = null;

const silentLogger = {
  level: 'silent',
  child() { return this; },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

async function getBaileys() {
  if (baileysForTest) return baileysForTest;
  if (!baileysModulePromise) {
    baileysModulePromise = import('@whiskeysockets/baileys');
  }
  return baileysModulePromise;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserId(userId) {
  return Number(userId);
}

function normalizePhone(number) {
  return String(number || '').replace(/\D/g, '');
}

function toChatJid(number) {
  const raw = String(number || '').trim();
  if (raw.includes('@')) return raw;
  return `${normalizePhone(raw)}@s.whatsapp.net`;
}

function extractPhoneFromJid(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function cacheStatus(userId, data) {
  const cached = {
    status: data.status || 'disconnected',
    phone_jid: data.phone_jid || null,
    qr: data.qr || null,
    pairing_code: data.pairing_code || null,
    last_error: data.last_error || null,
    started_at: data.started_at || null,
    connected_at: data.connected_at || null,
    updated_at: data.updated_at || nowIso(),
  };
  statusCache.set(normalizeUserId(userId), cached);
  return cached;
}

async function upsertSessionStatus(userId, patch) {
  const id = normalizeUserId(userId);
  const current = statusCache.get(id) || {};
  const next = cacheStatus(id, {
    ...current,
    ...patch,
    updated_at: nowIso(),
  });

  await db.execute({
    sql: `
      INSERT INTO whatsapp_sessions (
        user_id, status, phone_jid, qr, pairing_code, last_error,
        started_at, connected_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        status = excluded.status,
        phone_jid = excluded.phone_jid,
        qr = excluded.qr,
        pairing_code = excluded.pairing_code,
        last_error = excluded.last_error,
        started_at = excluded.started_at,
        connected_at = excluded.connected_at,
        updated_at = excluded.updated_at
    `,
    args: [
      id,
      next.status,
      next.phone_jid,
      next.qr,
      next.pairing_code,
      next.last_error,
      next.started_at,
      next.connected_at,
      next.updated_at,
    ],
  });

  return next;
}

async function getSessionRow(userId) {
  const result = await db.execute({
    sql: `SELECT * FROM whatsapp_sessions WHERE user_id = ?`,
    args: [normalizeUserId(userId)],
  });
  return result.rows[0] || null;
}

async function getSessionHealth(userId) {
  const id = normalizeUserId(userId);
  const cached = statusCache.get(id) || await getSessionRow(id);
  const status = cached ? cacheStatus(id, cached) : { status: 'disconnected' };
  return {
    status: status.status || 'disconnected',
    qr: status.qr || null,
    pairingCode: status.pairing_code || null,
    phoneJid: status.phone_jid || null,
    lastError: status.last_error || null,
    startedAt: status.started_at || null,
    connectedAt: status.connected_at || null,
    updatedAt: status.updated_at || null,
    hasClient: sockets.has(id),
    hasQR: !!status.qr,
    hasPairingCode: !!status.pairing_code,
    manuallyDisconnected: manualDisconnects.has(id),
    mode: 'baileys',
    configured: true,
  };
}

function getStatus(userId) {
  return statusCache.get(normalizeUserId(userId))?.status || 'disconnected';
}

async function readAuthValue(userId, keyType, keyId, baileys) {
  const result = await db.execute({
    sql: `
      SELECT value_json
      FROM whatsapp_auth_state
      WHERE user_id = ? AND key_type = ? AND key_id = ?
    `,
    args: [normalizeUserId(userId), keyType, keyId],
  });

  const row = result.rows[0];
  if (!row) return null;
  return JSON.parse(row.value_json, baileys.BufferJSON.reviver);
}

async function writeAuthValue(userId, keyType, keyId, value, baileys) {
  await db.execute({
    sql: `
      INSERT INTO whatsapp_auth_state (user_id, key_type, key_id, value_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, key_type, key_id) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `,
    args: [
      normalizeUserId(userId),
      keyType,
      keyId,
      JSON.stringify(value, baileys.BufferJSON.replacer),
      nowIso(),
    ],
  });
}

async function removeAuthValue(userId, keyType, keyId) {
  await db.execute({
    sql: `
      DELETE FROM whatsapp_auth_state
      WHERE user_id = ? AND key_type = ? AND key_id = ?
    `,
    args: [normalizeUserId(userId), keyType, keyId],
  });
}

async function deleteAuthState(userId) {
  await db.execute({
    sql: `DELETE FROM whatsapp_auth_state WHERE user_id = ?`,
    args: [normalizeUserId(userId)],
  });
}

async function hasSavedAuth(userId) {
  const result = await db.execute({
    sql: `
      SELECT 1
      FROM whatsapp_auth_state
      WHERE user_id = ? AND key_type = 'creds' AND key_id = 'creds'
      LIMIT 1
    `,
    args: [normalizeUserId(userId)],
  });
  return result.rows.length > 0;
}

async function createDbAuthState(userId, baileys) {
  const proto = baileys.proto || baileys.WAProto;
  const creds = await readAuthValue(userId, 'creds', 'creds', baileys) || baileys.initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readAuthValue(userId, type, id, baileys);
            if (type === 'app-state-sync-key' && value && proto?.Message?.AppStateSyncKeyData) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const type of Object.keys(data || {})) {
            for (const id of Object.keys(data[type] || {})) {
              const value = data[type][id];
              tasks.push(value
                ? writeAuthValue(userId, type, id, value, baileys)
                : removeAuthValue(userId, type, id));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => writeAuthValue(userId, 'creds', 'creds', creds, baileys),
  };
}

async function createSocket({ userId, auth, baileys }) {
  if (socketFactoryForTest) {
    return socketFactoryForTest({ userId, auth, baileys });
  }

  const makeWASocket = baileys.default || baileys.makeWASocket;
  const Browsers = baileys.Browsers;
  const keys = baileys.makeCacheableSignalKeyStore
    ? baileys.makeCacheableSignalKeyStore(auth.state.keys, silentLogger)
    : auth.state.keys;

  return makeWASocket({
    auth: {
      creds: auth.state.creds,
      keys,
    },
    browser: Browsers?.ubuntu ? Browsers.ubuntu('ClockBot') : undefined,
    logger: silentLogger,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    syncFullHistory: false,
  });
}

async function closeSocket(userId, reason = 'closing', suppressReconnect = false) {
  const id = normalizeUserId(userId);
  const sock = sockets.get(id);
  if (!sock) return;

  sockets.delete(id);
  if (suppressReconnect) expectedCloses.add(id);
  try {
    if (typeof sock.end === 'function') {
      sock.end(new Error(reason));
    } else if (sock.ws && typeof sock.ws.close === 'function') {
      sock.ws.close();
    }
  } catch (err) {
    console.warn(`[WA:${id}] Error while closing socket: ${err.message}`);
  }
}

function getDisconnectCode(error) {
  return error?.output?.statusCode || error?.statusCode || error?.data?.statusCode || null;
}

function scheduleReconnect(userId, reason) {
  const id = normalizeUserId(userId);
  if (manualDisconnects.has(id)) return;

  clearRetryTimer(id);
  const attempts = (retryCounts.get(id) || 0) + 1;
  retryCounts.set(id, attempts);

  if (attempts > MAX_RECONNECTS) {
    upsertSessionStatus(id, {
      status: 'error',
      qr: null,
      pairing_code: null,
      last_error: `Reconnect failed after ${MAX_RECONNECTS} attempts: ${reason}`,
    }).catch((err) => console.error(`[WA:${id}] Failed to update reconnect status: ${err.message}`));
    retryCounts.set(id, 0);
    return;
  }

  const delay = Math.min(RECONNECT_BASE_MS * (2 ** (attempts - 1)), RECONNECT_MAX_MS);
  upsertSessionStatus(id, {
    status: 'reconnecting',
    qr: null,
    pairing_code: null,
    last_error: reason,
  }).catch((err) => console.error(`[WA:${id}] Failed to mark reconnecting: ${err.message}`));

  retryTimers.set(id, setTimeout(() => {
    retryTimers.delete(id);
    startSession(id, { reconnect: true }).catch((err) => {
      console.error(`[WA:${id}] Reconnect failed: ${err.message}`);
      scheduleReconnect(id, err.message);
    });
  }, delay));
}

function clearRetryTimer(userId) {
  const id = normalizeUserId(userId);
  const timer = retryTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(id);
  }
}

function clearConnectTimer(userId) {
  const id = normalizeUserId(userId);
  const timer = connectTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    connectTimers.delete(id);
  }
}

function startConnectWatchdog(userId) {
  const id = normalizeUserId(userId);
  clearConnectTimer(id);
  const timeoutMs = parseInt(process.env.WA_CONNECT_TIMEOUT_MS || '60000', 10);
  connectTimers.set(id, setTimeout(async () => {
    const health = await getSessionHealth(id);
    if (['starting', 'reconnecting', 'qr', 'pairing'].includes(health.status)) {
      sockets.delete(id);
      await upsertSessionStatus(id, {
        status: 'error',
        qr: null,
        pairing_code: null,
        last_error: 'WhatsApp connection timed out. Click Connect WhatsApp again or request a pairing code.',
      }).catch((err) => console.error(`[WA:${id}] Failed to mark timeout: ${err.message}`));
    }
    clearConnectTimer(id);
  }, timeoutMs));
}

async function handleConnectionUpdate(userId, sock, update, baileys) {
  const id = normalizeUserId(userId);
  const { connection, lastDisconnect, qr } = update;

  if (qr) {
    clearConnectTimer(id);
    const qrDataUrl = await QRCode.toDataURL(qr);
    await upsertSessionStatus(id, {
      status: 'qr',
      qr: qrDataUrl,
      pairing_code: null,
      last_error: null,
    });
  }

  if (connection === 'connecting') {
    const current = statusCache.get(id)?.status;
    if (!['qr', 'pairing', 'reconnecting'].includes(current)) {
      await upsertSessionStatus(id, {
        status: 'starting',
        last_error: null,
      });
    }
  }

  if (connection === 'open') {
    clearConnectTimer(id);
    retryCounts.set(id, 0);
    manualDisconnects.delete(id);
    await upsertSessionStatus(id, {
      status: 'connected',
      phone_jid: sock.user?.id || sock.authState?.creds?.me?.id || null,
      qr: null,
      pairing_code: null,
      last_error: null,
      connected_at: nowIso(),
    });
  }

  if (connection === 'close') {
    clearConnectTimer(id);
    sockets.delete(id);
    const code = getDisconnectCode(lastDisconnect?.error);
    const reason = lastDisconnect?.error?.message || `WhatsApp disconnected${code ? ` (${code})` : ''}`;
    const loggedOut = code === baileys.DisconnectReason?.loggedOut;

    if (expectedCloses.delete(id)) return;
    if (manualDisconnects.has(id)) return;

    if (loggedOut) {
      await deleteAuthState(id);
      retryCounts.set(id, 0);
      await upsertSessionStatus(id, {
        status: 'logged_out',
        qr: null,
        pairing_code: null,
        last_error: 'WhatsApp logged out. Connect again to relink this account.',
      });
      return;
    }

    scheduleReconnect(id, reason);
  }
}

async function handleIncomingMessages(userId, event) {
  for (const msg of event.messages || []) {
    if (msg.key?.fromMe) continue;

    const from = msg.key?.remoteJid || '';
    const body = extractMessageText(msg.message);
    if (!body) continue;

    console.log(`[WA:${userId}] Incoming from ${from}: "${body}"`);
    for (const [pattern, handler] of messageHandlers.entries()) {
      if (body.toLowerCase().includes(pattern.toLowerCase())) {
        handler(userId, from, body).catch((err) => {
          console.error(`[WA:${userId}] Message handler failed: ${err.message}`);
        });
      }
    }
  }
}

function extractMessageText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.title ||
    message.templateButtonReplyMessage?.selectedDisplayText ||
    message.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim();
}

async function startSession(userId, options = {}) {
  const id = normalizeUserId(userId);
  const { forceFresh = false, reconnect = false, phoneNumber } = options;

  if (startLocks.has(id)) {
    await startLocks.get(id);
    return getSessionHealth(id);
  }

  const lock = (async () => {
    const existing = await getSessionHealth(id);
    if (!forceFresh && sockets.has(id) && SESSION_ACTIVE_STATES.has(existing.status)) {
      return;
    }

    manualDisconnects.delete(id);
    clearRetryTimer(id);
    await closeSocket(id, 'Restarting WhatsApp session', true);

    if (forceFresh) {
      await deleteAuthState(id);
    }

    const startedAt = nowIso();
    await upsertSessionStatus(id, {
      status: reconnect ? 'reconnecting' : 'starting',
      qr: null,
      pairing_code: null,
      last_error: null,
      started_at: startedAt,
      connected_at: null,
    });
    startConnectWatchdog(id);

    try {
      const baileys = await getBaileys();
      const auth = await createDbAuthState(id, baileys);
      const sock = await createSocket({ userId: id, auth, baileys });
      sockets.set(id, sock);

      sock.ev.on('creds.update', auth.saveCreds);
      sock.ev.on('connection.update', (update) => {
        handleConnectionUpdate(id, sock, update, baileys).catch((err) => {
          console.error(`[WA:${id}] Connection update failed: ${err.message}`);
        });
      });
      sock.ev.on('messages.upsert', (event) => {
        handleIncomingMessages(id, event).catch((err) => {
          console.error(`[WA:${id}] Message handling failed: ${err.message}`);
        });
      });

      if (phoneNumber && !sock.authState?.creds?.registered && typeof sock.requestPairingCode === 'function') {
        setTimeout(() => {
          requestPairingCode(id, phoneNumber).catch((err) => {
            console.error(`[WA:${id}] Pairing code request failed: ${err.message}`);
          });
        }, 1500);
      }
    } catch (err) {
      sockets.delete(id);
      await upsertSessionStatus(id, {
        status: 'error',
        qr: null,
        pairing_code: null,
        last_error: err.message,
      });
      throw err;
    }
  })();

  startLocks.set(id, lock);
  try {
    await lock;
  } finally {
    startLocks.delete(id);
  }

  return getSessionHealth(id);
}

async function requestPairingCode(userId, phoneNumber) {
  const id = normalizeUserId(userId);
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    throw new Error('Phone number is required');
  }

  let sock = sockets.get(id);
  if (!sock) {
    await startSession(id);
    sock = sockets.get(id);
  }

  if (!sock) {
    throw new Error('WhatsApp session is not ready yet');
  }

  if (sock.authState?.creds?.registered) {
    return getSessionHealth(id);
  }

  if (typeof sock.requestPairingCode !== 'function') {
    throw new Error('Pairing code is not supported by this WhatsApp engine');
  }

  const code = await sock.requestPairingCode(normalized);
  clearConnectTimer(id);
  await upsertSessionStatus(id, {
    status: 'pairing',
    qr: null,
    pairing_code: code,
    last_error: null,
  });

  return getSessionHealth(id);
}

async function reconnectSession(userId) {
  const id = normalizeUserId(userId);
  manualDisconnects.delete(id);
  retryCounts.set(id, 0);
  clearConnectTimer(id);
  await startSession(id, { reconnect: true });
  return getSessionHealth(id);
}

async function disconnectSession(userId) {
  const id = normalizeUserId(userId);
  manualDisconnects.add(id);
  clearRetryTimer(id);
  clearConnectTimer(id);
  retryCounts.set(id, 0);
  await closeSocket(id, 'Manual disconnect', true);
  await upsertSessionStatus(id, {
    status: 'disconnected',
    qr: null,
    pairing_code: null,
    last_error: null,
  });
  return getSessionHealth(id);
}

async function clearServerAuth(userId) {
  const id = normalizeUserId(userId);
  manualDisconnects.add(id);
  clearRetryTimer(id);
  clearConnectTimer(id);
  const sock = sockets.get(id);
  sockets.delete(id);

  if (sock && typeof sock.logout === 'function') {
    await sock.logout().catch(() => {});
  } else {
    await closeSocket(id, 'Clear auth');
  }

  await deleteAuthState(id);
  retryCounts.set(id, 0);
  await upsertSessionStatus(id, {
    status: 'logged_out',
    phone_jid: null,
    qr: null,
    pairing_code: null,
    last_error: null,
    connected_at: null,
  });
  return getSessionHealth(id);
}

async function sendMessage(userId, number, message) {
  const id = normalizeUserId(userId);
  const sock = sockets.get(id);
  if (!sock) {
    throw new Error(`No WhatsApp session found for user ${id}`);
  }

  const health = await getSessionHealth(id);
  if (health.status !== 'connected') {
    throw new Error(`WhatsApp not connected for user ${id}. Status: ${health.status}`);
  }

  const jid = toChatJid(number);
  await sock.sendMessage(jid, { text: message });
  console.log(`[WA:${id}] Sent "${message}" to ${jid}`);
}

function registerMessageHandler(pattern, handler) {
  messageHandlers.set(pattern, handler);
}

function unregisterMessageHandlers() {
  messageHandlers.clear();
}

module.exports = {
  startSession,
  initSession: startSession,
  getStatus,
  getSessionHealth,
  sendMessage,
  disconnectSession,
  reconnectSession,
  clearServerAuth,
  requestPairingCode,
  registerMessageHandler,
  hasSavedAuth,
  normalizePhone,
  extractPhoneFromJid,
  _test: {
    setSocketFactory(factory, baileys) {
      socketFactoryForTest = factory;
      baileysForTest = baileys || null;
    },
    reset() {
      for (const timer of retryTimers.values()) clearTimeout(timer);
      for (const timer of connectTimers.values()) clearTimeout(timer);
      sockets.clear();
      statusCache.clear();
      startLocks.clear();
      retryTimers.clear();
      connectTimers.clear();
      retryCounts.clear();
      manualDisconnects.clear();
      messageHandlers.clear();
      expectedCloses.clear();
      socketFactoryForTest = null;
      baileysForTest = null;
    },
    extractMessageText,
    deleteAuthState,
  },
};
