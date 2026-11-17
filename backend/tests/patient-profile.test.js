'use strict';

const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Patient = require('../src/models/Patient');
const generateToken = require('../src/utils/generateToken');

const originalFindById = User.findById;
const originalFindOne = Patient.findOne;
const originalFindOneAndUpdate = Patient.findOneAndUpdate;

const users = new Map();
const patients = new Map();
let passed = 0;
let failed = 0;

const assertTest = (condition, description) => {
  if (condition) {
    passed++;
    console.log(`  PASS: ${description}`);
  } else {
    failed++;
    console.error(`  FAIL: ${description}`);
  }
};

const asDocument = (record) => ({
  ...record,
  toJSON() {
    const copy = { ...this };
    delete copy.toJSON;
    return copy;
  }
});

const createUser = ({ role, email }) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name: `${role} User`,
    email,
    role,
    permissions: role === 'DOCTOR' ? ['DUTY_DOCTOR'] : [],
    status: 'ACTIVE'
  };
  users.set(String(user._id), user);
  return user;
};

const createPatient = (user, overrides = {}) => {
  const patient = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    patientNumber: 'PAT-ABCDEF0123456789',
    name: 'Demo Patient',
    dateOfBirth: new Date('1990-04-12'),
    contactNumber: '0770000000',
    address: '12 Ward Street',
    status: 'ACTIVE',
    ...overrides
  };
  patients.set(String(user._id), patient);
  return patient;
};

User.findById = async (id) => users.get(String(id)) || null;

Patient.findOne = async ({ userId }) => {
  const patient = patients.get(String(userId));
  return patient ? asDocument(patient) : null;
};

Patient.findOneAndUpdate = async ({ userId }, update) => {
  const patient = patients.get(String(userId));
  if (!patient) {
    return null;
  }
  Object.assign(patient, update.$set);
  return asDocument(patient);
};

const request = (method, path, { token, body } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({
            statusCode: res.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });

let server;

const runTests = async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    console.log('\n--- Patient self-service profile APIs ---');

    const patientUser = createUser({
      role: 'PATIENT',
      email: 'patient.profile@example.test'
    });
    const profile = createPatient(patientUser);
    const token = generateToken(patientUser);

    const viewed = await request('GET', '/api/patients/me', { token });
    assertTest(viewed.statusCode === 200, 'Authenticated patient can view own profile');
    assertTest(
      viewed.body.data.patient.patientNumber === profile.patientNumber &&
        String(viewed.body.data.patient.userId) === String(patientUser._id),
      'Profile response belongs to the authenticated patient'
    );
    assertTest(
      !Object.prototype.hasOwnProperty.call(viewed.body.data.patient, 'passwordHash'),
      'Profile response does not include passwordHash'
    );

    const updated = await request('PATCH', '/api/patients/me', {
      token,
      body: {
        contactNumber: ' 0771234567 ',
        address: ' 45 Clinic Road '
      }
    });
    assertTest(updated.statusCode === 200, 'Patient can update contactNumber and address');
    assertTest(
      updated.body.data.patient.contactNumber === '0771234567' &&
        updated.body.data.patient.address === '45 Clinic Road',
      'Allowed profile fields are trimmed and saved'
    );

    const beforeRestricted = {
      name: patients.get(String(patientUser._id)).name,
      patientNumber: patients.get(String(patientUser._id)).patientNumber,
      status: patients.get(String(patientUser._id)).status
    };
    const restricted = await request('PATCH', '/api/patients/me', {
      token,
      body: {
        name: 'Changed Name',
        userId: new mongoose.Types.ObjectId().toString(),
        patientNumber: 'PAT-CLIENT',
        dateOfBirth: '2001-01-01',
        status: 'INACTIVE',
        role: 'DOCTOR',
        permissions: ['DUTY_DOCTOR'],
        contactNumber: '0999999999'
      }
    });
    const afterRestricted = patients.get(String(patientUser._id));
    assertTest(restricted.statusCode === 400, 'Patient cannot modify restricted fields');
    assertTest(
      afterRestricted.name === beforeRestricted.name &&
        afterRestricted.patientNumber === beforeRestricted.patientNumber &&
        afterRestricted.status === beforeRestricted.status &&
        String(afterRestricted.userId) === String(patientUser._id) &&
        afterRestricted.contactNumber === '0771234567',
      'Rejected update leaves the stored profile unchanged'
    );

    const unauthenticated = await request('GET', '/api/patients/me');
    assertTest(unauthenticated.statusCode === 401, 'Unauthenticated requests are rejected');

    const doctor = createUser({ role: 'DOCTOR', email: 'doctor.profile@example.test' });
    const pharmacy = createUser({ role: 'PHARMACY', email: 'pharmacy.profile@example.test' });
    const doctorResponse = await request('GET', '/api/patients/me', {
      token: generateToken(doctor)
    });
    const pharmacyResponse = await request('PATCH', '/api/patients/me', {
      token: generateToken(pharmacy),
      body: { contactNumber: '0110000000' }
    });
    assertTest(
      doctorResponse.statusCode === 403 && pharmacyResponse.statusCode === 403,
      'DOCTOR and PHARMACY cannot access patient self-service endpoints'
    );

    const missingUser = createUser({
      role: 'PATIENT',
      email: 'missing.profile@example.test'
    });
    const missing = await request('GET', '/api/patients/me', {
      token: generateToken(missingUser)
    });
    assertTest(missing.statusCode === 404, 'Missing patient profile returns 404');

    const invalid = await request('PATCH', '/api/patients/me', {
      token,
      body: { contactNumber: '1'.repeat(31), address: 45 }
    });
    assertTest(invalid.statusCode === 400, 'Invalid input is rejected');
    assertTest(
      patients.get(String(patientUser._id)).contactNumber === '0771234567',
      'Invalid input does not change the stored profile'
    );
  } finally {
    User.findById = originalFindById;
    Patient.findOne = originalFindOne;
    Patient.findOneAndUpdate = originalFindOneAndUpdate;
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\nProfile assertions: ${passed + failed} | Passed: ${passed} | Failed: ${failed}\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
};

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
