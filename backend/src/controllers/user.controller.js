/**
 * user.controller.js — Milestone 3: User Management Controllers
 *
 * Controllers are intentionally thin. All business logic lives in user.service.js.
 * Each function:
 *   1. Extracts parameters from the request.
 *   2. Calls the appropriate service function.
 *   3. Returns a consistent { success, message, data } JSON response.
 *
 * Error handling:
 *   Service functions throw errors with a .statusCode property.
 *   The Express global error handler in app.js catches unhandled errors.
 *   We use try/catch here to forward service errors cleanly.
 */

'use strict';

const userService = require('../services/user.service');

// ── POST /api/users ────────────────────────────────────────────────────────
/**
 * Create a new DOCTOR or PHARMACY staff account.
 * Requires: authenticated + MANAGE_USERS permission.
 */
async function createUser(req, res, next) {
  try {
    const { name, email, password, role, permissions } = req.body;
    const requestingUserId = req.user.id;

    const user = await userService.createStaffAccount(
      { name, email, password, role, permissions },
      requestingUserId
    );

    return res.status(201).json({
      success: true,
      message: 'Staff account created successfully.',
      data: { user }
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/users ─────────────────────────────────────────────────────────
/**
 * List users with optional filters and pagination.
 * Requires: authenticated + MANAGE_USERS permission.
 *
 * Query params: role, status, search, page, limit
 */
async function listUsers(req, res, next) {
  try {
    const { role, status, search, page, limit } = req.query;
    const result = await userService.listUsers({ role, status, search, page, limit });

    return res.status(200).json({
      success: true,
      message: 'Users retrieved successfully.',
      data: result
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/users/:id ─────────────────────────────────────────────────────
/**
 * Get a user by ID.
 * - Any authenticated user may fetch their own profile.
 * - Users with MANAGE_USERS may fetch any profile.
 */
async function getUserById(req, res, next) {
  try {
    const targetId = req.params.id;
    const requestingUser = req.user; // { id, role, permissions }

    const user = await userService.getUserById(targetId, requestingUser);

    return res.status(200).json({
      success: true,
      message: 'User retrieved successfully.',
      data: { user }
    });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/users/:id/status ────────────────────────────────────────────
/**
 * Activate or deactivate a user account.
 * Requires: authenticated + MANAGE_USERS permission.
 *
 * Request body: { status: 'ACTIVE' | 'INACTIVE' }
 */
async function updateStatus(req, res, next) {
  try {
    const targetId = req.params.id;
    const { status } = req.body;
    const requestingUserId = req.user.id;

    const user = await userService.updateUserStatus(targetId, status, requestingUserId);

    return res.status(200).json({
      success: true,
      message: `User status updated to ${user.status}.`,
      data: { user }
    });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/users/:id/permissions ──────────────────────────────────────
/**
 * Replace a user's permissions array.
 * Requires: authenticated + MANAGE_USERS permission.
 *
 * Request body: { permissions: ['DUTY_DOCTOR', 'VAULT_ACCESS'] }
 */
async function updatePermissions(req, res, next) {
  try {
    const targetId = req.params.id;
    const { permissions } = req.body;
    const requestingUserId = req.user.id;

    const user = await userService.updateUserPermissions(
      targetId,
      permissions,
      requestingUserId
    );

    return res.status(200).json({
      success: true,
      message: 'User permissions updated successfully.',
      data: { user }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createUser,
  listUsers,
  getUserById,
  updateStatus,
  updatePermissions
};
