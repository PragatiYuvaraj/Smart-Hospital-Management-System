const mongoose = require('mongoose');
const User = require('../models/User');
const Patient = require('../models/Patient');
const generateToken = require('../utils/generateToken');
const { recordAudit } = require('./audit.service');

const createError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseDateOfBirth = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createError(400, 'A valid date of birth is required.');
  }

  const dateOfBirth = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(dateOfBirth.getTime()) ||
    dateOfBirth.toISOString().slice(0, 10) !== value ||
    dateOfBirth > new Date()
  ) {
    throw createError(400, 'A valid date of birth is required.');
  }

  return dateOfBirth;
};

const supportsTransactions = () => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.client) {
    return false;
  }

  const topology = mongoose.connection.client.topology;
  const topologyType = topology && topology.description && topology.description.type;

  return ['ReplicaSetWithPrimary', 'ReplicaSetNoPrimary', 'Sharded'].includes(topologyType);
};

const createWithTransaction = async (user, patientData) => {
  let patient;
  await mongoose.connection.transaction(async (session) => {
    await user.save({ session });

    patient = new Patient({
      ...patientData,
      userId: user._id
    });
    await patient.save({ session });
    await recordAudit(
      {
        actorId: user._id,
        action: 'PATIENT_REGISTERED',
        resourceType: 'Patient',
        resourceId: patient._id,
        accessType: 'SELF_REGISTRATION'
      },
      session
    );
  });

  return user;
};

const rollbackNonTransactionalRegistration = async (user, originalError) => {
  const cleanupErrors = [];
  let safeToRemovePatient = false;

  try {
    const result = await User.updateOne(
      { _id: user._id },
      { $set: { status: 'INACTIVE' } }
    );
    if (!result.acknowledged) {
      throw new Error('Could not confirm account deactivation.');
    }
    safeToRemovePatient = true;
  } catch (error) {
    cleanupErrors.push({ operation: 'deactivate user', name: error.name, code: error.code });
  }

  if (safeToRemovePatient) {
    let patientRemoved = false;
    try {
      const result = await Patient.deleteOne({ userId: user._id });
      if (!result.acknowledged) {
        throw new Error('Could not confirm patient profile cleanup.');
      }
      patientRemoved = true;
    } catch (error) {
      cleanupErrors.push({ operation: 'remove patient profile', name: error.name, code: error.code });
    }

    if (patientRemoved) {
      try {
        const result = await User.deleteOne({ _id: user._id, status: 'INACTIVE' });
        if (!result.acknowledged) {
          throw new Error('Could not confirm user cleanup.');
        }
      } catch (error) {
        cleanupErrors.push({ operation: 'remove inactive user', name: error.name, code: error.code });
      }
    }
  }

  if (cleanupErrors.length > 0) {
    const error = createError(
      500,
      'Registration failed and automatic cleanup was incomplete.'
    );
    error.cause = originalError;
    error.cleanupErrors = cleanupErrors;
    throw error;
  }
};

const toRegistrationError = (error) => {
  if (error.code === 11000) {
    const duplicateField = error.keyPattern && Object.keys(error.keyPattern)[0];
    if (duplicateField === 'email') {
      return createError(409, 'An account with this email address already exists.');
    }
    return createError(409, 'A patient profile with this account or identifier already exists.');
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return createError(400, 'Registration details are invalid.');
  }

  if (error.statusCode) {
    return error;
  }

  const safeError = createError(500, 'Patient registration could not be completed.');
  safeError.cause = error;
  return safeError;
};

/**
 * Registers a new patient.
 * Enforces role as PATIENT and ignores any client-supplied roles or permissions.
 */
const registerPatient = async (payload = {}) => {
  const { name, email, password, dateOfBirth } = payload;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    typeof email !== 'string' ||
    !email.trim() ||
    typeof password !== 'string' ||
    !password
  ) {
    throw createError(400, 'Name, email, password, and date of birth are required.');
  }

  if (password.length < 6) {
    throw createError(400, 'Password must be at least 6 characters long.');
  }

  const normalizedName = name.trim();
  const normalizedEmail = email.toLowerCase().trim();
  const patientData = {
    name: normalizedName,
    dateOfBirth: parseDateOfBirth(dateOfBirth)
  };

  const user = new User({
    name: normalizedName,
    email: normalizedEmail,
    passwordHash: password,
    role: 'PATIENT',
    permissions: [],
    status: 'ACTIVE'
  });

  const patient = new Patient({
    ...patientData,
    userId: user._id
  });

  try {
    await Promise.all([user.validate(), patient.validate()]);

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw createError(409, 'An account with this email address already exists.');
    }

    if (supportsTransactions()) {
      await createWithTransaction(user, patientData);
    } else {
      user.status = 'INACTIVE';
      try {
        await user.save();
        await patient.save();
        user.status = 'ACTIVE';
        await user.save();
        await recordAudit({
          actorId: user._id,
          action: 'PATIENT_REGISTERED',
          resourceType: 'Patient',
          resourceId: patient._id,
          accessType: 'SELF_REGISTRATION'
        });
      } catch (error) {
        await rollbackNonTransactionalRegistration(user, error);
        throw error;
      }
    }

    const token = generateToken(user);
    return { user: user.toJSON(), token };
  } catch (error) {
    throw toRegistrationError(error);
  }
};

/**
 * Authenticates user credentials and returns safe user details and JWT token
 */
const loginUser = async ({ email, password }) => {
  if (!email || !password) {
    const error = new Error('Email and password are required.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!user) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  // Check account active status
  if (user.status !== 'ACTIVE') {
    const error = new Error('Your account is inactive. Please contact hospital administration.');
    error.statusCode = 403;
    throw error;
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  // Update last login timestamp
  user.lastLoginAt = new Date();
  await user.save();

  const token = generateToken(user);
  return { user: user.toJSON(), token };
};

/**
 * Retrieves safe user profile by ID
 */
const getUserProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }
  return user.toJSON();
};

module.exports = {
  registerPatient,
  loginUser,
  getUserProfile
};
