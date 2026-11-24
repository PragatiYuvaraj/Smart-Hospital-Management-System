'use strict';

const pharmacyService = require('../services/pharmacy.service');
const prescriptionService = require('../services/prescription.service');

const getPending = async (req, res, next) => {
  try {
    const data = await pharmacyService.getPendingPrescriptions(req.query);
    res.status(200).json({
      success: true,
      message: 'Pending prescriptions retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const prescription = await prescriptionService.createPrescription(req.user, req.body);
    res.status(201).json({
      success: true,
      message: 'Prescription created successfully.',
      data: prescription
    });
  } catch (error) {
    next(error);
  }
};

const getMy = async (req, res, next) => {
  try {
    const data = await prescriptionService.getMyPrescriptions(req.user);
    res.status(200).json({
      success: true,
      message: 'Released prescriptions retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPending,
  create,
  getMy
};
