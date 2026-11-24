'use strict';

const assert = require('assert');
const { getDedicatedTestDatabaseUri } = require('./test-database-guard');

const testUri = 'mongodb://localhost:27017/smart_hospital_test?authSource=admin';

assert.strictEqual(
  getDedicatedTestDatabaseUri({ testUri: '', normalUri: 'mongodb://localhost:27017/smart_hospital' }),
  null,
  'Database integration tests are disabled when no dedicated URI is supplied'
);

assert.strictEqual(
  getDedicatedTestDatabaseUri({
    testUri,
    normalUri: 'mongodb://localhost:27017/smart_hospital'
  }),
  testUri,
  'A separate database with a test marker is accepted'
);

assert.throws(
  () => getDedicatedTestDatabaseUri({
    testUri: 'mongodb://localhost:27017/smart_hospital',
    normalUri: 'mongodb://localhost:27017/smart_hospital'
  }),
  /dedicated database/
);

assert.throws(
  () => getDedicatedTestDatabaseUri({
    testUri: 'mongodb://localhost:27017/smart_hospital_test',
    normalUri: 'mongodb://localhost:27017/smart_hospital_test'
  }),
  /configured application database/
);

assert.throws(
  () => getDedicatedTestDatabaseUri({
    testUri: 'mongodb://localhost:27017/',
    normalUri: 'mongodb://localhost:27017/smart_hospital'
  }),
  /must identify a database/
);

assert.throws(
  () => getDedicatedTestDatabaseUri({
    testUri: 'https://example.test/smart_hospital_test',
    normalUri: 'mongodb://localhost:27017/smart_hospital'
  }),
  /mongodb:\/\/ or mongodb\+srv:\/\//
);

console.log('Dedicated test database guard: 6 assertions passed');
