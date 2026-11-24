'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_DATABASE_URI = 'mongodb://127.0.0.1:27017/smart_hospital';
const TEST_DATABASE_NAME = /(^|[_-])test($|[_-])/i;

function parseMongoTarget(uri, label, requireDatabase) {
  if (typeof uri !== 'string' || !uri.trim()) {
    throw new Error(`${label} must be a MongoDB connection URI.`);
  }

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`${label} is not a valid MongoDB connection URI.`);
  }

  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${label} must use mongodb:// or mongodb+srv:// and include a hostname.`);
  }

  let databaseName = '';
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error(`${label} contains an invalid database name.`);
  }

  if (databaseName.includes('/')) {
    throw new Error(`${label} must identify exactly one database.`);
  }
  if (requireDatabase && !databaseName) {
    throw new Error(`${label} must identify a database.`);
  }

  return {
    host: parsed.host.toLowerCase(),
    databaseName
  };
}

function getDedicatedTestDatabaseUri(options = {}) {
  const testUri = options.testUri === undefined
    ? process.env.MONGODB_TEST_URI
    : options.testUri;

  if (!testUri) {
    if (options.required) {
      throw new Error('MONGODB_TEST_URI is required to run database integration tests.');
    }
    return null;
  }

  const testTarget = parseMongoTarget(testUri, 'MONGODB_TEST_URI', true);
  if (!TEST_DATABASE_NAME.test(testTarget.databaseName)) {
    throw new Error('MONGODB_TEST_URI must target a dedicated database with "test" in its name.');
  }

  const normalUri = options.normalUri === undefined
    ? process.env.MONGODB_URI || DEFAULT_DATABASE_URI
    : options.normalUri;
  if (normalUri) {
    const normalTarget = parseMongoTarget(normalUri, 'MONGODB_URI', false);
    if (
      normalTarget.databaseName &&
      testTarget.host === normalTarget.host &&
      testTarget.databaseName.toLowerCase() === normalTarget.databaseName.toLowerCase()
    ) {
      throw new Error('MONGODB_TEST_URI must not target the configured application database.');
    }
  }

  return testUri;
}

module.exports = { getDedicatedTestDatabaseUri };
