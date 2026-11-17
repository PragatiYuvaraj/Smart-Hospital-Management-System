'use strict';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Patient = require('../src/models/Patient');
const Doctor = require('../src/models/Doctor');
const DoctorAssignment = require('../src/models/DoctorAssignment');
const generateToken = require('../src/utils/generateToken');

const originalMethods = {
  userFindById: User.findById,
  patientFindById: Patient.findById,
  patientFindOne: Patient.findOne,
  patientFind: Patient.find,
  doctorFindById: Doctor.findById,
  doctorFindOne: Doctor.findOne,
  assignmentFindOne: DoctorAssignment.findOne,
  assignmentFind: DoctorAssignment.find,
  assignmentUpdateOne: DoctorAssignment.updateOne,
  assignmentSave: DoctorAssignment.prototype.save,
  connectionTransaction: Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction')
};

const users = new Map();
const patients = new Map();
const doctors = new Map();
const assignments = new Map();
const assignmentSaveSessions = [];
let failSaveForDoctorId = null;
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

const createUser = (role, email, permissions = [], status = 'ACTIVE') => {
  const user = {
    _id: new mongoose.Types.ObjectId(),
    name: `${role} Test User`,
    email,
    role,
    permissions,
    status
  };
  users.set(String(user._id), user);
  return user;
};

const createPatient = (user, status = 'ACTIVE') => {
  const patient = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    patientNumber: `PAT-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    name: 'Synthetic Patient',
    dateOfBirth: new Date('1990-04-12'),
    contactNumber: '555-0101',
    address: 'Synthetic address',
    status
  };
  patients.set(String(patient._id), patient);
  return patient;
};

const createDoctor = (user, status = 'ACTIVE') => {
  const doctor = {
    _id: new mongoose.Types.ObjectId(),
    userId: user._id,
    doctorNumber: `DOC-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    name: user.name,
    specialization: 'General Medicine',
    registrationReference: 'DEMO-REG-1',
    department: 'Synthetic Department',
    status
  };
  doctors.set(String(doctor._id), doctor);
  return doctor;
};

const assignmentMatches = (assignment, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (key === '_id' || key === 'patientId' || key === 'doctorId') {
      return String(assignment[key]) === String(value);
    }
    if (value instanceof Date) {
      return assignment[key] instanceof Date &&
        assignment[key].getTime() === value.getTime();
    }
    return assignment[key] === value;
  });

User.findById = async (id) => users.get(String(id)) || null;

Patient.findById = async (id) => patients.get(String(id)) || null;

Patient.findOne = async ({ userId }) =>
  Array.from(patients.values()).find(
    (patient) => String(patient.userId) === String(userId)
  ) || null;

Patient.find = async ({ _id }) =>
  Array.from(patients.values()).filter((patient) =>
    _id.$in.some((id) => String(id) === String(patient._id))
  );

Doctor.findById = async (id) => doctors.get(String(id)) || null;

Doctor.findOne = async ({ userId }) =>
  Array.from(doctors.values()).find(
    (doctor) => String(doctor.userId) === String(userId)
  ) || null;

DoctorAssignment.findOne = async (filter) =>
  Array.from(assignments.values()).find((assignment) =>
    assignmentMatches(assignment, filter)
  ) || null;

DoctorAssignment.find = async (filter) =>
  Array.from(assignments.values()).filter((assignment) =>
    assignmentMatches(assignment, filter)
  );

DoctorAssignment.updateOne = async (filter, update) => {
  const assignment = Array.from(assignments.values()).find((candidate) =>
    assignmentMatches(candidate, filter)
  );
  if (assignment) {
    Object.assign(assignment, update.$set);
  }
  return { acknowledged: true, matchedCount: assignment ? 1 : 0 };
};

