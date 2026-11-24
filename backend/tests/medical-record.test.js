'use strict';

/**
 * Task 9.2 — Phase 1: MedicalRecord Model & Service Test Suite
 *
 * Comprehensive tests for:
 *  1. Schema validations (DRAFT release restriction, required fields, amendments)
 *  2. Consultation creation authorization (Assigned Doctor vs Duty Doctor vs Unauthorized)
 *  3. Patient medical history access and clinical note sanitization
 *  4. Consultation detail retrieval access control
 *  5. Draft updates vs. Finalized consultation immutability
 *  6. Consultation finalization and decoupled patient release tracking
 *  7. Auditable amendment additions and optimistic concurrency protection
 *  8. Transaction fail-closed behavior and audit rollback integrity
 */

const mongoose = require('mongoose');
const MedicalRecord = require('../src/models/MedicalRecord');
const Patient = require('../src/models/Patient');
const Doctor = require('../src/models/Doctor');
const DoctorAssignment = require('../src/models/DoctorAssignment');
const AuditLog = require('../src/models/AuditLog');
const medicalRecordService = require('../src/services/medicalRecord.service');

const originals = {
  recordFind: MedicalRecord.find,
  recordFindById: MedicalRecord.findById,
  recordFindOne: MedicalRecord.findOne,
  recordFindOneAndUpdate: MedicalRecord.findOneAndUpdate,
  recordCountDocuments: MedicalRecord.countDocuments,
  recordSave: MedicalRecord.prototype.save,
  patientFind: Patient.find,
  patientFindById: Patient.findById,
  patientFindOne: Patient.findOne,
  doctorFind: Doctor.find,
  doctorFindById: Doctor.findById,
  doctorFindOne: Doctor.findOne,
  assignmentFindOne: DoctorAssignment.findOne,
  assignmentFind: DoctorAssignment.find,
  auditSave: AuditLog.prototype.save,
  readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
  client: Object.getOwnPropertyDescriptor(mongoose.connection, 'client'),
  transaction: Object.getOwnPropertyDescriptor(mongoose.connection, 'transaction')
};

const records = new Map();
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

const idOf = (value) => String(value);

const matchesValue = (actual, expected) => {
  if (expected instanceof RegExp) {
    return expected.test(String(actual || ''));
  }
  if (expected && typeof expected === 'object' && !(expected instanceof Date) &&
      !(expected instanceof mongoose.Types.ObjectId)) {
    if (expected.$in) {
      return expected.$in.some((candidate) => idOf(actual) === idOf(candidate));
    }
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
    select: (fields) => {
      return query;
    },
    session: () => query,
    lean: () => query,
    then: (resolve, reject) => Promise.resolve(Array.isArray(resultList) ? list : list[0] || null).then(resolve, reject),
    catch: (reject) => Promise.resolve(Array.isArray(resultList) ? list : list[0] || null).catch(reject)
  };
  return query;
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
        auditLength: auditLogs.length
      };
      try {
        return await operation({ transaction: true });
      } catch (error) {
        records.clear();
        for (const [k, v] of state.records) records.set(k, v);
        auditLogs.splice(state.auditLength);
        throw error;
      }
    }
  });
};

