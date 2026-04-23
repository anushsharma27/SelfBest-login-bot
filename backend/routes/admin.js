const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { db } = require('../db');
const { getStatus, disconnectSession } = require('../whatsapp');

const router = express.Router();

// All routes require auth + admin
router.use(requireAuth, requireAdmin);

// GET /api/admin/users — all users with schedule summary and WhatsApp status
router.get('/users', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT u.id, u.name, u.email, u.role, u.created_at,
             s.clock_in_time, s.clock_out_time, s.is_active as schedule_active, s.bot_number, s.days
      FROM users u
      LEFT JOIN schedules s ON u.id = s.user_id
      ORDER BY u.created_at DESC
    `);

    const users = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      created_at: row.created_at,
      whatsapp_status: getStatus(row.id),
      has_schedule: !!row.clock_in_time,
      schedule: row.clock_in_time ? {
        clock_in_time: row.clock_in_time,
        clock_out_time: row.clock_out_time,
        is_active: row.schedule_active,
        bot_number: row.bot_number,
        days: row.days,
      } : null,
    }));

    res.json(users);
  } catch (err) {
    console.error('Admin get users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/users — create new user
router.post('/users', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check duplicate email
    const existing = await db.execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [email] });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.execute({
      sql: `INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, 'user', ?)`,
      args: [name, email, hashed, new Date().toISOString()],
    });

    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/users/:id — delete user and all their data
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Don't allow deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Disconnect WhatsApp session
    await disconnectSession(userId);

    // Delete logs, schedule, then user
    await db.execute({ sql: `DELETE FROM logs WHERE user_id = ?`, args: [userId] });
    await db.execute({ sql: `DELETE FROM schedules WHERE user_id = ?`, args: [userId] });
    await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [userId] });

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/logs — last 200 logs from all users
router.get('/logs', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT l.*, u.name as user_name
      FROM logs l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.timestamp DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Admin get logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
