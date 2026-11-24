'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const patientController = require('../controllers/patient.controller');
const medicalRecordController = require('../controllers/medicalRecord.controller');

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

router.get(
  '/',
  authenticate,
  authorizeRole('PATIENT', 'DOCTOR'),
  patientController.listVisiblePatients
);

// Chronological medical records history for a patient
router.get(
  '/:id/medical-records',
  authenticate,
  authorizeRole('PATIENT', 'DOCTOR'),
  medicalRecordController.getPatientHistory
);

router.get(
  '/:id',
  authenticate,
  authorizeRole('PATIENT', 'DOCTOR'),
  patientController.getVisiblePatient
);

module.exports = router;
