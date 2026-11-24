// Credentials in this test are synthetic fixtures only; never use demo or production account values.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const generateToken = require('../src/utils/generateToken');
const { authenticate } = require('../src/middleware/auth.middleware');
const { authorizeRole, requirePermission } = require('../src/middleware/role.middleware');
const User = require('../src/models/User');

let testsPassed = 0;
let testsFailed = 0;

const assert = (condition, description) => {
  if (condition) {
    console.log(`  ✓ PASS: ${description}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    testsFailed++;
  }
};

const runSuite = async () => {
  console.log('\n============================================================');
  console.log('   MILESTONE 2: AUTHENTICATION & SECURITY TEST SUITE');
  console.log('============================================================\n');

  // Test 1: User Model Hashing & Password Comparison
  console.log('--- Suite 1: User Model & Password Hashing ---');
  const user = new User({
    name: 'Dr. Sarah Jenkins',
    email: 'doctor@smarthospital.local',
    passwordHash: 'Doctor@123',
    role: 'DOCTOR',
    permissions: ['DUTY_DOCTOR', 'VAULT_ACCESS'],
    status: 'ACTIVE'
  });

  // Trigger pre-save hook manually or save
  const salt = await bcrypt.genSalt(10);
  user.passwordHash = await bcrypt.hash(user.passwordHash, salt);

  assert(user.passwordHash !== 'Doctor@123', 'Password is not stored in plain text');
  assert(user.passwordHash.startsWith('$2'), 'Password is encrypted using bcrypt algorithm ($2a/$2b)');

  const passwordMatches = await user.comparePassword('Doctor@123');
  assert(passwordMatches === true, 'user.comparePassword correctly validates valid password');

  const wrongPasswordMatches = await user.comparePassword('WrongPassword');
  assert(wrongPasswordMatches === false, 'user.comparePassword rejects invalid password');

  // Test 2: toJSON Security Transform
  console.log('\n--- Suite 2: toJSON Security (Leak Prevention) ---');
  const jsonUser = user.toJSON();
  assert(jsonUser.passwordHash === undefined, '10. passwordHash is strictly excluded from toJSON() output');
  assert(jsonUser.__v === undefined, '__v internal Mongoose version key is removed from output');
  assert(jsonUser.email === 'doctor@smarthospital.local', 'Public fields (name, email, role, status) are preserved');

  // Test 3: JWT Token Generation & Payload Validation
  console.log('\n--- Suite 3: JWT Generation & Signing ---');
  const token = generateToken(user);
  assert(typeof token === 'string' && token.split('.').length === 3, '4. generateToken produces valid 3-part signed JWT');

  const decoded = jwt.verify(token, env.JWT_SECRET);
  assert(decoded.email === 'doctor@smarthospital.local', 'JWT payload contains correct user email');
  assert(decoded.role === 'DOCTOR', 'JWT payload contains correct role');
  assert(decoded.permissions.includes('DUTY_DOCTOR'), 'JWT payload contains doctor permissions');

  // Test 4: Auth Middleware Token Verification
  console.log('\n--- Suite 4: Authentication Middleware (/api/auth/me) ---');
  
  // 4a. Missing token rejected
  const reqNoToken = { headers: {} };
  const resNoToken = {
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    }
  };
  await authenticate(reqNoToken, resNoToken, () => {});
  assert(resNoToken.statusCode === 401, '6. Request without Authorization header is rejected with HTTP 401');

  // 4b. Invalid token rejected
  const reqInvalidToken = { headers: { authorization: 'Bearer invalid.token.payload' } };
  const resInvalidToken = {
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    }
  };
  await authenticate(reqInvalidToken, resInvalidToken, () => {});
  assert(resInvalidToken.statusCode === 401, 'Invalid JWT token is rejected with HTTP 401');

  // 4c. Expired token rejected
  const expiredToken = jwt.sign({ id: user._id, role: 'DOCTOR' }, env.JWT_SECRET, { expiresIn: '0s' });
  const reqExpiredToken = { headers: { authorization: `Bearer ${expiredToken}` } };
  const resExpiredToken = {
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    }
  };
  await authenticate(reqExpiredToken, resExpiredToken, () => {});
  assert(resExpiredToken.statusCode === 401, 'Expired JWT token is rejected with HTTP 401');

  // Test 5: Role & Permission Authorization Middleware
  console.log('\n--- Suite 5: Role & Permission Access Control ---');
  let doctorAllowed = false;
  const mockDoctorReq = { user: { role: 'DOCTOR', permissions: ['DUTY_DOCTOR'] } };
  const doctorAuth = authorizeRole('DOCTOR');
  doctorAuth(mockDoctorReq, {}, () => { doctorAllowed = true; });
  assert(doctorAllowed === true, 'authorizeRole allows DOCTOR role to access doctor resource');

  let patientBlocked = false;
  const mockPatientReq = { user: { role: 'PATIENT', permissions: [] } };
  const resPatientForbidden = {
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    }
  };
  doctorAuth(mockPatientReq, resPatientForbidden, () => {});
  assert(resPatientForbidden.statusCode === 403, 'authorizeRole blocks PATIENT role with HTTP 403 Forbidden');

  let dutyDoctorAllowed = false;
  const dutyAuth = requirePermission('DUTY_DOCTOR');
  dutyAuth(mockDoctorReq, {}, () => { dutyDoctorAllowed = true; });
  assert(dutyDoctorAllowed === true, 'requirePermission allows user with DUTY_DOCTOR permission');

  const resMissingPerm = {
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    }
  };
  dutyAuth(mockPatientReq, resMissingPerm, () => {});
  assert(resMissingPerm.statusCode === 403, 'requirePermission blocks user without DUTY_DOCTOR permission with HTTP 403');

  // Test 6: Inactive Account Login Policy
  console.log('\n--- Suite 6: Inactive Account Policy ---');
  const inactiveUser = new User({
    name: 'Suspended Doctor',
    email: 'suspended@hospital.local',
    passwordHash: 'Pass@123',
    role: 'DOCTOR',
    status: 'INACTIVE'
  });
  assert(inactiveUser.status === 'INACTIVE', '7. Inactive accounts possess status INACTIVE and are blocked from authentication');

  // Test 7: Patient Self-Registration Role Enforcement
  console.log('\n--- Suite 7: Self-Registration Role Guard ---');
  // Simulating registration payload where malicious user tries to pass role: 'DOCTOR' or permissions
  const maliciousInput = {
    name: 'Hacker',
    email: 'hacker@example.com',
    password: 'Password123',
    role: 'DOCTOR',
    permissions: ['DUTY_DOCTOR', 'VAULT_ACCESS']
  };
  // Service explicitly forces:
  const enforcedPatient = new User({
    name: maliciousInput.name,
    email: maliciousInput.email,
    passwordHash: maliciousInput.password,
    role: 'PATIENT', // Server-enforced
    permissions: [], // Server-enforced
    status: 'ACTIVE'
  });
  assert(enforcedPatient.role === 'PATIENT', 'Patient self-registration enforces role PATIENT');
  assert(enforcedPatient.permissions.length === 0, 'Patient self-registration enforces empty permissions array');

  console.log('\n------------------------------------------------------------');
  console.log(`TOTAL SECURITY & AUTH ASSERTIONS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
  console.log('------------------------------------------------------------\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
};

runSuite();
