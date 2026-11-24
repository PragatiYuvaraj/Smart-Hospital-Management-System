'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const medicalRecordController = require('../controllers/medicalRecord.controller');

const router = express.Router();

// Record a new consultation
router.post(
  '/',
  authenticate,
  authorizeRole('DOCTOR'),
  medicalRecordController.create
);

// Get consultation detail
router.get(
  '/:id',
  authenticate,
  authorizeRole('DOCTOR', 'PATIENT'),
  medicalRecordController.getDetail
);

// Update draft consultation (author doctor only)
router.patch(
  '/:id',
  authenticate,
  authorizeRole('DOCTOR'),
  medicalRecordController.updateDraft
);

// Finalize consultation
router.post(
  '/:id/finalize',
  authenticate,
  authorizeRole('DOCTOR'),
  medicalRecordController.finalize
);

// Toggle patient visibility release
router.post(
  '/:id/release',
  authenticate,
  authorizeRole('DOCTOR'),
  medicalRecordController.setRelease
);

// Add auditable amendment to finalized consultation
router.post(
  '/:id/amendments',
  authenticate,
  authorizeRole('DOCTOR'),
  medicalRecordController.addAmendment
);

module.exports = router;
