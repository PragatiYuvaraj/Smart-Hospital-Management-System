'use strict';

const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const DoctorAssignment = require('../models/DoctorAssignment');
const { recordAudit } = require('./audit.service');

const ALLOWED_FIELDS = ['contactNumber', 'address'];
const RESTRICTED_FIELDS = [
  'userId',
  'patientNumber',
  'name',
  'dateOfBirth',
  'status',
  'role',
  'permissions'
];

const FIELD_LIMITS = {
  contactNumber: 30,
  address: 500
};

const createError = (statusCode, message, errors = []) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

const isObjectId = (value) =>
  typeof value === 'string' &&
  mongoose.Types.ObjectId.isValid(value) &&
  String(new mongoose.Types.ObjectId(value)) === value;

const isDutyDoctor = (user) =>
  user.role === 'DOCTOR' && (user.permissions || []).includes('DUTY_DOCTOR');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getActiveDoctorProfile = async (user) => {
  const doctor = await Doctor.findOne({ userId: user._id });
  if (!doctor || doctor.status !== 'ACTIVE') {
    throw createError(403, 'An active doctor profile is required to access patient records.');
  }
  return doctor;
};

const toPatientSummary = (patient) => ({
  _id: patient._id,
  patientNumber: patient.patientNumber,
  name: patient.name,
  status: patient.status
});

const toPatientProfile = (patient) => ({
  _id: patient._id,
  patientNumber: patient.patientNumber,
  name: patient.name,
  dateOfBirth: patient.dateOfBirth,
  contactNumber: patient.contactNumber,
  address: patient.address,
  status: patient.status
});

const recordPatientAccess = (actorId, patientId, accessType) =>
  recordAudit({
    actorId,
    action: 'PATIENT_PROFILE_ACCESSED',
    resourceType: 'Patient',
    resourceId: patientId,
    accessType
  });

const getOwnProfile = async (userId) => {
  const patient = await Patient.findOne({ userId });
  if (!patient) {
    throw createError(404, 'Patient profile not found.');
  }
  await recordPatientAccess(userId, patient._id, 'SELF_SERVICE');
  return patient.toJSON();
};

const listVisiblePatients = async (requestingUser, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  let filter;
  let accessType;

  if (requestingUser.role === 'PATIENT') {
    const ownPatient = await Patient.findOne({ userId: requestingUser._id });
    if (!ownPatient) {
      throw createError(404, 'Patient profile not found.');
    }
    filter = { _id: ownPatient._id };
    accessType = 'SELF_SERVICE';
  } else if (requestingUser.role === 'DOCTOR') {
    const doctor = await getActiveDoctorProfile(requestingUser);
    if (isDutyDoctor(requestingUser)) {
      filter = {};
      accessType = 'DUTY_DOCTOR_COVERAGE';
    } else {
      const assignments = await DoctorAssignment.find({
        doctorId: doctor._id,
        assignmentType: 'TREATING',
        status: 'ACTIVE'
      });
      filter = { _id: { $in: assignments.map((assignment) => assignment.patientId) } };
      accessType = 'ASSIGNED_DOCTOR';
    }
  } else {
    throw createError(403, 'You are not authorized to access patient records.');
  }

  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.trim().length > 100) {
      throw createError(400, 'Search must be a string of at most 100 characters.', ['search']);
    }
    const search = query.search.trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const searchFilter = {
        $or: [{ name: regex }, { patientNumber: regex }]
      };
      filter = Object.keys(filter).length
        ? { $and: [filter, searchFilter] }
        : searchFilter;
    }
  }

  const skip = (page - 1) * limit;
  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .select('_id patientNumber name status')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Patient.countDocuments(filter)
  ]);

  await Promise.all(
    patients.map((patient) =>
      recordPatientAccess(requestingUser._id, patient._id, accessType)
    )
  );

  return {
    patients: patients.map(toPatientSummary),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
};

const getVisiblePatient = async (patientId, requestingUser) => {
  if (!isObjectId(patientId)) {
    throw createError(400, 'A valid patient profile id is required.', ['id']);
  }

  let patient;
  let accessType;
  if (requestingUser.role === 'PATIENT') {
    patient = await Patient.findOne({ userId: requestingUser._id });
    if (!patient) {
      throw createError(404, 'Patient profile not found.');
    }
    if (String(patient._id) !== patientId) {
      throw createError(403, 'You may only access your own patient profile.');
    }
    accessType = 'SELF_SERVICE';
  } else if (requestingUser.role === 'DOCTOR') {
    const doctor = await getActiveDoctorProfile(requestingUser);
    if (isDutyDoctor(requestingUser)) {
      accessType = 'DUTY_DOCTOR_COVERAGE';
    } else {
      const assignment = await DoctorAssignment.findOne({
        patientId,
        doctorId: doctor._id,
        assignmentType: 'TREATING',
        status: 'ACTIVE'
      });
      if (!assignment) {
        throw createError(403, 'You are not authorized to access this patient profile.');
      }
      accessType = 'ASSIGNED_DOCTOR';
    }
    patient = await Patient.findById(patientId);
    if (!patient) {
      throw createError(404, 'Patient profile not found.');
    }
  } else {
    throw createError(403, 'You are not authorized to access patient records.');
  }

  await recordPatientAccess(requestingUser._id, patient._id, accessType);
  return toPatientProfile(patient);
};

const validateTextField = (value, field) => {
  if (typeof value !== 'string') {
    throw createError(400, `${field} must be a string.`, [field]);
  }

  const normalized = value.trim();
  const limit = FIELD_LIMITS[field];
  if (normalized.length > limit) {
    throw createError(400, `${field} cannot exceed ${limit} characters.`, [field]);
  }

  return normalized;
};

const updateOwnProfile = async (userId, payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  const fields = Object.keys(payload);
  const restricted = fields.filter((field) => RESTRICTED_FIELDS.includes(field));
  if (restricted.length > 0) {
    throw createError(
      400,
      `These fields cannot be modified: ${restricted.join(', ')}.`,
      restricted
    );
  }

  const unknown = fields.filter((field) => !ALLOWED_FIELDS.includes(field));
  if (unknown.length > 0) {
    throw createError(400, `Unrecognised fields: ${unknown.join(', ')}.`, unknown);
  }

  if (fields.length === 0) {
    throw createError(400, 'At least one of contactNumber or address is required.');
  }

  const updates = {};
  for (const field of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = validateTextField(payload[field], field);
    }
  }

  const patient = await Patient.findOneAndUpdate(
    { userId },
    { $set: updates },
    { new: true, runValidators: true }
  );

  if (!patient) {
    throw createError(404, 'Patient profile not found.');
  }

  await recordAudit({
    actorId: userId,
    action: 'PATIENT_PROFILE_UPDATED',
    resourceType: 'Patient',
    resourceId: patient._id,
    accessType: 'SELF_SERVICE'
  });

  return patient.toJSON();
};

module.exports = {
  getOwnProfile,
  updateOwnProfile,
  listVisiblePatients,
  getVisiblePatient
};
