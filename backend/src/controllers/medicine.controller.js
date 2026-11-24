'use strict';

const pharmacyService = require('../services/pharmacy.service');

const list = async (req, res, next) => {
  try {
    const data = await pharmacyService.getMedicines(req.query);
    res.status(200).json({
      success: true,
      message: 'Medicine catalogue retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

const availability = async (req, res, next) => {
  try {
    const data = await pharmacyService.getMedicineAvailability(req.query);
    res.status(200).json({
      success: true,
      message: 'Medicine availability retrieved successfully.',
      data
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { list, availability };
