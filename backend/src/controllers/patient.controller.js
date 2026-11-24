'use strict';

const patientService = require('../services/patient.service');

const listVisiblePatients = async (req, res, next) => {
  try {
    const data = await patientService.listVisiblePatients(req.user, req.query);
    res.status(200).json({
      success: true,
      message: 'Visible patient profiles retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const getVisiblePatient = async (req, res, next) => {
  try {
    const patient = await patientService.getVisiblePatient(req.params.id, req.user);
    res.status(200).json({
      success: true,
      message: 'Patient profile retrieved successfully.',
      data: { patient }
    });
  } catch (error) {
    next(error);
  }
};

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
  listVisiblePatients,
  getVisiblePatient,
  getOwnProfile,
  updateOwnProfile
};
