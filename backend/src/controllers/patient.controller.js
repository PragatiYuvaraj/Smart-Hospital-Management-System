'use strict';

const patientService = require('../services/patient.service');

const getOwnProfile = async (req, res, next) => {
  try {
    const patient = await patientService.getOwnProfile(req.user._id);

    res.status(200).json({
      success: true,
      message: 'Patient profile retrieved successfully.',
      data: { patient }
    });
  } catch (error) {
    next(error);
  }
};

const updateOwnProfile = async (req, res, next) => {
  try {
    const patient = await patientService.updateOwnProfile(req.user._id, req.body);

    res.status(200).json({
      success: true,
      message: 'Patient profile updated successfully.',
      data: { patient }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOwnProfile,
  updateOwnProfile
};
