/**
 * user.service.js — Milestone 3: User Management Service Layer
 *
 * All business-rule enforcement happens HERE, not in middleware or controllers.
 * Controllers are thin wrappers that call these functions and return JSON.
 *
 * PERMISSIONS MODEL:
 *   - MANAGE_USERS : Only on DOCTOR accounts. Granted only via bootstrap script.
 *                    Cannot be granted or revoked through the /permissions endpoint.
 *   - DUTY_DOCTOR  : Grantable via /permissions endpoint (DOCTOR only).
 *   - VAULT_ACCESS : Grantable via /permissions endpoint (DOCTOR only).
 *
 * PHARMACY restriction: PHARMACY accounts may hold no clinical permissions
 * (DUTY_DOCTOR, VAULT_ACCESS). They receive empty permissions arrays.
 */

'use strict';

const User = require('../models/User');
const { recordAudit } = require('./audit.service');

// ── Permission constants ────────────────────────────────────────────────────

/** All recognised permissions in this system */
const ALL_PERMISSIONS = ['MANAGE_USERS', 'DUTY_DOCTOR', 'VAULT_ACCESS'];

/**
 * Permissions that an authorised DOCTOR may grant/revoke on another user
 * via the PATCH /api/users/:id/permissions endpoint.
 * MANAGE_USERS is intentionally excluded — it can only come from bootstrap.
 */
const GRANTABLE_PERMISSIONS = ['DUTY_DOCTOR', 'VAULT_ACCESS'];

/** Clinical permissions that PHARMACY accounts must never hold */
const CLINICAL_PERMISSIONS = ['MANAGE_USERS', 'DUTY_DOCTOR', 'VAULT_ACCESS'];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Escapes user-supplied regex metacharacters to prevent ReDoS and unintentional pattern matching.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a consistent AppError object that the Express error handler understands.
 */
function createError(statusCode, message, errors = []) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.errors = errors;
  return err;
}

// ── Service Functions ──────────────────────────────────────────────────────

/**
 * createStaffAccount
 *
 * Creates a new DOCTOR or PHARMACY staff account.
 * Only a user with MANAGE_USERS may call this (enforced in route middleware).
 *
 * Business rules:
 *   - role must be DOCTOR or PHARMACY (not PATIENT — patients self-register)
 *   - MANAGE_USERS must not appear in the requested permissions list
 *   - PHARMACY accounts receive no permissions regardless of what is requested
 *   - Email must be unique
 *
 * @param {object} payload  - { name, email, password, role, permissions }
 * @param {string} requestingUserId - _id of the authenticated admin (for audit)
 * @returns {object} sanitised user object (passwordHash excluded via toJSON)
 */
