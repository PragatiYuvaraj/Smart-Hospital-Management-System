const authService = require('../services/auth.service');

/**
 * @route   POST /api/auth/register
 * @desc    Patient self-registration
 * @access  Public
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const result = await authService.registerPatient({ name, email, password });

    res.status(201).json({
      success: true,
      message: 'Patient registered successfully.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   POST /api/auth/login
 * @desc    User login (Doctor, Patient, Pharmacy)
 * @access  Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.loginUser({ email, password });

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route   GET /api/auth/me
 * @desc    Get currently authenticated user's profile
 * @access  Private
 */
const getMe = async (req, res, next) => {
  try {
    const user = await authService.getUserProfile(req.user._id);

    res.status(200).json({
      success: true,
      message: 'User profile retrieved successfully.',
      data: { user }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe
};
