'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole, requirePermission } = require('../middleware/role.middleware');
const doctorController = require('../controllers/doctor.controller');

const router = express.Router();

router.post(
  '/',
  authenticate,
  requirePermission('MANAGE_USERS'),
  doctorController.createDoctorProfile
);

router.get(
  '/',
  authenticate,
  doctorController.listDoctors
);

router.get(
  '/me',
  authenticate,
  authorizeRole('DOCTOR'),
  doctorController.getOwnProfile
);

router.get('/:id', authenticate, doctorController.getDoctorProfile);

router.patch(
  '/:id',
  authenticate,
  requirePermission('MANAGE_USERS'),
  doctorController.updateDoctorProfile
);

module.exports = router;
