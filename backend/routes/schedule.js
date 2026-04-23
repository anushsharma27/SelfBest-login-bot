const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { reloadSchedule } = require('../scheduler');
const { sendMessage, getStatus } = require('../whatsapp');

const router = express.Router();

// All routes require authentication
router.use(requireAuth);

/**
 * Helper: add hours to a time string HH:mm
 */
function addHours(timeStr, hours) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = (h + hours) * 60 + m;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// GET /api/schedule — get current user's schedule
router.get('/', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT * FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });
    res.json(result.rows.length > 0 ? result.rows[0] : null);
  } catch (err) {
    console.error('Get schedule error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schedule — create or update schedule
router.post('/', async (req, res) => {
  try {
    const { clock_in_time, clock_out_time, clock_in_message, clock_out_message, days, bot_number } = req.body;

    if (!clock_in_time) {
      return res.status(400).json({ error: 'Clock-in time is required' });
    }

    if (!clock_in_message) {
      return res.status(400).json({ error: 'Clock-in message is required' });
    }

    if (!clock_out_message) {
      return res.status(400).json({ error: 'Clock-out message is required' });
    }

    if (!bot_number) {
      return res.status(400).json({ error: 'Bot number is required' });
    }

    const daysJson = JSON.stringify(days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    const inMsg = clock_in_message;
    const outMsg = clock_out_message;

    // Check if schedule exists
    const existing = await db.execute({
      sql: `SELECT id FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });

    if (existing.rows.length > 0) {
      // Update
      await db.execute({
        sql: `UPDATE schedules SET clock_in_time = ?, clock_out_time = ?, clock_in_message = ?, clock_out_message = ?, days = ?, bot_number = ?, is_active = 1 WHERE user_id = ?`,
        args: [clock_in_time, clock_out_time, inMsg, outMsg, daysJson, bot_number, req.user.id],
      });
    } else {
      // Create
      await db.execute({
        sql: `INSERT INTO schedules (user_id, clock_in_time, clock_out_time, clock_in_message, clock_out_message, days, bot_number, is_active, paused_dates, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, '[]', ?)`,
        args: [req.user.id, clock_in_time, clock_out_time, inMsg, outMsg, daysJson, bot_number, new Date().toISOString()],
      });
    }

    // Reload the scheduler for this user
    await reloadSchedule(req.user.id);

    // Return updated schedule
    const result = await db.execute({
      sql: `SELECT * FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Save schedule error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/schedule/toggle — flip is_active
router.patch('/toggle', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT id, is_active FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No schedule found' });
    }

    const newActive = result.rows[0].is_active ? 0 : 1;
    await db.execute({
      sql: `UPDATE schedules SET is_active = ? WHERE user_id = ?`,
      args: [newActive, req.user.id],
    });

    res.json({ is_active: newActive });
  } catch (err) {
    console.error('Toggle schedule error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schedule/pause-today — add today to paused_dates
router.post('/pause-today', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await db.execute({
      sql: `SELECT id, paused_dates FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No schedule found' });
    }

    let paused;
    try {
      paused = JSON.parse(result.rows[0].paused_dates || '[]');
    } catch {
      paused = [];
    }

    if (!paused.includes(today)) {
      paused.push(today);
    }

    await db.execute({
      sql: `UPDATE schedules SET paused_dates = ? WHERE user_id = ?`,
      args: [JSON.stringify(paused), req.user.id],
    });

    res.json({ paused_dates: paused, message: 'Today paused' });
  } catch (err) {
    console.error('Pause today error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/schedule/pause-today — remove today from paused_dates
router.delete('/pause-today', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await db.execute({
      sql: `SELECT id, paused_dates FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No schedule found' });
    }

    let paused;
    try {
      paused = JSON.parse(result.rows[0].paused_dates || '[]');
    } catch {
      paused = [];
    }

    paused = paused.filter((d) => d !== today);

    await db.execute({
      sql: `UPDATE schedules SET paused_dates = ? WHERE user_id = ?`,
      args: [JSON.stringify(paused), req.user.id],
    });

    res.json({ paused_dates: paused, message: 'Today resumed' });
  } catch (err) {
    console.error('Resume today error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schedule/test-message — send a test message now
router.post('/test-message', async (req, res) => {
  try {
    const { bot_number, message } = req.body;

    if (!bot_number) {
      return res.status(400).json({ error: 'Bot number is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const status = getStatus(req.user.id);
    if (status !== 'connected') {
      return res.status(400).json({ error: `WhatsApp not connected (${status})` });
    }

    // Strip spaces from bot number for sending
    const cleanNumber = bot_number.replace(/\s/g, '');
    await sendMessage(req.user.id, cleanNumber, message);

    res.json({ success: true, message: 'Test message sent!' });
  } catch (err) {
    console.error('Test message error:', err);
    res.status(500).json({ error: err.message || 'Failed to send message' });
  }
});

// POST /api/schedule/clock-in — trigger clock-in flow manually
router.post('/clock-in', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT * FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No schedule found' });
    }

    const schedule = result.rows[0];
    const { startClockIn } = require('../scheduler');
    await startClockIn(req.user.id, schedule.bot_number, schedule.clock_in_message);

    res.json({ success: true, message: 'Clock-in initiated. Check WhatsApp for status request.' });
  } catch (err) {
    console.error('Clock-in error:', err);
    res.status(500).json({ error: err.message || 'Failed to initiate clock-in' });
  }
});

// POST /api/schedule/clock-out — trigger clock-out flow manually
router.post('/clock-out', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT * FROM schedules WHERE user_id = ?`,
      args: [req.user.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No schedule found' });
    }

    const schedule = result.rows[0];
    const { startClockOut } = require('../scheduler');
    await startClockOut(req.user.id, schedule.bot_number, schedule.clock_out_message);

    res.json({ success: true, message: 'Clock-out initiated. Reply "confirm" on WhatsApp.' });
  } catch (err) {
    console.error('Clock-out error:', err);
    res.status(500).json({ error: err.message || 'Failed to initiate clock-out' });
  }
});

module.exports = router;
