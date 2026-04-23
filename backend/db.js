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
