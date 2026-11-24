const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authRateLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

// Public routes with brute-force rate limiting
router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);

// Protected routes
router.get('/me', authenticate, authController.getMe);

module.exports = router;
