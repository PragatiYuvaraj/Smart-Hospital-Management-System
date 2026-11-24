'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const dispensingController = require('../controllers/dispensing.controller');

const router = express.Router();

router.post(
  '/',
  authenticate,
  authorizeRole('PHARMACY'),
  dispensingController.create
);

module.exports = router;
