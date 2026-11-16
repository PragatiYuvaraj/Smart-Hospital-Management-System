/**
 * user.routes.js — Milestone 3: User Management Routes
 *
 * All routes in this file require the caller to be authenticated.
 * Routes that perform administrative actions also require the MANAGE_USERS permission.
 *
 * Route table:
 *   POST   /api/users                   → createUser          [MANAGE_USERS]
 *   GET    /api/users                   → listUsers           [MANAGE_USERS]
 *   GET    /api/users/:id               → getUserById         [self OR MANAGE_USERS]
 *   PATCH  /api/users/:id/status        → updateStatus        [MANAGE_USERS]
 *   PATCH  /api/users/:id/permissions   → updatePermissions   [MANAGE_USERS]
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/role.middleware');
const userController = require('../controllers/user.controller');

// ── Admin routes (MANAGE_USERS required) ───────────────────────────────────

/**
 * POST /api/users
 * Create a new DOCTOR or PHARMACY staff account.
 * Body: { name, email, password, role, permissions? }
 */
router.post(
  '/',
  authenticate,
  requirePermission('MANAGE_USERS'),
  userController.createUser
);

/**
 * GET /api/users
 * List users with optional filters.
 * Query: ?role=DOCTOR&status=ACTIVE&search=john&page=1&limit=20
 */
router.get(
  '/',
  authenticate,
  requirePermission('MANAGE_USERS'),
  userController.listUsers
);

/**
 * PATCH /api/users/:id/status
 * Activate or deactivate a user account.
 * Body: { status: 'ACTIVE' | 'INACTIVE' }
 */
router.patch(
  '/:id/status',
  authenticate,
  requirePermission('MANAGE_USERS'),
  userController.updateStatus
);

/**
 * PATCH /api/users/:id/permissions
 * Replace a user's permissions array (MANAGE_USERS is blocked).
 * Body: { permissions: ['DUTY_DOCTOR', 'VAULT_ACCESS'] }
 */
router.patch(
  '/:id/permissions',
  authenticate,
  requirePermission('MANAGE_USERS'),
  userController.updatePermissions
);

// ── Self or admin route ────────────────────────────────────────────────────

/**
 * GET /api/users/:id
 * Fetch a user profile. Any authenticated user may fetch their own.
 * Users with MANAGE_USERS may fetch any profile.
 * Note: This route is defined AFTER the PATCH routes to avoid :id
 *       matching the literal string "status" or "permissions".
 */
router.get('/:id', authenticate, userController.getUserById);

module.exports = router;
