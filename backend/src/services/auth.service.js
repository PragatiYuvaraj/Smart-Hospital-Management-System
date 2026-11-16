const User = require('../models/User');
const generateToken = require('../utils/generateToken');

/**
 * Registers a new patient.
 * Enforces role as PATIENT and ignores any client-supplied roles or permissions.
 */
const registerPatient = async ({ name, email, password }) => {
  if (!name || !email || !password) {
    const error = new Error('Name, email, and password are required.');
    error.statusCode = 400;
    throw error;
  }

  if (password.length < 6) {
    const error = new Error('Password must be at least 6 characters long.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    const error = new Error('An account with this email address already exists.');
    error.statusCode = 409;
    throw error;
  }

  // Create new user explicitly locking role to PATIENT and permissions to []
  const user = new User({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: password, // Will be hashed by User pre-save hook
    role: 'PATIENT',
    permissions: [],
    status: 'ACTIVE'
  });

  await user.save();

  const token = generateToken(user);
  return { user: user.toJSON(), token };
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
