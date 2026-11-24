'use strict';

/**
 * Task 9.2 — Phase 2: Medical Record & Prescription Linkage API Integration Tests
 *
 * Validates all Express HTTP endpoints against RBAC, state transitions,
 * patient data sanitization, prescription creation linkage, and audit events.
 */

const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const Patient = require('../src/models/Patient');
const Doctor = require('../src/models/Doctor');
const DoctorAssignment = require('../src/models/DoctorAssignment');
const MedicalRecord = require('../src/models/MedicalRecord');
const Prescription = require('../src/models/Prescription');
const Medicine = require('../src/models/Medicine');
const AuditLog = require('../src/models/AuditLog');
const generateToken = require('../src/utils/generateToken');

const originals = {
  userFindById: User.findById,
  patientFind: Patient.find,
  patientFindById: Patient.findById,
  patientFindOne: Patient.findOne,
  doctorFind: Doctor.find,
  doctorFindById: Doctor.findById,
  doctorFindOne: Doctor.findOne,
  assignmentFind: DoctorAssignment.find,
  assignmentFindOne: DoctorAssignment.findOne,
  recordFind: MedicalRecord.find,
  recordFindById: MedicalRecord.findById,
  recordFindOne: MedicalRecord.findOne,
  recordFindOneAndUpdate: MedicalRecord.findOneAndUpdate,
  recordCountDocuments: MedicalRecord.countDocuments,
  recordSave: MedicalRecord.prototype.save,
  prescriptionFind: Prescription.find,
  prescriptionFindById: Prescription.findById,
  prescriptionCountDocuments: Prescription.countDocuments,
  prescriptionSave: Prescription.prototype.save,
  medicineFind: Medicine.find,
  medicineFindById: Medicine.findById,
  auditSave: AuditLog.prototype.save,
  readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
  client: Object.getOwnPropertyDescriptor(mongoose.connection, 'client'),
  transaction: Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction')
};

const users = new Map();
const patients = new Map();
const doctors = new Map();
const assignments = new Map();
const records = new Map();
const prescriptions = new Map();
const medicines = new Map();
const auditLogs = [];
let failAuditSave = false;
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

const idOf = (value) => String(value);

const matchesValue = (actual, expected) => {
  if (expected instanceof RegExp) return expected.test(String(actual || ''));
  if (expected && typeof expected === 'object' && !(expected instanceof Date) &&
      !(expected instanceof mongoose.Types.ObjectId)) {
    if (expected.$in) return expected.$in.some((candidate) => idOf(actual) === idOf(candidate));
    return true;
  }
  if (actual instanceof Date || expected instanceof Date) {
    return new Date(actual).getTime() === new Date(expected).getTime();
  }
  return idOf(actual) === idOf(expected);
};

const matches = (record, filter = {}) => {
  return Object.entries(filter).every(([field, expression]) => {
    return matchesValue(record[field], expression);
  });
};

const fakeQuery = (resultList) => {
  let list = Array.isArray(resultList) ? resultList.slice() : (resultList ? [resultList] : []);
  const query = {
    sort: (criteria = {}) => {
      list.sort((a, b) => {
        for (const [key, dir] of Object.entries(criteria)) {
          const valA = a[key] instanceof Date ? a[key].getTime() : a[key];
          const valB = b[key] instanceof Date ? b[key].getTime() : b[key];
          if (valA < valB) return dir === -1 ? 1 : -1;
          if (valA > valB) return dir === -1 ? -1 : 1;
        }
        return 0;
      });
      return query;
    },
    skip: (n) => {
      list = list.slice(n);
      return query;
    },
    limit: (n) => {
      list = list.slice(0, n);
      return query;
    },
    select: () => query,
    populate: () => query,
    session: () => query,
    lean: () => query,
    then: (resolve, reject) => Promise.resolve(Array.isArray(resultList) ? list : list[0] || null).then(resolve, reject),
    catch: (reject) => Promise.resolve(Array.isArray(resultList) ? list : list[0] || null).catch(reject)
  };
  return query;
};

const wrapRecord = (r) => {
  if (!r) return null;
  const doc = { __v: 0, ...r };
  doc.save = async function () {
    const saved = { ...this };
    records.set(idOf(this._id), saved);
    return this;
  };
  doc.toJSON = function () {
    return { ...this };
  };
  return doc;
};

