'use strict';

const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Doctor = require('../src/models/Doctor');
const generateToken = require('../src/utils/generateToken');

const originalFindById = User.findById;
const originalDoctorFindOne = Doctor.findOne;
const originalDoctorFindById = Doctor.findById;
const originalDoctorSave = Doctor.prototype.save;

const users = new Map();
const doctors = new Map();
let passed = 0;
let failed = 0;
let server;

const assertTest = (condition, description) => {
  if (condition) {
    passed++;
    console.log(`  PASS: ${description}`);
  } else {
    failed++;
    console.error(`  FAIL: ${description}`);
  }
};

const createUser = ({ role, email, permissions = [], status = 'ACTIVE', name }) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name: name || `${role} User`,
    email,
    role,
    permissions,
    status
  };
  users.set(String(user._id), user);
  return user;
};

User.findById = async (id) => users.get(String(id)) || null;

Doctor.findOne = async (filter = {}) =>
  Array.from(doctors.values()).find((doctor) => String(doctor.userId) === String(filter.userId)) ||
  null;

Doctor.findById = async (id) => doctors.get(String(id)) || null;

Doctor.prototype.save = async function saveDoctor() {
  doctors.set(String(this._id), this);
  return this;
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

const profileBody = (userId, department = 'Cardiology') => ({
  userId: String(userId),
  specialization: 'Cardiology',
  registrationReference: 'SLMC-1001',
  department
});

const runTests = async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    console.log('\n--- Doctor profile management APIs ---');

    const manager = createUser({
      role: 'DOCTOR',
      email: 'cmo@example.test',
      name: 'Chief Medical Officer',
      permissions: ['MANAGE_USERS']
    });
    const doctor = createUser({
      role: 'DOCTOR',
      email: 'doctor.one@example.test',
      name: 'Dr. One'
    });
    const otherDoctor = createUser({
      role: 'DOCTOR',
      email: 'doctor.two@example.test',
      name: 'Dr. Two'
    });
    const patient = createUser({
      role: 'PATIENT',
      email: 'patient@example.test',
      name: 'Pat Example'
    });
    const pharmacy = createUser({
      role: 'PHARMACY',
      email: 'pharmacy@example.test',
      name: 'Pharmacy Desk'
    });
    const inactiveDoctor = createUser({
      role: 'DOCTOR',
      email: 'inactive.doctor@example.test',
      name: 'Dr. Inactive',
      status: 'INACTIVE'
    });
    const userCount = users.size;
    const managerToken = generateToken(manager);

    const created = await request('POST', '/api/doctors', {
      token: managerToken,
      body: profileBody(doctor._id)
    });
    const createdDoctor = created.body && created.body.data && created.body.data.doctor;
    assertTest(
      created.statusCode === 201 &&
        createdDoctor.name === 'Dr. One' &&
        /^DOC-[0-9A-F]{16}$/.test(createdDoctor.doctorNumber) &&
        users.size === userCount,
      'Management creates a doctor profile for an existing DOCTOR account'
    );
    assertTest(
      createdDoctor && !Object.prototype.hasOwnProperty.call(createdDoctor, 'passwordHash'),
      'Created doctor profile does not include passwordHash'
    );

    const missingUser = await request('POST', '/api/doctors', {
      token: managerToken,
      body: profileBody(new mongoose.Types.ObjectId())
    });
    assertTest(missingUser.statusCode === 404, 'Nonexistent User ID is rejected');

    const patientProfile = await request('POST', '/api/doctors', {
      token: managerToken,
      body: profileBody(patient._id)
    });
    assertTest(patientProfile.statusCode === 400, 'PATIENT account cannot receive a doctor profile');

    const inactive = await request('POST', '/api/doctors', {
      token: managerToken,
      body: profileBody(inactiveDoctor._id, 'Oncology')
    });
    assertTest(inactive.statusCode === 403, 'Inactive DOCTOR account cannot receive a doctor profile');

    const duplicate = await request('POST', '/api/doctors', {
      token: managerToken,
      body: profileBody(doctor._id, 'Neurology')
    });
    assertTest(duplicate.statusCode === 409, 'Duplicate doctor profile is rejected');

    const own = await request('GET', '/api/doctors/me', { token: generateToken(doctor) });
    assertTest(
      own.statusCode === 200 && own.body.data.doctor.doctorNumber === createdDoctor.doctorNumber,
      'Doctor can view own profile'
    );

    const second = await request('POST', '/api/doctors', {
      token: managerToken,
      body: profileBody(otherDoctor._id, 'Pediatrics')
    });
    const otherId = second.body.data.doctor._id;
    const otherView = await request('GET', `/api/doctors/${otherId}`, {
      token: generateToken(doctor)
    });
    assertTest(otherView.statusCode === 403, 'Doctor cannot view another doctor profile');

    const managedView = await request('GET', `/api/doctors/${otherId}`, { token: managerToken });
    const managedUpdate = await request('PATCH', `/api/doctors/${otherId}`, {
      token: managerToken,
      body: {
        specialization: 'Paediatric Cardiology',
        registrationReference: 'SLMC-2002',
        department: 'Paediatrics'
      }
    });
    assertTest(
      managedView.statusCode === 200 &&
        managedUpdate.statusCode === 200 &&
        managedUpdate.body.data.doctor.specialization === 'Paediatric Cardiology' &&
        managedUpdate.body.data.doctor.department === 'Paediatrics',
      'Management can retrieve and update doctor profiles'
    );

    const patientCreate = await request('POST', '/api/doctors', {
      token: generateToken(patient),
      body: profileBody(otherDoctor._id)
    });
    const pharmacyUpdate = await request('PATCH', `/api/doctors/${otherId}`, {
      token: generateToken(pharmacy),
      body: { department: 'Pharmacy' }
    });
    const patientRead = await request('GET', `/api/doctors/${otherId}`, {
      token: generateToken(patient)
    });
    assertTest(
      patientCreate.statusCode === 403 &&
        pharmacyUpdate.statusCode === 403 &&
        patientRead.statusCode === 403,
      'PATIENT and PHARMACY cannot perform doctor-management operations'
    );

    const before = doctors.get(String(createdDoctor._id));
    const restricted = await request('PATCH', `/api/doctors/${createdDoctor._id}`, {
      token: managerToken,
      body: {
        userId: String(otherDoctor._id),
        doctorNumber: 'DOC-CHANGED',
        role: 'PHARMACY',
        specialization: 'Dermatology'
      }
    });
    const after = doctors.get(String(createdDoctor._id));
    assertTest(restricted.statusCode === 400, 'Restricted fields cannot be modified');
    assertTest(
      String(after.userId) === String(before.userId) &&
        after.doctorNumber === before.doctorNumber &&
        after.specialization === before.specialization,
      'Rejected doctor update leaves the stored profile unchanged'
    );
  } finally {
    User.findById = originalFindById;
    Doctor.findOne = originalDoctorFindOne;
    Doctor.findById = originalDoctorFindById;
    Doctor.prototype.save = originalDoctorSave;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log(`\nDoctor profile assertions: ${passed + failed} | Passed: ${passed} | Failed: ${failed}\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
};

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
