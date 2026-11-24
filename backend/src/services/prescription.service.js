'use strict';

const mongoose = require('mongoose');
const Prescription = require('../models/Prescription');
const MedicalRecord = require('../models/MedicalRecord');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const Medicine = require('../models/Medicine');
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
      'Prescription creation requires MongoDB replica-set or sharded transactions; no changes were made.'
    );
  }
  return mongoose.connection.transaction(operation);
};

const withSession = (query, session) =>
  session && query && typeof query.session === 'function'
    ? query.session(session)
    : query;

const getActiveDoctorProfile = async (user, session) => {
  if (user.role !== 'DOCTOR') {
    throw createError(403, 'Only doctors can issue prescriptions.');
  }
  const doctor = await withSession(Doctor.findOne({ userId: user._id }), session);
  if (!doctor || doctor.status !== 'ACTIVE') {
    throw createError(403, 'An active doctor profile is required to issue prescriptions.');
  }
  return doctor;
};

const verifyDoctorPrescriptionAuthorization = async (doctor, consultation, user, session) => {
  if (isDutyDoctor(user)) {
    return 'DUTY_DOCTOR_COVERAGE';
  }

  if (String(consultation.doctorId) === String(doctor._id)) {
    return 'ASSIGNED_DOCTOR';
  }

  const assignment = await withSession(
    DoctorAssignment.findOne({
      doctorId: doctor._id,
      patientId: consultation.patientId,
      assignmentType: 'TREATING',
      status: 'ACTIVE'
    }),
    session
  );

  if (!assignment) {
    throw createError(
      403,
      'You are not authorized to issue prescriptions for this patient without an active treating assignment or DUTY_DOCTOR permission.'
    );
  }

  return 'ASSIGNED_DOCTOR';
};

/**
 * Creates a prescription linked to a finalized consultation.
 */
const createPrescription = async (actorUser, payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  const { medicalRecordId, patientId, items } = payload;

  if (!isObjectId(medicalRecordId)) {
    throw createError(400, 'A valid medicalRecordId is required.', ['medicalRecordId']);
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw createError(400, 'At least one prescription item is required.', ['items']);
  }

  // Validate items structure
  const validatedItems = [];
  const medicineIds = new Set();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prefix = `items[${i}]`;
    if (!item || typeof item !== 'object') {
      throw createError(400, `${prefix} must be an object.`, [prefix]);
    }
    if (!isObjectId(item.medicineId)) {
      throw createError(400, `${prefix}.medicineId must be a valid ID.`, [`${prefix}.medicineId`]);
    }
    if (medicineIds.has(String(item.medicineId))) {
      throw createError(400, `Each medicine may appear only once per prescription.`, [`${prefix}.medicineId`]);
    }
    medicineIds.add(String(item.medicineId));

    if (typeof item.dosage !== 'string' || !item.dosage.trim()) {
      throw createError(400, `${prefix}.dosage is required.`, [`${prefix}.dosage`]);
    }
    if (typeof item.frequency !== 'string' || !item.frequency.trim()) {
      throw createError(400, `${prefix}.frequency is required.`, [`${prefix}.frequency`]);
    }
    if (typeof item.duration !== 'string' || !item.duration.trim()) {
      throw createError(400, `${prefix}.duration is required.`, [`${prefix}.duration`]);
    }
    const qty = Number(item.quantity);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw createError(400, `${prefix}.quantity must be a positive whole number.`, [`${prefix}.quantity`]);
    }

    validatedItems.push({
      medicineId: item.medicineId,
      dosage: item.dosage.trim(),
      route: typeof item.route === 'string' ? item.route.trim() : undefined,
      frequency: item.frequency.trim(),
      duration: item.duration.trim(),
      quantity: qty,
      instructions: typeof item.instructions === 'string' ? item.instructions.trim() : undefined
    });
  }

  return withRequiredTransaction(async (session) => {
    const doctor = await getActiveDoctorProfile(actorUser, session);
    const consultation = await withSession(MedicalRecord.findById(medicalRecordId), session);
    if (!consultation) {
      throw createError(404, 'Consultation record not found.');
    }

    if (consultation.status !== 'FINALIZED') {
      throw createError(
        409,
        'Prescriptions can only be linked to finalized consultation records.'
      );
    }

    if (patientId && String(patientId) !== String(consultation.patientId)) {
      throw createError(
        400,
        'Provided patientId does not match the consultation patient record.',
        ['patientId']
      );
    }

    const patient = await withSession(Patient.findById(consultation.patientId), session);
    if (!patient) {
      throw createError(404, 'Consultation patient record not found.');
    }

    const accessType = await verifyDoctorPrescriptionAuthorization(
      doctor,
      consultation,
      actorUser,
      session
    );

    // Verify all medicines exist and are active
    for (const item of validatedItems) {
      const med = await withSession(Medicine.findById(item.medicineId), session);
      if (!med || !med.active) {
        throw createError(404, `Active medicine record not found for ID: ${item.medicineId}`);
      }
    }

    const prescription = new Prescription({
      patientId: consultation.patientId,
      doctorId: doctor._id,
      medicalRecordId: consultation._id,
      items: validatedItems,
      status: 'PENDING',
      issuedAt: new Date()
    });

    await prescription.save({ session });

    try {
      await recordAudit(
        {
          actorId: actorUser._id,
          action: 'PRESCRIPTION_CREATED',
          resourceType: 'Prescription',
          resourceId: prescription._id,
          accessType
        },
        session
      );
    } catch (cause) {
      const error = createError(
        500,
        'Audit logging failed; the prescription was not created.'
      );
      error.cause = cause;
      throw error;
    }

    return {
      _id: prescription._id,
      patientId: prescription.patientId,
      doctorId: prescription.doctorId,
      medicalRecordId: prescription.medicalRecordId,
      items: prescription.items,
      status: prescription.status,
      issuedAt: prescription.issuedAt,
      createdAt: prescription.createdAt
    };
  });
};