const setTopology = (type) => {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    value: 1
  });
  Object.defineProperty(mongoose.connection, 'client', {
    configurable: true,
    value: { topology: { description: { type } } }
  });
  Object.defineProperty(mongoose.connection, 'transaction', {
    configurable: true,
    value: async (operation) => {
      const state = {
        records: new Map(Array.from(records, ([k, v]) => [k, { ...v, amendments: [...(v.amendments || [])] }])),
        prescriptions: new Map(Array.from(prescriptions, ([k, v]) => [k, { ...v }])),
        auditLength: auditLogs.length
      };
      try {
        return await operation({ transaction: true });
      } catch (error) {
        records.clear();
        for (const [k, v] of state.records) records.set(k, v);
        prescriptions.clear();
        for (const [k, v] of state.prescriptions) prescriptions.set(k, v);
        auditLogs.splice(state.auditLength);
        throw error;
      }
    }
  });
};

const setupMocks = () => {
  setTopology('ReplicaSetWithPrimary');

  User.findById = (id) => fakeQuery(users.get(idOf(id)) || null);
  Patient.findById = (id) => fakeQuery(patients.get(idOf(id)) || null);
  Patient.findOne = (filter) =>
    fakeQuery(Array.from(patients.values()).find((p) => matches(p, filter)) || null);
  Patient.find = (filter) =>
    fakeQuery(Array.from(patients.values()).filter((p) => matches(p, filter)));

  Doctor.findById = (id) => fakeQuery(doctors.get(idOf(id)) || null);
  Doctor.findOne = (filter) =>
    fakeQuery(Array.from(doctors.values()).find((d) => matches(d, filter)) || null);
  Doctor.find = (filter) =>
    fakeQuery(Array.from(doctors.values()).filter((d) => matches(d, filter)));

  DoctorAssignment.findOne = (filter) =>
    fakeQuery(Array.from(assignments.values()).find((a) => matches(a, filter)) || null);
  DoctorAssignment.find = (filter) =>
    fakeQuery(Array.from(assignments.values()).filter((a) => matches(a, filter)));

  Medicine.findById = (id) => fakeQuery(medicines.get(idOf(id)) || null);
  Medicine.find = (filter) =>
    fakeQuery(Array.from(medicines.values()).filter((m) => matches(m, filter)));

  MedicalRecord.findById = (id) => fakeQuery(wrapRecord(records.get(idOf(id))) || null);
  MedicalRecord.findOne = (filter) => {
    const found = Array.from(records.values()).find((r) => matches(r, filter));
    return fakeQuery(wrapRecord(found) || null);
  };
  MedicalRecord.find = (filter) => {
    const list = Array.from(records.values()).filter((r) => matches(r, filter)).map(wrapRecord);
    return fakeQuery(list);
  };
  MedicalRecord.countDocuments = async (filter) =>
    Array.from(records.values()).filter((r) => matches(r, filter)).length;

  MedicalRecord.findOneAndUpdate = async (filter, update) => {
    const existing = Array.from(records.values()).find((r) => {
      const v = r.__v === undefined ? 0 : r.__v;
      const copy = { ...r, __v: v };
      return matches(copy, filter);
    });
    if (!existing) return null;
    if (existing.__v === undefined) existing.__v = 0;
    if (update.$push && update.$push.amendments) {
      existing.amendments = existing.amendments || [];
      existing.amendments.push({ ...update.$push.amendments, _id: new mongoose.Types.ObjectId() });
    }
    if (update.$inc && update.$inc.__v) {
      existing.__v = (existing.__v || 0) + update.$inc.__v;
    }
    records.set(idOf(existing._id), existing);
    return { ...existing, toJSON: () => ({ ...existing }) };
  };

  MedicalRecord.prototype.save = async function () {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    const doc = this.toObject ? this.toObject() : { ...this };
    if (doc.__v === undefined) doc.__v = 0;
    records.set(idOf(this._id), doc);
    return this;
  };

  Prescription.findById = (id) => fakeQuery(prescriptions.get(idOf(id)) || null);
  Prescription.find = (filter) =>
    fakeQuery(Array.from(prescriptions.values()).filter((p) => matches(p, filter)));
  Prescription.countDocuments = async (filter) =>
    Array.from(prescriptions.values()).filter((p) => matches(p, filter)).length;

  Prescription.prototype.save = async function () {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    const doc = this.toObject ? this.toObject() : { ...this };
    prescriptions.set(idOf(this._id), doc);
    return this;
  };

  AuditLog.prototype.save = async function () {
    if (failAuditSave) {
      throw new Error('Simulated audit persistence failure');
    }
    const doc = this.toObject ? this.toObject() : { ...this };
    auditLogs.push(doc);
    return this;
  };
};

