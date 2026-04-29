const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  startSession,
  getSessionHealth,
  disconnectSession,
  reconnectSession,
  clearServerAuth,
  requestPairingCode,
} = require('../whatsapp');

const router = express.Router();
router.use(requireAuth);

function statusResponse(health) {
  return {
    status: health.status,
    qr: health.qr,
    pairingCode: health.pairingCode,
    phoneJid: health.phoneJid,
    lastError: health.lastError,
    hasClient: health.hasClient,
    hasQR: health.hasQR,
    hasPairingCode: health.hasPairingCode,
    manuallyDisconnected: health.manuallyDisconnected,
    mode: health.mode,
    configured: health.configured,
  };
}

// GET /api/whatsapp/status
// Read-only: this must not start or restart a WhatsApp session.
router.get('/status', async (req, res) => {
  try {
    const health = await getSessionHealth(req.user.id);
    res.json(statusResponse(health));
  } catch (err) {
    console.error('WhatsApp status error:', err);
    res.status(500).json({ error: 'Failed to load WhatsApp status' });
  }
});

// Deprecated compatibility endpoint. It is intentionally read-only.
router.get('/qr', async (req, res) => {
  try {
    const health = await getSessionHealth(req.user.id);
    res.json(statusResponse(health));
  } catch (err) {
    console.error('WhatsApp QR status error:', err);
    res.status(500).json({ error: 'Failed to load WhatsApp status' });
  }
});

// POST /api/whatsapp/connect
router.post('/connect', async (req, res) => {
  try {
    const health = await startSession(req.user.id);
    res.json({ message: 'WhatsApp connection started', ...statusResponse(health) });
  } catch (err) {
    console.error('Connect error:', err);
    res.status(500).json({ error: err.message || 'Failed to connect WhatsApp' });
  }
});

// POST /api/whatsapp/pair-code
router.post('/pair-code', async (req, res) => {
  try {
    const { phoneNumber } = req.body || {};
    const health = await requestPairingCode(req.user.id, phoneNumber);
    res.json({ message: 'Pairing code requested', ...statusResponse(health) });
  } catch (err) {
    console.error('Pairing code error:', err);
    res.status(500).json({ error: err.message || 'Failed to request pairing code' });
  }
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    const health = await disconnectSession(req.user.id);
    res.json({ message: 'Disconnected successfully', ...statusResponse(health) });
  } catch (err) {
    console.error('Disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// POST /api/whatsapp/reconnect
router.post('/reconnect', async (req, res) => {
  try {
    const health = await reconnectSession(req.user.id);
    res.json({ message: 'Reconnecting...', ...statusResponse(health) });
  } catch (err) {
    console.error('Reconnect error:', err);
    res.status(500).json({ error: err.message || 'Failed to reconnect' });
  }
});

// POST /api/whatsapp/clear-auth
router.post('/clear-auth', async (req, res) => {
  try {
    const health = await clearServerAuth(req.user.id);
    res.json({ message: 'Server auth cleared successfully', ...statusResponse(health) });
  } catch (err) {
    console.error('Clear auth error:', err);
    res.status(500).json({ error: err.message || 'Failed to clear server auth' });
  }
});

module.exports = router;
