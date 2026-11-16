const express = require('express');
const { getDBStatus } = require('../config/db');
const env = require('../config/env');

const router = express.Router();

/**
 * @route   GET /api/health
 * @desc    Health check endpoint for verifying API and Database status
 * @access  Public
 */
router.get('/', (req, res) => {
  const dbStatus = getDBStatus();
  
  res.status(200).json({
    success: true,
    message: 'Smart Hospital Management System API is healthy and running',
    data: {
      status: 'UP',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      database: dbStatus,
      hospitalTimezone: env.HOSPITAL_TIMEZONE,
      allowedOrigin: env.CLIENT_URL
    }
  });
});

module.exports = router;