const restoreMocks = () => {
  User.findById = originals.userFindById;
  Patient.find = originals.patientFind;
  Patient.findById = originals.patientFindById;
  Patient.findOne = originals.patientFindOne;
  Doctor.find = originals.doctorFind;
  Doctor.findById = originals.doctorFindById;
  Doctor.findOne = originals.doctorFindOne;
  DoctorAssignment.find = originals.assignmentFind;
  DoctorAssignment.findOne = originals.assignmentFindOne;
  MedicalRecord.find = originals.recordFind;
  MedicalRecord.findById = originals.recordFindById;
  MedicalRecord.findOne = originals.recordFindOne;
  MedicalRecord.findOneAndUpdate = originals.recordFindOneAndUpdate;
  MedicalRecord.countDocuments = originals.recordCountDocuments;
  MedicalRecord.prototype.save = originals.recordSave;
  Prescription.find = originals.prescriptionFind;
  Prescription.findById = originals.prescriptionFindById;
  Prescription.countDocuments = originals.prescriptionCountDocuments;
  Prescription.prototype.save = originals.prescriptionSave;
  Medicine.find = originals.medicineFind;
  Medicine.findById = originals.medicineFindById;
  AuditLog.prototype.save = originals.auditSave;

  if (originals.readyState) Object.defineProperty(mongoose.connection, 'readyState', originals.readyState);
  if (originals.client) Object.defineProperty(mongoose.connection, 'client', originals.client);
  if (originals.transaction) Object.defineProperty(mongoose.connection, 'transaction', originals.transaction);
};

