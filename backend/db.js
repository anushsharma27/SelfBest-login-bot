const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  // Create users table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT
    )
  `);

  // Create schedules table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      clock_in_time TEXT,
      clock_out_time TEXT,
      clock_in_message TEXT DEFAULT 'in',
      clock_out_message TEXT DEFAULT 'out',
      days TEXT DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
      is_active INTEGER DEFAULT 1,
      paused_dates TEXT DEFAULT '[]',
      bot_number TEXT,
      created_at TEXT
    )
  `);

  // Create logs table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      status TEXT,
      reason TEXT,
      timestamp TEXT
    )
  `);

  // Store Baileys auth credentials and signal keys in Turso so Render does not
  // need a persistent local disk for WhatsApp sessions.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
      user_id INTEGER NOT NULL,
      key_type TEXT NOT NULL,
      key_id TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (user_id, key_type, key_id)
    )
  `);

  // Cached WhatsApp connection state for read-only status APIs.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      user_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'disconnected',
      phone_jid TEXT,
      qr TEXT,
      pairing_code TEXT,
      last_error TEXT,
      started_at TEXT,
      connected_at TEXT,
      updated_at TEXT
    )
  `);

  // Durable state for scheduled clock-in/out conversations.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS automation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      schedule_id INTEGER NOT NULL,
      run_date TEXT NOT NULL,
      type TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT,
      updated_at TEXT,
      expires_at TEXT,
      last_message TEXT,
      error TEXT,
      UNIQUE (schedule_id, run_date, type)
    )
  `);

  await db.execute({
    sql: `
      UPDATE whatsapp_sessions
      SET status = 'disconnected',
          qr = NULL,
          pairing_code = NULL,
          last_error = NULL,
          updated_at = ?
      WHERE status IN ('starting', 'qr', 'pairing', 'connected', 'reconnecting')
    `,
    args: [new Date().toISOString()],
  });

  // Seed admin user if none exists
  const adminCheck = await db.execute(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (adminCheck.rows.length === 0) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      const hashed = await bcrypt.hash(password, 10);
      await db.execute({
        sql: `INSERT INTO users (name, email, password, role, created_at) VALUES (?, ?, ?, 'admin', ?)`,
        args: ['Admin', email, hashed, new Date().toISOString()],
      });
      console.log(`✅ Admin user seeded: ${email}`);
    } else {
      console.warn('⚠️  ADMIN_EMAIL or ADMIN_PASSWORD not set in .env — no admin user created');
    }
  }

  console.log('✅ Database initialized');
}

module.exports = { db, initDB };
