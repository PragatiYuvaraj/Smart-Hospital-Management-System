'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const prescriptionController = require('../controllers/prescription.controller');

const router = express.Router();

router.get(
  '/pending',
  authenticate,
  authorizeRole('PHARMACY'),
  prescriptionController.getPending
);

router.get(
  '/my',
  authenticate,
  authorizeRole('PATIENT'),
  prescriptionController.getMy
);

router.post(
  '/',
  authenticate,
  authorizeRole('DOCTOR'),
  prescriptionController.create
);

module.exports = router;