async function createStaffAccount(payload, requestingUserId) {
  const { name, email, password, role, permissions = [] } = payload;

  // 1. Only staff roles may be created through this endpoint
  if (!role || role === 'PATIENT') {
    throw createError(
      400,
      'Staff accounts must have role DOCTOR or PHARMACY. Patients register through /api/auth/register.'
    );
  }

  if (!['DOCTOR', 'PHARMACY'].includes(role)) {
    throw createError(400, `Invalid role '${role}'. Must be DOCTOR or PHARMACY.`);
  }

  // 2. MANAGE_USERS cannot be granted via this endpoint
  const requestedPerms = Array.isArray(permissions) ? permissions : [];
  if (requestedPerms.includes('MANAGE_USERS')) {
    throw createError(
      400,
      'MANAGE_USERS cannot be assigned through this endpoint. Use the bootstrap script for the initial CMO account.'
    );
  }

  // 3. Validate that only recognised permissions are requested
  const unknownPerms = requestedPerms.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (unknownPerms.length > 0) {
    throw createError(400, `Unrecognised permissions: ${unknownPerms.join(', ')}.`);
  }

  // 4. PHARMACY accounts never receive any clinical permissions
  let resolvedPermissions = requestedPerms;
  if (role === 'PHARMACY') {
    const blocked = requestedPerms.filter((p) => CLINICAL_PERMISSIONS.includes(p));
    if (blocked.length > 0) {
      throw createError(
        400,
        `PHARMACY accounts cannot hold clinical permissions: ${blocked.join(', ')}.`
      );
    }
    resolvedPermissions = []; // PHARMACY always gets empty permissions
  }

  // 5. Validate DUTY_DOCTOR and VAULT_ACCESS may only go to DOCTORs
  if (role === 'DOCTOR') {
    const invalidForDoctor = requestedPerms.filter(
      (p) => !GRANTABLE_PERMISSIONS.includes(p)
    );
    if (invalidForDoctor.length > 0) {
      throw createError(
        400,
        `Permissions not grantable via this endpoint: ${invalidForDoctor.join(', ')}.`
      );
    }
  }

  // 6. Email uniqueness check
  const emailLower = typeof email === 'string' ? email.toLowerCase().trim() : '';
  const existing = await User.findOne({ email: emailLower });
  if (existing) {
    throw createError(409, `Email '${emailLower}' is already registered.`);
  }

  // 7. Create the account
  const user = new User({
    name: typeof name === 'string' ? name.trim() : name,
    email: emailLower,
    passwordHash: password, // pre-save bcrypt hook hashes this
    role,
    permissions: resolvedPermissions,
    status: 'ACTIVE'
  });

  await user.save();

  await recordAudit({
    actorId: requestingUserId,
    action: 'STAFF_ACCOUNT_CREATED',
    resourceType: 'User',
    resourceId: user._id,
    accessType: 'MANAGEMENT'
  });

  return user.toJSON(); // passwordHash stripped by toJSON transform
}

/**
 * listUsers
 *
 * Returns a paginated list of users. Excludes passwordHash.
 * Only accessible to users with MANAGE_USERS (enforced at route level).
 *
 * @param {object} query - { role, status, search, page, limit }
 * @returns {{ users, total, page, totalPages }}
 */
async function listUsers({ role, status, search, page = 1, limit = 20 } = {}) {
  const filter = {};

  if (role && ['DOCTOR', 'PATIENT', 'PHARMACY'].includes(role)) {
    filter.role = role;
  }

  if (status && ['ACTIVE', 'INACTIVE'].includes(status)) {
    filter.status = status;
  }

  if (search && typeof search === 'string' && search.trim()) {
    const escaped = escapeRegex(search.trim());
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ name: regex }, { email: regex }];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [users, total] = await Promise.all([
    User.find(filter).select('-passwordHash -__v').skip(skip).limit(limitNum).lean(),
    User.countDocuments(filter)
  ]);

  return {
    users,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum)
  };
}

/**
 * getUserById
 *
 * Retrieves a single user. Access rules:
 *   - A user may always fetch their own profile.
 *   - A user with MANAGE_USERS may fetch any profile.
 *   - Otherwise: 403.
 *
 * @param {string} targetId       - User _id to fetch
 * @param {object} requestingUser - Decoded JWT payload (id, role, permissions)
 * @returns {object} sanitised user object
 */
async function getUserById(targetId, requestingUser) {
  const isSelf = String(requestingUser.id) === String(targetId);
  const isAdmin = (requestingUser.permissions || []).includes('MANAGE_USERS');

  if (!isSelf && !isAdmin) {
    throw createError(403, 'Forbidden. You may only view your own profile.');
  }

  const user = await User.findById(targetId).select('-passwordHash -__v').lean();
  if (!user) {
    throw createError(404, 'User not found.');
  }

  return user;
}

/**
 * updateUserStatus
 *
 * Activates or deactivates a user account.
 * Only accessible to users with MANAGE_USERS (enforced at route level).
 *
 * Business rules:
 *   - An admin cannot deactivate their own account.
 *   - newStatus must be 'ACTIVE' or 'INACTIVE'.
 *
 * @param {string} targetId         - User _id to update
 * @param {string} newStatus        - 'ACTIVE' | 'INACTIVE'
 * @param {string} requestingUserId - _id of the requesting admin
 * @returns {object} updated user object
 */
