const cron = require('node-cron');
const { db } = require('./db');
const { initSession, sendMessage, getStatus, registerMessageHandler, getPendingAction, setPendingAction, clearPendingAction } = require('./whatsapp');

// Track clocked-in/out status per user per day
const clockStatus = new Map(); // userId:date → { clockedIn: bool, clockedOut: bool }

// Track sent messages per schedule per day to prevent duplicates
const sentToday = new Set(); // key = "scheduleId-date-type"

// Track last clock-in/out trigger time per schedule to prevent duplicates within a short window
const lastTriggerTime = new Map(); // scheduleId → timestamp (ms)

 // Clear at midnight every day
cron.schedule('0 0 * * *', () => {
  sentToday.clear();
  console.log('[Scheduler] Cleared daily sent tracker');
});

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

  // Register handlers for incoming messages from company WhatsApp
  registerMessageHandler('clock in', handleIncomingMessage);
  registerMessageHandler('clock out', handleIncomingMessage);
  registerMessageHandler('please provide', handleIncomingMessage);
  registerMessageHandler('clocked in', handleIncomingMessage);
  registerMessageHandler('clocked out', handleIncomingMessage);
  registerMessageHandler('status', handleIncomingMessage);

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
 * Handle incoming messages from company WhatsApp
 */
async function handleIncomingMessage(userId, from, text) {
  const pending = getPendingAction(userId);
  const textLower = text.toLowerCase().trim();
  const today = new Date().toISOString().slice(0, 10);

  console.log(`[Scheduler] Incoming from ${from}: "${text}" | Pending: ${pending ? pending.type : 'none'}`);

  // Get user's schedule
  let schedule;
  try {
    const result = await db.execute({
      sql: `SELECT * FROM schedules WHERE user_id = ?`,
      args: [userId],
    });
    if (result.rows.length > 0) {
      schedule = result.rows[0];
    }
  } catch (err) {
    console.error(`[Scheduler] Error fetching schedule for user ${userId}:`, err.message);
    return;
  }

  if (!schedule) {
    console.log(`[Scheduler] No schedule found for user ${userId}`);
    return;
  }

  const key = `${userId}:${today}`;
  const status = clockStatus.get(key) || { clockedIn: false, clockedOut: false };

  // ========== CLOCK-IN FLOW ==========

  // Step 1: Received response containing status request
  if (pending && pending.type === 'waiting_status_request') {
    if (textLower.includes('please provide') && (textLower.includes('status') || textLower.includes('100'))) {
      // Send the clock-in message to company
      setPendingAction(userId, { type: 'waiting_clockin_confirm', botNumber: pending.botNumber });
      await sendMessage(userId, pending.botNumber, pending.clockInMessage);
      console.log(`[Scheduler] Clock-in message sent for user ${userId}`);
      return;
    }
  }

  // Step 2: Received clock-in confirmation from company
  if (pending && pending.type === 'waiting_clockin_confirm') {
    if (textLower.includes('clocked in')) {
      status.clockedIn = true;
      clockStatus.set(key, status);
      clearPendingAction(userId);
      await insertLog(userId, 'clock_in', 'sent', 'Clocked in successfully');
      console.log(`✅ [Scheduler] Clock-in completed for user ${userId}`);
      return;
    }
  }

  // ========== CLOCK-OUT FLOW ==========

  // Received clock-out confirmation from company
  if (pending && pending.type === 'waiting_clockout_confirm') {
    if (textLower.includes('clocked out')) {
      status.clockedOut = true;
      clockStatus.set(key, status);
      clearPendingAction(userId);
      await insertLog(userId, 'clock_out', 'sent', 'Clocked out successfully');
      console.log(`✅ [Scheduler] Clock-out completed for user ${userId}`);
      return;
    }
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

  // Reset daily tracking at midnight (00:01)
  if (currentTime === '00:01') {
    clockStatus.clear();
  }

  try {
    const result = await db.execute(`SELECT s.*, u.name as user_name FROM schedules s JOIN users u ON s.user_id = u.id WHERE s.is_active = 1`);

    for (const schedule of result.rows) {
      const userId = schedule.user_id;
      const key = `${userId}:${todayDate}`;
      const status = clockStatus.get(key) || { clockedIn: false, clockedOut: false };

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
        continue;
      }

      // Check for pending action from previous minutes
      const pending = getPendingAction(userId);

      // Check clock-in
      const clockInKey = `${schedule.id}-${todayDate}-clock_in`;
      if (currentTime === schedule.clock_in_time && !status.clockedIn && !pending && !sentToday.has(clockInKey)) {
        // Debounce: skip if triggered within last 2 minutes
        const lastTrigger = lastTriggerTime.get(`${schedule.id}-clock_in`) || 0;
        if (Date.now() - lastTrigger < 120000) {
          console.log(`[Scheduler] Debounce: clock-in skipped for schedule ${schedule.id} (triggered recently)`);
        } else {
          sentToday.add(clockInKey);
          lastTriggerTime.set(`${schedule.id}-clock_in`, Date.now());
          await startClockIn(userId, schedule.bot_number, schedule.clock_in_message);
        }
      }

      // Check clock-out
      const clockOutKey = `${schedule.id}-${todayDate}-clock_out`;
      if (currentTime === schedule.clock_out_time && !status.clockedOut && status.clockedIn && !pending && !sentToday.has(clockOutKey)) {
        // Debounce: skip if triggered within last 2 minutes
        const lastTrigger = lastTriggerTime.get(`${schedule.id}-clock_out`) || 0;
        if (Date.now() - lastTrigger < 120000) {
          console.log(`[Scheduler] Debounce: clock-out skipped for schedule ${schedule.id} (triggered recently)`);
        } else {
          sentToday.add(clockOutKey);
          lastTriggerTime.set(`${schedule.id}-clock_out`, Date.now());
          await startClockOut(userId, schedule.bot_number, schedule.clock_out_message);
        }
      }
    }
  } catch (err) {
    console.error('⚠️  Scheduler tick error:', err.message);
  }
}

