'use strict';

const mongoose = require('mongoose');
const MedicalRecord = require('../models/MedicalRecord');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const DoctorAssignment = require('../models/DoctorAssignment');
const { recordAudit } = require('./audit.service');

const TRANSACTION_TOPOLOGIES = new Set([
  'ReplicaSetWithPrimary',
  'ReplicaSetNoPrimary',
  'Sharded'
]);

const createError = (statusCode, message, errors = []) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const isObjectId = (value) => {
  if (typeof value !== 'string' && !(value instanceof mongoose.Types.ObjectId)) {
    return false;
  }
  const asString = String(value);
  return (
    mongoose.Types.ObjectId.isValid(asString) &&
    String(new mongoose.Types.ObjectId(asString)) === asString
  );
};

const isDutyDoctor = (user) =>
  user.role === 'DOCTOR' && (user.permissions || []).includes('DUTY_DOCTOR');

const supportsTransactions = () => {
  const connection = mongoose.connection;
  const topology = connection.client && connection.client.topology;
  const topologyType = topology && topology.description && topology.description.type;
  return (
    connection.readyState === 1 &&
    typeof connection.transaction === 'function' &&
    TRANSACTION_TOPOLOGIES.has(topologyType)
  );
};

const withRequiredTransaction = async (operation) => {
  if (!supportsTransactions()) {
    throw createError(
      503,
      'Consultation state mutations require MongoDB replica-set or sharded transactions; no changes were made.'
    );
  }
  return mongoose.connection.transaction(operation);
};

const withSession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query;

const recordConsultationAudit = async (event, session) => {
  try {
    await recordAudit(event, session);
  } catch (cause) {
    const error = createError(
      500,
      'Audit logging failed; the consultation transaction was not committed.'
    );
    error.cause = cause;
    throw error;
  }
};

const getActiveDoctorProfile = async (user, session) => {
  if (user.role !== 'DOCTOR') {
    throw createError(403, 'Only doctors can perform this clinical operation.');
  }
  const doctor = await withSession(Doctor.findOne({ userId: user._id }), session);
  if (!doctor || doctor.status !== 'ACTIVE') {
    throw createError(403, 'An active doctor profile is required to perform clinical operations.');
  }
  return doctor;
};

const verifyDoctorPatientAuthorization = async (doctor, patientId, user, session) => {
  if (isDutyDoctor(user)) {
    return 'DUTY_DOCTOR_COVERAGE';
  }

  const assignment = await withSession(
    DoctorAssignment.findOne({
      doctorId: doctor._id,
      patientId,
      assignmentType: 'TREATING',
      status: 'ACTIVE'
    }),
    session
  );

  if (!assignment) {
    throw createError(
      403,
      'You are not authorized to access or document consultations for this patient without an active treating assignment.'
    );
  }

  return 'ASSIGNED_DOCTOR';
};

const toPatientView = (record, doctorMap = new Map()) => {
  const doc = doctorMap.get(String(record.doctorId));
  return {
    _id: record._id,
    encounterDate: record.encounterDate,
    reason: record.reason,
    symptoms: record.symptoms,
    observations: record.observations,
    diagnosis: record.diagnosis,
    treatmentPlan: record.treatmentPlan,
    doctor: doc
      ? { _id: doc._id, name: doc.name, specialization: doc.specialization }
      : null,
    amendments: (record.amendments || []).map((a) => ({
      _id: a._id,
      authorName: a.authorName,
      reason: a.reason,
      changes: a.changes,
      createdAt: a.createdAt
    }))
  };
};

