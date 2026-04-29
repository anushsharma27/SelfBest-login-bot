const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');

process.env.TURSO_URL = `file:${path.join(os.tmpdir(), `clockbot-test-${process.pid}.db`)}`;
process.env.TURSO_AUTH_TOKEN = '';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'password';
process.env.APP_TIMEZONE = 'Asia/Kolkata';

const { db, initDB } = require('../db');
const whatsapp = require('../whatsapp');
const scheduler = require('../scheduler');

const fakeBaileys = {
  BufferJSON: {
    replacer: (_key, value) => value,
    reviver: (_key, value) => value,
  },
  initAuthCreds: () => ({ registered: false }),
  DisconnectReason: { loggedOut: 401 },
};

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeSocketFactory() {
  const sockets = [];
  const sent = [];

  const factory = ({ auth }) => {
    const ev = new EventEmitter();
    const sock = {
      ev,
      authState: { creds: auth.state.creds },
      user: { id: '919999999999@s.whatsapp.net' },
      sendMessage: async (jid, content) => {
        sent.push({ jid, content });
      },
      requestPairingCode: async () => 'ABCD-EFGH',
      end: () => {
        setImmediate(() => ev.emit('connection.update', {
          connection: 'close',
          lastDisconnect: { error: { message: 'manual close', output: { statusCode: 428 } } },
        }));
      },
      logout: async () => {
        setImmediate(() => ev.emit('connection.update', {
          connection: 'close',
          lastDisconnect: { error: { message: 'logout', output: { statusCode: 401 } } },
        }));
      },
    };
    sockets.push(sock);
    return sock;
  };

  return { factory, sockets, sent };
}

async function resetDb() {
  await initDB();
  await db.execute(`DELETE FROM automation_runs`);
  await db.execute(`DELETE FROM logs`);
  await db.execute(`DELETE FROM schedules`);
  await db.execute(`DELETE FROM whatsapp_sessions`);
  await db.execute(`DELETE FROM whatsapp_auth_state`);
  await db.execute(`DELETE FROM users`);
  await db.execute({
    sql: `INSERT INTO users (id, name, email, password, role, created_at) VALUES (1, 'User', 'u@example.com', 'x', 'user', ?)`,
    args: [new Date().toISOString()],
  });
}

async function createSchedule() {
  await db.execute({
    sql: `
      INSERT INTO schedules (
        id, user_id, clock_in_time, clock_out_time,
        clock_in_message, clock_out_message, days, bot_number, is_active, paused_dates, created_at
      )
      VALUES (10, 1, '09:30', '18:30', 'in', 'out', '["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]', '919876543210', 1, '[]', ?)
    `,
    args: [new Date().toISOString()],
  });
  const result = await db.execute(`SELECT * FROM schedules WHERE id = 10`);
  return result.rows[0];
}

test.beforeEach(async () => {
  whatsapp._test.reset();
  await resetDb();
});

test.after(() => {
  whatsapp._test.reset();
});

test('startSession is single-flight and stores QR status', async () => {
  const fake = createFakeSocketFactory();
  whatsapp._test.setSocketFactory(fake.factory, fakeBaileys);

  await Promise.all([
    whatsapp.startSession(1),
    whatsapp.startSession(1),
    whatsapp.startSession(1),
  ]);

  assert.equal(fake.sockets.length, 1);

  fake.sockets[0].ev.emit('connection.update', { qr: 'qr-payload' });
  await delay(20);

  const health = await whatsapp.getSessionHealth(1);
  assert.equal(health.status, 'qr');
  assert.equal(health.hasQR, true);
  assert.match(health.qr, /^data:image\/png;base64,/);
});

test('reconnect keeps saved auth and clear-auth deletes it', async () => {
  const fake = createFakeSocketFactory();
  whatsapp._test.setSocketFactory(fake.factory, fakeBaileys);

  await whatsapp.startSession(1);
  fake.sockets[0].authState.creds.registered = true;
  fake.sockets[0].ev.emit('creds.update', { registered: true });
  await delay(10);

  assert.equal(await whatsapp.hasSavedAuth(1), true);

  await whatsapp.reconnectSession(1);
  await delay(10);
  assert.equal(await whatsapp.hasSavedAuth(1), true);

  await whatsapp.clearServerAuth(1);
  await delay(10);
  assert.equal(await whatsapp.hasSavedAuth(1), false);
});

test('fixed clock-in flow waits for bot replies and logs completion', async () => {
  const fake = createFakeSocketFactory();
  whatsapp._test.setSocketFactory(fake.factory, fakeBaileys);
  await whatsapp.startSession(1);
  fake.sockets[0].ev.emit('connection.update', { connection: 'open' });
  await delay(10);

  const schedule = await createSchedule();
  await scheduler._test.startClockInForSchedule(schedule, '2026-04-29');

  assert.deepEqual(fake.sent.map((m) => m.content.text), ['Clock In']);

  await scheduler.handleIncomingMessage(1, '919876543210@s.whatsapp.net', 'Please provide status 100');
  assert.deepEqual(fake.sent.map((m) => m.content.text), ['Clock In', 'in']);

  await scheduler.handleIncomingMessage(1, '919876543210@s.whatsapp.net', 'You are clocked in');
  const runs = await db.execute(`SELECT state FROM automation_runs WHERE type = 'clock_in'`);
  const logs = await db.execute(`SELECT type, status FROM logs`);
  assert.equal(runs.rows[0].state, 'completed');
  assert.deepEqual(logs.rows.map((row) => [row.type, row.status]), [['clock_in', 'sent']]);
});

test('incoming replies from the wrong sender are ignored', async () => {
  const fake = createFakeSocketFactory();
  whatsapp._test.setSocketFactory(fake.factory, fakeBaileys);
  await whatsapp.startSession(1);
  fake.sockets[0].ev.emit('connection.update', { connection: 'open' });
  await delay(10);

  const schedule = await createSchedule();
  await scheduler._test.startClockInForSchedule(schedule, '2026-04-29');
  await scheduler.handleIncomingMessage(1, '910000000000@s.whatsapp.net', 'Please provide status 100');

  const runs = await db.execute(`SELECT state FROM automation_runs WHERE type = 'clock_in'`);
  assert.equal(fake.sent.length, 1);
  assert.equal(runs.rows[0].state, 'waiting_status_request');
});

test('expired pending runs fail once', async () => {
  const schedule = await createSchedule();
  await db.execute({
    sql: `
      INSERT INTO automation_runs (
        user_id, schedule_id, run_date, type, state, started_at, updated_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [1, schedule.id, '2026-04-29', 'clock_out', 'waiting_clockout_confirm', new Date().toISOString(), new Date().toISOString(), '2000-01-01T00:00:00.000Z'],
  });

  await scheduler._test.expirePendingRuns();
  await scheduler._test.expirePendingRuns();

  const runs = await db.execute(`SELECT state FROM automation_runs WHERE type = 'clock_out'`);
  const logs = await db.execute(`SELECT type, status FROM logs`);
  assert.equal(runs.rows[0].state, 'failed');
  assert.deepEqual(logs.rows.map((row) => [row.type, row.status]), [['clock_out', 'failed']]);
});
