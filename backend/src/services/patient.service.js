'use strict';

const Patient = require('../models/Patient');

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

const getOwnProfile = async (userId) => {
  const patient = await Patient.findOne({ userId });
  if (!patient) {
    throw createError(404, 'Patient profile not found.');
  }
  return patient.toJSON();
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

  return patient.toJSON();
};

module.exports = {
  getOwnProfile,
  updateOwnProfile
};
