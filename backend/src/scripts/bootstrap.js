/**
 * bootstrap.js — Milestone 3 CMO Account Bootstrap
 *
 * PURPOSE:
 *   Creates the initial Chief Medical Officer (CMO) account with MANAGE_USERS
 *   permission. This is a one-time, CLI-only setup script. It is completely
 *   separate from the seed script (seed.js creates demo accounts).
 *
 * USAGE:
 *   npm run bootstrap
 *
 * SAFETY RULES:
 *   - Only runs from the command line. Never exposed as an HTTP endpoint.
 *   - Aborts if any user with MANAGE_USERS already exists (idempotent guard).
 *   - Credentials are printed to the terminal ONLY — never written to log files.
 *   - Remove BOOTSTRAP_CMO_* vars from .env after bootstrapping.
 *
 * REQUIRED ENV VARS (in backend/.env):
 *   BOOTSTRAP_CMO_EMAIL, BOOTSTRAP_CMO_NAME, BOOTSTRAP_CMO_PASSWORD
 *   (all optional for the main server but required for this script)
 */

'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ── Validate required env vars before importing anything else ──────────────
const { BOOTSTRAP_CMO_EMAIL, BOOTSTRAP_CMO_NAME, BOOTSTRAP_CMO_PASSWORD } = process.env;

const missing = [];
if (!BOOTSTRAP_CMO_EMAIL)    missing.push('BOOTSTRAP_CMO_EMAIL');
if (!BOOTSTRAP_CMO_NAME)     missing.push('BOOTSTRAP_CMO_NAME');
if (!BOOTSTRAP_CMO_PASSWORD) missing.push('BOOTSTRAP_CMO_PASSWORD');

if (missing.length > 0) {
  console.error('\n[BOOTSTRAP ERROR] Missing required environment variable(s):');
  missing.forEach((v) => console.error(`  • ${v}`));
  console.error('\nAdd these to backend/.env and retry. See backend/.env.example for reference.\n');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('\n[BOOTSTRAP ERROR] JWT_SECRET is not defined in backend/.env.\n');
  process.exit(1);
}

// ── Imports (after env validation) ────────────────────────────────────────
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart_hospital';

// ── Permissions for the initial CMO account ────────────────────────────────
const CMO_PERMISSIONS = ['MANAGE_USERS', 'DUTY_DOCTOR', 'VAULT_ACCESS'];

// ── Main bootstrap function ────────────────────────────────────────────────
async function bootstrap() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Smart Hospital — CMO Account Bootstrap Script     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // 1. Connect to MongoDB
  console.log(`[Bootstrap] Connecting to MongoDB: ${MONGODB_URI}`);
  await mongoose.connect(MONGODB_URI);
  console.log('[Bootstrap] MongoDB connected.\n');

  // 2. Guard: abort if any MANAGE_USERS account already exists
  const existingAdmin = await User.findOne({ permissions: 'MANAGE_USERS' });
  if (existingAdmin) {
    console.warn('[Bootstrap] ABORTED — A user with MANAGE_USERS already exists:');
    console.warn(`  Name : ${existingAdmin.name}`);
    console.warn(`  Email: ${existingAdmin.email}`);
    console.warn(`  Role : ${existingAdmin.role}`);
    console.warn('\nTo re-bootstrap, manually deactivate the existing account first.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // 3. Guard: abort if the target email is already registered
  const emailExists = await User.findOne({ email: BOOTSTRAP_CMO_EMAIL.toLowerCase().trim() });
  if (emailExists) {
    console.error('[Bootstrap] ERROR — The email is already registered:');
    console.error(`  Email: ${BOOTSTRAP_CMO_EMAIL}`);
    console.error('\nChange BOOTSTRAP_CMO_EMAIL or remove the existing account.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  // 4. Create CMO account
  //    The User model pre-save hook hashes passwordHash before persisting.
  const cmo = new User({
    name: BOOTSTRAP_CMO_NAME.trim(),
    email: BOOTSTRAP_CMO_EMAIL.toLowerCase().trim(),
    passwordHash: BOOTSTRAP_CMO_PASSWORD, // hashed by pre-save hook
    role: 'DOCTOR',
    permissions: CMO_PERMISSIONS,
    status: 'ACTIVE'
  });

  await cmo.save();

  // 5. Print result to terminal ONLY — never log to file
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║            CMO Account Created Successfully          ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Name       : ${String(cmo.name).padEnd(38)}║`);
  console.log(`║  Email      : ${String(cmo.email).padEnd(38)}║`);
  console.log(`║  Role       : ${String(cmo.role).padEnd(38)}║`);
  console.log(`║  Permissions: ${CMO_PERMISSIONS.join(', ').padEnd(38)}║`);
  console.log(`║  Status     : ${String(cmo.status).padEnd(38)}║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  ⚠  Remove BOOTSTRAP_CMO_* vars from .env now!      ║');
  console.log('║  ⚠  Store credentials in a password manager.        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  await mongoose.disconnect();
  console.log('[Bootstrap] MongoDB disconnected. Bootstrap complete.\n');
  process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  console.error('\n[Bootstrap] Unexpected error:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
