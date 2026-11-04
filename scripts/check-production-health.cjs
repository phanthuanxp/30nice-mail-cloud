const fs = require('node:fs');
function isProductionHealthy(value) {
  return Boolean(value && value.status === 'ok' && value.productionReady === true &&
    value.mailAdapter === 'production' && value.database?.configured === true &&
    value.database?.connected === true && value.mailcow?.mode === 'production' &&
    value.mailcow?.configured === true && value.mailcow?.healthy === true);
}
module.exports = { isProductionHealthy };
if (require.main === module) {
  try {
    if (!isProductionHealthy(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))) {
      console.error('Production health gate failed: API, database and Mailcow must all be ready.');
      process.exitCode = 1;
    }
  } catch {
    console.error('Production health gate failed: invalid or missing health response.');
    process.exitCode = 1;
  }
}