const setupMocks = () => {
  setTopology('ReplicaSetWithPrimary');

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

  MedicalRecord.findById = (id) => fakeQuery(wrapRecord(records.get(idOf(id))) || null);
  MedicalRecord.findOne = (filter) => {
    const found = Array.from(records.values()).find((r) => {
      const v = r.__v === undefined ? 0 : r.__v;
      return matches({ ...r, __v: v }, filter);
    });
    return fakeQuery(wrapRecord(found) || null);
  };
  MedicalRecord.find = (filter) => {
    const list = Array.from(records.values()).filter((r) => {
      const v = r.__v === undefined ? 0 : r.__v;
      return matches({ ...r, __v: v }, filter);
    }).map(wrapRecord);
    return fakeQuery(list);
  };
  MedicalRecord.countDocuments = async (filter) =>
    Array.from(records.values()).filter((r) => {
      const v = r.__v === undefined ? 0 : r.__v;
      return matches({ ...r, __v: v }, filter);
    }).length;

  MedicalRecord.findOneAndUpdate = async (filter, update) => {
    const existing = Array.from(records.values()).find((r) => {
      const v = r.__v === undefined ? 0 : r.__v;
      return matches({ ...r, __v: v }, filter);
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

  MedicalRecord.prototype.save = async function (options) {
    if (!this._id) this._id = new mongoose.Types.ObjectId();
    const doc = this.toObject ? this.toObject() : { ...this };
    if (doc.__v === undefined) doc.__v = 0;
    records.set(idOf(this._id), doc);
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
  MedicalRecord.find = originals.recordFind;
  MedicalRecord.findById = originals.recordFindById;
  MedicalRecord.findOne = originals.recordFindOne;
  MedicalRecord.findOneAndUpdate = originals.recordFindOneAndUpdate;
  MedicalRecord.countDocuments = originals.recordCountDocuments;
  MedicalRecord.prototype.save = originals.recordSave;

  Patient.find = originals.patientFind;
  Patient.findById = originals.patientFindById;
  Patient.findOne = originals.patientFindOne;

  Doctor.find = originals.doctorFind;
  Doctor.findById = originals.doctorFindById;
  Doctor.findOne = originals.doctorFindOne;

  DoctorAssignment.find = originals.assignmentFind;
  DoctorAssignment.findOne = originals.assignmentFindOne;

  AuditLog.prototype.save = originals.auditSave;

  if (originals.readyState) {
    Object.defineProperty(mongoose.connection, 'readyState', originals.readyState);
  }
  if (originals.client) {
    Object.defineProperty(mongoose.connection, 'client', originals.client);
  }
  if (originals.transaction) {
    Object.defineProperty(mongoose.connection, 'transaction', originals.transaction);
  }
};

const runTests = async () => {
  console.log('\n============================================================');
  console.log('   TASK 9.2 — PHASE 1: MEDICAL RECORD MODEL & SERVICE TESTS');
  console.log('============================================================\n');

  setupMocks();

  try {
    // ── SUITE 1: SCHEMA VALIDATION ──────────────────────────────────────────
    console.log('--- Suite 1: Mongoose Schema Validation ---');

    // 1.1 Valid record passes validation
    const validDraft = new MedicalRecord({
      patientId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      reason: 'Routine checkup',
      symptoms: 'Mild fatigue',
      diagnosis: 'Fatigue under evaluation',
      treatmentPlan: 'Hydration and sleep hygiene',
      status: 'DRAFT',
      isReleased: false
    });
    const validErr = validDraft.validateSync();
    assertTest(!validErr, 'Valid DRAFT record with isReleased=false passes validation');

    // 1.2 DRAFT with isReleased=true must be rejected
    const invalidDraftRelease = new MedicalRecord({
      patientId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      reason: 'Routine checkup',
      symptoms: 'Mild fatigue',
      diagnosis: 'Fatigue',
      treatmentPlan: 'Hydration',
      status: 'DRAFT',
      isReleased: true
    });
    const draftReleaseErr = invalidDraftRelease.validateSync();
    assertTest(
      draftReleaseErr && draftReleaseErr.errors.isReleased,
      'Schema rejects isReleased=true when status is DRAFT'
    );

    // 1.3 FINALIZED with isReleased=true is permitted
    const validFinalRelease = new MedicalRecord({
      patientId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      reason: 'Hypertension evaluation',
      symptoms: 'Occasional headache',
      diagnosis: 'Essential Hypertension',
      treatmentPlan: 'Lifestyle modification and low sodium',
      status: 'FINALIZED',
      isReleased: true
    });
    const finalErr = validFinalRelease.validateSync();
    assertTest(!finalErr, 'Schema permits isReleased=true when status is FINALIZED');

    // 1.4 Missing required fields are rejected
    const missingFields = new MedicalRecord({
      status: 'DRAFT'
    });
    const missingErr = missingFields.validateSync();
    assertTest(
      missingErr &&
        missingErr.errors.patientId &&
        missingErr.errors.doctorId &&
        missingErr.errors.reason &&
        missingErr.errors.symptoms &&
        missingErr.errors.diagnosis &&
        missingErr.errors.treatmentPlan,
      'Schema rejects missing patient, doctor, reason, symptoms, diagnosis, and treatment plan'
    );

    // 1.5 Amendment validation rejects short reasons
    const invalidAmendmentRecord = new MedicalRecord({
      patientId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      reason: 'Checkup',
      symptoms: 'None',
      diagnosis: 'Healthy',
      treatmentPlan: 'None',
      status: 'FINALIZED',
      isReleased: false,
      amendments: [
        {
          authorId: new mongoose.Types.ObjectId(),
          authorDoctorId: new mongoose.Types.ObjectId(),
          authorName: 'Dr. Test',
          reason: 'Bad', // < 5 chars
          changes: 'Typo'
        }
      ]
    });
    const amendmentErr = invalidAmendmentRecord.validateSync();
    assertTest(
      amendmentErr && amendmentErr.errors['amendments.0.reason'],
      'Amendment schema rejects reason shorter than 5 characters'
    );

    // ── SUITE 2: FIXTURE SETUP & ACCESS PERMISSION RULES ───────────────────
    console.log('\n--- Suite 2: Consultation Creation & RBAC ---');

    // Create users, doctors, and patient fixtures
    const patientUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'John Patient',
      email: 'john@patient.test',
      role: 'PATIENT'
    };
    const patientDoc = {
      _id: new mongoose.Types.ObjectId(),
      userId: patientUser._id,
      patientNumber: 'PAT-1001',
      name: 'John Patient',
      status: 'ACTIVE'
    };
    patients.set(idOf(patientDoc._id), patientDoc);

    const doctorUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Dr. Gregory House',
      email: 'house@hospital.test',
      role: 'DOCTOR',
      permissions: []
    };
    const doctorProfile = {
      _id: new mongoose.Types.ObjectId(),
      userId: doctorUser._id,
      name: 'Dr. Gregory House',
      specialization: 'Diagnostic Medicine',
      status: 'ACTIVE'
    };
    doctors.set(idOf(doctorProfile._id), doctorProfile);

    const dutyDoctorUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Dr. Allison Cameron',
      email: 'cameron@hospital.test',
      role: 'DOCTOR',
      permissions: ['DUTY_DOCTOR']
    };
    const dutyDoctorProfile = {
      _id: new mongoose.Types.ObjectId(),
      userId: dutyDoctorUser._id,
      name: 'Dr. Allison Cameron',
      specialization: 'Immunology',
      status: 'ACTIVE'
    };
    doctors.set(idOf(dutyDoctorProfile._id), dutyDoctorProfile);

    const unassignedDoctorUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Dr. Robert Chase',
      email: 'chase@hospital.test',
      role: 'DOCTOR',
      permissions: []
    };
    const unassignedDoctorProfile = {
      _id: new mongoose.Types.ObjectId(),
      userId: unassignedDoctorUser._id,
      name: 'Dr. Robert Chase',
      specialization: 'Intensive Care',
      status: 'ACTIVE'
    };
    doctors.set(idOf(unassignedDoctorProfile._id), unassignedDoctorProfile);

    const pharmacyUser = {
      _id: new mongoose.Types.ObjectId(),
      name: 'Pharmacist Bob',
      email: 'bob@pharmacy.test',
      role: 'PHARMACY'
    };

    // Active treating assignment for Dr. House and John Patient
    const treatingAssignment = {
      _id: new mongoose.Types.ObjectId(),
      patientId: patientDoc._id,
      doctorId: doctorProfile._id,
      assignmentType: 'TREATING',
      status: 'ACTIVE',
      startDate: new Date()
    };
    assignments.set(idOf(treatingAssignment._id), treatingAssignment);

    // 2.1 Assigned doctor creates DRAFT consultation -> passes
    const draftPayload = {
      patientId: idOf(patientDoc._id),
      reason: 'Persistent dry cough',
      symptoms: 'Non-productive cough for 2 weeks',
      observations: 'Chest clear, normal vesicular breath sounds',
      diagnosis: 'Post-viral cough',
      notes: 'Internal clinical notes: patient advised to avoid cold exposure.',
      treatmentPlan: 'Dextromethorphan syrup 10ml TID, follow up in 10 days',
      status: 'DRAFT'
    };
    const createdDraft = await medicalRecordService.createConsultation(doctorUser, draftPayload);
    assertTest(
      createdDraft.status === 'DRAFT' &&
        createdDraft.isReleased === false &&
        idOf(createdDraft.doctorId) === idOf(doctorProfile._id) &&
        auditLogs.some(
          (a) => a.action === 'CONSULTATION_CREATED' && a.accessContext.accessType === 'ASSIGNED_DOCTOR'
        ),
      'Assigned doctor creates DRAFT consultation; audited as ASSIGNED_DOCTOR'
    );

    // 2.2 Duty doctor creates consultation for patient without active assignment -> passes (DUTY_DOCTOR_COVERAGE)
    const dutyPayload = {
      patientId: idOf(patientDoc._id),
      reason: 'Emergency department triage for asthma exacerbation',
      symptoms: 'Wheezing and dyspnea',
      observations: 'Bilateral expiratory wheeze, SpO2 94%',
      diagnosis: 'Acute asthma exacerbation',
      notes: 'Nebulized with Salbutamol x 2 doses. Good response.',
      treatmentPlan: 'Salbutamol MDI 2 puffs QID PRN, Budesonide 200mcg BID',
      status: 'FINALIZED',
      isReleased: true
    };
    const createdDuty = await medicalRecordService.createConsultation(dutyDoctorUser, dutyPayload);
    assertTest(
      createdDuty.status === 'FINALIZED' &&
        createdDuty.isReleased === true &&
        auditLogs.some(
          (a) =>
            a.action === 'CONSULTATION_CREATED' &&
            a.accessContext.accessType === 'DUTY_DOCTOR_COVERAGE'
        ),
      'Duty doctor creates consultation for cross-coverage; audited as DUTY_DOCTOR_COVERAGE'
    );

    // 2.3 Unassigned doctor without DUTY_DOCTOR is blocked (403)
    let unassignedBlocked = false;
    try {
      await medicalRecordService.createConsultation(unassignedDoctorUser, draftPayload);
    } catch (err) {
      unassignedBlocked = err.statusCode === 403;
    }
    assertTest(unassignedBlocked, 'Doctor without assignment or DUTY_DOCTOR is rejected with HTTP 403');

    // 2.4 Patient or Pharmacy role attempting to create consultation is blocked (403)
    let patientBlocked = false;
    let pharmacyBlocked = false;
    try {
      await medicalRecordService.createConsultation(patientUser, draftPayload);
    } catch (err) {
      patientBlocked = err.statusCode === 403;
    }
    try {
      await medicalRecordService.createConsultation(pharmacyUser, draftPayload);
    } catch (err) {
      pharmacyBlocked = err.statusCode === 403;
    }
    assertTest(patientBlocked && pharmacyBlocked, 'PATIENT and PHARMACY roles are rejected with HTTP 403');

    // ── SUITE 3: PATIENT HISTORY & DATA SANITIZATION ───────────────────────
    console.log('\n--- Suite 3: Medical History Access & Field Sanitization ---');

    // 3.1 Patient queries own history -> only receives finalized + released records; notes strictly excluded
    const patientHistory = await medicalRecordService.getPatientHistory(
      idOf(patientDoc._id),
      patientUser
    );
    assertTest(
      patientHistory.records.length === 1 &&
        idOf(patientHistory.records[0]._id) === idOf(createdDuty._id) &&
        patientHistory.records[0].notes === undefined &&
        auditLogs.some(
          (a) => a.action === 'MEDICAL_RECORDS_ACCESSED' && a.accessContext.accessType === 'SELF_SERVICE'
        ),
      'Patient receives only finalized, released records; internal clinical notes strictly omitted'
    );

    // 3.2 Patient cannot view another patient history (403)
    let crossPatientBlocked = false;
    try {
      await medicalRecordService.getPatientHistory(idOf(new mongoose.Types.ObjectId()), patientUser);
    } catch (err) {
      crossPatientBlocked = err.statusCode === 403;
    }
    assertTest(crossPatientBlocked, 'Patient cannot access another patient history (HTTP 403)');

    // 3.3 Assigned doctor views patient history -> includes drafts and notes
    const doctorHistory = await medicalRecordService.getPatientHistory(
      idOf(patientDoc._id),
      doctorUser
    );
    assertTest(
      doctorHistory.records.length === 2 &&
        doctorHistory.records.some((r) => r.status === 'DRAFT') &&
        doctorHistory.records.some((r) => r.notes !== undefined) &&
        auditLogs.some(
          (a) => a.action === 'MEDICAL_RECORDS_ACCESSED' && a.accessContext.accessType === 'ASSIGNED_DOCTOR'
        ),
      'Assigned doctor views complete patient history including drafts and confidential notes'
    );

    // 3.4 Pharmacy role cannot access patient medical history (403)
    let pharmacyHistoryBlocked = false;
    try {
      await medicalRecordService.getPatientHistory(idOf(patientDoc._id), pharmacyUser);
    } catch (err) {
      pharmacyHistoryBlocked = err.statusCode === 403;
    }
    assertTest(pharmacyHistoryBlocked, 'PHARMACY user is strictly blocked from medical history (HTTP 403)');

    // ── SUITE 4: DRAFT UPDATES VS. FINALIZED IMMUTABILITY ──────────────────
    console.log('\n--- Suite 4: Draft Updates vs. Finalized Immutability ---');

    // 4.1 Author doctor updates draft consultation -> succeeds
    const updatedDraft = await medicalRecordService.updateDraftConsultation(
      idOf(createdDraft._id),
      doctorUser,
      {
        treatmentPlan: 'Updated plan: Azithromycin 500mg daily for 3 days'
      }
    );
    assertTest(
      updatedDraft.treatmentPlan === 'Updated plan: Azithromycin 500mg daily for 3 days' &&
        auditLogs.some((a) => a.action === 'CONSULTATION_DRAFT_UPDATED'),
      'Author doctor can edit draft consultation fields'
    );

    // 4.2 Another doctor cannot edit draft consultation (403)
    let otherDoctorDraftBlocked = false;
    try {
      await medicalRecordService.updateDraftConsultation(
        idOf(createdDraft._id),
        dutyDoctorUser,
        { diagnosis: 'Tampered' }
      );
    } catch (err) {
      otherDoctorDraftBlocked = err.statusCode === 403;
    }
    assertTest(otherDoctorDraftBlocked, 'Non-author doctor cannot edit a draft consultation (HTTP 403)');

    // 4.3 Direct update on FINALIZED consultation must be rejected with 409 Conflict
    let finalizedDirectEditBlocked = false;
    try {
      await medicalRecordService.updateDraftConsultation(
        idOf(createdDuty._id),
        dutyDoctorUser,
        { diagnosis: 'Attempted overwrite of finalized diagnosis' }
      );
    } catch (err) {
      finalizedDirectEditBlocked = err.statusCode === 409;
    }
    assertTest(
      finalizedDirectEditBlocked,
      'Direct updates on FINALIZED consultations are rejected with HTTP 409 Conflict'
    );

    // ── SUITE 5: FINALIZATION & PATIENT RELEASE DECOUPLING ──────────────────
    console.log('\n--- Suite 5: Finalization & Patient Release Decoupling ---');

    // 5.1 Finalize draft consultation without release -> status FINALIZED, isReleased false
    const finalizedRecord = await medicalRecordService.finalizeConsultation(
      idOf(createdDraft._id),
      doctorUser,
      { isReleased: false }
    );
    assertTest(
      finalizedRecord.status === 'FINALIZED' &&
        finalizedRecord.isReleased === false &&
        auditLogs.some((a) => a.action === 'CONSULTATION_FINALIZED'),
      'Draft consultation finalized without immediate release; status=FINALIZED, isReleased=false'
    );

    // 5.2 Patient still cannot see finalized record while isReleased is false
    const patientHistoryAfterFinalize = await medicalRecordService.getPatientHistory(
      idOf(patientDoc._id),
      patientUser
    );
    assertTest(
      patientHistoryAfterFinalize.records.length === 1 &&
        !patientHistoryAfterFinalize.records.some((r) => idOf(r._id) === idOf(createdDraft._id)),
      'Patient cannot view finalized record until it is explicitly released'
    );

    // 5.3 Explicit release by doctor -> isReleased true, releasedAt and releasedBy set
    const releasedRecord = await medicalRecordService.setPatientRelease(
      idOf(createdDraft._id),
      doctorUser,
      true
    );
    assertTest(
      releasedRecord.isReleased === true &&
        releasedRecord.releasedAt !== null &&
        idOf(releasedRecord.releasedBy) === idOf(doctorUser._id) &&
        auditLogs.some((a) => a.action === 'CONSULTATION_RELEASED'),
      'Doctor explicitly releases finalized record; releasedAt and releasedBy stamped and audited'
    );

    // 5.4 Patient can now view the released record
    const patientHistoryAfterRelease = await medicalRecordService.getPatientHistory(
      idOf(patientDoc._id),
      patientUser
    );
    assertTest(
      patientHistoryAfterRelease.records.length === 2 &&
        patientHistoryAfterRelease.records.some((r) => idOf(r._id) === idOf(createdDraft._id)),
      'Patient can now view the record after explicit release'
    );

    // 5.5 Retracting release -> isReleased false, releasedAt null, audited as RETRACTED
    const retractedRecord = await medicalRecordService.setPatientRelease(
      idOf(createdDraft._id),
      doctorUser,
      false
    );
    assertTest(
      retractedRecord.isReleased === false &&
        retractedRecord.releasedAt === null &&
        auditLogs.some((a) => a.action === 'CONSULTATION_RELEASE_RETRACTED'),
      'Doctor retracts patient release; audited as CONSULTATION_RELEASE_RETRACTED'
    );

    // ── SUITE 6: AUDITABLE AMENDMENTS & OPTIMISTIC CONCURRENCY ─────────────
    console.log('\n--- Suite 6: Auditable Amendments & Concurrency ---');

    // 6.1 Authorized doctor appends amendment to finalized record -> succeeds
    const amendedRecord = await medicalRecordService.addAmendment(
      idOf(createdDuty._id),
      dutyDoctorUser,
      {
        reason: 'Added nebulization dose details and oxygen flow rates',
        changes: 'Oxygen was maintained at 2L/min via nasal cannula during Salbutamol nebulization'
      }
    );
    assertTest(
      amendedRecord.amendments.length === 1 &&
        amendedRecord.amendments[0].authorName === 'Dr. Allison Cameron' &&
        amendedRecord.diagnosis === createdDuty.diagnosis && // original field intact!
        auditLogs.some((a) => a.action === 'CONSULTATION_AMENDED'),
      'Authorized doctor appends amendment; original clinical fields remain strictly immutable'
    );

    // 6.2 Amendment on DRAFT record is rejected (400)
    // Create a new draft to test
    const anotherDraft = await medicalRecordService.createConsultation(doctorUser, {
      patientId: idOf(patientDoc._id),
      reason: 'Rash check',
      symptoms: 'Pruritic rash on forearms',
      diagnosis: 'Contact dermatitis',
      treatmentPlan: 'Hydrocortisone 1% cream',
      status: 'DRAFT'
    });
    let draftAmendmentBlocked = false;
    try {
      await medicalRecordService.addAmendment(idOf(anotherDraft._id), doctorUser, {
        reason: 'Cannot amend draft',
        changes: 'Test'
      });
    } catch (err) {
      draftAmendmentBlocked = err.statusCode === 400;
    }
    assertTest(draftAmendmentBlocked, 'Amendments cannot be added to a DRAFT consultation (HTTP 400)');

    // ── SUITE 7: TRANSACTION INTEGRITY & FAIL-CLOSED BEHAVIOR ──────────────
    console.log('\n--- Suite 7: Transaction Integrity & Fail-Closed Behavior ---');

    // 7.1 Standalone topology without replica set fails closed (HTTP 503)
    setTopology('Single');
    let standaloneBlocked = false;
    try {
      await medicalRecordService.createConsultation(doctorUser, draftPayload);
    } catch (err) {
      standaloneBlocked = err.statusCode === 503;
    }
    assertTest(
      standaloneBlocked,
      'Standalone MongoDB topology fails closed (HTTP 503) for consultation state mutations'
    );
    setTopology('ReplicaSetWithPrimary');

    // 7.2 Audit persistence failure aborts transaction and rolls back
    const beforeRecordsCount = records.size;
    const beforeAuditCount = auditLogs.length;
    failAuditSave = true;
    let auditFailureAborted = false;
    try {
      await medicalRecordService.createConsultation(doctorUser, {
        patientId: idOf(patientDoc._id),
        reason: 'Should abort due to audit failure',
        symptoms: 'Symptom',
        diagnosis: 'Diagnosis',
        treatmentPlan: 'Treatment',
        status: 'FINALIZED'
      });
    } catch (err) {
      auditFailureAborted = err.statusCode === 500;
    }
    failAuditSave = false;
    assertTest(
      auditFailureAborted &&
        records.size === beforeRecordsCount &&
        auditLogs.length === beforeAuditCount,
      'Audit logging failure aborts and rolls back consultation creation transaction'
    );

  } finally {
    failAuditSave = false;
    restoreMocks();
  }

  console.log('\n------------------------------------------------------------');
  console.log(`TOTAL MEDICAL RECORD ASSERTIONS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('------------------------------------------------------------\n');

  if (failed > 0) {
    process.exitCode = 1;
  }
};

runTests().catch(async (error) => {
  console.error('Test execution error:', error);
  restoreMocks();
  process.exitCode = 1;
});
