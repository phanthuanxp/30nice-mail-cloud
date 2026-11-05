const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
async function migrate(connectionString, directory = path.join(__dirname, '../infra/db')) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('30nice-schema-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const files = fs.readdirSync(directory).filter(file => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(directory, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const result = await client.query('SELECT checksum FROM schema_migrations WHERE filename=$1', [file]);
      if (result.rows.length) {
        if (result.rows[0].checksum !== checksum) throw new Error('Previously applied migration was modified: ' + file);
        continue;
      }
      // Historical migration 005 includes its own transaction boundaries.
      const body = sql.replace(/^\s*BEGIN\s*;/i, '').replace(/COMMIT\s*;\s*$/i, '');
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query("SET LOCAL statement_timeout='60s'");
        await client.query(body);
        await client.query('INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)', [file, checksum]);
        await client.query('COMMIT');
        console.log('Applied migration: ' + file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally { await client.end(); }
}
module.exports = { migrate };
if (require.main === module) {
  let connection = process.env.DATABASE_URL;
  if (!connection && fs.existsSync('/opt/30nice-mail-cloud/.env.prod')) {
    const line = fs.readFileSync('/opt/30nice-mail-cloud/.env.prod', 'utf8').split(/\r?\n/).find(line => line.startsWith('DATABASE_URL='));
    connection = line?.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
  }
  migrate(connection).catch(error => { console.error('Migration failed:', error.code || error.message); process.exitCode = 1; });
}