/**
 * Start the clock-in flow - send clock-in message and wait for company response
 */
async function startClockIn(userId, botNumber, clockInMessage) {
  const waStatus = getStatus(userId);
  if (waStatus !== 'connected') {
    await insertLog(userId, 'clock_in', 'failed', `WhatsApp not connected`);
    return;
  }

  try {
    // Set pending action to wait for status request response
    setPendingAction(userId, { type: 'waiting_status_request', botNumber, clockInMessage });
    console.log(`[Scheduler] Pending action set for user ${userId}: waiting_status_request`);

    // Send initial clock-in message to company WhatsApp
    await sendMessage(userId, botNumber, 'Clock In');
    console.log(`📤 [Scheduler] Clock-in initiated for user ${userId}, waiting for status request...`);
  } catch (err) {
    await insertLog(userId, 'clock_in', 'failed', err.message);
    clearPendingAction(userId);
    console.error(`❌ [Scheduler] Clock-in failed for user ${userId}:`, err.message);
  }
}

/**
 * Start the clock-out flow - send clock-out message and wait for company response
 */
async function startClockOut(userId, botNumber, clockOutMessage) {
  const waStatus = getStatus(userId);
  if (waStatus !== 'connected') {
    await insertLog(userId, 'clock_out', 'failed', `WhatsApp not connected`);
    return;
  }

  try {
    // Set pending action to wait for clock-out confirmation
    setPendingAction(userId, { type: 'waiting_clockout_confirm', botNumber, clockOutMessage });
    // Send clock-out message to company WhatsApp
    await sendMessage(userId, botNumber, clockOutMessage);
    console.log(`📤 [Scheduler] Clock-out message sent for user ${userId}, waiting for confirmation...`);
  } catch (err) {
    await insertLog(userId, 'clock_out', 'failed', err.message);
    clearPendingAction(userId);
    console.error(`❌ [Scheduler] Clock-out failed for user ${userId}:`, err.message);
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

module.exports = { loadSchedules, reloadSchedule, startClockIn, startClockOut };
