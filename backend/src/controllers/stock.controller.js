'use strict';

const pharmacyService = require('../services/pharmacy.service');

const createReceipt = async (req, res, next) => {
  try {
    const receipt = await pharmacyService.recordStockReceipt(req.body, req.user);
    res.status(201).json({
      success: true,
      message: 'Stock receipt recorded successfully.',
      data: receipt
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { createReceipt };