async function updateUserStatus(targetId, newStatus, requestingUserId) {
  // Guard: cannot deactivate own account
  if (String(requestingUserId) === String(targetId)) {
    throw createError(400, 'You cannot change the status of your own account.');
  }

  if (!['ACTIVE', 'INACTIVE'].includes(newStatus)) {
    throw createError(400, `Invalid status '${newStatus}'. Must be ACTIVE or INACTIVE.`);
  }

  const user = await User.findById(targetId);
  if (!user) {
    throw createError(404, 'User not found.');
  }

  user.status = newStatus;
  await user.save();

  await recordAudit({
    actorId: requestingUserId,
    action: 'USER_STATUS_UPDATED',
    resourceType: 'User',
    resourceId: user._id,
    accessType: 'MANAGEMENT'
  });

  return user.toJSON();
}

/**
 * updateUserPermissions
 *
 * Replaces the full permissions array for a user.
 * Only accessible to users with MANAGE_USERS (enforced at route level).
 *
 * Business rules:
 *   - An admin cannot modify their own permissions.
 *   - MANAGE_USERS cannot be included in the new permissions list.
 *   - Only permissions from GRANTABLE_PERMISSIONS are accepted.
 *   - PHARMACY accounts cannot hold any permissions.
 *   - Clinical permissions may only be assigned to DOCTOR accounts.
 *
 * @param {string}   targetId         - User _id to update
 * @param {string[]} newPermissions   - Replacement permissions array
 * @param {string}   requestingUserId - _id of the requesting admin
 * @returns {object} updated user object
 */
async function updateUserPermissions(targetId, newPermissions, requestingUserId) {
  // Guard: cannot modify own permissions
  if (String(requestingUserId) === String(targetId)) {
    throw createError(400, 'You cannot modify your own permissions.');
  }

  const perms = Array.isArray(newPermissions) ? newPermissions : [];

  // Guard: MANAGE_USERS is off-limits via this endpoint
  if (perms.includes('MANAGE_USERS')) {
    throw createError(
      400,
      'MANAGE_USERS cannot be granted or revoked through this endpoint.'
    );
  }

  // Guard: only recognised grantable permissions
  const unknownPerms = perms.filter((p) => !GRANTABLE_PERMISSIONS.includes(p));
  if (unknownPerms.length > 0) {
    throw createError(
      400,
      `Unrecognised or non-grantable permissions: ${unknownPerms.join(', ')}. Allowed: ${GRANTABLE_PERMISSIONS.join(', ')}.`
    );
  }

  const user = await User.findById(targetId);
  if (!user) {
    throw createError(404, 'User not found.');
  }

  // Guard: PHARMACY may hold no permissions
  if (user.role === 'PHARMACY') {
    if (perms.length > 0) {
      throw createError(400, 'PHARMACY accounts cannot hold clinical permissions.');
    }
  }

  // Guard: clinical permissions for DOCTOR only
  if (user.role === 'PATIENT' && perms.length > 0) {
    throw createError(400, 'PATIENT accounts cannot hold clinical permissions.');
  }

  // Preserve MANAGE_USERS if the target already has it (bootstrap-granted)
  const preservedManageUsers = user.permissions.includes('MANAGE_USERS')
    ? ['MANAGE_USERS']
    : [];

  user.permissions = [...preservedManageUsers, ...perms];
  await user.save();

  await recordAudit({
    actorId: requestingUserId,
    action: 'USER_PERMISSIONS_UPDATED',
    resourceType: 'User',
    resourceId: user._id,
    accessType: 'MANAGEMENT'
  });

  return user.toJSON();
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  createStaffAccount,
  listUsers,
  getUserById,
  updateUserStatus,
  updateUserPermissions,
  GRANTABLE_PERMISSIONS,
  ALL_PERMISSIONS
};
