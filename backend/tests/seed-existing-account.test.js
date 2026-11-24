'use strict';

// This unit test exercises the seed's existing-account handler without database access.
const assert = require('assert');
const { handleExistingAccount } = require('../src/scripts/seed');

const messages = [];
const account = {
  role: 'DOCTOR',
  email: 'doctor@example.test'
};

assert.strictEqual(
  handleExistingAccount(account, { _id: 'existing-id' }, { log: (message) => messages.push(message) }),
  true,
  'Existing account is handled without recreating it'
);
assert.deepStrictEqual(
  messages,
  ['[Seed] Notice: DOCTOR account (doctor@example.test) already exists. Preserving password.']
);

assert.strictEqual(
  handleExistingAccount(account, null, { log: (message) => messages.push(message) }),
  false,
  'Missing account continues to the creation path'
);
assert.strictEqual(messages.length, 1, 'Missing account does not emit the existing-account notice');

console.log('Seed existing-account assertions: 3 passed, 0 failed');
