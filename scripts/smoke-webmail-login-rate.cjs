const assert = require('node:assert/strict');
const { WebmailService } = require('../apps/api/dist/webmail.service.js');

class FakeDatabase {
  rows = new Map();
  lock = Promise.resolve();
  now = Date.now();

  async query(sql, values = []) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS webmail_login_limits')) return [];
    if (sql.includes('DELETE FROM webmail_login_limits WHERE reset_at')) return [];
    if (sql.includes('DELETE FROM webmail_login_limits WHERE limit_key = ANY')) {
      for (const key of values[0] || []) this.rows.delete(key);
      return [];
    }
    throw new Error(`Unexpected non-transaction SQL: ${sql}`);
  }

  async transaction(work) {
    let release;
    const previous = this.lock;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.rows].map(([key, value]) => [key, { ...value }]));
    const query = async (sql, values = []) => {
      if (sql.includes('INSERT INTO webmail_login_limits')) {
        const [key] = values;
        if (!this.rows.has(key)) this.rows.set(key, { failure_count: 0, reset_at: new Date(this.now + 15 * 60_000) });
        return [];
      }
      if (sql.includes('SELECT failure_count,reset_at')) {
        const row = this.rows.get(values[0]);
        return row ? [{ ...row, locked_now: new Date(this.now) }] : [];
      }
      if (sql.includes('UPDATE webmail_login_limits SET failure_count=1')) {
        const row = this.rows.get(values[0]);
        this.rows.set(values[0], { failure_count: 1, reset_at: new Date(this.now + 15 * 60_000) });
        assert.ok(row);
        return [];
      }
      if (sql.includes('UPDATE webmail_login_limits SET failure_count=failure_count+1')) {
        const row = this.rows.get(values[0]);
        assert.ok(row);
        this.rows.set(values[0], { ...row, failure_count: row.failure_count + 1 });
        return [];
      }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    };
    try { return await work(query); }
    catch (error) { this.rows = snapshot; throw error; }
    finally { release(); }
  }
}

function setImapResult(service, succeeds) {
  let connections = 0;
  service.makeClient = () => ({
    connect: async () => {
      connections++;
      if (!succeeds) throw new Error('IMAP authentication failed');
    },
    logout: async () => undefined,
  });
  return () => connections;
}

async function main() {
  const database = new FakeDatabase();
  const instances = [new WebmailService(database), new WebmailService(database)];
  const connectionCounts = instances.map(instance => setImapResult(instance, false));
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
    instances[index % instances.length].login('User@example.test', 'wrong-password', '203.0.113.8')));
  assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.getStatus() === 401).length, 8);
  assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason.getStatus() === 429).length, 12);
  assert.equal(connectionCounts.reduce((sum, count) => sum + count(), 0), 8, 'blocked attempts must not reach IMAP');
  assert.equal(database.rows.size, 3, 'only hashed IP/account/pair buckets should be persisted');
  for (const [key, row] of database.rows) {
    assert.match(key, /^webmail:[a-f0-9]{64}$/);
    assert.equal(row.failure_count, 8);
  }

  const afterRestart = new WebmailService(database);
  const restartedConnections = setImapResult(afterRestart, false);
  await assert.rejects(() => afterRestart.login('user@example.test', 'wrong-password', '203.0.113.8'), error => error.getStatus() === 429);
  assert.equal(restartedConnections(), 0, 'a new API instance must observe the shared lockout');

  database.now += 15 * 60_000 + 1;
  await assert.rejects(() => afterRestart.login('user@example.test', 'wrong-password', '203.0.113.8'), error => error.getStatus() === 401);
  for (const row of database.rows.values()) assert.equal(row.failure_count, 1, 'expired windows must restart with one reserved attempt');

  const successful = new WebmailService(database);
  setImapResult(successful, true);
  await successful.login('user@example.test', 'correct-password', '203.0.113.8');
  assert.equal(database.rows.size, 0, 'successful authentication clears shared failure buckets');

  const memory = new WebmailService();
  const memoryConnections = setImapResult(memory, false);
  for (let i = 0; i < 8; i++) {
    await assert.rejects(() => memory.login('local@example.test', 'wrong-password', '127.0.0.1'), error => error.getStatus() === 401);
  }
  await assert.rejects(() => memory.login('local@example.test', 'wrong-password', '127.0.0.1'), error => error.getStatus() === 429);
  assert.equal(memoryConnections(), 8, 'the local fallback must keep the same threshold');

  const unavailable = { query: async () => { throw new Error('database offline'); } };
  const failClosed = new WebmailService(unavailable);
  const failClosedConnections = setImapResult(failClosed, false);
  await assert.rejects(() => failClosed.login('offline@example.test', 'wrong-password', '127.0.0.1'), error => error.getStatus() === 503);
  assert.equal(failClosedConnections(), 0, 'login must fail closed when a configured database cannot enforce limits');

  console.log('Webmail login rate smoke checks passed: shared transactional limits, restart persistence, expiry, success reset, local fallback, and fail-closed database errors.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
