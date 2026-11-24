'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const notificationController = require('../controllers/notification.controller');

const router = express.Router();

router.get(
  '/my',
  authenticate,
  authorizeRole('PATIENT', 'DOCTOR', 'PHARMACY'),
  notificationController.getMine
);

router.patch(
  '/:id/read',
  authenticate,
  authorizeRole('PATIENT', 'DOCTOR', 'PHARMACY'),
  notificationController.markAsRead
);

module.exports = router;
