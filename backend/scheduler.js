const cron = require('node-cron');
const { db } = require('./db');
const {
  startSession,
  sendMessage,
  getStatus,
  registerMessageHandler,
  hasSavedAuth,
  normalizePhone,
  extractPhoneFromJid,
} = require('./whatsapp');

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
const WARMUP_INTERVAL_MS = parseInt(process.env.WA_WARMUP_INTERVAL_MS || '15000', 10);
const RUN_TIMEOUT_MS = parseInt(process.env.AUTOMATION_RUN_TIMEOUT_MS || String(15 * 60 * 1000), 10);
const PENDING_STATES = [
  'pending',
  'waiting_status_request',
  'waiting_clockin_confirm',
  'waiting_clockout_confirm',
];

let cronStarted = false;

function nowIso() {
  return new Date().toISOString();
}

function addMsIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function getAppNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    day: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function normalizeTime(value) {
  if (!value) return '';
  const [h, m = '00'] = String(value).split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function parseJsonArray(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isFromConfiguredBot(from, botNumber) {
  return normalizePhone(extractPhoneFromJid(from) || from) === normalizePhone(botNumber);
}

async function loadSchedules() {
  try {
    const result = await db.execute(`
      SELECT DISTINCT s.user_id
      FROM schedules s
      WHERE s.is_active = 1
    `);

    let queued = 0;
    for (const row of result.rows) {
      if (!(await hasSavedAuth(row.user_id))) continue;
      const delay = queued * WARMUP_INTERVAL_MS;
      queued += 1;
      console.log(`[Scheduler] Queueing WhatsApp restore for user ${row.user_id} in ${Math.round(delay / 1000)}s`);
      setTimeout(() => {
        startSession(row.user_id, { reconnect: true }).catch((err) => {
          console.error(`[Scheduler] Failed to restore WhatsApp for user ${row.user_id}: ${err.message}`);
        });
      }, delay);
    }

    console.log(`[Scheduler] Loaded ${result.rows.length} active schedule(s), queued ${queued} saved WhatsApp session(s)`);
  } catch (err) {
    console.error('[Scheduler] Error loading schedules:', err.message);
  }

  registerMessageHandler('clock in', handleIncomingMessage);
  registerMessageHandler('clock out', handleIncomingMessage);
  registerMessageHandler('please provide', handleIncomingMessage);
  registerMessageHandler('clocked in', handleIncomingMessage);
  registerMessageHandler('clocked out', handleIncomingMessage);
  registerMessageHandler('status', handleIncomingMessage);

  if (!cronStarted) {
    cron.schedule('* * * * *', () => {
      tick().catch((err) => console.error('[Scheduler] Tick failed:', err.message));
    }, { timezone: APP_TIMEZONE });
    cronStarted = true;
    console.log(`[Scheduler] Cron started every minute (${APP_TIMEZONE})`);
  }
}

async function reloadSchedule(userId) {
  try {
    const result = await db.execute({
      sql: `SELECT is_active FROM schedules WHERE user_id = ?`,
      args: [userId],
    });

    if (result.rows.length > 0 && result.rows[0].is_active && await hasSavedAuth(userId)) {
      await startSession(userId, { reconnect: true });
    }
  } catch (err) {
    console.error(`[Scheduler] Error reloading schedule for user ${userId}:`, err.message);
  }
}

async function tick() {
  const appNow = getAppNow();
  console.log(`[Scheduler] Tick: ${appNow.day} ${appNow.time} (${appNow.date})`);

  await expirePendingRuns();

  const result = await db.execute(`
    SELECT s.*, u.name as user_name
    FROM schedules s
    JOIN users u ON s.user_id = u.id
    WHERE s.is_active = 1
  `);

  for (const schedule of result.rows) {
    const days = parseJsonArray(schedule.days);
    const pausedDates = parseJsonArray(schedule.paused_dates);

    if (!days.includes(appNow.day)) continue;
    if (pausedDates.includes(appNow.date)) continue;

    if (appNow.time === normalizeTime(schedule.clock_in_time)) {
      await startClockInForSchedule(schedule, appNow.date);
    }

    if (appNow.time === normalizeTime(schedule.clock_out_time)) {
      await startClockOutForSchedule(schedule, appNow.date);
    }
  }
}

async function createRun(schedule, type, runDate) {
  const timestamp = nowIso();
  await db.execute({
    sql: `
      INSERT INTO automation_runs (
        user_id, schedule_id, run_date, type, state,
        started_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      ON CONFLICT(schedule_id, run_date, type) DO NOTHING
    `,
    args: [
      schedule.user_id,
      schedule.id,
      runDate,
      type,
      timestamp,
      timestamp,
      addMsIso(RUN_TIMEOUT_MS),
    ],
  });

  const result = await db.execute({
    sql: `
      SELECT *
      FROM automation_runs
      WHERE schedule_id = ? AND run_date = ? AND type = ?
      LIMIT 1
    `,
    args: [schedule.id, runDate, type],
  });

  const run = result.rows[0];
  return run && run.state === 'pending' ? run : null;
}

async function updateRun(runId, patch) {
  const fields = ['state = ?', 'updated_at = ?'];
  const args = [patch.state, nowIso()];

  if ('expires_at' in patch) {
    fields.push('expires_at = ?');
    args.push(patch.expires_at);
  }
  if ('last_message' in patch) {
    fields.push('last_message = ?');
    args.push(patch.last_message);
  }
  if ('error' in patch) {
    fields.push('error = ?');
    args.push(patch.error);
  }

  args.push(runId);
  await db.execute({
    sql: `UPDATE automation_runs SET ${fields.join(', ')} WHERE id = ?`,
    args,
  });
}

async function failRun(run, reason) {
  await updateRun(run.id, {
    state: 'failed',
    expires_at: null,
    error: reason,
  });
  await insertLog(run.user_id, run.type, 'failed', reason);
}

async function completeRun(run, reason) {
  await updateRun(run.id, {
    state: 'completed',
    expires_at: null,
    error: null,
  });
  await insertLog(run.user_id, run.type, 'sent', reason);
}

async function expirePendingRuns() {
  const result = await db.execute({
    sql: `
      SELECT *
      FROM automation_runs
      WHERE state IN ('waiting_status_request', 'waiting_clockin_confirm', 'waiting_clockout_confirm')
        AND expires_at IS NOT NULL
        AND expires_at <= ?
    `,
    args: [nowIso()],
  });

  for (const run of result.rows) {
    await failRun(run, 'Company bot did not finish the flow within 15 minutes');
  }
}

async function startClockInForSchedule(schedule, runDate) {
  const run = await createRun(schedule, 'clock_in', runDate);
  if (!run) return;

  if (getStatus(schedule.user_id) !== 'connected') {
    await failRun(run, 'WhatsApp not connected');
    return;
  }

  try {
    await sendMessage(schedule.user_id, schedule.bot_number, 'Clock In');
    await updateRun(run.id, {
      state: 'waiting_status_request',
      expires_at: addMsIso(RUN_TIMEOUT_MS),
      last_message: 'Clock In',
      error: null,
    });
    console.log(`[Scheduler] Clock-in started for user ${schedule.user_id}`);
  } catch (err) {
    await failRun(run, err.message);
  }
}

async function startClockOutForSchedule(schedule, runDate) {
  const run = await createRun(schedule, 'clock_out', runDate);
  if (!run) return;

  if (getStatus(schedule.user_id) !== 'connected') {
    await failRun(run, 'WhatsApp not connected');
    return;
  }

  try {
    await sendMessage(schedule.user_id, schedule.bot_number, schedule.clock_out_message);
    await updateRun(run.id, {
      state: 'waiting_clockout_confirm',
      expires_at: addMsIso(RUN_TIMEOUT_MS),
      last_message: schedule.clock_out_message,
      error: null,
    });
    console.log(`[Scheduler] Clock-out started for user ${schedule.user_id}`);
  } catch (err) {
    await failRun(run, err.message);
  }
}

async function startClockIn(userId) {
  const schedule = await getScheduleForUser(userId);
  if (!schedule) throw new Error('No schedule found');
  const runDate = `${getAppNow().date}:manual:${Date.now()}`;
  await startClockInForSchedule(schedule, runDate);
}

async function startClockOut(userId) {
  const schedule = await getScheduleForUser(userId);
  if (!schedule) throw new Error('No schedule found');
  const runDate = `${getAppNow().date}:manual:${Date.now()}`;
  await startClockOutForSchedule(schedule, runDate);
}

async function getScheduleForUser(userId) {
  const result = await db.execute({
    sql: `SELECT * FROM schedules WHERE user_id = ?`,
    args: [userId],
  });
  return result.rows[0] || null;
}

async function handleIncomingMessage(userId, from, text) {
  const body = String(text || '').trim();
  if (!body) return;

  await expirePendingRuns();

  const result = await db.execute({
    sql: `
      SELECT r.*, s.bot_number, s.clock_in_message, s.clock_out_message
      FROM automation_runs r
      JOIN schedules s ON s.id = r.schedule_id
      WHERE r.user_id = ?
        AND r.state IN ('waiting_status_request', 'waiting_clockin_confirm', 'waiting_clockout_confirm')
      ORDER BY r.started_at DESC
      LIMIT 5
    `,
    args: [userId],
  });

  const textLower = body.toLowerCase();
  for (const run of result.rows) {
    if (!isFromConfiguredBot(from, run.bot_number)) continue;

    if (run.state === 'waiting_status_request') {
      if (textLower.includes('please provide') && (textLower.includes('status') || textLower.includes('100'))) {
        await sendMessage(userId, run.bot_number, run.clock_in_message);
        await updateRun(run.id, {
          state: 'waiting_clockin_confirm',
          expires_at: addMsIso(RUN_TIMEOUT_MS),
          last_message: run.clock_in_message,
          error: null,
        });
        console.log(`[Scheduler] Clock-in status message sent for user ${userId}`);
        return;
      }
    }

    if (run.state === 'waiting_clockin_confirm' && textLower.includes('clocked in')) {
      await completeRun(run, 'Clocked in successfully');
      console.log(`[Scheduler] Clock-in completed for user ${userId}`);
      return;
    }

    if (run.state === 'waiting_clockout_confirm' && textLower.includes('clocked out')) {
      await completeRun(run, 'Clocked out successfully');
      console.log(`[Scheduler] Clock-out completed for user ${userId}`);
      return;
    }
  }
}

async function insertLog(userId, type, status, reason) {
  await db.execute({
    sql: `INSERT INTO logs (user_id, type, status, reason, timestamp) VALUES (?, ?, ?, ?, ?)`,
    args: [userId, type, status, reason, nowIso()],
  });
}

module.exports = {
  loadSchedules,
  reloadSchedule,
  startClockIn,
  startClockOut,
  tick,
  handleIncomingMessage,
  _test: {
    getAppNow,
    startClockInForSchedule,
    startClockOutForSchedule,
    expirePendingRuns,
  },
};