DoctorAssignment.prototype.save = async function saveAssignment(options = {}) {
  assignmentSaveSessions.push(options.session || null);
  if (String(this.doctorId) === String(failSaveForDoctorId)) {
    throw new Error('Simulated assignment insert failure');
  }
  if (
    this.assignmentType === 'TREATING' &&
    this.status === 'ACTIVE' &&
    Array.from(assignments.values()).some(
      (assignment) =>
        assignment.assignmentType === 'TREATING' &&
        assignment.status === 'ACTIVE' &&
        String(assignment.patientId) === String(this.patientId)
    )
  ) {
    throw Object.assign(new Error('duplicate key'), {
      code: 11000,
      keyPattern: { patientId: 1, assignmentType: 1 }
    });
  }
  assignments.set(String(this._id), this);
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

const runTests = async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    console.log('\n--- Doctor–patient assignment APIs ---');

    const manager = createUser(
      'DOCTOR',
      'assignment.manager@example.test',
      ['MANAGE_USERS']
    );
    const patientUser = createUser('PATIENT', 'assignment.patient@example.test');
    const otherPatientUser = createUser('PATIENT', 'other.patient@example.test');
    const doctorUser = createUser('DOCTOR', 'assigned.doctor@example.test');
    const otherDoctorUser = createUser('DOCTOR', 'other.doctor@example.test');
    const inactiveDoctorUser = createUser(
      'DOCTOR',
      'inactive.doctor@example.test',
      [],
      'INACTIVE'
    );
    const patient = createPatient(patientUser);
    const otherPatient = createPatient(otherPatientUser);
    const doctor = createDoctor(doctorUser);
    const otherDoctor = createDoctor(otherDoctorUser);
    const inactiveDoctor = createDoctor(inactiveDoctorUser);
    const managerToken = generateToken(manager);
    const patientToken = generateToken(patientUser);
    const doctorToken = generateToken(doctorUser);
    const otherDoctorToken = generateToken(otherDoctorUser);

    const created = await request('POST', '/api/assignments', {
      token: managerToken,
      body: {
        patientId: String(patient._id),
        doctorId: String(doctor._id),
        startDate: '2026-01-01T00:00:00.000Z',
        assignedBy: String(otherDoctorUser._id),
        assignmentType: 'OTHER'
      }
    });
    const firstAssignment = created.body.data && created.body.data.assignment;
    assertTest(created.statusCode === 201, 'Management successfully creates an assignment');
    assertTest(
      firstAssignment &&
        firstAssignment.assignmentType === 'TREATING' &&
        String(firstAssignment.assignedBy) === String(manager._id),
      'Assignment type and assignedBy are set by the server'
    );

    const invalidPatientId = await request('POST', '/api/assignments', {
      token: managerToken,
      body: { patientId: 'invalid', doctorId: String(doctor._id) }
    });
    const invalidDoctorId = await request('POST', '/api/assignments', {
      token: managerToken,
      body: { patientId: String(patient._id), doctorId: 'invalid' }
    });
    assertTest(
      invalidPatientId.statusCode === 400 && invalidDoctorId.statusCode === 400,
      'Malformed patient and doctor IDs are rejected'
    );

    const missingPatient = await request('POST', '/api/assignments', {
      token: managerToken,
      body: {
        patientId: String(new mongoose.Types.ObjectId()),
        doctorId: String(doctor._id)
      }
    });
    const missingDoctor = await request('POST', '/api/assignments', {
      token: managerToken,
      body: {
        patientId: String(otherPatient._id),
        doctorId: String(new mongoose.Types.ObjectId())
      }
    });
    assertTest(
      missingPatient.statusCode === 404 && missingDoctor.statusCode === 404,
      'Unknown patient and doctor profiles are rejected'
    );

    const inactiveDoctorAssignment = await request('POST', '/api/assignments', {
      token: managerToken,
      body: {
        patientId: String(otherPatient._id),
        doctorId: String(inactiveDoctor._id)
      }
    });
    assertTest(
      inactiveDoctorAssignment.statusCode === 409,
      'Inactive doctor accounts cannot receive assignments'
    );

    const unauthorizedCreate = await request('POST', '/api/assignments', {
      token: doctorToken,
      body: {
        patientId: String(otherPatient._id),
        doctorId: String(doctor._id)
      }
    });
    assertTest(
      unauthorizedCreate.statusCode === 403,
      'Doctor without MANAGE_USERS cannot create assignments'
    );

    const duplicate = await request('POST', '/api/assignments', {
      token: managerToken,
      body: {
        patientId: String(patient._id),
        doctorId: String(doctor._id)
      }
    });
    assertTest(duplicate.statusCode === 409, 'Duplicate active treating assignments are rejected');

    const ownAssignment = await request(
      'GET',
      `/api/assignments/patient/${patient._id}`,
      { token: patientToken }
    );
    const doctorAssignment = await request(
      'GET',
      `/api/assignments/patient/${patient._id}`,
      { token: doctorToken }
    );
    assertTest(
      ownAssignment.statusCode === 200 &&
        String(ownAssignment.body.data.assignment._id) === String(firstAssignment._id),
      'Patient can view their own current assignment'
    );
    assertTest(
      doctorAssignment.statusCode === 200 &&
        String(doctorAssignment.body.data.assignment._id) === String(firstAssignment._id),
      'Assigned doctor can view the patient current assignment'
    );
    const otherAssignment = await request(
      'GET',
      `/api/assignments/patient/${otherPatient._id}`,
      { token: patientToken }
    );
    assertTest(
      otherAssignment.statusCode === 403,
      'Patient cannot view another patient assignment'
    );
    const managementView = await request(
      'GET',
      `/api/assignments/patient/${otherPatient._id}`,
      { token: managerToken }
    );
    assertTest(
      managementView.statusCode === 200 &&
        managementView.body.data.assignment === null,
      'Authorized management can view a patient without a current assignment'
    );

    const doctorPatients = await request(
      'GET',
      `/api/assignments/doctor/${doctor._id}/patients`,
      { token: doctorToken }
    );
    const listedPatient =
      doctorPatients.body.data &&
      doctorPatients.body.data.patients &&
      doctorPatients.body.data.patients[0];
    assertTest(
      doctorPatients.statusCode === 200 &&
        listedPatient &&
        String(listedPatient._id) === String(patient._id),
      'Doctor can view their own assigned patient list'
    );
    assertTest(
      listedPatient &&
        !Object.prototype.hasOwnProperty.call(listedPatient, 'address') &&
        !Object.prototype.hasOwnProperty.call(listedPatient, 'contactNumber') &&
        !Object.prototype.hasOwnProperty.call(listedPatient, 'dateOfBirth'),
      'Doctor patient list excludes unrelated sensitive patient fields'
    );
    const otherDoctorPatients = await request(
      'GET',
      `/api/assignments/doctor/${otherDoctor._id}/patients`,
      { token: doctorToken }
    );
    assertTest(
      otherDoctorPatients.statusCode === 403,
      'Doctor cannot view another doctor patient list'
    );

    const reassigned = await request(
      'PATCH',
      `/api/assignments/${firstAssignment._id}/reassign`,
      {
        token: managerToken,
        body: {
          doctorId: String(otherDoctor._id),
          startDate: '2026-02-01T00:00:00.000Z',
          assignedBy: String(otherDoctorUser._id)
        }
      }
    );
    const newAssignment = reassigned.body.data && reassigned.body.data.assignment;
    const oldAssignment = assignments.get(String(firstAssignment._id));
    assertTest(reassigned.statusCode === 200, 'Management successfully reassigns a patient');
    assertTest(
      assignments.size === 2 &&
        oldAssignment.status === 'CLOSED' &&
        oldAssignment.endDate.toISOString() === '2026-02-01T00:00:00.000Z' &&
        newAssignment.status === 'ACTIVE' &&
        String(newAssignment.assignedBy) === String(manager._id),
      'Reassignment retains the closed history and creates a new active record'
    );

    const unauthorizedReassignment = await request(
      'PATCH',
      `/api/assignments/${newAssignment._id}/reassign`,
      {
        token: doctorToken,
        body: { doctorId: String(doctor._id) }
      }
    );
    assertTest(
      unauthorizedReassignment.statusCode === 403 &&
        assignments.get(String(newAssignment._id)).status === 'ACTIVE',
      'Doctor without MANAGE_USERS cannot reassign patients'
    );

    const inactiveReassignment = await request(
      'PATCH',
      `/api/assignments/${newAssignment._id}/reassign`,
      {
        token: managerToken,
        body: { doctorId: String(inactiveDoctor._id) }
      }
    );
    assertTest(
      inactiveReassignment.statusCode === 409 &&
        assignments.get(String(newAssignment._id)).status === 'ACTIVE',
      'Reassignment to an inactive doctor is rejected without changing history'
    );

    failSaveForDoctorId = String(doctor._id);
    const rollback = await request(
      'PATCH',
      `/api/assignments/${newAssignment._id}/reassign`,
      {
        token: managerToken,
        body: { doctorId: String(doctor._id) }
      }
    );
    failSaveForDoctorId = null;
    assertTest(
      rollback.statusCode === 500 &&
        assignments.get(String(newAssignment._id)).status === 'ACTIVE',
      'Failed reassignment restores the previous active assignment'
    );

    const originalReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    const originalClient = Object.getOwnPropertyDescriptor(mongoose.connection, 'client');
    const originalTransaction = Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction');
    let transactionUsed = false;
    const transactionSession = {
      withTransaction: async (operation) => {
        transactionUsed = true;
        await operation();
      }
    };
    Object.defineProperty(mongoose.connection, 'readyState', {
      configurable: true,
      value: 1
    });
    Object.defineProperty(mongoose.connection, 'client', {
      configurable: true,
      value: { topology: { description: { type: 'ReplicaSetWithPrimary' } } }
    });
    Object.defineProperty(mongoose.connection, 'transaction', {
      configurable: true,
      value: async (operation) =>
        transactionSession.withTransaction(() => operation(transactionSession))
    });
    let transactionalReassignment;
    try {
      transactionalReassignment = await request(
        'PATCH',
        `/api/assignments/${newAssignment._id}/reassign`,
        {
          token: managerToken,
          body: {
            doctorId: String(doctor._id),
            startDate: '2026-03-01T00:00:00.000Z'
          }
        }
      );
    } finally {
      if (originalReadyState) {
        Object.defineProperty(mongoose.connection, 'readyState', originalReadyState);
      } else {
        delete mongoose.connection.readyState;
      }
      if (originalClient) {
        Object.defineProperty(mongoose.connection, 'client', originalClient);
      } else {
        delete mongoose.connection.client;
      }
      if (originalTransaction) {
        Object.defineProperty(mongoose.connection, 'transaction', originalTransaction);
      } else {
        delete mongoose.connection.transaction;
      }
    }
    assertTest(
      transactionUsed && transactionalReassignment.statusCode === 200,
      'Replica-set reassignment uses a transaction'
    );
    assertTest(
      assignmentSaveSessions.filter((session) => session === transactionSession).length === 2,
      'Closing the previous assignment and creating the replacement share a session'
    );
  } finally {
    User.findById = originalMethods.userFindById;
    Patient.findById = originalMethods.patientFindById;
    Patient.findOne = originalMethods.patientFindOne;
    Patient.find = originalMethods.patientFind;
    Doctor.findById = originalMethods.doctorFindById;
    Doctor.findOne = originalMethods.doctorFindOne;
    DoctorAssignment.findOne = originalMethods.assignmentFindOne;
    DoctorAssignment.find = originalMethods.assignmentFind;
    DoctorAssignment.updateOne = originalMethods.assignmentUpdateOne;
    DoctorAssignment.prototype.save = originalMethods.assignmentSave;
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (originalMethods.connectionTransaction) {
      Object.defineProperty(
        mongoose.connection,
        'transaction',
        originalMethods.connectionTransaction
      );
    } else {
      delete mongoose.connection.transaction;
    }
  }

  console.log(`\nAssignment assertions: ${passed + failed} | Passed: ${passed} | Failed: ${failed}\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
};

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
