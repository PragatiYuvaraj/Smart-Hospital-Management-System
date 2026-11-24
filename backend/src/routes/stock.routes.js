'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { authorizeRole } = require('../middleware/role.middleware');
const stockController = require('../controllers/stock.controller');

const router = express.Router();

router.post(
  '/receipts',
  authenticate,
  authorizeRole('PHARMACY'),
  stockController.createReceipt
);

module.exports = router;
