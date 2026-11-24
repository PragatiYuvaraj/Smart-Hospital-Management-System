'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const { recordAudit } = require('./audit.service');

const PROFILE_FIELDS = ['specialization', 'registrationReference', 'department'];
const RESTRICTED_FIELDS = [
  'doctorNumber',
  'name',
  'status',
  'role',
  'permissions',
  'password',
  'passwordHash'
];

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
  return mongoose.Types.ObjectId.isValid(asString) &&
    String(new mongoose.Types.ObjectId(asString)) === asString;
};

const canManageUsers = (user) => (user.permissions || []).includes('MANAGE_USERS');

const assertKnownFields = (payload, allowed, restrictedFields = RESTRICTED_FIELDS) => {
  const fields = Object.keys(payload);
  const restricted = fields.filter((field) => restrictedFields.includes(field));
  if (restricted.length > 0) {
    throw createError(
      400,
      `These fields cannot be modified: ${restricted.join(', ')}.`,
      restricted
    );
  }

  const unknown = fields.filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw createError(400, `Unrecognised fields: ${unknown.join(', ')}.`, unknown);
  }
};

const readRequiredText = (payload, field) => {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError(400, `${field} is required.`, [field]);
  }
  if (value.trim().length > 100) {
    throw createError(400, `${field} cannot exceed 100 characters.`, [field]);
  }
  return value.trim();
};

const readOptionalText = (payload, field) => {
  if (!Object.prototype.hasOwnProperty.call(payload, field)) {
    return undefined;
  }
  return readRequiredText(payload, field);
};

const toSafeDoctor = (doctor) => {
  const safe = doctor.toJSON();
  delete safe.passwordHash;
  return safe;
};

const createDoctorProfile = async (payload = {}, actorId) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }

  assertKnownFields(payload, ['userId', ...PROFILE_FIELDS]);

  if (!isObjectId(payload.userId)) {
    throw createError(400, 'A valid doctor userId is required.', ['userId']);
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    throw createError(404, 'User not found.');
  }
  if (user.role !== 'DOCTOR') {
    throw createError(400, 'Doctor profiles can only be created for DOCTOR accounts.');
  }
  if (user.status !== 'ACTIVE') {
    throw createError(403, 'Inactive accounts cannot receive a doctor profile.');
  }

  const existing = await Doctor.findOne({ userId: user._id });
  if (existing) {
    throw createError(409, 'A doctor profile already exists for this account.');
  }

  const doctor = new Doctor({
    userId: user._id,
    name: user.name,
    specialization: readRequiredText(payload, 'specialization'),
    registrationReference: readRequiredText(payload, 'registrationReference'),
    department: readRequiredText(payload, 'department'),
    status: 'ACTIVE'
  });

  try {
    await doctor.validate();
    await doctor.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw createError(409, 'A doctor profile already exists for this account.');
    }
    if (error && error.name === 'ValidationError') {
      throw createError(400, 'Doctor profile details are invalid.');
    }
    throw error;
  }

  await recordAudit({
    actorId,
    action: 'DOCTOR_PROFILE_CREATED',
    resourceType: 'Doctor',
    resourceId: doctor._id,
    accessType: 'MANAGEMENT'
  });

  return toSafeDoctor(doctor);
};

const getOwnProfile = async (userId) => {
  const doctor = await Doctor.findOne({ userId });
  if (!doctor) {
    throw createError(404, 'Doctor profile not found.');
  }
  return toSafeDoctor(doctor);
};

const getDoctorProfile = async (doctorId, requestingUser) => {
  if (!canManageUsers(requestingUser) && requestingUser.role !== 'DOCTOR') {
    throw createError(403, 'You are not authorized to view this doctor profile.');
  }
  if (!isObjectId(doctorId)) {
    throw createError(400, 'A valid doctor profile id is required.', ['id']);
  }

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    throw createError(404, 'Doctor profile not found.');
  }

  const isOwner = String(doctor.userId) === String(requestingUser._id);
  if (!canManageUsers(requestingUser) && !isOwner) {
    throw createError(403, 'You are not authorized to view this doctor profile.');
  }

  return toSafeDoctor(doctor);
};

const updateDoctorProfile = async (doctorId, payload = {}, actorId) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createError(400, 'Request body must be an object.');
  }
  if (!isObjectId(doctorId)) {
    throw createError(400, 'A valid doctor profile id is required.', ['id']);
  }

  assertKnownFields(payload, PROFILE_FIELDS, [...RESTRICTED_FIELDS, 'userId']);

  const updates = {};
  for (const field of PROFILE_FIELDS) {
    const value = readOptionalText(payload, field);
    if (value !== undefined) {
      updates[field] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    throw createError(
      400,
      'At least one of specialization, registrationReference, or department is required.'
    );
  }

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    throw createError(404, 'Doctor profile not found.');
  }

  Object.assign(doctor, updates);

  try {
    await doctor.validate();
    await doctor.save();
  } catch (error) {
    if (error && error.name === 'ValidationError') {
      throw createError(400, 'Doctor profile details are invalid.');
    }
    throw error;
  }

  await recordAudit({
    actorId,
    action: 'DOCTOR_PROFILE_UPDATED',
    resourceType: 'Doctor',
    resourceId: doctor._id,
    accessType: 'MANAGEMENT'
  });

  return toSafeDoctor(doctor);
};

const listDoctors = async (requestingUser, query = {}) => {
  if (!canManageUsers(requestingUser) && requestingUser.role !== 'DOCTOR') {
    throw createError(403, 'You are not authorized to view the doctor list.');
  }

  const filter = {};
  if (query.status && ['ACTIVE', 'INACTIVE'].includes(query.status.toUpperCase())) {
    filter.status = query.status.toUpperCase();
  } else {
    filter.status = 'ACTIVE';
  }

  const doctors = await Doctor.find(filter)
    .select('_id name doctorNumber specialization department status')
    .sort({ name: 1 })
    .lean();

  return { doctors: (doctors || []).map(toSafeDoctor) };
};

module.exports = {
  createDoctorProfile,
  getOwnProfile,
  getDoctorProfile,
  updateDoctorProfile,
  listDoctors
};
