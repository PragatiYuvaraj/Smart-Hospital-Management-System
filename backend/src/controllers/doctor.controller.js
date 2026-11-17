'use strict';

const doctorService = require('../services/doctor.service');

const createDoctorProfile = async (req, res, next) => {
  try {
    const doctor = await doctorService.createDoctorProfile(req.body, req.user._id);

    res.status(201).json({
      success: true,
      message: 'Doctor profile created successfully.',
      data: { doctor }
    });
  } catch (error) {
    next(error);
  }
};

const getOwnProfile = async (req, res, next) => {
  try {
    const doctor = await doctorService.getOwnProfile(req.user._id);

    res.status(200).json({
      success: true,
      message: 'Doctor profile retrieved successfully.',
      data: { doctor }
    });
  } catch (error) {
    next(error);
  }
};

const getDoctorProfile = async (req, res, next) => {
  try {
    const doctor = await doctorService.getDoctorProfile(req.params.id, req.user);

    res.status(200).json({
      success: true,
      message: 'Doctor profile retrieved successfully.',
      data: { doctor }
    });
  } catch (error) {
    next(error);
  }
};

const updateDoctorProfile = async (req, res, next) => {
  try {
    const doctor = await doctorService.updateDoctorProfile(
      req.params.id,
      req.body,
      req.user._id
    );

    res.status(200).json({
      success: true,
      message: 'Doctor profile updated successfully.',
      data: { doctor }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDoctorProfile,
  getOwnProfile,
  getDoctorProfile,
  updateDoctorProfile
};
