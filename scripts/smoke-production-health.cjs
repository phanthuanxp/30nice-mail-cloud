const assert = require('node:assert/strict');
const { isProductionHealthy } = require('./check-production-health.cjs');
const healthy = { status: 'ok', productionReady: true, mailAdapter: 'production', database: { configured: true, connected: true }, mailcow: { mode: 'production', configured: true, healthy: true } };
assert.equal(isProductionHealthy(healthy), true);
for (const value of [null, {}, { status: 'ok' }, { ...healthy, status: 'degraded' }, { ...healthy, productionReady: false }, { ...healthy, mailAdapter: 'mock' }, { ...healthy, database: { configured: true, connected: false } }, { ...healthy, database: { connected: true } }, { ...healthy, mailcow: { ...healthy.mailcow, mode: 'dry-run' } }, { ...healthy, mailcow: { ...healthy.mailcow, healthy: false } }, { ...healthy, mailcow: { ...healthy.mailcow, configured: false } }]) {
  assert.equal(isProductionHealthy(value), false, 'unready or incomplete health must fail deployment');
}
console.log('Production health gate checks passed: only fully configured production dependencies are accepted.');
