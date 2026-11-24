'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const assignmentController = require('../controllers/assignment.controller');

const router = express.Router();

router.get(
  '/',
  authenticate,
  requirePermission('MANAGE_USERS'),
  assignmentController.listAssignments
);

router.post(
  '/',
  authenticate,
  requirePermission('MANAGE_USERS'),
  assignmentController.createAssignment
);

router.get(
  '/patient/:patientId',
  authenticate,
  assignmentController.getPatientAssignment
);

router.get(
  '/doctor/:doctorId/patients',
  authenticate,
  assignmentController.getDoctorPatients
);

router.patch(
  '/:id/reassign',
  authenticate,
  requirePermission('MANAGE_USERS'),
  assignmentController.reassign
);

module.exports = router;