/**
 * Retrieves released prescriptions for the authenticated patient.
 * Scoped strictly to own patient profile and linked only to released consultations.
 */
const getMyPrescriptions = async (actorUser) => {
  if (actorUser.role !== 'PATIENT') {
    throw createError(403, 'Only patients can access their prescriptions via this endpoint.');
  }

  const patient = await Patient.findOne({ userId: actorUser._id });
  if (!patient) {
    throw createError(404, 'Patient profile not found.');
  }

  // Find all finalized & released medical records belonging to this patient
  const releasedRecords = await MedicalRecord.find({
    patientId: patient._id,
    status: 'FINALIZED',
    isReleased: true
  }).select('_id');

  const releasedRecordIds = releasedRecords.map((r) => r._id);
  if (releasedRecordIds.length === 0) {
    return { prescriptions: [] };
  }

  // Find prescriptions linked to those released records
  const prescriptions = await Prescription.find({
    patientId: patient._id,
    medicalRecordId: { $in: releasedRecordIds }
  })
    .populate('doctorId', 'name specialization')
    .populate('items.medicineId', 'name genericName strength form identifier')
    .sort({ issuedAt: -1 })
    .lean();

  await recordAudit({
    actorId: actorUser._id,
    action: 'PRESCRIPTIONS_VIEWED',
    resourceType: 'Patient',
    resourceId: patient._id,
    accessType: 'SELF_SERVICE'
  });

  const formatted = prescriptions.map((rx) => ({
    _id: rx._id,
    issuedAt: rx.issuedAt,
    status: rx.status,
    medicalRecordId: rx.medicalRecordId,
    doctor: rx.doctorId
      ? { _id: rx.doctorId._id, name: rx.doctorId.name, specialization: rx.doctorId.specialization }
      : null,
    items: rx.items.map((item) => ({
      medicine: item.medicineId
        ? {
            _id: item.medicineId._id,
            name: item.medicineId.name,
            genericName: item.medicineId.genericName,
            strength: item.medicineId.strength,
            form: item.medicineId.form,
            identifier: item.medicineId.identifier
          }
        : null,
      dosage: item.dosage,
      route: item.route,
      frequency: item.frequency,
      duration: item.duration,
      quantity: item.quantity,
      dispensedQuantity: item.dispensedQuantity || 0,
      instructions: item.instructions
    }))
  }));

  return { prescriptions: formatted };
};

module.exports = {
  createPrescription,
  getMyPrescriptions,
  getActiveDoctorProfile
};
