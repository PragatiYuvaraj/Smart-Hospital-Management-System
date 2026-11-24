'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const testDir = __dirname;
const databaseIntegrationTests = new Set([
  'milestone6-live-integration.test.js',
  'security-remediations.test.js',
  'seed-verification.test.js'
]);
const { getDedicatedTestDatabaseUri } = require('./test-database-guard');
const testDatabaseUri = getDedicatedTestDatabaseUri();
const testFiles = fs.readdirSync(testDir)
  .filter((file) => file.endsWith('.test.js'))
  .filter((file) => testDatabaseUri || !databaseIntegrationTests.has(file));

if (!testDatabaseUri) {
  const skipped = [...databaseIntegrationTests].join(', ');
  console.log(`[Test Runner] Skipping database integration tests; configure MONGODB_TEST_URI with a separate test database to enable them: ${skipped}`);
}

let failed = false;
for (const file of testFiles) {
  const result = spawnSync(process.execPath, [path.join(testDir, file)], {
    cwd: path.resolve(testDir, '..'),
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`[Test Runner] Could not start ${file}: ${result.error.message}`);
    failed = true;
  } else if (result.status !== 0) {
    console.error(`[Test Runner] ${file} failed with status ${result.status}.`);
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
