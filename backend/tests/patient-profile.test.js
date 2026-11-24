'use strict';

const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Patient = require('../src/models/Patient');
const Doctor = require('../src/models/Doctor');
const DoctorAssignment = require('../src/models/DoctorAssignment');
const AuditLog = require('../src/models/AuditLog');
const generateToken = require('../src/utils/generateToken');

const originalFindById = User.findById;
const originalFindOne = Patient.findOne;
const originalPatientFind = Patient.find;
const originalPatientFindById = Patient.findById;
const originalPatientCountDocuments = Patient.countDocuments;
const originalFindOneAndUpdate = Patient.findOneAndUpdate;
const originalDoctorFindOne = Doctor.findOne;
const originalAssignmentFind = DoctorAssignment.find;
const originalAssignmentFindOne = DoctorAssignment.findOne;
const originalAuditSave = AuditLog.prototype.save;

const users = new Map();
const patients = new Map();
const doctors = new Map();
const assignments = new Map();
const auditLogs = [];
let failAuditSave = false;
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

const createUser = ({ role, email, permissions = [] }) => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name: `${role} User`,
    email,
    role,
    permissions,
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

const createDoctor = (user) => {
  const doctor = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    status: 'ACTIVE'
  };
  doctors.set(String(user._id), doctor);
  return doctor;
};

const createAssignment = (patient, doctor) => {
  const assignment = {
    _id: new mongoose.Types.ObjectId(),
    patientId: patient._id,
    doctorId: doctor._id,
    assignmentType: 'TREATING',
    status: 'ACTIVE'
  };
  assignments.set(String(assignment._id), assignment);
  return assignment;
};

const matchesPatient = (patient, filter) => {
  if (filter.$and && !filter.$and.every((item) => matchesPatient(patient, item))) {
    return false;
  }
  if (
    filter.$or &&
    !filter.$or.some((item) =>
      Object.entries(item).some(([field, expression]) =>
        expression instanceof RegExp ? expression.test(patient[field]) : false
      )
    )
  ) {
    return false;
  }
  if (filter.userId && String(patient.userId) !== String(filter.userId)) {
    return false;
  }
  if (filter._id && filter._id.$in) {
    return filter._id.$in.some((id) => String(id) === String(patient._id));
  }
  if (filter._id && String(filter._id) !== String(patient._id)) {
    return false;
  }
  return true;
};

User.findById = async (id) => users.get(String(id)) || null;

Patient.findOne = async (filter) => {
  const patient = Array.from(patients.values()).find((item) =>
    matchesPatient(item, filter)
  );
  return patient ? asDocument(patient) : null;
};

Patient.findById = async (id) =>
  Array.from(patients.values()).find((patient) => String(patient._id) === String(id)) || null;

Patient.find = (filter) => {
  let matches = Array.from(patients.values()).filter((patient) =>
    matchesPatient(patient, filter)
  );
  let skip = 0;
  let limit = matches.length;
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    skip(value) {
      skip = value;
      return this;
    },
    limit(value) {
      limit = value;
      return this;
    },
    lean() {
      matches = matches.slice(skip, skip + limit);
      return Promise.resolve(matches);
    }
  };
};

Patient.countDocuments = async (filter) =>
  Array.from(patients.values()).filter((patient) =>
    matchesPatient(patient, filter)
  ).length;

Patient.findOneAndUpdate = async ({ userId }, update) => {
  const patient = patients.get(String(userId));
  if (!patient) {
    return null;
  }
  Object.assign(patient, update.$set);
  return asDocument(patient);
};

Doctor.findOne = async ({ userId }) => doctors.get(String(userId)) || null;

const matchesAssignment = (assignment, filter) =>
  Object.entries(filter).every(([key, value]) =>
    String(assignment[key]) === String(value)
  );

DoctorAssignment.find = async (filter) =>
  Array.from(assignments.values()).filter((assignment) =>
    matchesAssignment(assignment, filter)
  );

DoctorAssignment.findOne = async (filter) =>
  Array.from(assignments.values()).find((assignment) =>
    matchesAssignment(assignment, filter)
  ) || null;

