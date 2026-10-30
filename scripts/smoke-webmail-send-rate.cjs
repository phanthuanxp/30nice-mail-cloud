const assert = require('node:assert/strict');
const { WebmailService } = require('../apps/api/dist/webmail.service.js');

class FakeDatabase {
  rows = new Map();
  lock = Promise.resolve();
  clockValues = [];
  seedTime = new Date('2026-10-30T08:10:00.000Z');

  async query(sql) {
    if (sql.includes('DELETE FROM webmail_send_limits')) return [];
    assert.match(sql, /CREATE TABLE IF NOT EXISTS webmail_send_limits/);
    return [];
  }

  async transaction(work) {
    let release;
    const previous = this.lock;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.rows].map(([key, row]) => [key, { ...row }]));
    const query = async (sql, values = []) => {
      if (sql.includes('INSERT INTO webmail_send_limits')) {
        if (!this.rows.has(values[0])) this.rows.set(values[0], {
          minute_window_start: this.seedTime, minute_count: 0,
          hour_window_start: this.seedTime, hour_count: 0,
        });
        return [];
      }
      if (sql.includes('SELECT clock_timestamp() AS now')) {
        const now = this.clockValues.shift() || new Date();
        return [{ now }];
      }
      if (sql.includes('SELECT minute_window_start')) {
        const row = this.rows.get(values[0]);
        return row ? [{ ...row }] : [];
      }
      if (sql.includes('UPDATE webmail_send_limits')) {
        this.rows.set(values[0], {
          minute_window_start: values[1], minute_count: values[2],
          hour_window_start: values[3], hour_count: values[4],
        });
        return [];
      }
      throw new Error(`Unexpected SQL in send limit smoke test: ${sql}`);
    };
    try { return await work(query); }
    catch (error) { this.rows = snapshot; throw error; }
    finally { release(); }
  }
}

async function main() {
  process.env.WEBMAIL_SEND_RECIPIENTS_PER_MINUTE = '5';
  process.env.WEBMAIL_SEND_RECIPIENTS_PER_HOUR = '20';
  const memory = new WebmailService();
  await memory.consumeSendAllowance('memory@example.test', 4);
  await assert.rejects(() => memory.consumeSendAllowance('memory@example.test', 2), error => error.getStatus() === 429);
  await memory.consumeSendAllowance('memory@example.test', 1);

  process.env.WEBMAIL_SEND_RECIPIENTS_PER_MINUTE = '100';
  process.env.WEBMAIL_SEND_RECIPIENTS_PER_HOUR = '5';
  const database = new FakeDatabase();
  const firstProcess = new WebmailService(database);
  const secondProcess = new WebmailService(database);
  await firstProcess.consumeSendAllowance('persisted@example.test', 4);
  await assert.rejects(() => secondProcess.consumeSendAllowance('persisted@example.test', 2), error => error.getStatus() === 429);
  await secondProcess.consumeSendAllowance('persisted@example.test', 1);
  assert.equal(database.rows.get('persisted@example.test').hour_count, 5, 'failed requests do not consume the rate quota');

  const boundary = new FakeDatabase();
  const justBeforeBoundary = new Date('2026-10-30T08:10:59.900Z');
  const justAfterBoundary = new Date('2026-10-30T08:11:00.100Z');
  boundary.seedTime = justBeforeBoundary;
  boundary.clockValues = [justBeforeBoundary, justAfterBoundary, justAfterBoundary];
  const beforeBoundaryProcess = new WebmailService(boundary);
  const afterBoundaryProcess = new WebmailService(boundary);
  await Promise.all([
    beforeBoundaryProcess.consumeSendAllowance('boundary@example.test', 40),
    afterBoundaryProcess.consumeSendAllowance('boundary@example.test', 40),
  ]);
  await assert.rejects(() => afterBoundaryProcess.consumeSendAllowance('boundary@example.test', 30), error => error.getStatus() === 429);
  assert.equal(boundary.rows.get('boundary@example.test').minute_count, 40, 'a delayed pre-boundary request must not rewind the new window counter');
  console.log('Webmail send rate smoke checks passed: minute/hour recipient caps, persistent cross-instance counters, and rejected attempts do not consume quota.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
