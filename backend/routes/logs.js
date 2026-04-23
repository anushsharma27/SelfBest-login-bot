const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');

const router = express.Router();

// GET /api/logs — return last 50 logs for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT * FROM logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50`,
      args: [req.user.id],
    });
    res.json(result.rows);
  } catch (err) {
    console.error('Get logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