const toDoctorView = (record, doctorMap = new Map(), patientMap = new Map()) => {
  const doc = doctorMap.get(String(record.doctorId));
  const pat = patientMap.get(String(record.patientId));
  return {
    _id: record._id,
    patientId: record.patientId,
    patient: pat
      ? { _id: pat._id, name: pat.name, patientNumber: pat.patientNumber }
      : null,
    doctorId: record.doctorId,
    doctor: doc
      ? { _id: doc._id, name: doc.name, specialization: doc.specialization }
      : null,
    encounterDate: record.encounterDate,
    reason: record.reason,
    symptoms: record.symptoms,
    observations: record.observations,
    diagnosis: record.diagnosis,
    notes: record.notes,
    treatmentPlan: record.treatmentPlan,
    status: record.status,
    isReleased: record.isReleased,
    releasedAt: record.releasedAt,
    releasedBy: record.releasedBy,
    amendments: record.amendments || [],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
};

/**
 * Creates a new consultation record.
 */
const createConsultation = async (actorUser, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  const {
    patientId,
    reason,
    symptoms,
    observations,
    diagnosis,
    notes,
    treatmentPlan,
    status = 'DRAFT',
    isReleased = false
  } = payload;

  if (!isObjectId(patientId)) {
    throw createError(400, 'A valid patientId is required.', ['patientId']);
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw createError(400, 'reason is required.', ['reason']);
  }
  if (typeof symptoms !== 'string' || !symptoms.trim()) {
    throw createError(400, 'symptoms description is required.', ['symptoms']);
  }
  if (typeof diagnosis !== 'string' || !diagnosis.trim()) {
    throw createError(400, 'diagnosis is required.', ['diagnosis']);
  }
  if (typeof treatmentPlan !== 'string' || !treatmentPlan.trim()) {
    throw createError(400, 'treatmentPlan is required.', ['treatmentPlan']);
  }
  if (!['DRAFT', 'FINALIZED'].includes(status)) {
    throw createError(400, 'status must be DRAFT or FINALIZED.', ['status']);
  }
  if (status === 'DRAFT' && isReleased === true) {
    throw createError(400, 'A draft consultation cannot be released to the patient.', ['isReleased']);
  }

  return withRequiredTransaction(async (session) => {
    const doctor = await getActiveDoctorProfile(actorUser, session);
    const patient = await withSession(Patient.findById(patientId), session);
    if (!patient) {
      throw createError(404, 'Patient profile not found.');
    }

    const accessType = await verifyDoctorPatientAuthorization(
      doctor,
      patient._id,
      actorUser,
      session
    );

    const consultation = new MedicalRecord({
      patientId: patient._id,
      doctorId: doctor._id,
      encounterDate: payload.encounterDate ? new Date(payload.encounterDate) : new Date(),
      reason: reason.trim(),
      symptoms: symptoms.trim(),
      observations: observations ? observations.trim() : undefined,
      diagnosis: diagnosis.trim(),
      notes: notes ? notes.trim() : undefined,
      treatmentPlan: treatmentPlan.trim(),
      status,
      isReleased: status === 'FINALIZED' ? Boolean(isReleased) : false,
      releasedAt: status === 'FINALIZED' && isReleased ? new Date() : null,
      releasedBy: status === 'FINALIZED' && isReleased ? actorUser._id : null
    });

    await consultation.save({ session });

    await recordConsultationAudit(
      {
        actorId: actorUser._id,
        action: 'CONSULTATION_CREATED',
        resourceType: 'MedicalRecord',
        resourceId: consultation._id,
        accessType
      },
      session
    );

    return toDoctorView(
      consultation.toJSON(),
      new Map([[String(doctor._id), doctor]]),
      new Map([[String(patient._id), patient]])
    );
  });
};

/**
 * Retrieves chronological medical records for a patient.
 */
const getPatientHistory = async (patientId, requestingUser, query = {}) => {
  if (!isObjectId(patientId)) {
    throw createError(400, 'A valid patientId is required.', ['patientId']);
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  let filter = { patientId };
  let isPatientRequest = false;
  let accessType;

  if (requestingUser.role === 'PATIENT') {
    const ownPatient = await Patient.findOne({ userId: requestingUser._id });
    if (!ownPatient || String(ownPatient._id) !== String(patientId)) {
      throw createError(403, 'You may only access your own released medical records.');
    }
    filter.status = 'FINALIZED';
    filter.isReleased = true;
    isPatientRequest = true;
    accessType = 'SELF_SERVICE';
  } else if (requestingUser.role === 'DOCTOR') {
    const doctor = await getActiveDoctorProfile(requestingUser);
    const patient = await Patient.findById(patientId);
    if (!patient) {
      throw createError(404, 'Patient profile not found.');
    }
    accessType = await verifyDoctorPatientAuthorization(
      doctor,
      patientId,
      requestingUser
    );
    if (query.status && ['DRAFT', 'FINALIZED'].includes(query.status)) {
      filter.status = query.status;
    }
  } else {
    throw createError(403, 'You are not authorized to view patient medical history.');
  }

  const [records, total] = await Promise.all([
    MedicalRecord.find(filter)
      .sort({ encounterDate: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MedicalRecord.countDocuments(filter)
  ]);

  const doctorIds = [...new Set(records.map((r) => String(r.doctorId)))];
  const doctors = doctorIds.length
    ? await Doctor.find({ _id: { $in: doctorIds } }).select('_id name specialization').lean()
    : [];
  const doctorMap = new Map(doctors.map((d) => [String(d._id), d]));

  await recordAudit({
    actorId: requestingUser._id,
    action: 'MEDICAL_RECORDS_ACCESSED',
    resourceType: 'Patient',
    resourceId: patientId,
    accessType
  });

  return {
    records: records.map((record) =>
      isPatientRequest ? toPatientView(record, doctorMap) : toDoctorView(record, doctorMap)
    ),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

/**
 * Retrieves a single consultation record detail.
 */
const getConsultationDetail = async (consultationId, requestingUser) => {
  if (!isObjectId(consultationId)) {
    throw createError(400, 'A valid consultation ID is required.', ['id']);
  }

  const record = await MedicalRecord.findById(consultationId).lean();
  if (!record) {
    throw createError(404, 'Medical record not found.');
  }

  let accessType;
  if (requestingUser.role === 'PATIENT') {
    const ownPatient = await Patient.findOne({ userId: requestingUser._id });
    if (
      !ownPatient ||
      String(ownPatient._id) !== String(record.patientId) ||
      record.status !== 'FINALIZED' ||
      record.isReleased !== true
    ) {
      throw createError(403, 'You may only access your own released medical records.');
    }
    accessType = 'SELF_SERVICE';
  } else if (requestingUser.role === 'DOCTOR') {
    const doctor = await getActiveDoctorProfile(requestingUser);
    accessType = await verifyDoctorPatientAuthorization(
      doctor,
      record.patientId,
      requestingUser
    );
  } else {
    throw createError(403, 'You are not authorized to view medical records.');
  }

  const [doctor, patient] = await Promise.all([
    Doctor.findById(record.doctorId).select('_id name specialization').lean(),
    Patient.findById(record.patientId).select('_id name patientNumber').lean()
  ]);

  const doctorMap = new Map(doctor ? [[String(doctor._id), doctor]] : []);
  const patientMap = new Map(patient ? [[String(patient._id), patient]] : []);

  await recordAudit({
    actorId: requestingUser._id,
    action: 'CONSULTATION_DETAIL_ACCESSED',
    resourceType: 'MedicalRecord',
    resourceId: record._id,
    accessType
  });

  return requestingUser.role === 'PATIENT'
    ? toPatientView(record, doctorMap)
    : toDoctorView(record, doctorMap, patientMap);
};

/**
 * Updates a DRAFT consultation record. Finalized records are strictly immutable.
 */
const updateDraftConsultation = async (consultationId, actorUser, payload) => {
  if (!isObjectId(consultationId)) {
    throw createError(400, 'A valid consultation ID is required.', ['id']);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  return withRequiredTransaction(async (session) => {
    const doctor = await getActiveDoctorProfile(actorUser, session);
    const record = await withSession(MedicalRecord.findById(consultationId), session);
    if (!record) {
      throw createError(404, 'Medical record not found.');
    }

    if (record.status === 'FINALIZED') {
      throw createError(
        409,
        'Finalized consultations cannot be directly edited. Use the amendments endpoint to record corrections.'
      );
    }

    if (String(record.doctorId) !== String(doctor._id)) {
      throw createError(403, 'Only the author doctor can edit a draft consultation.');
    }

    const updatable = ['reason', 'symptoms', 'observations', 'diagnosis', 'notes', 'treatmentPlan'];
    for (const key of updatable) {
      if (payload[key] !== undefined) {
        if (typeof payload[key] !== 'string') {
          throw createError(400, `${key} must be a string.`, [key]);
        }
        record[key] = payload[key].trim();
      }
    }

    if (payload.status === 'FINALIZED') {
      record.status = 'FINALIZED';
      if (payload.isReleased === true) {
        record.isReleased = true;
        record.releasedAt = new Date();
        record.releasedBy = actorUser._id;
      }
    }

    await record.save({ session });

    await recordConsultationAudit(
      {
        actorId: actorUser._id,
        action: 'CONSULTATION_DRAFT_UPDATED',
        resourceType: 'MedicalRecord',
        resourceId: record._id,
        accessType: 'ASSIGNED_DOCTOR'
      },
      session
    );

    return toDoctorView(record.toJSON());
  });
};

/**
 * Finalizes a DRAFT consultation.
 */
const finalizeConsultation = async (consultationId, actorUser, options = {}) => {
  if (!isObjectId(consultationId)) {
    throw createError(400, 'A valid consultation ID is required.', ['id']);
  }

  return withRequiredTransaction(async (session) => {
    const doctor = await getActiveDoctorProfile(actorUser, session);
    const record = await withSession(MedicalRecord.findById(consultationId), session);
    if (!record) {
      throw createError(404, 'Medical record not found.');
    }

    if (record.status === 'FINALIZED') {
      throw createError(409, 'Consultation is already finalized.');
    }

    if (String(record.doctorId) !== String(doctor._id)) {
      throw createError(403, 'Only the author doctor can finalize this consultation.');
    }

    record.status = 'FINALIZED';
    if (options.isReleased === true) {
      record.isReleased = true;
      record.releasedAt = new Date();
      record.releasedBy = actorUser._id;
    }

    await record.save({ session });

    await recordConsultationAudit(
      {
        actorId: actorUser._id,
        action: 'CONSULTATION_FINALIZED',
        resourceType: 'MedicalRecord',
        resourceId: record._id,
        accessType: 'ASSIGNED_DOCTOR'
      },
      session
    );

    return toDoctorView(record.toJSON());
  });
};

/**
 * Toggles the release of a FINALIZED medical record to the patient.
 */
const setPatientRelease = async (consultationId, actorUser, isReleased) => {
  if (!isObjectId(consultationId)) {
    throw createError(400, 'A valid consultation ID is required.', ['id']);
  }
  if (typeof isReleased !== 'boolean') {
    throw createError(400, 'isReleased must be a boolean value.', ['isReleased']);
  }

  return withRequiredTransaction(async (session) => {
    const doctor = await getActiveDoctorProfile(actorUser, session);
    const record = await withSession(MedicalRecord.findById(consultationId), session);
    if (!record) {
      throw createError(404, 'Medical record not found.');
    }

    if (record.status !== 'FINALIZED') {
      throw createError(400, 'Only finalized consultations can be released to the patient.');
    }

    const isAuthor = String(record.doctorId) === String(doctor._id);
    let accessType;
    if (isDutyDoctor(actorUser)) {
      accessType = 'DUTY_DOCTOR_COVERAGE';
    } else if (isAuthor) {
      accessType = 'ASSIGNED_DOCTOR';
    } else {
      accessType = await verifyDoctorPatientAuthorization(
        doctor,
        record.patientId,
        actorUser,
        session
      );
    }

    record.isReleased = isReleased;
    record.releasedAt = isReleased ? new Date() : null;
    record.releasedBy = isReleased ? actorUser._id : null;

    await record.save({ session });

    await recordConsultationAudit(
      {
        actorId: actorUser._id,
        action: isReleased ? 'CONSULTATION_RELEASED' : 'CONSULTATION_RELEASE_RETRACTED',
        resourceType: 'MedicalRecord',
        resourceId: record._id,
        accessType
      },
      session
    );

    return toDoctorView(record.toJSON());
  });
};

/**
 * Appends an auditable amendment to a FINALIZED consultation.
 * Original clinical fields remain strictly immutable.
 */
const addAmendment = async (consultationId, actorUser, payload) => {
  if (!isObjectId(consultationId)) {
    throw createError(400, 'A valid consultation ID is required.', ['id']);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  const { reason, changes } = payload;
  if (typeof reason !== 'string' || reason.trim().length < 5) {
    throw createError(400, 'A valid reason of at least 5 characters is required.', ['reason']);
  }
  if (reason.trim().length > 500) {
    throw createError(400, 'reason cannot exceed 500 characters.', ['reason']);
  }
  if (changes === undefined || changes === null || changes === '') {
    throw createError(400, 'changes details are required.', ['changes']);
  }

  return withRequiredTransaction(async (session) => {
    const doctor = await getActiveDoctorProfile(actorUser, session);
    const record = await withSession(MedicalRecord.findById(consultationId), session);
    if (!record) {
      throw createError(404, 'Medical record not found.');
    }

    if (record.status !== 'FINALIZED') {
      throw createError(400, 'Amendments can only be added to finalized consultations.');
    }

    const accessType = await verifyDoctorPatientAuthorization(
      doctor,
      record.patientId,
      actorUser,
      session
    );

    const amendment = {
      authorId: actorUser._id,
      authorDoctorId: doctor._id,
      authorName: doctor.name || actorUser.name,
      reason: reason.trim(),
      changes: typeof changes === 'string' ? changes.trim() : changes,
      createdAt: new Date()
    };

    // Atomic push with optimistic concurrency version check
    const recordVersion = typeof record.__v === 'number' ? record.__v : 0;
    const currentVersion = payload.expectedVersion !== undefined
      ? parseInt(payload.expectedVersion, 10)
      : recordVersion;

    if (isNaN(currentVersion) || currentVersion !== recordVersion) {
      throw createError(
        409,
        'Consultation version mismatch; the record has been updated since you retrieved it. Please refresh and retry.'
      );
    }

    const updated = await MedicalRecord.findOneAndUpdate(
      { _id: record._id, status: 'FINALIZED', __v: currentVersion },
      {
        $push: { amendments: amendment },
        $inc: { __v: 1 }
      },
      { new: true, session }
    );

    if (!updated) {
      throw createError(
        409,
        'Consultation was modified concurrently by another process. Please refresh and retry.'
      );
    }

    await recordConsultationAudit(
      {
        actorId: actorUser._id,
        action: 'CONSULTATION_AMENDED',
        resourceType: 'MedicalRecord',
        resourceId: record._id,
        accessType
      },
      session
    );

    return toDoctorView(updated.toJSON());
  });
};

module.exports = {
  createConsultation,
  getPatientHistory,
  getConsultationDetail,
  updateDraftConsultation,
  finalizeConsultation,
  setPatientRelease,
  addAmendment,
  getActiveDoctorProfile,
  verifyDoctorPatientAuthorization
};
