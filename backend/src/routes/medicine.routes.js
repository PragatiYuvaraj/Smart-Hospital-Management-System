'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const medicineController = require('../controllers/medicine.controller');

const router = express.Router();

router.get(
  '/availability',
  authenticate,
  authorizeRole('PHARMACY'),
  medicineController.availability
);

router.get(
  '/',
  authenticate,
  authorizeRole('PHARMACY', 'DOCTOR'),
  medicineController.list
);

module.exports = router;
