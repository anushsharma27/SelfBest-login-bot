const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getQR, getStatus, disconnectSession, reconnectSession } = require('../whatsapp');

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

// GET /api/whatsapp/qr
router.get('/qr', (req, res) => {
  const qr = getQR(req.user.id);
  res.json({ qr });
});

// GET /api/whatsapp/status
router.get('/status', (req, res) => {
  const status = getStatus(req.user.id);
  const qr = getQR(req.user.id);
  res.json({ status, qr });
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    await disconnectSession(req.user.id);
    res.json({ message: 'Disconnected successfully' });
  } catch (err) {
    console.error('Disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// POST /api/whatsapp/reconnect
router.post('/reconnect', async (req, res) => {
  try {
    await reconnectSession(req.user.id);
    res.json({ message: 'Reconnecting...' });
  } catch (err) {
    console.error('Reconnect error:', err);
    res.status(500).json({ error: err.message || 'Failed to reconnect' });
  }
});

module.exports = router;
