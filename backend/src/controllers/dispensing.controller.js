'use strict';

const pharmacyService = require('../services/pharmacy.service');

const create = async (req, res, next) => {
  try {
    const dispensing = await pharmacyService.recordDispensing(req.body, req.user);
    res.status(200).json({
      success: true,
      message: 'Prescription dispensed successfully.',
      data: dispensing
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { create };