const request = (method, path, { token, body } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch (_) {}
          resolve({ statusCode: res.statusCode, body: json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const runApiTests = async () => {
  console.log('\n============================================================');
  console.log('   TASK 9.2 — PHASE 2: MEDICAL RECORDS & PRESCRIPTION API TESTS');
  console.log('============================================================\n');

  setupMocks();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // ── FIXTURE CREATION ──────────────────────────────────────────────────
    // Patient
    const patientUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Alice Patient',
      email: 'alice@patient.test',
      role: 'PATIENT',
      status: 'ACTIVE'
    };
    users.set(idOf(patientUser._id), patientUser);
    const patientDoc = {
      _id: new mongoose.Types.ObjectId(),
      userId: patientUser._id,
      patientNumber: 'PAT-2001',
      name: 'Alice Patient',
      status: 'ACTIVE'
    };
    patients.set(idOf(patientDoc._id), patientDoc);
    const patientToken = generateToken(patientUser);

    // Another Patient
    const patientUser2 = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Bob Patient',
      email: 'bob@patient.test',
      role: 'PATIENT',
      status: 'ACTIVE'
    };
    users.set(idOf(patientUser2._id), patientUser2);
    const patientDoc2 = {
      _id: new mongoose.Types.ObjectId(),
      userId: patientUser2._id,
      patientNumber: 'PAT-2002',
      name: 'Bob Patient',
      status: 'ACTIVE'
    };
    patients.set(idOf(patientDoc2._id), patientDoc2);
    const patientToken2 = generateToken(patientUser2);

    // Assigned Doctor
    const assignedDocUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Dr. Gregory House',
      email: 'house@hospital.test',
      role: 'DOCTOR',
      status: 'ACTIVE',
      permissions: []
    };
    users.set(idOf(assignedDocUser._id), assignedDocUser);
    const assignedDoctorProfile = {
      _id: new mongoose.Types.ObjectId(),
      userId: assignedDocUser._id,
      name: 'Dr. Gregory House',
      specialization: 'Internal Medicine',
      status: 'ACTIVE'
    };
    doctors.set(idOf(assignedDoctorProfile._id), assignedDoctorProfile);
    const assignedDoctorToken = generateToken(assignedDocUser);

    // Duty Doctor
    const dutyDocUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Dr. Allison Cameron',
      email: 'cameron@hospital.test',
      role: 'DOCTOR',
      status: 'ACTIVE',
      permissions: ['DUTY_DOCTOR']
    };
    users.set(idOf(dutyDocUser._id), dutyDocUser);
    const dutyDoctorProfile = {
      _id: new mongoose.Types.ObjectId(),
      userId: dutyDocUser._id,
      name: 'Dr. Allison Cameron',
      specialization: 'Emergency Medicine',
      status: 'ACTIVE'
    };
    doctors.set(idOf(dutyDoctorProfile._id), dutyDoctorProfile);
    const dutyDoctorToken = generateToken(dutyDocUser);

    // Unassigned Doctor (no duty permission)
    const unassignedDocUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Dr. Robert Chase',
      email: 'chase@hospital.test',
      role: 'DOCTOR',
      status: 'ACTIVE',
      permissions: []
    };
    users.set(idOf(unassignedDocUser._id), unassignedDocUser);
    const unassignedDoctorProfile = {
      _id: new mongoose.Types.ObjectId(),
      userId: unassignedDocUser._id,
      name: 'Dr. Robert Chase',
      specialization: 'Surgeon',
      status: 'ACTIVE'
    };
    doctors.set(idOf(unassignedDoctorProfile._id), unassignedDoctorProfile);
    const unassignedDoctorToken = generateToken(unassignedDocUser);

    // Pharmacy Staff
    const pharmacyUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Pharmacist Dan',
      email: 'dan@pharmacy.test',
      role: 'PHARMACY',
      status: 'ACTIVE',
      permissions: []
    };
    users.set(idOf(pharmacyUser._id), pharmacyUser);
    const pharmacyToken = generateToken(pharmacyUser);

    // Active treating assignment: Dr. House -> Alice Patient
    const treatingAssignment = {
      _id: new mongoose.Types.ObjectId(),
      patientId: patientDoc._id,
      doctorId: assignedDoctorProfile._id,
      assignmentType: 'TREATING',
      status: 'ACTIVE',
      startDate: new Date()
    };
    assignments.set(idOf(treatingAssignment._id), treatingAssignment);

    // Medicine catalogue fixture
    const medicineA = {
      _id: new mongoose.Types.ObjectId(),
      identifier: 'MED-AMOX-500',
      name: 'Amoxicillin 500mg',
      genericName: 'Amoxicillin',
      strength: '500mg',
      form: 'Capsule',
      category: 'Antibiotic',
      active: true
    };
    medicines.set(idOf(medicineA._id), medicineA);

    // ── SUITE 1: CONSULTATION CREATION RBAC & VALIDATION ───────────────────
    console.log('--- Suite 1: POST /api/medical-records (Creation & RBAC) ---');

    const consultationPayload = {
      patientId: idOf(patientDoc._id),
      reason: 'Persistent fever and productive cough',
      symptoms: 'Fever for 4 days, yellow sputum',
      observations: 'Coarse crepitations in right lower zone',
      diagnosis: 'Community-acquired pneumonia',
      notes: 'Confidential doctor notes: CXR ordered, sputum culture sent.',
      treatmentPlan: 'Amoxicillin 500mg TID for 7 days, paracetamol 650mg PRN',
      status: 'DRAFT'
    };

    // 1.1 Assigned doctor creates DRAFT consultation -> 201 Created
    const createRes = await request('POST', '/api/medical-records', {
      token: assignedDoctorToken,
      body: consultationPayload
    });
    assertTest(
      createRes.statusCode === 201 &&
        createRes.body.data.status === 'DRAFT' &&
        createRes.body.data.isReleased === false,
      'POST /api/medical-records: Assigned doctor creates DRAFT consultation (201 Created)'
    );
    const draftConsultationId = createRes.body?.data?._id;

    // 1.2 Duty doctor creates consultation for cross-coverage -> 201 Created
    const dutyCreateRes = await request('POST', '/api/medical-records', {
      token: dutyDoctorToken,
      body: { ...consultationPayload, reason: 'Duty ED cross-coverage visit', status: 'FINALIZED', isReleased: false }
    });
    assertTest(
      dutyCreateRes.statusCode === 201 &&
        dutyCreateRes.body.data.status === 'FINALIZED' &&
        auditLogs.some(
          (a) => a.action === 'CONSULTATION_CREATED' && a.accessContext.accessType === 'DUTY_DOCTOR_COVERAGE'
        ),
      'POST /api/medical-records: Duty doctor creates consultation; audited as DUTY_DOCTOR_COVERAGE'
    );
    const finalizedConsultationId = dutyCreateRes.body?.data?._id;

    // 1.3 Unassigned doctor without duty permission -> 403 Forbidden
    const unassignedCreateRes = await request('POST', '/api/medical-records', {
      token: unassignedDoctorToken,
      body: consultationPayload
    });
    assertTest(
      unassignedCreateRes.statusCode === 403,
      'POST /api/medical-records: Unassigned doctor without DUTY_DOCTOR rejected (403 Forbidden)'
    );

    // 1.4 PATIENT role -> 403 Forbidden
    const patientCreateRes = await request('POST', '/api/medical-records', {
      token: patientToken,
      body: consultationPayload
    });
    assertTest(
      patientCreateRes.statusCode === 403,
      'POST /api/medical-records: PATIENT role rejected (403 Forbidden)'
    );

    // 1.5 PHARMACY role -> 403 Forbidden
    const pharmacyCreateRes = await request('POST', '/api/medical-records', {
      token: pharmacyToken,
      body: consultationPayload
    });
    assertTest(
      pharmacyCreateRes.statusCode === 403,
      'POST /api/medical-records: PHARMACY role rejected (403 Forbidden)'
    );

    // 1.6 Unauthenticated -> 401 Unauthorized
    const unauthCreateRes = await request('POST', '/api/medical-records', {
      body: consultationPayload
    });
    assertTest(
      unauthCreateRes.statusCode === 401,
      'POST /api/medical-records: Unauthenticated request rejected (401 Unauthorized)'
    );

    // 1.7 Validation: Cannot set isReleased=true on DRAFT record -> 400 Bad Request
    const draftReleaseRes = await request('POST', '/api/medical-records', {
      token: assignedDoctorToken,
      body: { ...consultationPayload, status: 'DRAFT', isReleased: true }
    });
    assertTest(
      draftReleaseRes.statusCode === 400,
      'POST /api/medical-records: Draft consultation cannot be released to patient (400 Bad Request)'
    );

    // ── SUITE 2: PATIENT HISTORY & PRIVACY SANITIZATION ────────────────────
    console.log('\n--- Suite 2: GET /api/patients/:id/medical-records (History & Sanitization) ---');

    // 2.1 Patient queries own medical history
    // Current state: 1 DRAFT (unreleased), 1 FINALIZED (unreleased)
    // Patient should receive 0 records!
    const patientHistoryEmptyRes = await request(
      'GET',
      `/api/patients/${idOf(patientDoc._id)}/medical-records`,
      { token: patientToken }
    );
    assertTest(
      patientHistoryEmptyRes.statusCode === 200 &&
        patientHistoryEmptyRes.body.data.records.length === 0,
      'GET /api/patients/:id/medical-records: Patient sees 0 records when none are released'
    );

    // 2.2 Release the finalized consultation using doctor endpoint
    const releaseRes = await request(
      'POST',
      `/api/medical-records/${finalizedConsultationId}/release`,
      { token: dutyDoctorToken, body: { isReleased: true } }
    );
    assertTest(
      releaseRes.statusCode === 200 && releaseRes.body.data.isReleased === true,
      'POST /api/medical-records/:id/release: Doctor releases finalized consultation to patient'
    );

    // 2.3 Patient now queries history -> sees 1 released record; confidential notes strictly excluded
    const patientHistoryRes = await request(
      'GET',
      `/api/patients/${idOf(patientDoc._id)}/medical-records`,
      { token: patientToken }
    );
    const patientViewRecord = patientHistoryRes.body?.data?.records?.[0];
    assertTest(
      patientHistoryRes.statusCode === 200 &&
        patientHistoryRes.body.data.records.length === 1 &&
        patientViewRecord.notes === undefined &&
        patientViewRecord.diagnosis === 'Community-acquired pneumonia' &&
        patientViewRecord.doctor &&
        patientViewRecord.doctor.name === 'Dr. Allison Cameron',
      'GET /api/patients/:id/medical-records: Patient views released record; confidential notes strictly excluded'
    );

    // 2.4 Patient querying another patient's medical history -> 403 Forbidden
    const crossPatientHistoryRes = await request(
      'GET',
      `/api/patients/${idOf(patientDoc2._id)}/medical-records`,
      { token: patientToken }
    );
    assertTest(
      crossPatientHistoryRes.statusCode === 403,
      'GET /api/patients/:id/medical-records: Patient blocked from other patient history (403 Forbidden)'
    );

    // 2.5 Assigned doctor queries patient history -> sees all records including drafts and confidential notes
    const doctorHistoryRes = await request(
      'GET',
      `/api/patients/${idOf(patientDoc._id)}/medical-records`,
      { token: assignedDoctorToken }
    );
    assertTest(
      doctorHistoryRes.statusCode === 200 &&
        doctorHistoryRes.body.data.records.length === 2 &&
        doctorHistoryRes.body.data.records.some((r) => r.notes !== undefined),
      'GET /api/patients/:id/medical-records: Assigned doctor sees all records including drafts and notes'
    );

    // 2.6 PHARMACY user queries patient history -> 403 Forbidden
    const pharmacyHistoryRes = await request(
      'GET',
      `/api/patients/${idOf(patientDoc._id)}/medical-records`,
      { token: pharmacyToken }
    );
    assertTest(
      pharmacyHistoryRes.statusCode === 403,
      'GET /api/patients/:id/medical-records: PHARMACY role blocked (403 Forbidden)'
    );

    // ── SUITE 3: CONSULTATION DETAIL & RECORD RETRACTION ───────────────────
    console.log('\n--- Suite 3: GET /api/medical-records/:id & Retraction ---');

    // 3.1 Patient queries detail of released consultation -> 200 OK without notes
    const patientDetailRes = await request(
      'GET',
      `/api/medical-records/${finalizedConsultationId}`,
      { token: patientToken }
    );
    assertTest(
      patientDetailRes.statusCode === 200 &&
        patientDetailRes.body.data.notes === undefined &&
        patientDetailRes.body.data.diagnosis === 'Community-acquired pneumonia',
      'GET /api/medical-records/:id: Patient detail view excludes internal notes'
    );

    // 3.2 Patient queries detail of DRAFT consultation -> 403 Forbidden
    const patientDraftDetailRes = await request(
      'GET',
      `/api/medical-records/${draftConsultationId}`,
      { token: patientToken }
    );
    assertTest(
      patientDraftDetailRes.statusCode === 403,
      'GET /api/medical-records/:id: Patient blocked from unreleased draft consultation (403 Forbidden)'
    );

    // 3.3 Doctor retracts patient release -> isReleased becomes false
    const retractRes = await request(
      'POST',
      `/api/medical-records/${finalizedConsultationId}/release`,
      { token: dutyDoctorToken, body: { isReleased: false } }
    );
    assertTest(
      retractRes.statusCode === 200 &&
        retractRes.body.data.isReleased === false &&
        retractRes.body.data.releasedAt === null &&
        auditLogs.some((a) => a.action === 'CONSULTATION_RELEASE_RETRACTED'),
      'POST /api/medical-records/:id/release: Retraction sets isReleased=false, audited as RETRACTED'
    );

    // 3.4 Patient is now blocked from the retracted consultation detail
    const patientRetractedDetailRes = await request(
      'GET',
      `/api/medical-records/${finalizedConsultationId}`,
      { token: patientToken }
    );
    assertTest(
      patientRetractedDetailRes.statusCode === 403,
      'GET /api/medical-records/:id: Patient blocked from retracted consultation (403 Forbidden)'
    );

    // Re-release for subsequent tests
    await request(
      'POST',
      `/api/medical-records/${finalizedConsultationId}/release`,
      { token: dutyDoctorToken, body: { isReleased: true } }
    );

    // ── SUITE 4: DRAFT UPDATES VS. FINALIZED IMMUTABILITY ──────────────────
    console.log('\n--- Suite 4: PATCH /api/medical-records/:id & Finalization ---');

    // 4.1 Author doctor updates draft consultation fields -> 200 OK
    const updateDraftRes = await request(
      'PATCH',
      `/api/medical-records/${draftConsultationId}`,
      {
        token: assignedDoctorToken,
        body: { treatmentPlan: 'Revised: Amoxicillin-Clavulanate 625mg BID x 7 days' }
      }
    );
    assertTest(
      updateDraftRes.statusCode === 200 &&
        updateDraftRes.body.data.treatmentPlan === 'Revised: Amoxicillin-Clavulanate 625mg BID x 7 days',
      'PATCH /api/medical-records/:id: Author doctor can edit draft consultation fields'
    );

    // 4.2 Non-author doctor cannot edit draft consultation -> 403 Forbidden
    const nonAuthorUpdateRes = await request(
      'PATCH',
      `/api/medical-records/${draftConsultationId}`,
      {
        token: dutyDoctorToken,
        body: { diagnosis: 'Tampered' }
      }
    );
    assertTest(
      nonAuthorUpdateRes.statusCode === 403,
      'PATCH /api/medical-records/:id: Non-author doctor blocked from editing draft (403 Forbidden)'
    );

    // 4.3 Attempting direct PATCH on FINALIZED record -> 409 Conflict
    const finalizedPatchRes = await request(
      'PATCH',
      `/api/medical-records/${finalizedConsultationId}`,
      {
        token: dutyDoctorToken,
        body: { diagnosis: 'Direct edit overwrite' }
      }
    );
    assertTest(
      finalizedPatchRes.statusCode === 409,
      'PATCH /api/medical-records/:id: Direct edit of finalized consultation rejected (409 Conflict)'
    );

    // 4.4 Author doctor finalizes draft consultation -> 200 OK
    const finalizeRes = await request(
      'POST',
      `/api/medical-records/${draftConsultationId}/finalize`,
      { token: assignedDoctorToken, body: { isReleased: true } }
    );
    assertTest(
      finalizeRes.statusCode === 200 &&
        finalizeRes.body.data.status === 'FINALIZED' &&
        finalizeRes.body.data.isReleased === true &&
        auditLogs.some((a) => a.action === 'CONSULTATION_FINALIZED'),
      'POST /api/medical-records/:id/finalize: Author finalizes consultation with release'
    );

    // 4.5 Attempting to finalize an already finalized record -> 409 Conflict
    const doubleFinalizeRes = await request(
      'POST',
      `/api/medical-records/${draftConsultationId}/finalize`,
      { token: assignedDoctorToken }
    );
    assertTest(
      doubleFinalizeRes.statusCode === 409,
      'POST /api/medical-records/:id/finalize: Finalizing already finalized record rejected (409 Conflict)'
    );

    // ── SUITE 5: AUDITABLE AMENDMENTS & CONCURRENCY ─────────────────────────
    console.log('\n--- Suite 5: POST /api/medical-records/:id/amendments ---');

    // 5.1 Authorized doctor appends amendment -> 200 OK; core clinical fields untouched
    const amendmentPayload = {
      reason: 'CXR report confirmation added',
      changes: 'Right lower lobe consolidation confirmed on chest radiograph report dated 18-Nov-2026'
    };
    const amendRes = await request(
      'POST',
      `/api/medical-records/${draftConsultationId}/amendments`,
      { token: assignedDoctorToken, body: amendmentPayload }
    );
    assertTest(
      amendRes.statusCode === 200 &&
        amendRes.body.data.amendments.length === 1 &&
        amendRes.body.data.amendments[0].authorName === 'Dr. Gregory House' &&
        amendRes.body.data.diagnosis === 'Community-acquired pneumonia' && // original untouched!
        auditLogs.some((a) => a.action === 'CONSULTATION_AMENDED'),
      'POST /api/medical-records/:id/amendments: Amendment appended; original clinical fields intact'
    );

    // 5.2 Amendment with invalid reason (< 5 chars) -> 400 Bad Request
    const shortReasonAmendRes = await request(
      'POST',
      `/api/medical-records/${draftConsultationId}/amendments`,
      { token: assignedDoctorToken, body: { reason: 'No', changes: 'test' } }
    );
    assertTest(
      shortReasonAmendRes.statusCode === 400,
      'POST /api/medical-records/:id/amendments: Reason < 5 characters rejected (400 Bad Request)'
    );

    // 5.3 Optimistic concurrency: mismatch expectedVersion -> 409 Conflict
    const staleVersionAmendRes = await request(
      'POST',
      `/api/medical-records/${draftConsultationId}/amendments`,
      {
        token: assignedDoctorToken,
        body: {
          reason: 'Stale update',
          changes: 'Should fail due to version mismatch',
          expectedVersion: 0 // Record __v was already incremented!
        }
      }
    );
    assertTest(
      staleVersionAmendRes.statusCode === 409,
      'POST /api/medical-records/:id/amendments: Version mismatch rejected (409 Conflict)'
    );

    // ── SUITE 6: PRESCRIPTION LINKAGE & PHARMACY QUEUE COMPATIBILITY ───────
    console.log('\n--- Suite 6: POST /api/prescriptions (Linkage & Pharmacy Integration) ---');

    // 6.1 Assigned doctor creates prescription linked to FINALIZED consultation -> 201 Created
    const prescriptionPayload = {
      medicalRecordId: draftConsultationId,
      patientId: idOf(patientDoc._id),
      items: [
        {
          medicineId: idOf(medicineA._id),
          dosage: '500mg',
          route: 'Oral',
          frequency: 'Three times daily',
          duration: '7 days',
          quantity: 21,
          instructions: 'Take after meals'
        }
      ]
    };
    const rxRes = await request('POST', '/api/prescriptions', {
      token: assignedDoctorToken,
      body: prescriptionPayload
    });
    assertTest(
      rxRes.statusCode === 201 &&
        rxRes.body.data.status === 'PENDING' &&
        idOf(rxRes.body.data.medicalRecordId) === idOf(draftConsultationId) &&
        auditLogs.some((a) => a.action === 'PRESCRIPTION_CREATED'),
      'POST /api/prescriptions: Prescription created linked to finalized consultation (201 Created)'
    );
    const createdRxId = rxRes.body?.data?._id;

    // 6.2 Newly created prescription appears immediately in Pharmacy Queue -> GET /api/prescriptions/pending
    const pharmacyQueueRes = await request('GET', '/api/prescriptions/pending', {
      token: pharmacyToken
    });
    assertTest(
      pharmacyQueueRes.statusCode === 200 &&
        pharmacyQueueRes.body.data.prescriptions.some((p) => idOf(p._id) === idOf(createdRxId)),
      'GET /api/prescriptions/pending: Pharmacy queue retrieves new prescription (Seamless integration)'
    );

    // 6.3 Prescription linked to DRAFT consultation must be rejected -> 409 Conflict
    // Create a new draft
    const newDraftRecord = {
      _id: new mongoose.Types.ObjectId(),
      patientId: patientDoc._id,
      doctorId: assignedDoctorProfile._id,
      reason: 'Draft consultation',
      symptoms: 'Mild cold',
      diagnosis: 'Common cold',
      treatmentPlan: 'Rest',
      status: 'DRAFT',
      isReleased: false,
      __v: 0
    };
    records.set(idOf(newDraftRecord._id), newDraftRecord);

    const draftRxRes = await request('POST', '/api/prescriptions', {
      token: assignedDoctorToken,
      body: { ...prescriptionPayload, medicalRecordId: idOf(newDraftRecord._id) }
    });
    assertTest(
      draftRxRes.statusCode === 409,
      'POST /api/prescriptions: Linking to DRAFT consultation rejected (409 Conflict)'
    );

    // 6.4 Prescription with mismatched patientId -> 400 Bad Request
    const mismatchedPatientRxRes = await request('POST', '/api/prescriptions', {
      token: assignedDoctorToken,
      body: { ...prescriptionPayload, patientId: idOf(patientDoc2._id) }
    });
    assertTest(
      mismatchedPatientRxRes.statusCode === 400,
      'POST /api/prescriptions: Mismatched patientId rejected (400 Bad Request)'
    );

    // 6.5 Unassigned doctor without duty permission -> 403 Forbidden
    const unauthDocRxRes = await request('POST', '/api/prescriptions', {
      token: unassignedDoctorToken,
      body: prescriptionPayload
    });
    assertTest(
      unauthDocRxRes.statusCode === 403,
      'POST /api/prescriptions: Unassigned doctor without duty coverage rejected (403 Forbidden)'
    );

    // 6.6 Patient views own released prescriptions -> 200 OK
    const patientMyRxRes = await request('GET', '/api/prescriptions/my', {
      token: patientToken
    });
    assertTest(
      patientMyRxRes.statusCode === 200 &&
        patientMyRxRes.body.data.prescriptions.length === 1 &&
        idOf(patientMyRxRes.body.data.prescriptions[0]._id) === idOf(createdRxId),
      'GET /api/prescriptions/my: Patient views own released prescription (200 OK)'
    );

    // 6.7 Another patient cannot view the first patient's prescriptions -> empty list
    const patient2MyRxRes = await request('GET', '/api/prescriptions/my', {
      token: patientToken2
    });
    assertTest(
      patient2MyRxRes.statusCode === 200 &&
        patient2MyRxRes.body.data.prescriptions.length === 0,
      'GET /api/prescriptions/my: Different patient receives only own prescriptions (Data isolation)'
    );

    // 6.8 Doctor and Pharmacy roles rejected from /api/prescriptions/my -> 403 Forbidden
    const doctorMyRxRes = await request('GET', '/api/prescriptions/my', {
      token: assignedDoctorToken
    });
    const pharmacyMyRxRes = await request('GET', '/api/prescriptions/my', {
      token: pharmacyToken
    });
    assertTest(
      doctorMyRxRes.statusCode === 403 && pharmacyMyRxRes.statusCode === 403,
      'GET /api/prescriptions/my: Non-patient roles rejected (403 Forbidden)'
    );

    // ── SUITE 7: TRANSACTION ROLLBACK & FAIL-CLOSED TOPOLOGY ───────────────
    console.log('\n--- Suite 7: Transaction Rollback & Fail-Closed Behavior ---');

    // 7.1 Standalone topology fails closed (HTTP 503)
    setTopology('Single');
    const standaloneRxRes = await request('POST', '/api/prescriptions', {
      token: assignedDoctorToken,
      body: prescriptionPayload
    });
    assertTest(
      standaloneRxRes.statusCode === 503,
      'POST /api/prescriptions: Standalone MongoDB topology fails closed (503 Service Unavailable)'
    );
    setTopology('ReplicaSetWithPrimary');

    // 7.2 Audit failure rolls back prescription creation
    const beforeRxCount = prescriptions.size;
    const beforeAuditCount = auditLogs.length;
    failAuditSave = true;
    const auditFailureRxRes = await request('POST', '/api/prescriptions', {
      token: assignedDoctorToken,
      body: prescriptionPayload
    });
    failAuditSave = false;
    assertTest(
      auditFailureRxRes.statusCode === 500 &&
        prescriptions.size === beforeRxCount &&
        auditLogs.length === beforeAuditCount,
      'POST /api/prescriptions: Audit failure aborts transaction and rolls back prescription'
    );

  } finally {
    failAuditSave = false;
    restoreMocks();
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n------------------------------------------------------------');
  console.log(`TOTAL API INTEGRATION ASSERTIONS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('------------------------------------------------------------\n');

  if (failed > 0) {
    process.exitCode = 1;
  }
};

runApiTests().catch(async (error) => {
  console.error('Test execution error:', error);
  restoreMocks();
  if (server) await new Promise((resolve) => server.close(resolve));
  process.exitCode = 1;
});
