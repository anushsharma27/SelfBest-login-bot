const cron = require('node-cron');
const { db } = require('./db');
const { initSession, sendMessage, getStatus } = require('./whatsapp');

/**
 * Load all active schedules and warm up WhatsApp connections
 */
async function loadSchedules() {
  try {
    const result = await db.execute(`SELECT user_id FROM schedules WHERE is_active = 1`);
    for (const row of result.rows) {
      console.log(`🔄 Warming up WhatsApp session for user ${row.user_id}`);
      initSession(row.user_id).catch((err) => {
        console.error(`⚠️  Failed to init session for user ${row.user_id}:`, err.message);
      });
    }
    console.log(`✅ Loaded ${result.rows.length} active schedule(s)`);
  } catch (err) {
    console.error('⚠️  Error loading schedules:', err.message);
  }

  // Start the global cron job — runs every minute
  cron.schedule('* * * * *', async () => {
    await tick();
  });
  console.log('⏰ Scheduler cron started (every minute)');
}

/**
 * Reload / re-init session for a specific user
 */
async function reloadSchedule(userId) {
  try {
    const result = await db.execute({
      sql: `SELECT is_active FROM schedules WHERE user_id = ?`,
      args: [userId],
    });
    if (result.rows.length > 0 && result.rows[0].is_active) {
      await initSession(userId);
    }
  } catch (err) {
    console.error(`⚠️  Error reloading schedule for user ${userId}:`, err.message);
  }
}

/**
 * The cron tick — runs every minute
 */
async function tick() {
  const now = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currentDay = dayNames[now.getDay()];
  const currentTime = now.toTimeString().slice(0, 5); // HH:mm
  const todayDate = now.toISOString().slice(0, 10);    // YYYY-MM-DD

  try {
    const result = await db.execute(`SELECT s.*, u.name as user_name FROM schedules s JOIN users u ON s.user_id = u.id WHERE s.is_active = 1`);

    for (const schedule of result.rows) {
      const userId = schedule.user_id;
      let days, pausedDates;

      try {
        days = JSON.parse(schedule.days || '[]');
      } catch {
        days = [];
      }

      try {
        pausedDates = JSON.parse(schedule.paused_dates || '[]');
      } catch {
        pausedDates = [];
      }

      // Check if today is a working day
      if (!days.includes(currentDay)) {
        continue;
      }

      // Check if today is paused
      if (pausedDates.includes(todayDate)) {
        // Only log once at clock-in time to avoid spam
        if (currentTime === schedule.clock_in_time) {
          await insertLog(userId, 'clock_in', 'skipped', 'Paused by user');
        }
        if (currentTime === schedule.clock_out_time) {
          await insertLog(userId, 'clock_out', 'skipped', 'Paused by user');
        }
        continue;
      }

      // Check clock-in
      if (currentTime === schedule.clock_in_time) {
        await trySend(userId, schedule.bot_number, schedule.clock_in_message, 'clock_in');
      }

      // Check clock-out
      if (currentTime === schedule.clock_out_time) {
        await trySend(userId, schedule.bot_number, schedule.clock_out_message, 'clock_out');
      }
    }
  } catch (err) {
    console.error('⚠️  Scheduler tick error:', err.message);
  }
}

/**
 * Try to send a message and log the result
 */
async function trySend(userId, botNumber, message, type) {
  if (!botNumber) {
    await insertLog(userId, type, 'failed', 'No bot number configured');
    return;
  }

  const status = getStatus(userId);
  if (status !== 'connected') {
    await insertLog(userId, type, 'failed', `WhatsApp not connected (status: ${status})`);
    return;
  }

  try {
    await sendMessage(userId, botNumber, message);
    await insertLog(userId, type, 'sent', null);
    console.log(`✅ [Scheduler] ${type} sent for user ${userId}`);
  } catch (err) {
    await insertLog(userId, type, 'failed', err.message);
    console.error(`❌ [Scheduler] ${type} failed for user ${userId}:`, err.message);
  }
}

/**
 * Insert a log entry
 */
async function insertLog(userId, type, status, reason) {
  try {
    await db.execute({
      sql: `INSERT INTO logs (user_id, type, status, reason, timestamp) VALUES (?, ?, ?, ?, ?)`,
      args: [userId, type, status, reason, new Date().toISOString()],
    });
  } catch (err) {
    console.error(`⚠️  Failed to insert log:`, err.message);
  }
}

module.exports = { loadSchedules, reloadSchedule };
