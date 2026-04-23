const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');
const { reloadSchedule } = require('../scheduler');

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
    const { clock_in_time, clock_in_message, clock_out_message, days, bot_number } = req.body;

    if (!clock_in_time) {
      return res.status(400).json({ error: 'Clock-in time is required' });
    }

    if (!bot_number) {
      return res.status(400).json({ error: 'Bot number is required' });
    }

    const clock_out_time = addHours(clock_in_time, 9);
    const daysJson = JSON.stringify(days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    const inMsg = clock_in_message || 'in';
    const outMsg = clock_out_message || 'out';

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

module.exports = router;
