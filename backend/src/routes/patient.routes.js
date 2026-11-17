'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const patientController = require('../controllers/patient.controller');

const router = express.Router();

router.get(
  '/me',
  authenticate,
  authorizeRole('PATIENT'),
  patientController.getOwnProfile
);

router.patch(
  '/me',
  authenticate,
  authorizeRole('PATIENT'),
  patientController.updateOwnProfile
);

module.exports = router;
