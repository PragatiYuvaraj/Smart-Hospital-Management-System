const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Generates a signed JWT access token for an authenticated user
 * @param {Object} user - User document or safe object
 * @returns {string} Signed JWT token
 */
const generateToken = (user) => {
  const payload = {
    id: user._id || user.id,
    email: user.email,
    role: user.role,
    permissions: user.permissions || []
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN || '1d'
  });
};

module.exports = generateToken;
