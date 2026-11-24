'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const reviewController = require('../controllers/review.controller');

const router = express.Router();

router.get(
  '/upcoming',
  authenticate,
  authorizeRole('PATIENT', 'DOCTOR'),
  reviewController.getUpcoming
);

router.post(
  '/',
  authenticate,
  authorizeRole('DOCTOR'),
  reviewController.create
);

router.patch(
  '/:id/reschedule',
  authenticate,
  authorizeRole('DOCTOR'),
  reviewController.reschedule
);

router.post(
  '/:id/cancel',
  authenticate,
  authorizeRole('DOCTOR'),
  reviewController.cancel
);

router.post(
  '/:id/complete',
  authenticate,
  authorizeRole('DOCTOR'),
  reviewController.complete
);

module.exports = router;