AuditLog.prototype.save = async function saveAudit() {
  if (failAuditSave) {
    throw new Error('Simulated audit persistence failure');
  }
  auditLogs.push(this);
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
    assertTest(
      auditLogs.some(
        (log) =>
          log.action === 'PATIENT_PROFILE_ACCESSED' &&
          String(log.actorId) === String(patientUser._id) &&
          String(log.resourceId) === String(profile._id) &&
          log.accessContext.accessType === 'SELF_SERVICE'
      ),
      'Patient self-profile access is audited'
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
    assertTest(
      auditLogs.some(
        (log) =>
          log.action === 'PATIENT_PROFILE_UPDATED' &&
          String(log.actorId) === String(patientUser._id) &&
          String(log.resourceId) === String(profile._id) &&
          log.outcome === 'SUCCESS'
      ),
      'Profile update audit uses the authenticated patient and profile IDs'
    );
    const auditFields = auditLogs.find((log) => log.action === 'PATIENT_PROFILE_UPDATED').toObject();
    assertTest(
      !['password', 'passwordHash', 'email', 'contactNumber', 'address'].some(
        (field) => Object.prototype.hasOwnProperty.call(auditFields, field)
      ),
      'Profile update audit excludes credentials and personal details'
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
      auditLogs.filter((log) => log.action === 'PATIENT_PROFILE_UPDATED').length === 1,
      'Rejected profile update creates no success audit entry'
    );
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
    assertTest(
      auditLogs.filter((log) => log.action === 'PATIENT_PROFILE_UPDATED').length === 1,
      'Invalid profile update creates no success audit entry'
    );

    console.log('\n--- Patient read access APIs ---');
    const otherPatientUser = createUser({
      role: 'PATIENT',
      email: 'other.patient@example.test'
    });
    const otherProfile = createPatient(otherPatientUser, {
      patientNumber: 'PAT-OTHER0123456789'
    });
    const assignedDoctorUser = createUser({
      role: 'DOCTOR',
      email: 'assigned.doctor@example.test'
    });
    const assignedDoctor = createDoctor(assignedDoctorUser);
    createAssignment(profile, assignedDoctor);
    createAssignment(otherProfile, assignedDoctor).status = 'CLOSED';
    const dutyDoctorUser = createUser({
      role: 'DOCTOR',
      email: 'duty.doctor@example.test',
      permissions: ['DUTY_DOCTOR']
    });
    createDoctor(dutyDoctorUser);
    const pharmacyUser = createUser({
      role: 'PHARMACY',
      email: 'pharmacy.read@example.test'
    });

    const patientList = await request('GET', '/api/patients', { token });
    assertTest(
      patientList.statusCode === 200 &&
        patientList.body.data.patients.length === 1 &&
        String(patientList.body.data.patients[0]._id) === String(profile._id),
      'Patient list is restricted to the authenticated patient'
    );
    assertTest(
      !Object.prototype.hasOwnProperty.call(patientList.body.data.patients[0], 'address') &&
        !Object.prototype.hasOwnProperty.call(patientList.body.data.patients[0], 'contactNumber'),
      'Patient list returns only summary fields'
    );

    const ownDetail = await request('GET', `/api/patients/${profile._id}`, { token });
    const otherDetail = await request('GET', `/api/patients/${otherProfile._id}`, { token });
    assertTest(
      ownDetail.statusCode === 200 &&
        ownDetail.body.data.patient.contactNumber === profile.contactNumber &&
        !Object.prototype.hasOwnProperty.call(ownDetail.body.data.patient, 'userId'),
      'Patient can retrieve own profile without internal account linkage'
    );
    assertTest(
      otherDetail.statusCode === 403,
      'Patient cannot retrieve another patient profile'
    );

    const assignedToken = generateToken(assignedDoctorUser);
    const assignedList = await request('GET', '/api/patients', { token: assignedToken });
    const restrictedSearch = await request(
      'GET',
      `/api/patients?search=${encodeURIComponent(otherProfile.patientNumber)}`,
      { token: assignedToken }
    );
    const assignedDetail = await request('GET', `/api/patients/${profile._id}`, {
      token: assignedToken
    });
    const unassignedDetail = await request(
      'GET',
      `/api/patients/${otherProfile._id}`,
      { token: assignedToken }
    );
    assertTest(
      assignedList.statusCode === 200 &&
        assignedList.body.data.patients.length === 1 &&
        String(assignedList.body.data.patients[0]._id) === String(profile._id) &&
        assignedDetail.statusCode === 200,
      'Treating doctor can list and retrieve actively assigned patients'
    );
    assertTest(
      unassignedDetail.statusCode === 403,
      'Treating doctor cannot retrieve an unassigned patient'
    );
    const assignedAudits = auditLogs.filter(
      (log) =>
        log.action === 'PATIENT_PROFILE_ACCESSED' &&
        String(log.actorId) === String(assignedDoctorUser._id)
    );
    assertTest(
      restrictedSearch.statusCode === 200 &&
        restrictedSearch.body.data.total === 0 &&
        assignedAudits.length === 2 &&
        assignedAudits.every((log) => log.accessContext.accessType === 'ASSIGNED_DOCTOR') &&
        assignedAudits.every((log) => String(log.resourceId) === String(profile._id)),
      'Assigned-doctor access is audited and searches stay within active assignments'
    );

    const dutyToken = generateToken(dutyDoctorUser);
    const dutyList = await request('GET', '/api/patients?limit=1&page=2', {
      token: dutyToken
    });
    const dutySearch = await request(
      'GET',
      `/api/patients?search=${encodeURIComponent(otherProfile.patientNumber)}`,
      { token: dutyToken }
    );
    const wildcardSearch = await request(
      'GET',
      `/api/patients?search=${encodeURIComponent('.*')}`,
      { token: dutyToken }
    );
    const dutyDetail = await request('GET', `/api/patients/${otherProfile._id}`, {
      token: dutyToken
    });
    const dutyAudits = auditLogs.filter(
      (log) =>
        log.action === 'PATIENT_PROFILE_ACCESSED' &&
        String(log.actorId) === String(dutyDoctorUser._id) &&
        log.accessContext.accessType === 'DUTY_DOCTOR_COVERAGE'
    );
    assertTest(
      dutyList.statusCode === 200 &&
        dutyList.body.data.patients.length === 1 &&
        dutyList.body.data.total === 2 &&
        dutySearch.statusCode === 200 &&
        dutySearch.body.data.total === 1 &&
        wildcardSearch.statusCode === 200 &&
        wildcardSearch.body.data.total === 0 &&
        dutyDetail.statusCode === 200,
      'DUTY_DOCTOR can search, page through, and retrieve hospital-wide profiles'
    );
    assertTest(
      dutyAudits.length === 3 &&
        dutyAudits.some((log) => String(log.resourceId) === String(otherProfile._id)),
      'DUTY_DOCTOR list, search, and profile access are audited with coverage context'
    );

    failAuditSave = true;
    const auditFailure = await request('GET', `/api/patients/${otherProfile._id}`, {
      token: dutyToken
    });
    failAuditSave = false;
    assertTest(
      auditFailure.statusCode === 500 &&
        !auditFailure.body.data,
      'Patient data is not returned when its access audit cannot be saved'
    );

    const pharmacyList = await request('GET', '/api/patients', {
      token: generateToken(pharmacyUser)
    });
    const pharmacyDetail = await request(
      'GET',
      `/api/patients/${profile._id}`,
      { token: generateToken(pharmacyUser) }
    );
    assertTest(
      pharmacyList.statusCode === 403 && pharmacyDetail.statusCode === 403,
      'PHARMACY cannot access patient lists or profiles'
    );

    const malformedId = await request('GET', '/api/patients/not-an-id', {
      token: assignedToken
    });
    const missingId = await request(
      'GET',
      `/api/patients/${new mongoose.Types.ObjectId()}`,
      { token: dutyToken }
    );
    assertTest(
      malformedId.statusCode === 400 && missingId.statusCode === 404,
      'Malformed IDs and missing patient profiles are handled'
    );
  } finally {
    User.findById = originalFindById;
    Patient.findOne = originalFindOne;
    Patient.find = originalPatientFind;
    Patient.findById = originalPatientFindById;
    Patient.countDocuments = originalPatientCountDocuments;
    Patient.findOneAndUpdate = originalFindOneAndUpdate;
    Doctor.findOne = originalDoctorFindOne;
    DoctorAssignment.find = originalAssignmentFind;
    DoctorAssignment.findOne = originalAssignmentFindOne;
    AuditLog.prototype.save = originalAuditSave;
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
