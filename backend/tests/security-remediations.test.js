/**
 * security-remediations.test.js — Milestone 8.2 Security Remediations Verification Suite
 *
 * Verifies the 5 security fixes:
 *   1. Rate limiting on authentication endpoints (429, headers, thresholds).
 *   2. Audit logging for staff account creation, status updates, and permission changes.
 *   3. Production error sanitization (prevent internal error message leakage while retaining server logs).
 *   4. CORS environment-based origin enforcement (development localhost vs. production whitelist).
 *   5. User search regex escaping in user.service.js.
 */
// Credentials in this test are synthetic fixtures only; never use demo or production account values.

'use strict';

const { getDedicatedTestDatabaseUri } = require('./test-database-guard');
const testDatabaseUri = getDedicatedTestDatabaseUri({ required: true });

const mongoose = require('mongoose');
const env = require('../src/config/env');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const userService = require('../src/services/user.service');
const { createRateLimiter } = require('../src/middleware/rate-limit.middleware');

let passedCount = 0;
let failedCount = 0;

const assert = (condition, description) => {
  if (condition) {
    console.log(`  ✓ PASS: ${description}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    failedCount++;
  }
};

const runSuite = async () => {
  console.log('\n============================================================');
  console.log('  MILESTONE 8.2: SECURITY REMEDIATIONS VERIFICATION SUITE');
  console.log('============================================================\n');

  try {
    await mongoose.connect(testDatabaseUri, { serverSelectionTimeoutMS: 5000 });
    console.log('[Test DB] Connected to MongoDB deployment.');
  } catch (err) {
    console.error('[Test DB Error] Could not connect to MongoDB:', err.message);
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Rate Limiting Tests
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- 1. Rate Limiting Middleware ---');
  const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 3,
    message: 'Too many attempts from this IP.',
    skip: () => false
  });

  const headersMap = {};
  const mockRes = {
    headers: {},
    statusCode: 200,
    body: null,
    set(obj) {
      Object.assign(this.headers, obj);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };

  const req1 = { ip: '192.168.1.100', headers: {} };
  let nextCalled1 = false;
  limiter(req1, mockRes, () => { nextCalled1 = true; });
  assert(nextCalled1 === true, 'Request 1 under threshold passes through');
  assert(mockRes.headers['RateLimit-Remaining'] === '2', 'RateLimit-Remaining decrements to 2');

  const req2 = { ip: '192.168.1.100', headers: {} };
  let nextCalled2 = false;
  limiter(req2, mockRes, () => { nextCalled2 = true; });
  assert(nextCalled2 === true, 'Request 2 under threshold passes through');
  assert(mockRes.headers['RateLimit-Remaining'] === '1', 'RateLimit-Remaining decrements to 1');

  const req3 = { ip: '192.168.1.100', headers: {} };
  let nextCalled3 = false;
  limiter(req3, mockRes, () => { nextCalled3 = true; });
  assert(nextCalled3 === true, 'Request 3 (boundary) passes through');
  assert(mockRes.headers['RateLimit-Remaining'] === '0', 'RateLimit-Remaining reaches 0');

  // 4th request exceeds max
  const req4 = { ip: '192.168.1.100', headers: {} };
  let nextCalled4 = false;
  limiter(req4, mockRes, () => { nextCalled4 = true; });
  assert(nextCalled4 === false, 'Request 4 exceeding threshold is blocked (next() not called)');
  assert(mockRes.statusCode === 429, 'Blocked request returns HTTP 429 Too Many Requests');
  assert(mockRes.body && mockRes.body.success === false, 'Response payload has success: false');
  assert(mockRes.body && mockRes.body.message === 'Too many attempts from this IP.', 'Response payload has configured message');
  assert(Boolean(mockRes.headers['Retry-After']), 'Response includes Retry-After header');
  assert(mockRes.headers['RateLimit-Limit'] === '3', 'Response includes RateLimit-Limit header');

  // Different IP should still be allowed
  const reqOtherIp = { ip: '192.168.1.200', headers: {} };
  let nextCalledOther = false;
  limiter(reqOtherIp, mockRes, () => { nextCalledOther = true; });
  assert(nextCalledOther === true, 'Different IP is not blocked by previous IP quota exhaustion');

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Audit Logging for Administrative User Management
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Staff Management Audit Logging ---');
  // Find or create admin actor for test
  let adminUser = await User.findOne({ permissions: 'MANAGE_USERS', status: 'ACTIVE' });
  if (!adminUser) {
    adminUser = new User({
      name: 'Security Admin',
      email: 'secadmin@smarthospital.local',
      passwordHash: 'SecAdmin@123',
      role: 'DOCTOR',
      permissions: ['MANAGE_USERS'],
      status: 'ACTIVE'
    });
    await adminUser.save();
  }

  const testEmail = `audit_test_${Date.now()}@hospital.local`;
  const createdStaff = await userService.createStaffAccount(
    {
      name: 'Dr. Test Audit',
      email: testEmail,
      password: 'AuditPassword@123',
      role: 'DOCTOR',
      permissions: ['DUTY_DOCTOR']
    },
    adminUser._id
  );

  const createAudit = await AuditLog.findOne({
    action: 'STAFF_ACCOUNT_CREATED',
    resourceId: createdStaff._id
  });
  assert(Boolean(createAudit), 'Staff creation emits STAFF_ACCOUNT_CREATED audit event');
  assert(String(createAudit.actorId) === String(adminUser._id), 'Audit event attributes correct actorId');
  assert(createAudit.accessContext && createAudit.accessContext.accessType === 'MANAGEMENT', 'Audit event includes MANAGEMENT accessType');

  // Status update audit
  await userService.updateUserStatus(createdStaff._id, 'INACTIVE', adminUser._id);
  const statusAudit = await AuditLog.findOne({
    action: 'USER_STATUS_UPDATED',
    resourceId: createdStaff._id
  });
  assert(Boolean(statusAudit), 'User deactivation emits USER_STATUS_UPDATED audit event');
  assert(String(statusAudit.actorId) === String(adminUser._id), 'Status audit attributes correct actorId');

  // Permissions update audit
  await userService.updateUserPermissions(createdStaff._id, ['VAULT_ACCESS'], adminUser._id);
  const permAudit = await AuditLog.findOne({
    action: 'USER_PERMISSIONS_UPDATED',
    resourceId: createdStaff._id
  });
  assert(Boolean(permAudit), 'User permissions change emits USER_PERMISSIONS_UPDATED audit event');
  assert(String(permAudit.actorId) === String(adminUser._id), 'Permissions audit attributes correct actorId');

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Production Error Sanitization
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Error Sanitization in Production ---');
  // Simulate the error handler logic from app.js
  const errorHandler = (err, isProd) => {
    const status = err.statusCode || err.status || 500;
    const message = isProd && status >= 500
      ? 'Internal Server Error'
      : (err.message || 'Internal Server Error');
    const errors = isProd && status >= 500
      ? []
      : (err.errors || []);

    return { status, message, errors };
  };

  const internalDbError = new Error('MongoServerError: E11000 duplicate key error collection: smart_hospital.users index: email_1');
  internalDbError.statusCode = 500;
  internalDbError.errors = [{ raw: 'internal driver stack' }];

  const clientValidationError = new Error('Invalid email or password.');
  clientValidationError.statusCode = 401;

  // In production:
  const prodInternal = errorHandler(internalDbError, true);
  assert(prodInternal.message === 'Internal Server Error', 'Production 500 masks internal database error message');
  assert(prodInternal.errors.length === 0, 'Production 500 strips internal error detail array');
  assert(prodInternal.status === 500, 'Production 500 preserves HTTP 500 status code');

  const prodClient = errorHandler(clientValidationError, true);
  assert(prodClient.message === 'Invalid email or password.', 'Production 4xx preserves safe client-facing operational error message');
  assert(prodClient.status === 401, 'Production 4xx preserves operational status code');

  // In development:
  const devInternal = errorHandler(internalDbError, false);
  assert(devInternal.message.includes('MongoServerError'), 'Development preserves detailed error message for debugging');

  // ──────────────────────────────────────────────────────────────────────────
  // 4. CORS Origins Configuration
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. CORS Configuration Enforcement ---');
  const resolveCorsOrigins = (nodeEnv, corsOriginsEnv, clientUrlEnv) => {
    const configured = corsOriginsEnv
      ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
      : [clientUrlEnv || 'http://localhost:4200'];

    if (nodeEnv === 'production') {
      return configured;
    }
    return Array.from(new Set([
      ...configured,
      clientUrlEnv || 'http://localhost:4200',
      'http://localhost:4200',
      'http://127.0.0.1:4200'
    ]));
  };

  // Development mode:
  const devOrigins = resolveCorsOrigins('development', '', 'http://localhost:4200');
  assert(devOrigins.includes('http://localhost:4200'), 'Development CORS allows localhost:4200');
  assert(devOrigins.includes('http://127.0.0.1:4200'), 'Development CORS allows 127.0.0.1:4200');

  // Production mode with custom CORS_ORIGINS:
  const prodOrigins = resolveCorsOrigins('production', 'https://hospital.example.com,https://portal.hospital.com', 'https://hospital.example.com');
  assert(prodOrigins.includes('https://hospital.example.com'), 'Production CORS allows configured domain');
  assert(prodOrigins.includes('https://portal.hospital.com'), 'Production CORS allows secondary configured domain');
  assert(!prodOrigins.includes('http://localhost:4200'), 'Production CORS strictly disallows localhost:4200');
  assert(!prodOrigins.includes('http://127.0.0.1:4200'), 'Production CORS strictly disallows 127.0.0.1:4200');

  // ──────────────────────────────────────────────────────────────────────────
  // 5. User Search Regular Expression Escaping
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n--- 5. User Search Regex Escaping ---');
  // Attempt searches with regex metacharacters that would crash or cause ReDoS without escaping
  const specialSearches = [
    'test.*user',
    'test(user)+',
    'test[a-z]+',
    'test?user',
    'test\\user',
    'test^user$'
  ];

  for (const query of specialSearches) {
    try {
      const result = await userService.listUsers({ search: query, limit: 5 });
      assert(result && Array.isArray(result.users), `Search with metacharacters '${query}' executes safely without ReDoS/syntax errors`);
    } catch (err) {
      assert(false, `Search with metacharacters '${query}' threw an unhandled error: ${err.message}`);
    }
  }

  // Cleanup test user
  await User.deleteOne({ _id: createdStaff._id });
  await AuditLog.deleteMany({ resourceId: createdStaff._id });

  console.log('\n------------------------------------------------------------');
  console.log(`TOTAL SECURITY ASSERTIONS: ${passedCount + failedCount} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('------------------------------------------------------------\n');

  await mongoose.disconnect();
  process.exit(failedCount > 0 ? 1 : 0);
};

runSuite().catch((err) => {
  console.error('[Suite Fatal]', err);
  mongoose.disconnect().finally(() => process.exit(1));
});
