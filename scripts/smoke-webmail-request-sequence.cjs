const assert = require('node:assert/strict');
const { RequestSequence } = require('../apps/portal/app/webmail/request-sequence.cjs');

const sequence = new RequestSequence();
const earlier = sequence.begin();
const latest = sequence.begin();

assert.equal(sequence.isCurrent(earlier), false, 'a newer folder or search request invalidates older responses');
assert.equal(sequence.isCurrent(latest), true, 'the newest response may update the current view');

sequence.invalidate();
assert.equal(sequence.isCurrent(latest), false, 'signing out invalidates an in-flight mailbox response');

console.log('Webmail request sequence smoke checks passed: stale view and post-logout responses are ignored.');

